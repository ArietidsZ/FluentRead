/**
 * @file src/features/selection-translation/background/wordLookupHandler.ts
 * 文件职责：处理划词词典查询消息，支持先返回词典原文、再限时补充目标语言辅助释义，失败时保留可读词卡。
 * 主要内容：定义 selectionWordLookup 协议和依赖，保留旧辅助释义编排；原生原文查询捕获文档 owner、解析可信三态来源、限制在线回退，配置变化和断连取消在途请求并清空所属缓存，回复明确标记受限路径。
 * 模块边界：该文件不直接请求任何词典站点或翻译 provider；词典 lookup 和 translateTexts 由后台注入，数据解析/缓存归 services/wordDictionary，组件只消费返回词卡。
 */
import {normalizeChineseLanguageCode} from '@/src/core/language/chinese';
import type {WordCardData} from '../services/wordDictionary';
import {createNativeWordDictionaryLookup} from '../services/wordDictionary';
import {captureTranslationRequestContext, createTranslationRequestRegistry, parseClientRequestId, waitForTranslationRequestPreparation,
    type TranslationRequestContext, type TranslationRequestRegistry} from '@/src/services/translation/requestRegistry';
import {getNativeDocumentSession} from '@/src/platform/browser/documentSession';
import {resolveNativeSourcePrivacy, type IncognitoSourceRuntime} from '@/src/platform/browser/incognitoSource';
import {fullPageTranslationConfigKey} from '@/src/services/translation/requestPrivacy';
import type {Config} from '@/src/core/config/model';
import {hasConfiguredIncognitoRoute} from '@/src/core/config/incognitoRoute';

export {nativeDictionaryFeedback, localizeNativeDictionaryFeedback} from '@/src/core/i18n/messages/native-dictionary-feedback';

export type {
    WordCardData,
} from '../services/wordDictionary';

export const SELECTION_WORD_LOOKUP_MESSAGE_TYPE = 'selectionWordLookup' as const;
const WORD_SUPPORT_TIMEOUT_MS = 2_500;

export interface SelectionWordLookupMessage {
    type: typeof SELECTION_WORD_LOOKUP_MESSAGE_TYPE;
    word?: unknown;
    targetLanguage?: unknown;
    /** false 先返回可读词卡；缺省兼容既有的一次性查询。 */
    translateFields?: unknown;
}

export interface WordCardTranslationRequest {
    origin: string[];
    context: '';
    pageContext: '';
    useCache: true;
    targetLanguage: string;
    requestTimeoutMs: number;
}

export interface SelectionWordLookupDependencies {
    readonly lookupWord: (word: string) => Promise<WordCardData | null>;
    readonly getDefaultTargetLanguage: () => string;
    readonly translate: (request: WordCardTranslationRequest) => Promise<string | string[]>;
    readonly warn: (message: string, error: unknown) => void;
}

export interface SelectionWordLookupHandler {
    readonly type: typeof SELECTION_WORD_LOOKUP_MESSAGE_TYPE;
    handle(message: SelectionWordLookupMessage): Promise<{success: true; data: WordCardData | null}>;
}

interface WordDefinitionTranslationSlot {
    meaningIndex: number;
    definitionIndex: number;
    field: 'translatedDefinition' | 'translatedExample';
    original: string;
}

function parseWord(value: unknown): string {
    if (typeof value !== 'string') throw new TypeError('单词查询 word 必须是字符串');
    return value;
}

function parseTargetLanguage(value: unknown, fallback: string): string {
    const candidate = value === undefined ? fallback : value;
    if (typeof candidate !== 'string' || !candidate.trim()) {
        throw new TypeError('单词查询 targetLanguage 必须是非空字符串');
    }
    return candidate;
}

function cloneWordCard(card: WordCardData): WordCardData {
    return {
        ...card,
        phonetics: card.phonetics.map((pronunciation) => ({...pronunciation})),
        meanings: card.meanings.map((meaning) => ({
            ...meaning,
            definitions: meaning.definitions.map((definition) => ({...definition})),
        })),
        sources: card.sources.map((source) => ({...source})),
    };
}

