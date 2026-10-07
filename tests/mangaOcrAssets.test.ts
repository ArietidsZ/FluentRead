import {webcrypto} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const fixture = vi.hoisted(() => ({
    root: 'https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/bf1d5edb0335d3262be7caf13f766ba274b4cadd/',
    assets: [
        {key: 'detection', path: 'detection/PP-OCRv6_small_det.onnx', bytes: 31, byte: 17,
            sha256: '1111c25290ba8140ae97e06d6267b23d910cb7a501be159795deb61dc445c6ce'},
        {key: 'recognition', path: 'recognition/PP-OCRv6_small_rec.onnx', bytes: 68, byte: 34,
            sha256: '69e1045a3f8e8f7c1bf0f0162e2a8886600ca156301f6c64486f0651093098ee'},
        {key: 'charactersDictionary', path: 'recognition/ppocrv6_dict.txt', bytes: 1, byte: 51,
            sha256: '4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce'},
    ],
    inpaint: {
        url: 'https://huggingface.co/ogkalu/lama-manga-onnx-dynamic/resolve/ee4ed4a8447b6730fc41d34f90876b6c48af925a/lama-manga-dynamic.onnx',
        bytes: 5, byte: 68, sha256: '0efd96d5951d54fe88c49bc538f0724685c17e65022eaf644325453a9ae86680',
    },
}));
// 在 runtime 求值前替换整份资产数据与总容量；不替换 Response 或 digest。
vi.mock('@/src/features/image-translation/services/mangaOcrAssetManifest', () => ({
    MANGA_OCR_ROOT: fixture.root, MANGA_OCR_CACHE: 'fluent-read-manga-ocr-v1',
    MANGA_OCR_ASSETS: fixture.assets,
    MANGA_OCR_MODEL_BYTES: fixture.assets.reduce((sum, asset) => sum + asset.bytes, 0),
    MANGA_INPAINT_ASSET: fixture.inpaint,
}));
import {
    MANGA_INPAINT_ASSET, MANGA_OCR_CACHE, MANGA_OCR_MODEL_BYTES,
    assertMangaOcrActive, getMangaModelSource, importMangaModel, loadMangaInpaintAsset,
    loadMangaOcrAssets, mangaOcrModelStatus, removeMangaOcrAssets, setMangaModelSource,
} from '@/src/features/image-translation/services/mangaOcrAssets';

