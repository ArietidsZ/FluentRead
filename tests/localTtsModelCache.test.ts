/**
 * @file tests/localTtsModelCache.test.ts
 * 文件职责：验证本地 TTS 固定版本单份缓存、流式写入和可信旧别名迁移。
 * 主要内容：核对来源、失败重试和所有权等待，拒绝旧版本及部分文件，明确清除不影响其他模型。
 * 模块边界：使用内存 Cache Storage，不下载真实模型、不启动 Worker、不修改用户配置。
 */

import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    cacheLocalTtsModelFiles,
    verifyLocalTtsModelResponse,
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
    LOCAL_TTS_MODEL_REVISION,
    LOCAL_TTS_VOICE_CACHE_NAME,
} from '@/src/core/config/localTts';

type MemoryCache = {
    match: (request: RequestInfo | URL) => Promise<Response | undefined>;
    put: (request: RequestInfo | URL, response: Response) => Promise<void>;
    delete: (request: RequestInfo | URL) => Promise<boolean>;
    keys: () => Promise<Request[]>;
};

function requestKey(request: RequestInfo | URL): string {
    return typeof request === 'string' ? request : request instanceof URL ? request.toString() : request.url;
}

function memoryCache(): MemoryCache {
    const entries = new Map<string, Response>();
    return {
        match: async (request) => entries.get(requestKey(request))?.clone(),
        put: async (request, response) => {
            const bytes = await response.arrayBuffer();
            entries.set(requestKey(request), new Response(bytes, {status: response.status, statusText: response.statusText, headers: response.headers}));
        },
        delete: async (request) => entries.delete(requestKey(request)),
        keys: async () => [...entries.keys()].map(url => new Request(url)),
    };
}

function installCaches(modelCache = memoryCache(), voiceCache = memoryCache()): {modelCache: MemoryCache; voiceCache: MemoryCache} {
    vi.stubGlobal('caches', {
        open: vi.fn(async (name: string) => name === LOCAL_TTS_MODEL_CACHE_NAME ? modelCache : voiceCache),
    });
    return {modelCache, voiceCache};
}

