/**
 * @file tests/localTtsModelCache.test.ts
 * 文件职责：验证本地 TTS 模型升级后的 preferred/legacy 缓存边界。
 * 主要内容：流式下载只保存一份固定版本并回报合并后的真实字节进度，兼容旧 main 缓存且仅清理来源可证明的重复文件；旧 q4f16 不误判为新模型，显式清除保留其他模型。
 * 模块边界：使用内存 Cache Storage，不下载真实模型、不启动 Worker、不修改用户配置。
 */

import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    LOCAL_TTS_LEGACY_MODEL_FILES,
    LOCAL_TTS_MODEL_FILES,
    cacheLocalTtsModelFiles,
    LOCAL_TTS_VOICES,
    getLocalTtsModelFileUrl,
    getLocalTtsModelLoaderUrl,
    getLocalTtsVoiceCacheUrl,
    isLocalTtsModelCached,
    removeLocalTtsModelFiles,
} from '@/src/features/local-tts/offscreen/modelCache';
import {
    LOCAL_TTS_MODEL_CACHE_NAME,
    LOCAL_TTS_VOICE_CACHE_NAME,
} from '@/src/core/config/localTts';

type MemoryCache = {
    match: (request: RequestInfo | URL) => Promise<Response | undefined>;
    put: (request: RequestInfo | URL, response: Response) => Promise<void>;
    delete: (request: RequestInfo | URL) => Promise<boolean>;
};

function requestKey(request: RequestInfo | URL): string {
    return typeof request === 'string' ? request : request instanceof URL ? request.toString() : request.url;
}

function memoryCache(): MemoryCache {
    const entries = new Map<string, Response>();
    return {
        match: async (request) => entries.get(requestKey(request))?.clone(),
        put: async (request, response) => { entries.set(requestKey(request), response.clone()); },
        delete: async (request) => entries.delete(requestKey(request)),
    };
}

function installCaches(modelCache = memoryCache(), voiceCache = memoryCache()): {modelCache: MemoryCache; voiceCache: MemoryCache} {
    vi.stubGlobal('caches', {
        open: vi.fn(async (name: string) => name === LOCAL_TTS_MODEL_CACHE_NAME ? modelCache : voiceCache),
    });
    return {modelCache, voiceCache};
}

async function put(cache: MemoryCache, url: string): Promise<void> {
    await cache.put(url, new Response(new Uint8Array([1])));
}

async function putModelFiles(cache: MemoryCache, files: readonly string[]): Promise<void> {
    for (const file of files) {
        await put(cache, getLocalTtsModelFileUrl(file));
        await put(cache, getLocalTtsModelLoaderUrl(file));
    }
}

async function putVoices(cache: MemoryCache): Promise<void> {
    for (const voice of LOCAL_TTS_VOICES) await put(cache, getLocalTtsVoiceCacheUrl(voice));
}

afterEach(() => vi.unstubAllGlobals());

