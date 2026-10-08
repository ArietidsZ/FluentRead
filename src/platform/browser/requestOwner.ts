/**
 * @file src/platform/browser/requestOwner.ts
 * 文件职责：从浏览器提供的消息发送者元数据生成后台请求归属键。
 * 主要内容：复用扩展、标签页、frame、document 身份规则；无标签页消息用发送者 URL 区分扩展页面。
 * 模块边界：只接受受信 sender 上下文，不读取消息体、不访问浏览器 API、不管理请求状态。
 */
export interface BrowserRequestContext {
    readonly sender?: {readonly id?: string; readonly url?: string; readonly frameId?: number; readonly documentId?: string;
        readonly tab?: {readonly id?: number; readonly windowId?: number; readonly incognito?: boolean}};
}
export function requestOwnerKey(context: BrowserRequestContext): string {
    const sender = context?.sender;
    const extensionId = typeof sender?.id === 'string' ? sender.id : '';
    const tabId = Number.isSafeInteger(sender?.tab?.id) ? sender!.tab!.id : '-';
    const frameId = Number.isSafeInteger(sender?.frameId) ? sender!.frameId : '-';
    const documentId = typeof sender?.documentId === 'string' ? sender.documentId.slice(0, 128) : '';
    if (tabId !== '-') return `extension:${extensionId}:tab:${tabId}:frame:${frameId}:document:${documentId}`;
    const url = typeof sender?.url === 'string' ? sender.url.slice(0, 512) : '';
    return `extension:${extensionId}:url:${url}:frame:${frameId}:document:${documentId}`;
}
