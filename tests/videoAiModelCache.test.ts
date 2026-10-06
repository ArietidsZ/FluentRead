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
    it('reports one combined byte progress for the whole model and counts cached files', async () => {
        const entries = new Map<string, Response>();
        const cache = {
            match: vi.fn(async (url: string) => entries.get(url)),
            put: vi.fn(async (url: string, response: Response) => { await response.arrayBuffer(); entries.set(url, new Response('x', {headers: response.headers})); }),
        };
        vi.stubGlobal('caches', {open: vi.fn(async () => cache)});
        vi.stubGlobal('window', {setTimeout, clearTimeout});
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(4), {headers: {'Content-Length': '4'}})));
        const reports: Array<{loaded: number; total: number}> = [];
        await cacheVideoAiQ4ModelFiles('tiny', progress => reports.push(progress));
        const exact = VIDEO_AI_Q4_MODEL_FILES.length * 4;
        // 最后一个文件开始前按界面标注的 100 MB 计算，全部大小已知后改用精确合计。
        expect(reports[0]).toEqual({loaded: 0, total: 100_000_000});
        expect(reports.at(-1)).toEqual({loaded: exact, total: exact});
        expect(reports.every((item, index) => index === 0 || item.loaded >= reports[index - 1].loaded)).toBe(true);

        // 再次调用时文件都在缓存里：按缓存响应头的大小计入已完成部分。
        const cached: Array<{loaded: number; total: number}> = [];
        await cacheVideoAiModelFiles('tiny', 'q4', progress => cached.push(progress));
        expect(cached.at(-1)).toEqual({loaded: exact, total: exact});
        expect(fetch).toHaveBeenCalledTimes(VIDEO_AI_Q4_MODEL_FILES.length);

        // q8 回退没有预计体积：文件大小未全部确定前不给总量。
        const q8: Array<{loaded: number; total: number}> = [];
        await cacheVideoAiQ8ModelFiles('tiny', progress => q8.push(progress));
        expect(q8.some(item => item.total === 0)).toBe(true);
        expect(q8.at(-1)).toEqual({loaded: exact, total: exact});
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
        await vi.advanceTimersByTimeAsync(120_000 * 4);
        await assertion;
        vi.useRealTimers();
    });
});
