/**
 * @file src/features/video-subtitle/content/subtitleLogic.ts
 * 文件职责：提供字幕批量翻译、配置指纹和渐进文本展示的纯逻辑。
 * 主要内容：去重并限制批译并发，生成服务配置键，按原文进度截取译文。
 * 模块边界：只处理输入数据和注入翻译函数，不读取 DOM、全局配置或浏览器接口。
 */
import type {Config} from '@/src/core/config/model';
import {resolveConfiguredModel} from '@/src/core/config/catalog';
import type {VideoSubtitleCue} from './youtubeSubtitleData';

interface TranslateVideoSubtitleCuesOptions {
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

export function createVideoSubtitleAbortError(): Error {
  const error = new Error('字幕翻译已取消');
  error.name = 'AbortError';
  return error;
}

/**
 * 翻译完整字幕时间轴。相同原文只翻译一次，并限制同时进入共享翻译队列的任务数，
 * 避免长视频一次性排入数百个请求后阻塞播放器当前字幕。
 */
export async function translateVideoSubtitleCues(
  cues: VideoSubtitleCue[],
  translate: (source: string) => Promise<string>,
  options: TranslateVideoSubtitleCuesOptions = {},
): Promise<VideoSubtitleCue[]> {
  if (options.signal?.aborted) throw createVideoSubtitleAbortError();

  const sourceByKey = new Map<string, string>();
  cues.forEach((cue) => {
    const key = normalizeVideoCaptionText(cue.text);
    if (key && !sourceByKey.has(key)) sourceByKey.set(key, cue.text);
  });
  const sources = Array.from(sourceByKey.entries());
  if (sources.length === 0) return [];

  const requestedConcurrency = Number.isFinite(options.concurrency)
    ? Math.floor(options.concurrency as number)
    : 3;
  const concurrency = Math.min(sources.length, Math.max(1, requestedConcurrency));
  const translatedByKey = new Map<string, string>();
  let cursor = 0;
  let completed = 0;
  let failed = false;
  let failure: unknown;
  options.onProgress?.(completed, sources.length);

  const worker = async () => {
    while (!failed) {
      if (options.signal?.aborted) {
        failed = true;
        failure = createVideoSubtitleAbortError();
        return;
      }

      const index = cursor;
      cursor += 1;
      if (index >= sources.length) return;
      const [key, source] = sources[index];

      try {
        const translated = await translate(source);
        if (failed) return;
        if (options.signal?.aborted) throw createVideoSubtitleAbortError();
        const result = typeof translated === 'string' ? translated.trim() : '';
        if (!result) throw new Error(`字幕译文为空：${source.slice(0, 40)}`);
        translatedByKey.set(key, result);
        completed += 1;
        options.onProgress?.(completed, sources.length);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (failed) throw failure ?? new Error('字幕翻译失败');

  return cues.map((cue) => ({
    ...cue,
    text: translatedByKey.get(normalizeVideoCaptionText(cue.text)) || cue.text,
  }));
}

/** 与后台翻译 cache key 对齐的配置指纹；配置变化时旧译文不能写回视频。 */
export function getVideoTranslationConfigFingerprint(value: Config): string {
  const service = value.videoService;
  const endpoint = value.proxy[service]
    || (service === 'custom' ? value.custom : '')
    || (service === 'newapi' ? value.newApiUrl : '')
    || (service === 'deeplx' ? value.deeplx : '');
  return JSON.stringify({
    service,
    from: value.from,
    videoSourceLanguage: value.videoSourceLanguage,
    to: value.to,
    model: resolveConfiguredModel(value.model[service], value.customModel[service]),
    endpoint,
    azureOpenaiEndpoint: service === 'azureOpenai' ? value.azureOpenaiEndpoint : '',
    customBody: value.customBody[service] || '',
    customOpenAIProviders: value.customOpenAIProviders,
    modelThinking: value.modelThinking,
    systemRole: value.system_role[service] || '',
    userRole: value.user_role[service] || '',
    deepseekApiType: value.deepseekApiType,
    deepseekThinkingMode: value.deepseekThinkingMode,
    token: value.token[service] || '',
    appid: value.appid,
    key: value.key,
    useCache: value.useCache,
  });
}

export function normalizeVideoCaptionText(value: string): string {
  return value.replace(/[\s\u3000]+/g, ' ').trim();
}


export function isIncrementalVideoCaption(visibleSource: string, fullSource: string): boolean {
  const visible = normalizeVideoCaptionText(visibleSource).toLocaleLowerCase();
  const full = normalizeVideoCaptionText(fullSource).toLocaleLowerCase();
  return Boolean(visible && full && visible !== full && full.startsWith(visible));
}

function getVideoCaptionPrefixProgress(visibleSource: string, fullSource: string): number | null {
  const visible = normalizeVideoCaptionText(visibleSource);
  const full = normalizeVideoCaptionText(fullSource);
  if (!visible || !full) return null;

  const visibleFolded = visible.toLocaleLowerCase();
  const fullFolded = full.toLocaleLowerCase();
  if (visibleFolded === fullFolded) return 1;
  if (!fullFolded.startsWith(visibleFolded)) return null;

  const visibleLength = Array.from(visible).length;
  const fullLength = Array.from(full).length;
  return Math.min(1, visibleLength / fullLength);
}

/**
 * 原生字幕可能会先把一条 cue 逐词写入 DOM。完整 cue 已经翻译好时，
 * 只揭示与当前原文前缀相同比例的译文，避免连续说话期间一直空白或重复请求。
 * 如果站点一次性给出完整句，则直接返回整句，不人为增加播放延迟。
 */
export function revealVideoSubtitleTranslation(
  translatedText: string,
  visibleSource: string,
  fullSource: string,
): string {
  const translated = translatedText.trim();
  if (!translated) return '';

  const progress = getVideoCaptionPrefixProgress(visibleSource, fullSource);
  if (progress === null || progress >= 1) return translated;

  const units = Array.from(translated);
  const visibleLength = Math.max(1, Math.min(units.length, Math.ceil(units.length * progress)));
  return units.slice(0, visibleLength).join('');
}