function prepareWordCardForTarget(card: WordCardData, targetLanguage: string): WordCardData {
    if (normalizeChineseLanguageCode(targetLanguage) === 'zh-Hans') return card;
    const result = cloneWordCard(card);
    for (const meaning of result.meanings) {
        for (const definition of meaning.definitions) {
            delete definition.translatedDefinition;
            delete definition.translatedExample;
        }
    }
    return result;
}

/**
 * 只翻译学习卡片中实际展示的前四组释义/例句；失败时保留词典原文。
 */
export async function translateVisibleWordCardFields(
    card: WordCardData,
    targetLanguage: string,
    translate: SelectionWordLookupDependencies['translate'],
    warn: SelectionWordLookupDependencies['warn'],
): Promise<WordCardData> {
    const normalizedTargetLanguage = normalizeChineseLanguageCode(targetLanguage);
    // 公共词典的既有辅助字段没有目标语言元数据，通常为简体；不能将它们
    // 当作繁体翻译失败后的译文。仅清除克隆上的辅助字段，原词典内容保持可读。
    const fallbackCard = prepareWordCardForTarget(card, normalizedTargetLanguage);
    const slots: WordDefinitionTranslationSlot[] = [];
    for (const [meaningIndex, meaning] of fallbackCard.meanings.slice(0, 4).entries()) {
        for (const [definitionIndex, definition] of meaning.definitions.slice(0, 4).entries()) {
            if (definition.definition && !definition.translatedDefinition) {
                slots.push({meaningIndex, definitionIndex, field: 'translatedDefinition', original: definition.definition});
            }
            if (definition.example && !definition.translatedExample) {
                slots.push({meaningIndex, definitionIndex, field: 'translatedExample', original: definition.example});
            }
        }
    }
    if (slots.length === 0) return fallbackCard;

    const uniqueOrigins = [...new Set(slots.map((slot) => slot.original))];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let translated: string | string[] | null = null;
    try {
        translated = await Promise.race([translate({
            origin: uniqueOrigins,
            context: '',
            pageContext: '',
            useCache: true,
            targetLanguage: normalizedTargetLanguage,
            requestTimeoutMs: WORD_SUPPORT_TIMEOUT_MS,
        }), new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('词典辅助释义翻译超时')), WORD_SUPPORT_TIMEOUT_MS);
        })]);
    } catch (error) {
        warn('[FluentRead] word definition translation unavailable; keeping dictionary text', error);
    } finally {
        clearTimeout(timer);
    }
    if (!Array.isArray(translated) || translated.length !== uniqueOrigins.length) return fallbackCard;

    // 只有 provider 返回与请求一一对应的批量结果时才克隆并写入卡片。
    const translatedByOrigin = new Map(uniqueOrigins.map((origin, index) => [origin, translated[index]]));
    const result = fallbackCard === card ? cloneWordCard(card) : fallbackCard;
    for (const slot of slots) {
        const value = translatedByOrigin.get(slot.original);
        if (typeof value !== 'string' || !value.trim() || value.trim() === slot.original) continue;
        const definition = result.meanings[slot.meaningIndex].definitions[slot.definitionIndex];
        definition[slot.field] = value.trim();
    }
    return result;
}

/** 创建划词词典查询 handler；词典 provider 与翻译 broker 由 app 层注入。 */
export function createSelectionWordLookupHandler(
    dependencies: SelectionWordLookupDependencies,
): SelectionWordLookupHandler {
    return {
        type: SELECTION_WORD_LOOKUP_MESSAGE_TYPE,
        async handle(message) {
            const word = parseWord(message.word);
            const targetLanguage = parseTargetLanguage(
                message.targetLanguage,
                dependencies.getDefaultTargetLanguage(),
            );
            if (message.translateFields !== undefined && typeof message.translateFields !== 'boolean') {
                throw new TypeError('单词查询 translateFields 必须是布尔值');
            }
            const card = await dependencies.lookupWord(word);
            return {
                success: true,
                data: card
                    ? message.translateFields === false
                        ? prepareWordCardForTarget(card, targetLanguage)
                        : await translateVisibleWordCardFields(card, targetLanguage, dependencies.translate, dependencies.warn)
                    : null,
            };
        },
    };
}