describe('local TTS model cache upgrade compatibility', () => {
    it('keeps legacy-only q4f16 caches available for explicit removal but reports the preferred model as missing', async () => {
        const {modelCache, voiceCache} = installCaches();
        await putModelFiles(modelCache, [
            ...LOCAL_TTS_MODEL_FILES.filter((file) => file !== 'onnx/model.onnx'),
            ...LOCAL_TTS_LEGACY_MODEL_FILES,
        ]);
        await putVoices(voiceCache);

        await expect(isLocalTtsModelCached()).resolves.toBe(false);
        expect(await modelCache.match(getLocalTtsModelFileUrl('onnx/model_q4f16.onnx'))).toBeDefined();
    });

    it('streams one pinned copy per resource, keeps old loader-only caches and prunes only a proven duplicate', async () => {
        const {modelCache, voiceCache} = installCaches();
        const fetcher=vi.fn(async()=>new Response(new Uint8Array([1,2,3])));
        vi.stubGlobal('fetch',fetcher);
        await cacheLocalTtsModelFiles();
        expect(await isLocalTtsModelCached()).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(LOCAL_TTS_MODEL_FILES.length+LOCAL_TTS_VOICES.length);
        for (const file of LOCAL_TTS_MODEL_FILES) {
            const pinned=getLocalTtsModelFileUrl(file),loader=getLocalTtsModelLoaderUrl(file);
            expect(await modelCache.match(pinned)).toBeDefined();
            expect(await modelCache.match(loader)).toBeUndefined();
            await modelCache.put(loader,new Response('old',{headers:{'X-FluentRead-Model-Source':pinned}}));
        }
        expect(await isLocalTtsModelCached()).toBe(true);
        for (const file of LOCAL_TTS_MODEL_FILES) expect(await modelCache.match(getLocalTtsModelLoaderUrl(file))).toBeUndefined();
        const file=LOCAL_TTS_MODEL_FILES[0];
        await modelCache.put(getLocalTtsModelLoaderUrl(file),new Response('legacy'));
        await isLocalTtsModelCached();
        expect(await modelCache.match(getLocalTtsModelLoaderUrl(file))).toBeDefined();
        await modelCache.delete(getLocalTtsModelFileUrl(file));
        expect(await isLocalTtsModelCached()).toBe(true);
        await cacheLocalTtsModelFiles();
        expect(fetcher).toHaveBeenCalledTimes(LOCAL_TTS_MODEL_FILES.length+LOCAL_TTS_VOICES.length);
        expect(await voiceCache.match(getLocalTtsVoiceCacheUrl(LOCAL_TTS_VOICES[0]!))).toBeDefined();
    });

    it('reports one combined byte progress for model and voice files and counts files already cached', async () => {
        const {modelCache} = installCaches();
        const fileCount = LOCAL_TTS_MODEL_FILES.length + LOCAL_TTS_VOICES.length;
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(10), {headers: {'Content-Length': '10'}})));
        const reports: Array<{loaded: number; total: number}> = [];
        await cacheLocalTtsModelFiles(progress => reports.push(progress));
        // 最后一个文件开始前按声明的 343 MB 计算，全部大小已知后改用精确合计。
        expect(reports[0]).toEqual({loaded: 0, total: 343_000_000});
        expect(reports.at(-1)).toEqual({loaded: fileCount * 10, total: fileCount * 10});
        expect(reports.every((item, index) => index === 0 || item.loaded >= reports[index - 1].loaded)).toBe(true);
        expect(reports.every(item => item.loaded <= item.total)).toBe(true);

        // 只缺一个文件时，其余文件按缓存里的大小计入已完成部分。
        await modelCache.delete(getLocalTtsModelFileUrl('config.json'));
        const resumed: Array<{loaded: number; total: number}> = [];
        await cacheLocalTtsModelFiles(progress => resumed.push(progress));
        expect(fetch).toHaveBeenCalledTimes(fileCount + 1);
        expect(resumed.at(-1)).toEqual({loaded: fileCount * 10, total: fileCount * 10});
    });

    it('clears preferred and legacy model keys without deleting another model', async () => {
        const {modelCache, voiceCache} = installCaches();
        await putModelFiles(modelCache, [...LOCAL_TTS_MODEL_FILES, ...LOCAL_TTS_LEGACY_MODEL_FILES]);
        await put(modelCache, getLocalTtsModelFileUrl('onnx/model_q8.onnx'));
        await put(modelCache, getLocalTtsModelLoaderUrl('onnx/model_q8.onnx'));
        await putVoices(voiceCache);

        await removeLocalTtsModelFiles();

        for (const file of [...LOCAL_TTS_MODEL_FILES, ...LOCAL_TTS_LEGACY_MODEL_FILES]) {
            await expect(modelCache.match(getLocalTtsModelFileUrl(file))).resolves.toBeUndefined();
            await expect(modelCache.match(getLocalTtsModelLoaderUrl(file))).resolves.toBeUndefined();
        }
        await expect(modelCache.match(getLocalTtsModelFileUrl('onnx/model_q8.onnx'))).resolves.toBeDefined();
        await expect(modelCache.match(getLocalTtsModelLoaderUrl('onnx/model_q8.onnx'))).resolves.toBeDefined();
        for (const voice of LOCAL_TTS_VOICES) {
            await expect(voiceCache.match(getLocalTtsVoiceCacheUrl(voice))).resolves.toBeUndefined();
        }
        expect(LOCAL_TTS_VOICE_CACHE_NAME).toBe('kokoro-voices');
    });
});
