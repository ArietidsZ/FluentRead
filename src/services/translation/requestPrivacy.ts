/**
 * @file src/services/translation/requestPrivacy.ts
 * 文件职责：在后台进程内保留已经确认的私密来源。
 * 主要内容：以不可从 JSON 构造的内部 symbol 附加和读取来源标记，允许内部请求展开保留该标记。
 * 模块边界：只携带来源，不推断浏览器身份，不读配置或凭据；油猴构建使用关闭的 capability 适配器。
 */
const TRUSTED_PRIVATE_SOURCE = Symbol('fluentread.trusted-private-source');

/** 只由后台从原生 sender 派生；公开消息 parser 不采纳该来源。 */
export function attachTrustedPrivateSource<T extends object>(message: T): T {
    return {...message, [TRUSTED_PRIVATE_SOURCE]: true};
}

export function hasTrustedPrivateSource(message: object): boolean {
    return (message as {[TRUSTED_PRIVATE_SOURCE]?: boolean})[TRUSTED_PRIVATE_SOURCE] === true;
}
