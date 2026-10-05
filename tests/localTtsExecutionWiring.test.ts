/**
 * @file tests/localTtsExecutionWiring.test.ts
 * 文件职责：验证本地朗读执行策略经过真实后台、适配器与 Offscreen 组合根后到达 Worker。
 * 主要内容：在浏览器消息、存储和 Worker 边界替身下检查默认 GPU、显式兼容与运行时配置切换。
 * 模块边界：不替换 TTS 策略、消息路由或合成 owner，不下载模型、不运行模型推理。
 */
import 'fake-indexeddb/auto';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';

type Listener = (message: Record<string, unknown>, sender: unknown, reply?: (response: unknown) => void) => unknown;
const boundary = vi.hoisted(() => {
    const event = () => ({addListener: vi.fn(), removeListener: vi.fn()});
    const storage = {
        writeOwner: true,
        getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined),
        removeItem: vi.fn(async () => undefined), watch: vi.fn(() => () => undefined),
    };
    const browser = {
        runtime: {id: 'tts-wiring', getURL: (path: string) => `chrome-extension://tts-wiring/${path.replace(/^\//u, '')}`,
            onMessage: event(), onConnect: event(), sendMessage: vi.fn(async () => undefined)},
        extension: {inIncognitoContext: false},
        tabs: {onRemoved: event(), onUpdated: event(), query: vi.fn(async () => []), sendMessage: vi.fn(async () => undefined)},
        alarms: {onAlarm: event(), create: vi.fn(async () => undefined)},
        storage: {local: {get: vi.fn(async () => ({})), set: vi.fn(async () => undefined)}, onChanged: event()},
    };
    return {browser, storage, send: vi.fn()};
});
vi.mock('webextension-polyfill', () => ({default: boundary.browser}));
vi.mock('@wxt-dev/storage', () => ({storage: boundary.storage}));
vi.mock('@/src/platform/storage/configStorageRuntime', () => ({configStorage: boundary.storage}));
vi.mock('@/src/platform/offscreen/extensionClient', () => ({extensionDomClient: {send: boundary.send}}));

class ObservedWorker {
    static instances: ObservedWorker[] = [];
    static requests: Record<string, unknown>[] = [];
    onmessage?: (event: {data: unknown}) => void;
    onerror?: (event: {message: string}) => void;
    terminate = vi.fn();
    constructor() { ObservedWorker.instances.push(this); }
    postMessage(message: Record<string, unknown>) {
        ObservedWorker.requests.push(message);
        queueMicrotask(() => this.onmessage?.({data: {
            requestId: message.requestId, success: true, audio: new Uint8Array([82, 73, 70, 70]).buffer,
            backend: message.execution === 'compatible' ? 'wasm' : 'webgpu',
        }}));
    }
}

function memoryCache() {
    const entries = new Map<string, Response>();
    const key = (request: RequestInfo | URL) => typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
    return {
        match: async (request: RequestInfo | URL) => entries.get(key(request))?.clone(),
        put: async (request: RequestInfo | URL, response: Response) => { entries.set(key(request), response.clone()); },
        delete: async (request: RequestInfo | URL) => entries.delete(key(request)),
    };
}

