/**
 * @file src/platform/browser/incognitoSource.ts
 * 文件职责：从浏览器 runtime sender 确认请求的私密来源。
 * 主要内容：要求本扩展 sender ID 和原生 tab.incognito 严格为 true；不采用客户端字段或页面 URL。
 * 模块边界：仅处理浏览器提供的消息来源，不查询当前标签页，不读配置，不申请额外权限。
 */
export function isTrustedIncognitoSender(sender: {
    id?: string;
    tab?: {incognito?: boolean};
} | undefined, runtimeId: string | undefined): boolean {
    return Boolean(runtimeId && sender?.id === runtimeId && sender.tab?.incognito === true);
}
