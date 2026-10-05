/**
 * @file src/features/local-tts/offscreen/tts.worker.ts
 * 文件职责：在独立 Worker 中加载并运行 Kokoro v1.1 中文 TTS，避免推理阻塞 Offscreen DOM。
 * 主要内容：固定模型版本、默认要求 WebGPU 加速（部分算子仍由 CPU 执行）与显式兼容回退、串行合成、句段流式生成和直接分块 WAV 编码；只读取来源匹配的固定版本缓存，不额外保存 main 副本。
 * 模块边界：只运行本地模型，不访问配置、网页、标签页或直接播放 Audio。
 */

import {KokoroTTS, TextSplitterStream, env as kokoroEnv} from '@uzen/kokoro-js';
import {env as kokoroTransformersEnv} from '@huggingface/transformers-kokoro';
import {
    LOCAL_TTS_MODEL_DTYPE,
    normalizeLocalTtsExecution,
    type LocalTtsExecution,
    LOCAL_TTS_MODEL_FILE_NAME,
    LOCAL_TTS_MODEL_REPOSITORY,
    LOCAL_TTS_MODEL_REVISION,
    LOCAL_TTS_VOICE_PATH,
} from '@/src/core/config/localTts';
import {LOCAL_TTS_MODEL_SOURCE_HEADER, verifyLocalTtsModelResponse} from './modelCache';
import {configureOnnxWasmBackend, withCompressedWasmBinary} from '@/src/shared/onnx/wasmBinary';
import {probeWebGpu} from '@/src/shared/onnx/webgpu';
import {protectTtsTokenizer, splitTtsAtWordBoundaries, subdivideTtsChunk, TtsTokenBudgetError} from './textBudget';

type LocalTtsDevice = 'webgpu' | 'wasm';

interface WorkerRequest {
    requestId: number;
    type: 'prepare' | 'synthesize' | 'dispose';
    text?: string;
    voice?: string;
    speed?: number;
    /** 仅供外层 worker 重建流程强制本生命周期使用 WASM。 */
    device?: 'wasm';
    execution?: LocalTtsExecution;
}

interface WorkerResponse {
    requestId: number;
    success: boolean;
    audio?: ArrayBuffer;
    samplingRate?: number;
    backend?: LocalTtsDevice;
    error?: string;
    retryWithCpu?: true;
}

let modelPromise: Promise<KokoroTTS> | null = null;
let modelBackend: LocalTtsDevice | undefined;
let taskQueue: Promise<void> = Promise.resolve();
let fetchPatched = false;
let gpuUnavailable = false;
let cpuLocked = false;
let gpuProbePromise: Promise<boolean> | null = null;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function retryWithCpuError(error: unknown): Error & {retryWithCpu: true} {
    const wrapped = error instanceof Error ? error : new Error(errorMessage(error));
    return Object.assign(wrapped, {retryWithCpu: true as const});
}

function shouldRetryWithCpu(error: unknown): error is {retryWithCpu: true} {
    return typeof error === 'object' && error !== null && (error as {retryWithCpu?: unknown}).retryWithCpu === true;
}

function extensionUrl(path: string): string {
    const getUrl = (globalThis as typeof globalThis & {
        chrome?: {runtime?: {getURL?: (value: string) => string}};
    }).chrome?.runtime?.getURL;
    return getUrl?.(path) || new URL(path, self.location.href).toString();
}

function requestUrl(input: RequestInfo | URL): string {
    return typeof input === 'string'
        ? input
        : input instanceof URL
            ? input.toString()
            : input.url;
}

function modelCacheUrls(url: string): string[] {
    const mainPrefix = `/${LOCAL_TTS_MODEL_REPOSITORY}/resolve/main/`;
    const pinnedPrefix = `/${LOCAL_TTS_MODEL_REPOSITORY}/resolve/${LOCAL_TTS_MODEL_REVISION}/`;
    if (url.includes(mainPrefix)) return [url.replace(mainPrefix, pinnedPrefix), url];
    if (url.includes(pinnedPrefix)) return [url, url.replace(pinnedPrefix, mainPrefix)];
    return [];
}