let backgroundListener: Listener;
let dispose: () => void;
let config: typeof import('@/src/services/config/store')['config'];
beforeAll(async () => {
    vi.stubGlobal('browser', boundary.browser);
    vi.stubGlobal('Worker', ObservedWorker);
    vi.stubGlobal('window', {setTimeout, clearTimeout, location: {href: 'chrome-extension://tts-wiring/offscreen.html'}, addEventListener: vi.fn()});
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected network request'); }));
    // Represent entries already verified by the downloader, not a cache hit for every URL.
    // Bodies are small boundary fixtures; this suite never loads them into a model.
    const {LOCAL_TTS_MODEL_CACHE_NAME, LOCAL_TTS_VOICE_CACHE_NAME} = await import('@/src/core/config/localTts');
    const {LOCAL_TTS_MODEL_FILES, LOCAL_TTS_VOICES, getLocalTtsModelFileUrl, getLocalTtsVoiceCacheUrl}
        = await import('@/src/features/local-tts/offscreen/modelCache');
    const cachesByName = new Map<string, ReturnType<typeof memoryCache>>();
    const open = async (name: string) => {
        if (!cachesByName.has(name)) cachesByName.set(name, memoryCache());
        return cachesByName.get(name)!;
    };
    const models = await open(LOCAL_TTS_MODEL_CACHE_NAME);
    for (const file of LOCAL_TTS_MODEL_FILES) {
        const pinnedUrl = getLocalTtsModelFileUrl(file);
        await models.put(pinnedUrl, new Response('verified model fixture', {
            headers: {'X-FluentRead-Model-Source': pinnedUrl},
        }));
    }
    const voices = await open(LOCAL_TTS_VOICE_CACHE_NAME);
    for (const voice of LOCAL_TTS_VOICES) await voices.put(getLocalTtsVoiceCacheUrl(voice), new Response('voice fixture'));
    vi.stubGlobal('caches', {open: vi.fn(open)});
    let offscreenListener!: Listener;
    vi.stubGlobal('chrome', {runtime: {
        getURL: boundary.browser.runtime.getURL,
        onMessage: {addListener: (listener: Listener) => { offscreenListener = listener; }},
        sendMessage: vi.fn((_message, reply) => reply?.()),
    }});
    boundary.send.mockImplementation((message: Record<string, unknown>) => new Promise(resolve => {
        expect(offscreenListener({...message, target: 'offscreen'}, {}, resolve)).toBe(true);
    }));
    const store = await import('@/src/services/config/store');
    await store.configReady;
    config = store.config;
    config.selectionTtsMode = 'local-only';
    const {startOffscreenApp} = await import('@/src/app/offscreen/runtime');
    startOffscreenApp();
    dispose = (await import('@/src/features/local-tts/offscreen/tts')).disposeLocalTtsWorker;
    const {installBackgroundMessageRuntime} = await import('@/src/app/background/messageRuntime');
    const {TabTranslationStateStore} = await import('@/src/app/background/tabTranslationState');
    const {resolveBrowserCapabilities} = await import('@/src/platform/browser/capabilities');
    installBackgroundMessageRuntime({tabTranslationStates: new TabTranslationStateStore(), onFullPageStateChanged: vi.fn(),
        capabilities: resolveBrowserCapabilities({browser: 'chrome', manifestVersion: 3})});
    backgroundListener = boundary.browser.runtime.onMessage.addListener.mock.calls.at(-1)![0] as Listener;
});
afterAll(() => { dispose?.(); vi.unstubAllGlobals(); });

describe('local TTS execution through production composition roots', () => {
    it('preserves the GPU default and live compatible/GPU changes through background, adapter, offscreen and owner', async () => {
        for (const execution of [undefined, 'compatible', 'gpu'] as const) {
            (config as unknown as {selectionTtsExecution?: string}).selectionTtsExecution = execution;
            const expected = execution ?? 'gpu';
            const response = await backgroundListener({type: 'selectionTts', text: 'hello', language: 'en-US', clientRequestId: `wiring-${expected}`}, {});
            expect(response, JSON.stringify(response)).toMatchObject({success: true, transport: 'page', audioBase64: btoa('RIFF')});
            expect(boundary.send.mock.calls.at(-1)?.[0]).toMatchObject({type: 'LOCAL_TTS_SYNTHESIZE', execution: expected});
            expect(ObservedWorker.requests.at(-1)).toMatchObject({type: 'synthesize', execution: expected, text: 'hello'});
        }
        expect(ObservedWorker.instances).toHaveLength(3);
        expect(ObservedWorker.instances[0].terminate).toHaveBeenCalledOnce();
        expect(ObservedWorker.instances[1].terminate).toHaveBeenCalledOnce();
        expect(fetch).not.toHaveBeenCalled();
    });
});
