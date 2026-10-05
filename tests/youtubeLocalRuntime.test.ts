import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {Config} from '@/src/core/config/model';
import type {VideoAiCaptureOptions} from '@/src/features/video-subtitle/content/video-ai/capture';

const state = vi.hoisted(() => ({
  config: {} as Config,
  options: null as VideoAiCaptureOptions | null,
  requested: false, running: false, catalogMode: 'synthetic',
  send: vi.fn(), translate: vi.fn(async (text: string) => 'translated: ' + text),
}));
vi.mock('@/src/services/config/store', () => ({
  config: state.config, subscribeConfig: () => () => {},
  requestConfigPatch: async (patch: Partial<Config>) => Object.assign(state.config, patch),
}));
vi.mock('webextension-polyfill', () => ({default: {runtime: {getURL: (path: string) => path}}}));
vi.mock('@/src/platform/browser/runtimeMessages', () => ({sendRuntimeMessage: state.send}));
vi.mock('@/src/platform/browser/capabilities', () => ({browserCapabilities: {extensionDom: true}}));
vi.mock('@/src/app/translation/client', () => ({translateVideoText: state.translate}));
vi.mock('@/src/features/video-subtitle/transcription', async importOriginal => {
  const original = await importOriginal<Record<string, unknown>>();
  const model = 'qwen3-asr-0.6b';
  const catalog = original.VIDEO_LOCAL_TRANSCRIPTION_MODELS as readonly {value: string}[];
  // 合并共享引擎后必须使用真实目录及归一化函数；独立补丁仅注入缺失的模型契约。
  if (catalog.some(item => item.value === model)) {
    state.catalogMode = 'actual';
    return original;
  }
  return {...original,
    VIDEO_LOCAL_TRANSCRIPTION_MODELS: [{value: model, label: model, downloadSizeMb: 1}],
    normalizeVideoLocalTranscriptionModel: () => model,
    normalizeVideoLocalTranscriptionModels: (models: string[]) => models.filter(value => value === model),
  };
});
vi.mock('@/src/features/video-subtitle/content/video-ai/capture', () => ({
  VideoAiCaptureController: class {
    constructor(options: VideoAiCaptureOptions) { state.options = options; }
    isRunning() { return state.running; }
    isRequested() { return state.requested; }
    getSessionId() { return 1; }
    getError() { return ''; }
    request() { state.requested = true; state.options!.onStateChange(); }
    start() {
      state.requested = state.running = true;
      state.options!.onReset(); state.options!.onSessionStart?.(1); state.options!.onStateChange(); return true;
    }
    cancel() {
      state.requested = state.running = false;
      state.options!.onInvalidate?.('cancel', 1); state.options!.onStateChange();
    }
    pause() { state.running = false; state.options!.onStateChange(); }
    resetAfterSeek() { state.running = false; state.options!.onInvalidate?.('seek', 1); state.options!.onReset(); }
    resumeAfterSeek() { this.start(); }
    resetAfterPlaybackRateChange() { this.resetAfterSeek(); this.start(); }
    end() { state.running = false; }
    destroy() { this.cancel(); }
  },
}));
import {mountVideoSubtitleTranslation} from '@/src/features/video-subtitle/content/runtime';
import {findCaptionContainer} from '@/src/features/video-subtitle/content/ui';

