/**
 * @file tests/localTtsModelCache.test.ts
 * 文件职责：验证本地 TTS 模型升级后的 preferred/legacy 缓存边界。
 * 主要内容：旧 q4f16 缓存不会被误判为新模型，也只在显式清除时与新模型一起删除。
 * 模块边界：使用内存 Cache Storage，不下载真实模型、不启动 Worker、不修改用户配置。
 */

import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    LOCAL_TTS_LEGACY_MODEL_FILES,
    LOCAL_TTS_MODEL_FILES,
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
