import {describe, expect, it, vi} from 'vitest';
import {
  isXMediaUrl,
  parseHlsAudioManifest,
  readBoundedMediaResponse,
  readXHlsAudio,
} from '@/src/features/video-subtitle/content/hlsAudio';

const base = 'https://video.twimg.com/ext/audio/master.m3u8';
function response(bytes: Uint8Array, init: ResponseInit = {}): Response {
  return new Response(new ReadableStream({start(controller) { controller.enqueue(bytes); controller.close(); }}), {
    status: 200, headers: {'content-length': String(bytes.length), ...(init.headers || {})}, ...init,
  });
}
const textBytes = (value: string) => new TextEncoder().encode(value);
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('HLS audio', () => {
  it('validates X media URLs and selects default AUDIO rendition', () => {
    expect(isXMediaUrl(base)).toBe(true);
    expect(isXMediaUrl('http://video.twimg.com/x')).toBe(false);
    expect(isXMediaUrl('https://example.com/x')).toBe(false);
    expect(isXMediaUrl('https://[bad')).toBe(false);
    const parsed = parseHlsAudioManifest('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",DEFAULT=NO,URI="no.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",DEFAULT=YES,URI="yes.m3u8"', base);
    expect(parsed).toEqual({next: 'https://video.twimg.com/ext/audio/yes.m3u8', durationMs: 0});
  });

  it('selects lowest bandwidth variant and parses complete fMP4 playlist in order', () => {
    const variant = parseHlsAudioManifest('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900\nhi.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=100\nlow.m3u8', base);
    expect(variant?.next).toContain('low.m3u8');
    const media = parseHlsAudioManifest('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1.5,\na.m4s\n#EXTINF:2,\nb.m4s\n#EXT-X-ENDLIST', base);
    expect(media).toEqual({segments: [expect.stringContaining('init.mp4'), expect.stringContaining('a.m4s'), expect.stringContaining('b.m4s')], durationMs: 3500});
  });

  it('拒绝加密、byterange、discontinuity、开放或超限清单', () => {
    const reject = (extra: string) => expect(parseHlsAudioManifest(`#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\na.m4s\n#EXT-X-ENDLIST\n${extra}`, base)).toBeNull();
    reject('#EXT-X-KEY:METHOD=AES-128,URI="key"');
    reject('#EXT-X-BYTERANGE:10@0');
    reject('#EXT-X-DISCONTINUITY');
    expect(parseHlsAudioManifest('#EXTM3U\n#EXTINF:1,\na.m4s', base)).toBeNull();
    expect(parseHlsAudioManifest('#EXTM3U\n#EXT-X-ENDLIST', base)).toBeNull();
    expect(parseHlsAudioManifest('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\na.m4s\n#EXT-X-ENDLIST', 'https://example.com/master.m3u8')).toBeNull();
    expect(parseHlsAudioManifest('#EXTM3U' + 'x'.repeat(1_000_001), base)).toBeNull();
    expect(parseHlsAudioManifest('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=\n', base)).toBeNull();
    expect(parseHlsAudioManifest('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n#EXT-X-ENDLIST', base)).toBeNull();
    expect(parseHlsAudioManifest('#EXTM3U\n#EXT-X-STREAM-INF:\nlow.m3u8', base)?.next).toContain('low.m3u8');
    const tooMany = ['#EXTM3U', '#EXT-X-MAP:URI="init.mp4"', ...Array.from({length: 257}, (_, i) => `#EXTINF:1,\nseg-${i}.m4s`), '#EXT-X-ENDLIST'].join('\n');
    expect(parseHlsAudioManifest(tooMany, base)).toBeNull();
    expect(parseHlsAudioManifest('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1201,\na.m4s\n#EXT-X-ENDLIST', base)).toBeNull();
  });

  it('读取 bounded stream，拒绝空体、非 OK、声明超限和实际超限', async () => {
    const controller = new AbortController();
    await expect(readBoundedMediaResponse(response(textBytes('abc')), 10, controller.signal)).resolves.toEqual(textBytes('abc'));
    await expect(readBoundedMediaResponse(new Response(null, {status: 500}), 10, controller.signal)).rejects.toThrow('无效');
    await expect(readBoundedMediaResponse(response(textBytes('abc'), {headers: {'content-length': '11'}}), 10, controller.signal)).rejects.toThrow('无效');
    await expect(readBoundedMediaResponse(new Response(null, {status: 200}), 10, controller.signal)).rejects.toThrow('为空');
    const oversized = new Response(new ReadableStream({start(c) { c.enqueue(textBytes('1234')); c.close(); }}), {status: 200});
    await expect(readBoundedMediaResponse(oversized, 3, controller.signal)).rejects.toThrow('读取上限');
  });

  it('在流读取等待期间收到 abort 时拒绝取消错误', async () => {
    const controller = new AbortController();
    const pending = readBoundedMediaResponse(new Response(new ReadableStream({
      pull() { return new Promise<void>(() => undefined); },
    })), 10, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toThrow('读取已取消');
  });

  it('读取音轨时保持段落顺序、并发为 3，并传递 omit credentials', async () => {
    const manifest = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\na.m4s\n#EXTINF:1,\nb.m4s\n#EXT-X-ENDLIST';
    const calls: string[] = [];
    const fetchResource = vi.fn(async (url: string, options: {signal: AbortSignal; credentials: 'omit'}) => {
      calls.push(url); expect(options.credentials).toBe('omit');
      return response(textBytes(url.endsWith('a.m4s') ? 'A' : url.endsWith('b.m4s') ? 'B' : 'I'));
    });
    await expect(readXHlsAudio(base, manifest, new AbortController().signal, fetchResource)).resolves.toMatchObject({bytes: textBytes('IAB'), durationMs: 2000});
    expect(calls).toEqual(expect.arrayContaining(['https://video.twimg.com/ext/audio/init.mp4', 'https://video.twimg.com/ext/audio/a.m4s', 'https://video.twimg.com/ext/audio/b.m4s']));
  });

  it('并发读取时共享 64 MiB 音频预算，避免三个响应各自通过单段上限', async () => {
    const manifest = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\na.m4s\n#EXTINF:1,\nb.m4s\n#EXT-X-ENDLIST';
    const chunk = new Uint8Array(22 * 1024 * 1024);
    const fetchResource = vi.fn(async () => response(chunk));

    await expect(readXHlsAudio(base, manifest, new AbortController().signal, fetchResource)).rejects.toThrow('读取上限');
    expect(fetchResource).toHaveBeenCalledTimes(3);
  });

  it('跟随最多三层 manifest，拒绝循环、失败和外站 redirect 资源', async () => {
    const child = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\na.m4s\n#EXTINF:1,\nb.m4s\n#EXT-X-ENDLIST';
    const fetchResource = vi.fn(async (url: string) => url.endsWith('child.m3u8') ? response(textBytes(child)) : response(textBytes('x')));
    await expect(readXHlsAudio(base, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nchild.m3u8', new AbortController().signal, fetchResource)).resolves.toMatchObject({durationMs: 2000});
    const failing = vi.fn(async () => { throw new Error('network'); });
    await expect(readXHlsAudio(base, child, new AbortController().signal, failing)).rejects.toThrow('network');
    const external = '#EXTM3U\n#EXT-X-MAP:URI="https://example.com/init.mp4"\n#EXTINF:1,\na.m4s\n#EXT-X-ENDLIST';
    await expect(readXHlsAudio(base, external, new AbortController().signal, fetchResource)).rejects.toThrow('视频音轨地址');
    const cycle = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmaster.m3u8';
    await expect(readXHlsAudio(base, cycle, new AbortController().signal, fetchResource)).resolves.toBeNull();
    const segmentFailure = vi.fn(async (url: string) => {
      if (url.endsWith('a.m4s')) throw new Error('segment failed');
      return response(textBytes('I'));
    });
    await expect(readXHlsAudio(base, child, new AbortController().signal, segmentFailure)).rejects.toThrow('segment failed');
  });

  it('外部 abort 会取消读取并返回 null', async () => {
    const signal = new AbortController();
    const fetchResource = vi.fn(async (_url: string, options: {signal: AbortSignal}) => {
      await new Promise<void>(resolve => setTimeout(resolve, 10));
      if (options.signal.aborted) throw new Error('aborted');
      return response(textBytes('x'));
    });
    const pending = readXHlsAudio(base, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nchild.m3u8', signal.signal, fetchResource);
    signal.abort();
    await expect(pending).resolves.toBeNull();
    await flush();
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await expect(readXHlsAudio(base, '#EXTM3U', alreadyAborted.signal, fetchResource)).resolves.toBeNull();
  });

  it('清单请求完成后才收到 abort 时返回 null', async () => {
    const controller = new AbortController();
    const child = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\na.m4s\n#EXTINF:1,\nb.m4s\n#EXT-X-ENDLIST';
    const releaseLock = vi.fn(() => {
      queueMicrotask(() => queueMicrotask(() => controller.abort()));
    });
    const doneResponse = (onRelease: () => void = () => undefined) => {
      const result = new Response(null, {status: 200});
      Object.defineProperty(result, 'body', {
        value: {
          getReader: () => ({
            read: async () => ({done: true, value: undefined}),
            cancel: async () => undefined,
            releaseLock: onRelease,
          }),
        },
      });
      return result;
    };
    const abortingResponse = doneResponse(releaseLock);
    const completedResponse = doneResponse();
    /* The delayed abort lets all workers finish their current read before the
       Promise.all continuation observes the cancelled scope. */
    const fetchResource = vi.fn(async (url: string) => {
      if (url.endsWith('child.m3u8')) {
        return response(textBytes(child));
      }
      if (url.endsWith('b.m4s')) return abortingResponse;
      return completedResponse;
    });
    const pending = readXHlsAudio(base, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nchild.m3u8', controller.signal, fetchResource);
    await expect(pending).resolves.toBeNull();
    expect(releaseLock).toHaveBeenCalled();
  });
});
