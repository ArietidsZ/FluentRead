import {afterEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';

import {
  createVideoPlayerMenu,
  isVideoModelPromptOpen,
  readVideoModelPromptSelection,
  renderVideoAiMenu,
  renderVideoMenuMode,
  renderVideoModelPrompt,
  renderVideoSubtitleTiming,
  setVideoMenuDownloadStatus,
  syncVideoPlayerMenuLayout,
  type VideoAiMenuState,
} from '@/src/features/video-subtitle/content/playerMenu';
import {registerAllUiLanguageBundles} from '@/src/core/i18n/bundles';
import {refreshVideoUiAccessibility, refreshVideoUiText} from '@/src/features/video-subtitle/content/ui';
import {VIDEO_LOCAL_TRANSCRIPTION_MODELS} from '@/src/features/video-subtitle/transcription';

// 扩展运行时按需加载界面语言；本文件验证全部语言的文案契约，因此一次注册全部资源包。
registerAllUiLanguageBundles();

describe('player subtitle timing', () => {
  it('renders a single-row stepper, hides the row without a timeline and keeps reset for saved offsets', () => {
    const {document} = parseHTML('<!doctype html><body></body>');
    vi.stubGlobal('document', document);
    const menu = createVideoPlayerMenu('en-US', false);
    const row = menu.querySelector<HTMLElement>('[data-timing-row]')!;
    const earlier = menu.querySelector<HTMLButtonElement>('[data-action="subtitle-earlier"]')!;
    const later = menu.querySelector<HTMLButtonElement>('[data-action="subtitle-later"]')!;
    const reset = menu.querySelector<HTMLButtonElement>('[data-action="reset-subtitle-timing"]')!;
    expect(row.textContent).toContain('Timing');
    renderVideoSubtitleTiming(menu, -500, true, 'en-US');
    expect(earlier.getAttribute('aria-label')).toBe('0.5 s earlier');
    expect(later.title).toBe('0.5 s later');
    expect(menu.querySelector('[data-subtitle-offset]')?.textContent).toBe('-0.5 s');
    expect(row.hidden).toBe(false);
    expect(earlier.disabled).toBe(false);
    expect(reset.disabled).toBe(false);
    renderVideoSubtitleTiming(menu, -10000, true, 'en-US');
    expect(earlier.disabled).toBe(true);
    renderVideoSubtitleTiming(menu, 10000, true, 'en-US');
    expect(later.disabled).toBe(true);
    expect(menu.querySelector('[data-subtitle-offset]')?.textContent).toBe('+10.0 s');
    renderVideoSubtitleTiming(menu, 500, false, 'en-US');
    expect(earlier.disabled && later.disabled).toBe(true);
    expect(reset.disabled).toBe(false);
    expect(row.hidden).toBe(false);
    expect(row.title).toBe('Timing adjustment is unavailable for these captions');
    renderVideoSubtitleTiming(menu, 0, false, 'en-US');
    expect(row.hidden).toBe(true);
    renderVideoSubtitleTiming(menu, 0, true, 'en-US');
    expect(row.hidden).toBe(false);
    expect(reset.disabled).toBe(true);
    expect(menu.querySelector('[data-action="subtitle-earlier"]')).toBe(earlier);
  });
});

const progress = (value: number): VideoAiMenuState['progress'] => ({
  phase: 'transcribing',
  progress: value,
  capturedMs: 2_000,
  durationMs: 4_000,
  transcribedMs: 1_000,
  windowIndex: 1,
  windowCount: 2,
});

function state(overrides: Partial<VideoAiMenuState> = {}): VideoAiMenuState {
  return {
    available: true,
    checking: false,
    active: false,
    running: false,
    requested: false,
    fullActive: false,
    phase: 'idle',
    progress: progress(0),
    error: '',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('video player menu composition', () => {
  it('updates menu and subtitle accessibility while the player entry button is unmounted', () => {
    const {document} = parseHTML('<!doctype html><body><div id="fluent-read-video-subtitle-panel"></div><div id="fluent-read-video-subtitle"></div><div id="fluent-read-video-subtitle-original"></div></body>');
    vi.stubGlobal('document', document);
    const menu = createVideoPlayerMenu('zh-CN', true);
    const button = document.createElement('button');
    refreshVideoUiAccessibility(menu, button, document, 'zh-CN', '已开启');
    const chineseLabel = menu.getAttribute('aria-label');
    refreshVideoUiAccessibility(menu, null, document, 'en-US', 'Enabled');
    expect(menu.getAttribute('aria-label')).not.toBe(chineseLabel);
    expect(menu.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBeTruthy();
    for (const element of document.querySelectorAll('[id]')) {
      expect(element.getAttribute('aria-label')).toBeTruthy();
    }
    refreshVideoUiAccessibility(menu, button, document, 'en-US', 'Enabled');
    expect(button.getAttribute('aria-label')).toContain('Enabled');
    expect(button.title).toBe(button.getAttribute('aria-label'));
  });

  it('groups one display choice, timing, AI and downloads without switches or a re-recognize action', () => {
    const {document} = parseHTML('<!doctype html><body></body>');
    vi.stubGlobal('document', document);

    const menu = createVideoPlayerMenu('zh-CN', true);
    expect(menu.id).toBe('fluent-read-video-subtitle-menu');
    expect(menu.hidden).toBe(true);
    expect(menu.dataset.layout).toBe('stack');
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.getAttribute('aria-label')).toBeTruthy();
    expect(menu.getAttribute('data-fluent-read-ui')).toBe('video-subtitle');
    expect(menu.getAttribute('translate')).toBe('no');
    expect(menu.querySelector('[data-action="toggle-translation"], [data-action="toggle-visible"], [data-action="regenerate-ai-subtitle"]')).toBeNull();
    expect(menu.querySelectorAll('[role="menuitemcheckbox"]')).toHaveLength(1);
    expect([...menu.querySelectorAll<HTMLElement>('.fluent-read-video-menu-mode-group [data-mode]')].map(item => [item.dataset.mode, item.textContent]))
      .toEqual([['bilingual', '双语'], ['translation-only', '译文'], ['original-only', '原文'], ['off', '关闭']]);
    const display = menu.querySelector('.fluent-read-video-menu-display')!;
    expect(display.querySelector('.fluent-read-video-menu-mode-group')).toBeTruthy();
    expect(display.querySelector('[data-timing-row]')).toBeTruthy();
    const timingControls = menu.querySelector('.fluent-read-video-menu-timing-controls');
    expect([...timingControls!.children].map(element => element.getAttribute('data-action') || element.getAttribute('data-subtitle-offset')))
      .toEqual(['reset-subtitle-timing', 'subtitle-earlier', 'true', 'subtitle-later']);
    const actions = menu.querySelector('.fluent-read-video-menu-actions')!;
    expect(actions.querySelector('.fluent-read-video-menu-ai-group [data-action="toggle-ai-subtitle"]')).toBeTruthy();
    expect([...actions.querySelectorAll<HTMLButtonElement>('.fluent-read-video-menu-download')].map(button => [button.dataset.action, button.textContent, button.getAttribute('aria-label')]))
      .toEqual([
        ['download-subtitles', '原文字幕', '下载原文字幕'],
        ['download-translated-subtitles', '译文字幕', '下载译文字幕'],
        ['download-bilingual-subtitles', '双语字幕', '下载双语字幕'],
      ]);
    expect(actions.querySelector('[data-download-status]')?.getAttribute('aria-live')).toBe('polite');
    expect(menu.querySelector<HTMLElement>('[data-model-prompt]')?.hidden).toBe(true);

    const withoutLocalGeneration = createVideoPlayerMenu('en-US', false);
    expect(withoutLocalGeneration.querySelector('[data-action="toggle-ai-subtitle"]')).toBeNull();
    expect(withoutLocalGeneration.querySelector('[data-model-prompt]')).toBeNull();
    expect(withoutLocalGeneration.querySelector('[role="radiogroup"]')?.textContent).toBe('BothTranslatedOriginalOff');
  });

  it('renders the selected display choice, disables it when FluentRead is globally off and relocalizes keyed labels', () => {
    const {document} = parseHTML('<!doctype html><body></body>');
    vi.stubGlobal('document', document);
    const menu = createVideoPlayerMenu('zh-CN', true);
    const checked = () => [...menu.querySelectorAll<HTMLElement>('[data-mode][aria-checked="true"]')].map(item => item.dataset.mode);

    renderVideoMenuMode(menu, 'translation-only', false, '');
    expect(checked()).toEqual(['translation-only']);
    renderVideoMenuMode(menu, 'off', true, 'FluentRead 总开关已关闭');
    expect(checked()).toEqual(['off']);
    expect([...menu.querySelectorAll<HTMLButtonElement>('[data-mode]')].every(item => item.disabled)).toBe(true);
    expect(menu.querySelector<HTMLElement>('.fluent-read-video-menu-mode-group')?.title).toBe('FluentRead 总开关已关闭');

    refreshVideoUiText(menu, 'ja-JP');
    expect(menu.querySelector('[data-mode="off"]')?.textContent).toBe('オフ');
    expect(menu.querySelector('[data-mode="off"]')?.getAttribute('title')).toContain('FluentRead');
    expect(menu.querySelector('[data-action="download-translated-subtitles"]')?.getAttribute('aria-label')).toBe(
      menu.querySelector('[data-action="download-translated-subtitles"]')?.getAttribute('title'),
    );
  });

  it('opens a model confirmation view with recommendation, sizes and downloaded state, then returns to the menu', () => {
    const {document} = parseHTML('<!doctype html><body></body>');
    vi.stubGlobal('document', document);
    const menu = createVideoPlayerMenu('zh-CN', true);
    const main = menu.querySelector<HTMLElement>('.fluent-read-video-menu-main')!;
    const prompt = menu.querySelector<HTMLElement>('[data-model-prompt]')!;

    renderVideoModelPrompt(menu, {options: VIDEO_LOCAL_TRANSCRIPTION_MODELS, downloaded: [], recommended: 'base', selected: 'base'}, 'zh-CN');
    expect(isVideoModelPromptOpen(menu)).toBe(true);
    expect(main.hidden).toBe(true);
    expect(prompt.hidden).toBe(false);
    expect(readVideoModelPromptSelection(menu)).toBe('base');
    const options = [...prompt.querySelectorAll<HTMLElement>('[data-model-choice]')];
    expect(options.map(option => [option.dataset.modelChoice, option.getAttribute('aria-checked')])).toEqual([['tiny', 'false'], ['base', 'true']]);
    expect(options[0].textContent).toContain('约 100 MB');
    expect(options[1].textContent).toContain('推荐');
    expect(options[1].textContent).toContain('约 150 MB');
    expect(prompt.querySelector('[data-action="model-prompt-confirm"]')?.textContent).toBe('下载并生成');

    const focusedOption = prompt.querySelector<HTMLElement>('[data-model-choice="tiny"]');
    renderVideoModelPrompt(menu, {options: VIDEO_LOCAL_TRANSCRIPTION_MODELS, downloaded: [], recommended: 'base', selected: 'tiny'}, 'zh-CN');
    expect(prompt.querySelector('[data-model-choice="tiny"]')).toBe(focusedOption);
    expect(focusedOption?.getAttribute('aria-checked')).toBe('true');
    renderVideoModelPrompt(menu, {options: VIDEO_LOCAL_TRANSCRIPTION_MODELS, downloaded: ['tiny'], recommended: 'base', selected: 'tiny'}, 'zh-CN');
    expect(prompt.querySelector('[data-model-choice="tiny"]')).not.toBe(focusedOption);
    expect(prompt.querySelector('[data-model-choice="tiny"]')?.textContent).toContain('已下载');
    expect(prompt.querySelector('[data-action="model-prompt-confirm"]')?.textContent).toBe('开始生成');
    refreshVideoUiText(menu, 'en-US');
    expect(prompt.querySelector('[data-model-choice="base"]')?.textContent).toContain('~150 MB');
    expect(prompt.querySelector('[data-action="model-prompt-confirm"]')?.textContent).toBe('Generate');

    renderVideoModelPrompt(menu, null, 'zh-CN');
    expect(isVideoModelPromptOpen(menu)).toBe(false);
    const youtubeMenu = createVideoPlayerMenu('zh-CN', false);
    expect(() => renderVideoModelPrompt(youtubeMenu, null, 'zh-CN')).not.toThrow();
    expect(isVideoModelPromptOpen(youtubeMenu)).toBe(false);
    expect(main.hidden).toBe(false);
    expect(prompt.hidden).toBe(true);
  });

  it('shares one download status line and only clears feedback that was not replaced', () => {
    vi.useFakeTimers();
    try {
      const {document} = parseHTML('<!doctype html><body></body>');
      vi.stubGlobal('document', document);
      const menu = createVideoPlayerMenu('zh-CN', false);
      const status = menu.querySelector<HTMLElement>('[data-download-status]')!;
      setVideoMenuDownloadStatus(menu, '已下载 · 2 条', 2400);
      expect(status.textContent).toBe('已下载 · 2 条');
      vi.advanceTimersByTime(1000);
      setVideoMenuDownloadStatus(menu, '正在获取…');
      vi.advanceTimersByTime(2000);
      expect(status.textContent).toBe('正在获取…');
      setVideoMenuDownloadStatus(menu, '已下载 · 2 条', 2200);
      vi.advanceTimersByTime(2200);
      expect(status.textContent).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('switches to the short layout only when a wide player cannot fit the single column comfortably', () => {
    const {document} = parseHTML('<!doctype html><body><div id="player"></div></body>');
    vi.stubGlobal('document', document);
    const player = document.getElementById('player')!;
    const menu = createVideoPlayerMenu('zh-CN', true);
    player.appendChild(menu);
    const size = (width: number, height: number, contentHeight: number) => {
      Object.defineProperty(player, 'clientWidth', {configurable: true, value: width});
      Object.defineProperty(player, 'clientHeight', {configurable: true, value: height});
      Object.defineProperty(menu, 'scrollHeight', {configurable: true, value: contentHeight});
    };

    size(390, 220, 172);
    syncVideoPlayerMenuLayout(menu);
    expect(menu.dataset.layout).toBe('stack');
    menu.hidden = false;
    syncVideoPlayerMenuLayout(menu);
    expect(menu.dataset.layout).toBe('wide');
    expect(menu.dataset.measuring).toBeUndefined();
    size(640, 360, 172);
    syncVideoPlayerMenuLayout(menu);
    expect(menu.dataset.layout).toBe('stack');
    size(280, 200, 172);
    syncVideoPlayerMenuLayout(menu);
    expect(menu.dataset.layout).toBe('stack');
    size(0, 0, 172);
    menu.dataset.layout = 'wide';
    syncVideoPlayerMenuLayout(menu);
    expect(menu.dataset.layout).toBe('wide');
    player.removeChild(menu);
    syncVideoPlayerMenuLayout(menu);
    expect(readVideoModelPromptSelection(menu)).toBeNull();
  });

  it('renders idle, checking, running, waiting, error, and unsupported states accessibly', () => {
    const {document} = parseHTML('<!doctype html><body></body>');
    vi.stubGlobal('document', document);
    const menu = createVideoPlayerMenu('zh-CN', true);
    const button = menu.querySelector<HTMLButtonElement>('[data-action="toggle-ai-subtitle"]')!;

    renderVideoAiMenu(menu, state(), 'zh-CN');
    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain('生成 AI 字幕');
    expect(button.dataset.processing).toBe('false');
    expect(button.dataset.error).toBe('false');

    renderVideoAiMenu(menu, state({checking: true}), 'zh-CN');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('检查模型中');
    expect(button.dataset.processing).toBe('true');

    renderVideoAiMenu(menu, state({active: true, running: true}), 'zh-CN');
    expect(button.textContent).toContain('停止生成');
    expect(button.querySelector('[data-state]')?.textContent).toBe('生成中…');
    expect(button.getAttribute('aria-checked')).toBe('true');

    renderVideoAiMenu(menu, state({requested: true}), 'zh-CN');
    expect(button.textContent).toContain('生成 AI 字幕');
    expect(button.querySelector('[data-state]')?.textContent).toBe('等待播放');

    renderVideoAiMenu(menu, state({error: '模型下载失败'}), 'zh-CN');
    expect(button.textContent).toContain('重试生成 AI 字幕');
    expect(button.dataset.error).toBe('true');
    expect(button.title).toBe('模型下载失败');

    renderVideoAiMenu(menu, state({available: false, error: '本地模型不可用'}), 'zh-CN');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('本地 AI 暂不可用');
    expect(button.dataset.error).toBe('true');
  });

  it('renders full capture lifecycle details and progress without replacing the menu node', () => {
    const {document} = parseHTML('<!doctype html><body></body>');
    vi.stubGlobal('document', document);
    const menu = createVideoPlayerMenu('zh-CN', true);
    const button = menu.querySelector<HTMLButtonElement>('[data-action="toggle-ai-subtitle"]')!;

    renderVideoAiMenu(menu, state({active: true, fullActive: true, phase: 'capturing'}), 'zh-CN');
    expect(button.textContent).toContain('读取音频中');

    renderVideoAiMenu(menu, state({active: true, fullActive: true, phase: 'transcribing', progress: progress(0.42)}), 'zh-CN');
    expect(button.textContent).toContain('识别 42%');

    renderVideoAiMenu(menu, state({active: true, fullActive: true, phase: 'translating', progress: progress(0.875)}), 'zh-CN');
    expect(button.textContent).toContain('翻译 88%');

    expect(button.dataset.progress).toBe('determinate');
    expect(button.style.getPropertyValue('--fluent-read-video-ai-progress')).toBe('88%');

    renderVideoAiMenu(menu, state({active: true, fullActive: true, phase: 'ready'}), 'zh-CN');
    expect(button.querySelector('.fluent-read-video-menu-label')?.textContent).toBe('关闭 AI 字幕');
    expect(button.querySelector('[data-state]')?.textContent).toBe('已就绪');
    expect(button.dataset.processing).toBe('false');
    expect(button.dataset.ready).toBe('true');
    expect(button.dataset.progress).toBe('none');

    renderVideoAiMenu(menu, state({fullActive: true, phase: 'idle'}), 'zh-CN');
    expect(button.querySelector('[data-state]')?.textContent).toBe('准备中…');
    expect(button.dataset.ready).toBe('false');
    expect(menu.querySelector('[data-action="toggle-ai-subtitle"]')).toBe(button);
  });

  it('shows model downloads as an indeterminate, non-cancellable step and hides stale errors meanwhile', () => {
    const {document} = parseHTML('<!doctype html><body></body>');
    vi.stubGlobal('document', document);
    const menu = createVideoPlayerMenu('zh-CN', true);
    const button = menu.querySelector<HTMLButtonElement>('[data-action="toggle-ai-subtitle"]')!;

    renderVideoAiMenu(menu, state({downloading: true, error: '旧错误'}), 'zh-CN');
    expect(button.querySelector('.fluent-read-video-menu-label')?.textContent).toBe('正在下载模型…');
    expect(button.disabled).toBe(true);
    expect(button.dataset.processing).toBe('true');
    expect(button.dataset.progress).toBe('indeterminate');
    expect(button.dataset.error).toBe('false');
    expect(button.querySelector('[data-state]')?.textContent).toBe('');
  });

  it('returns safely when the optional AI action is absent', () => {
    const {document} = parseHTML('<!doctype html><body></body>');
    vi.stubGlobal('document', document);
    const menu = createVideoPlayerMenu('zh-CN', false);
    expect(() => renderVideoAiMenu(menu, state(), 'zh-CN')).not.toThrow();
  });
});
