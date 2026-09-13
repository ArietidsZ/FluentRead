/**
 * @file src/features/video-subtitle/offscreen/transcription.worker.ts
 * 文件职责：运行独立的 Whisper ONNX Worker，复用模型 session 并执行受限时长的本地音频推理。
 * 主要内容：配置 WASM/WebGPU 后端、串行处理 prepare/transcribe/dispose、解析 chunk 时间戳并回传诊断信息。
 * 模块边界：只运行模型与 Worker 消息循环，不访问页面 DOM、后台消息或共享 Offscreen 业务状态。
 */
import { env, InterruptableStoppingCriteria, pipeline, Tensor } from '@huggingface/transformers';
import {
  getVideoLocalTranscriptionModelId,
  normalizeVideoLocalTranscriptionModel,
} from '@/src/features/video-subtitle/transcription';
import {
  VIDEO_AI_MODEL_REMOTE_HOST,
  VIDEO_AI_MODEL_REMOTE_PATH_TEMPLATE,
  cacheVideoAiQ8ModelFiles,
} from './modelCache';
import {parseWhisperChunkTimestamps} from './timestampParser';
import {buildWhisperTranscriptionGenerationOptions, chooseWhisperSourceLanguage, normalizeWhisperSourceLanguage} from './transcriptionOptions';
import {configureOnnxWasmBackend, withCompressedWasmBinary} from '@/src/shared/onnx/wasmBinary';
import {probeWebGpu} from '@/src/shared/onnx/webgpu';

type LocalTranscriber = ((
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<unknown>) & {
  dispose?: () => Promise<void>;
  processor?: (audio: Float32Array) => Promise<Record<string, unknown>>;
  model?: ((inputs: Record<string, unknown>) => Promise<{logits?: {data: ArrayLike<number>; dims?: readonly number[]}}>) & {
    config?: {is_multilingual?: unknown; decoder_start_token_id?: unknown};
    generation_config?: {is_multilingual?: unknown; decoder_start_token_id?: unknown; lang_to_id?: unknown};
  };
};

type LocalTranscriptionBackend = 'webgpu' | 'wasm';

interface LocalVideoTranscriptionSegment {
  startMs: number;
  endMs: number;
  text: string;
}

interface WorkerTranscriptionResult {
  text: string;
  segments: LocalVideoTranscriptionSegment[];
  model: string;
  backend?: LocalTranscriptionBackend;
  gpuInfo?: string;
  inferenceMs?: number;
  audioDurationMs?: number;
  threads?: number;
  dtype?: 'q4' | 'q8';
}

interface WorkerRequest {
  requestId: number;
  type: 'prepare' | 'transcribe';
  model?: unknown;
  sourceLanguage?: string;
  languageSessionKey?: string;
  audio?: Float32Array;
  /** 主线程 Worker 重建后的 CPU 锁定请求，避免再次探测或创建 GPU session。 */
  device?: 'wasm';
}

class WebGpuFallbackError extends Error {
  readonly retryWithCpu = true;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'WebGpuFallbackError';
  }
}

let transcriberPromise: Promise<LocalTranscriber> | null = null;
let transcriberModelId = '';
let transcriberBackend: LocalTranscriptionBackend | '' = '';
let transcriberGpuInfo = '';
let transcriberThreads = 1;
let transcriberDtype: 'q4' | 'q8' | '' = '';
let wasmRuntimeThreads: number | null = null;
let webGpuProbePromise: Promise<{available: boolean; info: string}> | null = null;
let webGpuProbeInfo = '';
let webGpuDisabled = false;
let workerTaskQueue: Promise<void> = Promise.resolve();
const detectedLanguages = new Map<string, string>();
const MAX_DETECTED_LANGUAGE_SESSIONS = 16;

const MAX_WHISPER_AUDIO_SECONDS = 30;
const MAX_REALTIME_INFERENCE_MS = 15_000;
const ENABLE_VIDEO_WHISPER_WEBGPU = true;