async function put(cache: MemoryCache, url: string): Promise<void> {
    await cache.put(url, new Response(new Uint8Array([1]), {headers: {
        'X-FluentRead-Model-Source': url.replace('/resolve/main/', `/resolve/${LOCAL_TTS_MODEL_REVISION}/`),
    }}));
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

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('local TTS model cache upgrade compatibility', () => {
    it('stores each model once using its pinned URL without reading the fetch body into a JavaScript buffer', async () => {
        const {modelCache} = installCaches();
        vi.stubGlobal('self', globalThis);
        const reads: ReturnType<typeof vi.spyOn>[] = [];
        vi.stubGlobal('fetch', vi.fn(async () => {
            const response = new Response(new Uint8Array(128 * 1024));
            reads.push(vi.spyOn(response, 'arrayBuffer'));
            return response;
        }));
        await cacheLocalTtsModelFiles();
        expect((await modelCache.keys()).map(key => key.url).sort()).toEqual(LOCAL_TTS_MODEL_FILES.map(getLocalTtsModelFileUrl).sort());
        expect(reads.every(read => read.mock.calls.length === 0)).toBe(true);
        let bytes = 0;
        for (const key of await modelCache.keys()) bytes += (await (await modelCache.match(key))!.arrayBuffer()).byteLength;
        expect(bytes).toBe(LOCAL_TTS_MODEL_FILES.length * 128 * 1024);
    });

    it.each([undefined, 'https://huggingface.co/other/revision/model.onnx'])('never promotes legacy bytes without current pinned provenance (%s)', async source => {
        const {modelCache, voiceCache} = installCaches();
        vi.stubGlobal('self', globalThis);
        for (const file of LOCAL_TTS_MODEL_FILES) await modelCache.put(getLocalTtsModelLoaderUrl(file), new Response('stale', {
            headers: source ? {'X-FluentRead-Model-Source': source} : {},
        }));
        await putVoices(voiceCache);
        expect(await isLocalTtsModelCached()).toBe(false);
        const fetchMock = vi.fn(async () => new Response('current'));
        vi.stubGlobal('fetch', fetchMock);
        await cacheLocalTtsModelFiles();
        expect(fetchMock).toHaveBeenCalledTimes(LOCAL_TTS_MODEL_FILES.length);
        for (const file of LOCAL_TTS_MODEL_FILES) {
            expect(await (await modelCache.match(getLocalTtsModelFileUrl(file)))!.text()).toBe('current');
            expect(await modelCache.match(getLocalTtsModelLoaderUrl(file))).toBeUndefined();
        }
    });

    it('keeps verified legacy files usable if migration cannot write, then migrates on retry', async () => {
        const {modelCache, voiceCache} = installCaches();
        for (const file of LOCAL_TTS_MODEL_FILES) await put(modelCache, getLocalTtsModelLoaderUrl(file));
        await putVoices(voiceCache);
        const write = modelCache.put;
        modelCache.put = vi.fn(async () => {throw new Error('quota');});
        vi.stubGlobal('fetch', vi.fn());
        await expect(cacheLocalTtsModelFiles()).rejects.toThrow('quota');
        expect(await isLocalTtsModelCached()).toBe(true);
        for (const file of LOCAL_TTS_MODEL_FILES) {
            expect(await modelCache.match(getLocalTtsModelFileUrl(file))).toBeUndefined();
            expect(await modelCache.match(getLocalTtsModelLoaderUrl(file))).toBeDefined();
        }
        modelCache.put = write;
        await cacheLocalTtsModelFiles();
        expect((await modelCache.keys()).map(key => key.url).sort()).toEqual(LOCAL_TTS_MODEL_FILES.map(getLocalTtsModelFileUrl).sort());
        expect(fetch).not.toHaveBeenCalled();
    });

    it('does not trust a pinned entry without provenance left by an older alias promotion', async () => {
        const {modelCache, voiceCache} = installCaches();
        for (const file of LOCAL_TTS_MODEL_FILES) await modelCache.put(getLocalTtsModelFileUrl(file), new Response('unknown'));
        await putVoices(voiceCache);
        expect(await isLocalTtsModelCached()).toBe(false);
    });

    it.each(['failure', 'timeout'])('does not commit a partial body after stream %s and supports retry', async failure => {
        const {modelCache} = installCaches();
        vi.stubGlobal('self', globalThis);
        vi.useFakeTimers();
        let started!: () => void;
        const receiving = new Promise<void>(resolve => {started = resolve;});
        const fetchMock = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => new Response('complete'));
        fetchMock.mockImplementationOnce(async (_url, options) => new Response(new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array([1])); started();
                if (failure === 'failure') controller.error(new Error('broken body'));
                else options!.signal!.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), {once: true});
            },
        })));
        vi.stubGlobal('fetch', fetchMock);
        const failed = expect(cacheLocalTtsModelFiles()).rejects.toThrow(failure === 'failure' ? 'broken body' : '超过');
        await receiving;
        if (failure === 'timeout') await vi.advanceTimersByTimeAsync(300_000);
        await failed;
        expect(await modelCache.keys()).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
        await removeLocalTtsModelFiles();
        await cacheLocalTtsModelFiles();
        expect(await isLocalTtsModelCached()).toBe(true);
    });

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

    it('refuses removal during a download so a reported clear cannot be repopulated by its late response', async () => {
        const {modelCache, voiceCache} = installCaches();
        vi.stubGlobal('self', globalThis);
        let release!: (response: Response) => void;
        let started!: () => void;
        const fetching = new Promise<void>(resolve => { started = resolve; });
        const fetchMock = vi.fn(async () => new Response(new Uint8Array([1])));
        fetchMock.mockImplementationOnce(() => { started(); return new Promise(resolve => { release = resolve; }); });
        vi.stubGlobal('fetch', fetchMock);
        const pending = cacheLocalTtsModelFiles();
        await fetching;
        expect(cacheLocalTtsModelFiles()).toBe(pending);
        expect(fetchMock).toHaveBeenCalledOnce();
        try {
            await expect(removeLocalTtsModelFiles()).rejects.toThrow('下载');
        } finally {
            release(new Response(new Uint8Array([1])));
            await pending;
        }
        expect(await isLocalTtsModelCached()).toBe(true);
        await removeLocalTtsModelFiles();
        expect(await isLocalTtsModelCached()).toBe(false);
        for (const file of LOCAL_TTS_MODEL_FILES) {
            expect(await modelCache.match(getLocalTtsModelFileUrl(file))).toBeUndefined();
            expect(await modelCache.match(getLocalTtsModelLoaderUrl(file))).toBeUndefined();
        }
        for (const voice of LOCAL_TTS_VOICES) expect(await voiceCache.match(getLocalTtsVoiceCacheUrl(voice))).toBeUndefined();
    });

    it('owns removal before opening storage and blocks downloads and duplicate removals until it finishes', async () => {
        const {modelCache} = installCaches();
        vi.stubGlobal('self', globalThis);
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]))));
        let release!: () => void;
        vi.mocked(caches.open).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(modelCache as unknown as Cache); }));
        const removing = removeLocalTtsModelFiles();
        try {
            await expect(cacheLocalTtsModelFiles()).rejects.toThrow('正在清除');
            await expect(removeLocalTtsModelFiles()).rejects.toThrow('正在清除');
            expect(fetch).not.toHaveBeenCalled();
        } finally { release(); await removing; }
        await cacheLocalTtsModelFiles();
        expect(await isLocalTtsModelCached()).toBe(true);
    });

    it('waits for every deletion after an error before releasing removal ownership', async () => {
        const {modelCache} = installCaches();
        vi.stubGlobal('self', globalThis);
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]))));
        let release!: () => void;
        modelCache.delete = vi.fn(modelCache.delete)
            .mockRejectedValueOnce(new Error('disk failure'))
            .mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(true); }));
        const removing = removeLocalTtsModelFiles();
        const failed = expect(removing).rejects.toThrow('disk failure');
        for (let index = 0; index < 8; index++) await Promise.resolve();
        try {
            await expect(cacheLocalTtsModelFiles()).rejects.toThrow('正在清除');
            expect(fetch).not.toHaveBeenCalled();
        } finally { release(); await failed; }
        await cacheLocalTtsModelFiles();
        expect(await isLocalTtsModelCached()).toBe(true);
        await removeLocalTtsModelFiles();
        expect(await isLocalTtsModelCached()).toBe(false);
    });

    it('waits for an existing status alias repair and blocks new repairs while clearing', async () => {
        const {modelCache, voiceCache} = installCaches();
        for (const file of LOCAL_TTS_MODEL_FILES) await put(modelCache, getLocalTtsModelLoaderUrl(file));
        await putVoices(voiceCache);
        let release!: () => void;
        let started!: () => void;
        const repairing = new Promise<void>(resolve => { started = resolve; });
        const putFile = modelCache.put;
        modelCache.put = vi.fn(putFile).mockImplementationOnce(async (key, response) => {
            started();
            await new Promise<void>(resolve => { release = resolve; });
            await putFile(key, response);
        });
        const status = isLocalTtsModelCached();
        await repairing;
        const sameStatus = isLocalTtsModelCached();
        const deleted = vi.spyOn(modelCache, 'delete');
        const removing = removeLocalTtsModelFiles();
        try {
            expect(sameStatus).toBe(status);
            expect(await isLocalTtsModelCached()).toBe(false);
            expect(deleted.mock.calls.every(([key]) => requestKey(key).includes('/resolve/main/'))).toBe(true);
        } finally { release(); await status; await removing; }
        for (const file of LOCAL_TTS_MODEL_FILES) {
            expect(await modelCache.match(getLocalTtsModelFileUrl(file))).toBeUndefined();
            expect(await modelCache.match(getLocalTtsModelLoaderUrl(file))).toBeUndefined();
        }
        expect(await isLocalTtsModelCached()).toBe(false);
    });

    it('keeps failed status ownership until sibling alias writes settle', async () => {
        const {modelCache, voiceCache} = installCaches();
        for (const file of LOCAL_TTS_MODEL_FILES) await put(modelCache, getLocalTtsModelLoaderUrl(file));
        await putVoices(voiceCache);
        let release!: () => void;
        let started!: () => void;
        const repairing = new Promise<void>(resolve => { started = resolve; });
        const putFile = modelCache.put, matchFile = modelCache.match;
        modelCache.put = vi.fn(putFile).mockImplementationOnce(async (key, response) => {
            started(); await new Promise<void>(resolve => { release = resolve; }); await putFile(key, response);
        });
        modelCache.match = vi.fn(async key => {
            if (requestKey(key).endsWith('/tokenizer.json')) throw new Error('status read failure');
            return matchFile(key);
        });
        const status = isLocalTtsModelCached();
        const failed = expect(status).rejects.toThrow('status read failure');
        await repairing;
        const deleted = vi.spyOn(modelCache, 'delete');
        const removing = removeLocalTtsModelFiles();
        try {
            for (let index = 0; index < 8; index++) await Promise.resolve();
            expect(deleted.mock.calls.every(([key]) => requestKey(key).includes('/resolve/main/'))).toBe(true);
        } finally { release(); await failed; await removing; }
        modelCache.match = matchFile;
        expect(await isLocalTtsModelCached()).toBe(false);
    });

    it('releases removal ownership when opening cache storage fails', async () => {
        installCaches();
        vi.stubGlobal('self', globalThis);
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]))));
        vi.mocked(caches.open).mockRejectedValueOnce(new Error('storage unavailable'));
        await expect(removeLocalTtsModelFiles()).rejects.toThrow('storage unavailable');
        await cacheLocalTtsModelFiles();
        await removeLocalTtsModelFiles();
        expect(await isLocalTtsModelCached()).toBe(false);
    });

    it.each(['network failure', 'timeout'])('releases download ownership after %s so removal and a new download can proceed', async (failure) => {
        const {modelCache} = installCaches();
        vi.stubGlobal('self', globalThis);
        const unrelated = getLocalTtsModelFileUrl('onnx/model_q8.onnx');
        await put(modelCache, unrelated);
        let started!: () => void;
        const fetching = new Promise<void>(resolve => { started = resolve; });
        const fetchMock = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => new Response(new Uint8Array([1])));
        fetchMock.mockImplementationOnce((_url, options) => {
            started();
            if (failure === 'network failure') return Promise.reject(new Error('offline'));
            return new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), {once: true}));
        });
        vi.stubGlobal('fetch', fetchMock);
        vi.useFakeTimers();
        const pending = cacheLocalTtsModelFiles();
        const rejected = expect(pending).rejects.toThrow(failure === 'timeout' ? '超过' : 'offline');
        await fetching;
        if (failure === 'timeout') await vi.advanceTimersByTimeAsync(300_000);
        await rejected;
        expect(vi.getTimerCount()).toBe(0);
        await removeLocalTtsModelFiles();
        expect(await modelCache.match(unrelated)).toBeDefined();
        const retry = cacheLocalTtsModelFiles();
        expect(retry).not.toBe(pending);
        await retry;
        expect(await isLocalTtsModelCached()).toBe(true);
    });

    it('migrates provenance-verified legacy aliases once and reuses pinned files without downloading', async () => {
        const {modelCache, voiceCache} = installCaches();
        vi.stubGlobal('fetch', vi.fn());
        for (const file of LOCAL_TTS_MODEL_FILES) await put(modelCache, getLocalTtsModelLoaderUrl(file));
        await putVoices(voiceCache);
        await cacheLocalTtsModelFiles();
        for (const file of LOCAL_TTS_MODEL_FILES) {
            expect(await modelCache.match(getLocalTtsModelFileUrl(file))).toBeDefined();
            expect(await modelCache.match(getLocalTtsModelLoaderUrl(file))).toBeUndefined();
        }
        expect(await isLocalTtsModelCached()).toBe(true);
        await cacheLocalTtsModelFiles();
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each([new Response(null, {status: 503}), 'offline'])('reports HTTP and non-Error failures and releases ownership', async (failure) => {
        installCaches();
        vi.stubGlobal('self', globalThis);
        vi.stubGlobal('fetch', vi.fn(async () => { if (typeof failure === 'string') throw failure; return failure; }));
        await expect(cacheLocalTtsModelFiles()).rejects.toThrow(typeof failure === 'string' ? 'offline' : '503');
        await expect(removeLocalTtsModelFiles()).resolves.toBeUndefined();
    });

    it('reports unavailable cache storage without claiming that a model is ready', async () => {
        vi.stubGlobal('caches', undefined);
        expect(await isLocalTtsModelCached()).toBe(false);
        await expect(cacheLocalTtsModelFiles()).rejects.toThrow('不支持');
        await expect(removeLocalTtsModelFiles()).rejects.toThrow('不支持');
    });

    it('clears preferred and legacy model keys without deleting another model', async () => {
        const {modelCache, voiceCache} = installCaches();
        await putModelFiles(modelCache, [...LOCAL_TTS_MODEL_FILES, ...LOCAL_TTS_LEGACY_MODEL_FILES]);
        const otherModel = 'https://huggingface.co/example/other-model/resolve/main/onnx/model.onnx';
        await put(modelCache, otherModel);
        await put(modelCache, getLocalTtsModelFileUrl('onnx/model_q8.onnx'));
        await put(modelCache, getLocalTtsModelLoaderUrl('onnx/model_q8.onnx'));
        await putVoices(voiceCache);

        await removeLocalTtsModelFiles();

        for (const file of [...LOCAL_TTS_MODEL_FILES, ...LOCAL_TTS_LEGACY_MODEL_FILES]) {
            await expect(modelCache.match(getLocalTtsModelFileUrl(file))).resolves.toBeUndefined();
            await expect(modelCache.match(getLocalTtsModelLoaderUrl(file))).resolves.toBeUndefined();
        }
        await expect(modelCache.match(otherModel)).resolves.toBeDefined();
        await expect(modelCache.match(getLocalTtsModelFileUrl('onnx/model_q8.onnx'))).resolves.toBeDefined();
        await expect(modelCache.match(getLocalTtsModelLoaderUrl('onnx/model_q8.onnx'))).resolves.toBeDefined();
        for (const voice of LOCAL_TTS_VOICES) {
            await expect(voiceCache.match(getLocalTtsVoiceCacheUrl(voice))).resolves.toBeUndefined();
        }
        expect(LOCAL_TTS_VOICE_CACHE_NAME).toBe('kokoro-voices');
    });
});