type TinyAsset = {bytes: number; byte: number};
function body(asset: TinyAsset): Uint8Array { return new Uint8Array(asset.bytes).fill(asset.byte); }
function corrupted(asset: TinyAsset): Uint8Array { const bytes = body(asset); bytes[0] ^= 1; return bytes; }
function responseFor(url: string): Response {
    const asset = fixture.assets.find(asset => url.endsWith(asset.path));
    if (!asset && !url.endsWith('lama-manga-dynamic.onnx')) throw new Error('Unexpected fixture URL: ' + url);
    return new Response(body(asset ?? fixture.inpaint));
}
function fileFor(asset: TinyAsset, name: string): File { return new File([body(asset)], name); }
function observed<T>(expectation: Promise<T>): Promise<T> {
    // 立即处理 assertion promise 的潜在拒绝；测试仍 await 原 promise，失败不会变成通过。
    void expectation.catch(() => undefined); return expectation;
}
let files: Map<string, Response>;
let settings: Map<string, Response>;
let cache: {match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>};
let preferences: {match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>};
beforeEach(async () => {
    files = new Map(); settings = new Map();
    cache = {
        match: vi.fn(async (url: string) => files.get(url)?.clone()),
        put: vi.fn(async (url: string, value: Response) => { files.set(url, value.clone()); }),
        delete: vi.fn(async (url: string) => files.delete(url)),
    };
    preferences = {
        match: vi.fn(async (url: string) => settings.get(url)?.clone()),
        put: vi.fn(async (url: string, value: Response) => { settings.set(url, value.clone()); }),
    };
    vi.stubGlobal('caches', {
        open: vi.fn(async (name: string) => name === MANGA_OCR_CACHE ? cache : preferences),
        delete: vi.fn(async () => { files.clear(); return true; }),
    });
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('navigator', {language: 'en-US'});
    vi.stubGlobal('fetch', vi.fn(async (url: string) => responseFor(url)));
    await removeMangaOcrAssets(); vi.mocked(caches.delete).mockClear();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('漫画模型真实小字节完整性与生命周期', () => {
    it('31/68/1 真实字节经原生 SHA-256、Response 入库，并精确报告 [31,99,100]', async () => {
        expect(MANGA_OCR_MODEL_BYTES).toBe(100);
        const progress = vi.fn(); const model = await loadMangaOcrAssets(undefined, progress);
        expect(Object.keys(model)).toEqual(['detection', 'recognition', 'charactersDictionary']);
        expect(progress.mock.calls.map(call => call[0])).toEqual([31, 99, 100]);
        expect(fetch).toHaveBeenCalledTimes(3); expect(cache.put).toHaveBeenCalledTimes(3);
        for (const asset of fixture.assets) {
            expect(model[asset.key]).toBeInstanceOf(ArrayBuffer);
            expect(model[asset.key].byteLength).toBe(asset.bytes);
            expect(new Uint8Array(model[asset.key])).toEqual(body(asset));
            const digest = await crypto.subtle.digest('SHA-256', model[asset.key]);
            expect(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')).toBe(asset.sha256);
            const stored = files.get(fixture.root + asset.path)!;
            expect(stored).toBeInstanceOf(Response);
            expect(new Uint8Array(await stored.clone().arrayBuffer())).toEqual(body(asset));
        }
        for (const [url, options] of vi.mocked(fetch).mock.calls) {
            expect(url).toContain('/resolve/bf1d5edb0335d3262be7caf13f766ba274b4cadd/');
            expect(options).toEqual({signal: expect.any(AbortSignal), credentials: 'omit', referrerPolicy: 'no-referrer'});
        }
    });
    it('实际缓存 roundtrip 保持字节和内容一致，不再次下载或写入', async () => {
        const first = await loadMangaOcrAssets(); vi.mocked(fetch).mockClear(); cache.put.mockClear();
        const second = await loadMangaOcrAssets();
        for (const asset of fixture.assets) {
            expect(second[asset.key].byteLength).toBe(asset.bytes);
            expect(new Uint8Array(second[asset.key])).toEqual(new Uint8Array(first[asset.key]));
        }
        expect(fetch).not.toHaveBeenCalled(); expect(cache.put).not.toHaveBeenCalled();
    });
    it('来源偏好真实持久化，无效值拒绝；两个坏镜像之后按原顺序回退官方', async () => {
        expect(await getMangaModelSource()).toBe('auto');
        settings.set('https://fluent-read.invalid/manga-model-source', new Response('bad'));
        expect(await getMangaModelSource()).toBe('auto');
        await expect(setMangaModelSource('bad' as never)).rejects.toThrow('无效');
        await setMangaModelSource('mirror'); expect(await getMangaModelSource()).toBe('mirror');
        vi.mocked(fetch).mockResolvedValueOnce(new Response(corrupted(fixture.assets[0])))
            .mockResolvedValueOnce(new Response(new Uint8Array(30)));
        await loadMangaOcrAssets();
        expect(vi.mocked(fetch).mock.calls.slice(0, 3).map(([url]) => new URL(String(url)).origin))
            .toEqual(['https://hf-mirror.com', 'https://hf-mirror.net', 'https://huggingface.co']);
        expect(cache.put).toHaveBeenCalledTimes(3);
        expect(new Uint8Array(await files.get(fixture.root + fixture.assets[0].path)!.clone().arrayBuffer())).toEqual(body(fixture.assets[0]));
        await setMangaModelSource('official'); expect(await getMangaModelSource()).toBe('official');
    });
    it('19,999ms 不回退；超过 20,000ms 先 abort 旧源再启动备用源', async () => {
        vi.useFakeTimers(); const events: string[] = []; const abort = new AbortController();
        vi.mocked(fetch).mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
            events.push('first');
            options!.signal!.addEventListener('abort', () => { events.push('abort'); reject(new DOMException('timeout', 'AbortError')); }, {once: true});
        })).mockImplementationOnce(async url => { events.push('fallback'); return responseFor(String(url)); });
        const pending = loadMangaInpaintAsset(abort.signal);
        const check = observed(expect(pending).resolves.toEqual(body(fixture.inpaint).buffer));
        try {
            await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(19_999);
            expect(fetch).toHaveBeenCalledTimes(1); expect(events).toEqual(['first']);
            expect(vi.mocked(fetch).mock.calls[0][1]!.signal!.aborted).toBe(false);
            await vi.advanceTimersByTimeAsync(2); await check;
            expect(events).toEqual(['first', 'abort', 'fallback']); expect(fetch).toHaveBeenCalledTimes(2);
            expect(vi.mocked(fetch).mock.calls[1][0]).toContain('hf-mirror.com');
        } finally { abort.abort(); await vi.runAllTimersAsync(); await Promise.allSettled([pending, check]); }
    });
    it('用户取消立即结束，不回退、不写 cache，paused 状态可被完整缓存解除', async () => {
        vi.useFakeTimers(); const abort = new AbortController();
        vi.mocked(fetch).mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
            options!.signal!.addEventListener('abort', () => reject('cancel'), {once: true});
        }));
        const pending = loadMangaInpaintAsset(abort.signal);
        const check = observed(expect(pending).rejects.toMatchObject({name: 'AbortError'}));
        try {
            await vi.advanceTimersByTimeAsync(1); abort.abort(); await check;
            expect(fetch).toHaveBeenCalledTimes(1); expect(cache.put).not.toHaveBeenCalled();
            expect((await mangaOcrModelStatus()).download?.phase).toBe('paused');
            files.set(MANGA_INPAINT_ASSET.url, new Response(body(fixture.inpaint)));
            expect((await mangaOcrModelStatus()).download).toBeUndefined();
        } finally { abort.abort(); await vi.runAllTimersAsync(); await Promise.allSettled([pending, check]); }
    });
    it('真实流分块按已收字节报告唯一进度', async () => {
        const bytes = body(fixture.assets[0]); const progress = vi.fn();
        const stream = new ReadableStream<Uint8Array>({start(controller) {
            controller.enqueue(bytes.slice(0, 5)); controller.enqueue(bytes.slice(5)); controller.close();
        }});
        vi.mocked(fetch).mockResolvedValueOnce(new Response(stream));
        await loadMangaOcrAssets(undefined, progress);
        expect(progress.mock.calls.map(call => call[0])).toEqual([5, 31, 99, 100]);
        expect(new Uint8Array(await files.get(fixture.root + fixture.assets[0].path)!.clone().arrayBuffer())).toEqual(bytes);
    });
    it.each([['截断', 30], ['超量', 32], ['空数据', 0]] as const)('%s 的真实数据拒绝且不缓存', async (_label, length) => {
        vi.mocked(fetch).mockImplementation(async () => new Response(new Uint8Array(length)));
        await expect(loadMangaOcrAssets()).rejects.toMatchObject({cause: expect.objectContaining({message: expect.stringContaining('不完整')})});
        expect(fetch).toHaveBeenCalledTimes(3); expect(cache.put).not.toHaveBeenCalled(); expect(files.size).toBe(0);
    });
    it('原生无 body Response 的零字节 arrayBuffer 同样拒绝', async () => {
        vi.mocked(fetch).mockImplementation(async () => new Response(null));
        await expect(loadMangaOcrAssets()).rejects.toMatchObject({cause: expect.objectContaining({message: expect.stringContaining('不完整')})});
        expect(cache.put).not.toHaveBeenCalled();
    });
    it('同大小错误哈希拒绝且不缓存，未替换真实 digest', async () => {
        vi.mocked(fetch).mockImplementation(async () => new Response(corrupted(fixture.assets[0])));
        await expect(loadMangaOcrAssets()).rejects.toMatchObject({cause: expect.objectContaining({message: expect.stringContaining('校验失败')})});
        expect(cache.put).not.toHaveBeenCalled(); expect(files.size).toBe(0);
    });
    it('错误 filename、真实 file size 和同大小错误哈希均拒绝离线导入', async () => {
        await expect(importMangaModel(fileFor(fixture.assets[0], 'wrong.onnx'))).rejects.toThrow('配套');
        await expect(importMangaModel(new File([new Uint8Array(30)], 'PP-OCRv6_small_det.onnx'))).rejects.toThrow('配套');
        await expect(importMangaModel(new File([corrupted(fixture.assets[0])], 'PP-OCRv6_small_det.onnx'))).rejects.toThrow('校验失败');
        expect(cache.put).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    });
    it('原字典和修补模型真实 File 导入后缓存实际内容一致，不请求网络', async () => {
        await importMangaModel(fileFor(fixture.assets[2], 'ppocrv6_dict.txt'));
        await importMangaModel(fileFor(fixture.inpaint, 'lama-manga-dynamic.onnx'));
        expect(cache.put).toHaveBeenCalledTimes(2); expect(fetch).not.toHaveBeenCalled();
        expect(new Uint8Array(await files.get(fixture.root + fixture.assets[2].path)!.clone().arrayBuffer())).toEqual(body(fixture.assets[2]));
        expect(new Uint8Array(await files.get(MANGA_INPAINT_ASSET.url)!.clone().arrayBuffer())).toEqual(body(fixture.inpaint));
    });
    it.each(['http', 'size', 'hash'] as const)('损坏缓存 %s 删除后重新校验下载', async kind => {
        const url = fixture.root + fixture.assets[0].path;
        files.set(url, kind === 'http' ? new Response(null, {status: 503})
            : new Response(kind === 'size' ? new Uint8Array(30) : corrupted(fixture.assets[0])));
        await loadMangaOcrAssets();
        expect(cache.delete).toHaveBeenCalledOnce(); expect(cache.delete).toHaveBeenCalledWith(url);
        expect(new Uint8Array(await files.get(url)!.clone().arrayBuffer())).toEqual(body(fixture.assets[0]));
    });
    it('所有来源 HTTP 错误报告原原因、不写缓存；后续缓存解除 error', async () => {
        vi.mocked(fetch).mockImplementation(async () => new Response(null, {status: 503}));
        await expect(loadMangaOcrAssets()).rejects.toMatchObject({cause: expect.objectContaining({message: expect.stringContaining('(503)')})});
        expect(cache.put).not.toHaveBeenCalled(); expect((await mangaOcrModelStatus()).download?.phase).toBe('error');
        files.set(fixture.root + fixture.assets[0].path, new Response(body(fixture.assets[0])));
        expect((await mangaOcrModelStatus()).download).toBeUndefined();
    });
    it('真实流读取失败和非 Error 失败报告可重试状态且不缓存', async () => {
        vi.mocked(fetch).mockImplementation(async () => new Response(new ReadableStream({start(controller) { controller.error(new Error('connection closed')); }})));
        await expect(loadMangaOcrAssets()).rejects.toMatchObject({cause: expect.objectContaining({message: 'connection closed'})});
        vi.mocked(fetch).mockRejectedValue('network');
        await expect(loadMangaInpaintAsset()).rejects.toMatchObject({cause: 'network'});
        expect(cache.put).not.toHaveBeenCalled();
    });
    it('真实 reader.cancel 拒绝不泄漏未处理异常，坏源后仍能完成正确回退', async () => {
        const cancel = vi.fn(async () => { throw new Error('already closed'); });
        const stream = new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(new Uint8Array(fixture.inpaint.bytes + 1)); }, cancel,
        });
        vi.mocked(fetch).mockResolvedValueOnce(new Response(stream));
        const result = await loadMangaInpaintAsset();
        expect(cancel).toHaveBeenCalledOnce(); expect(new Uint8Array(result)).toEqual(body(fixture.inpaint));
        expect(fetch).toHaveBeenCalledTimes(2); expect(cache.put).toHaveBeenCalledOnce(); await Promise.resolve();
    });
    it('下载完成但用户取消不写缓存，预取消不打开缓存', async () => {
        const abort = new AbortController();
        vi.mocked(fetch).mockImplementationOnce(async url => { abort.abort(); return responseFor(String(url)); });
        await expect(loadMangaOcrAssets(abort.signal)).rejects.toMatchObject({name: 'AbortError'});
        expect(cache.put).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(1);
        const count = vi.mocked(caches.open).mock.calls.length;
        await expect(loadMangaOcrAssets(abort.signal)).rejects.toMatchObject({name: 'AbortError'});
        expect(caches.open).toHaveBeenCalledTimes(count); expect(() => assertMangaOcrActive()).not.toThrow();
    });
    it('完整缓存的进度取消不继续读取后续文件', async () => {
        for (const asset of fixture.assets) files.set(fixture.root + asset.path, new Response(body(asset)));
        const abort = new AbortController();
        await expect(loadMangaOcrAssets(abort.signal, () => abort.abort())).rejects.toMatchObject({name: 'AbortError'});
        expect(cache.match).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled(); expect(cache.put).not.toHaveBeenCalled();
    });
    it('资源状态区分未下载、识别就绪、修补就绪，清除只删除本功能缓存', async () => {
        expect(await mangaOcrModelStatus()).toEqual({ready: false, bytes: 0, inpaintingReady: false, source: 'auto'});
        for (const asset of fixture.assets) files.set(fixture.root + asset.path, new Response(body(asset)));
        expect(await mangaOcrModelStatus()).toEqual({ready: true, bytes: 100, inpaintingReady: false, source: 'auto'});
        files.set(MANGA_INPAINT_ASSET.url, new Response(body(fixture.inpaint)));
        expect(await mangaOcrModelStatus()).toEqual({ready: true, bytes: 105, inpaintingReady: true, source: 'auto'});
        await removeMangaOcrAssets(); expect(caches.delete).toHaveBeenCalledOnce(); expect(caches.delete).toHaveBeenCalledWith(MANGA_OCR_CACHE);
    });
    it('LaMa 同样校验真实字节、复用完整缓存、删除损坏缓存', async () => {
        expect(new Uint8Array(await loadMangaInpaintAsset())).toEqual(body(fixture.inpaint));
        expect(fetch).toHaveBeenCalledWith(MANGA_INPAINT_ASSET.url, {signal: expect.any(AbortSignal), credentials: 'omit', referrerPolicy: 'no-referrer'});
        await loadMangaInpaintAsset(); expect(fetch).toHaveBeenCalledOnce();
        files.set(MANGA_INPAINT_ASSET.url, new Response(new Uint8Array(1)));
        await loadMangaInpaintAsset(); expect(cache.delete).toHaveBeenCalledWith(MANGA_INPAINT_ASSET.url);
    });
    it('LaMa 下载完成取消和缓存真实 digest 完成后的取消均不写入新结果', async () => {
        const abort = new AbortController();
        vi.mocked(fetch).mockImplementationOnce(async url => { abort.abort(); return responseFor(String(url)); });
        await expect(loadMangaInpaintAsset(abort.signal)).rejects.toMatchObject({name: 'AbortError'}); expect(cache.put).not.toHaveBeenCalled();
        files.set(MANGA_INPAINT_ASSET.url, new Response(body(fixture.inpaint)));
        const cachedAbort = new AbortController(); const digest = webcrypto.subtle.digest.bind(webcrypto.subtle);
        vi.spyOn(webcrypto.subtle, 'digest').mockImplementationOnce(async (...args) => {
            const value = await digest(...args); cachedAbort.abort(); return value;
        });
        await expect(loadMangaInpaintAsset(cachedAbort.signal)).rejects.toMatchObject({name: 'AbortError'});
        expect(cache.delete).not.toHaveBeenCalled(); expect(cache.put).not.toHaveBeenCalled();
    });
});