async function localCacheFetch(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    nativeFetch: typeof fetch,
): Promise<Response> {
    const url = requestUrl(input);
    if (!url.includes(`/${LOCAL_TTS_MODEL_REPOSITORY}/resolve/`)) return nativeFetch(input, init);
    const isVoiceFile = url.startsWith(`${LOCAL_TTS_VOICE_PATH}/`);
    if (typeof caches === 'undefined') throw new Error('本地 TTS 缓存不可用');

    const cache = await caches.open(isVoiceFile ? 'kokoro-voices' : 'transformers-cache');
    const urls = isVoiceFile ? [url] : modelCacheUrls(url);
    let verificationError: unknown;
    for (const cacheUrl of urls) {
        const cached = await cache.match(cacheUrl);
        if (!cached) continue;
        if (isVoiceFile || cached.ok && cached.headers.get(LOCAL_TTS_MODEL_SOURCE_HEADER) === urls[0]) return cached;
        const verified = verifyLocalTtsModelResponse(urls[0], cached);
        if (!verified) continue;
        // Select before exposing bytes so a corrupt pinned entry cannot hide valid main.
        // This bounded extra read is only needed when migration could not persist provenance.
        try {
            await verified.response.body!.pipeTo(new WritableStream({write() {}}));
        } catch (error) {verificationError = error;}
        finally {verified.abort(); await verified.completed.catch(() => undefined);}
        if (!verified.verified()) continue;
        const selected = await cache.match(cacheUrl);
        const checked = selected && verifyLocalTtsModelResponse(urls[0], selected);
        if (checked) return checked.response;
    }
    if (verificationError) throw verificationError;
    throw new Error(`本地 TTS 缓存缺少模型文件：${url}`);
}

/** @remarks @uzen/kokoro-js 没有 revision 参数；模型 URL 只允许读取固定版本的本地缓存。 */
function installLocalOnlyFetch(): void {
    if (fetchPatched) return;
    fetchPatched = true;
    const nativeFetch = globalThis.fetch.bind(globalThis);
    const offlineFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => localCacheFetch(input, init, nativeFetch);
    globalThis.fetch = offlineFetch as typeof fetch;
    kokoroTransformersEnv.fetch = offlineFetch;
}

function configureRuntime(): void {
    installLocalOnlyFetch();
    kokoroEnv.allowLocalModels = false;
    kokoroTransformersEnv.allowLocalModels = false;
    // offlineFetch 直接读取固定版本缓存；禁止 Transformers.js 再按 main 写入第二份模型。
    kokoroTransformersEnv.allowRemoteModels = true;
    kokoroTransformersEnv.useBrowserCache = false;
    // MV3 extension CSP rejects the blob URL generated by the WASM factory
    // pre-cache path; keep the MJS static and inject the packaged CPU/WebGPU WASM binary.
    kokoroTransformersEnv.useWasmCache = false;
    if (kokoroTransformersEnv.backends.onnx.wasm) {
        kokoroTransformersEnv.backends.onnx.wasm.numThreads = 1;
        configureOnnxWasmBackend(kokoroTransformersEnv.backends.onnx.wasm, {
            mjs: extensionUrl('fluent-read-ai/tts-ort-wasm-simd-threaded.asyncify.mjs'),
            wasm: extensionUrl('fluent-read-ai/tts-ort-wasm-simd-threaded.asyncify.wasm'),
        });
    }
    kokoroEnv.wasmPaths = {
        mjs: extensionUrl('fluent-read-ai/tts-ort-wasm-simd-threaded.asyncify.mjs'),
        wasm: extensionUrl('fluent-read-ai/tts-ort-wasm-simd-threaded.asyncify.wasm'),
    };
}

