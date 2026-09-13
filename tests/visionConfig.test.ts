/**
 * @file tests/visionConfig.test.ts
 * 文件职责：验证圈选视觉识别配置的默认兼容性、能力边界和显式覆盖。
 * 主要内容：覆盖 OCR 默认值、提示词保留、非法覆盖清洗、已核实模型、未知模型及机器翻译传输隔离。
 * 模块边界：测试只调用 core/config 纯函数，不启动浏览器、不发起 provider 请求。
 */
import {describe, expect, it} from 'vitest';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {
  DEFAULT_AREA_VISION_PROMPT,
  normalizeAreaVisionPrompt,
  normalizeModelVisionOverrides,
  resolveAreaRecognitionRoute,
  resolveModelVisionCapability,
  supportsVisionTransport,
} from '@/src/core/config/vision';

describe('vision configuration', () => {
  it('prefers model vision by default and supplies a prompt', () => {
    const config = normalizeConfig({});
    expect(config.areaRecognitionMode).toBe('prefer-vision');
    expect(config.areaVisionPrompt).toBe(DEFAULT_AREA_VISION_PROMPT);
    expect(config.modelVision).toEqual({});
    expect(new Config().areaRecognitionMode).toBe('prefer-vision');
    expect(DEFAULT_AREA_VISION_PROMPT).toContain('表格按行输出');
    expect(DEFAULT_AREA_VISION_PROMPT).toContain('[无法辨认]');
    expect(DEFAULT_AREA_VISION_PROMPT).toContain('不翻译');
  });

  it('keeps a user prompt unchanged and normalizes invalid values', () => {
    const prompt = '  保留换行\n不要猜测  ';
    expect(normalizeConfig({areaRecognitionMode: 'prefer-vision', areaVisionPrompt: prompt}).areaVisionPrompt).toBe(prompt);
    expect(normalizeConfig({areaRecognitionMode: 'bad', areaVisionPrompt: '   '}).areaRecognitionMode).toBe('prefer-vision');
    expect(normalizeConfig({areaRecognitionMode: 'ocr'}).areaRecognitionMode).toBe('ocr');
    expect(normalizeConfig({areaVisionPrompt: null}).areaVisionPrompt).toBe(DEFAULT_AREA_VISION_PROMPT);
    expect(normalizeAreaVisionPrompt('请读取选区图片中的文字，按原有阅读顺序输出。保留名称、数字、标点和换行，不要解释图片内容，不要补写看不清的文字。')).toBe(DEFAULT_AREA_VISION_PROMPT);
    expect(normalizeConfig({areaVisionPrompt: '请读取选区图片中的文字，按原有阅读顺序输出。保留名称、数字、标点和换行，不要解释图片内容，不要补写看不清的文字。'}).areaVisionPrompt).toBe(DEFAULT_AREA_VISION_PROMPT);
    expect(normalizeAreaVisionPrompt('用户自己的提示词')).toBe('用户自己的提示词');
    expect(normalizeModelVisionOverrides({openai: {' gpt-4.1 ': true, empty: 'yes'}, bad: null})).toEqual({openai: {'gpt-4.1': true}});
  });

  it('uses only exact verified models and explicit overrides', () => {
    expect(resolveModelVisionCapability('openai', 'gpt-4.1')).toBe('supported');
    expect(resolveModelVisionCapability('openai', 'gpt-5.6-luna')).toBe('supported');
    expect(resolveModelVisionCapability('gemini', 'gemini-3.6-flash')).toBe('supported');
    expect(resolveModelVisionCapability('claude', 'claude-sonnet-5')).toBe('supported');
    expect(resolveModelVisionCapability('openai', 'unconfirmed-next-model')).toBe('unknown');
    expect(resolveModelVisionCapability('openai', 'private-model', {openai: {'private-model': true}})).toBe('supported');
    expect(resolveModelVisionCapability('openai', 'private-model', {openai: {'private-model': false}})).toBe('unsupported');
    expect(resolveModelVisionCapability('microsoft', 'gpt-4.1', {microsoft: {'gpt-4.1': true}})).toBe('unsupported');
    expect(resolveModelVisionCapability('openai', '')).toBe('unknown');
  });

  it('accepts supported transports while excluding machine translation', () => {
    expect(supportsVisionTransport('openai', 'private-model')).toBe(true);
    expect(supportsVisionTransport('custom:team', 'private-model')).toBe(true);
    expect(supportsVisionTransport('gemini', 'gemini-2.5-flash')).toBe(true);
    expect(supportsVisionTransport('microsoft', 'gpt-4.1')).toBe(false);
    expect(supportsVisionTransport('tongyi', 'qwen3.7-max')).toBe(true);
    expect(supportsVisionTransport('tongyi', 'qwen-mt-plus')).toBe(false);
  });
  it('resolves preferred vision and truthful OCR fallbacks', () => {
    expect(resolveAreaRecognitionRoute({areaRecognitionMode: 'prefer-vision', service: 'openai', model: {openai: 'gpt-4.1'}}).mode).toBe('vision');
    expect(resolveAreaRecognitionRoute({areaRecognitionMode: 'prefer-vision', service: 'microsoft', model: {microsoft: 'x'}}).fallback).toBe('unsupported');
    expect(resolveAreaRecognitionRoute({areaRecognitionMode: 'prefer-vision', service: 'openai', model: {openai: 'x'}}).fallback).toBe('unknown');
  });
});

it('preserves intentionally empty prompts and accepts only boolean capability entries', () => {
  expect(normalizeConfig({areaVisionPrompt: ''}).areaVisionPrompt).toBe('');
  expect(normalizeConfig({areaVisionPrompt: '   '}).areaVisionPrompt).toBe('   ');
  for (const value of [null, false, [], 'bad']) expect(normalizeModelVisionOverrides(value)).toEqual({});
  expect(normalizeModelVisionOverrides({' ': {}, list: [], scalar: 1, empty: {x: 'true', ' ': true}})).toEqual({});
  const unsafe = JSON.parse('{"__proto__":{"custom-model":true}}');
  const normalized = normalizeModelVisionOverrides(unsafe);
  expect(Object.getPrototypeOf(normalized)).toBe(Object.prototype);
  expect(Object.hasOwn(normalized, '__proto__')).toBe(true);
  expect(resolveModelVisionCapability(undefined as unknown as string, undefined as unknown as string)).toBe('unknown');
  expect(supportsVisionTransport(undefined as unknown as string)).toBe(false);
  expect(supportsVisionTransport('openai')).toBe(false);
  expect(supportsVisionTransport('deepseek', 'deepseek-chat')).toBe(false);
});

it('keeps route selection scoped to the area service and resolves custom model names', () => {
  expect(resolveAreaRecognitionRoute({service:'openai'})).toEqual({service:'openai',model:'',mode:'ocr'});
  expect(resolveAreaRecognitionRoute({service:'openai',areaTranslationService:'   '})).toEqual({service:'openai',model:'',mode:'ocr'});
  expect(resolveAreaRecognitionRoute({service:'openai',areaTranslationService:42,areaRecognitionMode:'prefer-vision'}).fallback).toBe('unknown');
  expect(resolveAreaRecognitionRoute({service:'openai',areaTranslationService:' custom:team ',areaRecognitionMode:'prefer-vision',model:{'custom:team':'自定义模型'},customModel:{'custom:team':'private-vl'},modelVision:{'custom:team':{'private-vl':true}}})).toEqual({service:'custom:team',model:'private-vl',mode:'vision'});
});
