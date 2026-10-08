/**
 * @file tests/videoSubtitleTrackPriorityRuntime.test.ts
 * 文件职责：从实际 mountVideoSubtitleTranslation 公共入口验证 X 原生优先、分片回退及卸载后的异步资格。
 * 主要内容：真实 resource message / video / TextTrack / 配置订阅驱动实际播放器定位、loader、缓存、取消及 DOM 渲染。
 * 模块边界：linkedom 补齐缺失的浏览器媒体/几何接口；仅 mock 配置存储、翻译及扩展消息等外部边界，不替换业务 selector/controller。
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';

const ports = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  subscribers: new Set<(value: unknown) => void>(),
  translate: vi.fn(), send: vi.fn(), fetch: vi.fn(),
}));
vi.mock('@/src/services/config/store', () => ({
  config: ports.config,
  subscribeConfig: (listener: (value: unknown) => void) => {
    ports.subscribers.add(listener);
    return () => ports.subscribers.delete(listener);
  },
  requestConfigPatch: async (patch: Record<string, unknown>) => {
    Object.assign(ports.config, patch);
    for (const listener of [...ports.subscribers]) listener(ports.config);
  },
}));
vi.mock('@/src/app/translation/client', () => ({translateVideoText: ports.translate}));
vi.mock('@/src/platform/browser/runtimeMessages', () => ({sendRuntimeMessage: ports.send}));
vi.mock('webextension-polyfill', () => ({default: {runtime: {getURL: (path: string) => 'chrome-extension://fixture/' + path}}}));
vi.mock('@/src/platform/storage/downloadProgress', () => ({watchDownloadProgress: () => () => undefined}));

import {Config} from '@/src/core/config/model';
// 唯一 runtime import：移入 repo 后默认消费真实源码；私有 runner 可 alias 两份完整字节快照做同一测试对照。
import {mountVideoSubtitleTranslation} from '@/src/features/video-subtitle/content/runtime';
import {
  VIDEO_AI_CAPTION_CONTAINER_ID, VIDEO_NORMALIZED_CAPTION_OVERLAY_ID,
  VIDEO_SUBTITLE_PANEL_ACTIVE_CLASS, VIDEO_SUBTITLE_PANEL_ID,
  VIDEO_TRANSLATION_BUTTON_ID, VIDEO_TRANSLATION_LAYER_ID, VIDEO_TRANSLATION_MENU_ID,
  VIDEO_TRANSLATION_OVERLAY_ID, X_SUBTITLE_RESOURCE_MESSAGE,
} from '@/src/features/video-subtitle/content/ui';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return {promise, resolve};
}
const translation = (source: string) => '测试译文：' + source;
const disposers = new Set<() => void>();
const browserPortRestores: Array<() => void> = [];
function defineBrowserPort(target: object, key: PropertyKey, descriptor: PropertyDescriptor) {
  const previous = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, descriptor);
  browserPortRestores.push(() => {
    if (previous) Object.defineProperty(target, key, previous);
    else Reflect.deleteProperty(target, key);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  ports.subscribers.clear();
  for (const key of Object.keys(ports.config)) delete ports.config[key];
  Object.assign(ports.config, new Config(), {
    on: true, to: 'zh-Hans', videoTranslationEnabled: true, videoSubtitleVisible: true,
    videoSubtitleDisplayMode: 'bilingual', videoSourceLanguage: 'auto', videoLocalModel: 'tiny',
  });
  ports.translate.mockReset().mockImplementation((source: string) => Promise.resolve(translation(source)));
  ports.send.mockReset().mockImplementation(async (message: {type: string}) => {
    if (message.type === 'fluentReadGetVideoAiSubtitleCache') return {success: true, hit: false};
    if (message.type === 'fluentReadCancelLocalVideoTranscription' || message.type === 'fluentReadSetVideoAiSubtitleCache') return {success: true};
    throw new Error('Unexpected model/runtime boundary: ' + message.type);
  });
  ports.fetch.mockReset().mockRejectedValue(new Error('Unexpected network request in subtitle fixture'));
});
afterEach(async () => {
  try {
    for (const dispose of [...disposers]) dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.subscribers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    // 失败路径也恢复测试端口；计时器/订阅泄漏仍由上面的断言报告，不能影响后续文件。
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    browserPortRestores.splice(0).reverse().forEach(restore => restore());
  }
});

function fixture(nativeText?: string) {
  const {document, window} = parseHTML('<!doctype html><html><head></head><body><div data-testid="videoPlayer"><video></video><div><button aria-label="Play">Play</button><button aria-label="Settings">Settings</button></div></div><p id="host">host original</p></body></html>');
  const player = document.querySelector<HTMLElement>('[data-testid="videoPlayer"]')!;
  const video = player.querySelector<HTMLVideoElement>('video')!;
  const bounds = {left: 20, top: 20, width: 640, height: 360, right: 660, bottom: 380, x: 20, y: 20, toJSON: () => ({})};
  // linkedom 无布局引擎；标准媒体属性由 fixture 提供，产品选择/渲染仍使用实际实现。
  defineBrowserPort(window.HTMLElement.prototype, 'getBoundingClientRect', {configurable: true, value: () => bounds});
  defineBrowserPort(window, 'location', {configurable: true, value: new URL('https://x.com/example/status/100')});
  defineBrowserPort(window, 'innerWidth', {configurable: true, value: 1280});
  defineBrowserPort(window, 'innerHeight', {configurable: true, value: 900});
  const selectValues = new WeakMap<object, string>();
  defineBrowserPort(window.HTMLSelectElement.prototype, 'value', {
    configurable: true, get() { return selectValues.get(this) || ''; },
    set(value: string) { selectValues.set(this, value); },
  });
  const computed = (element: Element) => ({display: (element as HTMLElement).style.display || 'block', visibility: 'visible', opacity: '1', position: 'relative', objectFit: 'contain', objectPosition: '50% 50%'});
  defineBrowserPort(window, 'getComputedStyle', {configurable: true, writable: true, value: computed});
  const trackEvents = new window.EventTarget();
  const tracks = Object.assign([] as TextTrack[], {
    addEventListener: trackEvents.addEventListener.bind(trackEvents),
    removeEventListener: trackEvents.removeEventListener.bind(trackEvents),
    dispatchEvent: trackEvents.dispatchEvent.bind(trackEvents),
  });
  const makeTrack = (text: string, language = 'en') => {
    const cue = {startTime: 0, endTime: 20, text};
    // TextTrack 缺失于 linkedom；activeCues 是浏览器边界的显式输入，不复制产品轨道选择逻辑。
    return Object.assign(new window.EventTarget(), {kind: 'subtitles', language, mode: 'showing', cues: [cue], activeCues: [cue]}) as unknown as TextTrack;
  };
  const native = nativeText ? makeTrack(nativeText) : undefined;
  if (native) tracks.push(native);
  video.setAttribute('src', 'https://video.twimg.com/ext_tw_video/123/pu/vid/fixture.mp4');
  Object.defineProperties(video, {
    src: {configurable: true, get: () => video.getAttribute('src') || '', set: (value: string) => video.setAttribute('src', value)},
    currentSrc: {configurable: true, get: () => video.src},
    poster: {configurable: true, writable: true, value: 'https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/poster.jpg'},
    currentTime: {configurable: true, writable: true, value: 1},
    duration: {configurable: true, value: 60},
    paused: {configurable: true, writable: true, value: true},
    ended: {configurable: true, value: false},
    seeking: {configurable: true, value: false},
    playbackRate: {configurable: true, value: 1},
    videoWidth: {configurable: true, value: 640}, videoHeight: {configurable: true, value: 360},
    offsetWidth: {configurable: true, value: 640}, offsetHeight: {configurable: true, value: 360},
    textTracks: {configurable: true, value: tracks},
  });
  vi.stubGlobal('document', document); vi.stubGlobal('window', window);
  for (const name of ['Node', 'Element', 'HTMLElement', 'HTMLButtonElement', 'HTMLVideoElement', 'HTMLStyleElement', 'MutationObserver', 'CustomEvent']) {
    vi.stubGlobal(name, window[name as keyof typeof window]);
  }
  vi.stubGlobal('getComputedStyle', computed);
  vi.stubGlobal('fetch', ports.fetch);
  vi.stubGlobal('ResizeObserver', class {observe() {} disconnect() {}});
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  const start = () => {
    const runtimeDispose = mountVideoSubtitleTranslation();
    const dispose = () => { if (!disposers.delete(dispose)) return; runtimeDispose(); };
    disposers.add(dispose); return dispose;
  };
  const emitResource = (name: string, responseText: string, mediaId = '123') => {
    // linkedom 无 MessageEvent；为实际 window message listener 提供标准消息字段。
    const event = new window.Event('message');
    Object.defineProperties(event, {
      source: {value: window}, origin: {value: window.location.origin},
      data: {value: {source: 'fluent-read', type: X_SUBTITLE_RESOURCE_MESSAGE,
        url: `https://video.twimg.com/ext_tw_video/${mediaId}/captions/${name}`,
        responseText, pageHref: window.location.href}},
    });
    window.dispatchEvent(event);
  };
  const emitCue = (name: string, text: string, start = 0, end = 20, mediaId = '123') =>
    emitResource(name + '.vtt', `WEBVTT\n\n00:00:${String(start).padStart(2, '0')}.000 --> 00:00:${String(end).padStart(2, '0')}.000\n${text}\n`, mediaId);
  const emitVideo = (type: string) => video.dispatchEvent(new window.Event(type, {bubbles: true}));
  const changeTracks = () => tracks.dispatchEvent(new window.Event('change'));
  const changeConfig = (patch: Partial<Config>) => {
    Object.assign(ports.config, patch);
    for (const listener of [...ports.subscribers]) listener(ports.config);
  };
  const displayed = () => ({
    source: document.getElementById(VIDEO_NORMALIZED_CAPTION_OVERLAY_ID)?.textContent,
    translated: document.getElementById(VIDEO_TRANSLATION_OVERLAY_ID)?.textContent,
    active: document.getElementById(VIDEO_SUBTITLE_PANEL_ID)?.classList.contains(VIDEO_SUBTITLE_PANEL_ACTIVE_CLASS),
    kind: document.getElementById(VIDEO_AI_CAPTION_CONTAINER_ID)?.dataset.fluentReadCaptionSource,
  });
  const callsFor = (text: string) => ports.translate.mock.calls.filter(([source]) => source === text).length;
  return {document, window, player, video, tracks, native, makeTrack, start, emitResource, emitCue, emitVideo, changeTracks, changeConfig, displayed, callsFor};
}
const settle = () => vi.advanceTimersByTimeAsync(0);
const nativeSource = 'The native caption remains visible.';

describe('public mounted X subtitle track priority and lifecycle', () => {
  it('RT1: retains the already displayed native pair immediately across interleaved sidecar and cuechange', async () => {
    const f = fixture(nativeSource); f.start(); await settle();
    const initial = f.displayed();
    expect(initial).toEqual({source: nativeSource, translated: translation(nativeSource), active: true, kind: 'native'});
    expect(f.callsFor(nativeSource)).toBe(1);
    for (let index = 0; index < 2; index++) {
      f.emitCue('fragment-' + index, 'A different captured sidecar sentence.');
      // 同步断言：若回调先清空再重译，最终 settle 的 DOM 会掩盖闪烁。
      expect(f.displayed()).toEqual(initial);
      f.native!.dispatchEvent(new f.window.Event('cuechange'));
      expect(f.displayed()).toEqual(initial);
      f.emitVideo('seeked'); await settle();
    }
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.displayed()).toEqual(initial);
    expect(f.callsFor(nativeSource)).toBe(1);
    expect(f.callsFor('A different captured sidecar sentence.')).toBe(0);
    expect(ports.fetch).not.toHaveBeenCalled();
    // 删除 native 后，真实 track-list 事件应消费保留的 sidecar，而非丢弃分片。
    f.tracks.splice(0); f.changeTracks(); await settle();
    expect(f.displayed()).toMatchObject({source: 'A different captured sidecar sentence.', translated: translation('A different captured sidecar sentence.'), kind: 'sidecar'});
  });

  it('RT1: does not translate the same native cue again after sidecar/polling alternation', async () => {
    const f = fixture(nativeSource); f.start(); await settle();
    for (let index = 0; index < 3; index++) {
      f.emitCue('counts-' + index, 'Captured text must not replace the native timeline.');
      await settle(); f.native!.dispatchEvent(new f.window.Event('cuechange')); await settle();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(f.displayed()).toMatchObject({source: nativeSource, translated: translation(nativeSource), kind: 'native'});
    expect(f.callsFor(nativeSource)).toBe(1);
    expect(f.callsFor('Captured text must not replace the native timeline.')).toBe(0);
  });

  it('RT2: appends sidecar cues without native, keeps the current pair and falls forward at the video playhead', async () => {
    const f = fixture(); f.start(); await settle();
    const first = 'First sidecar sentence.'; const second = 'Second sidecar sentence.';
    f.emitCue('first', first, 0, 10); await settle();
    expect(f.displayed()).toMatchObject({source: first, translated: translation(first), active: true, kind: 'sidecar'});
    const initial = f.displayed();
    f.emitCue('second', second, 10, 20);
    expect(f.displayed()).toEqual(initial);
    await vi.advanceTimersByTimeAsync(120);
    f.video.currentTime = 12; f.emitVideo('seeked'); await settle();
    expect(f.displayed()).toMatchObject({source: second, translated: translation(second), kind: 'sidecar'});
    expect(f.callsFor(first)).toBe(1); expect(f.callsFor(second)).toBe(1);
  });

  it('RT2: a real source-language configuration change invalidates late translation even for identical cue text', async () => {
    const old = deferred<string>(); let oldSignal!: AbortSignal;
    ports.translate.mockImplementationOnce((_text: string, signal: AbortSignal) => {oldSignal = signal; return old.promise;});
    const f = fixture(); f.start(); await settle(); const source = 'Repeated words across language tracks.';
    f.emitCue('language', source); await settle(); expect(f.callsFor(source)).toBe(1);
    f.changeConfig({videoSourceLanguage: 'fr'});
    expect(oldSignal.aborted).toBe(true);
    // reset 必须允许相同资源 URL 在新语言中重新消费。
    f.emitCue('language', source); await settle();
    expect(f.displayed()).toMatchObject({source, translated: translation(source), kind: 'sidecar'});
    expect(f.callsFor(source)).toBe(2);
    old.resolve('旧语言的迟到译文'); await settle();
    expect(f.displayed()).toMatchObject({source, translated: translation(source), kind: 'sidecar'});
  });

  it('RT2: changing the actual video media source aborts old resource/translation and rejects their late results', async () => {
    const oldText = deferred<string>(), oldResource = deferred<Response>(); let translateSignal!: AbortSignal, resourceSignal!: AbortSignal;
    ports.translate.mockImplementationOnce((_text: string, signal: AbortSignal) => {translateSignal = signal; return oldText.promise;});
    ports.fetch.mockImplementationOnce((_url: string, options: {signal: AbortSignal}) => {resourceSignal = options.signal; return oldResource.promise;});
    const f = fixture(); f.start(); await settle();
    f.emitCue('old-cue', 'Old media subtitle.'); await settle();
    f.emitResource('old-master.m3u8', '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE="en",URI="old-late.vtt"'); await settle();
    expect(ports.fetch).toHaveBeenCalledTimes(1);
    f.video.src = 'https://video.twimg.com/ext_tw_video/456/pu/vid/new.mp4';
    f.video.poster = 'https://pbs.twimg.com/ext_tw_video_thumb/456/pu/img/new.jpg';
    f.emitVideo('loadedmetadata'); await settle();
    expect(translateSignal.aborted).toBe(true); expect(resourceSignal.aborted).toBe(true);
    f.emitCue('new-cue', 'New media subtitle.', 0, 20, '456'); await settle();
    const expected = f.displayed();
    expect(expected).toMatchObject({source: 'New media subtitle.', translated: translation('New media subtitle.'), kind: 'sidecar'});
    oldText.resolve('旧媒体迟到译文'); oldResource.resolve(new Response('WEBVTT\n\n00:00:00.000 --> 00:00:20.000\nOld late resource.\n'));
    await settle(); f.emitVideo('timeupdate'); await settle();
    expect(f.displayed()).toEqual(expected);
    expect(f.callsFor('Old late resource.')).toBe(0);
  });

  it('RT8: dispose/remount excludes old translation, resource, cache and track callbacks from the new mounted DOM', async () => {
    const oldText = deferred<string>(), oldResource = deferred<Response>(), oldCache = deferred<unknown>();
    let translateSignal!: AbortSignal, resourceSignal!: AbortSignal;
    ports.send.mockImplementationOnce(() => oldCache.promise);
    ports.translate.mockImplementationOnce((_text: string, signal: AbortSignal) => {translateSignal = signal; return oldText.promise;});
    ports.fetch.mockImplementationOnce((_url: string, options: {signal: AbortSignal}) => {resourceSignal = options.signal; return oldResource.promise;});
    const f = fixture(); const dispose = f.start(); await settle();
    expect(ports.send.mock.calls.some(([message]) => message.type === 'fluentReadGetVideoAiSubtitleCache')).toBe(true);
    const oldTrack = f.makeTrack('Old mounted native cue.'); f.tracks.push(oldTrack); f.changeTracks(); await settle();
    expect(oldTrack.mode).toBe('hidden');
    f.emitResource('dispose-master.m3u8', '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE="en",URI="dispose-late.vtt"'); await settle();
    expect(ports.fetch).toHaveBeenCalledTimes(1);
    dispose(); await settle();
    expect(translateSignal.aborted).toBe(true); expect(resourceSignal.aborted).toBe(true);
    expect(oldTrack.mode).toBe('showing'); expect(ports.subscribers.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
    for (const id of [VIDEO_AI_CAPTION_CONTAINER_ID, VIDEO_TRANSLATION_LAYER_ID, VIDEO_TRANSLATION_BUTTON_ID, VIDEO_TRANSLATION_MENU_ID]) expect(f.document.getElementById(id)).toBeNull();
    const requests = ports.translate.mock.calls.length;
    f.emitCue('after-dispose', 'No runtime is mounted.'); f.emitVideo('seeked'); oldTrack.dispatchEvent(new f.window.Event('cuechange')); await settle();
    expect(ports.translate).toHaveBeenCalledTimes(requests); expect(ports.fetch).toHaveBeenCalledTimes(1);
    expect(f.document.getElementById(VIDEO_TRANSLATION_LAYER_ID)).toBeNull();
    const newTrack = f.makeTrack('New mounted native cue.'); f.tracks.splice(0, f.tracks.length, newTrack); f.start(); await settle();
    const expected = f.displayed();
    expect(expected).toMatchObject({source: 'New mounted native cue.', translated: translation('New mounted native cue.'), kind: 'native'});
    oldText.resolve('旧实例译文'); oldResource.resolve(new Response('WEBVTT\n\n00:00:00.000 --> 00:00:20.000\nOld instance resource.\n'));
    oldCache.resolve({success: true, hit: true, cues: [{startMs: 0, durationMs: 20000, text: 'Old instance cached cue.'}]});
    oldTrack.dispatchEvent(new f.window.Event('cuechange')); await settle(); await vi.advanceTimersByTimeAsync(1000);
    expect(f.displayed()).toEqual(expected);
    expect(f.callsFor('Old instance resource.')).toBe(0); expect(f.callsFor('Old instance cached cue.')).toBe(0);
    expect(f.callsFor('New mounted native cue.')).toBe(1);
    expect(f.document.querySelectorAll('#' + VIDEO_TRANSLATION_LAYER_ID)).toHaveLength(1);
    expect(ports.subscribers.size).toBe(1); expect(f.document.getElementById('host')?.textContent).toBe('host original');
  });
});
