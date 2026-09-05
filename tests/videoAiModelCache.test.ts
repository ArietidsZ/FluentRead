import {afterEach, describe, expect, it, vi} from 'vitest';
import {cacheVideoAiModelFiles, cacheVideoAiQ4ModelFiles, cacheVideoAiQ8ModelFiles, getVideoAiModelFileUrl, VIDEO_AI_Q4_MODEL_FILES, VIDEO_AI_Q8_MODEL_FILES} from '@/src/features/video-subtitle/offscreen/modelCache';

afterEach(() => vi.unstubAllGlobals());

describe('video AI model cache', () => {
    it('builds normalized model URLs and exposes both dtype manifests', () => {
        expect(getVideoAiModelFileUrl('base', VIDEO_AI_Q4_MODEL_FILES[0])).toContain('whisper-base');
        expect(VIDEO_AI_Q8_MODEL_FILES).toContain('onnx/encoder_model_quantized.onnx');
    });
    it('downloads only missing files and uses the q8 manifest', async () => {
        const entries = new Set<string>();
        const cache = {
            match: vi.fn(async (url: string) => entries.has(url) ? new Response('cached') : undefined),
            put: vi.fn(async (url: string) => { entries.add(url); }),
        };
        vi.stubGlobal('caches', {open: vi.fn(async () => cache)});
        vi.stubGlobal('window', {setTimeout, clearTimeout});
        vi.stubGlobal('fetch', vi.fn(async () => new Response('model')));
        await cacheVideoAiModelFiles('tiny', 'q8');
        expect(cache.put).toHaveBeenCalledTimes(VIDEO_AI_Q8_MODEL_FILES.length);
        await cacheVideoAiModelFiles('tiny', 'q8');
        expect(cache.put).toHaveBeenCalledTimes(VIDEO_AI_Q8_MODEL_FILES.length);
    });
    it('fails clearly when Cache Storage is unavailable or fetch fails', async () => {
        vi.stubGlobal('caches', undefined);
        await expect(cacheVideoAiModelFiles('tiny')).rejects.toThrow('缓存');
        const cache = {match: vi.fn(async () => undefined), put: vi.fn()};
        vi.stubGlobal('caches', {open: vi.fn(async () => cache)});
        vi.stubGlobal('window', {setTimeout, clearTimeout});
        vi.stubGlobal('fetch', vi.fn(async () => new Response('', {status: 503})));
        await expect(cacheVideoAiModelFiles('tiny')).rejects.toThrow('503');
    });
    it('keeps q4 and q8 wrapper calls on the same cache implementation', async () => {
        const cache = {match: vi.fn(async () => new Response('cached')), put: vi.fn()};
        vi.stubGlobal('caches', {open: vi.fn(async () => cache)});
        vi.stubGlobal('window', {setTimeout, clearTimeout});
        await cacheVideoAiQ4ModelFiles('tiny');
        await cacheVideoAiQ8ModelFiles('tiny');
        expect(cache.match).toHaveBeenCalledTimes(VIDEO_AI_Q4_MODEL_FILES.length + VIDEO_AI_Q8_MODEL_FILES.length);
    });
    it('converts an aborted download into a timeout error', async () => {
        vi.useFakeTimers();
        const cache = {match: vi.fn(async () => undefined), put: vi.fn()};
        vi.stubGlobal('caches', {open: vi.fn(async () => cache)});
        vi.stubGlobal('window', {setTimeout, clearTimeout});
        vi.stubGlobal('fetch', vi.fn((_url: string, options: {signal: AbortSignal}) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
        })));
        const pending = cacheVideoAiModelFiles('tiny');
        const assertion = expect(pending).rejects.toThrow('超过');
        await vi.advanceTimersByTimeAsync(120_000);
        await assertion;
        vi.useRealTimers();
    });
});
