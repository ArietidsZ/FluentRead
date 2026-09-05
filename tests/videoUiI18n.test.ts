import {afterEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';

import {
  createVideoPlayerMenu,
  renderVideoAiMenu,
  type VideoAiMenuState,
} from '@/src/features/video-subtitle/content/playerMenu';

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
  it('creates an accessible stable menu with optional local generation and display modes', () => {
    const {document} = parseHTML('<!doctype html><body></body>');
    vi.stubGlobal('document', document);

    const menu = createVideoPlayerMenu('zh-CN', true);
    expect(menu.id).toBe('fluent-read-video-subtitle-menu');
    expect(menu.hidden).toBe(true);
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.getAttribute('aria-label')).toBeTruthy();
    expect(menu.getAttribute('data-fluent-read-ui')).toBe('video-subtitle');
    expect(menu.getAttribute('translate')).toBe('no');
    expect(menu.querySelector('[data-action="toggle-ai-subtitle"]')).toBeTruthy();
    expect(menu.querySelectorAll('[role="menuitemcheckbox"]')).toHaveLength(3);
    expect(menu.querySelectorAll('[role="menuitemradio"]')).toHaveLength(3);
    expect(menu.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBeTruthy();
    expect(menu.querySelectorAll('[data-action="download-subtitles"], [data-action="download-translated-subtitles"]'))
      .toHaveLength(2);

    const withoutLocalGeneration = createVideoPlayerMenu('en-US', false);
    expect(withoutLocalGeneration.querySelector('[data-action="toggle-ai-subtitle"]')).toBeNull();
    expect(withoutLocalGeneration.querySelector('[role="radiogroup"]')?.textContent)
      .toContain('Bilingual');
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

    renderVideoAiMenu(menu, state({active: true, fullActive: true, phase: 'ready'}), 'zh-CN');
    expect(button.textContent).toContain('关闭 AI 字幕');
    expect(button.querySelector('[data-state]')?.textContent).toBe('已就绪');
    expect(button.dataset.processing).toBe('false');

    renderVideoAiMenu(menu, state({fullActive: true, phase: 'idle'}), 'zh-CN');
    expect(button.querySelector('[data-state]')?.textContent).toBe('准备中…');
    expect(button.parentElement?.parentElement).toBe(menu);
  });

  it('returns safely when the optional AI action is absent', () => {
    const {document} = parseHTML('<!doctype html><body></body>');
    vi.stubGlobal('document', document);
    const menu = createVideoPlayerMenu('zh-CN', false);
    expect(() => renderVideoAiMenu(menu, state(), 'zh-CN')).not.toThrow();
  });
});
