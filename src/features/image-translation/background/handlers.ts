/**
 * @file src/features/image-translation/background/handlers.ts
 * 文件职责：定义图片 OCR、整图翻译、文本批译、取消和语言包下载后台消息，并对来自页面或扩展 UI 的未知输入执行严格校验。
 * 主要内容：包含消息常量与联合类型、data:image 和字符串数组解析、OCR 语言白名单、对象结果断言，以及通过依赖注入创建各操作 handler 的 createImageTranslationBackgroundHandlers。
 * 模块边界：本文件只负责协议入口与用例编排，不直接运行 Tesseract、Canvas、网络 fetch 或 Offscreen；这些图像运算能力由 repository、adapter 与 services 实现并由 app 注入。
 */
import {
    IMAGE_OCR_LANGUAGE_PACKS,
    normalizeImageOcrLanguageCodes,
    type ImageOcrLanguageCode,
} from '@/src/features/image-translation/ocrLanguages';
import {
    attachTranslationRequestControl,
    markTranslationRemainingBudget,
} from '@/src/services/translation/requestSnapshot';

export const IMAGE_OCR_MESSAGE_TYPE = 'fluentReadImageOcr' as const;
export const IMAGE_TRANSLATE_MESSAGE_TYPE = 'fluentReadImageTranslate' as const;
export const IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE = 'fluentReadImageTranslateTexts' as const;
export const IMAGE_OCR_DOWNLOAD_MESSAGE_TYPE = 'fluentReadImageOcrDownload' as const;
export const IMAGE_CANCEL_MESSAGE_TYPE = 'fluentReadImageCancel' as const;
export const IMAGE_OPERATION_TIMEOUT_MS = 180_000;

export interface ImageOcrMessage {
    type: typeof IMAGE_OCR_MESSAGE_TYPE;
    image?: unknown;
    sourceLanguage?: unknown;
    requestId?: unknown;
    timeoutMs?: unknown;
}

export interface ImageTranslateMessage {
    type: typeof IMAGE_TRANSLATE_MESSAGE_TYPE;
    image?: unknown;
    sourceLanguage?: unknown;
    title?: unknown;
    requestId?: unknown;
    timeoutMs?: unknown;
}

export interface ImageCancelMessage {
    type: typeof IMAGE_CANCEL_MESSAGE_TYPE;
    requestId?: unknown;
}

export interface ImageTranslateTextsMessage {
    type: typeof IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE;
    texts?: unknown;
    title?: unknown;
    requestId?: unknown;
    timeoutMs?: unknown;
}

export interface ImageOcrDownloadMessage {
    type: typeof IMAGE_OCR_DOWNLOAD_MESSAGE_TYPE;
    languages?: unknown;
}

export type ImageTranslationBackgroundMessage =
    | ImageOcrMessage
    | ImageTranslateMessage
    | ImageTranslateTextsMessage
    | ImageOcrDownloadMessage
    | ImageCancelMessage;

type ImageTextTranslationRequestBase = {
    context: string;
    pageContext: '';
    useCache: true;
    serviceOverride: string;
    requestTimeoutMs: number;
};

type ImageTextTranslationRequest = ImageTextTranslationRequestBase & (
    | {origin: string}
    | {origin: string[]}
);

export interface ImageTranslationBackgroundDependencies {
    readonly assertLanguagesDownloaded: (sourceLanguage: string) => Promise<void>;
    readonly recognizeImage: (
        image: string,
        sourceLanguage: string,
        options: ImageOperationOptions,
    ) => Promise<unknown>;
    readonly translateImage: (
        image: string,
        sourceLanguage: string,
        title: string,
        options: ImageOperationOptions,
    ) => Promise<unknown>;
    readonly getTranslationService: () => string;
    readonly supportsBatchTranslation: (service: string) => boolean;
    readonly translateTexts: (request: ImageTextTranslationRequest) => Promise<string | string[]>;
    readonly downloadLanguages: (languages: ImageOcrLanguageCode[]) => Promise<void>;
    readonly markLanguagesDownloaded: (languages: ImageOcrLanguageCode[]) => Promise<ImageOcrLanguageCode[]>;
    readonly now?: () => number;
}

export interface ImageOperationOptions {
    readonly requestId: string;
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
}

export interface ImageOperationMessage {
    readonly requestId?: unknown;
    readonly timeoutMs?: unknown;
}

export interface ImageOperationRegistry {
    run<T>(message: ImageOperationMessage, operation: (options: ImageOperationOptions) => Promise<T>): Promise<T>;
    cancel(requestId: unknown): {success: true; cancelled: boolean; requestId: string};
}

export interface ImageTranslationBackgroundHandler<TMessage extends ImageTranslationBackgroundMessage> {
    readonly type: TMessage['type'];
    handle(message: TMessage): Promise<unknown>;
}

const SUPPORTED_OCR_LANGUAGES = new Set(IMAGE_OCR_LANGUAGE_PACKS.map((pack) => pack.code));
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const MAX_IMAGE_OPERATION_TIMEOUT_MS = 300_000;
export const IMAGE_TEXT_TRANSLATION_TIMEOUT_MS = 120_000;

