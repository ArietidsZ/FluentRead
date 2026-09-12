/**
 * @file src/features/local-tts/offscreen/tts.ts
 * 文件职责：编排本地 Kokoro TTS 模型缓存、Worker 生命周期、下载状态和合成请求。
 * 主要内容：保证本地 TTS 不会因一次朗读自动下载，串行复用一个模型 Worker，并在取消、超时或空闲时释放资源。
 * 模块边界：只负责扩展自有 Offscreen 运行时，不决定在线/本地策略，也不直接操作网页 UI。
 */

import {
    LOCAL_TTS_MODEL,
    LOCAL_TTS_MODEL_ID,
    LOCAL_TTS_MODEL_DTYPE,
    LOCAL_TTS_MODEL_REVISION,
    LOCAL_TTS_MODEL_STATE_KEY,
    localTtsVoiceForLanguage,
    supportsLocalTtsLanguage,
} from '@/src/core/config/localTts';
import {
    cacheLocalTtsModelFiles,
    isLocalTtsModelCached,
    removeLocalTtsModelFiles,
} from './modelCache';

export const LOCAL_TTS_MODEL_NOT_DOWNLOADED_CODE = 'local-tts-model-not-downloaded' as const;
export const LOCAL_TTS_LANGUAGE_UNSUPPORTED_CODE = 'local-tts-language-unsupported' as const;

export class LocalTtsModelNotDownloadedError extends Error {
    readonly code = LOCAL_TTS_MODEL_NOT_DOWNLOADED_CODE;

    constructor() {
        super('本地 TTS 模型尚未下载，请先在设置中的朗读与语音里下载模型');
        this.name = 'LocalTtsModelNotDownloadedError';
    }
}

export class LocalTtsLanguageUnsupportedError extends Error {
    readonly code = LOCAL_TTS_LANGUAGE_UNSUPPORTED_CODE;

    constructor(language: string) {
        super(`本地 TTS 暂不支持语言：${language || '未知语言'}`);
        this.name = 'LocalTtsLanguageUnsupportedError';
    }
}

export interface LocalTtsAudio {
    readonly audio: ArrayBuffer;
    readonly contentType: 'audio/wav';
    readonly voice: string;
    readonly backend?: 'webgpu' | 'wasm';
}

type LocalTtsWorkerBackend = 'webgpu' | 'wasm';

interface WorkerRequest {
    requestId: number;
    type: 'prepare' | 'synthesize' | 'dispose';
    text?: string;
    voice?: string;
    speed?: number;
}

interface WorkerResponse {
    requestId: number;
    success: boolean;
    audio?: ArrayBuffer;
    samplingRate?: number;
    backend?: LocalTtsWorkerBackend;
    error?: string;
}

interface PendingWorkerRequest {
    resolve: (response: WorkerResponse) => void;
    reject: (error: unknown) => void;
    timeout: number;
    signal?: AbortSignal;
    onAbort?: () => void;
}

const SYNTHESIS_TIMEOUT_MS = 120_000;
const MODEL_IDLE_DISPOSE_MS = 30_000;

let worker: Worker | null = null;
let workerRequestId = 0;
let pendingRequests = new Map<number, PendingWorkerRequest>();
let idleDisposeTimer: number | undefined;
let workerQueue: Promise<void> = Promise.resolve();

function toError(value: unknown, fallback: string): Error {
    return value instanceof Error ? value : new Error(typeof value === 'string' ? value : fallback);
}

function createAbortError(): Error {
    const error = new Error('本地 TTS 请求已取消');
    error.name = 'AbortError';
    return error;
}

function clearIdleDispose(): void {
    if (idleDisposeTimer !== undefined) {
        window.clearTimeout(idleDisposeTimer);
        idleDisposeTimer = undefined;
    }
}

function scheduleIdleDispose(): void {
    clearIdleDispose();
    idleDisposeTimer = window.setTimeout(() => {
        idleDisposeTimer = undefined;
        if (pendingRequests.size === 0) terminateWorker();
    }, MODEL_IDLE_DISPOSE_MS);
}

function rejectPending(error: Error): void {
    for (const [requestId, pending] of pendingRequests) {
        window.clearTimeout(pending.timeout);
        if (pending.signal && pending.onAbort) pending.signal.removeEventListener('abort', pending.onAbort);
        pending.reject(error);
        pendingRequests.delete(requestId);
    }
}

function terminateWorker(error?: Error): void {
    clearIdleDispose();
    const current = worker;
    worker = null;
    current?.terminate();
    if (error) rejectPending(error);
}

