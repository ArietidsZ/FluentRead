// Candidate test; not executed. Uses the reviewed native-ASR source supplement.
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {normalizeNativeAsrBaseUrl} from '../src/core/config/nativeAsr';
import {transcribeNativeQwenPcm16} from '../src/features/video-subtitle/background/nativeTranscription';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllTimers(); vi.useRealTimers(); });

describe('native ASR loopback boundary', () => {
    it.each([
        ['http://127.0.0.1:8000', 'http://127.0.0.1:8000'],
        ['http://127.0.0.1:8000/v1/', 'http://127.0.0.1:8000'],
        ['https://[::1]:8443/v1', 'https://[::1]:8443'],
    ])('canonicalizes %s', (input, expected) => {
        expect(normalizeNativeAsrBaseUrl(input)).toBe(expected);
    });
    it.each([
        undefined, null, '', 123, 'http://example.com', 'http://localhost:8000',
        'http://user@127.0.0.1:8000', 'http://user:secret@127.0.0.1',
        'http://127.0.0.1/?auth=secret', 'http://127.0.0.1/#secret',
        'http://127.0.0.1/private', 'ftp://127.0.0.1',
        'http://127.0.0.1\t:8000', 'x'.repeat(513),
    ])('leaves invalid explicit input disabled: %s', (input) => {
        expect(normalizeNativeAsrBaseUrl(input)).toBe('');
    });
});

const options = () => ({baseUrl: 'http://127.0.0.1:8000', signal: new AbortController().signal});
const pcm = 'AAA='; // One PCM16 sample, not real audio acceptance evidence.

describe('native ASR failure cleanup and transmission', () => {
    it('preserves HTTP error without awaiting a stalled cancellation handshake', async () => {
        const cancel = vi.fn(() => new Promise<void>(() => {}));
        const body = new ReadableStream<Uint8Array>({cancel});
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {status: 503})));
        await expect(transcribeNativeQwenPcm16(pcm, options())).rejects.toThrow('HTTP 503');
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('preserves the size-limit error and releases the reader despite stalled cancel', async () => {
        const cancel = vi.fn(() => new Promise<void>(() => {}));
        const body = new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(new Uint8Array(128 * 1024 + 1)); }, cancel,
        });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
        await expect(transcribeNativeQwenPcm16(pcm, options())).rejects.toThrow('响应超过大小限制');
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(body.locked).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('returns text without inventing timestamps or device evidence', async () => {
        const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({text: 'hello'})));
        vi.stubGlobal('fetch', fetch);
        const result = await transcribeNativeQwenPcm16(pcm, options());
        expect(result).toEqual({text: 'hello', model: 'Qwen/Qwen3-ASR-1.7B', audioDurationMs: 0.0625});
        expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8000/v1/audio/transcriptions', expect.objectContaining({
            method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
        }));
        expect(vi.getTimerCount()).toBe(0);
    });

    it('rejects pre-aborted work before fetch', async () => {
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        const controller = new AbortController(); controller.abort();
        await expect(transcribeNativeQwenPcm16(pcm, {...options(), signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each(['', 'AA==', 'A===', 'AA A'])('rejects malformed or non-PCM16 base64 %s before fetch', async (encoded) => {
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        await expect(transcribeNativeQwenPcm16(encoded, options())).rejects.toThrow();
        expect(fetch).not.toHaveBeenCalled();
    });
});