let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  state.requested = state.running = false;
  state.send.mockReset().mockImplementation(async (message: {type: string}) =>
    message.type === 'fluentReadGetLocalVideoModelState'
      ? {success: true, models: ['qwen3-asr-0.6b']}
      : {success: true, backend: 'webgpu', text: 'Local words.'});
  state.translate.mockClear();
  Object.assign(state.config, new Config(), {
    on: true, videoTranslationEnabled: true, videoSubtitleVisible: true,
    videoSubtitleDisplayMode: 'original-only', videoPreferHumanSubtitles: false, uiLanguage: 'zh-CN',
  });
});
afterEach(() => { dispose?.(); dispose = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
function fixture(url = 'https://www.youtube.com/watch?v=first') {
  const {document, window} = parseHTML('<html><head></head><body><div id="movie_player"><video class="html5-main-video"></video><div class="ytp-right-controls"><button class="ytp-fullscreen-button"></button></div><div id="ytp-caption-window-container"><span class="ytp-caption-segment">Native words.</span></div></div></body></html>');
  const location = new URL(url);
  Object.defineProperty(window, 'location', {configurable: true, value: location});
  for (const key of ['document', 'window', 'HTMLElement', 'HTMLButtonElement', 'HTMLStyleElement', 'Element', 'HTMLVideoElement', 'Event', 'CustomEvent', 'Node'] as const) {
    vi.stubGlobal(key, key === 'document' ? document : key === 'window' ? window : window[key]);
  }
  vi.stubGlobal('MutationObserver', class {observe() {} disconnect() {}});
  vi.stubGlobal('ResizeObserver', class {observe() {} disconnect() {}});
  vi.stubGlobal('getComputedStyle', () => ({display: 'block', visibility: 'visible', opacity: '1', position: 'relative', getPropertyValue: () => ''}));
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  Object.defineProperty(window, 'innerWidth', {value: 1280, configurable: true});
  Object.defineProperty(window, 'innerHeight', {value: 720, configurable: true});
  const video = document.querySelector('video')! as unknown as HTMLVideoElement;
  Object.assign(video, {currentTime: 1, duration: 60, paused: false, ended: false, seeking: false, playbackRate: 1, textTracks: Object.assign([], {addEventListener() {}, removeEventListener() {}}), currentSrc: 'blob:fixture'});
  for (const node of document.querySelectorAll('*')) {
    node.getBoundingClientRect = () => ({width: 640, height: 360, top: 0, left: 0, right: 640, bottom: 360}) as DOMRect;
  }
  const click = async (selector: string) => {
    const node = document.querySelector(selector)!;
    expect(node, selector).not.toBeNull();
    const event = new window.Event('click', {bubbles: true});
    Object.defineProperty(event, 'isTrusted', {value: true});
    node.dispatchEvent(event);
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  dispose = mountVideoSubtitleTranslation();
  return {document, window, video, location, click};
}

describe('YouTube runtime local-caption integration with synthetic GPU response', () => {
  it('reports whether the shared model catalog is installed', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('@/src/features/video-subtitle/transcription');
    const hasQwen = (actual.VIDEO_LOCAL_TRANSCRIPTION_MODELS as readonly {value: string}[])
      .some(item => item.value === 'qwen3-asr-0.6b');
    expect(state.catalogMode).toBe(hasQwen ? 'actual' : 'synthetic');
    if (process.env.FLUENTREAD_EXPECT_ACTUAL_QWEN_CATALOG === '1') {
      expect(hasQwen).toBe(true);
      expect(state.catalogMode).toBe('actual');
    }
    console.info('YouTube runtime model catalog:', state.catalogMode);
  });
  it('keeps native by default; explicit local request routes GPU model and cancellation restores native', async () => {
    const f = fixture();
    expect(state.requested).toBe(false);
    expect(state.send.mock.calls.some(([message]) => /VideoAiSubtitleCache/.test(message.type))).toBe(false);
    expect(findCaptionContainer()?.textContent).toBe('Native words.');
    await f.click('#fluent-read-video-subtitle-button');
    await f.click('[data-action="toggle-ai-subtitle"]');
    expect(state.requested).toBe(true);
    expect(state.options!.getModel()).toBe('qwen3-asr-0.6b');
    state.options!.onCue({startMs: 0, durationMs: 2000, spokenEndMs: 2000, availableAtMs: 0, text: 'Local words.'});
    expect(findCaptionContainer()?.textContent).toBe('Local words.');
    await f.click('[data-action="toggle-ai-subtitle"]');
    expect(state.requested).toBe(false);
    expect(findCaptionContainer()?.textContent).toBe('Native words.');
    expect(f.document.querySelector('[data-fluent-read-local-ai-active]')).toBeNull();
    expect(state.send.mock.calls.some(([message]) => /VideoAiSubtitleCache/.test(message.type))).toBe(false);
  });
  it('cancels the current GPU generation on SPA navigation', async () => {
    const f = fixture();
    await f.click('#fluent-read-video-subtitle-button');
    await f.click('[data-action="toggle-ai-subtitle"]');
    f.location.search = '?v=second';
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.requested).toBe(false);
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({type: 'fluentReadCancelLocalVideoTranscription'}));
  });
  it('keeps the shared GPU route and source language, rejects CPU output without retry', async () => {
    const f = fixture();
    await f.click('#fluent-read-video-subtitle-button');
    await f.click('[data-action="toggle-ai-subtitle"]');
    const chunk = {pcm: new Float32Array([0.2]), startMs: 0, durationMs: 1,
      audioDurationMs: 1, playbackRate: 1, sequence: 1, sessionId: 1};
    await expect(state.options!.transcribe(chunk)).resolves.toMatchObject({backend: 'webgpu'});
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'fluentReadTranscribeLocalVideoAudio', model: 'qwen3-asr-0.6b',
      sourceLanguage: state.config.videoSourceLanguage, generation: 1,
    }));
    state.send.mockClear().mockResolvedValueOnce({success: true, backend: 'wasm', text: 'CPU'});
    await expect(state.options!.transcribe(chunk)).rejects.toThrow('未启用 CPU 回退');
    expect(state.send).toHaveBeenCalledTimes(1);
    state.send.mockResolvedValueOnce({success: true, skipped: true});
    await expect(state.options!.transcribe(chunk)).resolves.toMatchObject({skipped: true});
  });
  it('resets the active audio window on seek and waits for playback when paused', async () => {
    const f = fixture();
    Object.assign(f.video, {paused: true});
    await f.click('#fluent-read-video-subtitle-button');
    await f.click('[data-action="toggle-ai-subtitle"]');
    expect(state.requested).toBe(true);
    expect(state.running).toBe(false);
    Object.assign(f.video, {paused: false});
    f.video.dispatchEvent(new f.window.Event('play', {bubbles: true}));
    expect(state.running).toBe(true);
    state.options!.onCue({startMs: 0, durationMs: 2000, spokenEndMs: 2000, availableAtMs: 0, text: 'Old position.'});
    f.video.dispatchEvent(new f.window.Event('seeking', {bubbles: true}));
    expect(state.running).toBe(false);
    expect(findCaptionContainer()?.textContent).toBe('');
    f.video.dispatchEvent(new f.window.Event('seeked', {bubbles: true}));
    expect(state.running).toBe(true);
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({type: 'fluentReadCancelLocalVideoTranscription', reason: 'seek'}));
  });

  it('keeps the local timeline during native track updates and restores native after capture failure', async () => {
    const f = fixture();
    Object.assign(state.config, {videoSubtitleDisplayMode: 'bilingual'});
    await f.click('#fluent-read-video-subtitle-button');
    await f.click('[data-action="toggle-ai-subtitle"]');
    state.options!.onCue({startMs: 0, durationMs: 2000, spokenEndMs: 2000, availableAtMs: 0, text: 'Local words.'});
    const event = new f.window.Event('message');
    Object.assign(event, {source: f.window, origin: f.location.origin, data: {
      source: 'fluent-read', type: 'fluent-read-youtube-timedtext',
      url: 'https://www.youtube.com/api/timedtext?v=first&lang=en',
      responseText: JSON.stringify({events: [{tStartMs: 0, dDurationMs: 2000, segs: [{utf8: 'New native words.'}]}]}),
    }});
    f.window.dispatchEvent(event);
    expect(findCaptionContainer()?.textContent).toBe('Local words.');
    state.options!.onError(new Error('Audio inaccessible'));
    state.running = state.requested = false;
    state.options!.onStateChange();
    expect(findCaptionContainer()?.id).toBe('ytp-caption-window-container');
    expect(f.document.querySelector('[data-fluent-read-local-ai-active]')).toBeNull();
  });

  it('does not renew duplicate or older live output, but permits the same words in a genuinely later captured cue', async () => {
    const f = fixture();
    await f.click('#fluent-read-video-subtitle-button');
    await f.click('[data-action="toggle-ai-subtitle"]');
    const first = {cueId: 'session-1:first', startMs: 0, durationMs: 2000, spokenEndMs: 2000, availableAtMs: 2100, text: 'Repeated words are spoken.'};
    f.video.currentTime = 2.1;
    state.options!.onCue(first);
    expect(findCaptionContainer()?.textContent).toBe(first.text);
    await vi.advanceTimersByTimeAsync(1000);
    f.video.currentTime = 3.1;
    state.options!.onCue({...first, availableAtMs: 3100});
    await vi.advanceTimersByTimeAsync(800);
    expect(findCaptionContainer()?.textContent).toBe('');
    f.video.currentTime = 4;
    state.options!.onCue({...first, availableAtMs: 4000});
    expect(findCaptionContainer()?.textContent).toBe('');
    const later = {...first, cueId: 'session-1:later', startMs: 5000, spokenEndMs: 7000, availableAtMs: 7100};
    f.video.currentTime = 7.1;
    state.options!.onCue(later);
    expect(findCaptionContainer()?.textContent).toBe(first.text);
    state.options!.onCue({...first, text: 'An older correction arrives.'});
    expect(findCaptionContainer()?.textContent).toBe(first.text);
    await vi.advanceTimersByTimeAsync(1800);
    expect(findCaptionContainer()?.textContent).toBe('');
    // A changed interim correction is new text; an unchanged repetition of it is not.
    const correction = {...later, text: 'Repeated words are spoken clearly.', availableAtMs: 9000};
    f.video.currentTime = 9;
    state.options!.onCue(correction);
    expect(findCaptionContainer()?.textContent).toBe(correction.text);
    await vi.advanceTimersByTimeAsync(1000);
    f.video.currentTime = 10;
    state.options!.onCue({...correction, availableAtMs: 10000});
    await vi.advanceTimersByTimeAsync(800);
    expect(findCaptionContainer()?.textContent).toBe('');
    await f.click('[data-action="toggle-ai-subtitle"]');
    expect(findCaptionContainer()?.textContent).toBe('Native words.');
  });

  it('keeps the X model catalog and historical caption timing instead of adopting YouTube live presentation', async () => {
    state.send.mockImplementation(async (message: {type: string}) => message.type === 'fluentReadGetLocalVideoModelState'
      ? {success: true, models: []} : {success: true});
    const f = fixture('https://x.com/person/status/123');
    await f.click('#fluent-read-video-subtitle-button');
    await f.click('[data-action="toggle-ai-subtitle"]');
    const modelChoices = Array.from(f.document.querySelectorAll('[data-model-choice]')).map(node => node.getAttribute('data-model-choice'));
    expect(modelChoices).toEqual(expect.arrayContaining(['tiny', 'base', 'qwen3-asr-0.6b']));
    expect(f.document.querySelector('[data-model-choice="tiny"]')?.getAttribute('aria-checked')).toBe('true');
    await f.click('[data-action="model-prompt-cancel"]');
    // Drive the established capture-controller output boundary; X should retain spoken-time selection.
    state.running = state.requested = true;
    state.options!.onCue({cueId: 'x:first', startMs: 0, durationMs: 2000, spokenEndMs: 2000, availableAtMs: 1000, text: 'X spoken words.'});
    expect(findCaptionContainer()?.textContent).toBe('X spoken words.');
    await vi.advanceTimersByTimeAsync(1800);
    expect(findCaptionContainer()?.textContent).toBe('X spoken words.');
    f.video.currentTime = 3;
    f.video.dispatchEvent(new f.window.Event('timeupdate', {bubbles: true}));
    expect(findCaptionContainer()?.textContent).toBe('');
    expect(f.document.querySelector('[data-fluent-read-local-ai-active]')).toBeNull();
  });

});
