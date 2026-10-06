import {afterEach, describe, expect, it, vi} from 'vitest';
import {XHlsAudioReader} from '@/src/features/video-subtitle/content/hlsAudioRuntime';

const media = (id: string) => `https://video.twimg.com/ext_tw_video/${id}/pu/pl/audio.m3u8`;
const manifest = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\naudio.m4s\n#EXT-X-ENDLIST';
class FakeContext {
  static closed = 0;
  state = 'running';
  async decodeAudioData() {
    return {duration: 1, numberOfChannels: 1, sampleRate: 16_000, getChannelData: () => new Float32Array(16_000).fill(.04)};
  }
  async close() { this.state = 'closed'; FakeContext.closed++; }
}
function fixture(urls: string[]) {
  vi.stubGlobal('performance', {getEntriesByType: () => urls.map(name => ({name}))});
  vi.stubGlobal('AudioContext', FakeContext);
  const fetcher = vi.fn(async (url: string) => new Response(url.endsWith('.m3u8') ? manifest : new Uint8Array([1, 2, 3])));
  vi.stubGlobal('fetch', fetcher);
  const video = {currentSrc: 'blob:home-video', src: '', poster: 'https://pbs.twimg.com/ext_tw_video_thumb/111/pu/img/test.jpg', duration: 1} as HTMLVideoElement;
  return {reader: new XHlsAudioReader(), video, fetcher, signal: new AbortController().signal};
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); FakeContext.closed = 0; });

describe('X 首页音轨恢复', () => {
  it('uses the current poster media ID among multiple preloaded Home videos', async () => {
    const {reader, video, signal, fetcher} = fixture([media('222'), media('111'), 'https://example.com/unsafe.m3u8']);
    const pcm = await reader.read(video, signal);
    expect(pcm).toHaveLength(16_000);
    expect(fetcher.mock.calls.every(([url]) => url.includes('/111/'))).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(media('111'), expect.objectContaining({credentials: 'omit', signal: expect.any(AbortSignal)}));
    expect(FakeContext.closed).toBe(1);
  });
  it('reuses a captured manifest without fetching it again', async () => {
    const {reader, video, signal, fetcher} = fixture([]);
    reader.remember(media('111'), manifest);
    expect(await reader.read(video, signal)).toHaveLength(16_000);
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('.m3u8'))).toBe(false);
  });
  it('uses a confirmed local media identity when the Home video poster is missing', async () => {
    const {reader, video, signal, fetcher} = fixture([media('222'), media('111')]);
    video.poster = '';
    expect(await reader.read(video, signal, {poster: 'https://pbs.twimg.com/ext_tw_video_thumb/111/pu/img/test.jpg'})).toHaveLength(16_000);
    expect(fetcher.mock.calls.every(([url]) => url.includes('/111/'))).toBe(true);
  });
  it('fetches a newer manifest even if an old cached manifest already exists', async () => {
    const newer = media('111').replace('audio.m3u8', 'new.m3u8');
    const {reader, video, signal, fetcher} = fixture([newer]);
    reader.remember(media('111'), '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=10\nexpired.m3u8');
    expect(await reader.read(video, signal)).toHaveLength(16_000);
    expect(fetcher).toHaveBeenCalledWith(newer, expect.anything());
    expect(fetcher.mock.calls.some(([url]) => url.includes('expired'))).toBe(false);
  });
  it('tries another captured rendition when a preferred master points to an expired URL', async () => {
    const {reader, video, signal, fetcher} = fixture([]);
    reader.remember(media('111'), manifest);
    reader.remember(media('111').replace('audio.m3u8', 'master.m3u8'), '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=10\nexpired.m3u8');
    fetcher.mockImplementation(async url => new Response(url.includes('expired') ? '' : new Uint8Array([1, 2]), {status: url.includes('expired') ? 403 : 200}));
    expect(await reader.read(video, signal)).toHaveLength(16_000);
    expect(fetcher.mock.calls.some(([url]) => url.includes('expired'))).toBe(true);
    expect(FakeContext.closed).toBe(1);
  });
  it('does not guess which video to recognize when multiple groups have no matching identity', async () => {
    const {reader, video, signal, fetcher} = fixture([media('111'), media('222')]);
    video.poster = '';
    expect(await reader.read(video, signal)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('recovers the unique group without a poster, and reset allows a fresh read', async () => {
    const {reader, video, signal, fetcher} = fixture([media('111')]);
    video.poster = '';
    expect(await reader.read(video, signal)).toHaveLength(16_000);
    reader.reset();
    expect(await reader.read(video, signal)).toHaveLength(16_000);
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('.m3u8'))).toHaveLength(2);
  });
  it('tries another manifest of the same media when an old URL has expired', async () => {
    const valid = media('111');
    const expired = valid.replace('audio.m3u8', 'expired.m3u8');
    const {reader, video, signal, fetcher} = fixture([valid, expired]);
    fetcher.mockImplementation(async url => new Response(url === expired ? '' : url === valid ? manifest : new Uint8Array([1]), {status: url === expired ? 403 : 200}));
    expect(await reader.read(video, signal)).toHaveLength(16_000);
    expect(fetcher.mock.calls[0][0]).toBe(expired);
  });
  it('aborts a pending discovery immediately when the user changes videos', async () => {
    const {reader, video, fetcher} = fixture([media('111')]);
    const controller = new AbortController();
    fetcher.mockImplementation((_url, options?: RequestInit) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
    }));
    const reading = reader.read(video, controller.signal);
    controller.abort();
    expect(await reading).toBeNull();
    expect(FakeContext.closed).toBe(0);
  });
  it('limits discovery time and skips already cancelled requests', async () => {
    vi.useFakeTimers();
    const {reader, video, fetcher, signal} = fixture([media('111')]);
    fetcher.mockImplementation((_url, options?: RequestInit) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')));
    }));
    const reading = reader.read(video, signal);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await reading).toBeNull();
    const cancelled = new AbortController();
    cancelled.abort();
    fetcher.mockClear();
    expect(await reader.read(video, cancelled.signal)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