function configureEnvironment(): void {
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.remoteHost = VIDEO_AI_MODEL_REMOTE_HOST;
env.remotePathTemplate = VIDEO_AI_MODEL_REMOTE_PATH_TEMPLATE;

if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
  // Dedicated worker 已经是隔离执行上下文；proxy worker 在扩展页面中
  // 反而会触发 extension:// WASM 加载失败，因此保持关闭。
  configureOnnxWasmBackend(env.backends.onnx.wasm, {
    mjs: extensionUrl('fluent-read-ai/ort-wasm-simd-threaded.jsep.mjs'),
    wasm: extensionUrl('fluent-read-ai/ort-wasm-simd-threaded.jsep.wasm.gz'),
  });
}

}

function extensionUrl(path: string): string {
  const getUrl = (globalThis as typeof globalThis & {
    chrome?: {runtime?: {getURL?: (value: string) => string}};
  }).chrome?.runtime?.getURL;
  return getUrl?.(path) || new URL(path, self.location.href).toString();
}

function configureWasmThreads(_model: ReturnType<typeof normalizeVideoLocalTranscriptionModel>): number {
  // ORT initializes one thread pool per worker lifetime. The offscreen owner
  // recreates this worker when the selected model changes, so the first model
  // reliably determines the pool size and subsequent requests reuse it.
  if (wasmRuntimeThreads !== null) {
    transcriberThreads = wasmRuntimeThreads;
    return wasmRuntimeThreads;
  }
  // 只有真正支持 SharedArrayBuffer 的隔离上下文才允许 pthread；否则
  // ONNX Runtime 会强制退回单线程。可用时最多开 2 个线程，避免把
  // Whisper 的内存峰值翻倍，同时让较长窗口不再完全占满单核。
  const sharedMemoryAvailable = typeof SharedArrayBuffer !== 'undefined'
    && self.crossOriginIsolated === true;
  const hardwareConcurrency = typeof navigator.hardwareConcurrency === 'number'
    ? navigator.hardwareConcurrency
    : 1;
  const threads = sharedMemoryAvailable && hardwareConcurrency >= 4 ? 2 : 1;
  if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = threads;
  wasmRuntimeThreads = threads;
  transcriberThreads = threads;
  return threads;
}

async function canUseWebGpu(): Promise<boolean> {
  if (!ENABLE_VIDEO_WHISPER_WEBGPU || webGpuDisabled) return false;
  const result = await (webGpuProbePromise ||= probeWebGpu());
  webGpuProbeInfo = result.info;
  return result.available && !webGpuDisabled;
}

function disableWebGpu(reason: unknown): void {
  if (webGpuDisabled) return;
  webGpuDisabled = true;
  console.warn('[FluentRead] 本地视频 Worker 已禁用 WebGPU，当前生命周期改用 WASM', reason);
}

async function createWasmTranscriber(modelId: string, model: ReturnType<typeof normalizeVideoLocalTranscriptionModel>): Promise<LocalTranscriber> {
  const create = async (dtype: 'q4' | 'q8') => {
    const createPipeline = () => pipeline('automatic-speech-recognition', modelId, {
      // ORT 的 CPU arena / memory pattern 会为动态 Whisper 窗口保留大块
      // 中间张量。浏览器实时字幕更看重可回收峰值，关闭后由有界窗口和暖
      // session 复用承担性能，避免 renderer 长时间停留在 GB 级 RSS。
      session_options: {
        enableCpuMemArena: false,
        enableMemPattern: false,
        executionMode: 'sequential',
      },
      device: 'wasm',
      dtype,
      revision: 'master',
    }) as unknown as Promise<LocalTranscriber>;
    const wasm = env.backends.onnx.wasm;
    const transcriber = await (wasm
      ? withCompressedWasmBinary(wasm, extensionUrl('fluent-read-ai/ort-wasm-simd-threaded.jsep.wasm.gz'), createPipeline)
      : createPipeline());
    transcriberDtype = dtype;
    return transcriber;
  };

  try {
    return await create('q4');
  } catch (q4Error) {
    console.warn('[FluentRead] Worker WASM/q4 Whisper 初始化失败，退回 WASM/q8', q4Error);
    // q8 是真实 fallback；先写入同一 Cache Storage，后续重建 worker 不会再次下载。
    await cacheVideoAiQ8ModelFiles(model);
    return create('q8');
  }
}

