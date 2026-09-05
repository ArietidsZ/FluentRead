/**
 * @file src/features/video-subtitle/offscreen/transcription.worker.ts
 * 文件职责：运行独立的 Whisper ONNX Worker，复用模型 session 并执行受限时长的本地音频推理。
 * 主要内容：配置 WASM/WebGPU 后端、串行处理 prepare/transcribe/dispose、解析 chunk 时间戳并回传诊断信息。
 * 模块边界：只运行模型与 Worker 消息循环，不访问页面 DOM、后台消息或共享 Offscreen 业务状态。
 */
import { env, InterruptableStoppingCriteria, pipeline } from '@huggingface/transformers';
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

type LocalTranscriber = ((
  audio: Float32Array,
  options: Record<string, unknown>,
) => Promise<unknown>) & {
  dispose?: () => Promise<void>;
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
  audio?: Float32Array;
}

let transcriberPromise: Promise<LocalTranscriber> | null = null;
let transcriberModelId = '';
let transcriberBackend: LocalTranscriptionBackend | '' = '';
let transcriberGpuInfo = '';
let transcriberThreads = 1;
let transcriberDtype: 'q4' | 'q8' | '' = '';
let wasmRuntimeThreads: number | null = null;
let webGpuProbePromise: Promise<boolean> | null = null;
let webGpuProbeInfo = '';
let workerTaskQueue: Promise<void> = Promise.resolve();

const MAX_WHISPER_AUDIO_SECONDS = 30;
const MAX_REALTIME_INFERENCE_MS = 15_000;
// 当前 Edge/Apple WebGPU 的 Whisper q4 session 实测会把扩展 renderer
// 推到约 1.4 GB RSS；WASM/q4 约 630 MB，且更容易被 Worker 超时终止。
// 先固定安全后端，保留下面的探测和降级代码，后续有可靠的显存预算后
// 再通过显式实验开关恢复 WebGPU，避免硬件差异直接拖垮浏览器。
const ENABLE_VIDEO_WHISPER_WEBGPU = false;

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
  env.backends.onnx.wasm.proxy = false;
  const extensionUrl = (globalThis as typeof globalThis & {
    chrome?: { runtime?: { getURL?: (path: string) => string } };
  }).chrome?.runtime?.getURL;
  env.backends.onnx.wasm.wasmPaths = {
    mjs: extensionUrl?.('fluent-read-ai/ort-wasm-simd-threaded.jsep.mjs')
      || new URL('fluent-read-ai/ort-wasm-simd-threaded.jsep.mjs', self.location.href).toString(),
    wasm: extensionUrl?.('fluent-read-ai/ort-wasm-simd-threaded.jsep.wasm')
      || new URL('fluent-read-ai/ort-wasm-simd-threaded.jsep.wasm', self.location.href).toString(),
  };
}

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
  if (!ENABLE_VIDEO_WHISPER_WEBGPU) return false;
  if (webGpuProbePromise) return webGpuProbePromise;
  webGpuProbePromise = (async () => {
    // 无头 Edge 通常通过 SwiftShader 暴露一个“可用”的 WebGPU adapter，
    // 但 Whisper q4 会把大量中间张量留在扩展 renderer，资源远差于 WASM
    // Worker。测试/自动化和无头运行直接走可终止的 WASM 路径。
    if (/Headless(?:Chrome|Edge)/i.test(self.navigator.userAgent || '')) return false;
    const gpu = (self.navigator as Navigator & {
      gpu?: { requestAdapter?: (options?: unknown) => Promise<unknown> };
    }).gpu;
    if (!gpu || typeof gpu.requestAdapter !== 'function') return false;
    try {
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return false;
      const typedAdapter = adapter as {
        isFallbackAdapter?: boolean;
        info?: { vendor?: string; architecture?: string; device?: string; description?: string };
      };
      const info = typedAdapter.info;
      webGpuProbeInfo = [info?.vendor, info?.architecture, info?.device, info?.description]
        .filter((item): item is string => Boolean(item))
        .join(' / ');
      const isSoftwareAdapter = typedAdapter.isFallbackAdapter === true
        || /swiftshader|software|llvmpipe|fallback/i.test(webGpuProbeInfo);
      return !isSoftwareAdapter;
    } catch (error) {
      console.debug('[FluentRead] 本地视频 Worker 不可用 WebGPU，退回 WASM', error);
      return false;
    }
  })();
  return webGpuProbePromise;
}

