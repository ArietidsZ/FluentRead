import {
  getVideoLocalTranscriptionModelId,
  normalizeVideoLocalTranscriptionModel,
} from '@/entrypoints/utils/videoTranscription';

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
export async function cacheVideoAiQ4ModelFiles(model: unknown): Promise<void> {
  if (typeof caches === 'undefined') throw new Error('当前浏览器不支持本地模型缓存');
  const cache = await caches.open(TRANSFORMERS_CACHE_NAME);

  for (const file of VIDEO_AI_Q4_MODEL_FILES) {
    const url = getVideoAiModelFileUrl(model, file);
    if (await cache.match(url)) continue;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), MODEL_FILE_DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`模型文件下载失败（${response.status}）：${file}`);
      await cache.put(url, response);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`模型文件下载超过 ${MODEL_FILE_DOWNLOAD_TIMEOUT_MS / 1000} 秒：${file}`);
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
}
