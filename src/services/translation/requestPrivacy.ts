/**
 * @file src/services/translation/requestPrivacy.ts
 * 文件职责：在后台进程内保留每次执行请求的可信三态来源。
 * 主要内容：以不可从 JSON 构造的内部 symbol 冻结 regular/private/unknown，允许内部请求展开保留该标记。
 * 模块边界：只携带来源，不推断浏览器身份，不读配置或凭据；油猴构建使用关闭的 capability 适配器。
 */
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
