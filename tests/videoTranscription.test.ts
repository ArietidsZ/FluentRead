import { describe, expect, it } from 'vitest';
import {
  buildVideoTranscriptionEndpoint,
  getVideoLocalTranscriptionModelId,
  getVideoLocalTranscriptionModelLabel,
  getVideoLocalTranscriptionModelDescription,
  getVideoTranscriptionModel,
  normalizeVideoTranscriptionLanguage,
  normalizeVideoLocalTranscriptionModel,
  normalizeVideoLocalTranscriptionModels,
  resampleToWhisperAudio,
  supportsVideoTranscription,
  VIDEO_LOCAL_TRANSCRIPTION_MODELS,
} from '@/src/features/video-subtitle/transcription';
import {
  getVideoAiModelFileUrl,
  VIDEO_AI_Q4_MODEL_FILES,
} from '@/src/features/video-subtitle/offscreen/modelCache';

describe('视频 AI 字幕转写配置', () => {
  it('只允许 OpenAI-compatible 转写服务', () => {
    expect(supportsVideoTranscription('openai')).toBe(true);
    expect(supportsVideoTranscription('groq')).toBe(true);
    expect(supportsVideoTranscription('custom')).toBe(true);
    expect(supportsVideoTranscription('microsoft')).toBe(false);
  });

  it('把聊天补全地址映射到 audio/transcriptions', () => {
    expect(buildVideoTranscriptionEndpoint('openai')).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(buildVideoTranscriptionEndpoint('groq')).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(buildVideoTranscriptionEndpoint('custom', { custom: 'http://127.0.0.1:11434/v1/chat/completions' }))
      .toBe('http://127.0.0.1:11434/v1/audio/transcriptions');
    expect(buildVideoTranscriptionEndpoint('newapi', { newApiUrl: 'https://api.example.com' }))
      .toBe('https://api.example.com/v1/audio/transcriptions');
  });

  it('规范化识别语言和默认模型', () => {
    expect(normalizeVideoTranscriptionLanguage('zh-CN')).toBe('zh');
    expect(normalizeVideoTranscriptionLanguage('auto')).toBeUndefined();
    expect(getVideoTranscriptionModel('openai')).toBe('whisper-1');
    expect(getVideoTranscriptionModel('groq')).toBe('whisper-large-v3-turbo');
  });

  it('使用扩展内本地 Whisper 模型，并对非法选择回退到 Tiny', () => {
    expect(normalizeVideoLocalTranscriptionModel('base')).toBe('base');
    expect(normalizeVideoLocalTranscriptionModel('unknown')).toBe('tiny');
    expect(getVideoLocalTranscriptionModelId('base')).toBe('onnx-community/whisper-base');
    expect(getVideoLocalTranscriptionModelLabel('tiny')).toBe(VIDEO_LOCAL_TRANSCRIPTION_MODELS[0].label);
    expect(getVideoLocalTranscriptionModelDescription('base')).toBe(VIDEO_LOCAL_TRANSCRIPTION_MODELS[1].description);
    expect(normalizeVideoLocalTranscriptionModels(['tiny', 'base', 'unknown', 'tiny'])).toEqual(['tiny', 'base']);
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
