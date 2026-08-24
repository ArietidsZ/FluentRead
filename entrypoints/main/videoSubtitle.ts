import browser from 'webextension-polyfill';
import { config, saveConfig, subscribeConfig } from '@/entrypoints/utils/config';
import { options, resolveConfiguredModel, servicesType } from '@/entrypoints/utils/option';
import {
  normalizeVideoSubtitleFontSize,
  type Config,
  type VideoSubtitleDisplayMode,
} from '@/entrypoints/utils/model';
import { translateVideoText } from '@/entrypoints/utils/translateApi';
import {
  buildYoutubeTimedTextUrl,
  chooseYoutubeCaptionTrack,
  cuesToSrt,
  extractYoutubeCaptionTracks,
  finalizeVideoSubtitleCues,
  parseYoutubeTimedTextResponse,
  sanitizeSubtitleFilename,
  type VideoSubtitleCue,
} from './youtubeSubtitleData';
import {
  isXSubtitleResourceUrl,
  parseXSubtitleResource,
  type XSubtitleResource,
} from './xVideoSubtitleData';
import {
  normalizeVideoLocalTranscriptionModels,
  normalizeVideoLocalTranscriptionModel,
  VIDEO_LOCAL_TRANSCRIPTION_STATE_KEY,
} from '@/entrypoints/utils/videoTranscription';
import {
  getVisibleVideoAiCue,
  mergeVideoAiSubtitleCues,
  upsertVideoAiSubtitleCue,
  VIDEO_AI_CUE_EARLY_TOLERANCE_MS,
  VIDEO_AI_CUE_LATE_GRACE_MS,
  VIDEO_AI_CUE_MIN_DURATION_MS,
} from './video-ai/cueTimeline';
import {
  VideoAiCaptureController,
  type VideoAiAudioChunk,
  type VideoAiTranscriptionResult,
} from './video-ai/capture';
import {
  VideoAiFullCaptureController,
  type VideoAiFullCapturePhase,
  type VideoAiFullCaptureProgress,
} from './video-ai/fullCapture';
import { encodeVideoAiPcm16Base64 } from './video-ai/audioWindow';
import type { VideoAiStabilizedCue } from './video-ai/streamingTranscript';

// 兼容既有测试与外部调用方；AI 时间轴的实现位于 video-ai 目录。
export {
  getVisibleVideoAiCue,
  mergeVideoAiSubtitleCues,
  upsertVideoAiSubtitleCue,
  VIDEO_AI_CUE_EARLY_TOLERANCE_MS,
  VIDEO_AI_CUE_LATE_GRACE_MS,
} from './video-ai/cueTimeline';

export const VIDEO_AI_CAPTION_CONTAINER_ID = 'fluent-read-video-ai-caption-container';
export const VIDEO_CAPTION_CONTAINER_SELECTOR = '#ytp-caption-window-container, .ytp-caption-window-container, #fluent-read-video-ai-caption-container';
export const VIDEO_CAPTION_SEGMENT_SELECTOR = '.ytp-caption-segment';
export const VIDEO_TRANSLATION_OVERLAY_ID = 'fluent-read-video-subtitle';
export const VIDEO_NORMALIZED_CAPTION_OVERLAY_ID = 'fluent-read-video-subtitle-original';
export const VIDEO_SUBTITLE_PANEL_ID = 'fluent-read-video-subtitle-panel';
export const VIDEO_TRANSLATION_LAYER_ID = 'fluent-read-video-subtitle-layer';
export const VIDEO_TRANSLATION_BUTTON_ID = 'fluent-read-video-subtitle-button';
export const VIDEO_TRANSLATION_MENU_ID = 'fluent-read-video-subtitle-menu';

const VIDEO_PLAYER_SELECTOR = '#movie_player, .html5-video-player, [data-testid="videoPlayer"]';
const VIDEO_RIGHT_CONTROLS_SELECTOR = '.ytp-right-controls';
const VIDEO_FALLBACK_CONTROLS_CLASS = 'fluent-read-video-controls';
const VIDEO_X_SETTINGS_CONTROL_SELECTOR = [
  '[data-testid="videoPlayer"] button[aria-label*="Settings" i]',
  '[data-testid="videoPlayer"] button[aria-label*="设置"]',
  '[data-testid="videoPlayer"] button[title*="Settings" i]',
  '[data-testid="videoPlayer"] [data-testid*="settings" i]',
  '[data-testid="videoPlayer"] [data-testid*="setting" i]',
  'button[aria-label*="Settings" i]',
  'button[aria-label*="设置"]',
  'button[title*="Settings" i]',
  '[role="button"][aria-label*="Settings" i]',
  '[role="button"][aria-label*="设置"]',
].join(', ');
const VIDEO_TRANSLATION_ACTIVE_CLASS = 'fluent-read-video-subtitle-active';
const VIDEO_DISPLAY_TRANSLATION_ONLY_CLASS = 'fluent-read-video-display-translation-only';
const VIDEO_DISPLAY_ORIGINAL_ONLY_CLASS = 'fluent-read-video-display-original-only';
const VIDEO_DISPLAY_HIDDEN_CLASS = 'fluent-read-video-display-hidden';
const VIDEO_NORMALIZED_CAPTION_CLASS = 'fluent-read-video-normalized-caption';
const VIDEO_NORMALIZED_CAPTION_ACTIVE_CLASS = 'fluent-read-video-normalized-caption-active';
const VIDEO_SUBTITLE_PANEL_ACTIVE_CLASS = 'fluent-read-video-subtitle-panel-active';

const YOUTUBE_HOST_PATTERN = /(^|\.)youtube\.com$/i;
const YOUTUBE_MOBILE_HOST_PATTERN = /(^|\.)youtube-nocookie\.com$/i;
const YOUTUBE_TIMED_TEXT_MESSAGE = 'fluent-read-youtube-timedtext';
const X_SUBTITLE_RESOURCE_MESSAGE = 'fluent-read-x-video-subtitle-resource';

const VIDEO_DISPLAY_MODE_LABELS: Record<VideoSubtitleDisplayMode, string> = {
  bilingual: '双语',
  'translation-only': '仅译文',
  'original-only': '仅原文',
};

const VIDEO_CAPTION_EMPTY_GRACE_MS = 420;
const VIDEO_CAPTION_STABILITY_MS = 360;
const VIDEO_CAPTION_FALLBACK_SEGMENT_SELECTOR = '.captions-text';
export const VIDEO_PRETRANSLATION_MACHINE_WINDOW_MS = 10_000;
export const VIDEO_PRETRANSLATION_AI_WINDOW_MS = 30_000;

export function getVideoPretranslationWindowMs(service: string): number {
  return servicesType.isAI(service)
    ? VIDEO_PRETRANSLATION_AI_WINDOW_MS
    : VIDEO_PRETRANSLATION_MACHINE_WINDOW_MS;
}

export function normalizeVideoSubtitleDisplayMode(value: unknown): VideoSubtitleDisplayMode {
  if (value === 'translation-only' || value === 'original-only') return value;
  return 'bilingual';
}

export function getVideoServiceLabel(service: string): string {
  const item = options.services.find((candidate: any) => candidate.value === service);
  return item?.label || service;
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
    to: value.to,
    model: resolveConfiguredModel(value.model[service], value.customModel[service]),
    endpoint,
    azureOpenaiEndpoint: service === 'azureOpenai' ? value.azureOpenaiEndpoint : '',
    robotId: value.robot_id[service] || '',
    customBody: value.customBody[service] || '',
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
  return fullLength > 0 ? Math.min(1, visibleLength / fullLength) : null;
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
  if (units.length === 0) return '';
  const visibleLength = Math.max(1, Math.min(units.length, Math.ceil(units.length * progress)));
  return units.slice(0, visibleLength).join('');
}

function getTimedTextCacheKey(url: string): string {
  try {
    const parsed = new URL(url, window.location.href);
    return [
      parsed.searchParams.get('v') || '',
      parsed.searchParams.get('lang') || '',
      parsed.searchParams.get('tlang') || '',
      parsed.searchParams.get('kind') || '',
    ].join(':');
  } catch {
    return url;
  }
}

function isOriginalTimedTextUrl(url: string): boolean {
  try {
    return !new URL(url, window.location.href).searchParams.get('tlang');
  } catch {
    return false;
  }
}

