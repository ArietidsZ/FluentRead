/**
 * @file src/platform/browser/documentSession.ts
 * 文件职责：把后台收到的浏览器原生 Port 转为不可由消息体伪造的文档连接租约。
 * 主要内容：冻结原生 sender、为每次真实连接创建独立身份、通过私有 symbol/WeakSet 复制 capability，断开先撤销再释放所属请求，并只向仍活着的 peer 回复。
 * 模块边界：不解释翻译、配置或 provider，不用 URL、客户端 nonce 或布尔值判断文档；协议白名单、dispatch 与请求取消由注入的服务负责。
 */
import type {BrowserRequestContext} from './requestOwner';
export interface NativeDocumentPort {
    readonly name: string;
    readonly sender?: BrowserRequestContext['sender'];
    postMessage(message: unknown): void;
    disconnect(): void;
    readonly onMessage: {addListener(listener: (packet: any) => void): void; removeListener(listener: (packet: any) => void): void};
    readonly onDisconnect: {addListener(listener: () => void): void; removeListener(listener: () => void): void};
}
interface NativeDocumentSession {readonly ownerKey: string; assertLive(): void;}
const capability = Symbol('native-document-session');
const trusted = new WeakSet<NativeDocumentSession>();
type SessionContext = BrowserRequestContext & {[capability]?: NativeDocumentSession};
export function getNativeDocumentSession(context: BrowserRequestContext): NativeDocumentSession | undefined {
    const session = (context as SessionContext)[capability];
    return session && trusted.has(session) ? session : undefined;
}
export function copyNativeDocumentSession<T extends BrowserRequestContext>(from: BrowserRequestContext, to: T): T {
    const session = getNativeDocumentSession(from);
    return session ? {...to, [capability]: session} : to;
}
export function nativeDocumentDisconnected(): Error {return Object.assign(new Error('翻译文档连接已失效或离开'), {name: 'AbortError'});}
export function assertNativeDocumentContext(context: BrowserRequestContext, required = false): void {
    const session = getNativeDocumentSession(context);
    if (session) session.assertLive();
    else if (required && !(typeof context.sender?.documentId === 'string' && context.sender.documentId)) throw nativeDocumentDisconnected();
}
export function createNativeDocumentPortHandler(options: {
    runtimeId: string; name: string; version: number;
    accepts(message: unknown): message is Record<string, unknown>;
    dispatch(message: Record<string, unknown>, context: BrowserRequestContext): Promise<unknown>;
    releaseOwner(context: BrowserRequestContext): void;
}) {
    const accepted = new WeakSet<NativeDocumentPort>(), sessions = new Set<{context: BrowserRequestContext; close(): void}>();
    const namespace = crypto.randomUUID(); let ownerSequence = 0;
    const connect = (port: NativeDocumentPort): boolean => {
        if (port.name !== options.name) return false;
        if (port.sender?.id !== options.runtimeId) {port.disconnect(); return true;}
        if (accepted.has(port)) return true;
        accepted.add(port);
        let live = true;
        const requests = new Set<string>();
        const sender = port.sender;
        const context: SessionContext = {sender: Object.freeze({...sender, ...(sender.tab ? {tab: Object.freeze({...sender.tab})} : {})})};
        const close = () => {
            if (!live) return;
            live = false; sessions.delete(entry);
            port.onMessage.removeListener(receive); port.onDisconnect.removeListener(close);
            options.releaseOwner(context); requests.clear();
            try {port.disconnect();} catch { /* 原生 peer 已关闭。 */ }
        };
        const session: NativeDocumentSession = Object.freeze({ownerKey: `native-document-port:${namespace}:${++ownerSequence}`,
            assertLive() {if (!live) throw nativeDocumentDisconnected();}});
        trusted.add(session); context[capability] = session; Object.freeze(context);
        const entry = {context, close}; sessions.add(entry);
        const post = (packet: unknown) => {session.assertLive(); try {port.postMessage(packet);} catch (error) {close(); throw error;}};
        const receive = (packet: any) => {
            if (!live || !packet || typeof packet !== 'object' || packet.kind !== 'request' || packet.version !== options.version
                || typeof packet.rpcId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(packet.rpcId)
                || !options.accepts(packet.message) || requests.has(packet.rpcId)) return;
            const rpcId = packet.rpcId; requests.add(rpcId);
            void (async () => {
                let response: unknown;
                try {session.assertLive(); response = await options.dispatch(packet.message, context);}
                catch (error) {response = {success: false, error: error instanceof Error ? error.message : String(error)};}
                try {if (live) post({kind: 'result', rpcId, response});} catch { /* post 已撤销连接。 */ }
                finally {requests.delete(rpcId);}
            })();
        };
        port.onMessage.addListener(receive); port.onDisconnect.addListener(close);
        try {post({kind: 'ready', version: options.version});} catch { /* 握手失败已撤销连接。 */ }
        return true;
    };
    return {connect, releaseTab(tabId: number) {for (const entry of sessions) if (entry.context.sender?.tab?.id === tabId) entry.close();}};
}
