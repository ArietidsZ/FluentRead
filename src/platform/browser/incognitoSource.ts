/**
 * @file src/platform/browser/incognitoSource.ts
 * 文件职责：从浏览器 runtime sender 确认请求的私密来源。
 * 主要内容：优先采用本扩展原生 tab.incognito；无 tab 时按原始 documentId 精确查询扩展上下文，校验归属、唯一性与布尔值，保守处理 spanning 的 popup/side panel。
 * 模块边界：每次请求独立解析 regular/private/unknown，不把 URL 当私密证据，不查询当前标签页，不读配置或申请额外权限。
 */
export type NativeSourcePrivacy = 'regular' | 'private' | 'unknown';
export interface NativeMessageSender {
    id?: string;
    url?: string;
    origin?: string;
    documentId?: string;
    frameId?: number;
    tab?: {id?: number; incognito?: boolean};
}
export interface IncognitoSourceRuntime {
    id?: string;
    getURL(path: string): string;
    getContexts?: (filter: {documentIds: string[]}) => Promise<unknown>;
}

function extensionOrigin(value: string): string | undefined {
    try {
        const url = new URL(value);
        if (!['chrome-extension:', 'moz-extension:', 'safari-web-extension:'].includes(url.protocol)
            || !url.host || url.username || url.password) return undefined;
        return `${url.protocol}//${url.host}`;
    } catch {return undefined;}
}

/** 原始 sender 的 documentId 只在本次请求使用；没有精确来源证据就保持 unknown。 */
export async function resolveNativeSourcePrivacy(
    sender: NativeMessageSender | undefined,
    runtime: IncognitoSourceRuntime,
): Promise<NativeSourcePrivacy> {
    if (!runtime.id || !sender || sender.id !== runtime.id) return 'unknown';
    if (sender.tab !== undefined) {
        return typeof sender.tab?.incognito === 'boolean' ? sender.tab.incognito ? 'private' : 'regular' : 'unknown';
    }
    const {documentId, url, origin, frameId} = sender;
    if (typeof documentId !== 'string' || !documentId || documentId.trim() !== documentId
        || typeof runtime.getContexts !== 'function') return 'unknown';
    try {
        const ownOrigin = extensionOrigin(runtime.getURL('/'));
        if (!ownOrigin || (origin !== undefined && origin !== ownOrigin)
            || (url !== undefined && extensionOrigin(url) !== ownOrigin)) return 'unknown';
        const records = await runtime.getContexts({documentIds: [documentId]});
        if (!Array.isArray(records) || records.some(record => !record || typeof record !== 'object' || Array.isArray(record))) return 'unknown';
        const matches = records.filter(record => record.documentId === documentId);
        if (matches.length !== 1) return 'unknown';
        const record = matches[0];
        if (typeof record.contextId !== 'string' || !record.contextId
            || !['TAB', 'POPUP', 'SIDE_PANEL'].includes(record.contextType)
            || typeof record.incognito !== 'boolean'
            || record.documentOrigin !== ownOrigin
            || typeof record.documentUrl !== 'string' || extensionOrigin(record.documentUrl) !== ownOrigin
            || (url !== undefined && record.documentUrl !== url)
            || (frameId !== undefined && record.frameId !== frameId)) return 'unknown';
        // Chrome spanning 的私密窗口 popup/side panel 可使用 ordinary profile，false 不能证明用户来源。
        if (!record.incognito && record.contextType !== 'TAB') return 'unknown';
        return record.incognito ? 'private' : 'regular';
    } catch {return 'unknown';}
}

export function isTrustedIncognitoSender(sender: {
    id?: string;
    tab?: {incognito?: boolean};
} | undefined, runtimeId: string | undefined): boolean {
    return Boolean(runtimeId && sender?.id === runtimeId && sender.tab?.incognito === true);
}
