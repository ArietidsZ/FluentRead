/**
 * @file src/features/image-translation/background/documentSession.ts
 * 文件职责：把浏览器接收的真实图片文档 Port 绑定到后台私有归属和来源核验生命周期。
 * 主要内容：验证扩展 sender、冻结发送者、隔离每个 Port 的请求与挑战、断开前撤销 capability，保留同连接进度和结果。
 * 模块边界：仅编排注入端口和处理器，不查最新 tab/frame，不接受消息体身份，不访问配置或 OCR。
 */
import type {BrowserRequestContext} from '@/src/platform/browser/requestOwner';
import {IMAGE_DOCUMENT_PORT, IMAGE_DOCUMENT_VERSION, isImageDocumentOperation, type DocumentPort, type SourceChallenge} from '../documentChannel';

interface DocumentSession {
    readonly ownerKey: string;
    assertLive(): void;
    post(message: unknown): void;
    challenge(message: SourceChallenge, signal: AbortSignal, timeoutMs: number): Promise<unknown>;
    revoke(): void;
}
const capability = Symbol('image-document-session');
const trusted = new WeakSet<DocumentSession>();
type SessionContext = BrowserRequestContext & {[capability]?: DocumentSession};
export function getImageDocumentSession(context: BrowserRequestContext): DocumentSession | undefined {
    const session = (context as SessionContext)[capability];
    return session && trusted.has(session) ? session : undefined;
}
export function copyImageDocumentSession<T extends BrowserRequestContext>(from: BrowserRequestContext, to: T): T {
    const session = getImageDocumentSession(from);
    return session ? {...to, [capability]: session} : to;
}
export function assertImageDocumentContext(context: BrowserRequestContext, required = false): void {
    const session = getImageDocumentSession(context);
    if (session) session.assertLive();
    else if (required && !context.sender?.documentId) throw new Error('图片文档连接已失效，请刷新页面后重试');
}
function disconnected(): Error {return Object.assign(new Error('图片文档连接中断，请重试'), {name: 'AbortError'});}

export function createImageDocumentPortHandler(options: {
    runtimeId: string;
    dispatch(message: Record<string, unknown> & {type: string}, context: BrowserRequestContext): Promise<unknown>;
    releaseOwner(context: BrowserRequestContext): void;
}) {
    const accepted = new WeakSet<DocumentPort>();
    const namespace = crypto.randomUUID();
    let ownerSequence = 0;
    const sessions = new Set<{context: BrowserRequestContext; session: DocumentSession}>();
    const connect = (port: DocumentPort): boolean => {
        if (port.name !== IMAGE_DOCUMENT_PORT) return false;
        if (port.sender?.id !== options.runtimeId) {port.disconnect(); return true;}
        if (accepted.has(port)) return true;
        accepted.add(port);
        let live = true;
        let sequence = 0;
        const requests = new Set<string>();
        const challenges = new Map<string, {finish(value: unknown, error?: Error): void}>();
        const sender = port.sender;
        const context: SessionContext = {sender: Object.freeze({...sender,
            ...(sender.tab ? {tab: Object.freeze({...sender.tab})} : {})})};
        const close = () => {
            if (!live) return;
            live = false; sessions.delete(entry);
            port.onMessage.removeListener(receive); port.onDisconnect.removeListener(close);
            options.releaseOwner(context);
            for (const pending of challenges.values()) pending.finish(undefined, disconnected());
            requests.clear();
            try {port.disconnect();} catch { /* 浏览器已关闭 peer 时无需再次断开。 */ }
        };
        const post = (message: unknown) => {
            session.assertLive();
            try {port.postMessage(message);} catch (error) {close(); throw error;}
        };
        const session: DocumentSession = {
            ownerKey: `image-port:${namespace}:${++ownerSequence}`,
            assertLive() {if (!live) throw disconnected();},
            post,
            revoke: close,
            challenge(message, signal, timeoutMs) {
                return new Promise((resolve, reject) => {
                    session.assertLive();
                    if (signal.aborted) {reject(disconnected()); return;}
                    const rpcId = `source-${++sequence}`;
                    const finish = (value: unknown, error?: Error) => {
                        if (!challenges.delete(rpcId)) return;
                        clearTimeout(timer); signal.removeEventListener('abort', abort);
                        if (error) reject(error); else resolve(value);
                    };
                    const abort = () => finish(undefined, disconnected());
                    const timer = setTimeout(abort, timeoutMs);
                    challenges.set(rpcId, {finish}); signal.addEventListener('abort', abort, {once: true});
                    try {post({kind: 'sourceChallenge', rpcId, message});} catch {abort();}
                });
            },
        };
        Object.freeze(session); trusted.add(session); context[capability] = session; Object.freeze(context);
        const entry = {context, session}; sessions.add(entry);
        const receive = (packet: any) => {
            if (!live || !packet || typeof packet !== 'object') return;
            if (packet.kind === 'sourceReply') {challenges.get(packet.rpcId)?.finish(packet.response); return;}
            if (packet.kind !== 'request' || packet.version !== IMAGE_DOCUMENT_VERSION
                || typeof packet.rpcId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(packet.rpcId)
                || !packet.message || !isImageDocumentOperation(packet.message.type) || requests.has(packet.rpcId)) return;
            const rpcId = packet.rpcId; requests.add(rpcId);
            void (async () => {
                let response: unknown;
                try {session.assertLive(); response = await options.dispatch(packet.message, context);}
                catch (error) {response = {success: false, error: error instanceof Error ? error.message : String(error),
                    ...(error instanceof Error ? {errorName: error.name} : {}),
                    ...(error && typeof error === 'object' && 'errorCode' in error ? {errorCode: error.errorCode} : {})};}
                try {if (live) post({kind: 'result', rpcId, response});} catch { /* post 已撤销该连接。 */ }
                finally {requests.delete(rpcId);}
            })();
        };
        port.onMessage.addListener(receive); port.onDisconnect.addListener(close);
        try {post({kind: 'ready', version: IMAGE_DOCUMENT_VERSION});} catch { /* 握手失败已关闭连接。 */ }
        return true;
    };
    return {connect, releaseTab(tabId: number) {
        for (const entry of sessions) if (entry.context.sender?.tab?.id === tabId) entry.session.revoke();
    }};
}
