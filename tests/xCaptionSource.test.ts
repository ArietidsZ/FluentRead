import {afterEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import type {VideoSubtitleCue} from '@/src/features/video-subtitle/content/youtubeSubtitleData';
vi.mock('@/src/services/config/store', () => ({config: {uiLanguage: 'zh-CN'}}));
import {XCaptionSource} from '@/src/features/video-subtitle/content/xCaptionSource';
import {getXSubtitleBottomInset, VIDEO_AI_CAPTION_CONTAINER_ID} from '@/src/features/video-subtitle/content/ui';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function fixture() {
  const {document, window} = parseHTML('<!doctype html><html><body><article><div data-testid="videoPlayer"><video></video></div><div id="fullscreen"><video></video></div></article></body></html>');
  vi.stubGlobal('document', document);
  vi.stubGlobal('HTMLElement', window.HTMLElement);
  vi.stubGlobal('window', {location: {hostname: 'x.com', pathname: '/profile', href: 'https://x.com/profile'}});
  const video = document.querySelector('video') as HTMLVideoElement;
  const koreanCue = {startTime: 0, endTime: 2, text: '오늘은 좋은 날입니다.'};
  const englishCue = {startTime: 0, endTime: 2, text: 'This is a good day.'};
  const korean = {kind: 'subtitles', mode: 'showing', language: 'ko', activeCues: [koreanCue], cues: [koreanCue]};
  const english = {kind: 'subtitles', mode: 'disabled', language: 'en', activeCues: [englishCue], cues: [englishCue]};
  Object.assign(video, {currentTime: 1, textTracks: [english, korean]});
  const state = {video, player: video.parentElement!, enabled: true, aiActive: false, aiCues: [] as VideoSubtitleCue[], sidecarCues: [] as VideoSubtitleCue[], language: 'auto'};
  const source = new XCaptionSource(() => state);
  return {source, state, document, korean, english};
}

describe('X 原生字幕来源', () => {
  it('自动贴底只避让下方可见控件，失焦隐藏后回到底边', () => {
    const {state, document} = fixture();
    const player = state.player;
    player.getBoundingClientRect = () => ({top: 100, bottom: 680, height: 580}) as DOMRect;
    vi.stubGlobal('getComputedStyle', (node: HTMLElement) => ({display: node.style.display || 'block', visibility: node.style.visibility || 'visible', opacity: node.style.opacity || '1'}));
    expect(getXSubtitleBottomInset(player)).toBe(12);
    const bar = document.createElement('div');
    bar.innerHTML = '<button aria-label="Settings"></button><button>Play</button>';
    bar.getBoundingClientRect = () => ({top: 628, bottom: 672, height: 44, width: 900}) as DOMRect;
    player.appendChild(bar);
    expect(getXSubtitleBottomInset(player)).toBe(60);
    bar.style.opacity = '0';
    expect(getXSubtitleBottomInset(player)).toBe(12);
    bar.style.opacity = '1';
    player.style.visibility = 'hidden';
    expect(getXSubtitleBottomInset(player)).toBe(12);
    player.style.visibility = 'visible';
    bar.getBoundingClientRect = () => ({top: 110, bottom: 150, height: 40, width: 900}) as DOMRect;
    expect(getXSubtitleBottomInset(player)).toBe(12);
    bar.remove();
    const ownMenu = document.createElement('div');
    ownMenu.className = 'fluent-read-video-ui';
    ownMenu.innerHTML = '<button aria-label="Settings">Options</button><button>Close</button>';
    player.appendChild(ownMenu);
    const fallback = document.createElement('div');
    fallback.className = 'fluent-read-video-controls';
    fallback.getBoundingClientRect = () => ({top: 636, height: 36, width: 36}) as DOMRect;
    player.appendChild(fallback);
    expect(getXSubtitleBottomInset(player)).toBe(52);
    fallback.style.opacity = '0';
    state.video.controls = true;
    Object.assign(state.video, {paused: true});
    expect(getXSubtitleBottomInset(player)).toBe(56);
  });
  it('原生轨道显示与完整导出只保留正文，不泄漏 X 逐词时间标记', () => {
    const {source, korean} = fixture();
    korean.activeCues[0].text = '<X-word-ms ms=419,60,340 index=1 character_ranges=0-7,8-10,11-13>Teleport to SF</X-word-ms>';
    expect(source.sync()!.textContent).toBe('Teleport to SF');
    expect(source.readNativeTrack()!.cues).toEqual([{startMs: 0, durationMs: 2000, text: 'Teleport to SF'}]);
    korean.activeCues[0].text = '<X-word-ms ms=419 index=1> </X-word-ms>';
    expect(source.readNativeTrack()).toBeNull();
    expect(source.sync()!.textContent).toBe('');
  });

  it('主页直接读取宿主已选韩语原字幕，并导出完整韩语轨道', () => {
    const {source, korean, english} = fixture();
    const container = source.sync()!;
    expect(container.textContent).toBe('오늘은 좋은 날입니다.');
    expect(container.dataset.fluentReadCaptionSource).toBe('native');
    expect(korean.mode).toBe('hidden');
    expect(english.mode).toBe('hidden');
    expect(source.readNativeTrack()).toEqual({languageCode: 'ko', cues: [{startMs: 0, durationMs: 2000, text: '오늘은 좋은 날입니다.'}]});
    source.restoreTracks();
    expect(korean.mode).toBe('showing');
    expect(english.mode).toBe('disabled');
  });
  it('显式视频原语言切换可选择另一轨道，关闭后恢复宿主状态', () => {
    const {source, state, korean, english} = fixture();
    state.language = 'en';
    expect(source.sync()!.textContent).toBe('This is a good day.');
    state.enabled = false;
    expect(source.sync()!.textContent).toBe('');
    expect(korean.mode).toBe('showing');
    expect(english.mode).toBe('disabled');
  });
  it('原生时间轴的静音空档不混入缓存或 sidecar 的旧字幕', () => {
    const {source, state, korean, english} = fixture();
    Object.assign(korean, {activeCues: []});
    Object.assign(english, {activeCues: []});
    state.aiCues = [{startMs: 0, durationMs: 5000, text: 'Old AI subtitle'}];
    state.sidecarCues = [{startMs: 0, durationMs: 5000, text: 'Other subtitle track'}];
    expect(source.sync()!.textContent).toBe('');
    state.aiActive = true;
    expect(source.sync()!.textContent).toBe('Old AI subtitle');
  });
  it('展开播放器后把唯一字幕容器移入新宿主，不留在旧播放器', () => {
    const {source, state, document} = fixture();
    const container = source.sync()!;
    const original = state.player;
    state.player = document.querySelector('#fullscreen') as HTMLElement;
    source.sync();
    expect(container.parentElement).toBe(state.player);
    expect(original.querySelector(`#${VIDEO_AI_CAPTION_CONTAINER_ID}`)).toBeNull();
    expect(document.querySelectorAll(`#${VIDEO_AI_CAPTION_CONTAINER_ID}`)).toHaveLength(1);
  });
});

describe('X native track readiness', () => {
  it('keeps an empty native track blank until its real cue list becomes available', () => {
    const f = fixture();
    const video = f.state.video;
    Object.assign(f.state, {video: null});
    expect(f.source.sync()!.textContent).toBe('');
    expect(f.source.readNativeTrack()).toBeNull();
    expect(f.korean.mode).toBe('showing');
    Object.assign(f.state, {video});
    Object.assign(f.korean, {cues: [], activeCues: []});
    Object.assign(f.english, {cues: [], activeCues: []});
    expect(f.source.sync()!.textContent).toBe('');
    Object.assign(f.korean, {cues: [{startTime: 0, endTime: 2, text: 'Ready native words'}], activeCues: [{startTime: 0, endTime: 2, text: 'Ready native words'}]});
    expect(f.source.sync()!.textContent).toBe('Ready native words');
    expect(f.source.readNativeTrack()?.cues[0].text).toBe('Ready native words');
  });
});

describe('YouTube explicit local caption source', () => {
  it('preserves native captions by default, takes over only on request, restores after cancel', () => {
    const f = fixture();
    vi.stubGlobal('window', {location: new URL('https://www.youtube.com/watch?v=fixture')});
    const native = f.document.createElement('div');
    native.id = 'ytp-caption-window-container';
    native.innerHTML = '<span class="ytp-caption-segment">native text</span>';
    f.state.player.appendChild(native);
    expect(f.source.sync()).toBeNull();
    expect(f.korean.mode).toBe('showing');
    f.state.aiActive = true;
    f.state.aiCues = [{startMs: 0, durationMs: 2000, text: 'local text'}];
    const container = f.source.sync()!;
    expect(container.textContent).toBe('local text');
    expect(container.dataset.fluentReadAiActive).toBe('true');
    expect(f.state.player.hasAttribute('data-fluent-read-local-ai-active')).toBe(true);
    expect(f.korean.mode).toBe('showing');
    expect(native.textContent).toBe('native text');
    f.state.video.currentTime = 3;
    expect(f.source.sync()!.textContent).toBe('');
    f.state.aiActive = false;
    expect(f.source.sync()).toBeNull();
    expect(f.document.getElementById(VIDEO_AI_CAPTION_CONTAINER_ID)).toBeNull();
    expect(f.state.player.hasAttribute('data-fluent-read-local-ai-active')).toBe(false);
    expect(native.textContent).toBe('native text');
  });
  it('removes the synthetic source on disabling and restores player visibility', () => {
    const f = fixture();
    vi.stubGlobal('window', {location: new URL('https://www.youtube.com/watch?v=fixture')});
    f.state.aiActive = true;
    f.source.sync();
    f.state.enabled = false;
    expect(f.source.sync()).toBeNull();
    expect(f.state.player.hasAttribute('data-fluent-read-local-ai-active')).toBe(false);
  });
  it('removes only the owned local layer on an unsupported YouTube route and keeps host captions intact', () => {
    const f = fixture();
    const location = new URL('https://www.youtube.com/watch?v=fixture');
    vi.stubGlobal('window', {location});
    const native = f.document.createElement('div');
    native.id = 'ytp-caption-window-container';
    native.textContent = 'Host-owned native words';
    f.state.player.appendChild(native);
    f.state.aiActive = true;
    f.state.aiCues = [{startMs: 0, durationMs: 2000, text: 'Owned local words'}];
    expect(f.source.sync()!.textContent).toBe('Owned local words');
    location.pathname = '/feed/subscriptions'; location.search = '';
    expect(f.source.sync()).toBeNull();
    expect(f.document.getElementById(VIDEO_AI_CAPTION_CONTAINER_ID)).toBeNull();
    expect(f.state.player.hasAttribute('data-fluent-read-local-ai-active')).toBe(false);
    expect(native.isConnected).toBe(true);
    expect(native.textContent).toBe('Host-owned native words');
    expect(f.korean.mode).toBe('showing');
    expect(f.source.sync()).toBeNull();
  });

});


describe('caption source owns bounded YouTube live presentation', () => {
  function liveFixture(notify?: () => void) {
    vi.useFakeTimers();
    const f = fixture();
    const location = new URL('https://www.youtube.com/watch?v=fixture');
    vi.stubGlobal('window', {location});
    const state = {...f.state, aiActive: true, livePresentation: true};
    const source = new XCaptionSource(() => state, notify);
    const cue = Object.freeze({cueId: 'first', startMs: 0, spokenEndMs: 1000, durationMs: 1000, availableAtMs: 4000, text: 'A completed local sentence.'});
    state.video.currentTime = 4;
    return {...f, source, state, cue, location};
  }

  it('owns expiry and duplicate/older guards while preserving source timing and later repeated speech', async () => {
    const expired = vi.fn();
    const f = liveFixture(expired);
    f.source.presentLiveCue(f.cue);
    expect(f.source.liveCue).toBe(f.cue);
    expect(f.source.sync()!.textContent).toBe(f.cue.text);
    await vi.advanceTimersByTimeAsync(1000);
    f.source.presentLiveCue({...f.cue, availableAtMs: 5000});
    await vi.advanceTimersByTimeAsync(799);
    expect(f.source.liveCue).toBe(f.cue);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.source.liveCue).toBeNull();
    expect(f.source.sync()!.textContent).toBe('');
    expect(expired).toHaveBeenCalledOnce();
    f.source.presentLiveCue({...f.cue, availableAtMs: 6000});
    expect(f.source.liveCue).toBeNull();
    const later = {...f.cue, cueId: 'later', startMs: 7000, spokenEndMs: 8000, availableAtMs: 9000};
    f.source.presentLiveCue(later);
    expect(f.source.liveCue).toBe(later);
    f.source.presentLiveCue({...f.cue, text: 'An older correction.'});
    expect(f.source.liveCue).toBe(later);
    await vi.advanceTimersByTimeAsync(1000);
    const correction = {...later, text: 'A completed local sentence, corrected.'};
    f.source.presentLiveCue(correction);
    await vi.advanceTimersByTimeAsync(800);
    expect(f.source.liveCue).toBe(correction);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.source.liveCue).toBeNull();
    expect(f.cue).toMatchObject({startMs: 0, spokenEndMs: 1000, durationMs: 1000, availableAtMs: 4000});
  });

  it('clears current/latest ownership on explicit reset and expires safely without a notification port', async () => {
    const f = liveFixture();
    f.source.presentLiveCue(f.cue);
    f.source.clearLiveCue();
    expect(vi.getTimerCount()).toBe(0);
    expect(f.source.liveCue).toBeNull();
    f.source.presentLiveCue(f.cue);
    expect(f.source.liveCue).toBe(f.cue);
    await vi.advanceTimersByTimeAsync(1800);
    expect(f.source.liveCue).toBeNull();
    f.source.clearLiveCue();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['unsupported route', 'disabled'] as const)('clears its timer and presentation when the owner becomes %s', async reason => {
    const expired = vi.fn();
    const f = liveFixture(expired);
    f.source.presentLiveCue(f.cue);
    f.source.sync();
    if (reason === 'unsupported route') f.location.pathname = '/feed/subscriptions'; else f.state.enabled = false;
    expect(f.source.sync()).toBeNull();
    expect(f.source.liveCue).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1800);
    expect(expired).not.toHaveBeenCalled();
    f.location.pathname = '/watch'; f.state.enabled = true;
    expect(f.source.sync()!.textContent).toBe('');
    f.source.presentLiveCue(f.cue);
    expect(f.source.liveCue).toBe(f.cue);
    f.source.clearLiveCue();
  });

  it('destroy prevents timer notifications and later callbacks from recreating owned DOM', async () => {
    const expired = vi.fn();
    const f = liveFixture(expired);
    const native = f.document.createElement('div'); native.textContent = 'Host-owned words'; f.state.player.appendChild(native);
    f.source.presentLiveCue(f.cue); f.source.sync();
    f.source.destroy();
    expect(f.source.liveCue).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    f.source.presentLiveCue({...f.cue, cueId: 'late', startMs: 10000});
    expect(f.source.sync()).toBeNull();
    f.source.destroy();
    await vi.advanceTimersByTimeAsync(1800);
    expect(expired).not.toHaveBeenCalled();
    expect(f.document.getElementById(VIDEO_AI_CAPTION_CONTAINER_ID)).toBeNull();
    expect(native.isConnected).toBe(true); expect(native.textContent).toBe('Host-owned words');
  });
});