const exactConfig = '{\n  "model_type": "style_text_to_speech_2"\n}';

describe('legacy cache streaming integrity recovery', () => {
    it.each(['pinned', 'main'])('recovers exact %s bytes without a download', async alias => {
        const {modelCache, voiceCache} = installCaches();
        await putModelFiles(modelCache, LOCAL_TTS_MODEL_FILES.slice(1));
        await putVoices(voiceCache);
        const url = alias === 'main' ? getLocalTtsModelLoaderUrl('config.json') : getLocalTtsModelFileUrl('config.json');
        await modelCache.put(url, new Response(exactConfig));
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        await expect(isLocalTtsModelCached()).resolves.toBe(true);
        const saved = await modelCache.match(getLocalTtsModelFileUrl('config.json'));
        expect(await saved!.text()).toBe(exactConfig);
        expect(saved!.headers.get('X-FluentRead-Model-Source')).toBe(getLocalTtsModelFileUrl('config.json'));
        expect(await modelCache.match(getLocalTtsModelLoaderUrl('config.json'))).toBeUndefined();
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each(['write', 'delete'])('retains valid legacy data when %s fails after verification', async operation => {
        const {modelCache, voiceCache} = installCaches();
        await putModelFiles(modelCache, LOCAL_TTS_MODEL_FILES.slice(1)); await putVoices(voiceCache);
        await modelCache.put(getLocalTtsModelLoaderUrl('config.json'), new Response(exactConfig));
        const method = operation === 'write'
            ? vi.spyOn(modelCache, 'put').mockImplementation(async (_url, response) => {await response.arrayBuffer(); throw new Error('quota');})
            : vi.spyOn(modelCache, 'delete').mockRejectedValue(new Error('delete failed'));
        await expect(cacheLocalTtsModelFiles()).rejects.toThrow(operation === 'write' ? 'quota' : 'delete failed');
        await expect(isLocalTtsModelCached()).resolves.toBe(true);
        expect(await modelCache.match(getLocalTtsModelLoaderUrl('config.json'))).toBeDefined();
        method.mockRestore();
    });

    it('rejects missing bodies, errors and unknown fixed files without hashing', async () => {
        const url = getLocalTtsModelFileUrl('config.json');
        expect(verifyLocalTtsModelResponse(url, new Response(null))).toBeUndefined();
        expect(verifyLocalTtsModelResponse(url, new Response('error', {status: 500}))).toBeUndefined();
        expect(verifyLocalTtsModelResponse(url + '.unknown', new Response(exactConfig))).toBeUndefined();
        const {modelCache, voiceCache} = installCaches();
        await putModelFiles(modelCache, LOCAL_TTS_MODEL_FILES.slice(1)); await putVoices(voiceCache);
        await modelCache.put(url, new Response('error', {status: 500}));
        await expect(isLocalTtsModelCached()).resolves.toBe(false);
    });

    it('holds removal ownership until the delayed hash writer settles', async () => {
        const {modelCache, voiceCache} = installCaches();
        await putModelFiles(modelCache, LOCAL_TTS_MODEL_FILES.slice(1)); await putVoices(voiceCache);
        const match = modelCache.match;
        let producer!: ReadableStreamDefaultController<Uint8Array>;
        let entered!: () => void;
        const started = new Promise<void>(resolve => {entered = resolve;});
        vi.spyOn(modelCache, 'match').mockImplementation(async request => {
            if (requestKey(request) === getLocalTtsModelLoaderUrl('config.json')) {
                return new Response(new ReadableStream<Uint8Array>({start(controller) {producer = controller; entered();}}));
            }
            return match(request);
        });
        const status = isLocalTtsModelCached(); await started;
        const deleted = vi.spyOn(modelCache, 'delete');
        const removal = removeLocalTtsModelFiles();
        await Promise.resolve();
        expect(deleted.mock.calls.every(([url]) => requestKey(url).includes('/resolve/main/'))).toBe(true);
        producer.enqueue(new TextEncoder().encode(exactConfig)); producer.close();
        await expect(status).resolves.toBe(true); await removal;
        expect(await match(getLocalTtsModelFileUrl('config.json'))).toBeUndefined();
    });

    it('keeps exact legacy bytes available after an early quota failure', async () => {
        const {modelCache, voiceCache} = installCaches();
        await putModelFiles(modelCache, LOCAL_TTS_MODEL_FILES.slice(1)); await putVoices(voiceCache);
        await modelCache.put(getLocalTtsModelLoaderUrl('config.json'), new Response(exactConfig));
        const put = vi.spyOn(modelCache, 'put').mockRejectedValue(new DOMException('full', 'QuotaExceededError'));
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        await expect(cacheLocalTtsModelFiles()).rejects.toThrow('full');
        expect(fetch).not.toHaveBeenCalled();
        await expect(isLocalTtsModelCached()).resolves.toBe(true);
        expect(await modelCache.match(getLocalTtsModelFileUrl('config.json'))).toBeUndefined();
        expect(await (await modelCache.match(getLocalTtsModelLoaderUrl('config.json')))!.text()).toBe(exactConfig);
        put.mockRestore();
        await expect(isLocalTtsModelCached()).resolves.toBe(true);
        expect(await modelCache.match(getLocalTtsModelLoaderUrl('config.json'))).toBeUndefined();
    });

    it.each([exactConfig.slice(1), exactConfig + ' ', exactConfig.replace('style', 'stale')])('rejects wrong size or digest atomically', async text => {
        const cache = memoryCache();
        const url = getLocalTtsModelFileUrl('config.json');
        await cache.put(url, new Response('previous'));
        const source = new Response(text);
        const check = verifyLocalTtsModelResponse(url, source)!;
        await expect(cache.put(url, check.response)).rejects.toThrow('LOCAL_TTS_CACHE_INTEGRITY');
        await check.completed.catch(() => undefined);
        expect(check.verified()).toBe(false);
        expect(source.body!.locked).toBe(false);
        expect(await (await cache.match(url))!.text()).toBe('previous');
    });

    it('hashes arbitrary chunk boundaries with no clone or whole-body read', async () => {
        const bytes = new TextEncoder().encode(exactConfig);
        const source = new Response(new ReadableStream({start(controller) {
            for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
            controller.close();
        }}));
        const clone = vi.spyOn(source, 'clone'); const buffer = vi.spyOn(source, 'arrayBuffer');
        const check = verifyLocalTtsModelResponse(getLocalTtsModelFileUrl('config.json'), source)!;
        expect(await check.response.text()).toBe(exactConfig);
        await check.completed;
        expect(check.verified()).toBe(true);
        expect(clone).not.toHaveBeenCalled(); expect(buffer).not.toHaveBeenCalled();
        expect(source.body!.locked).toBe(false);
    });

    it('times out with a locked consumer that never reads', async () => {
        vi.useFakeTimers();
        const source = new Response(exactConfig);
        const check = verifyLocalTtsModelResponse(getLocalTtsModelFileUrl('config.json'), source)!;
        const reader = check.response.body!.getReader();
        const closed = expect(reader.closed).rejects.toBeDefined();
        const completed = expect(check.completed).rejects.toBeDefined();
        await vi.advanceTimersByTimeAsync(300_001);
        await closed; await completed;
        expect(source.body!.locked).toBe(false);
        expect(check.verified()).toBe(false);
        reader.releaseLock();
    });

    it.each(['cancel', 'timeout', 'source error'])('releases source ownership on %s', async mode => {
        vi.useFakeTimers();
        const cancel = vi.fn();
        let producer!: ReadableStreamDefaultController<Uint8Array>;
        const source = new Response(new ReadableStream<Uint8Array>({start(controller) {producer = controller;}, cancel}));
        const check = verifyLocalTtsModelResponse(getLocalTtsModelFileUrl('config.json'), source)!;
        if (mode === 'cancel') await check.response.body!.cancel();
        else {
            const reading = check.response.text();
            const rejected = expect(reading).rejects.toBeDefined();
            if (mode === 'timeout') await vi.advanceTimersByTimeAsync(300_001);
            else producer.error(new Error('source failed'));
            await rejected;
        }
        await check.completed.catch(() => undefined);
        expect(check.verified()).toBe(false);
        expect(source.body!.locked).toBe(false);
        if (mode !== 'source error') expect(cancel).toHaveBeenCalledOnce();
    });
});
