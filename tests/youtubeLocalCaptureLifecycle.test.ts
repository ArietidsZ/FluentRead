/**
 * @file tests/youtubeLocalCaptureLifecycle.test.ts
 * 文件职责：在确定性 DOM 与浏览器音频边界夹具中检查 YouTube 本地字幕真实编排及采集状态机。
 * 主要内容：保留真实模型目录、PCM 窗口、会话失效与字幕来源，验证显式启动、保护音轨拒绝、暂停/跳转/卸载和迟到响应。
 * 模块边界：仅替换配置、翻译/扩展消息、Web Audio 与媒体 DOM 平台边界；不加载真实模型，不代表浏览器捕获或布局验收。
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {Config} from '@/src/core/config/model';
import {VIDEO_LOCAL_TRANSCRIPTION_MODELS} from '@/src/features/video-subtitle/transcription';
import * as downloadsModule from '@/src/features/video-subtitle/content/downloads';

const state = vi.hoisted(() => ({
  config: {} as Config,
  subscriber: undefined as ((config: Config) => void) | undefined,
  send: vi.fn(), translate: vi.fn(async (text: string) => 'translated: ' + text),
}));
vi.mock('@/src/services/config/store', () => ({
  config: state.config,
  subscribeConfig: (listener: (config: Config) => void) => { state.subscriber = listener; return () => { state.subscriber = undefined; }; },
  requestConfigPatch: async (patch: Partial<Config>) => Object.assign(state.config, patch),
}));
vi.mock('webextension-polyfill', () => ({default: {runtime: {getURL: (path: string) => path}}}));
vi.mock('@/src/platform/browser/runtimeMessages', () => ({sendRuntimeMessage: state.send}));
vi.mock('@/src/platform/browser/capabilities', () => ({browserCapabilities: {extensionDom: true}}));
vi.mock('@/src/app/translation/client', () => ({translateVideoText: state.translate}));
import {mountVideoSubtitleTranslation} from '@/src/features/video-subtitle/content/runtime';
import {findCaptionContainer, VIDEO_AI_CAPTION_CONTAINER_ID} from '@/src/features/video-subtitle/content/ui';

class AudioTrack {
  muted = false;
  stop = vi.fn();
  readonly listeners = new Map<string, Set<EventListener>>();
  addEventListener(type: string, listener: EventListener) { const set = this.listeners.get(type) || new Set(); set.add(listener); this.listeners.set(type, set); }
  removeEventListener(type: string, listener: EventListener) { this.listeners.get(type)?.delete(listener); }
  emit(type: string) { this.listeners.get(type)?.forEach(listener => listener(new Event(type))); }
  clone() { return new AudioTrack(); }
}
class AudioStream {
  constructor(readonly tracks: AudioTrack[]) {}
  getAudioTracks() { return this.tracks; }
  getTracks() { return this.tracks; }
}
class AudioNode {
  connect = vi.fn();
  disconnect = vi.fn();
  gain = {value: 1};
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null = null;
}
class AudioContextFixture {
  static instances: AudioContextFixture[] = [];
  state = 'running';
  readonly source = new AudioNode();
  readonly processor = new AudioNode();
  readonly sink = new AudioNode();
  readonly destination = new AudioNode();
  close = vi.fn(async () => { this.state = 'closed'; });
  resume = vi.fn(async () => {});
  constructor() { AudioContextFixture.instances.push(this); }
  createMediaStreamSource() { return this.source; }
  createScriptProcessor() { return this.processor; }
  createGain() { return this.sink; }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
async function settle() { for (let i = 0; i < 35; i++) await Promise.resolve(); }
const localResult = {success: true, backend: 'webgpu', text: 'Local words arrive now.', segments: [{startMs: 0, endMs: 1600, text: 'Local words arrive now.'}]};
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  AudioContextFixture.instances = [];
  delete (AudioContextFixture.prototype as unknown as {decodeAudioData?: unknown}).decodeAudioData;
  state.subscriber = undefined;
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected fixture request'); }));
  state.send.mockReset().mockImplementation(async (message: {type: string}) => message.type === 'fluentReadGetLocalVideoModelState'
    ? {success: true, models: ['qwen3-asr-0.6b']} : message.type === 'fluentReadTranscribeLocalVideoAudio' ? localResult : {success: true});
  state.translate.mockReset().mockImplementation(async (text: string) => 'translated: ' + text);
  Object.assign(state.config, new Config(), {on: true, videoTranslationEnabled: true, videoSubtitleVisible: true,
    videoSubtitleDisplayMode: 'original-only', videoPreferHumanSubtitles: false, uiLanguage: 'zh-CN'});
});
afterEach(() => { dispose?.(); dispose = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

type CaptionTrack = {baseUrl: string; languageCode: string; kind?: string};
function fixture(options: {url?: string; captionTracks?: CaptionTrack[]} = {}) {
  const {document, window} = parseHTML('<html><head></head><body><div id="movie_player"><video class="html5-main-video"></video><div class="ytp-right-controls"><button class="ytp-fullscreen-button"></button></div><button class="ytp-subtitles-button" aria-pressed="true"></button><div id="ytp-caption-window-container"><span class="ytp-caption-segment">Native words.</span></div></div></body></html>');
  const location = new URL(options.url || 'https://www.youtube.com/watch?v=first');
  Object.defineProperty(window, 'location', {configurable: true, value: location});
  for (const key of ['document', 'window', 'HTMLElement', 'HTMLButtonElement', 'HTMLStyleElement', 'Element', 'HTMLVideoElement', 'Event', 'CustomEvent', 'Node'] as const)
    vi.stubGlobal(key, key === 'document' ? document : key === 'window' ? window : window[key]);
  vi.stubGlobal('MutationObserver', class {observe() {} disconnect() {}});
  vi.stubGlobal('ResizeObserver', class {observe() {} disconnect() {}});
  vi.stubGlobal('getComputedStyle', () => ({display: 'block', visibility: 'visible', opacity: '1', position: 'relative', getPropertyValue: () => ''}));
  vi.stubGlobal('MediaStream', AudioStream);
  window.AudioContext = AudioContextFixture as unknown as typeof AudioContext;
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  Object.defineProperty(window, 'innerWidth', {value: 1280, configurable: true});
  Object.defineProperty(window, 'innerHeight', {value: 720, configurable: true});
  Object.defineProperty(document, 'visibilityState', {value: 'visible', writable: true, configurable: true});
  const tracks: AudioTrack[] = [];
  let nextTrackMuted = false;
  const frames = new Map<number, VideoFrameRequestCallback>();
  let frameId = 0;
  function initializeVideo(video: HTMLVideoElement) {
    Object.assign(video, {currentTime: 1, duration: 60, paused: false, ended: false, seeking: false, playbackRate: 1,
      textTracks: Object.assign([], {addEventListener() {}, removeEventListener() {}}), currentSrc: 'blob:fixture', poster: '',
      captureStream: vi.fn(() => { const track = new AudioTrack(); track.muted = nextTrackMuted; tracks.push(track); return new AudioStream([track]); }),
      requestVideoFrameCallback: (callback: VideoFrameRequestCallback) => { frames.set(++frameId, callback); return frameId; },
      cancelVideoFrameCallback: (id: number) => { frames.delete(id); },
    });
    video.getBoundingClientRect = () => ({width: 640, height: 360, top: 0, left: 0, right: 640, bottom: 360}) as DOMRect;
    return video;
  }
  let video = initializeVideo(document.querySelector('video')! as unknown as HTMLVideoElement);
  for (const node of document.querySelectorAll('*')) node.getBoundingClientRect = () => ({width: 640, height: 360, top: 0, left: 0, right: 640, bottom: 360}) as DOMRect;
  const click = async (selector: string) => {
    const node = document.querySelector(selector); expect(node, selector).not.toBeNull();
    const event = new window.Event('click', {bubbles: true}); Object.defineProperty(event, 'isTrusted', {value: true});
    node!.dispatchEvent(event); await settle();
  };
  const event = async (type: string) => { video.dispatchEvent(new window.Event(type, {bubbles: true})); await settle(); };
  const captionTracks = (tracks: CaptionTrack[]) => {
    const script = document.createElement('script');
    script.textContent = 'var ytInitialPlayerResponse=' + JSON.stringify({videoDetails: {videoId: 'first'}, captions: {playerCaptionsTracklistRenderer: {captionTracks: tracks}}}) + ';';
    document.head.appendChild(script);
  };
  if (options.captionTracks) captionTracks(options.captionTracks);
  dispose = mountVideoSubtitleTranslation();
  return {document, window, location, tracks, frames, get video() { return video; }, click, event, captionTracks,
    start: async () => { await click('#fluent-read-video-subtitle-button'); await click('[data-action="toggle-ai-subtitle"]'); },
    muteNext: () => { nextTrackMuted = true; },
    replaceVideo: async () => { const replacement = initializeVideo(document.createElement('video') as unknown as HTMLVideoElement); replacement.className = 'html5-main-video'; video.replaceWith(replacement); video = replacement; await event('loadedmetadata'); },
    configure: async (patch: Partial<Config>) => { Object.assign(state.config, patch); state.subscriber?.(state.config); await settle(); },
    visibility: async (value: string) => { Object.defineProperty(document, 'visibilityState', {value, writable: true, configurable: true}); document.dispatchEvent(new window.Event('visibilitychange')); await settle(); },
    tickFrame: async () => { const entry = frames.entries().next().value; expect(entry).toBeDefined(); frames.delete(entry![0]); entry![1](0, {} as VideoFrameCallbackMetadata); await settle(); },
    speech: async (durationMs = 1600) => {
      const context = AudioContextFixture.instances.at(-1)!; expect(context).toBeDefined();
      for (let offset = 0; offset < durationMs * 16; offset += 4096) {
        const count = Math.min(4096, durationMs * 16 - offset); video.currentTime += count / 16000;
        const samples = Float32Array.from({length: count}, (_, i) => 0.1 * Math.sin(2 * Math.PI * 220 * (offset + i) / 16000));
        context.processor.onaudioprocess?.({inputBuffer: {numberOfChannels: 1, sampleRate: 16000, getChannelData: () => samples}} as unknown as AudioProcessingEvent);
      }
      await settle();
    },
  };
}
function transcriptions() { return state.send.mock.calls.filter(([message]) => message.type === 'fluentReadTranscribeLocalVideoAudio'); }
function expectNative(f: ReturnType<typeof fixture>) {
  expect(findCaptionContainer()?.id).toBe('ytp-caption-window-container');
  expect(findCaptionContainer()?.textContent).toBe('Native words.');
  expect(f.document.querySelector('[data-fluent-read-local-ai-active]')).toBeNull();
}
function expectClosed(context: AudioContextFixture, track: AudioTrack) {
  expect(context.close).toHaveBeenCalledOnce();
  expect(context.source.disconnect).toHaveBeenCalledOnce();
  expect(context.processor.onaudioprocess).toBeNull();
  expect(track.stop).toHaveBeenCalled();
  expect([...track.listeners.values()].every(set => set.size === 0)).toBe(true);
}

describe('YouTube local captions with real capture ownership and platform fixtures', () => {
  it('keeps native priority until explicit start, uses the real GPU catalog and restores native on cancel', async () => {
    const f = fixture();
    expect(VIDEO_LOCAL_TRANSCRIPTION_MODELS.some(model => model.value === 'qwen3-asr-0.6b')).toBe(true);
    expectNative(f); expect(AudioContextFixture.instances).toHaveLength(0); expect(state.send).not.toHaveBeenCalled();
    await f.start();
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({type: 'fluentReadPrepareLocalVideoModel', model: 'qwen3-asr-0.6b', generation: 1}));
    await f.speech();
    expect(transcriptions()).toHaveLength(1);
    expect(transcriptions()[0][0]).toMatchObject({model: 'qwen3-asr-0.6b', sourceLanguage: state.config.videoSourceLanguage, generation: 1});
    expect(f.document.querySelector('[data-fluent-read-local-ai-active]')).not.toBeNull();
    const diagnostic = JSON.parse(f.document.getElementById(VIDEO_AI_CAPTION_CONTAINER_ID)!.dataset.fluentReadVideoAiDiagnostic!);
    expect(diagnostic).toMatchObject({emittedCueCount: 1, windowStartMs: 1000, windowEndMs: 2600, resultAvailableAtMs: 2600});
    expect(findCaptionContainer()?.textContent).toBe('Local words arrive now.');
    const context = AudioContextFixture.instances[0];
    await f.click('[data-action="toggle-ai-subtitle"]');
    expectNative(f); expectClosed(context, f.tracks[0]);
    expect(state.send.mock.calls.some(([message]) => /VideoAiSubtitleCache/.test(message.type))).toBe(false);
  });

  it.each(['protected', 'muted'] as const)('refuses %s media and preserves native captions without a transcription', async kind => {
    const f = fixture();
    if (kind === 'protected') Object.assign(f.video, {mediaKeys: {}}); else f.muteNext();
    await f.start();
    expectNative(f); expect(AudioContextFixture.instances).toHaveLength(0); expect(transcriptions()).toHaveLength(0);
    expect(f.document.body.textContent).toContain(kind === 'protected' ? '受保护' : '不可访问');
    if (kind === 'muted') expect(f.tracks[0].stop).toHaveBeenCalled();
  });

  it('restores native after a live track mute, cleans its listeners and permits an explicit retry', async () => {
    const f = fixture(); await f.start(); const context = AudioContextFixture.instances[0];
    f.tracks[0].emit('mute'); await settle();
    expectNative(f); expectClosed(context, f.tracks[0]);
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({type: 'fluentReadCancelLocalVideoTranscription', reason: 'error'}));
    await f.click('[data-action="toggle-ai-subtitle"]');
    expect(AudioContextFixture.instances).toHaveLength(2);
    await f.speech(); expect(findCaptionContainer()?.textContent).toBe('Local words arrive now.');
  });

  it('pauses the real graph on visibility loss and resumes once, then configuration disable prevents reopening', async () => {
    const f = fixture(); await f.start(); const first = AudioContextFixture.instances[0];
    await f.visibility('hidden'); expectClosed(first, f.tracks[0]);
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({type: 'fluentReadCancelLocalVideoTranscription', reason: 'pause'}));
    await f.visibility('visible'); await f.visibility('visible'); expect(AudioContextFixture.instances).toHaveLength(2);
    await f.configure({videoTranslationEnabled: false}); expectNative(f); expectClosed(AudioContextFixture.instances[1], f.tracks[1]);
    await f.visibility('hidden'); await f.visibility('visible'); expect(AudioContextFixture.instances).toHaveLength(2);
  });

  it('invalidates pending worker output on seek and creates a fresh generation after seeked', async () => {
    const pending = deferred<typeof localResult>();
    state.send.mockImplementation(async (message: {type: string}) => message.type === 'fluentReadGetLocalVideoModelState'
      ? {success: true, models: ['qwen3-asr-0.6b']} : message.type === 'fluentReadTranscribeLocalVideoAudio' ? pending.promise : {success: true});
    const f = fixture(); await f.start(); await f.speech(); expect(transcriptions()).toHaveLength(1);
    const context = AudioContextFixture.instances[0];
    await f.event('seeking'); expectClosed(context, f.tracks[0]);
    pending.resolve({...localResult, text: 'Stale words arrive late.', segments: [{startMs: 0, endMs: 1600, text: 'Stale words arrive late.'}]}); await settle();
    expect(f.document.body.textContent).not.toContain('Stale words arrive late.');
    f.video.currentTime = 20; await f.event('seeked');
    expect(AudioContextFixture.instances).toHaveLength(2);
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({type: 'fluentReadPrepareLocalVideoModel', generation: 2}));
  });

  it('cancels a replaced video element even when the page and media URL stay identical', async () => {
    const f = fixture(); await f.start(); await f.speech(); const first = AudioContextFixture.instances[0];
    await f.replaceVideo();
    expectNative(f); expectClosed(first, f.tracks[0]);
    expect(AudioContextFixture.instances).toHaveLength(1);
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({type: 'fluentReadCancelLocalVideoTranscription', reason: 'cancel'}));
  });

  it('does not start a graph from a model-state reply received after SPA navigation', async () => {
    const pending = deferred<{success: boolean; models: string[]}>();
    state.send.mockImplementation(async (message: {type: string}) => message.type === 'fluentReadGetLocalVideoModelState' ? pending.promise : {success: true});
    const f = fixture(); await f.start(); expect(AudioContextFixture.instances).toHaveLength(0);
    f.location.search = '?v=second'; await vi.advanceTimersByTimeAsync(1000);
    pending.resolve({success: true, models: ['qwen3-asr-0.6b']}); await settle();
    expect(AudioContextFixture.instances).toHaveLength(0); expectNative(f);
  });

  it('disposes the active graph and cannot recreate a caption from a late worker response', async () => {
    const pending = deferred<typeof localResult>();
    state.send.mockImplementation(async (message: {type: string}) => message.type === 'fluentReadGetLocalVideoModelState'
      ? {success: true, models: ['qwen3-asr-0.6b']} : message.type === 'fluentReadTranscribeLocalVideoAudio' ? pending.promise : {success: true});
    const f = fixture(); await f.start(); await f.speech(); const context = AudioContextFixture.instances[0];
    dispose!(); dispose = undefined; expectClosed(context, f.tracks[0]); expect(state.subscriber).toBeUndefined();
    pending.resolve(localResult); await settle();
    expectNative(f); expect(f.document.getElementById(VIDEO_AI_CAPTION_CONTAINER_ID)).toBeNull(); expect(f.frames.size).toBe(0);
    await f.event('play'); await f.visibility('visible'); expect(AudioContextFixture.instances).toHaveLength(1);
  });

  it('keeps the GPU model for a Whisper preference and invalidates active ownership on source-language change', async () => {
    const f = fixture(); await f.start();
    await f.configure({videoLocalModel: 'tiny'}); expect(AudioContextFixture.instances[0].close).not.toHaveBeenCalled();
    await f.speech(); expect(transcriptions()[0][0].model).toBe('qwen3-asr-0.6b');
    await f.configure({videoSourceLanguage: 'ja'});
    expectNative(f); expectClosed(AudioContextFixture.instances[0], f.tracks[0]);
    await f.click('[data-action="toggle-ai-subtitle"]'); await f.speech();
    expect(transcriptions().at(-1)![0]).toMatchObject({model: 'qwen3-asr-0.6b', sourceLanguage: 'ja'});
  });

  it('rejects CPU results without retry and restores native captions after the real controller error', async () => {
    state.send.mockImplementation(async (message: {type: string}) => message.type === 'fluentReadGetLocalVideoModelState'
      ? {success: true, models: ['qwen3-asr-0.6b']} : message.type === 'fluentReadTranscribeLocalVideoAudio' ? {...localResult, backend: 'wasm'} : {success: true});
    const f = fixture(); await f.start(); await f.speech();
    expect(transcriptions()).toHaveLength(1); expectNative(f); expectClosed(AudioContextFixture.instances[0], f.tracks[0]);
    expect(f.document.body.textContent).toContain('未启用 CPU 回退');
  });

  it('uses the live presentation despite native offset/button preferences and expires without reviving historical captions', async () => {
    Object.assign(state.config, {videoSubtitleOffsetMs: 100, videoPreferHumanSubtitles: true, videoSubtitleDisplayMode: 'bilingual', videoSourceLanguage: 'en'});
    const f = fixture(); f.document.querySelector('.ytp-subtitles-button')!.setAttribute('aria-pressed', 'false');
    await f.start(); await f.speech(); await vi.advanceTimersByTimeAsync(300);
    expect(findCaptionContainer()?.textContent).toBe('Local words arrive now.');
    expect(state.translate).toHaveBeenCalledWith('Local words arrive now.', expect.any(AbortSignal), 'en');
    await vi.advanceTimersByTimeAsync(1500);
    expect(findCaptionContainer()?.textContent).toBe('');
    f.video.currentTime = 1.2; await f.tickFrame();
    expect(findCaptionContainer()?.textContent).toBe('');
  });

  it('shows a slow result from its actual completion for one bounded readable interval without rewriting source timing', async () => {
    const pending = deferred<typeof localResult>();
    state.send.mockImplementation(async (message: {type: string}) => message.type === 'fluentReadGetLocalVideoModelState'
      ? {success: true, models: ['qwen3-asr-0.6b']} : message.type === 'fluentReadTranscribeLocalVideoAudio' ? pending.promise : {success: true});
    const f = fixture(); await f.start(); await f.speech();
    f.video.currentTime = 11; await vi.advanceTimersByTimeAsync(5000);
    pending.resolve(localResult); await settle();
    expect(findCaptionContainer()?.textContent).toBe('Local words arrive now.');
    const diagnostic = JSON.parse(f.document.getElementById(VIDEO_AI_CAPTION_CONTAINER_ID)!.dataset.fluentReadVideoAiDiagnostic!);
    expect(diagnostic).toMatchObject({emittedCueCount: 1, windowStartMs: 1000, windowEndMs: 2600, resultAvailableAtMs: 11000});
    await vi.advanceTimersByTimeAsync(1799); expect(findCaptionContainer()?.textContent).toBe('Local words arrive now.');
    await vi.advanceTimersByTimeAsync(1); expect(findCaptionContainer()?.textContent).toBe('');
    // The expired historical cue cannot return merely because the media clock moves backward.
    f.video.currentTime = 1.2; await f.tickFrame(); expect(findCaptionContainer()?.textContent).toBe('');
  });

  it('replaces the live presentation with newer text and gives it its own bounded expiry', async () => {
    let count = 0;
    state.send.mockImplementation(async (message: {type: string}) => message.type === 'fluentReadGetLocalVideoModelState'
      ? {success: true, models: ['qwen3-asr-0.6b']} : message.type !== 'fluentReadTranscribeLocalVideoAudio' ? {success: true}
        : ++count === 1 ? localResult : {...localResult, text: 'Newer local sentence arrives.', segments: [{startMs: 1600, endMs: 4200, text: 'Newer local sentence arrives.'}]});
    const f = fixture(); await f.start(); await f.speech();
    expect(findCaptionContainer()?.textContent).toBe('Local words arrive now.');
    await vi.advanceTimersByTimeAsync(1000); await f.speech(2600);
    expect(findCaptionContainer()?.textContent).toBe('Newer local sentence arrives.');
    await vi.advanceTimersByTimeAsync(800); expect(findCaptionContainer()?.textContent).toBe('Newer local sentence arrives.');
    await vi.advanceTimersByTimeAsync(1000); expect(findCaptionContainer()?.textContent).toBe('');
  });

  it.each(['pause', 'SPA', 'cancel', 'source change'] as const)('rejects a worker reply arriving after %s invalidates its real generation', async reason => {
    const pending = deferred<typeof localResult>();
    state.send.mockImplementation(async (message: {type: string}) => message.type === 'fluentReadGetLocalVideoModelState'
      ? {success: true, models: ['qwen3-asr-0.6b']} : message.type === 'fluentReadTranscribeLocalVideoAudio' ? pending.promise : {success: true});
    const f = fixture(); await f.start(); await f.speech();
    if (reason === 'pause') { Object.assign(f.video, {paused: true}); await f.event('pause'); }
    else if (reason === 'SPA') { f.location.search = '?v=second'; await vi.advanceTimersByTimeAsync(1000); }
    else if (reason === 'cancel') await f.click('[data-action="toggle-ai-subtitle"]');
    else await f.configure({videoSourceLanguage: 'ja'});
    expectClosed(AudioContextFixture.instances[0], f.tracks[0]);
    pending.resolve(localResult); await settle();
    expect(f.document.getElementById(VIDEO_AI_CAPTION_CONTAINER_ID)?.textContent || '').toBe('');
    expect(f.document.querySelector('#fluent-read-video-subtitle-original')?.textContent || '').not.toContain('Local words');
  });

  it.each(['pause', 'seeking', 'ratechange'] as const)('immediately clears a displayed live cue on %s', async type => {
    const f = fixture(); await f.start(); await f.speech();
    expect(findCaptionContainer()?.textContent).toBe('Local words arrive now.');
    if (type === 'pause') Object.assign(f.video, {paused: true});
    if (type === 'ratechange') f.video.playbackRate = 2;
    await f.event(type);
    expect(findCaptionContainer()?.textContent).toBe('');
    expectClosed(AudioContextFixture.instances[0], f.tracks[0]);
  });

  it('does not reinsert a translated old caption after the live presentation expires', async () => {
    const translated = deferred<string>();
    state.translate.mockImplementation((text: string) => text === 'Local words arrive now.' ? translated.promise : Promise.resolve('translated: ' + text));
    Object.assign(state.config, {videoSubtitleDisplayMode: 'bilingual'});
    const f = fixture(); await f.start(); await f.speech();
    expect(findCaptionContainer()?.textContent).toBe('Local words arrive now.');
    expect(state.translate).toHaveBeenCalledWith('Local words arrive now.', expect.any(AbortSignal), state.config.videoSourceLanguage);
    await vi.advanceTimersByTimeAsync(1800);
    expect(findCaptionContainer()?.textContent).toBe('');
    translated.resolve('Old translated sentence.'); await settle();
    expect(f.document.querySelector('#fluent-read-video-subtitle')?.textContent || '').toBe('');
  });


  it('prioritizes fetched human captions in native mode, uses local recognition on request, then restores the human translation', async () => {
    const sourceTrack = {baseUrl: 'https://www.youtube.com/api/timedtext?v=first&lang=en', languageCode: 'en'};
    const humanTrack = {baseUrl: 'https://www.youtube.com/api/timedtext?v=first&lang=zh-Hans', languageCode: 'zh-Hans'};
    Object.assign(state.config, {videoSubtitleDisplayMode: 'bilingual', videoPreferHumanSubtitles: true, from: 'en', to: 'zh-CN'});
    vi.stubGlobal('fetch', vi.fn(async (input: string) => new Response(JSON.stringify({events: [{tStartMs: 0, dDurationMs: 20000,
      segs: [{utf8: new URL(input).searchParams.get('lang') === 'en' ? 'Native words.' : '这是人工字幕。'}]}]}))));
    const f = fixture({captionTracks: [sourceTrack, humanTrack]});
    await settle(); await vi.advanceTimersByTimeAsync(300);
    expect(f.document.querySelector('#fluent-read-video-subtitle')?.textContent).toBe('这是人工字幕。');
    expect(state.translate.mock.calls.some(([text]) => text === 'Native words.')).toBe(false);
    await f.start(); await f.speech(); await vi.advanceTimersByTimeAsync(100);
    expect(findCaptionContainer()?.textContent).toBe('Local words arrive now.');
    expect(f.document.querySelector('#fluent-read-video-subtitle')?.textContent).toBe('translated: Local words arrive now.');
    await f.click('[data-action="toggle-ai-subtitle"]'); await settle();
    expectNative(f);
    expect(f.document.querySelector('#fluent-read-video-subtitle')?.textContent).toBe('这是人工字幕。');
  });

  it('uses native timedtext updates, respects the disabled native button with an offset, and clears a stale native line', async () => {
    Object.assign(state.config, {videoSubtitleDisplayMode: 'bilingual', videoSubtitleOffsetMs: 500});
    const f = fixture();
    const timedtext = new f.window.Event('message');
    Object.assign(timedtext, {source: f.window, origin: f.location.origin, data: {source: 'fluent-read', type: 'fluent-read-youtube-timedtext',
      url: 'https://www.youtube.com/api/timedtext?v=first&lang=en', responseText: JSON.stringify({events: [{tStartMs: 0, dDurationMs: 2000, segs: [{utf8: 'Native words.'}]}]})}});
    f.window.dispatchEvent(timedtext); await settle(); await f.tickFrame();
    expect(f.document.querySelector('#fluent-read-video-subtitle')?.textContent).toBe('translated: Native words.');
    f.document.querySelector('.ytp-subtitles-button')!.setAttribute('aria-pressed', 'false'); await f.event('timeupdate');
    expect(f.document.querySelector('#fluent-read-video-subtitle')?.textContent || '').toBe('');
    f.document.querySelector('.ytp-subtitles-button')!.setAttribute('aria-pressed', 'true'); await f.event('timeupdate');
    expect(f.document.querySelector('#fluent-read-video-subtitle')?.textContent).toBe('translated: Native words.');
    await f.configure({videoSubtitleOffsetMs: 0}); f.video.currentTime = 4; await f.event('timeupdate');
    expect(f.document.querySelector('#fluent-read-video-subtitle')?.textContent || '').toBe('');
  });

  it.each([false, true])('keeps native-download remember wiring consistent when local capture becomes active: %s', async becomeLocal => {
    Object.assign(state.config, {videoSubtitleDisplayMode: 'bilingual'});
    const factory = vi.spyOn(downloadsModule, 'createVideoSubtitleDownloads');
    const pending = deferred<Response>(); vi.stubGlobal('fetch', vi.fn(() => pending.promise));
    const f = fixture();
    // Observe the actual public controller; do not fabricate clicks on export controls awaiting prefetch.
    const downloads = factory.mock.results[0].value as ReturnType<typeof downloadsModule.createVideoSubtitleDownloads>;
    f.captionTracks([{baseUrl: 'https://www.youtube.com/api/timedtext?v=first&lang=en', languageCode: 'en'}]);
    const native = downloads.resolve(); await settle(); expect(fetch).toHaveBeenCalledOnce();
    if (becomeLocal) { await f.start(); await f.speech(); expect(findCaptionContainer()?.textContent).toBe('Local words arrive now.'); }
    pending.resolve(new Response(JSON.stringify({events: [{tStartMs: 0, dDurationMs: 20000, segs: [{utf8: 'Native words.'}]}]})));
    await expect(native).resolves.toMatchObject({languageCode: 'en', cues: [{text: 'Native words.'}]}); await settle();
    if (becomeLocal) {
      expect(findCaptionContainer()?.textContent).toBe('Local words arrive now.');
      expect(f.document.querySelector('#fluent-read-video-subtitle')?.textContent).toBe('translated: Local words arrive now.');
      await f.click('[data-action="toggle-ai-subtitle"]'); await settle();
    }
    await f.event('timeupdate'); expectNative(f);
    expect(f.document.querySelector('#fluent-read-video-subtitle')?.textContent).toBe('translated: Native words.');
  });

  it('cancels capture after navigation off the watch route and does not resume from a later visibility event', async () => {
    const f = fixture(); await f.start(); await f.speech();
    f.location.pathname = '/feed/subscriptions'; f.location.search = ''; await vi.advanceTimersByTimeAsync(1000);
    expectClosed(AudioContextFixture.instances[0], f.tracks[0]);
    expect(f.document.querySelector('[data-fluent-read-local-ai-active]')).toBeNull();
    await f.visibility('hidden'); await f.visibility('visible');
    expect(AudioContextFixture.instances).toHaveLength(1);
    expect(f.document.getElementById(VIDEO_AI_CAPTION_CONTAINER_ID)?.textContent || '').toBe('');
  });

  it('retains X full-generation compatibility using the real full controller and a decoded-audio platform fixture', async () => {
    Object.assign(state.config, {videoSubtitleDisplayMode: 'bilingual'});
    const pcm = Float32Array.from({length: 25600}, (_, i) => 0.1 * Math.sin(2 * Math.PI * 220 * i / 16000));
    const decode = vi.fn(async () => ({duration: 1.6, numberOfChannels: 1, sampleRate: 16000, getChannelData: () => pcm}));
    Object.assign(AudioContextFixture.prototype, {decodeAudioData: decode});
    state.send.mockImplementation(async (message: {type: string}) => message.type === 'fluentReadGetLocalVideoModelState'
      ? {success: true, models: ['tiny']} : message.type === 'fluentReadTranscribeLocalVideoAudio' ? {...localResult, backend: 'wasm'} : {success: true});
    vi.stubGlobal('fetch', vi.fn(async (input: string) => { expect(input).toBe('blob:fixture'); return new Response(new Uint8Array([1, 2])); }));
    const f = fixture({url: 'https://x.com/person/status/123'}); Object.assign(f.video, {duration: 1.6});
    await f.start(); await settle();
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny'}));
    expect(decode).toHaveBeenCalledOnce(); expect(AudioContextFixture.instances[0].close).toHaveBeenCalledOnce();
    expect(transcriptions()).toHaveLength(1); expect(transcriptions()[0][0].model).toBe('tiny');
    expect(findCaptionContainer()?.textContent).toBe('Local words arrive now.');
    expect(f.document.querySelector('#fluent-read-video-subtitle')?.textContent).toBe('translated: Local words arrive now.');
    await vi.advanceTimersByTimeAsync(1800); expect(findCaptionContainer()?.textContent).toBe('Local words arrive now.');
    await f.click('[data-action="toggle-ai-subtitle"]');
    expect(findCaptionContainer()?.textContent).toBe('');
    delete (AudioContextFixture.prototype as unknown as {decodeAudioData?: unknown}).decodeAudioData;
  });

  it('revalidates navigation before an expiry callback can translate or rebuild old caption DOM', async () => {
    Object.assign(state.config, {videoSubtitleDisplayMode: 'bilingual'});
    const f = fixture(); await f.start(); await f.speech();
    await vi.advanceTimersByTimeAsync(1799);
    f.location.pathname = '/feed/subscriptions'; f.location.search = '';
    state.translate.mockClear();
    await vi.advanceTimersByTimeAsync(100);
    expect(state.translate).not.toHaveBeenCalled();
    expect(f.document.getElementById(VIDEO_AI_CAPTION_CONTAINER_ID)).toBeNull();
    expect(f.document.querySelector('#fluent-read-video-subtitle-original')?.textContent || '').toBe('');
    expect(f.document.querySelector('#fluent-read-video-subtitle')?.textContent || '').toBe('');
  });

  it('cancels the old audio owner when expiry observes a new video ID before the next UI poll', async () => {
    const f = fixture(); await f.start(); await f.speech();
    await vi.advanceTimersByTimeAsync(1799);
    f.location.search = '?v=second';
    await vi.advanceTimersByTimeAsync(1);
    expectClosed(AudioContextFixture.instances[0], f.tracks[0]);
    expectNative(f);
    expect(state.send).toHaveBeenCalledWith(expect.objectContaining({type: 'fluentReadCancelLocalVideoTranscription', reason: 'cancel'}));
  });

  it.each(['dispose', 'pause', 'seeking', 'source change', 'disable'] as const)('cannot renew old caption DOM when %s happens immediately before expiry', async reason => {
    const f = fixture(); await f.start(); await f.speech();
    await vi.advanceTimersByTimeAsync(1799);
    if (reason === 'dispose') { dispose!(); dispose = undefined; }
    else if (reason === 'pause') { Object.assign(f.video, {paused: true}); await f.event('pause'); }
    else if (reason === 'seeking') { Object.assign(f.video, {seeking: true}); await f.event('seeking'); }
    else if (reason === 'source change') await f.configure({videoSourceLanguage: 'ja'});
    else await f.configure({videoTranslationEnabled: false});
    await vi.advanceTimersByTimeAsync(100);
    expectClosed(AudioContextFixture.instances[0], f.tracks[0]);
    expect(f.document.getElementById(VIDEO_AI_CAPTION_CONTAINER_ID)?.textContent || '').not.toContain('Local words');
    expect(f.document.querySelector('#fluent-read-video-subtitle-original')?.textContent || '').not.toContain('Local words');
    expect(f.document.querySelector('#fluent-read-video-subtitle')?.textContent || '').not.toContain('Local words');
  });

  it('keeps a new post-seek presentation alive through the previous generation expiry deadline', async () => {
    const f = fixture(); await f.start(); await f.speech();
    await vi.advanceTimersByTimeAsync(1000);
    await f.event('seeking'); f.video.currentTime = 20; await f.event('seeked'); await f.speech();
    expect(findCaptionContainer()?.textContent).toBe('Local words arrive now.');
    await vi.advanceTimersByTimeAsync(800);
    expect(findCaptionContainer()?.textContent).toBe('Local words arrive now.');
    await vi.advanceTimersByTimeAsync(1000);
    expect(findCaptionContainer()?.textContent).toBe('');
  });

});
