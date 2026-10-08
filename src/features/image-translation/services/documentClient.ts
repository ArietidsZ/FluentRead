/**
 * @file src/features/image-translation/services/documentClient.ts
 * 文件职责：在每个内容上下文共享图片文档 Port，隔离取消、进度、结果和短期来源挑战。
 * 主要内容：懒建版本化连接、区分公开任务与 RPC 标识、拒绝重复 pending、按实际 peer 断连清理、同 peer 来源回复及页面暂停恢复。
 * 模块边界：只访问注入 runtime 的连接，不读取图片、不外发网络；重连归属由浏览器新 Port 决定。
 */
import {IMAGE_DOCUMENT_PORT, IMAGE_DOCUMENT_VERSION, type DocumentPort} from '../documentChannel';
import {IMAGE_PROGRESS_MESSAGE_TYPE, isImageTranslationStage, normalizeImageProgress, type ImageTranslationStage} from '../progress';
const validators = new Set<{validate(message: any): unknown; port?: DocumentPort}>();
export function subscribeImageSourceValidation(validate: (message: any) => unknown): () => void {
    const entry = {validate}; validators.add(entry); return () => {validators.delete(entry);};
}
function failure(message: string, name = 'AbortError'): Error {return Object.assign(new Error(message), {name});}
export function createImageDocumentClient(connect: () => DocumentPort) {
    let current: DocumentPort | undefined;
    let sequence = 0;
    let phase: 'active' | 'suspended' | 'disposed' = 'active';
    const detach = new WeakMap<DocumentPort, () => void>();
    const pending = new Map<string, {port: DocumentPort; callerId: string; finish(value?: unknown, error?: unknown): void;
        progress?: (stage: ImageTranslationStage, progress?: number) => void}>();
    const close = (port: DocumentPort, error?: Error) => {
        detach.get(port)?.(); detach.delete(port);
        if (current === port) current = undefined;
        for (const request of pending.values()) if (request.port === port) request.finish(undefined, error ?? new Error('图片文档 message port closed'));
    };
    const disconnectPort = (port: DocumentPort) => {close(port); try {port.disconnect();} catch { /* 原 peer 已关闭。 */ }};
    const suspend = () => {
        const port = current;
        if (port) {close(port, failure('图片文档已暂停或离开')); try {port.disconnect();} catch { /* 离开的 peer 已关闭。 */ }}
    };
    const ensurePort = () => {
        if (current) {for (const entry of validators) entry.port ??= current; return current;}
        const port = connect(); current = port;
        for (const entry of validators) entry.port ??= port;
        const disconnect = () => {
            port.onMessage.removeListener(receive); port.onDisconnect.removeListener(disconnect); close(port);
        };
        const receive = (packet: any) => {
            if (current !== port || !packet || typeof packet !== 'object') return;
            if (packet.kind === 'ready') {
                if (packet.version !== IMAGE_DOCUMENT_VERSION) disconnectPort(port);
            } else if (packet.kind === 'result') {
                const response = packet.response;
                const error = response?.success === false && ['AbortError', 'TimeoutError'].includes(response.errorName)
                    ? failure(response.error, response.errorName) : undefined;
                pending.get(packet.rpcId)?.finish(response, error);
            }
            else if (packet.kind === 'progress') {
                const message = packet.message;
                if (message?.type !== IMAGE_PROGRESS_MESSAGE_TYPE || !isImageTranslationStage(message.stage)) return;
                for (const request of pending.values()) if (request.port === port && request.callerId === message.requestId) {
                    try {request.progress?.(message.stage, normalizeImageProgress(message.progress));} catch { /* 展示失败不改变事务。 */ }
                }
            } else if (packet.kind === 'sourceChallenge') {
                let response: unknown = {valid: false};
                for (const entry of validators) {
                    if (entry.port !== port) continue;
                    try {const candidate = entry.validate(packet.message); if (candidate !== undefined) {response = candidate; break;}} catch { /* 坏校验器不授予来源权限。 */ }
                }
                try {port.postMessage({kind: 'sourceReply', rpcId: packet.rpcId, response});} catch {disconnectPort(port);}
            }
        };
        port.onMessage.addListener(receive); port.onDisconnect.addListener(disconnect);
        detach.set(port, () => {port.onMessage.removeListener(receive); port.onDisconnect.removeListener(disconnect);});
        return port;
    };
    return {
        request(message: Record<string, unknown>, options: {requestId: string; timeoutMs: number; signal?: AbortSignal;
            onProgress?: (stage: ImageTranslationStage, progress?: number) => void}, timeoutMessage: string,
            cancelType = 'fluentReadImageCancel'): Promise<unknown> {
            options = {...options};
            if (phase !== 'active') return Promise.reject(failure('图片文档已暂停或离开'));
            if (options.signal?.aborted) return Promise.reject(failure('图片 OCR 请求已取消'));
            for (const request of pending.values()) if (request.callerId === options.requestId) {
                return Promise.reject(new Error('图片 OCR requestId 正在执行'));
            }
            return new Promise((resolve, reject) => {
                const port = ensurePort(); const rpcId = `request-${++sequence}`;
                const finish = (value?: unknown, error?: unknown) => {
                    if (!pending.delete(rpcId)) return false;
                    clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
                    if (error !== undefined) reject(error); else resolve(value);
                    return true;
                };
                const cancel = () => {
                    try {port.postMessage({kind: 'request', version: IMAGE_DOCUMENT_VERSION, rpcId: `cancel-${++sequence}`,
                        message: {type: cancelType, requestId: options.requestId}});} catch {disconnectPort(port);}
                };
                const abort = () => {if (finish(undefined, failure('图片 OCR 请求已取消'))) cancel();};
                const timer = setTimeout(() => {if (finish(undefined, failure(timeoutMessage, 'TimeoutError'))) cancel();}, options.timeoutMs);
                pending.set(rpcId, {port, callerId: options.requestId, finish, progress: options.onProgress});
                options.signal?.addEventListener('abort', abort, {once: true});
                try {port.postMessage({kind: 'request', version: IMAGE_DOCUMENT_VERSION, rpcId,
                    message: {...message, requestId: options.requestId, timeoutMs: options.timeoutMs}});} catch (error) {finish(undefined, error); disconnectPort(port);}
            });
        },
        reset() {const port = current; if (port) disconnectPort(port);},
        suspend() {if (phase !== 'disposed') phase = 'suspended'; suspend();},
        resume() {if (phase !== 'disposed') phase = 'active';},
        dispose() {phase = 'disposed'; suspend();}
    };
}
const clients = new WeakMap<object, ReturnType<typeof createImageDocumentClient>>();
export function imageDocumentClient() {
    const runtime = browser.runtime;
    let client = clients.get(runtime);
    if (!client) {client = createImageDocumentClient(() => runtime.connect({name: IMAGE_DOCUMENT_PORT})); clients.set(runtime, client);}
    return client;
}
