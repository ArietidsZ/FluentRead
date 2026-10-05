import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {LOCAL_TTS_MODEL_REPOSITORY, LOCAL_TTS_MODEL_REVISION, LOCAL_TTS_VOICE_PATH} from '@/src/core/config/localTts';

const mocks = vi.hoisted(() => ({
    model: vi.fn(), nativeFetch: vi.fn(),
    env: {fetch: undefined as typeof fetch | undefined, useBrowserCache: true, useWasmCache: true,
        allowLocalModels: true, allowRemoteModels: true, backends: {onnx: {wasm: {}}}},
}));
vi.mock('@uzen/kokoro-js', () => ({
    KokoroTTS: class {
        static from_pretrained = mocks.model;
        constructor(model: unknown, tokenizer: unknown) { Object.assign(this, {model, tokenizer}); }
    },
    TextSplitterStream: class {}, // This suite prepares models but never synthesizes speech.
    env: {},
}));
vi.mock('@huggingface/transformers-kokoro', () => ({env: mocks.env}));
vi.mock('@/src/shared/onnx/webgpu', () => ({probeWebGpu: async () => ({available: false})}));
vi.mock('@/src/shared/onnx/wasmBinary', () => ({configureOnnxWasmBackend: vi.fn(),
    withCompressedWasmBinary: async (_backend: unknown, _url: string, initialize: () => Promise<unknown>) => initialize()}));
const pinned = `https://huggingface.co/${LOCAL_TTS_MODEL_REPOSITORY}/resolve/${LOCAL_TTS_MODEL_REVISION}/config.json`;
const main = pinned.replace(LOCAL_TTS_MODEL_REVISION, 'main');
const modelEntries = new Map<string, Response>(), voiceEntries = new Map<string, Response>();
const originalFetch = globalThis.fetch;
const require = createRequire(import.meta.url);
const sdk = resolve(dirname(require.resolve('@huggingface/transformers-kokoro')), '..');
const {env: sdkEnv} = await import(/* @vite-ignore */ pathToFileURL(resolve(sdk, 'src/env.js')).href);
const {getModelFile} = await import(/* @vite-ignore */ pathToFileURL(resolve(sdk, 'src/utils/hub.js')).href);
function modelResponse(text: string, source = pinned) {
    return new Response(text, {headers: {'X-FluentRead-Model-Source': source}});
}
async function configure() {
    const scope = {location: {href: 'chrome-extension://fixture/offscreen.html'},
        postMessage: vi.fn(), onmessage: undefined as ((event: MessageEvent) => void) | undefined};
    vi.stubGlobal('self', scope);
    const {startLocalTtsWorker} = await import('@/src/features/local-tts/offscreen/tts.worker');
    startLocalTtsWorker();
    scope.onmessage!({data: {requestId: 1, type: 'prepare', execution: 'compatible'}} as MessageEvent);
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledOnce());
    expect(scope.postMessage.mock.calls[0][0]).toMatchObject({success: true});
    return mocks.env.fetch!;
}
beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks(); modelEntries.clear(); voiceEntries.clear();
    mocks.env.useBrowserCache = true; mocks.env.fetch = undefined;
    mocks.model.mockResolvedValue({model: {dispose: vi.fn()}, tokenizer: vi.fn(() => ({input_ids: {dims: [1, 4]}}))});
    mocks.nativeFetch.mockImplementation(async () => new Response('runtime'));
    vi.stubGlobal('fetch', mocks.nativeFetch);
    vi.stubGlobal('caches', {open: vi.fn(async (name: string) => ({
        match: async (key: string) => (name === 'kokoro-voices' ? voiceEntries : modelEntries).get(key)?.clone(),
        put: async (key: string, response: Response) => {
            const bytes = await response.arrayBuffer();
            (name === 'kokoro-voices' ? voiceEntries : modelEntries).set(key, new Response(bytes, {headers: response.headers}));
        },
    }))});
});
afterEach(() => {globalThis.fetch = originalFetch; vi.unstubAllGlobals();});