function getWorker(): Worker {
    if (worker) return worker;
    const getUrl = (globalThis as typeof globalThis & {
        chrome?: {runtime?: {getURL?: (value: string) => string}};
    }).chrome?.runtime?.getURL;
    const workerUrl = getUrl?.('localTtsWorker.js')
        || new URL('localTtsWorker.js', window.location.href).toString();
    const next = new Worker(workerUrl, {type: 'module'});
    next.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        const pending = response && pendingRequests.get(response.requestId);
        if (!pending) return;
        pendingRequests.delete(response.requestId);
        window.clearTimeout(pending.timeout);
        if (pending.signal && pending.onAbort) pending.signal.removeEventListener('abort', pending.onAbort);
        if (response.success) pending.resolve(response);
        else pending.reject(new Error(response.error || '本地 TTS Worker 失败'));
    };
    next.onerror = (event) => {
        terminateWorker(new Error(event.message || '本地 TTS Worker 已停止'));
    };
    worker = next;
    return next;
}

function requestWorker(
    message: Omit<WorkerRequest, 'requestId'>,
    timeoutMs: number,
    signal?: AbortSignal,
): Promise<WorkerResponse> {
    clearIdleDispose();
    const currentWorker = getWorker();
    const requestId = ++workerRequestId;
    return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => {
            terminateWorker(new Error(`本地 TTS Worker 超过 ${timeoutMs / 1000} 秒，已终止以保护浏览器性能`));
        }, timeoutMs);
        const onAbort = () => terminateWorker(createAbortError());
        pendingRequests.set(requestId, {resolve, reject, timeout, signal, onAbort});
        if (signal?.aborted) {
            onAbort();
            return;
        }
        signal?.addEventListener('abort', onAbort, {once: true});
        try {
            currentWorker.postMessage({requestId, ...message});
        } catch (error) {
            window.clearTimeout(timeout);
            if (signal) signal.removeEventListener('abort', onAbort);
            pendingRequests.delete(requestId);
            const workerError = toError(error, '无法启动本地 TTS Worker');
            terminateWorker(workerError);
            reject(workerError);
        }
    });
}

function runSerial<T>(operation: () => Promise<T>): Promise<T> {
    const run = workerQueue.then(operation, operation);
    workerQueue = run.then(() => undefined, () => undefined);
    return run;
}

export async function prepareLocalTtsModel(_keepWarm = false): Promise<{
    model: typeof LOCAL_TTS_MODEL_ID;
    dtype: typeof LOCAL_TTS_MODEL_DTYPE;
    revision: typeof LOCAL_TTS_MODEL_REVISION;
    warm: boolean;
    backend?: LocalTtsWorkerBackend;
}> {
    await cacheLocalTtsModelFiles();
    if (!(await isLocalTtsModelCached())) throw new Error('本地 TTS 模型缓存不完整');
    return {
        model: LOCAL_TTS_MODEL_ID,
        dtype: LOCAL_TTS_MODEL_DTYPE,
        revision: LOCAL_TTS_MODEL_REVISION,
        // 设置页的下载动作只确认文件完整性；首次真正朗读时再加载推理 Worker。
        warm: false,
    };
}

export async function getLocalTtsModelStatus(): Promise<{
    models: Array<{
        model: typeof LOCAL_TTS_MODEL_ID;
        downloaded: boolean;
        downloadSizeMb: number;
        dtype: typeof LOCAL_TTS_MODEL_DTYPE;
        revision: typeof LOCAL_TTS_MODEL_REVISION;
    }>;
}> {
    return {
        models: [{
            model: LOCAL_TTS_MODEL_ID,
            downloaded: await isLocalTtsModelCached(),
            downloadSizeMb: LOCAL_TTS_MODEL.downloadSizeMb,
            dtype: LOCAL_TTS_MODEL_DTYPE,
            revision: LOCAL_TTS_MODEL_REVISION,
        }],
    };
}

export async function synthesizeLocalTts(
    text: string,
    language: string,
    preferredVoice: unknown,
    signal?: AbortSignal,
): Promise<LocalTtsAudio> {
    if (!supportsLocalTtsLanguage(language)) throw new LocalTtsLanguageUnsupportedError(language);
    if (!(await isLocalTtsModelCached())) throw new LocalTtsModelNotDownloadedError();
    if (signal?.aborted) throw createAbortError();

    const voice = localTtsVoiceForLanguage(language, preferredVoice);
    const response = await runSerial(() => requestWorker({
        type: 'synthesize',
        text,
        voice,
        speed: 1,
    }, SYNTHESIS_TIMEOUT_MS, signal));
    if (!response.audio) throw new Error('本地 TTS 未返回音频');
    scheduleIdleDispose();
    return {
        audio: response.audio,
        contentType: 'audio/wav',
        voice,
        backend: response.backend,
    };
}

export async function removeLocalTtsModel(): Promise<void> {
    if (pendingRequests.size > 0) throw new Error('本地 TTS 正在运行，请完成后再清除模型');
    terminateWorker();
    await removeLocalTtsModelFiles();
}

export function disposeLocalTtsWorker(): void {
    terminateWorker();
}

export {LOCAL_TTS_MODEL_STATE_KEY};