function parseDataImage(value: unknown): string {
    if (typeof value !== 'string' || !value.startsWith('data:image/')) {
        throw new TypeError('图片数据无效');
    }
    return value;
}

function parseRequiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new TypeError(`图片翻译 ${field} 必须是非空字符串`);
    }
    return value;
}

function parseOptionalTitle(value: unknown): string {
    if (value === undefined) return '';
    if (typeof value !== 'string') throw new TypeError('图片翻译 title 必须是字符串');
    return value;
}

function parseRequestId(value: unknown): string {
    const requestId = parseRequiredString(value, 'requestId');
    if (!REQUEST_ID_PATTERN.test(requestId)) throw new TypeError('图片翻译 requestId 格式无效');
    return requestId;
}

function parseTimeoutMs(value: unknown): number {
    if (value === undefined) return IMAGE_OPERATION_TIMEOUT_MS;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new TypeError('图片翻译 timeoutMs 必须是正数');
    }
    return Math.min(MAX_IMAGE_OPERATION_TIMEOUT_MS, Math.floor(value));
}

function imageAbortError(timedOut: boolean): Error {
    const error = new Error(timedOut ? '图片 OCR 请求超时' : '图片 OCR 请求已取消');
    error.name = timedOut ? 'TimeoutError' : 'AbortError';
    return error;
}

/** 图片与圈选 feature 共用的后台取消所有权，确保它们不会各自遗漏共享 OCR 队列。 */
export function createImageOperationRegistry(legacyPrefix = 'image'): ImageOperationRegistry {
    const activeOperations = new Map<string, AbortController>();
    const cancelledBeforeStart = new Set<string>();
    const cancellationOrder: string[] = [];
    let legacyRequestSequence = 0;

    const rememberCancellation = (requestId: string) => {
        if (cancelledBeforeStart.has(requestId)) return;
        cancelledBeforeStart.add(requestId);
        cancellationOrder.push(requestId);
        if (cancellationOrder.length <= 512) return;
        cancelledBeforeStart.delete(cancellationOrder.shift()!);
    };

    return {
        async run<T>(
            message: ImageOperationMessage,
            operation: (options: ImageOperationOptions) => Promise<T>,
        ): Promise<T> {
            const requestId = message.requestId === undefined
                ? `legacy-${legacyPrefix}-${++legacyRequestSequence}`
                : parseRequestId(message.requestId);
            if (cancelledBeforeStart.delete(requestId)) throw imageAbortError(false);
            if (activeOperations.has(requestId)) throw new Error('图片 OCR requestId 正在执行');
            const timeoutMs = parseTimeoutMs(message.timeoutMs);
            const controller = new AbortController();
            activeOperations.set(requestId, controller);
            let timedOut = false;
            const timer = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, timeoutMs);

            try {
                const pending = Promise.resolve().then(() => operation({
                    requestId,
                    signal: controller.signal,
                    timeoutMs,
                }));
                return await new Promise<T>((resolve, reject) => {
                    let settled = false;
                    const cleanup = () => controller.signal.removeEventListener('abort', handleAbort);
                    const finish = (callback: () => void) => {
                        if (settled) return;
                        settled = true;
                        cleanup();
                        callback();
                    };
                    const handleAbort = () => finish(() => reject(imageAbortError(timedOut)));
                    controller.signal.addEventListener('abort', handleAbort, {once: true});
                    void pending.then(
                        result => finish(() => resolve(result)),
                        error => finish(() => reject(error)),
                    );
                });
            } finally {
                clearTimeout(timer);
                if (activeOperations.get(requestId) === controller) activeOperations.delete(requestId);
            }
        },
        cancel(requestIdValue) {
            const requestId = parseRequestId(requestIdValue);
            const controller = activeOperations.get(requestId);
            if (controller) controller.abort();
            else rememberCancellation(requestId);
            return {success: true, cancelled: Boolean(controller), requestId};
        },
    };
}

function parseTexts(value: unknown): string[] {
    if (!Array.isArray(value) || value.length === 0) throw new TypeError('图片中没有可翻译文字');
    if (!value.every((text): text is string => typeof text === 'string' && text.trim().length > 0)) {
        throw new TypeError('图片翻译 texts 只能包含非空字符串');
    }
    return [...value];
}

function parseOcrLanguages(value: unknown): ImageOcrLanguageCode[] {
    if (!Array.isArray(value) || value.length === 0) throw new TypeError('OCR 语言包列表不能为空');
    if (!value.every((language): language is ImageOcrLanguageCode =>
        typeof language === 'string' && SUPPORTED_OCR_LANGUAGES.has(language as ImageOcrLanguageCode))) {
        throw new TypeError('OCR 语言包列表包含不支持的语言');
    }
    return normalizeImageOcrLanguageCodes(value);
}

