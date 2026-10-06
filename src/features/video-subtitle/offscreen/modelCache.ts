/**
 * @file src/features/video-subtitle/offscreen/modelCache.ts
 * 文件职责：维护 Transformers.js Whisper 模型文件的远程地址、q4/q8 清单与 Cache Storage 下载。
 * 主要内容：按模型和量化类型复用缓存条目，流式接收并在国内源、官方与镜像间有界回退，限制下载与断流等待，把一个模型的全部文件合并成一条真实字节进度，并提供预下载状态所需的稳定 API。
 * 模块边界：只处理模型文件缓存，不创建 Worker、不初始化 ONNX session，也不参与后台 owner 生命周期。
 */
import {withModelDownload} from '@/src/platform/http/modelDownloads';
import {createDownloadProgressTracker, type DownloadProgress} from '@/src/core/download/progress';
import {
  getVideoLocalTranscriptionDownloadBytes,
  getVideoLocalTranscriptionModelId,
  normalizeVideoLocalTranscriptionModel,
} from '@/src/features/video-subtitle/transcription';

export const VIDEO_AI_MODEL_REMOTE_HOST = 'https://modelscope.cn/models/';
export const VIDEO_AI_MODEL_REVISION = 'master';
export const VIDEO_AI_MODEL_REMOTE_PATH_TEMPLATE = '{model}/resolve/{revision}/';

// Transformers.js 的 Whisper q4 pipeline 实际读取这 7 个文件。固定清单既能
// 避免设置页为了“下载”而初始化 ONNX session，也不会把整个仓库无关文件
// 拉进浏览器。模型推理仍由 transcription.worker.ts 独立完成。
export const VIDEO_AI_Q4_MODEL_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model_q4.onnx',
  'onnx/decoder_model_merged_q4.onnx',
] as const;
export const VIDEO_AI_Q8_MODEL_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
] as const;

const TRANSFORMERS_CACHE_NAME = 'transformers-cache';
const MODEL_FILE_DOWNLOAD_TIMEOUT_MS = 120_000;

export function getVideoAiModelFileUrl(model: unknown, file: string): string {
  const modelId = getVideoLocalTranscriptionModelId(normalizeVideoLocalTranscriptionModel(model));
  return `${VIDEO_AI_MODEL_REMOTE_HOST}${modelId}/resolve/${VIDEO_AI_MODEL_REVISION}/${file}`;
}

/**
 * 顺序下载并写入 Transformers.js 使用的同一个 Cache Storage。cache.put 会
 * 直接消费 Response，不在 JS 堆中再构造一份几十 MB 的 ONNX ArrayBuffer。
 */
export async function cacheVideoAiModelFiles(
  model: unknown,
  dtype: 'q4' | 'q8' = 'q4',
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  if (typeof caches === 'undefined') throw new Error('当前浏览器不支持本地模型缓存');
  const cache = await caches.open(TRANSFORMERS_CACHE_NAME);

  const files = dtype === 'q8' ? VIDEO_AI_Q8_MODEL_FILES : VIDEO_AI_Q4_MODEL_FILES;
  // 界面标注的体积按 q4 清单统计；q8 回退没有预计总量，各文件报出大小后才给百分比。
  const tracker = createDownloadProgressTracker(
    files.length,
    dtype === 'q4' ? getVideoLocalTranscriptionDownloadBytes(model) : 0,
    progress => onProgress?.(progress),
  );
  for (const file of files) {
    const url = getVideoAiModelFileUrl(model, file);
    const progress = tracker.file();
    const cached = await cache.match(url);
    if (cached) {
      progress.cached(Number(cached.headers.get('Content-Length')));
      continue;
    }

    await withModelDownload(url, response => cache.put(url, response), {
      timeoutMs: MODEL_FILE_DOWNLOAD_TIMEOUT_MS,
      onProgress: progress.advance,
    });
    progress.complete();
  }
}

export function cacheVideoAiQ4ModelFiles(model: unknown, onProgress?: (progress: DownloadProgress) => void): Promise<void> {
  return cacheVideoAiModelFiles(model, 'q4', onProgress);
}

export function cacheVideoAiQ8ModelFiles(model: unknown, onProgress?: (progress: DownloadProgress) => void): Promise<void> {
  return cacheVideoAiModelFiles(model, 'q8', onProgress);
}

/** 只清除指定 Whisper 模型的缓存文件，保留其他模型及字幕结果。 */
export async function removeVideoAiModelFiles(model: unknown): Promise<void> {
  if (model !== 'tiny' && model !== 'base') throw new Error('无效的本地字幕模型');
  const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
  const prefix = getVideoAiModelFileUrl(model, '');
  for (const request of await cache.keys()) {
    if (request.url.startsWith(prefix)) await cache.delete(request);
  }
}