async function createLocalTranscriber(
  modelId: string,
  model: ReturnType<typeof normalizeVideoLocalTranscriptionModel>,
): Promise<LocalTranscriber> {
  if (await canUseWebGpu()) {
    let gpuTranscriber: LocalTranscriber | null = null;
    try {
      const createPipeline = () => pipeline('automatic-speech-recognition', modelId, {
        session_options: {
          enableCpuMemArena: false,
          enableMemPattern: false,
          executionMode: 'sequential',
        },
        device: 'webgpu',
        dtype: 'q4',
        revision: 'master',
      }) as unknown as Promise<LocalTranscriber>;
      const wasm = env.backends.onnx.wasm;
      gpuTranscriber = await (wasm
        ? withCompressedWasmBinary(wasm, extensionUrl('fluent-read-ai/ort-wasm-simd-threaded.jsep.wasm.gz'), createPipeline)
        : createPipeline());
      transcriberBackend = 'webgpu';
      transcriberDtype = 'q4';
      transcriberGpuInfo = webGpuProbeInfo;
      transcriberThreads = 0;
      console.info('[FluentRead] 本地视频 Worker 使用 WebGPU/q4 推理', transcriberGpuInfo);
      return gpuTranscriber;
    } catch (error) {
      disableWebGpu(error);
      try {
        await gpuTranscriber?.dispose?.();
      } catch {
        // GPU session 清理失败时仍交给 owner 终止当前 Worker。
      }
      transcriberBackend = '';
      transcriberGpuInfo = '';
      transcriberDtype = '';
      console.warn('[FluentRead] Worker WebGPU Whisper 初始化失败，请求 fresh WASM Worker', error);
      throw new WebGpuFallbackError(error);
    }
  }

  configureWasmThreads(model);
  const transcriber = await createWasmTranscriber(modelId, model);
  transcriberBackend = 'wasm';
  transcriberGpuInfo = '';
  console.info(`[FluentRead] 本地视频 Worker 使用 WASM/${transcriberDtype || 'unknown'} 推理（${transcriberThreads} 线程）`);
  return transcriber;
}

async function getLocalTranscriber(model: unknown): Promise<LocalTranscriber> {
  const normalizedModel = normalizeVideoLocalTranscriptionModel(model);
  const modelId = getVideoLocalTranscriptionModelId(normalizedModel);
  if (transcriberPromise && transcriberModelId === modelId) return transcriberPromise;

  if (transcriberPromise && transcriberModelId !== modelId) {
    detectedLanguages.clear();
    const previousPromise = transcriberPromise;
    transcriberPromise = null;
    transcriberModelId = '';
    try {
      const previous = await previousPromise;
      await previous.dispose?.();
    } catch {
      // 旧模型失败时继续加载当前选择的模型。
    }
  }

  transcriberModelId = modelId;
  transcriberPromise = createLocalTranscriber(modelId, normalizedModel).catch((error) => {
    detectedLanguages.clear();
    transcriberPromise = null;
    transcriberModelId = '';
    transcriberBackend = '';
    transcriberGpuInfo = '';
    transcriberDtype = '';
    throw error;
  });
  return transcriberPromise;
}

async function runModelInference<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (transcriberBackend === 'webgpu') throw new WebGpuFallbackError(error);
    throw error;
  }
}

async function detectWhisperSourceLanguage(
  transcriber: LocalTranscriber,
  audio: Float32Array,
): Promise<string | null> {
  const processor = transcriber.processor;
  const model = transcriber.model;
  const generationConfig = model?.generation_config;
  const modelConfig = model?.config;
  const isMultilingual = generationConfig?.is_multilingual ?? modelConfig?.is_multilingual;
  const langToId = generationConfig?.lang_to_id;
  const decoderStartTokenId = generationConfig?.decoder_start_token_id ?? modelConfig?.decoder_start_token_id;
  if (isMultilingual === false || !processor || !model || typeof decoderStartTokenId !== 'number'
    || !Number.isSafeInteger(decoderStartTokenId)) return null;
  if (!langToId || typeof langToId !== 'object') throw new Error('Whisper 模型缺少语言 token 配置');

  const processed = await processor(audio);
  const decoderInputIds = new Tensor(
    'int64', BigInt64Array.from([BigInt(decoderStartTokenId)]), [1, 1],
  );
  const disposeTensorTree = (value: unknown, seen = new Set<object>()): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    const disposable = value as {dispose?: unknown};
    if (typeof disposable.dispose === 'function') {
      disposable.dispose();
      return;
    }
    Object.values(value).forEach((child) => disposeTensorTree(child, seen));
  };
  let output: {logits?: {data: ArrayLike<number>; dims?: readonly number[]}} | undefined;
  try {
    output = await runModelInference(() => model({...processed, decoder_input_ids: decoderInputIds}));
    const detected = chooseWhisperSourceLanguage(output.logits, {isMultilingual, langToId});
    if (!detected) throw new Error('Whisper 首步没有可用的语言 token logits');
    return detected.language;
  } finally {
    // A direct model forward bypasses pipeline's normal generation cleanup;
    // release logits, KV tensors and processed features immediately after the
    // single language-token step to avoid retaining a full encoder window.
    disposeTensorTree(output);
    disposeTensorTree(processed);
    decoderInputIds.dispose?.();
  }
}

