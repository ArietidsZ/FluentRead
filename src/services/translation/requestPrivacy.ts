/**
 * @file src/services/translation/requestPrivacy.ts
 * 文件职责：在后台进程内保留每次执行请求的可信三态来源。
 * 主要内容：以不可从 JSON 构造的内部 symbol 携带 regular/private/unknown，校验未标与未知请求对当前策略和快照的双边准入；拒绝时保留非重试错误。
 * 模块边界：不推断浏览器身份，不读取全局配置或凭据，仅验证注入的策略和内部来源；油猴构建使用关闭的 capability 适配器。
 */
import {hasConfiguredIncognitoRoute, NATIVE_PRIVATE_ROUTE_SUPPORTED, type IncognitoRouteConfig} from '@/src/core/config/incognitoRoute';
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
