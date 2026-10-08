/**
 * @file src/services/translation/documentClient.ts
 * 文件职责：为 Firefox 文本和输入框调用维护真实文档 Port，避免缺 native documentId 时退化为 frame 身份。
 * 主要内容：懒建连接、每个 pending 绑定实际 peer、断连取消等待、只把取消发往对应原连接、丢弃迟到包，并支持页面暂停恢复和失效释放。
 * 模块边界：只转发原生产 start/cancel，不替换 handler 或 provider，不自动重试旧请求；Chrome/有 documentId 的原 runtime 直连兼容路径由 composition 调用保持，userscript 不启用此租约。
 */
import {browserCapabilities} from '@/src/platform/browser/capabilities';
import {nativeDocumentDisconnected, type NativeDocumentPort} from '@/src/platform/browser/documentSession';
import {TRANSLATION_DOCUMENT_PORT, TRANSLATION_DOCUMENT_VERSION, translationDocumentCancelKey, translationDocumentRequestKey} from './documentChannel';
export function createTranslationDocumentClient(connect: () => NativeDocumentPort) {
    let current: NativeDocumentPort | undefined, sequence = 0, phase: 'active' | 'suspended' | 'disposed' = 'active';
    const pending = new Map<string, {port: NativeDocumentPort; key?: string; finish(value?: unknown, error?: unknown): void}>();
    const owners = new Map<string, NativeDocumentPort>();
    const detach = new WeakMap<NativeDocumentPort, () => void>();
    const close = (port: NativeDocumentPort) => {
        detach.get(port)?.(); detach.delete(port); if (current === port) current = undefined;
        for (const request of pending.values()) if (request.port === port) request.finish(undefined, nativeDocumentDisconnected());
    };
    const disconnect = (port: NativeDocumentPort) => {close(port); try {port.disconnect();} catch { /* 原 peer 已关闭。 */ }};
    const ensurePort = () => {
        if (current) return current;
        const port = connect(); current = port;
        const onDisconnect = () => close(port);
        const receive = (packet: any) => {
            if (current !== port || !packet || typeof packet !== 'object') return;
            if (packet.kind === 'ready') {if (packet.version !== TRANSLATION_DOCUMENT_VERSION) disconnect(port);}
            else if (packet.kind === 'result') {
                const request = pending.get(packet.rpcId);
                if (request?.port === port) request.finish(packet.response);
            }
        };
        port.onMessage.addListener(receive); port.onDisconnect.addListener(onDisconnect);
        detach.set(port, () => {port.onMessage.removeListener(receive); port.onDisconnect.removeListener(onDisconnect);});
        return port;
    };
    return {
        request(message: Record<string, unknown>): Promise<unknown> {
            if (phase !== 'active') return Promise.reject(nativeDocumentDisconnected());
            const cancelKey = translationDocumentCancelKey(message);
            const original = cancelKey ? owners.get(cancelKey) : undefined;
            if (cancelKey && !original) return Promise.resolve({success: true, cancelled: false, clientRequestId: message.clientRequestId});
            return new Promise((resolve, reject) => {
                const port = original ?? ensurePort(), rpcId = `request-${++sequence}`, key = cancelKey ? undefined : translationDocumentRequestKey(message);
                if (key && owners.has(key)) {reject(new Error('翻译文档请求 ID 正在使用')); return;}
                const finish = (value?: unknown, error?: unknown) => {
                    pending.delete(rpcId);
                    if (key && owners.get(key) === port) owners.delete(key);
                    if (error !== undefined) reject(error); else resolve(value);
                };
                pending.set(rpcId, {port, key, finish}); if (key) owners.set(key, port);
                try {port.postMessage({kind: 'request', version: TRANSLATION_DOCUMENT_VERSION, rpcId, message});}
                catch (error) {finish(undefined, error); disconnect(port);}
            });
        },
        suspend() {if (phase !== 'disposed') phase = 'suspended'; if (current) disconnect(current);},
        resume() {if (phase !== 'disposed') phase = 'active';},
        dispose() {phase = 'disposed'; if (current) disconnect(current);},
    };
}
const clients = new WeakMap<object, ReturnType<typeof createTranslationDocumentClient>>();
interface TranslationDocumentRuntime {connect(options: {name: string}): NativeDocumentPort; sendMessage(message: unknown): Promise<unknown>}
export function translationDocumentClient(runtime: TranslationDocumentRuntime = browser.runtime) {
    let client = clients.get(runtime);
    if (!client) {
        client = createTranslationDocumentClient(() => runtime.connect({name: TRANSLATION_DOCUMENT_PORT})); clients.set(runtime, client);
        const owned = client;
        // 扩展 document/options 也使用文本 client，但不经过 content composition 的页面生命周期。
        if (typeof window !== 'undefined') {window.addEventListener('pagehide', event => {if (event.isTrusted) owned.suspend();}); window.addEventListener('pageshow', event => {if (event.isTrusted) owned.resume();});}
    }
    return client;
}
export function sendTranslationRuntimeMessage(message: unknown, runtime: TranslationDocumentRuntime = browser.runtime): Promise<unknown> {
    return browserCapabilities.browser === 'firefox' || browserCapabilities.browser === 'thunderbird'
        ? translationDocumentClient(runtime).request(message as Record<string, unknown>) : runtime.sendMessage(message);
}
