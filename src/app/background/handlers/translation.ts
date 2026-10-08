/**
 * @file src/app/background/handlers/translation.ts
 * 文件职责：解析没有显式 type 的翻译请求，并把它作为后台消息路由的受控 fallback 接入共享翻译 broker。
 * 主要内容：同步校验 origin 与公开请求 ID、捕获原生 sender，先注册活动请求再等待来源，逐步核验取消；附着隐私、术语来源后最后附着不可枚举 control，并提供精确取消 handler。
 * 模块边界：只承担协议验证与 fallback 适配，注册表由共享 service 工厂提供；不选择 provider、不缓存或读取配置凭据，公开 ID 在 broker 前移除。生产缺 documentId 时必须持有浏览器原生 Port 租约，不以 frame 或 URL 冒充文档。
 */
import {captureTranslationRequestContext, createTranslationRequestRegistry, parseClientRequestId, throwIfTranslationRequestAborted, waitForTranslationRequestPreparation, type TranslationRequestContext, type TranslationRequestRegistry} from '@/src/services/translation/requestRegistry';
export {createTranslationRequestRegistry, type TranslationRequestContext, type TranslationRequestRegistry} from '@/src/services/translation/requestRegistry';
import {isTrustedIncognitoSender, resolveNativeSourcePrivacy} from '@/src/platform/browser/incognitoSource';
import {assertNativeDocumentContext} from '@/src/platform/browser/documentSession';
import type {IncognitoSourceRuntime, NativeMessageSender, NativeSourcePrivacy} from '@/src/platform/browser/incognitoSource';
import {attachTranslationSourcePrivacy} from '@/src/services/translation/requestPrivacy';
import type {BackgroundFallbackHandler} from '../messageRouter';
import type {BackgroundMessageHandler} from '../messageRouter';
import {attachTranslationGlossaryContext, attachTranslationRequestControl, attachTrustedPrivateSource} from '@/src/services/translation/requestSnapshot';
import type {
    TranslationCancelMessage,
    TranslationCancelResponse,
    TranslationRequestMessage,
    TranslationRequestMessageBase,
} from '@/src/services/translation/types';
import {TRANSLATION_CANCEL_MESSAGE_TYPE} from '@/src/services/translation/types';

interface TranslationRequestCandidate extends Record<string, unknown> {
    origin: unknown;
}

export interface TranslationRequestHandlerDependencies {
    runtimeId?: string;
    requireDocumentOwner?: boolean;
    ready?: Promise<unknown>;
    resolveSourcePrivacy?: (sender: NativeMessageSender | undefined) => Promise<NativeSourcePrivacy>;
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
    'sourceLanguageDetectionText',
    'glossaryRevision',
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
    if (candidate.requestPurpose !== undefined && candidate.requestPurpose !== 'comparison') {
        throw new TypeError('翻译请求 requestPurpose 无效');
    }
    // 步骤 1：origin 是无 type 翻译协议的判别字段；批量请求只能包含字符串。
    let origin: string | string[];
    if (typeof candidate.origin === 'string') {
        origin = candidate.origin;
    } else if (Array.isArray(candidate.origin)) {
        const denseOrigin = Array.from(candidate.origin);
        if (!denseOrigin.every((item): item is string => typeof item === 'string')) {
            throw new TypeError('翻译请求 origin 必须是字符串或字符串数组');
        }
        origin = denseOrigin;
    } else {
        throw new TypeError('翻译请求 origin 必须是字符串或字符串数组');
    }

    // 步骤 2：逐个收窄可选协议字段，避免未知 payload 直接流入 provider。
    parseClientRequestId(candidate.clientRequestId, true);
    for (const field of STRING_FIELDS) assertOptionalString(candidate, field);
    if (candidate.useCache !== undefined && typeof candidate.useCache !== 'boolean') {
        throw new TypeError('翻译请求字段 useCache 必须是布尔值');
    }
    if (candidate.enableAIContext !== undefined && typeof candidate.enableAIContext !== 'boolean') {
        throw new TypeError('翻译请求字段 enableAIContext 必须是布尔值');
    }
    if (candidate.aiMultiSegment !== undefined && typeof candidate.aiMultiSegment !== 'boolean') {
        throw new TypeError('翻译请求字段 aiMultiSegment 必须是布尔值');
    }
    if (candidate.thinkingOverride !== undefined && typeof candidate.thinkingOverride !== 'boolean') {
        throw new TypeError('翻译请求字段 thinkingOverride 必须是布尔值');
    }
    if (candidate.glossaryRevision !== undefined
        && !/^glossary-v1:(?:disabled|[a-f0-9]{64})$/u.test(candidate.glossaryRevision as string)) {
        throw new TypeError('翻译请求 glossaryRevision 格式无效');
    }
    if (candidate.glossaryContext !== undefined
        && !['page', 'document', 'video'].includes(candidate.glossaryContext as string)) {
        throw new TypeError('翻译请求 glossaryContext 无效');
    }
    if (candidate.glossaryIds !== undefined && candidate.glossaryIds !== null
        && (!Array.isArray(candidate.glossaryIds) || candidate.glossaryIds.length > 100
            || !Array.from(candidate.glossaryIds).every(id => typeof id === 'string' && id.length <= 128))) {
        throw new TypeError('翻译请求 glossaryIds 必须是有限字符串数组或 null');
    }
    if (candidate.requestTimeoutMs !== undefined
        && (typeof candidate.requestTimeoutMs !== 'number' || !Number.isFinite(candidate.requestTimeoutMs))) {
        throw new TypeError('翻译请求字段 requestTimeoutMs 必须是有限数字');
    }