async function createModel(device: LocalTtsDevice): Promise<KokoroTTS> {
    configureRuntime();
    const create = async () => {
        const loaded = await KokoroTTS.from_pretrained(LOCAL_TTS_MODEL_REPOSITORY, {
            dtype: LOCAL_TTS_MODEL_DTYPE,
            device,
            model_file_name: LOCAL_TTS_MODEL_FILE_NAME,
            voicePath: LOCAL_TTS_VOICE_PATH,
        });
        // 原生factory设置固定voicePath；公开constructor复用同一模型并注入有界tokenizer。
        return new KokoroTTS(loaded.model, protectTtsTokenizer(loaded.tokenizer));
    };
    const wasm = kokoroTransformersEnv.backends.onnx.wasm;
    return wasm
        ? withCompressedWasmBinary(wasm, extensionUrl('fluent-read-ai/tts-ort-wasm-simd-threaded.asyncify.wasm'), create)
        : create();
}

async function hasUsableWebGpu(): Promise<boolean> {
    if (cpuLocked || gpuUnavailable) return false;
    if (!gpuProbePromise) {
        gpuProbePromise = probeWebGpu()
            .then((result) => result.available)
            .catch(() => false);
    }
    return gpuProbePromise;
}

function loadModel(device: LocalTtsDevice): Promise<KokoroTTS> {
    const loading = createModel(device)
        .then((model) => {
            modelBackend = device;
            return model;
        });
    let settled!: Promise<KokoroTTS>;
    settled = loading
        .catch((error) => {
            if (modelPromise === settled) modelPromise = null;
            modelBackend = undefined;
            throw error;
        });
    modelPromise = settled;
    return settled;
}

async function getModel(execution: LocalTtsExecution): Promise<KokoroTTS> {
    const requiredGpu = execution === 'gpu';
    if (modelPromise) {
        if (requiredGpu && modelBackend !== 'webgpu') throw new Error('本地 TTS GPU 会话不可用，请重试');
        return modelPromise;
    }
    const available = await hasUsableWebGpu();
    if (requiredGpu && !available) throw new Error('本地 TTS 需要可用的硬件 GPU；可在设置中明确选择兼容模式');
    const preferred: LocalTtsDevice = available ? 'webgpu' : 'wasm';
    try {
        return await loadModel(preferred);
    } catch (error) {
        if (preferred !== 'webgpu' || requiredGpu) throw error;
        // GPU 初始化可能已污染当前 ORT runtime；外层必须重建 Worker 后再尝试 CPU。
        gpuUnavailable = true;
        throw retryWithCpuError(error);
    }
}

