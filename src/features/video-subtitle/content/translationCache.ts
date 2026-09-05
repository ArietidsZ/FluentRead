/**
 * @file src/features/video-subtitle/content/translationCache.ts
 * 文件职责：管理一个视频轨道的译文缓存、请求合并和失败重试退避。
 * 主要内容：限制缓存条数，按当前字幕优先级调度请求，并以版本隔离清理前的迟到结果。
 * 模块边界：只调用注入的翻译函数，不读取配置、网络或播放器；轨道和配置变化由 runtime 显式 clear。
 */
import {VideoTranslationScheduler} from './translationScheduler';
export class VideoTranslationCache {
  private readonly translatedVideoCache = new Map<string, string>();
  private readonly inFlightVideoTranslations = new Map<string, Promise<string>>();
  private readonly videoTranslationFailures = new Map<string, {attempts: number; retryAt: number}>();
  private readonly translationScheduler: VideoTranslationScheduler;
  private pretranslationCacheVersion = 0;
  constructor(translate: (text: string, signal: AbortSignal) => Promise<string>) {
    this.translationScheduler = new VideoTranslationScheduler(translate);
  }
  clear(): void {
    this.pretranslationCacheVersion += 1;
    this.translatedVideoCache.clear();
    this.inFlightVideoTranslations.clear();
    this.videoTranslationFailures.clear();
    this.translationScheduler.clear();
  }
  request(source: string, prefetch = false): Promise<string> {
    const key = source.replace(/[\s\u3000]+/g, ' ').trim();
    if (!key) return Promise.resolve(source);

    const cached = this.translatedVideoCache.get(key);
    if (cached !== undefined) return Promise.resolve(cached);

    const failure = this.videoTranslationFailures.get(key);
    if (failure && Date.now() < failure.retryAt) {
      // 播放器更新频率很高；失败退避期间返回空结果，避免 API Key/429 等
      // 错误每 120ms 重发并刷满日志与网络。
      return Promise.resolve('');
    }

    const existing = this.inFlightVideoTranslations.get(key);
    if (existing) {
      if (!prefetch) void this.translationScheduler.request(key).catch(() => undefined);
      return existing;
    }

    const requestVersion = this.pretranslationCacheVersion;
    let request: Promise<string>;
    request = this.translationScheduler.request(key, prefetch)
      .then((translated) => {
        const result = typeof translated === 'string' ? translated.trim() : '';
        if (requestVersion === this.pretranslationCacheVersion) {
          this.videoTranslationFailures.delete(key);
          this.translatedVideoCache.set(key, result || source);
          if (this.translatedVideoCache.size > 160) {
            const oldestKey = this.translatedVideoCache.keys().next().value;
            if (oldestKey) this.translatedVideoCache.delete(oldestKey);
          }
        }
        return typeof translated === 'string' ? translated : source;
      })
      .catch((error) => {
        if (requestVersion === this.pretranslationCacheVersion) {
          const previousAttempts = this.videoTranslationFailures.get(key)?.attempts || 0;
          const attempts = Math.min(previousAttempts + 1, 4);
          const retryDelays = [2_000, 5_000, 15_000, 30_000];
          this.videoTranslationFailures.set(key, {
            attempts,
            retryAt: Date.now() + retryDelays[attempts - 1],
          });
          if (this.videoTranslationFailures.size > 160) {
            const oldestKey = this.videoTranslationFailures.keys().next().value;
            if (oldestKey) this.videoTranslationFailures.delete(oldestKey);
          }
        }
        throw error;
      })
      .finally(() => {
        if (this.inFlightVideoTranslations.get(key) === request) this.inFlightVideoTranslations.delete(key);
      });
    this.inFlightVideoTranslations.set(key, request);
    return request;
  }
}