function downloadSubtitleSrt(cues: VideoSubtitleCue[], languageCode: string): void {
  const srt = cuesToSrt(cues);
  if (!srt.trim()) throw new Error('字幕轨道没有可下载的内容');

  const title = sanitizeSubtitleFilename(document.title.replace(/\s*-\s*(?:YouTube|X)\s*$/i, ''));
  const language = sanitizeSubtitleFilename(languageCode || 'original');
  const blobUrl = URL.createObjectURL(new Blob([srt], { type: 'application/x-subrip;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = `${title}-${language}.srt`;
  anchor.style.display = 'none';
  (document.body || document.documentElement).appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

export function isYouTubeVideoPage(locationLike: Pick<Location, 'hostname' | 'pathname'> = window.location): boolean {
  const isYouTubeHost = YOUTUBE_HOST_PATTERN.test(locationLike.hostname) || YOUTUBE_MOBILE_HOST_PATTERN.test(locationLike.hostname);
  return isYouTubeHost && (locationLike.pathname === '/watch' || locationLike.pathname === '/shorts');
}

export function isXVideoPage(locationLike: Pick<Location, 'hostname' | 'pathname'> = window.location): boolean {
  const hostname = locationLike.hostname.toLowerCase();
  return isXHostPage(locationLike) && /\/status\/\d+(?:\/|$)/i.test(locationLike.pathname);
}

export function isXHostPage(locationLike: Pick<Location, 'hostname'> = window.location): boolean {
  return /(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(locationLike.hostname.toLowerCase());
}

export function isSupportedVideoPage(locationLike: Pick<Location, 'hostname' | 'pathname'> = window.location): boolean {
  return isYouTubeVideoPage(locationLike) || isXVideoPage(locationLike);
}

/** 读取当前播放器可见的原生字幕，不读取插件自己的译文节点。 */
function getVisibleCaptionSegments(container: Element): HTMLElement[] {
  const nativeSegments = Array.from(container.querySelectorAll<HTMLElement>(VIDEO_CAPTION_SEGMENT_SELECTOR));
  const candidates = nativeSegments.length > 0
    ? nativeSegments
    : Array.from(container.querySelectorAll<HTMLElement>(VIDEO_CAPTION_FALLBACK_SEGMENT_SELECTOR));

  return candidates.filter((segment) => !candidates.some((candidate) => candidate !== segment && candidate.contains(segment)));
}

export function readVisibleCaptionText(container: Element | null): string {
  if (!container) return '';

  const segments = getVisibleCaptionSegments(container)
    .map((segment) => segment.textContent?.replace(/[\s\u3000]+/g, ' ').trim() || '')
    .filter(Boolean);

  return segments.join(' ').replace(/[\s\u3000]+/g, ' ').trim();
}

function findCaptionContainer(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(VIDEO_CAPTION_CONTAINER_SELECTOR));
  return candidates.find((candidate) => readVisibleCaptionText(candidate))
    || candidates[0]
    || null;
}

function findVideoPlayer(): HTMLElement | null {
  const knownPlayer = document.querySelector<HTMLElement>(VIDEO_PLAYER_SELECTOR);
  if (knownPlayer) return knownPlayer;

  const video = document.querySelector<HTMLVideoElement>('video');
  let current = video?.parentElement || null;
  for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
    const rect = current.getBoundingClientRect();
    if (rect.width >= 240 && rect.height >= 120) return current;
  }
  return video?.parentElement || null;
}

function findXSettingsControl(player: HTMLElement): HTMLElement | null {
  if (!isXVideoPage()) return null;
  return player.querySelector<HTMLElement>(VIDEO_X_SETTINGS_CONTROL_SELECTOR);
}

/** X 的控制栏没有固定 class；从设置齿轮向上找最近的按钮组。 */
function findXNativeControls(player: HTMLElement, settingsControl: HTMLElement): HTMLElement | null {
  let candidate = settingsControl.parentElement;
  while (candidate && candidate !== player) {
    const interactiveCount = candidate.querySelectorAll('button, [role="button"]').length;
    if (interactiveCount >= 2) return candidate;
    candidate = candidate.parentElement;
  }
  return settingsControl.parentElement;
}

function getVideoPageKey(href = window.location.href): string {
  try {
    const url = new URL(href, window.location.href);
    return `${url.pathname}:${url.searchParams.get('v') || ''}`;
  } catch {
    return href;
  }
}

function markVideoUi(element: HTMLElement): void {
  element.classList.add('notranslate', 'fluent-read-video-ui');
  element.setAttribute('data-fluent-read-ui', 'video-subtitle');
  element.setAttribute('translate', 'no');
}

function createTextElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function getOrCreateVideoSubtitleLayer(player: HTMLElement): HTMLElement {
  let layer = player.querySelector<HTMLElement>(`#${VIDEO_TRANSLATION_LAYER_ID}`);
  if (!layer) {
    layer = document.createElement('div');
    layer.id = VIDEO_TRANSLATION_LAYER_ID;
    layer.className = 'fluent-read-video-subtitle-layer fluent-read-video-ui notranslate';
    layer.setAttribute('data-fluent-read-ui', 'video-subtitle');
    layer.setAttribute('translate', 'no');
    player.appendChild(layer);
  }
  return layer;
}

function getOrCreateVideoSubtitlePanel(player: HTMLElement): HTMLElement {
  const layer = getOrCreateVideoSubtitleLayer(player);
  const existing = layer.querySelector<HTMLElement>(`#${VIDEO_SUBTITLE_PANEL_ID}`);
  if (existing) return existing;

  const panel = document.createElement('div');
  panel.id = VIDEO_SUBTITLE_PANEL_ID;
  panel.className = 'fluent-read-video-subtitle-panel fluent-read-video-ui notranslate';
  panel.setAttribute('data-fluent-read-ui', 'video-subtitle');
  panel.setAttribute('translate', 'no');
  panel.setAttribute('aria-label', 'FluentRead 双语视频字幕');
  layer.appendChild(panel);
  return panel;
}

function getOrCreateTranslationOverlay(player: HTMLElement): HTMLElement {
  const panel = getOrCreateVideoSubtitlePanel(player);

  const existing = document.getElementById(VIDEO_TRANSLATION_OVERLAY_ID);
  if (existing instanceof HTMLElement) {
    if (existing.parentElement !== panel) panel.appendChild(existing);
    return existing;
  }

  const overlay = document.createElement('div');
  overlay.id = VIDEO_TRANSLATION_OVERLAY_ID;
  overlay.className = 'fluent-read-video-subtitle notranslate';
  overlay.setAttribute('data-fluent-read-ui', 'video-subtitle');
  overlay.setAttribute('translate', 'no');
  overlay.setAttribute('aria-live', 'polite');
  overlay.setAttribute('aria-label', 'FluentRead 视频字幕译文');
  panel.appendChild(overlay);
  return overlay;
}

function getOrCreateNormalizedCaptionOverlay(player: HTMLElement): HTMLElement {
  const panel = getOrCreateVideoSubtitlePanel(player);
  const existing = document.getElementById(VIDEO_NORMALIZED_CAPTION_OVERLAY_ID);
  if (existing instanceof HTMLElement) {
    if (existing.parentElement !== panel) panel.appendChild(existing);
    return existing;
  }

  const overlay = document.createElement('div');
  overlay.id = VIDEO_NORMALIZED_CAPTION_OVERLAY_ID;
  overlay.className = 'fluent-read-video-subtitle-original notranslate';
  overlay.setAttribute('data-fluent-read-ui', 'video-subtitle');
  overlay.setAttribute('translate', 'no');
  overlay.setAttribute('aria-live', 'polite');
  overlay.setAttribute('aria-label', '视频整段原文字幕');
  panel.appendChild(overlay);
  return overlay;
}

function removeTranslationOverlay(): void {
  document.querySelectorAll(`#${VIDEO_TRANSLATION_LAYER_ID}`).forEach((node) => node.remove());
  document.querySelectorAll(`#${VIDEO_TRANSLATION_OVERLAY_ID}`).forEach((node) => node.remove());
  document.querySelectorAll(`#${VIDEO_NORMALIZED_CAPTION_OVERLAY_ID}`).forEach((node) => node.remove());
}

function syncTranslationOverlayPosition(container: HTMLElement | null): void {
  if (!container) return;
  const overlay = document.getElementById(VIDEO_TRANSLATION_OVERLAY_ID);
  const normalizedOverlay = document.getElementById(VIDEO_NORMALIZED_CAPTION_OVERLAY_ID);
  const panel = document.getElementById(VIDEO_SUBTITLE_PANEL_ID);
  const player = findVideoPlayer();
  if (!overlay || !panel || !player) return;

  const playerRect = player.getBoundingClientRect();
  const visibleCaptionSegments = getVisibleCaptionSegments(container)
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  // YouTube 在字幕切换期间会短暂保留一个空的、甚至回到播放器顶部的容器。
  // 没有真实字幕片段时保留上一次位置，避免译文被重新定位到顶部后闪过。

  const playerWidth = playerRect.width || 960;
  const menu = document.getElementById(VIDEO_TRANSLATION_MENU_ID);
  const menuReserve = menu instanceof HTMLElement && !menu.hidden && playerWidth >= 640
    ? Math.min(menu.getBoundingClientRect().width + 20, playerWidth * .34)
    : 0;
  const availableWidth = Math.max(playerWidth - 24 - menuReserve, 160);
  const baseFontSize = Math.min(Math.max(playerWidth * .022, 16), 30);
  const fontScale = normalizeVideoSubtitleFontSize(config.videoSubtitleFontSize) / 100;
  panel.style.setProperty('--fluent-read-video-subtitle-font-size', `${baseFontSize * fontScale}px`);

  // 双语面板固定在播放器底部安全区上方；字幕内容变化只会改变面板向上的高度，
  // 不会把整组字幕重新锚定到不同的 top。
  const active = Boolean(overlay.textContent?.trim() || normalizedOverlay?.textContent?.trim());
  panel.classList.toggle(VIDEO_SUBTITLE_PANEL_ACTIVE_CLASS, active);
  panel.style.width = 'max-content';
  panel.style.setProperty('max-width', `${availableWidth}px`, 'important');
  panel.style.removeProperty('--fluent-read-video-subtitle-bottom');
  if (!active) return;

  // 背景只包住双语文本，并以播放器中心为锚点。长字幕仍受播放器宽度限制，
  // 超出时在面板内部换行，而不是把半透明背景铺满整行。
  panel.style.left = '12px';
  const measuredWidth = panel.getBoundingClientRect().width;
  const width = Math.min(Math.max(measuredWidth, 0), availableWidth);
  const usableRight = playerWidth - menuReserve - 12;
  const left = Math.max(12, Math.min((usableRight - width + 12) / 2, usableRight - width));
  panel.style.left = `${left}px`;

  // 双语模式下原生字幕仍然可见时，译文面板要放在原生字幕上方，不能用固定底部
  // 位置压住 YouTube 的分段字幕。逐词合并已经显示整段原文时，原文在同一个面板内，
  // 则继续使用固定底部锚点，避免随着原生 DOM 的词宽变化上下跳动。
  const layer = document.getElementById(VIDEO_TRANSLATION_LAYER_ID);
  const displayMode = normalizeVideoSubtitleDisplayMode(config.videoSubtitleDisplayMode);
  const normalizedCaptionActive = layer?.classList.contains(VIDEO_NORMALIZED_CAPTION_ACTIVE_CLASS) === true;
  if (displayMode === 'bilingual' && !normalizedCaptionActive && visibleCaptionSegments.length > 0) {
    const playerHeight = playerRect.height || 540;
    const nativeCaptionTop = Math.min(...visibleCaptionSegments.map((rect) => rect.top - playerRect.top));
    const panelHeight = panel.getBoundingClientRect().height;
    const fallbackBottom = Math.min(Math.max(playerHeight * .1, 52), 96);
    const maxBottom = Math.max(12, playerHeight - panelHeight - 12);
    const requestedBottom = playerHeight - nativeCaptionTop + 8;
    const bottom = Math.max(fallbackBottom, Math.min(requestedBottom, maxBottom));
    panel.style.setProperty('--fluent-read-video-subtitle-bottom', `${bottom}px`);
  }
}

function applyVideoDisplayState(container: HTMLElement): void {
  const mode = normalizeVideoSubtitleDisplayMode(config.videoSubtitleDisplayMode);
  container.classList.toggle(VIDEO_DISPLAY_TRANSLATION_ONLY_CLASS, mode === 'translation-only');
  container.classList.toggle(VIDEO_DISPLAY_ORIGINAL_ONLY_CLASS, mode === 'original-only');
  container.classList.toggle(VIDEO_DISPLAY_HIDDEN_CLASS, config.videoSubtitleVisible === false);
  container.setAttribute('data-fluent-read-video-display-mode', mode);
  const layer = document.getElementById(VIDEO_TRANSLATION_LAYER_ID);
  layer?.classList.toggle(VIDEO_DISPLAY_ORIGINAL_ONLY_CLASS, mode === 'original-only');
  layer?.classList.toggle(VIDEO_DISPLAY_HIDDEN_CLASS, config.videoSubtitleVisible === false);
  layer?.setAttribute('data-fluent-read-video-display-mode', mode);
}

function installVideoSubtitleStyle(): HTMLStyleElement {
  const existing = document.getElementById('fluent-read-video-subtitle-style');
  if (existing instanceof HTMLStyleElement) return existing;

  const style = document.createElement('style');
  style.id = 'fluent-read-video-subtitle-style';
  style.textContent = `
    #${VIDEO_AI_CAPTION_CONTAINER_ID} {
      position: absolute !important;
      inset: auto 0 0 !important;
      z-index: 1 !important;
      width: 100% !important;
      min-height: 1px !important;
      opacity: 0 !important;
      pointer-events: none !important;
      user-select: none !important;
      overflow: hidden !important;
    }
    #${VIDEO_AI_CAPTION_CONTAINER_ID} .${VIDEO_CAPTION_SEGMENT_SELECTOR.slice(1)} {
      display: block !important;
    }
    #${VIDEO_TRANSLATION_LAYER_ID} {
      position: absolute !important;
      inset: 0 !important;
      z-index: 2147483645 !important;
      overflow: visible !important;
      pointer-events: none !important;
      visibility: visible !important;
    }
    #${VIDEO_SUBTITLE_PANEL_ID} {
      display: none !important;
      position: absolute !important;
      z-index: 2 !important;
      box-sizing: border-box !important;
      max-width: calc(100% - 24px) !important;
      bottom: var(--fluent-read-video-subtitle-bottom, clamp(52px, 10%, 96px)) !important;
      margin: 0 !important;
      padding: 5px 8px 6px !important;
      border: 1px solid rgba(255, 255, 255, .1) !important;
      border-radius: 6px !important;
      background: rgba(12, 15, 22, .56) !important;
      box-shadow: 0 2px 6px rgba(0, 0, 0, .24), 0 0 0 1px rgba(0, 0, 0, .08) !important;
      backdrop-filter: blur(2px) !important;
      flex-direction: column !important;
      align-items: center !important;
      gap: 6px !important;
      overflow: visible !important;
      pointer-events: none !important;
      user-select: none !important;
      text-align: center !important;
    }
    #${VIDEO_SUBTITLE_PANEL_ID}.${VIDEO_SUBTITLE_PANEL_ACTIVE_CLASS} {
      display: flex !important;
    }
    #${VIDEO_TRANSLATION_OVERLAY_ID} {
      display: block !important;
      position: relative !important;
      z-index: 2 !important;
      box-sizing: border-box !important;
      width: auto !important;
      max-width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      color: #ffe45c !important;
      font-family: Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif !important;
      font-size: var(--fluent-read-video-subtitle-font-size, clamp(16px, 2.2vw, 30px)) !important;
      font-weight: 700 !important;
      line-height: 1.28 !important;
      text-align: center !important;
      -webkit-text-stroke: 1px #000 !important;
      paint-order: stroke fill !important;
      text-shadow: 0 1px 2px rgba(0, 0, 0, .72) !important;
      white-space: pre-wrap !important;
      pointer-events: none !important;
      user-select: none !important;
      visibility: visible !important;
    }
    #${VIDEO_TRANSLATION_OVERLAY_ID}:empty { display: none !important; }
    #${VIDEO_NORMALIZED_CAPTION_OVERLAY_ID} {
      display: none !important;
      position: relative !important;
      z-index: 1 !important;
      box-sizing: border-box !important;
      width: auto !important;
      max-width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      color: #fff !important;
      font-family: Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif !important;
      font-size: var(--fluent-read-video-subtitle-font-size, clamp(16px, 2.2vw, 30px)) !important;
      font-weight: 600 !important;
      line-height: 1.28 !important;
      text-align: center !important;
      text-shadow: 0 1px 2px rgba(0, 0, 0, .9), 0 0 4px rgba(0, 0, 0, .8) !important;
      white-space: pre-wrap !important;
      pointer-events: none !important;
      user-select: none !important;
      visibility: visible !important;
    }
    #${VIDEO_NORMALIZED_CAPTION_OVERLAY_ID}:empty { display: none !important; }
    #${VIDEO_TRANSLATION_LAYER_ID}.${VIDEO_NORMALIZED_CAPTION_ACTIVE_CLASS} #${VIDEO_NORMALIZED_CAPTION_OVERLAY_ID} {
      display: block !important;
    }
    #${VIDEO_TRANSLATION_LAYER_ID}.${VIDEO_DISPLAY_TRANSLATION_ONLY_CLASS} #${VIDEO_NORMALIZED_CAPTION_OVERLAY_ID},
    #${VIDEO_TRANSLATION_LAYER_ID}.${VIDEO_DISPLAY_ORIGINAL_ONLY_CLASS} #${VIDEO_TRANSLATION_OVERLAY_ID},
    #${VIDEO_TRANSLATION_LAYER_ID}.${VIDEO_DISPLAY_HIDDEN_CLASS} {
      visibility: hidden !important;
    }
    #${VIDEO_TRANSLATION_LAYER_ID}.${VIDEO_DISPLAY_TRANSLATION_ONLY_CLASS} #${VIDEO_NORMALIZED_CAPTION_OVERLAY_ID} {
      display: none !important;
    }
    #ytp-caption-window-container.${VIDEO_NORMALIZED_CAPTION_CLASS} .ytp-caption-segment,
    #ytp-caption-window-container.${VIDEO_NORMALIZED_CAPTION_CLASS} .captions-text,
    .ytp-caption-window-container.${VIDEO_NORMALIZED_CAPTION_CLASS} .ytp-caption-segment,
    .ytp-caption-window-container.${VIDEO_NORMALIZED_CAPTION_CLASS} .captions-text {
      visibility: hidden !important;
    }
    #${VIDEO_TRANSLATION_LAYER_ID}.${VIDEO_DISPLAY_HIDDEN_CLASS} {
      visibility: hidden !important;
    }
    #${VIDEO_TRANSLATION_BUTTON_ID} {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      align-self: center !important;
      width: 32px !important;
      height: 32px !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      color: #fff !important;
      cursor: pointer !important;
      font: inherit !important;
      line-height: 1 !important;
      vertical-align: middle !important;
      opacity: .9 !important;
    }
    #${VIDEO_TRANSLATION_BUTTON_ID}:hover,
    #${VIDEO_TRANSLATION_BUTTON_ID}:focus-visible { opacity: 1 !important; }
    #${VIDEO_TRANSLATION_BUTTON_ID} .fluent-read-video-subtitle-button-icon {
      display: block !important;
      width: 16px !important;
      height: 16px !important;
      border-radius: 4px !important;
      background: transparent !important;
      object-fit: cover !important;
      overflow: hidden !important;
      transform: translateY(0) !important;
    }
    #${VIDEO_TRANSLATION_BUTTON_ID}.fluent-read-video-subtitle-x-button {
      width: 28px !important;
      height: 28px !important;
    }
    #${VIDEO_TRANSLATION_BUTTON_ID}.${VIDEO_TRANSLATION_ACTIVE_CLASS} .fluent-read-video-subtitle-button-icon {
      background: #ec4899 !important;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, .16), 0 2px 8px rgba(236, 72, 153, .42) !important;
    }
    #${VIDEO_TRANSLATION_BUTTON_ID}:not(.${VIDEO_TRANSLATION_ACTIVE_CLASS}) .fluent-read-video-subtitle-button-icon {
      background: rgba(236, 72, 153, .16) !important;
      box-shadow: 0 0 0 1px rgba(236, 72, 153, .62), 0 2px 8px rgba(236, 72, 153, .2) !important;
    }
    .${VIDEO_FALLBACK_CONTROLS_CLASS} {
      position: absolute !important;
      right: 8px !important;
      bottom: 8px !important;
      z-index: 2147483646 !important;
      display: flex !important;
      align-items: center !important;
      min-height: 32px !important;
      border-radius: 6px !important;
      background: rgba(0, 0, 0, .22) !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} {
      position: absolute !important;
      right: 8px !important;
      bottom: 40px !important;
      z-index: 2147483646 !important;
      width: min(208px, calc(100vw - 16px)) !important;
      min-width: 0 !important;
      max-width: calc(100vw - 16px) !important;
      max-height: min(224px, calc(100% - 44px)) !important;
      box-sizing: border-box !important;
      padding: 4px !important;
      border: 1px solid rgba(255, 255, 255, .12) !important;
      border-radius: 9px !important;
      background: rgba(30, 30, 30, .97) !important;
      box-shadow: 0 8px 28px rgba(0, 0, 0, .42) !important;
      color: #fff !important;
      font: 10px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      writing-mode: horizontal-tb !important;
      text-orientation: mixed !important;
      word-break: normal !important;
      white-space: normal !important;
      overflow-y: auto !important;
      overscroll-behavior: contain !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID}[hidden] { display: none !important; }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-title {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 2px 4px 3px !important;
      color: rgba(255, 255, 255, .92) !important;
      font-weight: 700 !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-heading {
      display: inline-flex !important;
      align-items: baseline !important;
      gap: 4px !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-brand {
      color: #ff8fbd !important;
      font-size: 8px !important;
      letter-spacing: .02em !important;
      font-weight: 800 !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-title-text {
      color: rgba(255, 255, 255, .92) !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-beta {
      color: #ff8fbd !important;
      font-size: 8px !important;
      font-weight: 700 !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-item,
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-mode {
      display: flex !important;
      align-items: center !important;
      width: 100% !important;
      min-height: 23px !important;
      box-sizing: border-box !important;
      margin: 1px 0 !important;
      padding: 2px 4px !important;
      border: 0 !important;
      border-radius: 7px !important;
      background: transparent !important;
      color: rgba(255, 255, 255, .9) !important;
      cursor: pointer !important;
      font: inherit !important;
      text-align: left !important;
      min-width: 0 !important;
      writing-mode: horizontal-tb !important;
      word-break: keep-all !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-item:hover,
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-mode:hover,
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-item:focus-visible,
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-mode:focus-visible {
      background: rgba(255, 255, 255, .12) !important;
      outline: none !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-item:disabled {
      cursor: not-allowed !important;
      opacity: .55 !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-primary-action {
      min-height: 28px !important;
      margin: 2px 0 3px !important;
      border: 1px solid rgba(236, 72, 153, .42) !important;
      background: linear-gradient(135deg, rgba(236, 72, 153, .26), rgba(236, 72, 153, .12)) !important;
      color: #fff !important;
      font-weight: 800 !important;
      box-shadow: 0 4px 12px rgba(236, 72, 153, .16) !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-primary-action[aria-checked="true"] {
      border-color: rgba(92, 211, 163, .42) !important;
      background: rgba(36, 180, 126, .16) !important;
      box-shadow: none !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-primary-action:not([aria-checked="true"]) .fluent-read-video-menu-check {
      color: #ff8fbd !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-check {
      display: inline-block !important;
      width: 13px !important;
      color: #ff8fbd !important;
      font-weight: 800 !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-label {
      display: block !important;
      min-width: 0 !important;
      flex: 1 1 auto !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      writing-mode: horizontal-tb !important;
      word-break: keep-all !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-value {
      color: rgba(255, 255, 255, .58) !important;
      font-size: 8px !important;
      flex: none !important;
      white-space: nowrap !important;
      writing-mode: horizontal-tb !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-divider {
      height: 1px !important;
      margin: 3px 4px !important;
      background: rgba(255, 255, 255, .12) !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-caption {
      display: block !important;
      padding: 2px 4px 1px !important;
      color: rgba(255, 255, 255, .52) !important;
      font-size: 8px !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-mode {
      width: auto !important;
      flex: 1 !important;
      justify-content: center !important;
      padding: 4px 6px !important;
      color: rgba(255, 255, 255, .65) !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-mode[aria-checked="true"] {
      background: rgba(236, 72, 153, .24) !important;
      color: #fff !important;
    }
    #${VIDEO_TRANSLATION_MENU_ID} .fluent-read-video-menu-mode-group {
      display: flex !important;
      gap: 3px !important;
      padding: 1px 3px 3px !important;
    }
    #ytp-caption-window-container.${VIDEO_DISPLAY_TRANSLATION_ONLY_CLASS} .ytp-caption-segment,
    #ytp-caption-window-container.${VIDEO_DISPLAY_TRANSLATION_ONLY_CLASS} .captions-text,
    .ytp-caption-window-container.${VIDEO_DISPLAY_TRANSLATION_ONLY_CLASS} .ytp-caption-segment,
    .ytp-caption-window-container.${VIDEO_DISPLAY_TRANSLATION_ONLY_CLASS} .captions-text {
      visibility: hidden !important;
    }
    #ytp-caption-window-container.${VIDEO_DISPLAY_ORIGINAL_ONLY_CLASS} #${VIDEO_TRANSLATION_OVERLAY_ID},
    .ytp-caption-window-container.${VIDEO_DISPLAY_ORIGINAL_ONLY_CLASS} #${VIDEO_TRANSLATION_OVERLAY_ID},
    #ytp-caption-window-container.${VIDEO_DISPLAY_HIDDEN_CLASS},
    .ytp-caption-window-container.${VIDEO_DISPLAY_HIDDEN_CLASS} {
      visibility: hidden !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
  return style;
}

type VideoConfigPatch = Partial<Pick<Config, 'videoTranslationEnabled' | 'videoSubtitleVisible' | 'videoSubtitleDisplayMode' | 'videoSubtitleFontSize' | 'videoLocalModel'>>;

/**
 * 挂载 YouTube / X 播放器内的字幕翻译入口和字幕监听器。
 * X 的 AI 字幕是用户主动点击后，先完整采集视频音频，再交给扩展 offscreen
 * 页面内的本地 Whisper 模型和翻译服务；默认不会采集音频，音频不会离开浏览器。
 */
export function mountVideoSubtitleTranslation(): () => void {
  // X 是 SPA：内容脚本可能先在 /home 加载，之后才无刷新进入 /status。
  // 在 X 域常驻轻量控制器，真正的 UI/采集仍只在 status 页面启用。
  if (!isSupportedVideoPage() && !isXHostPage()) return () => undefined;

  const style = installVideoSubtitleStyle();
  let destroyed = false;
  let generation = 0;
  let lastSource = '';
  let lastTranslatedSource = '';
  let lastTranslatedText = '';
  let videoPageKey = getVideoPageKey();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let emptyCaptionTimer: ReturnType<typeof setTimeout> | undefined;
  let uiSyncTimer: number | undefined;
  let captionObserver: MutationObserver | undefined;
  let observedContainer: HTMLElement | null = null;
  let menuElement: HTMLElement | null = null;
  let buttonElement: HTMLButtonElement | null = null;
  let pendingTranslationSource = '';
  let pendingTranslationOverlay: HTMLElement | null = null;
  let translationLoopRunning = false;
  let stableCaptionTimer: ReturnType<typeof setTimeout> | undefined;
  let stableCaptionSource = '';
  let stableCaptionOverlay: HTMLElement | null = null;
  const capturedSubtitleTracks = new Map<string, { url: string; cues: VideoSubtitleCue[] }>();
  const translatedVideoCache = new Map<string, string>();
  const inFlightVideoTranslations = new Map<string, Promise<string>>();
  const videoTranslationFailures = new Map<string, { attempts: number; retryAt: number }>();
  let observedVideo: HTMLVideoElement | null = null;
  let pretranslationTimer: ReturnType<typeof setTimeout> | undefined;
  let pretranslationTrackRequest: Promise<void> | undefined;
  let pretranslationTrackRequestKey = '';
  let pretranslationTrackRetryAt = 0;
  let pretranslationTrackKey = '';
  let pretranslationCues: VideoSubtitleCue[] = [];
  let pretranslationCacheVersion = 0;
  let pretranslationConfigKey = getVideoTranslationConfigFingerprint(config);
  let progressiveCueKey = '';
  let progressiveCue: VideoSubtitleCue | null = null;
  let progressiveTranslation = '';
  let normalizedCaptionCueKey = '';
  let normalizedCaptionActive = false;
  let aiCapture: VideoAiCaptureController | null = null;
  let aiFullCapture: VideoAiFullCaptureController | null = null;
  let aiFullPhase: VideoAiFullCapturePhase = 'idle';
  let aiFullProgress: VideoAiFullCaptureProgress = {
    phase: 'idle',
    captureMode: undefined,
    progress: 0,
    capturedMs: 0,
    durationMs: 0,
    transcribedMs: 0,
    windowIndex: 0,
    windowCount: 0,
  };
  // 模型缺失和采集错误都在播放器菜单中以同一份状态展示。
  let aiCaptureError = '';
  let aiCues: VideoSubtitleCue[] = [];
  let activeAiModel = normalizeVideoLocalTranscriptionModel(config.videoLocalModel);
  const aiStreamId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `video-ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const xSubtitleVisitedResources = new Set<string>();
  let xSubtitleResourceCount = 0;
  const xSubtitleTrackKey = 'x:captions';
  let xSubtitleCues: VideoSubtitleCue[] = [];

  const isAiCaptureRunning = () => aiCapture?.isRunning() === true;
  const isAiFullActive = () => aiFullCapture?.isActive() === true;
  const isAiCaptureRequested = () => aiCapture?.isRequested() === true || aiFullCapture?.isRequested() === true;
  const isAiCaptureActive = () => isAiCaptureRunning() || isAiCaptureRequested();

  const getOrCreateSyntheticCaptionContainer = (): HTMLElement | null => {
    const player = findVideoPlayer();
    if (!player) return null;
    let container = document.getElementById(VIDEO_AI_CAPTION_CONTAINER_ID);
    if (!(container instanceof HTMLElement)) {
      container = document.createElement('div');
      container.id = VIDEO_AI_CAPTION_CONTAINER_ID;
      container.className = 'fluent-read-video-ai-caption-container fluent-read-video-ui notranslate';
      container.setAttribute('data-fluent-read-ui', 'video-subtitle');
      container.setAttribute('translate', 'no');
      const segment = document.createElement('span');
      segment.className = 'ytp-caption-segment';
      container.appendChild(segment);
    }
    if (container.parentElement !== player) player.appendChild(container);
    return container;
  };

  const getActiveCueAtTime = (cues: VideoSubtitleCue[], currentMs: number): VideoSubtitleCue | null => {
    if (!Number.isFinite(currentMs)) return null;
    let active: VideoSubtitleCue | null = null;
    for (const cue of cues) {
      const endMs = cue.startMs + Math.max(cue.durationMs, 500);
      if (currentMs < cue.startMs || currentMs >= endMs) continue;
      if (!active || cue.startMs > active.startMs) active = cue;
    }
    return active;
  };

  const getVisibleAiCueAtTime = (currentMs: number): VideoSubtitleCue | null =>
    getVisibleVideoAiCue(aiCues, currentMs);

  /** 将 X 的 TextTrack / sidecar / AI cue 统一映射到既有字幕翻译观察器。 */
  const syncXVideoCaptionSource = (): HTMLElement | null => {
    if (!isXVideoPage()) return null;
    const video = observedVideo || document.querySelector<HTMLVideoElement>('video');
    const container = getOrCreateSyntheticCaptionContainer();
    if (!container) return null;

    const currentMs = video && Number.isFinite(video.currentTime) ? video.currentTime * 1000 : Number.NaN;
    let text = '';
    let sourceKind = 'none';
    let cueId = '';

    // 用户主动请求 AI 字幕后，整个播放头由 AI 时间轴接管。不要在推理
    // 延迟期间偷偷切回 X 的原生/sidecar 文本，否则原文和译文会来回跳。
    if (isAiCaptureActive()) {
      const activeAiCue = getVisibleAiCueAtTime(currentMs);
      if (activeAiCue) {
        text = activeAiCue.text;
        sourceKind = 'ai';
        cueId = (activeAiCue as VideoSubtitleCue & { cueId?: string }).cueId || '';
      }
    } else if (video) {
      const tracks = Array.from(video.textTracks).sort((left, right) => {
        const preferred = (track: TextTrack) => {
          const language = `${track.language} ${track.label}`.toLowerCase();
          return config.from !== 'auto' && language.includes(config.from.toLowerCase()) ? 0 : 1;
        };
        return preferred(left) - preferred(right);
      });
      for (const track of tracks) {
        try {
          if (track.mode === 'disabled') track.mode = 'hidden';
        } catch {
          // 某些页面包装的 TextTrack 只读，继续尝试其它轨道。
        }
        const activeText = Array.from(track.activeCues || [])
          .map((cue) => String((cue as TextTrackCue & { text?: string }).text || '').trim())
          .filter(Boolean)
          .join('\n');
        if (activeText) {
          text = activeText;
          sourceKind = 'native';
          break;
        }
      }
    }

    if (!isAiCaptureActive() && !text && pretranslationTrackKey.startsWith('x:')) {
      const activeCue = getActiveCueAtTime(pretranslationCues, currentMs);
      if (activeCue) {
        text = activeCue.text;
        sourceKind = 'sidecar';
      }
    }
    if (!isAiCaptureActive() && !text && aiCues.length > 0) {
      const activeCue = getVisibleAiCueAtTime(currentMs);
      if (activeCue) {
        text = activeCue.text;
        sourceKind = 'ai';
        cueId = (activeCue as VideoSubtitleCue & { cueId?: string }).cueId || '';
      }
    }

    const segment = container.querySelector<HTMLElement>(VIDEO_CAPTION_SEGMENT_SELECTOR);
    if (!segment) return container;
    if (segment.textContent !== text) segment.textContent = text;
    const display = text ? 'block' : 'none';
    if (segment.style.display !== display) segment.style.display = display;
    if (container.dataset.fluentReadCaptionSource !== sourceKind) {
      container.dataset.fluentReadCaptionSource = sourceKind;
    }
    if (container.dataset.fluentReadCueId !== cueId) {
      container.dataset.fluentReadCueId = cueId;
    }
    return container;
  };

  const clearRenderedTranslation = () => {
    document.querySelectorAll(`#${VIDEO_TRANSLATION_OVERLAY_ID}`).forEach((node) => {
      node.textContent = '';
    });
  };

  const deactivateNormalizedCaption = () => {
    document.querySelectorAll(VIDEO_CAPTION_CONTAINER_SELECTOR).forEach((node) => {
      node.classList.remove(VIDEO_NORMALIZED_CAPTION_CLASS);
    });
    document.querySelectorAll(`#${VIDEO_TRANSLATION_LAYER_ID}`).forEach((node) => {
      node.classList.remove(VIDEO_NORMALIZED_CAPTION_ACTIVE_CLASS);
    });
    document.querySelectorAll(`#${VIDEO_NORMALIZED_CAPTION_OVERLAY_ID}`).forEach((node) => {
      node.textContent = '';
    });
    normalizedCaptionCueKey = '';
    normalizedCaptionActive = false;
  };

  const clearProgressiveCaption = () => {
    progressiveCueKey = '';
    progressiveCue = null;
    progressiveTranslation = '';
    deactivateNormalizedCaption();
  };

  const cancelCaptionEmptyClear = () => {
    if (!emptyCaptionTimer) return;
    clearTimeout(emptyCaptionTimer);
    emptyCaptionTimer = undefined;
  };

  const cancelStableCaption = () => {
    if (stableCaptionTimer) clearTimeout(stableCaptionTimer);
    stableCaptionTimer = undefined;
    stableCaptionSource = '';
    stableCaptionOverlay = null;
  };

  const resetTranslationState = () => {
    cancelCaptionEmptyClear();
    cancelStableCaption();
    generation += 1;
    lastSource = '';
    lastTranslatedSource = '';
    lastTranslatedText = '';
    pendingTranslationSource = '';
    pendingTranslationOverlay = null;
    clearProgressiveCaption();
    clearRenderedTranslation();
  };

  const canTranslateVideo = () => {
    const displayMode = normalizeVideoSubtitleDisplayMode(config.videoSubtitleDisplayMode);
    return config.on
      && config.videoTranslationEnabled
      && config.videoSubtitleVisible !== false
      && displayMode !== 'original-only';
  };

  const clearPretranslationState = (clearTrack = false) => {
    if (pretranslationTimer) {
      clearTimeout(pretranslationTimer);
      pretranslationTimer = undefined;
    }
    pretranslationCacheVersion += 1;
    translatedVideoCache.clear();
    inFlightVideoTranslations.clear();
    videoTranslationFailures.clear();
    resetTranslationState();
    if (clearTrack) {
      pretranslationTrackRequest = undefined;
      pretranslationTrackRequestKey = '';
      pretranslationTrackRetryAt = 0;
      pretranslationTrackKey = '';
      pretranslationCues = [];
    }
  };

  const normalizeVideoSourceKey = (source: string): string => source.replace(/[\s\u3000]+/g, ' ').trim();

  const getCachedVideoTranslation = (source: string): Promise<string> => {
    const key = normalizeVideoSourceKey(source);
    if (!key) return Promise.resolve(source);

    const cached = translatedVideoCache.get(key);
    if (cached !== undefined) return Promise.resolve(cached);

    const failure = videoTranslationFailures.get(key);
    if (failure && Date.now() < failure.retryAt) {
      // 播放器更新频率很高；失败退避期间返回空结果，避免 API Key/429 等
      // 错误每 120ms 重发并刷满日志与网络。
      return Promise.resolve('');
    }

    const existing = inFlightVideoTranslations.get(key);
    if (existing) return existing;

    const requestVersion = pretranslationCacheVersion;
    let request: Promise<string>;
    request = translateVideoText(source)
      .then((translated) => {
        const result = typeof translated === 'string' ? translated.trim() : '';
        if (requestVersion === pretranslationCacheVersion) {
          videoTranslationFailures.delete(key);
          translatedVideoCache.set(key, result || source);
          if (translatedVideoCache.size > 160) {
            const oldestKey = translatedVideoCache.keys().next().value;
            if (oldestKey) translatedVideoCache.delete(oldestKey);
          }
        }
        return typeof translated === 'string' ? translated : source;
      })
      .catch((error) => {
        if (requestVersion === pretranslationCacheVersion) {
          const previousAttempts = videoTranslationFailures.get(key)?.attempts || 0;
          const attempts = Math.min(previousAttempts + 1, 4);
          const retryDelays = [2_000, 5_000, 15_000, 30_000];
          videoTranslationFailures.set(key, {
            attempts,
            retryAt: Date.now() + retryDelays[attempts - 1],
          });
          if (videoTranslationFailures.size > 160) {
            const oldestKey = videoTranslationFailures.keys().next().value;
            if (oldestKey) videoTranslationFailures.delete(oldestKey);
          }
        }
        throw error;
      })
      .finally(() => {
        if (inFlightVideoTranslations.get(key) === request) inFlightVideoTranslations.delete(key);
      });
    inFlightVideoTranslations.set(key, request);
    return request;
  };

  const getCurrentVideoTimeMs = (): number => {
    const player = findVideoPlayer();
    const currentVideo = player?.querySelector<HTMLVideoElement>('video.html5-main-video, video') || observedVideo;
    const currentTime = currentVideo?.currentTime;
    return typeof currentTime === 'number' && Number.isFinite(currentTime)
      ? currentTime * 1000
      : Number.NaN;
  };

  const findProgressiveCue = (source: string): VideoSubtitleCue | null => {
    const normalizedSource = normalizeVideoCaptionText(source);
    if (!normalizedSource || pretranslationCues.length === 0) return null;

    const foldedSource = normalizedSource.toLocaleLowerCase();
    const currentMs = getCurrentVideoTimeMs();
    const sourceLength = Array.from(normalizedSource).length;
    const getTimeDistance = (cue: VideoSubtitleCue): number => {
      const endMs = cue.startMs + Math.max(cue.durationMs, 500);
      return Number.isFinite(currentMs)
        ? currentMs < cue.startMs
          ? cue.startMs - currentMs
          : currentMs > endMs
            ? currentMs - endMs
            : 0
        : 0;
    };
    const score = (cue: VideoSubtitleCue): number[] => {
      const fullSource = normalizeVideoCaptionText(cue.text);
      const exact = fullSource.toLocaleLowerCase() === foldedSource ? 0 : 1;
      return [
        getTimeDistance(cue),
        exact,
        Math.abs(Array.from(fullSource).length - sourceLength),
        cue.startMs,
      ];
    };

    const pickBest = (predicate: (cue: VideoSubtitleCue, foldedText: string) => boolean): VideoSubtitleCue | null => {
      let best: VideoSubtitleCue | null = null;
      let bestScore: number[] | null = null;
      for (const cue of pretranslationCues) {
        const foldedText = normalizeVideoCaptionText(cue.text).toLocaleLowerCase();
        if (!predicate(cue, foldedText)) continue;
        const nextScore = score(cue);
        let isBetter = bestScore === null;
        if (bestScore) {
          for (let index = 0; index < nextScore.length; index += 1) {
            if (nextScore[index] === bestScore[index]) continue;
            isBetter = nextScore[index] < bestScore[index];
            break;
          }
        }
        if (isBetter) {
          best = cue;
          bestScore = nextScore;
        }
      }
      return best;
    };

    const matched = pickBest((_cue, fullSource) =>
      fullSource === foldedSource || fullSource.startsWith(foldedSource));
    if (matched) return matched;

    // 部分 YouTube 版本只把“当前词”写入 DOM，而不是写入完整前缀。
    // 此时用播放器时间轴和当前词反查完整 cue，避免一直等不到稳定句子。
    if (!Number.isFinite(currentMs) || normalizedSource.length < 3) return null;
    return pickBest((cue, fullSource) => {
      if (getTimeDistance(cue) > 1200) return false;
      return fullSource.includes(foldedSource) || foldedSource.includes(fullSource);
    });
  };

  const getProgressiveCueKey = (cue: VideoSubtitleCue): string =>
    `${(cue as VideoSubtitleCue & { cueId?: string }).cueId || cue.startMs}:${normalizeVideoCaptionText(cue.text)}`;

  const isCueActiveAtTime = (cue: VideoSubtitleCue, currentMs: number): boolean => {
    const endMs = cue.startMs + Math.max(cue.durationMs, 500);
    return currentMs >= cue.startMs && currentMs < endMs;
  };

  const findActiveProgressiveCue = (): VideoSubtitleCue | null => {
    const currentMs = getCurrentVideoTimeMs();
    if (!Number.isFinite(currentMs) || pretranslationCues.length === 0) return null;

    let active: VideoSubtitleCue | null = null;
    for (const cue of pretranslationCues) {
      if (!isCueActiveAtTime(cue, currentMs)) continue;
      if (!active || cue.startMs > active.startMs) active = cue;
    }
    return active;
  };

  const selectProgressiveCue = (source: string): VideoSubtitleCue | null => {
    const matchedCue = findProgressiveCue(source);
    const activeCue = findActiveProgressiveCue();
    const currentMs = getCurrentVideoTimeMs();
    if (!activeCue) return matchedCue;
    // 没有任何文本匹配时不要凭时间轴猜测原生字幕内容；YouTube 可能刚切换
    // 字幕轨道，而 DOM 已经先显示了新文本，此时应回退到普通实时翻译。
    if (!matchedCue) return null;

    // 原生字幕 DOM 可能还停在上一条 cue，但播放器时间已经进入下一条。
    // 时间轴是此时唯一稳定的“当前字幕”信号，优先切换到 active cue，避免译文落后一整句。
    if (Number.isFinite(currentMs)
      && activeCue.startMs > matchedCue.startMs
      && !isCueActiveAtTime(matchedCue, currentMs)) {
      return activeCue;
    }
    if (activeCue.startMs > matchedCue.startMs && Number.isFinite(currentMs)) return activeCue;
    return matchedCue;
  };

  const renderProgressiveCaption = (source: string, overlay: HTMLElement, container: HTMLElement) => {
    if (!progressiveCue || !progressiveTranslation) return;

    const revealed = normalizedCaptionActive
      ? progressiveTranslation.trim()
      : revealVideoSubtitleTranslation(progressiveTranslation, source, progressiveCue.text);
    if (!revealed) return;
    overlay.textContent = revealed;
    syncTranslationOverlayPosition(container);
  };

  const updateProgressiveCaption = (source: string, overlay: HTMLElement, container: HTMLElement): boolean => {
    const cue = selectProgressiveCue(source);
    if (!cue) return false;

    cancelStableCaption();
    const cueKey = getProgressiveCueKey(cue);
    if (cueKey !== progressiveCueKey) {
      deactivateNormalizedCaption();
      progressiveCueKey = cueKey;
      progressiveCue = cue;
      progressiveTranslation = '';
      ++generation;
      lastTranslatedSource = '';
      lastTranslatedText = '';
      overlay.textContent = '';
    } else {
      progressiveCue = cue;
    }

    const syntheticCaptionActive = container.id === VIDEO_AI_CAPTION_CONTAINER_ID;
    const captionDiffersFromCue = normalizeVideoCaptionText(source) !== normalizeVideoCaptionText(cue.text);
    if (cueKey === normalizedCaptionCueKey || captionDiffersFromCue || syntheticCaptionActive) {
      normalizedCaptionActive = normalizedCaptionActive || captionDiffersFromCue;
      normalizedCaptionActive = normalizedCaptionActive || syntheticCaptionActive;
    }
    if (normalizedCaptionActive) {
      normalizedCaptionCueKey = cueKey;
      const player = findVideoPlayer();
      const normalizedOverlay = player ? getOrCreateNormalizedCaptionOverlay(player) : null;
      const layer = player?.querySelector<HTMLElement>(`#${VIDEO_TRANSLATION_LAYER_ID}`);
      if (normalizedOverlay && layer) {
        normalizedOverlay.textContent = cue.text;
        layer.classList.add(VIDEO_NORMALIZED_CAPTION_ACTIVE_CLASS);
        container.classList.add(VIDEO_NORMALIZED_CAPTION_CLASS);
      }
    }
    lastSource = source;

    if (progressiveTranslation) {
      renderProgressiveCaption(source, overlay, container);
    }

    const requestGeneration = generation;
    const requestCueKey = cueKey;
    const requestTrackVersion = pretranslationCacheVersion;
    const requestWasAiCue = pretranslationTrackKey === 'ai:capture';
    void getCachedVideoTranslation(cue.text).then((translated) => {
      const result = typeof translated === 'string' ? translated.trim() : '';
      if (!result || normalizeVideoCaptionText(result) === normalizeVideoCaptionText(cue.text)) return;
      if (destroyed || requestTrackVersion !== pretranslationCacheVersion) return;

      if (requestWasAiCue) {
        const availableAtMs = getCurrentVideoTimeMs();
        let timelineChanged = false;
        if (Number.isFinite(availableAtMs)) {
          aiCues = aiCues.map((candidate) => {
            if (getProgressiveCueKey(candidate) !== requestCueKey) return candidate;
            const current = candidate as VideoSubtitleCue & { translationAvailableAtMs?: number };
            if (typeof current.translationAvailableAtMs === 'number') return candidate;
            timelineChanged = true;
            return { ...candidate, translationAvailableAtMs: availableAtMs };
          });
        }
        if (timelineChanged) {
          // 即使原始语音时间窗已经结束，慢译文返回后也重新保证一段可读
          // 时间；若已有更新的 cue，它仍会按 startMs 优先显示，不会被旧句抢占。
          setPretranslationTrack('ai:capture', { url: 'ai:capture', cues: aiCues });
          syncXVideoCaptionSource();
          scheduleUpdate();
        }
      }

      if (requestGeneration !== generation || requestCueKey !== progressiveCueKey) return;
      progressiveTranslation = result;

      const currentContainer = findCaptionContainer();
      const currentSource = readVisibleCaptionText(currentContainer);
      const currentCue = currentSource ? selectProgressiveCue(currentSource) : findActiveProgressiveCue();
      const currentCueKey = currentCue ? getProgressiveCueKey(currentCue) : '';
      if (!currentContainer || !currentSource || currentCueKey !== requestCueKey) return;
      lastSource = currentSource;
      renderProgressiveCaption(currentSource, overlay, currentContainer);
    }).catch((error) => {
      if (!destroyed && requestGeneration === generation) {
        console.warn('[FluentRead] 视频字幕前置翻译失败', error);
      }
    });

    return true;
  };

  const primeUpcomingVideoCaptions = () => {
    if (destroyed || !canTranslateVideo() || !observedVideo || pretranslationCues.length === 0) return;
    const currentMs = observedVideo.currentTime * 1000;
    if (!Number.isFinite(currentMs)) return;

    const windowMs = getVideoPretranslationWindowMs(config.videoService);
    let queued = 0;
    for (const cue of pretranslationCues) {
      const endMs = cue.startMs + Math.max(cue.durationMs, 500);
      if (cue.startMs > currentMs + windowMs || endMs < currentMs - 500) continue;
      void getCachedVideoTranslation(cue.text).catch(() => undefined);
      queued += 1;
      if (queued >= 24) break;
    }
  };

  const schedulePretranslation = () => {
    if (pretranslationTimer || destroyed) return;
    pretranslationTimer = setTimeout(() => {
      pretranslationTimer = undefined;
      primeUpcomingVideoCaptions();
    }, 120);
  };

  const setPretranslationTrack = (key: string, entry: { url: string; cues: VideoSubtitleCue[] }) => {
    if (key === pretranslationTrackKey) {
      pretranslationCues = entry.cues;
      schedulePretranslation();
      return;
    }
    pretranslationTrackKey = key;
    pretranslationCues = entry.cues;
    pretranslationCacheVersion += 1;
    translatedVideoCache.clear();
    inFlightVideoTranslations.clear();
    videoTranslationFailures.clear();
    resetTranslationState();
    schedulePretranslation();
  };

  const getPreferredCapturedTrack = () => {
    const active = pretranslationTrackKey ? capturedSubtitleTracks.get(pretranslationTrackKey) : undefined;
    if (active) return [pretranslationTrackKey, active] as const;
    const captured = Array.from(capturedSubtitleTracks.entries());
    const original = captured.find(([, entry]) => isOriginalTimedTextUrl(entry.url));
    return original || captured[0] || null;
  };

  const appendXSubtitleCues = (url: string, cues: VideoSubtitleCue[]) => {
    if (cues.length === 0) return;
    xSubtitleCues = finalizeVideoSubtitleCues([...xSubtitleCues, ...cues]).slice(0, 4000);
    const entry = { url, cues: xSubtitleCues };
    capturedSubtitleTracks.set(xSubtitleTrackKey, entry);
    if (canTranslateVideo() && !isAiCaptureActive()) {
      setPretranslationTrack(xSubtitleTrackKey, entry);
      scheduleUpdate();
    }
  };

  const loadXSubtitleResource = async (
    resource: XSubtitleResource,
    responseText?: string,
    expectedPageKey = videoPageKey,
  ): Promise<void> => {
    if (destroyed || !isXVideoPage() || xSubtitleResourceCount >= 96) return;
    const url = resource.url;
    if (xSubtitleVisitedResources.has(url)) return;
    xSubtitleVisitedResources.add(url);
    xSubtitleResourceCount += 1;

    try {
      const source = responseText ?? await (await fetch(url, { credentials: 'omit' })).text();
      if (destroyed || expectedPageKey !== videoPageKey || expectedPageKey !== getVideoPageKey()) return;
      const parsed = parseXSubtitleResource(source, url);
      const offsetMs = resource.offsetMs || 0;
      const cues = parsed.cues.map((cue) => ({ ...cue, startMs: cue.startMs + offsetMs }));
      appendXSubtitleCues(url, cues);

      await Promise.all(parsed.resources.slice(0, 32).map((nested) => loadXSubtitleResource({
        ...nested,
        offsetMs: nested.offsetMs + offsetMs,
      }, undefined, expectedPageKey)));
    } catch {
      // X 会同时请求视频分片和字幕分片；非文本分片或已过期 URL 直接跳过。
    }
  };

  const handleXSubtitleResourceMessage = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin || !isXVideoPage()) return;
    const data = event.data as {
      source?: unknown;
      type?: unknown;
      url?: unknown;
      responseText?: unknown;
      pageHref?: unknown;
    } | null;
    if (data?.source !== 'fluent-read' || data.type !== X_SUBTITLE_RESOURCE_MESSAGE) return;
    if (typeof data.url !== 'string' || typeof data.responseText !== 'string' || !isXSubtitleResourceUrl(data.url)) return;
    if (typeof data.pageHref === 'string' && getVideoPageKey(data.pageHref) !== videoPageKey) return;
    void loadXSubtitleResource({ url: data.url, offsetMs: 0 }, data.responseText);
  };

  const ensurePretranslationTrack = () => {
    if (destroyed || !canTranslateVideo()) return;

    // AI 请求期间只允许 ai:capture 驱动翻译。X 的 sidecar 捕获会持续到达；
    // 若每秒把 track 切回 x:captions，就会反复清空 AI 翻译缓存，表现为
    // “识别有文字但译文不出现”或译文闪烁。
    if (isXVideoPage() && isAiCaptureActive()) {
      setPretranslationTrack('ai:capture', { url: 'ai:capture', cues: aiCues });
      return;
    }

    const captured = getPreferredCapturedTrack();
    if (captured) {
      setPretranslationTrack(captured[0], captured[1]);
      return;
    }

    if (isXVideoPage()) return;

    const track = chooseYoutubeCaptionTrack(extractYoutubeCaptionTracks(document), config.from);
    if (!track) return;
    const url = buildYoutubeTimedTextUrl(track);
    const key = getTimedTextCacheKey(url);
    if (key === pretranslationTrackKey && pretranslationCues.length > 0) return;
    if (pretranslationTrackRequest) return;
    if (pretranslationTrackRequestKey === key && Date.now() < pretranslationTrackRetryAt) return;

    pretranslationTrackRequestKey = key;
    const requestVersion = pretranslationCacheVersion;
    const request = (async () => {
      try {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error(`字幕轨道请求失败（${response.status}）`);
        const cues = finalizeVideoSubtitleCues(parseYoutubeTimedTextResponse(await response.text()));
        if (cues.length === 0) {
          pretranslationTrackRetryAt = Date.now() + 5000;
          return;
        }
        if (destroyed || requestVersion !== pretranslationCacheVersion) return;
        const entry = { url, cues };
        capturedSubtitleTracks.set(key, entry);
        setPretranslationTrack(key, entry);
        pretranslationTrackRetryAt = 0;
        scheduleUpdate();
      } catch {
        // 页面尚未准备好字幕轨道时，保留 DOM 实时翻译回退，并降低重试频率。
        pretranslationTrackRetryAt = Date.now() + 5000;
      }
    })();
    pretranslationTrackRequest = request;
    void request.then(
      () => {
        if (pretranslationTrackRequest === request) pretranslationTrackRequest = undefined;
      },
      () => {
        if (pretranslationTrackRequest === request) pretranslationTrackRequest = undefined;
      },
    );
  };

  const syncVideoElement = () => {
    const player = findVideoPlayer();
    const nextVideo = player?.querySelector<HTMLVideoElement>('video.html5-main-video, video')
      || document.querySelector<HTMLVideoElement>('video.html5-main-video, video');
    if (nextVideo === observedVideo) return;
    const previousVideo = observedVideo;
    observedVideo = nextVideo || null;
    if (previousVideo && previousVideo !== observedVideo && isAiFullActive()) {
      // X 会在同一页面替换 video 节点。完整扫描绑定的是旧音轨，不能把
      // 新节点的音频拼进旧时间轴；取消后由用户重新发起完整生成。
      stopFullAiSubtitleGeneration();
    } else if (previousVideo && previousVideo !== observedVideo && aiCapture?.isRequested()) {
      // X 会在同一页面替换 video 节点。旧 AudioContext 不能继续把上一条
      // 视频的 PCM 映射到新播放器时间轴。
      aiCapture.resetAfterSeek();
    }
    if (!observedVideo) return;
    schedulePretranslation();
  };

  const appendAiSubtitleCue = (cue: VideoAiStabilizedCue) => {
    const cleaned = normalizeVideoCaptionText(cue.text);
    if (!cleaned) return;
    aiCues = upsertVideoAiSubtitleCue(aiCues, {
      ...cue,
      startMs: Math.max(0, cue.startMs),
      durationMs: Math.max(cue.durationMs, VIDEO_AI_CUE_MIN_DURATION_MS),
      text: cleaned,
    });
    setPretranslationTrack('ai:capture', { url: 'ai:capture', cues: aiCues });
    aiCaptureError = '';
    syncXVideoCaptionSource();
    scheduleUpdate();
  };

  const transcribeAiAudioChunk = async (chunk: VideoAiAudioChunk): Promise<VideoAiTranscriptionResult> => {
    if (destroyed || chunk.pcm.length === 0) return { skipped: true };
    const response = await browser.runtime.sendMessage({
      type: 'fluentReadTranscribeLocalVideoAudio',
      streamId: aiStreamId,
      generation: chunk.sessionId,
      audioPcm16Base64: encodeVideoAiPcm16Base64(chunk.pcm),
      model: activeAiModel,
      sourceLanguage: config.from,
    }) as {
      success?: boolean;
      text?: string;
      segments?: Array<{ startMs?: number; endMs?: number; text?: string }>;
      skipped?: boolean;
      model?: string;
      backend?: 'webgpu' | 'wasm';
      gpuInfo?: string;
      decodeMs?: number;
      inferenceMs?: number;
      audioDurationMs?: number;
      threads?: number;
      dtype?: 'q4' | 'q8';
      error?: string;
    } | undefined;
    if (!response?.success) {
      throw new Error(response?.error || 'AI 字幕接口没有返回文字');
    }
    return {
      text: response.text,
      segments: response.segments,
      skipped: response.skipped,
      model: response.model,
      backend: response.backend,
      gpuInfo: response.gpuInfo,
      decodeMs: response.decodeMs,
      inferenceMs: response.inferenceMs,
      audioDurationMs: response.audioDurationMs,
      threads: response.threads,
      dtype: response.dtype,
    };
  };

  const setAiFullProgress = (progress: Partial<VideoAiFullCaptureProgress>) => {
    aiFullProgress = { ...aiFullProgress, ...progress };
    aiFullPhase = aiFullProgress.phase;
    updatePlayerUiState();
  };

  const resetAiSubtitleCues = () => {
    aiCues = [];
    // AI 完整生成是一轮新的字幕时间轴；旧一轮的翻译不能因为 cue 文本
    // 偶然相同而混入新视频/新模型。
    pretranslationCacheVersion += 1;
    translatedVideoCache.clear();
    inFlightVideoTranslations.clear();
    videoTranslationFailures.clear();
    resetTranslationState();
    setPretranslationTrack('ai:capture', { url: 'ai:capture', cues: aiCues });
  };

  const shouldTranslateFullAiCues = () => config.on
    && config.videoSubtitleVisible !== false
    && normalizeVideoSubtitleDisplayMode(config.videoSubtitleDisplayMode) !== 'original-only';

  const translateFullAiCues = async (
    cues: VideoAiStabilizedCue[],
    sessionId: number,
  ): Promise<void> => {
    if (!shouldTranslateFullAiCues()) return;
    const uniqueSources = [...new Set(cues
      .map((cue) => normalizeVideoSourceKey(cue.text))
      .filter(Boolean))];
    if (uniqueSources.length === 0) return;

    let nextIndex = 0;
    let completed = 0;
    const worker = async () => {
      while (nextIndex < uniqueSources.length) {
        if (destroyed || !aiFullCapture?.isRequested() || aiFullCapture.getSessionId() !== sessionId) {
          throw new Error('本地视频完整 AI 字幕已取消');
        }
        const source = uniqueSources[nextIndex++];
        await getCachedVideoTranslation(source);
        completed += 1;
        setAiFullProgress({
          phase: 'translating',
          progress: 0.85 + completed / uniqueSources.length * 0.15,
          windowIndex: completed,
          windowCount: uniqueSources.length,
        });
      }
    };
    // 翻译请求限为 2 路，避免“完整生成”把翻译服务和浏览器请求队列打满。
    await Promise.all([worker(), worker()]);
  };

  const prepareFullAiCues = async (cues: VideoAiStabilizedCue[], sessionId: number): Promise<void> => {
    const normalizedCues = cues
      .map((cue) => ({
        ...cue,
        startMs: Math.max(0, cue.startMs),
        durationMs: Math.max(cue.durationMs, VIDEO_AI_CUE_MIN_DURATION_MS),
        text: normalizeVideoCaptionText(cue.text),
        availableAtMs: 0,
        translationAvailableAtMs: 0,
      }))
      .filter((cue) => cue.text);
    await translateFullAiCues(normalizedCues, sessionId);
    if (destroyed || !aiFullCapture?.isRequested() || aiFullCapture.getSessionId() !== sessionId) {
      throw new Error('本地视频完整 AI 字幕已取消');
    }
    aiCues = normalizedCues;
    setPretranslationTrack('ai:capture', { url: 'ai:capture', cues: aiCues });
    aiCaptureError = '';
    syncXVideoCaptionSource();
    scheduleUpdate();
  };

  aiFullCapture = new VideoAiFullCaptureController({
    getVideo: () => observedVideo || document.querySelector<HTMLVideoElement>('video'),
    getModel: () => activeAiModel,
    isSupported: () => !destroyed && isXVideoPage(),
    transcribe: transcribeAiAudioChunk,
    onTranscriptionComplete: prepareFullAiCues,
    onError: (error) => {
      aiFullPhase = 'error';
      aiFullProgress = { ...aiFullProgress, phase: 'error', progress: 0 };
      aiCaptureError = /decode|解码|audio data|音频/i.test(error.message)
        ? '当前视频音频格式暂不支持，请重试或使用桌面版 Chrome/Edge'
        : error.message;
      console.warn('[FluentRead] X AI 完整字幕请求失败', error);
      syncXVideoCaptionSource();
      updatePlayerUiState();
    },
    onStateChange: () => {
      syncXVideoCaptionSource();
      scheduleUpdate();
      updatePlayerUiState();
    },
    onProgress: (progress) => {
      setAiFullProgress(progress);
    },
    onSessionStart: (sessionId) => {
      void browser.runtime.sendMessage({
        type: 'fluentReadPrepareLocalVideoModel',
        model: activeAiModel,
        keepWarm: true,
        streamId: aiStreamId,
        generation: sessionId,
      }).catch(() => undefined);
    },
    onInvalidate: (reason, sessionId) => {
      void browser.runtime.sendMessage({
        type: 'fluentReadCancelLocalVideoTranscription',
        streamId: aiStreamId,
        generation: sessionId,
        reason,
      }).catch(() => undefined);
    },
  });

  aiCapture = new VideoAiCaptureController({
    getVideo: () => observedVideo || document.querySelector<HTMLVideoElement>('video'),
    getModel: () => activeAiModel,
    isSupported: () => !destroyed && isXVideoPage(),
    transcribe: transcribeAiAudioChunk,
    onCue: appendAiSubtitleCue,
    onReset: () => {
      resetAiSubtitleCues();
    },
    onError: (error) => {
      const message = error.message;
      aiCaptureError = /decode|解码|audio data/i.test(message)
        ? '当前视频音频格式暂不支持，请重试或使用桌面版 Chrome/Edge'
        : message;
      console.warn('[FluentRead] X AI 字幕请求失败', error);
    },
    onStateChange: () => {
      syncXVideoCaptionSource();
      scheduleUpdate();
      updatePlayerUiState();
    },
    onSessionStart: (generation) => {
      // 模型初始化与首个 2.4 秒音频窗口并行；不等待预热结果，首个真实
      // 转写请求仍是最终兜底。stream + generation 让暂停/停止可精确终止
      // 尚未完成的冷启动，避免后台 Worker 在用户停止后继续吃满 CPU。
      void browser.runtime.sendMessage({
        type: 'fluentReadPrepareLocalVideoModel',
        model: activeAiModel,
        keepWarm: true,
        streamId: aiStreamId,
        generation,
      }).catch(() => undefined);
    },
    onDiagnostic: (diagnostic) => {
      const container = getOrCreateSyntheticCaptionContainer();
      if (container) {
        container.dataset.fluentReadVideoAiDiagnostic = JSON.stringify({
          sessionId: diagnostic.sessionId,
          sequence: diagnostic.sequence,
          model: diagnostic.model,
          backend: diagnostic.backend,
          threads: diagnostic.threads,
          dtype: diagnostic.dtype,
          skipped: diagnostic.skipped === true,
          decodeMs: Math.round(diagnostic.decodeMs || 0),
          inferenceMs: Math.round(diagnostic.inferenceMs || 0),
          audioDurationMs: Math.round(diagnostic.audioDurationMs || diagnostic.capturedAudioMs),
          realtimeFactor: typeof diagnostic.realtimeFactor === 'number'
            ? Number(diagnostic.realtimeFactor.toFixed(3))
            : undefined,
          effectiveSubmitStepMs: Math.round(diagnostic.effectiveSubmitStepMs),
          windowStartMs: Math.round(diagnostic.windowStartMs),
          windowEndMs: Math.round(diagnostic.windowEndMs),
          submittedAtWallMs: Math.round(diagnostic.submittedAtWallMs),
          completedAtWallMs: Math.round(diagnostic.completedAtWallMs),
          resultAvailableAtMs: Math.round(diagnostic.resultAvailableAtMs),
          emittedCueCount: diagnostic.emittedCueCount,
          droppedAudioMs: Math.round(diagnostic.droppedAudioMs),
        });
      }
      if (import.meta.env.DEV) console.debug('[FluentRead] X AI 字幕窗口完成', diagnostic);
    },
    onInvalidate: (reason, generation) => {
      void browser.runtime.sendMessage({
        type: 'fluentReadCancelLocalVideoTranscription',
        streamId: aiStreamId,
        generation,
        reason,
      }).catch(() => undefined);
    },
  });

  const startAiSubtitleCapture = (clearExistingCues = true): boolean => {
    if (!aiCapture) return false;
    activeAiModel = normalizeVideoLocalTranscriptionModel(config.videoLocalModel);
    const started = aiCapture.start(clearExistingCues);
    if (started) persistVideoConfig({ videoTranslationEnabled: true, videoSubtitleVisible: true });
    return started;
  };

  const startFullAiSubtitleGeneration = (): boolean => {
    if (!aiFullCapture) return false;
    activeAiModel = normalizeVideoLocalTranscriptionModel(config.videoLocalModel);
    resetAiSubtitleCues();
    aiFullPhase = 'capturing';
    aiFullProgress = {
      phase: 'capturing',
      captureMode: 'realtime-scan',
      progress: 0,
      capturedMs: 0,
      durationMs: 0,
      transcribedMs: 0,
      windowIndex: 0,
      windowCount: 0,
    };
    aiCaptureError = '';
    persistVideoConfig({ videoTranslationEnabled: true, videoSubtitleVisible: true });
    const started = aiFullCapture.start();
    if (!started) {
      syncXVideoCaptionSource();
      updatePlayerUiState();
    }
    return started;
  };

  const stopAiSubtitleCapture = (invalidatePending = false) => {
    if (!aiCapture) return;
    if (invalidatePending) aiCapture.cancel();
    else aiCapture.pause();
  };

  const stopFullAiSubtitleGeneration = () => {
    aiFullCapture?.cancel();
    resetAiSubtitleCues();
    aiFullPhase = 'idle';
    aiFullProgress = {
      phase: 'idle',
      captureMode: undefined,
      progress: 0,
      capturedMs: 0,
      durationMs: 0,
      transcribedMs: 0,
      windowIndex: 0,
      windowCount: 0,
    };
    syncXVideoCaptionSource();
    updatePlayerUiState();
  };

  const resetAiSubtitleAfterSeek = () => {
    aiCapture?.resetAfterSeek();
  };

  const scheduleCaptionEmptyClear = () => {
    if (emptyCaptionTimer) return;
    emptyCaptionTimer = setTimeout(() => {
      emptyCaptionTimer = undefined;
      if (destroyed || readVisibleCaptionText(findCaptionContainer())) return;
      resetTranslationState();
    }, VIDEO_CAPTION_EMPTY_GRACE_MS);
  };

  const closeMenu = () => {
    const menu = menuElement?.isConnected ? menuElement : document.getElementById(VIDEO_TRANSLATION_MENU_ID);
    const button = buttonElement?.isConnected ? buttonElement : document.getElementById(VIDEO_TRANSLATION_BUTTON_ID);
    if (menu) menu.hidden = true;
    button?.setAttribute('aria-expanded', 'false');
    syncTranslationOverlayPosition(findCaptionContainer());
  };

  const updatePlayerUiState = () => {
    const button = buttonElement?.isConnected ? buttonElement : document.getElementById(VIDEO_TRANSLATION_BUTTON_ID);
    const menu = menuElement?.isConnected ? menuElement : document.getElementById(VIDEO_TRANSLATION_MENU_ID);
    if (!button || !menu) return;
    if (button instanceof HTMLButtonElement) buttonElement = button;
    if (menu instanceof HTMLElement) menuElement = menu;

    const enabled = config.on && config.videoTranslationEnabled;
    const mode = normalizeVideoSubtitleDisplayMode(config.videoSubtitleDisplayMode);
    const visible = config.videoSubtitleVisible !== false;
    const status = config.on
      ? (config.videoTranslationEnabled ? '已开启' : '已关闭')
      : 'FluentRead 总开关已关闭';

    button.classList.toggle(VIDEO_TRANSLATION_ACTIVE_CLASS, enabled);
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-expanded', String(!menu.hidden));
    button.setAttribute('aria-label', `FluentRead 字幕翻译：${status}`);
    button.title = `FluentRead 字幕翻译：${status}`;

    const toggle = menu.querySelector<HTMLButtonElement>('[data-action="toggle-translation"]');
    if (toggle) {
      toggle.disabled = !config.on;
      toggle.setAttribute('aria-checked', String(enabled));
      toggle.querySelector<HTMLElement>('[data-check]')!.textContent = enabled ? '✓' : '';
      toggle.querySelector<HTMLElement>('[data-state]')!.textContent = config.on
        ? (enabled ? '已开启' : '立即开启')
        : status;
    }
    const visibility = menu.querySelector<HTMLButtonElement>('[data-action="toggle-visible"]');
    if (visibility) {
      visibility.setAttribute('aria-checked', String(visible));
      visibility.querySelector<HTMLElement>('[data-check]')!.textContent = visible ? '✓' : '';
      visibility.querySelector<HTMLElement>('[data-state]')!.textContent = visible ? '显示中' : '已隐藏';
    }
    const aiToggle = menu.querySelector<HTMLButtonElement>('[data-action="toggle-ai-subtitle"]');
    if (aiToggle) {
      const available = isXVideoPage();
      const aiCaptureActive = isAiCaptureActive();
      aiToggle.disabled = !available;
      aiToggle.querySelector<HTMLElement>('[data-check]')!.textContent = aiCaptureActive ? '✓' : '';
      aiToggle.querySelector<HTMLElement>('[data-state]')!.textContent = !available
        ? '仅 X 视频'
          : isAiFullActive()
            ? aiFullPhase === 'capturing'
              ? aiFullProgress.captureMode === 'fast-decode' ? '快速读取音频中' : '扫描视频中'
            : aiFullPhase === 'transcribing'
              ? `识别字幕 ${Math.round(aiFullProgress.progress * 100)}%`
              : aiFullPhase === 'translating'
                ? `翻译字幕 ${Math.round(aiFullProgress.progress * 100)}%`
                : aiFullPhase === 'ready'
                  ? '已就绪，播放中'
                  : '完整生成中'
        : isAiCaptureRunning()
          ? '生成中，点击停止'
          : isAiCaptureRequested()
            ? '暂停后继续'
            : aiCaptureError
              ? aiCaptureError.includes('下载') ? '请先下载模型' : aiCaptureError.slice(0, 24)
              : '点击完整生成';
      aiToggle.setAttribute('aria-checked', String(aiCaptureActive));
    }
    menu.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((item) => {
      const selected = item.dataset.mode === mode;
      item.setAttribute('aria-checked', String(selected));
    });
  };

  const persistVideoConfig = (patch: VideoConfigPatch) => {
    const nextConfig = { ...config, ...patch };
    void saveConfig(nextConfig).catch((error) => {
      console.warn('[FluentRead] 视频字幕设置保存失败', error);
    });
  };

  const ensureNativeCaptions = () => {
    if (!isYouTubeVideoPage()) return;
    const nativeButton = document.querySelector<HTMLButtonElement>('.ytp-subtitles-button');
    if (nativeButton && nativeButton.getAttribute('aria-pressed') !== 'true') {
      nativeButton.click();
    }
  };

  const handleTimedTextMessage = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data as { source?: unknown; type?: unknown; url?: unknown; responseText?: unknown } | null;
    if (data?.source !== 'fluent-read' || data.type !== YOUTUBE_TIMED_TEXT_MESSAGE) return;
    if (typeof data.url !== 'string' || typeof data.responseText !== 'string') return;

    const cues = finalizeVideoSubtitleCues(parseYoutubeTimedTextResponse(data.responseText));
    if (cues.length === 0) return;
    const key = getTimedTextCacheKey(data.url);
    const entry = { url: data.url, cues };
    capturedSubtitleTracks.set(key, entry);
    if (canTranslateVideo()) {
      setPretranslationTrack(key, entry);
      scheduleUpdate();
    }
  };

  const resolveDownloadTrack = async (): Promise<{ languageCode: string; cues: VideoSubtitleCue[] }> => {
    const captured = Array.from(capturedSubtitleTracks.values());
    if (isXVideoPage()) {
      if (isAiCaptureActive() && aiCues.length > 0) return { languageCode: 'ai', cues: aiCues };
      const xTrack = captured.find((entry) => entry.cues.length > 0);
      if (xTrack) return { languageCode: 'original', cues: xTrack.cues };
      if (aiCues.length > 0) return { languageCode: 'ai', cues: aiCues };
      throw new Error('当前 X 视频还没有可下载的字幕，请先打开原生字幕或请求 AI 字幕');
    }
    const originalCaptured = captured.find((entry) => isOriginalTimedTextUrl(entry.url));
    if (originalCaptured) {
      const url = new URL(originalCaptured.url, window.location.href);
      return { languageCode: url.searchParams.get('lang') || 'original', cues: originalCaptured.cues };
    }
    if (captured[0]) {
      const url = new URL(captured[0].url, window.location.href);
      return { languageCode: url.searchParams.get('lang') || 'original', cues: captured[0].cues };
    }

    const track = chooseYoutubeCaptionTrack(extractYoutubeCaptionTracks(document), config.from);
    if (!track) throw new Error('当前视频没有可用的 YouTube 字幕轨道');
    const response = await fetch(buildYoutubeTimedTextUrl(track), { credentials: 'include' });
    if (!response.ok) throw new Error(`字幕轨道请求失败（${response.status}）`);
    const cues = finalizeVideoSubtitleCues(parseYoutubeTimedTextResponse(await response.text()));
    if (cues.length === 0) {
      throw new Error('YouTube 未返回完整字幕数据，请先打开原生字幕后重试');
    }
    return { languageCode: track.languageCode, cues };
  };

  const ensureLocalVideoModelReady = async (): Promise<boolean> => {
    const model = normalizeVideoLocalTranscriptionModel(config.videoLocalModel);
    try {
      const stored = await browser.storage.local.get(VIDEO_LOCAL_TRANSCRIPTION_STATE_KEY);
      const downloaded = normalizeVideoLocalTranscriptionModels(stored[VIDEO_LOCAL_TRANSCRIPTION_STATE_KEY]);
      if (downloaded.includes(model)) {
        aiCaptureError = '';
        updatePlayerUiState();
        return true;
      }
    } catch {
      // 读取状态失败时仍按未下载处理，给用户一个可执行的设置入口。
    }

    aiCaptureError = '请先打开视频字幕设置下载本地模型';
    updatePlayerUiState();
    void browser.runtime.sendMessage({ type: 'openOptionsPage', section: 'settings-video' }).catch(() => undefined);
    return false;
  };

  const handleMenuClick = async (event: MouseEvent) => {
    const menu = menuElement;
    if (!menu || !(event.target instanceof Element)) return;
    const target = event.target.closest<HTMLElement>('[data-action], [data-mode]');
    if (!target || !menu.contains(target) || (target instanceof HTMLButtonElement && target.disabled)) return;

    event.preventDefault();
    event.stopPropagation();

    if (target.dataset.action === 'toggle-translation') {
      const nextEnabled = !config.videoTranslationEnabled;
      persistVideoConfig({ videoTranslationEnabled: nextEnabled });
      if (!nextEnabled && isAiCaptureActive()) {
        if (isAiFullActive()) stopFullAiSubtitleGeneration();
        else stopAiSubtitleCapture(true);
      }
      if (nextEnabled) ensureNativeCaptions();
      return;
    }
    if (target.dataset.action === 'toggle-ai-subtitle') {
      if (isAiCaptureActive()) {
        if (isAiFullActive()) stopFullAiSubtitleGeneration();
        else stopAiSubtitleCapture(true);
      } else if (await ensureLocalVideoModelReady()) {
        // 完整模式会先暂停并扫描整个视频；只有识别和翻译都完成后才从
        // 0 秒恢复播放，因此不会把实时推理延迟映射成字幕落后。
        startFullAiSubtitleGeneration();
      }
      updatePlayerUiState();
      return;
    }
    if (target.dataset.action === 'toggle-visible') {
      persistVideoConfig({ videoSubtitleVisible: config.videoSubtitleVisible === false });
      return;
    }
    if (target.dataset.action === 'download-subtitles') {
      const downloadButton = target as HTMLButtonElement;
      const state = downloadButton.querySelector<HTMLElement>('[data-state]');
      downloadButton.disabled = true;
      if (state) state.textContent = '准备中';
      try {
        const result = await resolveDownloadTrack();
        downloadSubtitleSrt(result.cues, result.languageCode);
        if (state) state.textContent = `已下载 ${result.cues.length} 条`;
      } catch (error) {
        if (state) state.textContent = '暂不可用';
        console.warn('[FluentRead] 字幕下载失败', error);
      } finally {
        window.setTimeout(() => {
          downloadButton.disabled = false;
          if (state) state.textContent = '';
        }, 2200);
      }
      return;
    }
    if (target.dataset.action === 'open-settings') {
      closeMenu();
      void browser.runtime.sendMessage({ type: 'openOptionsPage', section: 'settings-video' }).catch(() => undefined);
      return;
    }
    if (target.dataset.mode) {
      persistVideoConfig({ videoSubtitleDisplayMode: normalizeVideoSubtitleDisplayMode(target.dataset.mode) });
    }
  };

  const createMenuItem = (action: string, label: string): HTMLButtonElement => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `fluent-read-video-menu-item${action === 'toggle-translation' ? ' fluent-read-video-menu-primary-action' : ''}`;
    item.dataset.action = action;
    item.setAttribute('role', action === 'toggle-translation' || action === 'toggle-visible' || action === 'toggle-ai-subtitle' ? 'menuitemcheckbox' : 'menuitem');
    const check = createTextElement('span', 'fluent-read-video-menu-check', '');
    check.dataset.check = 'true';
    const labelElement = createTextElement('span', 'fluent-read-video-menu-label', label);
    const state = createTextElement('span', 'fluent-read-video-menu-value', '');
    state.dataset.state = 'true';
    item.append(check, labelElement, state);
    return item;
  };

  const createPlayerMenu = (player: HTMLElement): HTMLElement => {
    const menu = document.createElement('div');
    menu.id = VIDEO_TRANSLATION_MENU_ID;
    menu.className = 'fluent-read-video-subtitle-menu fluent-read-video-ui notranslate';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '流畅阅读视频字幕翻译菜单');
    markVideoUi(menu);

    const title = document.createElement('div');
    title.className = 'fluent-read-video-menu-title';
    const heading = document.createElement('span');
    heading.className = 'fluent-read-video-menu-heading';
    heading.append(
      createTextElement('span', 'fluent-read-video-menu-brand', '流畅阅读'),
      createTextElement('span', 'fluent-read-video-menu-title-text', '视频字幕翻译'),
    );
    title.append(
      heading,
      createTextElement('span', 'fluent-read-video-menu-beta', 'Beta 测试'),
    );
    menu.appendChild(title);

    menu.appendChild(createMenuItem('toggle-translation', '开启字幕翻译'));
    menu.appendChild(createMenuItem('toggle-ai-subtitle', '完整生成 AI 字幕'));

    const divider = createTextElement('div', 'fluent-read-video-menu-divider', '');
    divider.setAttribute('aria-hidden', 'true');
    menu.appendChild(divider);

    const modeCaption = createTextElement('span', 'fluent-read-video-menu-caption', '字幕显示模式');
    menu.appendChild(modeCaption);
    const modeGroup = document.createElement('div');
    modeGroup.className = 'fluent-read-video-menu-mode-group';
    modeGroup.setAttribute('role', 'radiogroup');
    modeGroup.setAttribute('aria-label', '字幕显示模式');
    (Object.keys(VIDEO_DISPLAY_MODE_LABELS) as VideoSubtitleDisplayMode[]).forEach((mode) => {
      const item = createTextElement('button', 'fluent-read-video-menu-mode', VIDEO_DISPLAY_MODE_LABELS[mode]);
      item.type = 'button';
      item.dataset.mode = mode;
      item.setAttribute('role', 'menuitemradio');
      modeGroup.appendChild(item);
    });
    menu.appendChild(modeGroup);

    menu.appendChild(createMenuItem('toggle-visible', '显示字幕'));
    const download = createMenuItem('download-subtitles', '下载字幕');
    download.querySelector('[data-check]')?.remove();
    menu.appendChild(download);
    const settings = createMenuItem('open-settings', '视频字幕设置');
    settings.querySelector('[data-check]')?.remove();
    settings.querySelector('[data-state]')?.remove();
    menu.appendChild(settings);
    player.appendChild(menu);
    bindMenuClick(menu);
    return menu;
  };

  const handleButtonClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const menu = menuElement?.isConnected ? menuElement : document.getElementById(VIDEO_TRANSLATION_MENU_ID);
    if (!(menu instanceof HTMLElement)) return;
    menuElement = menu;
    menu.hidden = !menu.hidden;
    updatePlayerUiState();
    syncTranslationOverlayPosition(findCaptionContainer());
    if (!menu.hidden) {
      menu.querySelector<HTMLButtonElement>('[data-action="toggle-translation"]')?.focus();
    }
  };

  const bindButtonClick = (button: HTMLButtonElement) => {
    if (button.dataset.fluentReadClickBound === 'true') return;
    button.dataset.fluentReadClickBound = 'true';
    button.addEventListener('click', handleButtonClick);
  };

  const bindMenuClick = (menu: HTMLElement) => {
    if (menu.dataset.fluentReadClickBound === 'true') return;
    menu.dataset.fluentReadClickBound = 'true';
    menu.addEventListener('click', handleMenuClick);
  };

  const createPlayerButton = (): HTMLButtonElement => {
    const button = document.createElement('button');
    button.id = VIDEO_TRANSLATION_BUTTON_ID;
    button.className = 'ytp-button fluent-read-video-subtitle-button fluent-read-video-ui notranslate';
    button.type = 'button';
    button.setAttribute('role', 'button');
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'FluentRead 字幕翻译：已关闭');
    button.title = 'FluentRead 字幕翻译：已关闭';
    const icon = document.createElement('img');
    icon.className = 'fluent-read-video-subtitle-button-icon';
    icon.src = browser.runtime.getURL('icon/128.png');
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);
    markVideoUi(button);
    bindButtonClick(button);
    return button;
  };

  const ensurePlayerUi = () => {
    const player = findVideoPlayer();
    let controls = player?.querySelector<HTMLElement>(VIDEO_RIGHT_CONTROLS_SELECTOR);
    let insertBefore: Element | null = null;
    if (!controls && player && isXVideoPage()) {
      const settingsControl = findXSettingsControl(player);
      if (settingsControl) {
        controls = findXNativeControls(player, settingsControl);
        insertBefore = settingsControl;
      }
    }
    if (!controls && player && isXVideoPage()) {
      controls = player.querySelector<HTMLElement>(`.${VIDEO_FALLBACK_CONTROLS_CLASS}`);
      if (!controls) {
        controls = document.createElement('div');
        controls.className = VIDEO_FALLBACK_CONTROLS_CLASS;
        markVideoUi(controls);
        player.appendChild(controls);
      }
    }
    if (!player || !controls) return;

    let button = document.getElementById(VIDEO_TRANSLATION_BUTTON_ID);
    if (!(button instanceof HTMLButtonElement)) {
      button = createPlayerButton();
    }
    const playerButton = button as HTMLButtonElement;
    bindButtonClick(playerButton);
    playerButton.classList.toggle('fluent-read-video-subtitle-x-button', isXVideoPage());
    const firstControl = controls.firstElementChild;
    if (insertBefore?.parentElement === controls) {
      if (playerButton.parentElement !== controls || playerButton.nextElementSibling !== insertBefore) {
        controls.insertBefore(playerButton, insertBefore);
      }
    } else if (playerButton.parentElement !== controls || firstControl !== playerButton) {
      controls.insertBefore(playerButton, firstControl);
    }
    buttonElement = playerButton;

    let menu = document.getElementById(VIDEO_TRANSLATION_MENU_ID);
    if (!(menu instanceof HTMLElement)) {
      menu = createPlayerMenu(player);
    } else if (menu.parentElement !== player) {
      player.appendChild(menu);
    }
    menuElement = menu;
    bindMenuClick(menu);
    markVideoUi(playerButton);
    markVideoUi(menu);
    updatePlayerUiState();
  };

  const handleDocumentClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (buttonElement?.contains(target) || menuElement?.contains(target)) return;
    closeMenu();
  };

  const handleDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closeMenu();
  };

  const startTranslationLoop = () => {
    if (translationLoopRunning) return;

    translationLoopRunning = true;
    void (async () => {
      try {
        while (!destroyed && pendingTranslationSource) {
          const nextSource = pendingTranslationSource;
          const nextOverlay = pendingTranslationOverlay;
          pendingTranslationSource = '';
          pendingTranslationOverlay = null;
          const requestGeneration = generation;
          try {
            const translated = await getCachedVideoTranslation(nextSource);
            if (!nextOverlay || destroyed || requestGeneration !== generation || nextSource !== lastSource) continue;
            const result = typeof translated === 'string' ? translated.trim() : '';
            lastTranslatedSource = nextSource;
            lastTranslatedText = result && result !== nextSource ? result : '';
            const currentContainer = findCaptionContainer();
            if (!lastTranslatedText || !currentContainer || readVisibleCaptionText(currentContainer) !== nextSource) continue;
            nextOverlay.textContent = lastTranslatedText;
            syncTranslationOverlayPosition(currentContainer);
          } catch (error) {
            if (!destroyed && requestGeneration === generation) {
              console.warn('[FluentRead] 视频字幕翻译失败', error);
            }
          }
        }
      } finally {
        translationLoopRunning = false;
      }
    })();
  };

  const commitStableCaption = (source: string, overlay: HTMLElement, container: HTMLElement) => {
    if (destroyed || readVisibleCaptionText(container) !== source || source === lastSource) return;

    lastSource = source;
    ++generation;
    lastTranslatedSource = '';
    lastTranslatedText = '';
    overlay.textContent = '';
    if (container.id === VIDEO_AI_CAPTION_CONTAINER_ID) {
      const player = findVideoPlayer();
      const normalizedOverlay = player ? getOrCreateNormalizedCaptionOverlay(player) : null;
      const layer = player?.querySelector<HTMLElement>(`#${VIDEO_TRANSLATION_LAYER_ID}`);
      if (normalizedOverlay && layer) {
        normalizedOverlay.textContent = source;
        layer.classList.add(VIDEO_NORMALIZED_CAPTION_ACTIVE_CLASS);
        container.classList.add(VIDEO_NORMALIZED_CAPTION_CLASS);
        normalizedCaptionActive = true;
        normalizedCaptionCueKey = `synthetic:${source}`;
      }
    }
    syncTranslationOverlayPosition(container);

    pendingTranslationSource = source;
    pendingTranslationOverlay = overlay;
    startTranslationLoop();
  };

  const scheduleStableCaption = (source: string, overlay: HTMLElement) => {
    if (stableCaptionTimer && stableCaptionSource === source) return;

    cancelStableCaption();
    stableCaptionSource = source;
    stableCaptionOverlay = overlay;
    stableCaptionTimer = setTimeout(() => {
      stableCaptionTimer = undefined;
      const nextSource = stableCaptionSource;
      const nextOverlay = stableCaptionOverlay;
      stableCaptionSource = '';
      stableCaptionOverlay = null;
      if (destroyed || !nextSource) return;

      const container = findCaptionContainer();
      const player = findVideoPlayer();
      if (!container || !player || readVisibleCaptionText(container) !== nextSource) return;
      const currentOverlay = nextOverlay?.isConnected ? nextOverlay : getOrCreateTranslationOverlay(player);
      commitStableCaption(nextSource, currentOverlay, container);
    }, VIDEO_CAPTION_STABILITY_MS);
  };

  const updateCaption = () => {
    if (destroyed) return;

    if (isXVideoPage()) syncXVideoCaptionSource();
    const container = findCaptionContainer();
    if (!container) {
      captionObserver?.disconnect();
      captionObserver = undefined;
      observedContainer = null;
      scheduleCaptionEmptyClear();
      return;
    }

    container.classList.add('notranslate');
    applyVideoDisplayState(container);
    const displayMode = normalizeVideoSubtitleDisplayMode(config.videoSubtitleDisplayMode);
    const player = findVideoPlayer();
    if (!player) return;
    const source = readVisibleCaptionText(container);
    const canTranslate = config.on && config.videoTranslationEnabled && config.videoSubtitleVisible !== false && displayMode !== 'original-only';
    if (!canTranslate) {
      if (config.on && config.videoTranslationEnabled && config.videoSubtitleVisible !== false
        && displayMode === 'original-only' && container.id === VIDEO_AI_CAPTION_CONTAINER_ID) {
        if (!source) {
          scheduleCaptionEmptyClear();
          return;
        }
        cancelCaptionEmptyClear();
        cancelStableCaption();
        if (source !== lastSource) {
          generation += 1;
          lastSource = source;
          lastTranslatedSource = '';
          lastTranslatedText = '';
          pendingTranslationSource = '';
          pendingTranslationOverlay = null;
          progressiveCueKey = '';
          progressiveCue = null;
          progressiveTranslation = '';
        }
        const normalizedOverlay = getOrCreateNormalizedCaptionOverlay(player);
        const layer = player.querySelector<HTMLElement>(`#${VIDEO_TRANSLATION_LAYER_ID}`);
        normalizedOverlay.textContent = source;
        layer?.classList.add(VIDEO_NORMALIZED_CAPTION_ACTIVE_CLASS);
        container.classList.add(VIDEO_NORMALIZED_CAPTION_CLASS);
        normalizedCaptionActive = true;
        normalizedCaptionCueKey = `original-only:${source}`;
        getOrCreateTranslationOverlay(player).textContent = '';
        syncTranslationOverlayPosition(container);
        return;
      }
      resetTranslationState();
      return;
    }

    const overlay = getOrCreateTranslationOverlay(player);

    if (!source) {
      scheduleCaptionEmptyClear();
      return;
    }

    cancelCaptionEmptyClear();
    if (updateProgressiveCaption(source, overlay, container)) return;

    if (progressiveCueKey) {
      clearProgressiveCaption();
      lastSource = '';
      lastTranslatedSource = '';
      lastTranslatedText = '';
      overlay.textContent = '';
    }

    if (source === lastSource) {
      syncTranslationOverlayPosition(container);
      if (lastTranslatedSource === source && lastTranslatedText && overlay.textContent !== lastTranslatedText) {
        overlay.textContent = lastTranslatedText;
        syncTranslationOverlayPosition(container);
      }
      return;
    }

    // 自动字幕会先逐词写入 DOM；只有连续稳定一小段时间后才提交翻译请求。
    // 在等待期间保留原生字幕，避免每个半句都触发译文闪烁。
    scheduleStableCaption(source, overlay);
  };

  const scheduleUpdate = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updateCaption, 120);
  };

  const videoTimelineEventNames = ['timeupdate', 'seeking', 'loadedmetadata', 'durationchange', 'play', 'pause', 'ended', 'ratechange'];
  const handleVideoTimelineEvent = (event: Event) => {
    const target = event.target as HTMLVideoElement | null;
    if (!target || target.tagName !== 'VIDEO') return;
    if (target !== observedVideo) syncVideoElement();
    if (target !== observedVideo) return;
    if (isXVideoPage()) {
      if (event.type === 'seeking' && isAiCaptureRunning()) {
        // seek 会让当前 PCM 窗口跨越两个位置；彻底重建采集图，避免旧
        // 时间轴在新位置闪回或字幕停止更新。
        resetAiSubtitleAfterSeek();
      }
      if (event.type === 'ratechange' && isAiCaptureRunning()) {
        aiCapture?.resetAfterPlaybackRateChange();
      }
      if (event.type === 'pause' && !target.ended && isAiCaptureRunning()) {
        // 暂停期间不能把墙钟 PCM 写进播放器时间轴。保留 requested 状态，
        // play 时从新的 currentTime 建立独立滚动窗口。
        stopAiSubtitleCapture(false);
      }
      if (event.type === 'ended' && isAiCaptureRunning()) {
        // 已提交到 Worker 的最后一个窗口最多再等待几秒，避免 30 秒视频
        // 总是丢掉最后一句；时间轴保留，重播/下载字幕仍可使用。
        aiCapture?.end(false);
      }
      if (event.type === 'play' && isAiCaptureRequested() && !isAiCaptureRunning() && !isAiFullActive()) {
        startAiSubtitleCapture(false);
      }
      syncXVideoCaptionSource();
    }
    schedulePretranslation();
    scheduleUpdate();
  };

  const handleVideoVisibilityChange = () => {
    if (!isXVideoPage()) return;
    if (document.visibilityState === 'hidden') {
      if (isAiFullActive()) stopFullAiSubtitleGeneration();
      else if (isAiCaptureRunning()) stopAiSubtitleCapture(false);
      return;
    }
    const video = observedVideo || document.querySelector<HTMLVideoElement>('video');
    if (isAiCaptureRequested() && !isAiCaptureRunning() && !isAiFullActive() && video && !video.paused && !video.ended) {
      startAiSubtitleCapture(false);
    }
  };

  const observeCaptionContainer = () => {
    const container = findCaptionContainer();
    if (!container) {
      captionObserver?.disconnect();
      captionObserver = undefined;
      observedContainer = null;
      scheduleCaptionEmptyClear();
      return;
    }
    if (container === observedContainer && container.isConnected) {
      applyVideoDisplayState(container);
      return;
    }

    captionObserver?.disconnect();
    observedContainer = container;
    container.classList.add('notranslate');
    applyVideoDisplayState(container);
    // 合成 AI 容器由 cue 和播放器时间事件直接驱动；观察并改写自己的
    // textContent 会形成约 120ms 一次的自触发循环。
    if (container.id !== VIDEO_AI_CAPTION_CONTAINER_ID) {
      captionObserver = new MutationObserver(scheduleUpdate);
      captionObserver.observe(container, { childList: true, subtree: true, characterData: true });
    }
    scheduleUpdate();
  };

  const syncPretranslationConfig = () => {
    const nextPretranslationConfigKey = getVideoTranslationConfigFingerprint(config);
    if (nextPretranslationConfigKey === pretranslationConfigKey) return;
    pretranslationConfigKey = nextPretranslationConfigKey;
    clearPretranslationState(false);
  };

  const syncPlayerUi = () => {
    if (destroyed) return;
    const nextVideoPageKey = getVideoPageKey();
    if (nextVideoPageKey !== videoPageKey) {
      videoPageKey = nextVideoPageKey;
      captionObserver?.disconnect();
      captionObserver = undefined;
      observedContainer = null;
      capturedSubtitleTracks.clear();
      xSubtitleVisitedResources.clear();
      xSubtitleResourceCount = 0;
      xSubtitleCues = [];
      aiCues = [];
      if (isAiFullActive()) stopFullAiSubtitleGeneration();
      else stopAiSubtitleCapture(true);
      clearPretranslationState(true);
      resetTranslationState();
    }
    if (!isSupportedVideoPage()) {
      observedVideo = null;
      closeMenu();
      document.querySelectorAll(`#${VIDEO_TRANSLATION_BUTTON_ID}, #${VIDEO_TRANSLATION_MENU_ID}`).forEach((node) => node.remove());
      buttonElement = null;
      menuElement = null;
      removeTranslationOverlay();
      return;
    }
    syncPretranslationConfig();
    ensurePlayerUi();
    syncXVideoCaptionSource();
    observeCaptionContainer();
    syncVideoElement();
    ensurePretranslationTrack();
    // 某些播放器实现不会稳定派发 timeupdate；复用已有的播放器同步
    // 周期校正当前 cue，避免原生字幕 DOM 落后一整句时译文一直停留在旧句。
    scheduleUpdate();
    schedulePretranslation();
    syncTranslationOverlayPosition(observedContainer);
  };

  document.addEventListener('click', handleDocumentClick, true);
  document.addEventListener('keydown', handleDocumentKeydown, true);
  document.addEventListener('visibilitychange', handleVideoVisibilityChange);
  videoTimelineEventNames.forEach((eventName) => document.addEventListener(eventName, handleVideoTimelineEvent, true));
  window.addEventListener('message', handleTimedTextMessage);
  window.addEventListener('message', handleXSubtitleResourceMessage);
  syncPlayerUi();
  uiSyncTimer = window.setInterval(syncPlayerUi, 1000);

  const unsubscribeConfig = subscribeConfig((nextConfig) => {
    const nextAiModel = normalizeVideoLocalTranscriptionModel(nextConfig.videoLocalModel);
    if (nextAiModel !== activeAiModel) {
      const captureWasActive = isAiCaptureActive();
      activeAiModel = nextAiModel;
      if (captureWasActive) {
        // 模型切换会改变 Worker session；旧模型结果必须立刻作废，不能与
        // 新模型的滑窗混进同一条稳定时间轴。
        if (isAiFullActive()) stopFullAiSubtitleGeneration();
        else stopAiSubtitleCapture(true);
        aiCues = [];
        setPretranslationTrack('ai:capture', { url: 'ai:capture', cues: [] });
        aiCaptureError = '模型已切换，请重新请求 AI 字幕';
        resetTranslationState();
      }
    }
    syncPretranslationConfig();
    updatePlayerUiState();
    if (observedContainer) {
      applyVideoDisplayState(observedContainer);
      syncTranslationOverlayPosition(observedContainer);
    }
    if (!nextConfig.on || !nextConfig.videoTranslationEnabled || nextConfig.videoSubtitleVisible === false) {
      if (isAiCaptureActive()) {
        if (isAiFullActive()) stopFullAiSubtitleGeneration();
        else stopAiSubtitleCapture(true);
      }
      clearPretranslationState(false);
      resetTranslationState();
      return;
    }
    observeCaptionContainer();
    scheduleUpdate();
  });

  return () => {
    destroyed = true;
    generation += 1;
    pendingTranslationSource = '';
    pendingTranslationOverlay = null;
    if (debounceTimer) clearTimeout(debounceTimer);
    cancelCaptionEmptyClear();
    cancelStableCaption();
    clearPretranslationState(true);
    observedVideo = null;
    if (uiSyncTimer !== undefined) window.clearInterval(uiSyncTimer);
    captionObserver?.disconnect();
    unsubscribeConfig();
    document.removeEventListener('click', handleDocumentClick, true);
    document.removeEventListener('keydown', handleDocumentKeydown, true);
    document.removeEventListener('visibilitychange', handleVideoVisibilityChange);
    videoTimelineEventNames.forEach((eventName) => document.removeEventListener(eventName, handleVideoTimelineEvent, true));
    window.removeEventListener('message', handleTimedTextMessage);
    window.removeEventListener('message', handleXSubtitleResourceMessage);
    aiCapture?.destroy();
    aiFullCapture?.destroy();
    document.getElementById(VIDEO_AI_CAPTION_CONTAINER_ID)?.remove();
    closeMenu();
    document.querySelectorAll(`#${VIDEO_TRANSLATION_BUTTON_ID}, #${VIDEO_TRANSLATION_MENU_ID}`).forEach((node) => node.remove());
    removeTranslationOverlay();
    document.querySelectorAll(VIDEO_CAPTION_CONTAINER_SELECTOR).forEach((node) => {
      node.classList.remove('notranslate', VIDEO_DISPLAY_TRANSLATION_ONLY_CLASS, VIDEO_DISPLAY_ORIGINAL_ONLY_CLASS, VIDEO_DISPLAY_HIDDEN_CLASS, VIDEO_NORMALIZED_CAPTION_CLASS);
      node.removeAttribute('data-fluent-read-video-display-mode');
    });
    style.remove();
  };
}
