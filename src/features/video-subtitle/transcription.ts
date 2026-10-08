/**
 * @file src/features/video-subtitle/transcription.ts
 * 文件职责：定义本地 Whisper 模型选项与音频转换的公共契约，统一界面和识别端使用的默认值。
 * 主要内容：规范化模型配置与下载状态列表，给出下载进度使用的预计体积，拦截识别退化的长串重复文本，把多声道 PCM 按目标采样率混音和重采样，并保守移除 Whisper 输入外侧的数字静音。
 * 模块边界：只处理传入数据，不读取配置仓库、不调用浏览器音频设备，也不下载或初始化模型。
 */

export const VIDEO_LOCAL_TRANSCRIPTION_MODELS = [
  {
    value: 'tiny',
    label: 'Whisper Tiny（轻量模型）',
    modelId: 'onnx-community/whisper-tiny',
    // q4 下载清单共约 98.5 MB，向上取整；不代表运行内存占用。
    downloadSizeMb: 100,
    description: '识别速度较快、内存占用较低，适合快速生成字幕。',
  },
  {
    value: 'base',
    label: 'Whisper Base（标准模型）',
    modelId: 'onnx-community/whisper-base',
    // q4 下载清单共约 145.6 MB，向上取整。
    downloadSizeMb: 150,
    description: '侧重识别质量，所需内存更多、处理时间更长。',
  },
] as const;

export type VideoLocalTranscriptionModel = typeof VIDEO_LOCAL_TRANSCRIPTION_MODELS[number]['value'];

/**
 * 只记录“模型所需文件已经完整写入浏览器缓存”的状态；真正的 ONNX
 * session 在用户播放并请求字幕时才创建，避免设置页下载模型就长期占用
 * 数百 MB 到 GB 内存。状态用于在 X 播放器里给出清晰的操作引导。
 */
export const VIDEO_LOCAL_TRANSCRIPTION_STATE_KEY = 'fluentReadVideoLocalTranscriptionModels';
export const VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE = 'fluentReadGetLocalVideoModelState' as const;

export function normalizeVideoLocalTranscriptionModels(value: unknown): VideoLocalTranscriptionModel[] {
  if (!Array.isArray(value)) return [];
  const supported = new Set(VIDEO_LOCAL_TRANSCRIPTION_MODELS.map((item) => item.value));
  return [...new Set(value.filter((model): model is VideoLocalTranscriptionModel =>
    typeof model === 'string' && supported.has(model as VideoLocalTranscriptionModel)))];
}

export function normalizeVideoLocalTranscriptionModel(value: unknown): VideoLocalTranscriptionModel {
  return VIDEO_LOCAL_TRANSCRIPTION_MODELS.some((item) => item.value === value)
    ? value as VideoLocalTranscriptionModel
    : 'tiny';
}

/**
 * 首次生成 AI 字幕时默认推荐 Tiny：下载最小、识别最快，能在普通电脑上跑完整段视频。
 * 语音不清楚时用户可在确认框或设置中改用 Base。
 */
export const VIDEO_LOCAL_TRANSCRIPTION_RECOMMENDED_MODEL: VideoLocalTranscriptionModel = 'tiny';

export function getVideoLocalTranscriptionModelId(value: unknown): string {
  const model = normalizeVideoLocalTranscriptionModel(value);
  return VIDEO_LOCAL_TRANSCRIPTION_MODELS.find((item) => item.value === model)!.modelId;
}

/** 下载进度在各文件报出真实大小之前，以界面标注的模型体积作为预计总量。 */
export function getVideoLocalTranscriptionDownloadBytes(value: unknown): number {
  const model = normalizeVideoLocalTranscriptionModel(value);
  return VIDEO_LOCAL_TRANSCRIPTION_MODELS.find((item) => item.value === model)!.downloadSizeMb * 1_000_000;
}

/** 拒绝解码循环产生的长串重复字/短语；正常叠词、强调和短句重复仍可保留。 */
export function isDegenerateVideoTranscript(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const compact = value.replace(/<\|[^|]+\|>/gu, '').replace(/[\s\p{P}\p{S}]/gu, '');
  if (/([\p{L}\p{N}])\1{15,}/u.test(compact)) return true;
  const repeated = compact.match(/([\p{L}\p{N}]{2,24})\1{5,}/u);
  return Boolean(repeated && repeated[0].length >= 48);
}

export interface WhisperAudioWindow {
  audio: Float32Array;
  /** 裁剪后的首采样在原窗口中的位置；识别时间戳必须加回这个偏移。 */
  offsetMs: number;
  sourceDurationMs: number;
}

/**
 * 只处理接近一个 PCM16 量化步长的数字静音，不把音乐、底噪或轻声当成
 * 无语音。保留 160 ms 外侧余量，且仅裁剪至少 600 ms 的静音边缘；
 * 不压缩句子间的停顿。静音窗直接返回空输入，避免模型编造片尾字幕。
 */
export function prepareWhisperAudioWindow(audio: Float32Array): WhisperAudioWindow {
  const frameSamples = 320;
  const contextSamples = 160 * 16;
  const minimumSilenceSamples = 600 * 16;
  const silencePeak = 1 / 32_768;
  let firstActive = -1;
  let lastActiveEnd = 0;
  let hasInvalidSample = false;
  for (let start = 0; start < audio.length; start += frameSamples) {
    const end = Math.min(audio.length, start + frameSamples);
    let active = false;
    for (let index = start; index < end; index += 1) {
      const sample = audio[index];
      if (!Number.isFinite(sample)) hasInvalidSample = true;
      else if (Math.abs(sample) > silencePeak) active = true;
    }
    if (!active) continue;
    if (firstActive < 0) firstActive = start;
    lastActiveEnd = end;
  }
  const sourceDurationMs = audio.length / 16;
  if (firstActive < 0) return {audio: new Float32Array(), offsetMs: 0, sourceDurationMs};
  const start = firstActive >= minimumSilenceSamples ? Math.max(0, firstActive - contextSamples) : 0;
  const end = audio.length - lastActiveEnd >= minimumSilenceSamples
    ? Math.min(audio.length, lastActiveEnd + contextSamples)
    : audio.length;
  let prepared = audio.subarray(start, end);
  if (hasInvalidSample) prepared = prepared.map(sample => Number.isFinite(sample) ? sample : 0);
  return {audio: prepared, offsetMs: start / 16, sourceDurationMs};
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
