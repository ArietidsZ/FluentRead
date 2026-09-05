/**
 * @file src/platform/browser/chromeTranslationPreparationRequest.ts
 * 文件职责：保存 Chrome 本地翻译模型的短期待准备语言对，并为设置页提供读取、匹配清除和跨上下文变更订阅。
 * 主要内容：校验具体语言代码，通过会话存储保存一条缺包记录，串行处理本上下文的写入与清除，并监听全局 session 变更。
 * 模块边界：只存语言代码到 browser.storage.session；不保存正文、不启动模型、不负责 UI 文案或翻译请求生命周期。
 */
import browser from 'webextension-polyfill';

/**
 * Chrome 本地翻译模型准备请求的短期跨页面状态。
 * 这里只保存语言代码，不保存触发请求的正文。
 */

export const CHROME_TRANSLATION_PREPARATION_STORAGE_KEY = 'fluentread.chromeTranslationPreparation';

export interface ChromeTranslationPreparationRequest {
    readonly sourceLanguage: string;
    readonly targetLanguage: string;
}

export interface ChromeTranslationPreparationStorageArea {
    get(keys?: string | string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
}

const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu;

function isValidLanguageCode(value: unknown): value is string {
    return typeof value === 'string' && LANGUAGE_CODE_PATTERN.test(value.trim());
}

function canonicalLanguage(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (['zh-cn', 'zh-hans', 'zh-sg'].includes(normalized)) return 'zh';
    if (['zh-tw', 'zh-hant', 'zh-hk', 'zh-mo'].includes(normalized)) return 'zh-hant';
    return normalized;
}

function parseRequest(value: unknown): ChromeTranslationPreparationRequest | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (!isValidLanguageCode(record.sourceLanguage) || !isValidLanguageCode(record.targetLanguage)) return null;
    const sourceLanguage = record.sourceLanguage.trim();
    const targetLanguage = record.targetLanguage.trim();
    if (sourceLanguage.toLowerCase() === 'auto' || canonicalLanguage(sourceLanguage) === canonicalLanguage(targetLanguage)) return null;
    return {sourceLanguage, targetLanguage};
}

function getStorageArea(area?: ChromeTranslationPreparationStorageArea): ChromeTranslationPreparationStorageArea | undefined {
    if (area) return area;
    try {
        return browser.storage?.session as unknown as ChromeTranslationPreparationStorageArea;
    } catch {
        return undefined;
    }
}

export function createChromeTranslationPreparationStore(area?: ChromeTranslationPreparationStorageArea) {
    const storage = getStorageArea(area);
    let mutation = Promise.resolve();

    return {
        async get(): Promise<ChromeTranslationPreparationRequest | null> {
            if (!storage?.get) return null;
            try {
                const result = await storage.get(CHROME_TRANSLATION_PREPARATION_STORAGE_KEY);
                return parseRequest(result?.[CHROME_TRANSLATION_PREPARATION_STORAGE_KEY]);
            } catch {
                return null;
            }
        },
        async set(request: ChromeTranslationPreparationRequest): Promise<void> {
            const parsed = parseRequest(request);
            if (!parsed || !storage?.set) return;
            mutation = mutation.then(async () => {
                try {
                    await storage.set({[CHROME_TRANSLATION_PREPARATION_STORAGE_KEY]: parsed});
                } catch {
                    // 状态提示失败不能影响翻译主链路。
                }
            });
            await mutation;
        },
        async clear(request?: ChromeTranslationPreparationRequest): Promise<void> {
            if (!storage) return;
            mutation = mutation.then(async () => {
                try {
                    if (!request) {
                        await storage.remove(CHROME_TRANSLATION_PREPARATION_STORAGE_KEY);
                        return;
                    }
                    const result = await storage.get(CHROME_TRANSLATION_PREPARATION_STORAGE_KEY);
                    const current = parseRequest(result?.[CHROME_TRANSLATION_PREPARATION_STORAGE_KEY]);
                    if (current?.sourceLanguage === request.sourceLanguage
                        && current.targetLanguage === request.targetLanguage) {
                        await storage.remove(CHROME_TRANSLATION_PREPARATION_STORAGE_KEY);
                    }
                } catch {
                    // 状态提示失败不能影响翻译主链路。
                }
            });
            await mutation;
        },
        subscribe(listener: (request: ChromeTranslationPreparationRequest | null) => void): () => void {
            const onChanged = browser.storage?.onChanged;
            if (!onChanged?.addListener) return () => undefined;
            const handleChange = (changes: Record<string, {newValue?: unknown}>, areaName: string) => {
                if (areaName !== 'session' || !Object.hasOwn(changes, CHROME_TRANSLATION_PREPARATION_STORAGE_KEY)) return;
                listener(parseRequest(changes[CHROME_TRANSLATION_PREPARATION_STORAGE_KEY]?.newValue));
            };
            onChanged.addListener(handleChange);
            return () => onChanged.removeListener?.(handleChange);
        },
    };
}

export const chromeTranslationPreparationStore = createChromeTranslationPreparationStore();

export function isChromeTranslationPreparationRequest(value: unknown): value is ChromeTranslationPreparationRequest {
    return parseRequest(value) !== null;
}
