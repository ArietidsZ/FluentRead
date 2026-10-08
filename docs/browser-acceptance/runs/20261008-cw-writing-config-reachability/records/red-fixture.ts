/** 真实配置归一化、保存、订阅 → 写作 handler/runtime/gateway/SDK → 合成延迟 fetch；存储与浏览器边界为内存夹具。 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const m = vi.hoisted(() => ({
    values: new Map<string, unknown>(), connect: vi.fn(), removed: vi.fn(), updated: vi.fn(),
    contexts: vi.fn(), record: vi.fn(), recall: vi.fn(),
}));
vi.mock('@/src/platform/storage/configStorageRuntime', () => ({configStorage: {
    writeOwner: true,
    getItem: async (key: string) => m.values.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {m.values.set(key, structuredClone(value));},
    removeItem: async (key: string) => {m.values.delete(key);},
    watch: () => () => undefined,
}}));
vi.mock('webextension-polyfill', () => ({default: {
    runtime: {id: 'ext', getURL: (path: string) => `chrome-extension://ext/${path}`, getContexts: m.contexts, onConnect: {addListener: m.connect}},
    extension: {inIncognitoContext: false}, tabs: {onRemoved: {addListener: m.removed}, onUpdated: {addListener: m.updated}},
}}));
vi.mock('@/src/platform/storage/modelUsageRepository', () => ({modelUsageRepository: {captureGeneration: () => 1, recordMany: m.record}}));
vi.mock('@/src/platform/storage/learningMemoryRepository', () => ({learningMemoryRepository: {}}));
vi.mock('@/src/services/harness/memoryRecall', () => ({createLearningMemoryRecall: () => m.recall, readMemory: async () => []}));
const oldURL = 'https://old.synthetic.test/v1/chat/completions';
const newURL = 'https://new.synthetic.test/v1/chat/completions';
const privateModel = 'saved-private-model';
const requirementKey = 'v2:["custom","saved-private-model"]';
const request = {type: 'fluentReadWriting', action: 'run', requestId: 'saved-config-fixture', intent: 'reply', instruction: 'Answer the question.', draft: 'Synthetic draft.', context: 'Synthetic discussion.', language: 'en', tone: 'natural', history: []} as const;
function event() {
    const listeners = new Set<(value?: unknown) => void>();
    return {addListener: (listener: (value?: unknown) => void) => listeners.add(listener), removeListener: (listener: (value?: unknown) => void) => listeners.delete(listener), emit: (value?: unknown) => {for (const listener of [...listeners]) listener(value);}};
}
function port() {return {name: 'fluentReadWritingStream', sender: {id: 'ext', url: 'https://github.com/synthetic/project/issues/1', tab: {id: 1, incognito: true}}, onMessage: event(), onDisconnect: event(), postMessage: vi.fn()};}
function response() {
    const chunks = [{id: 'fixture', object: 'chat.completion.chunk', model: privateModel, choices: [{index: 0, delta: {role: 'assistant', content: 'Synthetic reply.'}, finish_reason: null}]}, {id: 'fixture', object: 'chat.completion.chunk', model: privateModel, choices: [{index: 0, delta: {}, finish_reason: 'stop'}]}];
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', {headers: {'content-type': 'text/event-stream'}});
}
type Store = typeof import('@/src/services/config/store');
let store: Store;
let stop: () => void;
let resetFetch: () => void;
let transport: ReturnType<typeof vi.fn>;
let finish: (value: Response) => void;
let calls: Array<{url: string; body: {model: string}; signal: AbortSignal | null | undefined}>;
let originalLocation: PropertyDescriptor | undefined;
beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks(); m.values.clear(); calls = [];
    originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', {configurable: true, value: {protocol: 'chrome-extension:'}});
    const {Config: ConfigClass} = await import('@/src/core/config/model');
    const initial = new ConfigClass();
    initial.writing = {...initial.writing, enabled: true, service: 'custom', model: 'saved-public-model'};
    initial.custom = oldURL;
    initial.customOpenAIProviders = [{id: 'custom', name: 'Synthetic legacy', endpoint: '', models: ['saved-public-model', privateModel]}];
    initial.incognitoService = 'custom'; initial.incognitoModel = privateModel;
    initial.requireApiKey = {[requirementKey]: false};
    m.values.set('local:config', initial);
    m.record.mockResolvedValue(undefined); m.contexts.mockResolvedValue([]);
    store = await import('@/src/services/config/store'); await store.configReady;
    const http = await import('@/src/platform/http/runtime'); resetFetch = () => http.setRuntimeFetch();
    transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({url: String(url), body: JSON.parse(String(init?.body)), signal: init?.signal});
        return new Promise<Response>(resolve => {finish = resolve;});
    });
    http.setRuntimeFetch(transport);
    stop = (await import('@/src/app/background/writingRuntime')).installWritingBackgroundRuntime();
});
afterEach(() => {
    stop?.(); resetFetch?.(); vi.restoreAllMocks();
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    else Reflect.deleteProperty(globalThis, 'location');
});
async function start() {
    const current = port(); m.connect.mock.calls[0][0](current); current.onMessage.emit(request);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    return current;
}
function results(current: ReturnType<typeof port>) {return current.postMessage.mock.calls.filter(([value]) => value.type === 'result');}
async function settle() {await new Promise<void>(resolve => setImmediate(resolve)); await new Promise<void>(resolve => setImmediate(resolve));}
async function verifyCancelled(current: ReturnType<typeof port>, signal: AbortSignal | null | undefined) {
    expect(results(current)).toHaveLength(1); expect(results(current)[0][0].response.cancelled).toBe(true);
    expect(signal?.aborted).toBe(true); finish(response()); await settle();
    expect(results(current)).toHaveLength(1);
    expect(current.postMessage.mock.calls.some(([value]) => value.type === 'progress' && value.progress.kind === 'text')).toBe(false);
}
describe('saved writing configuration reachability', () => {
    it('legacy empty endpoint is filled by real initialization; custom-only save retains the effective endpoint and valid pending generation', async () => {
        expect(store.config.customOpenAIProviders[0].endpoint).toBe(oldURL);
        const current = await start(); expect(calls[0]).toMatchObject({url: oldURL, body: {model: privateModel}});
        await store.requestConfigSave({...store.config, custom: newURL});
        expect(store.config.custom).toBe(newURL);
        expect(store.config.customOpenAIProviders[0].endpoint).toBe(oldURL);
        expect(m.values.get('local:config')).toMatchObject({custom: newURL, customOpenAIProviders: [{endpoint: oldURL}]});
        expect(calls[0].signal?.aborted).toBe(false); expect(results(current)).toHaveLength(0);
        finish(response()); await vi.waitFor(() => expect(results(current)).toHaveLength(1));
        expect(results(current)[0][0].response.success).toBe(true);
    });
    it.each(['save', 'patch'] as const)('%s with an empty legacy endpoint and changed custom normalizes the profile, cancels once, and uses the new endpoint next time', async mode => {
        const current = await start();
        const change = {custom: newURL, customOpenAIProviders: store.config.customOpenAIProviders.map(provider => ({...provider, endpoint: ''}))};
        if (mode === 'save') await store.requestConfigSave({...store.config, ...change});
        else await store.requestConfigPatch(change);
        expect(store.config.customOpenAIProviders[0].endpoint).toBe(newURL);
        expect(m.values.get('local:config')).toMatchObject({custom: newURL, customOpenAIProviders: [{endpoint: newURL}]});
        await verifyCancelled(current, calls[0].signal);
        const next = port(); m.connect.mock.calls[0][0](next); next.onMessage.emit({...request, requestId: 'next-saved-config'});
        await vi.waitFor(() => expect(calls).toHaveLength(2)); expect(calls[1].url).toBe(newURL);
        finish(response()); await vi.waitFor(() => expect(results(next)).toHaveLength(1)); expect(results(next)[0][0].response.success).toBe(true);
    });
    it('a persisted API-key requirement change invalidates local readiness and cancels the generation accepted under the old policy', async () => {
        const current = await start();
        await store.requestConfigPatch({requireApiKey: {[requirementKey]: true}});
        expect(store.config.requireApiKey[requirementKey]).toBe(true);
        const {resolveWritingReadiness} = await import('@/src/core/config/writingReadiness');
        expect(resolveWritingReadiness({...store.config, writing: {...store.config.writing, service: 'custom', model: privateModel}})).toMatchObject({ready: false, issue: 'credential'});
        await verifyCancelled(current, calls[0].signal);
    });
    it('a persisted recovery-policy change cancels a delayed real SDK rotation attempt and suppresses its late response', async () => {
        await store.requestConfigSave({...store.config, token: {custom: 'synthetic-first'}, apiKeys: {custom: ['synthetic-first', 'synthetic-second']}, apiKeyRotationEnabled: {custom: true}});
        expect(store.config.apiKeys.custom).toEqual(['synthetic-first', 'synthetic-second']);
        expect(store.config.apiKeyRotationEnabled.custom).toBe(true);
        const rotation = await import('@/src/services/translation/apiKeyRotation');
        const spy = vi.spyOn(rotation, 'runWithApiKeyRotation');
        transport.mockImplementationOnce(async (url: RequestInfo | URL, init?: RequestInit) => {
            calls.push({url: String(url), body: JSON.parse(String(init?.body)), signal: init?.signal});
            return new Response(JSON.stringify({error: {message: 'synthetic quota'}}), {status: 429, headers: {'content-type': 'application/json'}});
        });
        const current = await start(); await vi.waitFor(() => expect(calls).toHaveLength(2));
        const oldRecovery = store.config.apiKeyRecoveryMs;
        expect(spy.mock.calls[0][0].apiKeyRecoveryMs).toBe(oldRecovery);
        expect(calls.every(call => call.url === oldURL && call.body.model === privateModel)).toBe(true);
        await store.requestConfigPatch({apiKeyRecoveryMs: oldRecovery === 60_000 ? 120_000 : 60_000});
        expect(store.config.apiKeyRecoveryMs).not.toBe(oldRecovery);
        await verifyCancelled(current, calls[1].signal);
    });
});