function floatToPcm16(value: number): number {
    const clamped = Math.max(-1, Math.min(1, value));
    return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

function writePcm16(view: DataView, samples: Float32Array, offset: number): void {
    for (let index = 0; index < samples.length; index += 1) {
        view.setInt16(offset + index * 2, floatToPcm16(samples[index]), true);
    }
}

function encodeWav(chunks: readonly Float32Array[], sampleRate: number): ArrayBuffer {
    const dataLength = chunks.reduce((sum,chunk)=>sum+chunk.length,0) * 2;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);
    const writeAscii = (offset: number, value: string) => {
        for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    };
    writeAscii(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(36, 'data');
    view.setUint32(40, dataLength, true);
    let offset = 44;
    for (const chunk of chunks) {
        writePcm16(view, chunk, offset);
        offset += chunk.length * 2;
    }
    return buffer;
}

function validateAudio(chunks: readonly Float32Array[]): void {
    const total = chunks.reduce((sum,chunk)=>sum+chunk.length,0);
    let hasSignal = false;
    let invalidSamples = 0;
    for (const chunk of chunks) for (const sample of chunk) {
        if (!Number.isFinite(sample)) invalidSamples += 1;
        if (sample !== 0) hasSignal = true;
    }
    if (invalidSamples) throw new Error(`本地 TTS 生成了无效音频（${invalidSamples}/${total} 个采样）`);
    if (!hasSignal) throw new Error('本地 TTS 生成了静音音频');
}

async function synthesizeWithModel(
    model: KokoroTTS,
    text: string,
    voice: string,
    speed: number,
): Promise<{audio: ArrayBuffer; samplingRate: number}> {
    const chunks: Float32Array[] = [];
    let samplingRate = 24_000;
    const sentences = new TextSplitterStream();
    sentences.push(text);
    sentences.close();
    for await (const sentence of sentences) {
        const pending = splitTtsAtWordBoundaries(sentence).reverse();
        while (pending.length) {
            const part = pending.pop()!;
            try {
                // 使用公开generate接口；句界已由原生TextSplitterStream处理，避免再次分句。
                const audio = await model.generate(part, {voice: voice as never, speed});
                const samples = audio.audio;
                for (const chunk of samples instanceof Float32Array ? [samples] : samples) chunks.push(chunk.slice());
                samplingRate = audio.sampling_rate;
            } catch (error) {
                if (!(error instanceof TtsTokenBudgetError)) throw error;
                pending.push(...subdivideTtsChunk(part, error).reverse());
                continue;
            }
        }
    }
    validateAudio(chunks);
    return {audio: encodeWav(chunks, samplingRate), samplingRate};
}

async function synthesize(request: WorkerRequest): Promise<{audio: ArrayBuffer; samplingRate: number}> {
    const text = request.text?.trim() || '';
    if (!text) throw new Error('本地 TTS 文本为空');
    const voice = request.voice?.trim() || 'zf_001';
    const speed = typeof request.speed === 'number' && Number.isFinite(request.speed)
        ? Math.min(2, Math.max(0.5, request.speed))
        : 1;
    const model = await getModel(normalizeLocalTtsExecution(request.execution));
    const backend = modelBackend;
    try {
        return await synthesizeWithModel(model, text, voice, speed);
    } catch (error) {
        if (backend !== 'webgpu' || error instanceof TtsTokenBudgetError) throw error;
        // 局部 chunks 只存在于上一次调用的栈中；释放 GPU session 后从整段文本重试一次。
        gpuUnavailable = true;
        await disposeModel();
        if (normalizeLocalTtsExecution(request.execution) === 'gpu') throw error;
        throw retryWithCpuError(error);
    }
}

async function lockCpuForWorker(): Promise<void> {
    cpuLocked = true;
    gpuUnavailable = true;
    if (modelBackend === 'webgpu') await disposeModel();
}

async function disposeModel(): Promise<void> {
    const current = modelPromise;
    modelPromise = null;
    modelBackend = undefined;
    if (!current) return;
    try {
        const model = await current;
        await (model.model as unknown as {dispose?: () => Promise<void> | void}).dispose?.();
    } catch {
        // Worker termination remains the final resource boundary.
    }
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = taskQueue.then(operation, operation);
    taskQueue = run.then(() => undefined, () => undefined);
    return run;
}

function post(response: WorkerResponse): void {
    const workerScope = self as unknown as {postMessage(message: unknown, transfer?: Transferable[]): void};
    if (response.audio) workerScope.postMessage(response, [response.audio]);
    else workerScope.postMessage(response);
}

async function handle(request: WorkerRequest): Promise<void> {
    try {
        const execution = normalizeLocalTtsExecution(request.execution);
        if (request.device === 'wasm') {
            if (execution === 'gpu') throw new Error('本地 TTS GPU 模式不允许 CPU 回退');
            await lockCpuForWorker();
        }
        if (request.type === 'dispose') {
            await disposeModel();
            post({requestId: request.requestId, success: true});
            return;
        }
        if (request.type === 'prepare') {
            await getModel(execution);
            post({requestId: request.requestId, success: true, backend: modelBackend});
            return;
        }
        const result = await synthesize(request);
        post({
            requestId: request.requestId,
            success: true,
            audio: result.audio,
            samplingRate: result.samplingRate,
            backend: modelBackend,
        });
    } catch (error) {
        post({
            requestId: request.requestId,
            success: false,
            error: errorMessage(error),
            ...(shouldRetryWithCpu(error) ? {retryWithCpu: true as const} : {}),
        });
    }
}

export function startLocalTtsWorker(): void {
    self.onmessage = (event: MessageEvent<WorkerRequest>) => {
        const request = event.data;
        if (!request || typeof request.requestId !== 'number' || !['prepare', 'synthesize', 'dispose'].includes(request.type)) return;
        void enqueue(() => handle(request));
    };
}