async function resolveWhisperSourceLanguage(
  transcriber: LocalTranscriber,
  request: WorkerRequest,
  audio: Float32Array,
): Promise<string> {
  const sessionKey = typeof request.languageSessionKey === 'string' ? request.languageSessionKey.trim() : '';
  const cacheKey = sessionKey ? `${transcriberModelId}:${sessionKey}` : '';
  if (cacheKey && detectedLanguages.has(cacheKey)) return detectedLanguages.get(cacheKey)!;
  const language = await detectWhisperSourceLanguage(transcriber, audio);
  if (!language) throw new Error('无法自动检测本地视频音频语言，请在视频字幕设置中选择源语言后重试');
  if (cacheKey) {
    if (detectedLanguages.size >= MAX_DETECTED_LANGUAGE_SESSIONS) {
      const oldest = detectedLanguages.keys().next().value;
      if (typeof oldest === 'string') detectedLanguages.delete(oldest);
    }
    detectedLanguages.set(cacheKey, language);
  }
  return language;
}

function cleanTranscriptText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^\[(?:blank_audio|silence)\]$/i.test(text) ? '' : text;
}

async function transcribeAudioOnce(
  request: WorkerRequest,
  model: ReturnType<typeof normalizeVideoLocalTranscriptionModel>,
  boundedAudio: Float32Array,
): Promise<WorkerTranscriptionResult> {
  const transcriber = await getLocalTranscriber(model);
  const explicitSourceLanguage = normalizeWhisperSourceLanguage(request.sourceLanguage);
  const effectiveSourceLanguage = explicitSourceLanguage
    || await resolveWhisperSourceLanguage(transcriber, request, boundedAudio);
  // Sentence timestamps consume decoder tokens too. Full-generation windows
  // are bounded (Tiny ~10s / Base ~14s); the old 96/128 cap made Whisper
  // spend too long decoding silence/repetition after the useful sentence had
  // already ended. Keep enough room for timestamps, but stop earlier.
  const stoppingCriteria = new InterruptableStoppingCriteria();
  const inferenceStartedAt = performance.now();
  const timeout = self.setTimeout(() => stoppingCriteria.interrupt(), MAX_REALTIME_INFERENCE_MS);
  let output: { text?: unknown; chunks?: unknown };
  try {
    output = await runModelInference(() => transcriber(
      boundedAudio,
      buildWhisperTranscriptionGenerationOptions(model, effectiveSourceLanguage, boundedAudio.length / 16_000, stoppingCriteria),
    )) as { text?: unknown; chunks?: unknown };
  } finally {
    self.clearTimeout(timeout);
  }
  if (stoppingCriteria.interrupted) {
    const error = new Error(`本地视频 AI 推理超过 ${MAX_REALTIME_INFERENCE_MS / 1000} 秒`);
    throw transcriberBackend === 'webgpu' ? new WebGpuFallbackError(error) : error;
  }

  const audioDurationMs = boundedAudio.length / 16;
  const segments = Array.isArray(output?.chunks)
    ? parseWhisperChunkTimestamps(output.chunks as any[], audioDurationMs)
      .map((segment) => ({...segment, text: cleanTranscriptText(segment.text)}))
      .filter((segment) => segment.text && segment.endMs > segment.startMs) as LocalVideoTranscriptionSegment[]
    : [];
  const inferenceMs = performance.now() - inferenceStartedAt;
  const result = {
    text: cleanTranscriptText(output?.text),
    segments,
    model,
    backend: transcriberBackend || undefined,
    gpuInfo: transcriberGpuInfo || undefined,
    inferenceMs,
    audioDurationMs,
    threads: transcriberBackend === 'wasm' ? transcriberThreads : undefined,
    dtype: transcriberDtype || undefined,
  };
  return result;
}

