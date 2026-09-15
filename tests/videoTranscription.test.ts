import { describe, expect, it } from 'vitest';
import {
  getVideoLocalTranscriptionModelId,
  normalizeVideoLocalTranscriptionModel,
  normalizeVideoLocalTranscriptionModels,
  readVideoLocalModelDeviceProfile,
  recommendVideoLocalTranscriptionModel,
  resampleToWhisperAudio,
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
    expect(normalizeVideoLocalTranscriptionModels(['tiny', 'base', 'unknown', 'tiny'])).toEqual(['tiny', 'base']);
  });

  it('只在桌面端内存和核心数都充足时推荐 Base，未知或移动设备推荐 Tiny', () => {
    expect(recommendVideoLocalTranscriptionModel({deviceMemoryGb: 8, hardwareConcurrency: 10, mobile: false})).toBe('base');
    expect(recommendVideoLocalTranscriptionModel({deviceMemoryGb: 8, hardwareConcurrency: 4, mobile: false})).toBe('tiny');
    expect(recommendVideoLocalTranscriptionModel({deviceMemoryGb: 4, hardwareConcurrency: 12, mobile: false})).toBe('tiny');
    expect(recommendVideoLocalTranscriptionModel({deviceMemoryGb: 8, hardwareConcurrency: 8, mobile: true})).toBe('tiny');
    expect(recommendVideoLocalTranscriptionModel({})).toBe('tiny');
    expect(recommendVideoLocalTranscriptionModel({deviceMemoryGb: 8, mobile: false})).toBe('tiny');
    expect(readVideoLocalModelDeviceProfile({deviceMemory: 8, hardwareConcurrency: 8, userAgent: 'Mozilla/5.0 (Macintosh)'} as never))
      .toEqual({deviceMemoryGb: 8, hardwareConcurrency: 8, mobile: false});
    expect(readVideoLocalModelDeviceProfile({hardwareConcurrency: 8, userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile'} as never))
      .toEqual({deviceMemoryGb: undefined, hardwareConcurrency: 8, mobile: true});
    expect(readVideoLocalModelDeviceProfile({userAgentData: {mobile: true}} as never).mobile).toBe(true);
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
});