function parseObjectResult(value: unknown, operation: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${operation}结果无效`);
    }
    return value as Record<string, unknown>;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function translateImageTexts(
    texts: string[],
    title: string,
    dependencies: ImageTranslationBackgroundDependencies,
    options: ImageOperationOptions,
): Promise<string[]> {
    // 步骤 1：冻结本次 OCR 事务使用的 provider，避免逐条回退期间设置变化混入另一服务。
    const service = dependencies.getTranslationService();
    const now = dependencies.now ?? (() => Date.now());
    const deadline = now() + IMAGE_TEXT_TRANSLATION_TIMEOUT_MS;
    const baseRequest = {
        context: title,
        pageContext: '' as const,
        useCache: true as const,
        serviceOverride: service,
    };
    const remainingBudget = () => {
        const remaining = Math.floor(deadline - now());
        if (remaining <= 0) throw new Error('图片文字翻译总时间已耗尽');
        return remaining;
    };
    const controlledRequest = <T extends ImageTextTranslationRequest>(request: T) =>
        attachTranslationRequestControl(markTranslationRemainingBudget(request), {
            signal: options.signal,
            ownershipKey: `image:${options.requestId}`,
        });

    if (dependencies.supportsBatchTranslation(service)) {
        try {
            const translations = await dependencies.translateTexts(controlledRequest({
                ...baseRequest,
                origin: texts,
                requestTimeoutMs: remainingBudget(),
            }));
            if (!Array.isArray(translations)
                || translations.length !== texts.length
                || !translations.every((translation) => typeof translation === 'string')) {
                throw new Error('provider 未返回等长字符串数组');
            }
            return translations;
        } catch (error) {
            throw new Error(`图片文字批量翻译失败：${getErrorMessage(error)}`);
        }
    }

    // 步骤 2：旧式单条 provider 按原 OCR 顺序串行调用，既保序也不会绕过共享并发上限。
    const translations: string[] = [];
    for (const [index, origin] of texts.entries()) {
        try {
            const translation = await dependencies.translateTexts(controlledRequest({
                ...baseRequest,
                origin,
                requestTimeoutMs: remainingBudget(),
            }));
            if (typeof translation !== 'string') throw new Error('provider 未返回字符串译文');
            translations.push(translation);
        } catch (error) {
            throw new Error(`图片第 ${index + 1} 段文字翻译失败：${getErrorMessage(error)}`);
        }
    }
    return translations;
}

/** 创建图片 OCR/翻译/取消/语言包下载 handlers。 */
export function createImageTranslationBackgroundHandlers(
    dependencies: ImageTranslationBackgroundDependencies,
): ImageTranslationBackgroundHandler<ImageTranslationBackgroundMessage>[] {
    const operationRegistry = createImageOperationRegistry('image');
    const textOperationRegistry = createImageOperationRegistry('image-text');

    return [
        {
            type: IMAGE_OCR_MESSAGE_TYPE,
            async handle(message: ImageOcrMessage) {
                const image = parseDataImage(message.image);
                const sourceLanguage = parseRequiredString(message.sourceLanguage, 'sourceLanguage');
                const lines = await operationRegistry.run(message, async (options) => {
                    await dependencies.assertLanguagesDownloaded(sourceLanguage);
                    if (options.signal.aborted) throw imageAbortError(false);
                    return dependencies.recognizeImage(image, sourceLanguage, options);
                });
                if (!Array.isArray(lines)) throw new Error('图片 OCR 结果无效');
                return {success: true, lines};
            },
        },
        {
            type: IMAGE_TRANSLATE_MESSAGE_TYPE,
            async handle(message: ImageTranslateMessage) {
                const image = parseDataImage(message.image);
                const sourceLanguage = parseRequiredString(message.sourceLanguage, 'sourceLanguage');
                const title = parseOptionalTitle(message.title);
                const result = parseObjectResult(
                    await operationRegistry.run(message, async (options) => {
                        await dependencies.assertLanguagesDownloaded(sourceLanguage);
                        if (options.signal.aborted) throw imageAbortError(false);
                        return dependencies.translateImage(image, sourceLanguage, title, options);
                    }),
                    '图片翻译',
                );
                return {success: true, ...result};
            },
        },
        {
            type: IMAGE_CANCEL_MESSAGE_TYPE,
            async handle(message: ImageCancelMessage) {
                const image = operationRegistry.cancel(message.requestId);
                const text = textOperationRegistry.cancel(message.requestId);
                return {...image, cancelled: image.cancelled || text.cancelled};
            },
        },
        {
            type: IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE,
            async handle(message: ImageTranslateTextsMessage) {
                const texts = parseTexts(message.texts);
                const translations = await textOperationRegistry.run(message, options => translateImageTexts(
                    texts, parseOptionalTitle(message.title), dependencies, options,
                ));
                return {success: true, translations};
            },
        },
        {
            type: IMAGE_OCR_DOWNLOAD_MESSAGE_TYPE,
            async handle(message: ImageOcrDownloadMessage) {
                const languages = parseOcrLanguages(message.languages);
                await dependencies.downloadLanguages(languages);
                const downloaded = await dependencies.markLanguagesDownloaded(languages);
                return {success: true, languages: downloaded};
            },
        },
    ];
}
