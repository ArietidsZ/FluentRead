/**
 * @file src/features/video-subtitle/content/video-ai/speechAlignment.ts
 * 文件职责：使用已经采集的 PCM 声音边界校准 Whisper 句级时间戳，避免将明显停顿显示为下一句。
 * 主要内容：计算二十毫秒音频活动帧，保守收紧句子外侧静音，并移除已被上一完整窗口识别的孤立尾音。
 * 模块边界：只读音频和相对时间戳，不改变文本或全局播放头，不进行推理；背景音乐或连续语音不提供明确静音时保留模型边界。
 */
import type {VideoAiTranscriptSegment} from './streamingTranscript';

const FRAME_SAMPLES = 320;
const FRAME_MS = 20;
function activeFrames(audio: Float32Array): boolean[] {
  const result: boolean[] = [];
  for (let start = 0; start < audio.length; start += FRAME_SAMPLES) {
    const end = Math.min(audio.length, start + FRAME_SAMPLES);
    let energy = 0;
    for (let index = start; index < end; index += 1) {
      const value = Number.isFinite(audio[index]) ? audio[index] : 0;
      energy += value * value;
    }
    result.push(energy / (end - start) >= 0.0025 ** 2);
  }
  return result;
}

/** 仅修剪模型边界内的外侧静音；保留一小段余量，避免吞掉轻声辅音。 */
export function alignVideoAiSegmentsToSpeech(audio: Float32Array, segments: readonly VideoAiTranscriptSegment[]): VideoAiTranscriptSegment[] {
  const frames = activeFrames(audio);
  const durationMs = audio.length / 16;
  return segments.map((segment, segmentIndex) => {
    const start = Math.max(0, Number.isFinite(segment.startMs) ? segment.startMs! : 0);
    let end = Math.min(durationMs, Number.isFinite(segment.endMs) ? segment.endMs! : durationMs);
    // 句级模型有时在最后一个词尚未说完时提前结束。仅当这个边界仍位于
    // 活动语音内、且 800 ms 内出现明确停顿时，补齐到停顿前；连续背景声不扩展。
    const endFrame = Math.floor(end / FRAME_MS);
    if (frames[endFrame] || frames[endFrame - 1]) {
      const nextStart = segments[segmentIndex + 1]?.startMs;
      const limit = Math.floor(Math.min(durationMs, end + 800,
        Number.isFinite(nextStart) ? nextStart! : durationMs) / FRAME_MS);
      let lastActive = endFrame - 1;
      for (let index = endFrame; index < limit; index += 1) {
        if (frames[index]) lastActive = index;
        else if (index - lastActive >= 8) {
          end = Math.max(end, (lastActive + 1) * FRAME_MS + 40);
          break;
        }
      }
    }
    const firstFrame = Math.max(0, Math.floor(start / FRAME_MS));
    const lastFrame = Math.min(frames.length, Math.ceil(end / FRAME_MS));
    let first = -1;
    let last = -1;
    for (let index = firstFrame; index < lastFrame; index += 1) {
      if (!frames[index]) continue;
      if (first < 0) first = index;
      last = index;
    }
    if (first < 0) return {...segment};
    const spokenStart = Math.max(start, first * FRAME_MS - 40);
    const spokenEnd = Math.min(end, (last + 1) * FRAME_MS + 40);
    return {...segment,
      startMs: spokenStart - start >= 160 ? spokenStart : start,
      endMs: end - spokenEnd >= 160 ? spokenEnd : end,
    };
  });
}

/** 在窗口后半段选择足够长的自然停顿，避免把半句话切进相邻识别窗口。 */
export function findVideoAiPauseBoundary(audio: Float32Array): number {
  const frames = activeFrames(audio);
  const minimumBoundary = audio.length / 16 * 0.55;
  let silenceStart = 0;
  let boundary = 0;
  for (let index = 0; index <= frames.length; index += 1) {
    if (frames[index] || index === frames.length) {
      const middleMs = (silenceStart + index) * FRAME_MS / 2;
      if ((index - silenceStart) * FRAME_MS >= 360 && middleMs >= minimumBoundary) boundary = middleMs;
      silenceStart = index + 1;
    }
  }
  return boundary;
}