    // 步骤 3：只复制版本化协议允许的字段，不把页面注入的任意属性传给 provider。
    const base: TranslationRequestMessageBase = {};
    if (candidate.requestPurpose === 'comparison') base.requestPurpose = 'comparison';
    for (const field of STRING_FIELDS) {
        const value = candidate[field];
        if (typeof value === 'string') base[field] = value;
    }
    if (typeof candidate.enableAIContext === 'boolean') base.enableAIContext = candidate.enableAIContext;
    if (typeof candidate.useCache === 'boolean') base.useCache = candidate.useCache;
    if (typeof candidate.aiMultiSegment === 'boolean') base.aiMultiSegment = candidate.aiMultiSegment;
    if (typeof candidate.thinkingOverride === 'boolean') base.thinkingOverride = candidate.thinkingOverride;
    if (typeof candidate.requestTimeoutMs === 'number') base.requestTimeoutMs = candidate.requestTimeoutMs;
    if (candidate.glossaryIds === null) base.glossaryIds = null;
    else if (Array.isArray(candidate.glossaryIds)) base.glossaryIds = Object.freeze([...candidate.glossaryIds]);
    if (candidate.glossaryContext !== undefined) base.glossaryContext = candidate.glossaryContext as TranslationRequestMessageBase['glossaryContext'];
    return typeof origin === 'string' ? {...base, origin} : {...base, origin};
}

/**
 * 普通翻译消息是历史上的无 `type` 协议，因此只能作为 typed router 的最后一个 fallback。
 * 所有带 `type` 的未知消息必须保持未处理，不能误送到翻译 provider。
 */
export function createTranslationRequestFallback<TContext = undefined>(
    dependencies: TranslationRequestHandlerDependencies & {requestRegistry?: TranslationRequestRegistry},
): BackgroundFallbackHandler<TContext, TranslationRequestCandidate> {
    const requestRegistry = dependencies.requestRegistry ?? createTranslationRequestRegistry();
    return {
        canHandle: isTranslationRequestCandidate,
        async handle(candidate, context) {
            try {
                const parsed = parseTranslationRequest(candidate);
                const clientRequestId = parseClientRequestId(candidate.clientRequestId, true);
                const captured = captureTranslationRequestContext(context as TranslationRequestContext | undefined);
                assertNativeDocumentContext(captured, dependencies.requireDocumentOwner);
                const operation = async (signal?: AbortSignal, ownershipKey?: string) => {
                    if (dependencies.ready) await waitForTranslationRequestPreparation(dependencies.ready, signal);
                    throwIfTranslationRequestAborted(signal);
                    const sender = captured.sender;
                    const message = dependencies.resolveSourcePrivacy
                        ? attachTranslationSourcePrivacy(parsed, await waitForTranslationRequestPreparation(dependencies.resolveSourcePrivacy(sender), signal))
                        : isTrustedIncognitoSender(sender, dependencies.runtimeId) ? attachTrustedPrivateSource(parsed)
                            : dependencies.runtimeId && sender?.id === dependencies.runtimeId && sender.tab?.incognito === false
                                ? attachTranslationSourcePrivacy(parsed, 'regular') : parsed;
                    throwIfTranslationRequestAborted(signal);
                    const senderUrl = sender?.url;
                    const isDocument = typeof senderUrl === 'string'
                        && /^(?:chrome|moz|safari-web)-extension:\/\/[^/]+\/document\.html(?:[?#]|$)/u.test(senderUrl);
                    attachTranslationGlossaryContext(message, {
                        pageUrl: typeof senderUrl === 'string' && /^https?:\/\//u.test(senderUrl) ? senderUrl : undefined,
                        context: message.glossaryContext === 'document' && isDocument ? 'document'
                            : message.glossaryContext === 'video' ? 'video' : 'page',
                    });
                    if (signal && ownershipKey) attachTranslationRequestControl(message, {signal, ownershipKey});
                    throwIfTranslationRequestAborted(signal);
                    const result = await dependencies.translate(message);
                    throwIfTranslationRequestAborted(signal);
                    return result;
                };
                return await (clientRequestId ? requestRegistry.run(clientRequestId, captured, operation) : operation());
            } catch (error) {
                return dependencies.serializeError(error);
            }
        },
    };
}

export function createTranslationCancelHandler<TContext extends TranslationRequestContext>(
    requestRegistry: TranslationRequestRegistry,
): BackgroundMessageHandler<TContext, TranslationCancelMessage, TranslationCancelResponse> {
    return {
        type: TRANSLATION_CANCEL_MESSAGE_TYPE,
        handle: (message, context) => requestRegistry.cancel(message.clientRequestId, context),
    };
}

/** 生产入口与组合测试共用的装配边界，不接受页面提供的身份判断。 */
export function createNativeTranslationRequestFallback<TContext = undefined>(
    runtime: IncognitoSourceRuntime,
    dependencies: Omit<TranslationRequestHandlerDependencies, 'runtimeId' | 'resolveSourcePrivacy'>
        & {requestRegistry?: TranslationRequestRegistry},
): BackgroundFallbackHandler<TContext, TranslationRequestCandidate> {
    return createTranslationRequestFallback({
        ...dependencies, runtimeId: runtime.id,
        resolveSourcePrivacy: sender => resolveNativeSourcePrivacy(sender, runtime),
    });
}
