import { describe, expect, it } from 'vitest';
import {
  getVideoLocalTranscriptionModelId,
  getVideoLocalTranscriptionDownloadBytes,
  normalizeVideoLocalTranscriptionModel,
  normalizeVideoLocalTranscriptionModels,
  VIDEO_LOCAL_TRANSCRIPTION_RECOMMENDED_MODEL,
  resampleToWhisperAudio,
  prepareWhisperAudioWindow,
} from '@/src/features/video-subtitle/transcription';
import {
  getVideoAiModelFileUrl,
  VIDEO_AI_Q4_MODEL_FILES,
} from '@/src/features/video-subtitle/offscreen/modelCache';

describe('视频 AI 字幕转写配置', () => {
  it('使用扩展内本地 Whisper 模型，并对非法选择回退到 Tiny', () => {
    expect(normalizeVideoLocalTranscriptionModel('base')).toBe('base');
    expect(normalizeVideoLocalTranscriptionModel('unknown')).toBe('tiny');
    expect(getVideoLocalTranscriptionModelId('base')).toBe('onnx-community/whisper-base');
    expect(getVideoLocalTranscriptionDownloadBytes('base')).toBe(150_000_000);
    expect(getVideoLocalTranscriptionDownloadBytes('unknown')).toBe(100_000_000);
    expect(normalizeVideoLocalTranscriptionModels(['tiny', 'base', 'unknown', 'tiny'])).toEqual(['tiny', 'base']);
  });

  it('默认推荐下载最小、识别最快的 Tiny', () => {
    expect(VIDEO_LOCAL_TRANSCRIPTION_RECOMMENDED_MODEL).toBe('tiny');
    expect(normalizeVideoLocalTranscriptionModel(undefined)).toBe(VIDEO_LOCAL_TRANSCRIPTION_RECOMMENDED_MODEL);
  });

  it('预下载只缓存 Whisper q4 运行所需文件，并使用与 Transformers.js 相同的 URL', () => {
    expect(VIDEO_AI_Q4_MODEL_FILES).toEqual([
      'config.json',
      'generation_config.json',
      'preprocessor_config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'onnx/encoder_model_q4.onnx',
      'onnx/decoder_model_merged_q4.onnx',
    ]);
    expect(getVideoAiModelFileUrl('base', 'onnx/encoder_model_q4.onnx')).toBe(
      'https://modelscope.cn/models/onnx-community/whisper-base/resolve/master/onnx/encoder_model_q4.onnx',
    );
  });

  it('将多声道音频重采样为单声道 PCM', () => {
    const result = resampleToWhisperAudio([
      new Float32Array([1, 1, 1, 1]),
      new Float32Array([-1, -1, -1, -1]),
    ], 8, 4);

    expect(result).toHaveLength(2);
    expect(Array.from(result)).toEqual([0, 0]);
  });

  it('只裁剪长数字静音外侧并保留偏移、上下文和句间停顿', () => {
    const audio = new Float32Array(8 * 16_000);
    audio.fill(0.02, 2 * 16_000, 3 * 16_000);
    audio.fill(-0.02, 4 * 16_000, 5 * 16_000);
    const result = prepareWhisperAudioWindow(audio);
    expect(result.offsetMs).toBe(1840);
    expect(result.sourceDurationMs).toBe(8000);
    expect(result.audio.length / 16).toBe(3320);
    expect(Array.from(result.audio.subarray(1160 * 16, 2160 * 16))).toEqual(new Array(16_000).fill(0));
    expect(result.audio.buffer).toBe(audio.buffer);
  });

  it('保留低音量声音、短静音边缘和小于二十毫秒的语音窗', () => {
    const quiet = new Float32Array(32_000).fill(0.00005);
    expect(prepareWhisperAudioWindow(quiet).audio).toEqual(quiet);
    const shortEdges = new Float32Array(16_000);
    shortEdges.fill(0.04, 400 * 16, 700 * 16);
    expect(prepareWhisperAudioWindow(shortEdges)).toMatchObject({audio: shortEdges, offsetMs: 0, sourceDurationMs: 1000});
    expect(prepareWhisperAudioWindow(new Float32Array([0.01])).audio).toEqual(new Float32Array([0.01]));
  });

  it('空音频或 PCM16 一个量化步长内的数字静音不送入模型，非法采样置零', () => {
    expect(prepareWhisperAudioWindow(new Float32Array())).toEqual({audio: new Float32Array(), offsetMs: 0, sourceDurationMs: 0});
    const silent = new Float32Array(16_000).fill(1 / 32_768);
    silent[1] = NaN;
    silent[2] = Infinity;
    expect(prepareWhisperAudioWindow(silent)).toEqual({audio: new Float32Array(), offsetMs: 0, sourceDurationMs: 1000});
    const input = new Float32Array([0.02, NaN, Infinity, -0.03]);
    const result = prepareWhisperAudioWindow(input);
    expect(result.audio).toEqual(new Float32Array([0.02, 0, 0, -0.03]));
    expect(result.audio.buffer).not.toBe(input.buffer);
    expect(Number.isNaN(input[1])).toBe(true);
  });
});
