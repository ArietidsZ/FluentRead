/**
 * @file src/features/image-translation/services/mangaInferenceClient.ts
 * 文件职责：在 Offscreen 外部看守独立漫画推理 Worker，隔离 GPU 初始化挂起与原生推理阻塞。
 * 主要内容：串行请求、真实阶段转发、取消和超时硬终止；GPU 生命周期失败仅重建一次 CPU Worker，复用共享并行预算；空闲端口销毁后释放 Worker，旧消息不能影响新请求。
 * 模块边界：不处理图片像素、不下载模型、不操作宿主页；静态 Worker 只读取同源缓存和包内代码。
 */
import {withLocalInferenceBudget} from '@/src/shared/onnx/resources';
import type {MangaOcrPage} from './mangaBubbles';
export interface MangaPatch {image: Float32Array; mask: Float32Array; width: number; height: number}

export type MangaInferenceProgress = (stage: 'preparing' | 'initializing' | 'recognizing', percent?: number) => void;
export type MangaInferenceRequest = {type: 'prepare-ocr' | 'recognize' | 'prepare-inpaint' | 'inpaint' | 'dispose-ocr' | 'dispose-inpaint'; image?: string; patch?: MangaPatch};
export type MangaInferenceMessage = MangaInferenceRequest & {requestId: number; cpu: boolean};
export interface MangaInferenceResponse {requestId: number; stage?: Parameters<MangaInferenceProgress>[0]; percent?: number; success?: boolean; result?: MangaOcrPage | Float32Array; error?: string}

export function mangaExtensionUrl(path: string): string {
    return typeof chrome === 'undefined' ? new URL(path, self.location.href).href : chrome.runtime.getURL(path);
}

export function createMangaInferenceClient(createWorker: () => Worker) {
    let worker: Worker | undefined, cpu = false, sequence = 0;
    let tail: Promise<void> = Promise.resolve();
    let active: {reject(error: Error): void} | undefined;
    let generation = 0;
    const ports = new Set<string>();
    function terminate() { const current = worker; worker = undefined; current?.terminate(); }
    function attempt<T>(message: MangaInferenceRequest, signal?: AbortSignal, progress?: MangaInferenceProgress): Promise<T> {
        if (signal?.aborted) return Promise.reject(new DOMException('漫画处理已取消', 'AbortError'));
        const current = worker ??= createWorker(), requestId = ++sequence;
        return new Promise<T>((resolve, reject) => {
            let timeout: ReturnType<typeof setTimeout>;
            function watch(ms: number) {
                clearTimeout(timeout);
                timeout = setTimeout(() => finish(new Error('漫画推理超时，已停止以保护浏览器性能'), true), ms);
            }
            function finish(error?: Error, reset = false, result?: T) {
                clearTimeout(timeout); signal?.removeEventListener('abort', abort);
                current.onmessage = null; current.onerror = null; active = undefined;
                if (reset) terminate();
                error ? reject(error) : resolve(result as T);
            }
            const abort = () => finish(new DOMException('漫画处理已取消', 'AbortError'), true);
            active = {reject: error => finish(error, true)};
            current.onmessage = (event: MessageEvent<MangaInferenceResponse>) => {
                if (worker !== current || event.data?.requestId !== requestId) return;
                const response = event.data;
                if (response.stage) {
                    // 下载是网络等待；不能因为大模型超过 15 秒就误判为 GPU 挂起并重复下载。
                    watch(response.stage === 'preparing' ? 120_000 : cpu ? 120_000 : response.stage === 'initializing' ? 15_000 : 60_000);
                    progress?.(response.stage, response.percent); return;
                }
                finish(response.success ? undefined : new Error(response.error || '漫画推理失败'), !response.success, response.result as T);
            };
            current.onerror = event => { if (worker === current) finish(new Error(event.message || '漫画推理 Worker 已停止'), true); };
            signal?.addEventListener('abort', abort, {once: true});
            watch(message.type.startsWith('dispose') ? 10_000 : cpu || message.type.startsWith('prepare') ? 120_000 : 60_000);
            try { current.postMessage({...message, requestId, cpu}); }
            catch (error) { finish(error instanceof Error ? error : new Error(String(error)), true); }
        });
    }
    function request<T>(message: MangaInferenceRequest, signal?: AbortSignal, progress?: MangaInferenceProgress): Promise<T> {
        const owner = generation;
        const result = tail.then(() => withLocalInferenceBudget(async () => {
            if(owner !== generation) throw new DOMException('漫画处理已取消','AbortError');
            try { return await attempt<T>(message, signal, progress); }
            catch (error) {
                if (owner !== generation || cpu || signal?.aborted || message.type.startsWith('dispose')) throw error;
                cpu = true; progress?.('initializing');
                return await attempt<T>(message, signal, progress);
            }
        }, signal));
        tail = result.then(() => undefined, () => undefined);
        if(!signal) return result;
        return new Promise<T>((resolve,reject)=>{
            const abort=()=>reject(new DOMException('漫画处理已取消','AbortError'));
            signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
            void result.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
        });
    }
    return {
        async prepare(kind: 'ocr' | 'inpaint', signal?: AbortSignal, progress?: MangaInferenceProgress) { await request({type: `prepare-${kind}`}, signal, progress); ports.add(kind); },
        request,
        async release(kind: 'ocr' | 'inpaint') { ports.delete(kind); if (worker) await request({type: `dispose-${kind}`}); if (!ports.size) { terminate(); cpu = false; } },
        dispose() { generation++; active?.reject(new DOMException('漫画处理已取消', 'AbortError')); terminate(); ports.clear(); cpu = false; },
    };
}

export const mangaInferenceClient = createMangaInferenceClient(() => new Worker(mangaExtensionUrl('mangaInferenceWorker.js'), {type: 'module'}));