describe('Kokoro canonical cache policy', () => {
    it('disables the native SDK browser-cache writer while retaining offline fetch', async () => {
        await configure();
        expect(mocks.env.useBrowserCache).toBe(false);
        expect(globalThis.fetch).toBe(mocks.env.fetch);
        expect(mocks.nativeFetch).not.toHaveBeenCalled();
    });
    it('the installed SDK reuses offline pinned bytes without recreating main; enabling its cache reproduces duplication', async () => {
        modelEntries.set(pinned, modelResponse('{"fixture":true}'));
        const offlineFetch = await configure();
        const env = sdkEnv;
        const saved = {useBrowserCache: env.useBrowserCache, useFSCache: env.useFSCache,
            allowLocalModels: env.allowLocalModels, allowRemoteModels: env.allowRemoteModels, fetch: env.fetch};
        try {
            Object.assign(env, {useBrowserCache: mocks.env.useBrowserCache, useFSCache: false,
                allowLocalModels: false, allowRemoteModels: true, fetch: offlineFetch});
            const result = await getModelFile(LOCAL_TTS_MODEL_REPOSITORY, 'config.json', true, {revision: 'main'});
            expect(new TextDecoder().decode(result)).toBe('{"fixture":true}');
            expect(modelEntries.has(main)).toBe(false);
            env.useBrowserCache = true;
            const control = await getModelFile(LOCAL_TTS_MODEL_REPOSITORY, 'config.json', true, {revision: 'main'});
            expect(new TextDecoder().decode(control)).toBe('{"fixture":true}');
            expect(modelEntries.has(main)).toBe(true);
            expect(mocks.nativeFetch).not.toHaveBeenCalled();
        } finally {Object.assign(env, saved);}
    });
    it.each(['string', 'URL', 'Request'])('prefers current pinned bytes over stale main for %s inputs', async kind => {
        modelEntries.set(main, modelResponse('stale'));
        modelEntries.set(pinned, modelResponse('current'));
        const offlineFetch = await configure();
        const input = kind === 'string' ? main : kind === 'URL' ? new URL(main) : new Request(main);
        expect(await (await offlineFetch(input)).text()).toBe('current');
        expect(mocks.nativeFetch).not.toHaveBeenCalled();
    });
    it('retains offline compatibility with provenance-verified legacy main files', async () => {
        modelEntries.set(main, modelResponse('verified legacy'));
        const offlineFetch = await configure();
        expect(await (await offlineFetch(main)).text()).toBe('verified legacy');
        expect(await (await offlineFetch(pinned)).text()).toBe('verified legacy');
        expect(mocks.nativeFetch).not.toHaveBeenCalled();
    });
    it('reads exact unprovenanced legacy bytes offline without adding a second cache key', async () => {
        const exact = '{\n  "model_type": "style_text_to_speech_2"\n}';
        modelEntries.set(main, new Response(exact));
        const offlineFetch = await configure();
        expect(await (await offlineFetch(main)).text()).toBe(exact);
        expect(modelEntries.has(pinned)).toBe(false);
        expect(mocks.nativeFetch).not.toHaveBeenCalled();
    });
    it('falls back to exact legacy bytes when corrupt pinned bytes could not be replaced', async () => {
        const exact = '{\n  "model_type": "style_text_to_speech_2"\n}';
        modelEntries.set(pinned, new Response('corrupt pinned'));
        modelEntries.set(main, new Response(exact));
        const offlineFetch = await configure();
        expect(await (await offlineFetch(main)).text()).toBe(exact);
        expect(await modelEntries.get(pinned)!.clone().text()).toBe('corrupt pinned');
        expect(mocks.nativeFetch).not.toHaveBeenCalled();
    });
    it.each([undefined, 'old-revision'])('rejects unverified or differently pinned legacy bytes (%s) without network fallback', async source => {
        modelEntries.set(main, source ? modelResponse('stale', pinned.replace(LOCAL_TTS_MODEL_REVISION, source)) : new Response('unknown'));
        const offlineFetch = await configure();
        await expect(offlineFetch(main).then(response => response.arrayBuffer())).rejects.toThrow('LOCAL_TTS_CACHE_INTEGRITY');
        expect(mocks.nativeFetch).not.toHaveBeenCalled();
    });
    it.each([new Response(null), new Response('error', {status: 500})])('rejects unusable cached responses without network access', async response => {
        modelEntries.set(pinned, response);
        const offlineFetch = await configure();
        await expect(offlineFetch(main)).rejects.toThrow('缓存缺少模型文件');
        expect(mocks.nativeFetch).not.toHaveBeenCalled();
    });
    it('rechecks bytes changed between validation and consumption', async () => {
        const entry = new Response('{\n  "model_type": "style_text_to_speech_2"\n}');
        const clone = entry.clone.bind(entry);
        vi.spyOn(entry, 'clone').mockImplementationOnce(clone).mockImplementation(() => new Response('changed'));
        modelEntries.set(main, entry);
        const offlineFetch = await configure();
        await expect(offlineFetch(main).then(response => response.text())).rejects.toThrow('LOCAL_TTS_CACHE_INTEGRITY');
        expect(mocks.nativeFetch).not.toHaveBeenCalled();
    });
    it('does not accept another revision even if an entry is present', async () => {
        const other = pinned.replace(LOCAL_TTS_MODEL_REVISION, 'another-revision');
        modelEntries.set(other, modelResponse('other', other));
        const offlineFetch = await configure();
        await expect(offlineFetch(other)).rejects.toThrow('缓存缺少模型文件');
        expect(mocks.nativeFetch).not.toHaveBeenCalled();
    });
    it('keeps voices in their separate fixed-URL cache and delegates packaged runtime assets', async () => {
        const voice = `${LOCAL_TTS_VOICE_PATH}/zf_001.bin`;
        voiceEntries.set(voice, new Response('voice'));
        const offlineFetch = await configure();
        expect(await (await offlineFetch(voice)).text()).toBe('voice');
        expect(mocks.nativeFetch).not.toHaveBeenCalled();
        expect(await (await offlineFetch('chrome-extension://fixture/runtime.wasm')).text()).toBe('runtime');
        expect(mocks.nativeFetch).toHaveBeenCalledOnce();
    });
    it('reports unavailable Cache Storage without model network fallback', async () => {
        const offlineFetch = await configure();
        vi.stubGlobal('caches', undefined);
        await expect(offlineFetch(main)).rejects.toThrow('缓存不可用');
        expect(mocks.nativeFetch).not.toHaveBeenCalled();
    });
});