/** 原生原文词卡独立准入：只接受原生来源，配置专用 pair 的 private/unknown 禁止在线词典回退。 */
export function createNativeSelectionWordLookupRuntime(deps: {
    ready: Promise<void>; getConfig(): Config; runtime: IncognitoSourceRuntime;
    subscribeConfig(listener: (config: Config) => void): () => void;
    requestRegistry?: TranslationRequestRegistry; lookup?: ReturnType<typeof createNativeWordDictionaryLookup>;
}) {
    const actual = deps.requestRegistry ?? createTranslationRequestRegistry(true);
    const lookup = deps.lookup ?? createNativeWordDictionaryLookup();
    const owners = new Map<string, TranslationRequestContext>();
    const owner = (context: TranslationRequestContext) => getNativeDocumentSession(context)!.ownerKey;
    const registry: TranslationRequestRegistry = {
        run: (id, context, operation) => actual.run(id, context, operation),
        cancel: (id, context) => actual.cancel(id, context),
        releaseOwner(context) {actual.releaseOwner(context);const key = owner(context);lookup.releaseOwner(key);owners.delete(key);},
    };
    const configKey = (config: Config) => JSON.stringify([fullPageTranslationConfigKey(config), config.selectionTranslationService]);
    let key = configKey(deps.getConfig());
    const stop = deps.subscribeConfig(next => {
        const value = configKey(next);
        if (value === key) return;
        key = value;for (const context of [...owners.values()]) registry.releaseOwner(context);lookup.clearCache();
    });
    const admit = (message: {clientRequestId?: unknown}, context: TranslationRequestContext) => {
        if (!deps.runtime.id || context.sender?.id !== deps.runtime.id) throw new Error('词典查询来源不属于当前扩展');
        if (!getNativeDocumentSession(context)) throw new Error('词典查询需要原生文档连接');
        return parseClientRequestId(message.clientRequestId)!;
    };
    const handlers = [{type: SELECTION_WORD_LOOKUP_MESSAGE_TYPE, async handle(message: SelectionWordLookupMessage & {clientRequestId?: unknown}, context: TranslationRequestContext) {
        const captured = captureTranslationRequestContext(context), id = admit(message, captured), word = parseWord(message.word);
        if (message.translateFields !== false) throw new TypeError('原生词典查询只返回原文，辅助释义使用独立翻译入口');
        return registry.run(id, captured, async signal => {
            const ownerKey = owner(captured);owners.set(ownerKey, captured);
            const timer = setTimeout(() => registry.cancel(id, captured), 3_500);
            try {
                await waitForTranslationRequestPreparation(deps.ready, signal);
                const privacy = await waitForTranslationRequestPreparation(resolveNativeSourcePrivacy(captured.sender, deps.runtime), signal);
                const config = deps.getConfig(), target = parseTargetLanguage(message.targetLanguage, config.to);
                const configured = hasConfiguredIncognitoRoute(config);
                const restricted = configured && privacy !== 'regular';
                let card: WordCardData | null;
                try {card = await lookup.lookup(word, {ownerKey, privacy, onlineAllowed: !restricted, signal});}
                catch (error) {signal.throwIfAborted();if (!restricted) throw error;card = null;}
                signal.throwIfAborted();
                return {success: true, data: card ? prepareWordCardForTarget(card, target) : null, onlineDictionaryRestricted: restricted};
            } finally {clearTimeout(timer);}
        });
    }}, {type: 'selectionWordLookupCancel', handle(message: {type?: string; clientRequestId?: unknown}, context: TranslationRequestContext) {
        const captured = captureTranslationRequestContext(context);return registry.cancel(admit(message, captured), captured);
    }}] as const;
    return {handlers, registry, dispose() {stop();for (const context of [...owners.values()]) registry.releaseOwner(context);lookup.clearCache();}};
}
