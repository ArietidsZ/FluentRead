import {afterEach, describe, expect, it, vi} from 'vitest';
import {cacheVideoAiModelFiles, cacheVideoAiQ4ModelFiles, cacheVideoAiQ8ModelFiles, getVideoAiModelFileUrl, VIDEO_AI_Q4_MODEL_FILES, VIDEO_AI_Q8_MODEL_FILES, VIDEO_AI_SMALL_MODEL_FILES} from '@/src/features/video-subtitle/offscreen/modelCache';

afterEach(() => vi.unstubAllGlobals());

describe('video AI model cache', () => {
    it('Small completes only the seven mixed precision files and retries a missing final file', async () => {
        const entries = new Map<string, Response>();
        const cache = {
            match: vi.fn(async (url: string) => entries.get(url)),
            put: vi.fn(async (url: string, response: Response) => {await response.arrayBuffer(); entries.set(url, new Response('x', {headers: response.headers}));}),
        };
        const fetcher = vi.fn(async (url: string) => {
            if (url.endsWith('decoder_model_merged_q4.onnx')) throw new Error('last file unavailable');
            return new Response(new Uint8Array(4), {headers: {'Content-Length': '4'}});
        });
        vi.stubGlobal('caches', {open: async () => cache});vi.stubGlobal('fetch', fetcher);
        const failed: Array<{loaded: number; total: number}> = [];
        await expect(cacheVideoAiQ4ModelFiles('small', item => failed.push(item))).rejects.toThrow('last file');
        expect(entries.size).toBe(6);
        expect(failed[0]).toEqual({loaded: 0, total: 590_000_000});
        expect(failed.at(-1)!.loaded).toBeLessThan(failed.at(-1)!.total);
        fetcher.mockClear().mockImplementation(async () => new Response(new Uint8Array(4), {headers: {'Content-Length': '4'}}));
        const completed: Array<{loaded: number; total: number}> = [];
        await cacheVideoAiQ4ModelFiles('small', item => completed.push(item));
        expect(fetcher).toHaveBeenCalledOnce();
        expect([...entries.keys()]).toEqual(VIDEO_AI_SMALL_MODEL_FILES.map(file => getVideoAiModelFileUrl('small', file)));
        expect(VIDEO_AI_SMALL_MODEL_FILES).toContain('onnx/encoder_model.onnx');
        expect(VIDEO_AI_SMALL_MODEL_FILES).not.toContain('onnx/encoder_model_q4.onnx');
        expect(completed.at(-1)).toEqual({loaded: 28, total: 28});
        await expect(cacheVideoAiQ8ModelFiles('small')).rejects.toThrow('FP32');
        expect(fetcher).toHaveBeenCalledOnce();
    });
    it('Small admits a 353 MB encoder header but bounds oversized files before caching their body', async () => {
        const cache = {match: async (url: string) => url.endsWith('encoder_model.onnx') ? undefined : new Response('cached'),
            put: vi.fn(async () => {throw new Error('353 MB header admitted');})};
        vi.stubGlobal('caches', {open: async () => cache});
        vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(new Uint8Array(1), {headers: {'Content-Length': url.endsWith('encoder_model.onnx') ? '352825870' : '1'}})));
        await expect(cacheVideoAiQ4ModelFiles('small')).rejects.toThrow('353 MB header admitted');
        expect(cache.put).toHaveBeenCalled();
        cache.put.mockClear();
        vi.stubGlobal('fetch', vi.fn(async () => new Response('x', {headers: {'Content-Length': String(384 * 1024 * 1024 + 1)}})));
        await expect(cacheVideoAiQ4ModelFiles('small')).rejects.toThrow('大小上限');
        expect(cache.put).not.toHaveBeenCalled();
        // Small decoder and JSON files retain the original 256 MiB cap.
        cache.match = async (url: string) => url.endsWith('decoder_model_merged_q4.onnx') ? undefined : new Response('cached');
        vi.stubGlobal('fetch', vi.fn(async () => new Response('x', {headers: {'Content-Length': String(256 * 1024 * 1024 + 1)}})));
        await expect(cacheVideoAiQ4ModelFiles('small')).rejects.toThrow('大小上限');
        expect(cache.put).not.toHaveBeenCalled();
    });
    it('Small source retries share a ten-minute download deadline even while data keeps arriving', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('caches', {open: async () => ({match: async () => undefined, put: async (_url: string, response: Response) => {await response.text();}})});
        const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
            let interval: ReturnType<typeof setInterval>;
            return new Response(new ReadableStream<Uint8Array>({
                start(stream) {
                    interval = setInterval(() => stream.enqueue(new Uint8Array([1])), 10_000);
                    options.signal!.addEventListener('abort', () => {clearInterval(interval);stream.close();}, {once: true});
                },
                cancel() {clearInterval(interval);},
            }));
        });
        vi.stubGlobal('fetch', fetcher);
        const pending = cacheVideoAiQ4ModelFiles('small');
        const checked = expect(pending).rejects.toThrow('总等待时限');
        await vi.advanceTimersByTimeAsync(600_001);await checked;
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
        vi.useRealTimers();
    });
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
