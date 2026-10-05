/**
 * @file src/services/translation/privateContext.ts
 * 文件职责：在可信后台入口与翻译服务之间传递浏览器无痕来源。
 * 主要内容：仅为无痕请求以不能由页面 JSON 构造的 Symbol 保存标记，普通请求不增加字段，供异步路由与缓存隔离使用。
 * 模块边界：不读取浏览器 API、不修改全局配置；调用方必须从真实 sender 或浏览器扩展上下文恢复来源。
 */
const PRIVATE_CONTEXT = Symbol('fluentread.translation-private-context');
export function attachPrivateTranslationContext<T extends object>(request: T, privateContext: boolean): T {
    if (privateContext) return Object.assign(request, {[PRIVATE_CONTEXT]: true});
    delete (request as {[PRIVATE_CONTEXT]?: boolean})[PRIVATE_CONTEXT];
    return request;
}
export function isPrivateTranslationContext(request: object): boolean {
    return (request as {[PRIVATE_CONTEXT]?: boolean})[PRIVATE_CONTEXT] === true;
}
