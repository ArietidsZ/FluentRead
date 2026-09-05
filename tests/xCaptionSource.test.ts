import {afterEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
vi.mock('@/src/services/config/store', () => ({config: {uiLanguage: 'zh-CN'}}));
import {XCaptionSource} from '@/src/features/video-subtitle/content/xCaptionSource';
import {VIDEO_AI_CAPTION_CONTAINER_ID} from '@/src/features/video-subtitle/content/ui';

afterEach(() => vi.unstubAllGlobals());
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
  const state = {video, player: video.parentElement!, enabled: true, aiActive: false, aiCues: [], sidecarCues: [], language: 'auto'};
  const source = new XCaptionSource(() => state);
  return {source, state, document, korean, english};
}

describe('X 原生字幕来源', () => {
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
