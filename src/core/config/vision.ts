/**
 * @file src/core/config/vision.ts
 * 文件职责：定义圈选图片识别的配置常量、传输边界和模型视觉能力解析。
 * 主要内容：仅对已核实的内置模型确认视觉能力；服务或模型未知时返回 unknown，并支持用户按服务和模型保存显式覆盖。
 * 模块边界：本文件只执行纯配置判断，不发起网络请求、不读取凭据，也不猜测模型名称；实际图片传输由翻译运行时负责。
 */

import {resolveConfiguredModel, services, servicesType} from './catalog';

export type AreaRecognitionMode = 'ocr' | 'prefer-vision';
export type ModelVisionCapability = 'supported' | 'unsupported' | 'unknown';
export type ModelVisionOverrides = Record<string, Record<string, boolean>>;
export interface AreaRecognitionRouteInput { areaRecognitionMode?: unknown; areaTranslationService?: unknown; service: string; model?: Record<string, string>; customModel?: Record<string, string>; modelVision?: ModelVisionOverrides; }
export interface AreaRecognitionRoute { mode: 'vision' | 'ocr'; fallback?: 'unsupported' | 'unknown'; service: string; model: string; }

export const DEFAULT_AREA_VISION_PROMPT = '请读取选区图片中的文字，按原有阅读顺序输出。保留名称、数字、标点和换行，不要解释图片内容，不要补写看不清的文字。';

// 这些条目只包含已有官方图像输入文档支持、且同时存在于 FluentRead 模型目录的精确编号。
// 核实日期 2026-09-12；后续模型和兼容接口由用户显式确认，不按名称前缀推断。
// https://developers.openai.com/api/docs/models/gpt-5.6-luna
// https://developers.openai.com/api/docs/models/gpt-5-mini
// https://developers.openai.com/api/docs/models/gpt-4.1-mini
// https://ai.google.dev/gemini-api/docs/models
// https://platform.claude.com/docs/en/models/overview
const VERIFIED_VISION_MODELS: Readonly<Record<string, ReadonlySet<string>>> = {
  openai: new Set(['gpt-5.6-luna', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano']),
  claude: new Set(['claude-opus-5', 'claude-sonnet-5']),
  gemini: new Set(['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro']),
};

export function supportsVisionTransport(service: string, _model?: string): boolean {
  const normalized = typeof service === 'string' ? service.trim() : '';
  const model = typeof _model === 'string' ? _model.trim() : '';
  if (!normalized || !model || servicesType.isMachine(normalized)) return false;
  if (normalized === services.tongyi && model.startsWith('qwen-mt')) return false;
  return servicesType.isAiSdk(normalized)
    || [services.gemini, services.claude, services.tongyi, services.zhipu].includes(normalized);
}

export function normalizeModelVisionOverrides(value: unknown): ModelVisionOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Array<[string, Record<string, boolean>]> = [];
  for (const [service, models] of Object.entries(value)) {
    if (!service.trim() || !models || typeof models !== 'object' || Array.isArray(models)) continue;
    const entries = Object.entries(models).filter(([model, supported]) => model.trim() && typeof supported === 'boolean') as Array<[string, boolean]>;
    if (entries.length) result.push([service.trim(), Object.fromEntries(entries.map(([model, supported]) => [model.trim(), supported] as const))]);
  }
  return Object.fromEntries(result);
}

export function resolveModelVisionCapability(
  service: string,
  model: string,
  overrides?: ModelVisionOverrides,
): ModelVisionCapability {
  const serviceId = typeof service === 'string' ? service.trim() : '';
  const modelId = typeof model === 'string' ? model.trim() : '';
  if (!modelId) return 'unknown';
  if (!supportsVisionTransport(serviceId, modelId)) return 'unsupported';
  const explicit = overrides?.[serviceId]?.[modelId];
  if (typeof explicit === 'boolean') return explicit ? 'supported' : 'unsupported';
  return VERIFIED_VISION_MODELS[serviceId]?.has(modelId) ? 'supported' : 'unknown';
}

export function resolveAreaRecognitionRoute(source: AreaRecognitionRouteInput): AreaRecognitionRoute {
  const service = typeof source.areaTranslationService === 'string' && source.areaTranslationService.trim() ? source.areaTranslationService.trim() : source.service.trim();
  const model = resolveConfiguredModel(source.model?.[service], source.customModel?.[service]).trim();
  const capability = resolveModelVisionCapability(service, model, source.modelVision);
  if (source.areaRecognitionMode === 'prefer-vision' && capability === 'supported') return {mode: 'vision', service, model};
  return {mode: 'ocr', service, model, ...(source.areaRecognitionMode === 'prefer-vision' ? {fallback: capability === 'unsupported' ? 'unsupported' : 'unknown'} : {})};
}
