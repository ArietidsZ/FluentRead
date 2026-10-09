/**
 * @file src/features/information-highlight/offscreen/runtime.ts
 * 文件职责：在共享离屏文档看守信息高亮模型下载、独立评分 Worker 和有界暖机复用。
 * 主要内容：显式准备才下载、状态读缓存、不偷偷补文件、串行公平排队、共享资源预算、立即取消等待及短收尾看守、180 秒空闲释放。
 * 模块边界：不访问宿主 DOM、不持有页面偏好、不另建 offscreen 文档；仅消费固定模型清单与 platform 缓存。
 */
import {INFORMATION_HIGHLIGHT_MODEL_BYTES, INFORMATION_HIGHLIGHT_MODEL_NAME} from '@/src/core/config/informationHighlightModel';
import {withLocalInferenceBudget} from '@/src/shared/onnx/resources';
import {informationHighlightArtifacts, informationHighlightArtifactStore} from './artifacts';
import type {InformationHighlightModelStatus, InformationHighlightResult} from '../protocol';
import type {InformationHighlightWorkerRequest, InformationHighlightWorkerResponse} from './worker';
export interface InformationHighlightCapability {supported: boolean; reason?: string}
export async function probeInformationHighlightWebGpu(): Promise<InformationHighlightCapability> {
    const gpu = (navigator as unknown as {gpu?: {requestAdapter(): Promise<{features: ReadonlySet<string>} | null>}}).gpu;
    if (!gpu) return {supported: false, reason: 'INFORMATION_HIGHLIGHT_WEBGPU_UNAVAILABLE'};
    try {
        const adapter = await gpu.requestAdapter();
        return adapter?.features.has('shader-f16') ? {supported: true} : {supported: false, reason: 'INFORMATION_HIGHLIGHT_F16_UNAVAILABLE'};
    } catch {return {supported: false, reason: 'INFORMATION_HIGHLIGHT_WEBGPU_UNAVAILABLE'};}
}
export interface InformationHighlightRuntimeDependencies {
    store: typeof informationHighlightArtifactStore;
    createWorker(): Worker;
    probe(): Promise<InformationHighlightCapability>;
    notify(progress?: {loaded: number; total: number}): void;
    budget: typeof withLocalInferenceBudget;
}
export function createInformationHighlightModelRuntime(dependencies: InformationHighlightRuntimeDependencies) {
    let phase: InformationHighlightModelStatus['phase'] = 'absent', errorCode: string | undefined;
    let capability: Promise<InformationHighlightCapability> | undefined;
    let job: {controller: AbortController; done: Promise<void>} | undefined;
    let removing = false, worker: Worker | undefined, initialized = false, sequence = 0, generation = 0;
    let tail: Promise<void> = Promise.resolve(), warmTimer: ReturnType<typeof setTimeout> | undefined;
    let fileSnapshot: Promise<Array<{complete: boolean; bytes: number}>> | undefined, snapshotAt = 0;
    let pending: {reject(error: Error): void} | undefined;
    const abortError = () => new DOMException('信息高亮已取消', 'AbortError');
    const support = () => capability ??= dependencies.probe();
    const stop = () => {clearTimeout(warmTimer); generation++; const current = worker; worker = undefined; initialized = false; current?.terminate(); pending?.reject(abortError());};
    const status = async (): Promise<InformationHighlightModelStatus> => {
        // 就绪文件变化只发生在显式管理动作或外部驱逐；冷加载还会逐块复核，状态轮询不重读整套权重。
        if (!fileSnapshot || Date.now() - snapshotAt >= (phase === 'ready' ? 60_000 : 1_000)) {
            snapshotAt = Date.now();
            fileSnapshot = Promise.all(informationHighlightArtifacts.map(async file => {
                const complete = await dependencies.store.complete(file);
                return {complete, bytes: complete ? file.size : await dependencies.store.downloaded(file)};
            })).catch(error => {fileSnapshot = undefined; throw error;});
        }
        const files = await fileSnapshot;
        const downloaded = files.every(file => file.complete), downloadedBytes = files.reduce((sum, file) => sum + file.bytes, 0);
        if (!job && !removing && phase !== 'error') phase = downloaded ? 'ready' : downloadedBytes ? 'paused' : 'absent';
        return {phase: removing ? 'removing' : phase, downloaded, initialized, downloadedBytes, totalBytes: INFORMATION_HIGHLIGHT_MODEL_BYTES, downloadSizeBytes: INFORMATION_HIGHLIGHT_MODEL_BYTES, modelName: INFORMATION_HIGHLIGHT_MODEL_NAME, ...await support(), ...(errorCode ? {errorCode} : {})};
    };
    const prepare = async () => {
        const current = await status();
        if (!current.supported) throw new Error(current.reason);
        if (removing) throw new Error('INFORMATION_HIGHLIGHT_REMOVING');
        if (current.downloaded || job) return current;
        const controller = new AbortController(); phase = 'queued'; errorCode = undefined;
        const run = async () => {
            const bytes = new Map<string, number>();
            try {
                const quota = await navigator.storage?.estimate?.();
                if (quota?.quota && quota.quota - (quota.usage || 0) < current.totalBytes - current.downloadedBytes + 32 * 1024 * 1024) throw new DOMException('模型存储空间不足', 'QuotaExceededError');
                for (const file of informationHighlightArtifacts) bytes.set(file.url, await dependencies.store.downloaded(file));
                for (const file of informationHighlightArtifacts) {
                    phase = 'downloading';
                    await dependencies.store.download(file, controller.signal, (loaded, verifying) => {
                        bytes.set(file.url, loaded); phase = verifying ? 'verifying' : 'downloading';
                        fileSnapshot = undefined;
                        dependencies.notify({loaded: [...bytes.values()].reduce((sum, value) => sum + value, 0), total: INFORMATION_HIGHLIGHT_MODEL_BYTES});
                    });
                }
                phase = 'ready';
            } catch (error) {
                phase = controller.signal.aborted ? 'paused' : 'error';
                errorCode = controller.signal.aborted ? undefined : error instanceof Error ? error.message : 'INFORMATION_HIGHLIGHT_DOWNLOAD_FAILED';
            } finally {if (job?.controller === controller) job = undefined; fileSnapshot = undefined; dependencies.notify();}
        };
        job = {controller, done: Promise.resolve().then(run)};
        return {...current, phase: 'queued' as const};
    };
    const pause = async () => {job?.controller.abort(); if (job) phase = 'paused'; return status();};
    const remove = async () => {
        if (removing) return status();
        removing = true; phase = 'removing'; job?.controller.abort();
        try {await job?.done; stop(); for (const file of informationHighlightArtifacts) await dependencies.store.remove(file); phase = 'absent'; errorCode = undefined;}
        catch (error) {phase = 'error'; errorCode = error instanceof Error ? error.message : 'INFORMATION_HIGHLIGHT_REMOVE_FAILED'; throw error;}
        finally {removing = false; fileSnapshot = undefined;}
        return status();
    };
    const attempt = (text: string, signal: AbortSignal): Promise<InformationHighlightResult> => {
        if (signal.aborted) return Promise.reject(abortError());
        clearTimeout(warmTimer); const current = worker ??= dependencies.createWorker(), requestId = ++sequence;
        return new Promise((resolve, reject) => {
            let drain: ReturnType<typeof setTimeout> | undefined, settled = false, initializing = !initialized;
            let timer: ReturnType<typeof setTimeout>;
            const watch = (ms: number) => {clearTimeout(timer); timer = setTimeout(() => {finish(new Error('INFORMATION_HIGHLIGHT_TIMEOUT')); stop();}, ms);};
            const finish = (error?: Error, result?: InformationHighlightResult) => {
                if (settled) return; settled = true; clearTimeout(timer); clearTimeout(drain); signal.removeEventListener('abort', cancel);
                current.onmessage = null; current.onerror = null; pending = undefined;
                if (error && !signal.aborted) fileSnapshot = undefined;
                if (worker === current) warmTimer = setTimeout(() => {if (worker === current && !pending) stop();}, 180_000);
                if (signal.aborted) reject(abortError()); else if (error) reject(error); else resolve(result!);
            };
            const cancel = () => {
                try {current.postMessage({type: 'cancel', requestId} satisfies InformationHighlightWorkerRequest);}
                catch {finish(abortError()); stop(); return;}
                // 初始化没有页面推理：保留进行中的暖机，其阶段看守仍限制等待；已开始评分只给一个短块收尾。
                if (!initializing) drain = setTimeout(() => {finish(abortError()); stop();}, 1_500);
            };
            pending = {reject: error => finish(error)};
            current.onmessage = (event: MessageEvent<InformationHighlightWorkerResponse>) => {
                if (worker !== current || event.data?.requestId !== requestId) return;
                const response = event.data; initialized = response.initialized;
                if (response.stage) {initializing = response.stage === 'initializing'; watch(initializing ? 30_000 : 120_000); if (!initializing && signal.aborted) cancel(); return;}
                finish(response.success && response.result ? undefined : new Error(response.error || 'INFORMATION_HIGHLIGHT_FAILED'), response.result);
            };
            current.onerror = event => {if (worker === current) {finish(new Error(event.message)); stop();}};
            signal.addEventListener('abort', cancel, {once: true});
            watch(initializing ? 30_000 : 120_000);
            try {current.postMessage({type: 'score', requestId, text} satisfies InformationHighlightWorkerRequest);}
            catch (error) {finish(error instanceof Error ? error : new Error('INFORMATION_HIGHLIGHT_WORKER_FAILED')); stop();}
        });
    };
    const score = (text: string, signal: AbortSignal): Promise<InformationHighlightResult> => {
        const owner = generation;
        const result = tail.then(() => dependencies.budget(async () => {
            if (signal.aborted || owner !== generation) throw abortError();
            const current = await status();
            if (removing) throw new Error('INFORMATION_HIGHLIGHT_REMOVING');
            if (!current.supported) throw new Error(current.reason);
            if (!current.downloaded) throw new Error('INFORMATION_HIGHLIGHT_NOT_DOWNLOADED');
            return attempt(text, signal);
        }, signal));
        tail = result.then(() => undefined, () => undefined);
        return new Promise((resolve, reject) => {
            const abort = () => reject(abortError()); signal.addEventListener('abort', abort, {once: true});
            if (signal.aborted) abort();
            void result.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
        });
    };
    return {status, prepare, pause, remove, score, dispose: () => {job?.controller.abort(); stop();}};
}