async function transcribeAudio(request: WorkerRequest): Promise<WorkerTranscriptionResult> {
  const model = normalizeVideoLocalTranscriptionModel(request.model);
  const audio = request.audio || new Float32Array();
  if (audio.length === 0) {
    return {
      text: '',
      segments: [],
      model,
      backend: transcriberBackend || undefined,
      threads: transcriberBackend === 'wasm' ? transcriberThreads : undefined,
      dtype: transcriberDtype || undefined,
    };
  }

  const maxSamples = MAX_WHISPER_AUDIO_SECONDS * 16_000;
  const boundedAudio = audio.length > maxSamples ? audio.subarray(0, maxSamples) : audio;
  try {
    return await transcribeAudioOnce(request, model, boundedAudio);
  } catch (error) {
    if (!(error instanceof WebGpuFallbackError)) throw error;
    disableWebGpu(error);
    await disposeTranscriber();
    console.warn('[FluentRead] Worker GPU Whisper 请求失败，请求 fresh WASM Worker', error);
    throw error;
  }
}

async function disposeTranscriber(): Promise<void> {
  const current = transcriberPromise;
  transcriberPromise = null;
  transcriberModelId = '';
  detectedLanguages.clear();
  transcriberBackend = '';
  transcriberGpuInfo = '';
  transcriberDtype = '';
  transcriberThreads = wasmRuntimeThreads ?? 1;
  try {
    const transcriber = current ? await current : null;
    await transcriber?.dispose?.();
  } catch (error) {
    console.warn('[FluentRead] Worker 释放本地视频模型失败', error);
  }
}

function enqueueWorkerTask(task: () => Promise<void>): void {
  // 主线程队列通常已经只发送一个请求，但 Worker 自身也必须提供同样的
  // 单消费者边界；否则 prepare/transcribe/dispose 的多个 async handler
  // 会并发触碰同一个 ONNX session，造成重复中间张量和不可预测的峰值内存。
  const next = workerTaskQueue.then(task, task);
  workerTaskQueue = next.catch(() => undefined);
}

const workerScope = self as typeof self & {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

export function startVideoTranscriptionWorker(): void {
configureEnvironment();
workerScope.onmessage = (event) => {
  const request = event.data;
  if (!request || typeof request.requestId !== 'number') return;
  enqueueWorkerTask(async () => {
    try {
      if (request.device === 'wasm') {
        const hadGpuSession = transcriberBackend === 'webgpu';
        disableWebGpu('调用方锁定本 Worker 使用 WASM');
        if (hadGpuSession) await disposeTranscriber();
      }
      if (request.type === 'prepare') {
        await getLocalTranscriber(request.model);
        workerScope.postMessage({
          requestId: request.requestId,
          success: true,
          model: normalizeVideoLocalTranscriptionModel(request.model),
          backend: transcriberBackend || undefined,
          gpuInfo: transcriberGpuInfo || undefined,
          threads: transcriberBackend === 'wasm' ? transcriberThreads : undefined,
          dtype: transcriberDtype || undefined,
        });
        return;
      }
      const result = await transcribeAudio(request);
      workerScope.postMessage({ requestId: request.requestId, success: true, ...result });
    } catch (error) {
      const response: {
        requestId: number;
        success: false;
        error: string;
        retryWithCpu?: true;
      } = {
        requestId: request.requestId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      if (error instanceof WebGpuFallbackError) response.retryWithCpu = true;
      workerScope.postMessage(response);
    }
  });
};

self.addEventListener('message', (event: MessageEvent<{ type?: string }>) => {
  if (event.data?.type === 'dispose') enqueueWorkerTask(disposeTranscriber);
});

}
