/**
 * @file src/services/translation/requestPrivacy.ts
 * 文件职责：保留后台执行请求的可信三态，并为页面前端编排解析原生提示下的有效线路。
 * 主要内容：以内部 symbol 携带后台可信三态并验证双边准入；复用文档的前端原生提示解析规则，在能力与编排前选择有效 pair，并比较不外发的全页配置摘要。
 * 模块边界：不读取浏览器或全局配置，不把前端提示转为执行授权；后台 symbol 与原生来源校验保持独立，油猴构建关闭这些原生能力。
 */
import {hasConfiguredIncognitoRoute, resolveIncognitoRoute, NATIVE_PRIVATE_ROUTE_SUPPORTED, type IncognitoRouteConfig} from '@/src/core/config/incognitoRoute';
import type {Config} from '@/src/core/config/model';
const TRUSTED_PRIVATE_SOURCE = Symbol('fluentread.trusted-private-source');
export type TranslationSourcePrivacy = 'regular' | 'private' | 'unknown';

export function attachTranslationSourcePrivacy<T extends object>(message: T, privacy: TranslationSourcePrivacy): T {
    return {...message, [TRUSTED_PRIVATE_SOURCE]: privacy};
}

export function getTranslationSourcePrivacy(message: object): TranslationSourcePrivacy | undefined {
    return (message as {[TRUSTED_PRIVATE_SOURCE]?: TranslationSourcePrivacy})[TRUSTED_PRIVATE_SOURCE];
}

/** 只由后台从原生 sender 派生；公开消息 parser 不采纳该来源。 */
export function attachTrustedPrivateSource<T extends object>(message: T): T {
    return attachTranslationSourcePrivacy(message, 'private');
}

export function hasTrustedPrivateSource(message: object): boolean {
    return getTranslationSourcePrivacy(message) === 'private';
}

export class TranslationSourceUnknownError extends Error {
    readonly retryable = false;
    readonly kind = 'bad-request';
    readonly code = 'TRANSLATION_SOURCE_UNKNOWN';
    constructor() {
        super('无法确认此翻译请求的普通或私密来源，已停止执行。请从支持的网页标签页重试；设置仍可读取和保存。');
        this.name = 'TranslationSourceUnknownError';
    }
}

/** 未标来源不能用旧空快照绕过当前策略，也不能因当前清空而释放旧受保护快照。 */
export function assertTranslationSourcePrivacy(message: object, live: IncognitoRouteConfig, snapshot: IncognitoRouteConfig): void {
    if (!NATIVE_PRIVATE_ROUTE_SUPPORTED) return;
    const privacy = getTranslationSourcePrivacy(message);
    if ((privacy === undefined || privacy === 'unknown')
        && (hasConfiguredIncognitoRoute(live) || hasConfiguredIncognitoRoute(snapshot))) {
        throw new TranslationSourceUnknownError();
    }
}

/** 文档与全页共用的前端提示规则；只返回 service/model，不附着可信来源。 */
export function resolvePageTranslationRouteHint(source: IncognitoRouteConfig, nativeHint: unknown) {
    if (!hasConfiguredIncognitoRoute(source) || nativeHint === false) return undefined;
    if (nativeHint !== true) throw new TranslationSourceUnknownError();
    return resolveIncognitoRoute(source);
}

/** 页面内部比较公开配置；不把摘要、连接值或私密标记加入请求或持久缓存。 */
export function fullPageTranslationConfigKey(source: Config): string {
    return JSON.stringify([
        source.service, source.model, source.customModel, source.incognitoService, source.incognitoModel,
        source.customModels, source.customOpenAIProviders, source.proxy, source.customBody, source.requestHeaderRules,
        source.modelThinking, source.system_role, source.user_role, source.enableAIContext, source.enableAIMultiSegment, source.useCache,
        source.from, source.to, source.excludedLanguages, source.glossaryLibraries, source.glossaryEnabled,
        source.display, source.style, source.fullPageTranslationMode, source.translationScope, source.minTranslationTextLength, source.sidebarTranslationEnabled,
        source.pageTitleTranslationEnabled, source.eagerTranslationCharacters, source.siteAdaptation,
        source.translationMaxRetries, source.translationBackoffBaseMs, source.translationBackoffMaxMs,
        source.maxConcurrentTranslations, source.translationRequestsPerSecond, source.translationRequestsPerMinute,
        source.serviceRequestLimits, source.modelRequestLimits, source.requireApiKey, source.apiKeyRotationEnabled, source.apiKeyRecoveryMs,
        source.freeTranslationOrder, source.freeTranslationMode, source.freeTranslationTimeoutMs, source.freeTranslationCooldownMs, source.myMemoryEmail,
        source.azureOpenaiEndpoint, source.newApiUrl, source.custom, source.deepseekApiType, source.deepseekThinkingMode,
        source.minimaxRegion, source.minimaxBillingPlan, source.mimoRegion, source.mimoBillingPlan,
        source.deeplx, source.deeplApiPlan, source.serviceRegion,
    ]);
}