async function createWasmTranscriber(modelId: string, model: ReturnType<typeof normalizeVideoLocalTranscriptionModel>): Promise<LocalTranscriber> {
  const create = async (dtype: 'q4' | 'q8') => {
    const transcriber = await pipeline('automatic-speech-recognition', modelId, {
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
    });
    transcriberDtype = dtype;
    return transcriber as unknown as LocalTranscriber;
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
    try {
      const transcriber = await pipeline('automatic-speech-recognition', modelId, {
        device: 'webgpu',
        dtype: 'q4',
        revision: 'master',
      });
      transcriberBackend = 'webgpu';
      transcriberDtype = 'q4';
      transcriberGpuInfo = webGpuProbeInfo;
      transcriberThreads = 0;
      console.info('[FluentRead] 本地视频 Worker 使用 WebGPU/q4 推理', transcriberGpuInfo);
      return transcriber as unknown as LocalTranscriber;
    } catch (error) {
      console.warn('[FluentRead] Worker WebGPU Whisper 初始化失败，退回 WASM/q4', error);
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
    transcriberPromise = null;
    transcriberModelId = '';
    transcriberBackend = '';
    transcriberGpuInfo = '';
    transcriberDtype = '';
    throw error;
  });
  return transcriberPromise;
}

function cleanTranscriptText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^\[(?:blank_audio|silence)\]$/i.test(text) ? '' : text;
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
  const transcriber = await getLocalTranscriber(model);
  const sourceLanguage = typeof request.sourceLanguage === 'string'
    ? request.sourceLanguage.trim().toLowerCase().split(/[-_]/, 1)[0]
    : '';
  const audioSeconds = boundedAudio.length / 16_000;
  // Sentence timestamps consume decoder tokens too. Full-generation windows
  // are bounded (Tiny ~10s / Base ~14s); the old 96/128 cap made Whisper
  // spend too long decoding silence/repetition after the useful sentence had
  // already ended. Keep enough room for timestamps, but stop earlier.
  const tokenBudget = model === 'base'
    ? { minimum: 32, maximum: 96, perSecond: 7 }
    : { minimum: 24, maximum: 64, perSecond: 6 };
  const maxNewTokens = Math.min(
    tokenBudget.maximum,
    Math.max(tokenBudget.minimum, Math.ceil(audioSeconds * tokenBudget.perSecond)),
  );
  const stoppingCriteria = new InterruptableStoppingCriteria();
  const inferenceStartedAt = performance.now();
  const timeout = self.setTimeout(() => stoppingCriteria.interrupt(), MAX_REALTIME_INFERENCE_MS);
  let output: { text?: unknown; chunks?: unknown };
  try {
    output = await transcriber(boundedAudio, {
      return_timestamps: true,
      force_full_sequences: false,
      max_new_tokens: maxNewTokens,
      do_sample: false,
      num_beams: 1,
      stopping_criteria: stoppingCriteria,
      ...(sourceLanguage && sourceLanguage !== 'auto' ? { language: sourceLanguage } : {}),
      task: 'transcribe',
    }) as { text?: unknown; chunks?: unknown };
  } finally {
    self.clearTimeout(timeout);
  }
  if (stoppingCriteria.interrupted) {
    throw new Error(`本地视频 AI 推理超过 ${MAX_REALTIME_INFERENCE_MS / 1000} 秒`);
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

async function disposeTranscriber(): Promise<void> {
  const current = transcriberPromise;
  transcriberPromise = null;
  transcriberModelId = '';
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
      workerScope.postMessage({
        requestId: request.requestId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
};

self.addEventListener('message', (event: MessageEvent<{ type?: string }>) => {
  if (event.data?.type === 'dispose') enqueueWorkerTask(disposeTranscriber);
});

}
