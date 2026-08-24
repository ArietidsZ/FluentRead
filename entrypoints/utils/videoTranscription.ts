import { urls } from './constant';
import { services } from './option';

export const VIDEO_LOCAL_TRANSCRIPTION_MODELS = [
  {
    value: 'tiny',
    label: 'Whisper Tiny（本地，实时推荐）',
    modelId: 'onnx-community/whisper-tiny',
    description: '占用较低，适合边播边识别',
  },
  {
    value: 'base',
    label: 'Whisper Base（本地，实验）',
    modelId: 'onnx-community/whisper-base',
    description: '上下文更长，但占用和延迟明显更高',
  },
] as const;

export type VideoLocalTranscriptionModel = typeof VIDEO_LOCAL_TRANSCRIPTION_MODELS[number]['value'];

/**
 * 只记录“模型所需文件已经完整写入浏览器缓存”的状态；真正的 ONNX
 * session 在用户播放并请求字幕时才创建，避免设置页下载模型就长期占用
 * 数百 MB 到 GB 内存。状态用于在 X 播放器里给出清晰的操作引导。
 */
export const VIDEO_LOCAL_TRANSCRIPTION_STATE_KEY = 'fluentReadVideoLocalTranscriptionModels';

export function normalizeVideoLocalTranscriptionModels(value: unknown): VideoLocalTranscriptionModel[] {
  if (!Array.isArray(value)) return [];
  const supported = new Set(VIDEO_LOCAL_TRANSCRIPTION_MODELS.map((item) => item.value));
  return [...new Set(value.filter((model): model is VideoLocalTranscriptionModel =>
    typeof model === 'string' && supported.has(model as VideoLocalTranscriptionModel)))];
}

export function getVideoLocalTranscriptionModelDescription(value: unknown): string {
  const model = normalizeVideoLocalTranscriptionModel(value);
  return VIDEO_LOCAL_TRANSCRIPTION_MODELS.find((item) => item.value === model)!.description;
}

export function normalizeVideoLocalTranscriptionModel(value: unknown): VideoLocalTranscriptionModel {
  return VIDEO_LOCAL_TRANSCRIPTION_MODELS.some((item) => item.value === value)
    ? value as VideoLocalTranscriptionModel
    : 'tiny';
}

export function getVideoLocalTranscriptionModelId(value: unknown): string {
  const model = normalizeVideoLocalTranscriptionModel(value);
  return VIDEO_LOCAL_TRANSCRIPTION_MODELS.find((item) => item.value === model)!.modelId;
}

export function getVideoLocalTranscriptionModelLabel(value: unknown): string {
  const model = normalizeVideoLocalTranscriptionModel(value);
  return VIDEO_LOCAL_TRANSCRIPTION_MODELS.find((item) => item.value === model)!.label;
}

/** 将解码后的多声道音频重采样为 Whisper 使用的单声道 PCM。 */
export function resampleToWhisperAudio(
  channels: readonly Float32Array[],
  sourceSampleRate: number,
  targetSampleRate = 16_000,
): Float32Array {
  const channelCount = channels.length;
  const sourceLength = channels.reduce((longest, channel) => Math.max(longest, channel.length), 0);
  if (channelCount === 0 || sourceLength === 0) return new Float32Array();

  if (!Number.isFinite(sourceSampleRate) || sourceSampleRate <= 0 || sourceSampleRate === targetSampleRate) {
    if (channelCount === 1 && channels[0].length === sourceLength) return channels[0].slice();
    const mono = new Float32Array(sourceLength);
    for (let index = 0; index < sourceLength; index += 1) {
      let sample = 0;
      for (const channel of channels) sample += channel[index] || 0;
      mono[index] = sample / channelCount;
    }
    return mono;
  }

  const outputLength = Math.max(1, Math.round(sourceLength * targetSampleRate / sourceSampleRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceSampleRate / targetSampleRate;
  for (let index = 0; index < output.length; index += 1) {
    const sourcePosition = index * ratio;
    const leftIndex = Math.min(Math.floor(sourcePosition), sourceLength - 1);
    const rightIndex = Math.min(leftIndex + 1, sourceLength - 1);
    const fraction = sourcePosition - leftIndex;
    let leftSample = 0;
    let rightSample = 0;
    for (const channel of channels) {
      leftSample += channel[leftIndex] || 0;
      rightSample += channel[rightIndex] || 0;
    }
    leftSample /= channelCount;
    rightSample /= channelCount;
    output[index] = leftSample + (rightSample - leftSample) * fraction;
  }
  return output;
}

/** 云端转写兼容层仍保留给旧调用方；X 的新 AI 字幕默认走扩展内 Whisper。 */
export const VIDEO_TRANSCRIPTION_SERVICES = new Set([
  services.openai,
  services.groq,
  services.custom,
  services.newapi,
]);

export interface VideoTranscriptionEndpointConfig {
  proxy?: string;
  custom?: string;
  newApiUrl?: string;
}

export function supportsVideoTranscription(service: string): boolean {
  return VIDEO_TRANSCRIPTION_SERVICES.has(service);
}

function appendPath(value: string, path: string): string {
  return `${value.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** 将聊天补全地址映射为同一 OpenAI-compatible 服务的音频转写地址。 */
export function buildVideoTranscriptionEndpoint(
  service: string,
  endpointConfig: VideoTranscriptionEndpointConfig = {},
): string | null {
  if (!supportsVideoTranscription(service)) return null;

  const raw = endpointConfig.proxy?.trim()
    || (service === services.custom ? endpointConfig.custom?.trim() : '')
    || (service === services.newapi ? endpointConfig.newApiUrl?.trim() : '')
    || String((urls as Record<string, unknown>)[service] || '').trim();
  if (!raw) return null;

  if (/\/audio\/transcriptions(?:[?#]|$)/i.test(raw)) return raw;
  if (/\/chat\/completions(?:[?#]|$)/i.test(raw)) {
    return raw.replace(/\/chat\/completions(?=([?#]|$))/i, '/audio/transcriptions');
  }

  // New API 的配置通常只填写根地址或 /v1；与现有 chat/completions
  // 适配器保持一致，自动补齐 /v1。
  if (service === services.newapi) {
    return /\/v1\/?(?=[?#]|$)/i.test(raw)
      ? raw.replace(/\/v1\/?(?=([?#]|$))/i, '/v1/audio/transcriptions')
      : appendPath(raw, 'v1/audio/transcriptions');
  }

  return appendPath(raw, 'audio/transcriptions');
}

export function getVideoTranscriptionModel(service: string): string {
  return service === services.groq ? 'whisper-large-v3-turbo' : 'whisper-1';
}

export function normalizeVideoTranscriptionLanguage(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'auto' || normalized === 'automatic') return undefined;
  return normalized.split(/[-_]/, 1)[0] || undefined;
}
