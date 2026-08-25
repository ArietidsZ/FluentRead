import type {BackgroundFallbackHandler} from '../messageRouter';
import type {
    TranslationRequestMessage,
    TranslationRequestMessageBase,
} from '@/src/services/translation/types';

interface TranslationRequestCandidate extends Record<string, unknown> {
    origin: unknown;
}

export interface TranslationRequestHandlerDependencies {
    translate(message: TranslationRequestMessage): Promise<string | string[]>;
    serializeError(error: unknown): unknown;
}

const STRING_FIELDS = [
    'context',
    'pageContext',
    'serviceOverride',
    'modelOverride',
    'sourceLanguage',
    'targetLanguage',
] as const satisfies readonly (keyof TranslationRequestMessageBase)[];

function hasOwn(value: object, key: PropertyKey): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function isTranslationRequestCandidate(message: unknown): message is TranslationRequestCandidate {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
    if (!hasOwn(message, 'origin') || hasOwn(message, 'type')) return false;
    return true;
}

function assertOptionalString(candidate: TranslationRequestCandidate, field: typeof STRING_FIELDS[number]): void {
    const value = candidate[field];
    if (value !== undefined && typeof value !== 'string') {
        throw new TypeError(`翻译请求字段 ${field} 必须是字符串`);
    }
}

export function parseTranslationRequest(candidate: TranslationRequestCandidate): TranslationRequestMessage {
    // Step 1: origin 是无 type 翻译协议的判别字段；批量请求只能包含字符串。
    let origin: string | string[];
    if (typeof candidate.origin === 'string') {
        origin = candidate.origin;
    } else if (Array.isArray(candidate.origin)
        && candidate.origin.every((item): item is string => typeof item === 'string')) {
        origin = [...candidate.origin];
    } else {
        throw new TypeError('翻译请求 origin 必须是字符串或字符串数组');
    }

    // Step 2: 逐个收窄可选协议字段，避免未知 payload 直接流入 provider。
    for (const field of STRING_FIELDS) assertOptionalString(candidate, field);
    if (candidate.useCache !== undefined && typeof candidate.useCache !== 'boolean') {
        throw new TypeError('翻译请求字段 useCache 必须是布尔值');
    }
    if (candidate.requestTimeoutMs !== undefined
        && (typeof candidate.requestTimeoutMs !== 'number' || !Number.isFinite(candidate.requestTimeoutMs))) {
        throw new TypeError('翻译请求字段 requestTimeoutMs 必须是有限数字');
    }

    // Step 3: 只复制版本化协议允许的字段，不把页面注入的任意属性传给 provider。
    const base: TranslationRequestMessageBase = {};
    for (const field of STRING_FIELDS) {
        const value = candidate[field];
        if (typeof value === 'string') base[field] = value;
    }
    if (typeof candidate.useCache === 'boolean') base.useCache = candidate.useCache;
    if (typeof candidate.requestTimeoutMs === 'number') base.requestTimeoutMs = candidate.requestTimeoutMs;
    return typeof origin === 'string' ? {...base, origin} : {...base, origin};
}

/**
 * 普通翻译消息是历史上的无 `type` 协议，因此只能作为 typed router 的最后一个 fallback。
 * 所有带 `type` 的未知消息必须保持未处理，不能误送到翻译 provider。
 */
export function createTranslationRequestFallback<TContext = undefined>(
    dependencies: TranslationRequestHandlerDependencies,
): BackgroundFallbackHandler<TContext, TranslationRequestCandidate> {
    return {
        canHandle: isTranslationRequestCandidate,
        async handle(candidate) {
            try {
                const message = parseTranslationRequest(candidate);
                return await dependencies.translate(message);
            } catch (error) {
                return dependencies.serializeError(error);
            }
        },
    };
}
