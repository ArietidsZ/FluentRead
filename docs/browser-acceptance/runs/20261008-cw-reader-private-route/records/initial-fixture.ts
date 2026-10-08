/** 原生阅读入口、真实 normalize/save/subscriber、conversation/IndexedDB/runtime/gateway/SDK → 合成 fetch，不调用真实 API。 */
import 'fake-indexeddb/auto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {services, models} from '@/src/core/config/catalog';
import type {ReadingSender} from '@/src/features/reading-assistant/background';
import type {ReadingRequest, ReadingResponse} from '@/src/features/reading-assistant/types';
import type {HarnessSessionRepository, FluentReadHarnessSessionDatabase} from '@/src/platform/storage/harnessSessionRepository';
const m = vi.hoisted(() => {
    const state = {values: new Map<string, unknown>(), session: null as HarnessSessionRepository | null,
        recovery: undefined as Promise<void> | undefined, connect: vi.fn(), removed: vi.fn(), updated: vi.fn(),
        contexts: vi.fn(), record: vi.fn(), recall: vi.fn(), alarm: vi.fn(), extension: {inIncognitoContext: false}};
    const sessionProxy = Object.fromEntries(['captureGeneration', 'upsertTurn', 'get', 'list', 'delete', 'clear', 'prune'].map(name => [name, (...args: unknown[]) => (state.session as any)[name](...args)]));
    sessionProxy.recoverInterrupted = async () => {await state.recovery; return state.session!.recoverInterrupted();};
    return Object.assign(state, {sessionProxy});
});
vi.mock('@/src/platform/storage/configStorageRuntime', () => ({configStorage: {
    writeOwner: true, getItem: async (key: string) => m.values.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {m.values.set(key, structuredClone(value));},
    removeItem: async (key: string) => {m.values.delete(key);}, watch: () => () => undefined,
}}));
vi.mock('@/src/platform/storage/harnessSessionRepository', async importOriginal => ({
    ...await importOriginal<object>(), harnessSessionRepository: m.sessionProxy,
}));
vi.mock('webextension-polyfill', () => ({default: {
    runtime: {id: 'ext', getURL: (path: string) => `chrome-extension://ext/${path.replace(/^\//u, '')}`, getContexts: m.contexts, onConnect: {addListener: m.connect}},
    extension: m.extension, tabs: {onRemoved: {addListener: m.removed}, onUpdated: {addListener: m.updated}},
    alarms: {onAlarm: {addListener: m.alarm}, create: vi.fn().mockResolvedValue(undefined)},
}}));
vi.mock('@/src/platform/storage/modelUsageRepository', () => ({modelUsageRepository: {captureGeneration: () => 1, recordMany: m.record}}));
vi.mock('@/src/platform/storage/learningMemoryRepository', () => ({learningMemoryRepository: {}}));
vi.mock('@/src/services/harness/memoryRecall', () => ({createLearningMemoryRecall: () => m.recall, readMemory: async () => []}));
const service = 'custom:reader';
const endpoint = 'https://reader.synthetic.test/v1/chat/completions';
const native = (incognito: unknown = true): ReadingSender => ({id: 'ext', documentId: 'native-reader', frameId: 0, url: 'https://example.test/reading?incognito=true', tab: {id: 1, incognito: incognito as boolean}});
const request: ReadingRequest = {type: 'fluentReadHarness', action: 'run', requestId: 'reader-fixture', intent: 'meaning', question: '', selection: {text: 'Synthetic selected sentence.', context: 'Synthetic authorized paragraph.', sentence: ''}, history: []};
function event<T extends (...args: any[]) => void>() {const listeners = new Set<T>(); return {addListener: (callback: T) => listeners.add(callback), removeListener: (callback: T) => listeners.delete(callback), emit: (...args: Parameters<T>) => {for (const callback of [...listeners]) callback(...args);}};}
function port(sender = native()) {return {name: 'fluentReadHarnessStream', sender, onMessage: event<(message: unknown) => void>(), onDisconnect: event<() => void>(), postMessage: vi.fn(), disconnect: vi.fn()};}
function response(model = 'reader-private', text = 'Synthetic reading answer.', tool = false) {
    const delta = tool ? {role: 'assistant', tool_calls: [{index: 0, id: 'context-call', type: 'function', function: {name: 'read_context', arguments: '{"reason":"disambiguate"}'}}]} : {role: 'assistant', content: text};
    const chunks = [{id: 'fixture', object: 'chat.completion.chunk', model, choices: [{index: 0, delta, finish_reason: null}]}, {id: 'fixture', object: 'chat.completion.chunk', model, choices: [{index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop'}]}];
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', {headers: {'content-type': 'text/event-stream'}});
}
let store: typeof import('@/src/services/config/store');
let app: ReturnType<typeof import('@/src/app/background/harnessRuntime').installHarnessBackgroundRuntime>;
let database: FluentReadHarnessSessionDatabase;
let resetFetch: () => void;
let transport: ReturnType<typeof vi.fn>;
let calls: Array<{url: string; body: any; signal?: AbortSignal | null}>;
let originalLocation: PropertyDescriptor | undefined;
let pendingPorts: ReturnType<typeof port>[];
beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks(); m.values.clear(); calls = []; pendingPorts = []; m.recovery = undefined; m.extension.inIncognitoContext = false;
    originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', {configurable: true, value: {protocol: 'chrome-extension:'}});
    const {Config} = await import('@/src/core/config/model'); const initial = new Config();
    initial.harness = {...initial.harness, enabled: true, service, model: 'reader-public', contextMode: 'paragraph'};
    initial.customOpenAIProviders = [{id: service, name: 'Synthetic reader', endpoint, models: ['reader-public', 'reader-private', 'reader-next']}];
    initial.incognitoService = service; initial.incognitoModel = 'reader-private';
    initial.requireApiKey = Object.fromEntries(['reader-public', 'reader-private', 'reader-next'].map(model => [`v2:${JSON.stringify([service, model])}`, false]));
    m.values.set('local:config', initial); m.record.mockResolvedValue(undefined); m.contexts.mockResolvedValue([]);
    store = await import('@/src/services/config/store'); await store.configReady;
    const storage = await import('@/src/platform/storage/harnessSessionRepository');
    database = new storage.FluentReadHarnessSessionDatabase(`reader-privacy-${crypto.randomUUID()}`);
    m.session = new storage.HarnessSessionRepository(database);
    const http = await import('@/src/platform/http/runtime'); resetFetch = () => http.setRuntimeFetch();
    transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)); calls.push({url: String(url), body, signal: init?.signal});
        return response(body.model);
    }); http.setRuntimeFetch(transport);
    app = (await import('@/src/app/background/harnessRuntime')).installHarnessBackgroundRuntime();
});
afterEach(async () => {
    for (const current of pendingPorts) current.onDisconnect.emit();
    resetFetch?.(); vi.restoreAllMocks(); database?.close(); await database?.delete(); m.session = null;
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation); else Reflect.deleteProperty(globalThis, 'location');
});
function connect(sender = native(), payload: object = request) {const current = port(sender); pendingPorts.push(current); m.connect.mock.calls.at(-1)![0](current); current.onMessage.emit(payload); return current;}
function results(current: ReturnType<typeof port>) {return current.postMessage.mock.calls.filter(([value]) => value.type === 'result');}
async function run(sender = native(), payload: object = request): Promise<{current: ReturnType<typeof port>; result: ReadingResponse}> {
    const current = connect(sender, payload); await vi.waitFor(() => expect(results(current)).toHaveLength(1)); return {current, result: results(current)[0][0].response};
}
const settle = async () => {await new Promise<void>(resolve => setImmediate(resolve)); await new Promise<void>(resolve => setImmediate(resolve));};
function delayNext() {let finish!: (value: Response) => void; transport.mockImplementationOnce(async (url: RequestInfo | URL, init?: RequestInit) => {calls.push({url: String(url), body: JSON.parse(String(init?.body)), signal: init?.signal}); return new Promise<Response>(resolve => {finish = resolve;});}); return (value: Response) => finish(value);}
describe('reading private route through native application and saved configuration', () => {
    it.each(['meaning', 'grammar', 'usage', 'practice'] as const)('private %s uses the dedicated pair and keeps reading prompts, evidence and context tools', async intent => {
        const {result} = await run(native(), {...request, intent}); expect(result).toMatchObject({success: true, service, model: 'reader-private'});
        expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({url: endpoint, body: {model: 'reader-private'}});
        const {getDefaultHarnessPrompt} = await import('@/src/core/config/harness'); expect(calls[0].body.messages[0].content).toContain(getDefaultHarnessPrompt(intent, store.config.uiLanguage));
        expect(JSON.stringify(calls[0].body.messages)).toContain(request.selection.text); expect(JSON.stringify(calls[0].body.messages)).toContain(request.selection.context);
        expect(calls[0].body.tools[0].function.name).toBe('read_context'); expect(store.config.harness.model).toBe('reader-public');
        expect((await m.session!.list()).sessions).toEqual([]);
    });
    it('actual tool loop returns only the authorized paragraph and preserves a private unsaved follow-up', async () => {
        transport.mockImplementationOnce(async (url: RequestInfo | URL, init?: RequestInit) => {const body = JSON.parse(String(init?.body)); calls.push({url: String(url), body}); return response(body.model, '', true);});
        const {result} = await run(native(), {...request, question: 'Why?', history: [{question: 'Earlier question', answer: 'Earlier actual answer'}]}); expect(result.success).toBe(true);
        expect(calls).toHaveLength(2); expect(calls.every(call => call.body.model === 'reader-private')).toBe(true);
        expect(JSON.stringify(calls[0].body.messages)).toContain('Earlier actual answer');
        expect(JSON.stringify(calls[1].body.messages.find((message: any) => message.role === 'tool'))).toContain(request.selection.context);
    });
    it('native regular ignores self-reported private flags and URL even with an invalid dedicated pair', async () => {
        await store.requestConfigPatch({incognitoModel: 'invalid-private-model'});
        const {result} = await run(native(false), {...request, privateContext: true, incognito: true, service, model: 'reader-private'});
        expect(result).toMatchObject({success: true, model: 'reader-public'}); expect(calls[0].body.model).toBe('reader-public');
    });
    it.each([undefined, null, 'true'])('native unknown %s cannot be promoted by frontend flags or URL and never creates a saved session', async incognito => {
        const sender = native(); sender.tab!.incognito = incognito as boolean;
        const {result} = await run(sender, {...request, privateContext: true, incognito: true}); expect(result.success).toBe(false);
        expect(calls).toHaveLength(0); expect((await m.session!.list()).sessions).toEqual([]);
    });
    it('both-empty preserves old private and unknown model behavior', async () => {
        await store.requestConfigPatch({incognitoService: '', incognitoModel: ''}); await run();
        const sender = native(); delete sender.tab!.incognito; await run(sender);
        expect(calls.map(call => call.body.model)).toEqual(['reader-public', 'reader-public']);
    });
    it.each([['google', ''], [services.localTranslation, models.get(services.localTranslation)![0]], [services.tongyi, models.get(services.tongyi)!.find(model => model.startsWith('qwen-mt'))!], [service, 'not-in-catalog']])('private unsupported/invalid %s/%s does not fall back', async (incognitoService, incognitoModel) => {
        await store.requestConfigPatch({incognitoService, incognitoModel}); const {result} = await run(); expect(result.success).toBe(false); expect(calls).toHaveLength(0);
    });
    it('native sender is captured before readiness so caller mutation cannot downgrade privacy', async () => {
        let release!: () => void; m.recovery = new Promise<void>(resolve => {release = resolve;});
        app = (await import('@/src/app/background/harnessRuntime')).installHarnessBackgroundRuntime();
        const sender = native(), current = connect(sender); sender.tab!.incognito = false; release();
        await vi.waitFor(() => expect(results(current)).toHaveLength(1)); expect(calls[0].body.model).toBe('reader-private');
    });
    it('the actual gateway receives a frozen private model lock and rejects a substituted regular pair', async () => {
        const gateway = await import('@/src/services/harness/modelGateway'); const spy = vi.spyOn(gateway, 'createHarnessLanguageModel'); await run();
        const frozen = spy.mock.calls[0][0]; const {getLockedIncognitoRoute} = await import('@/src/core/config/incognitoRoute');
        expect(getLockedIncognitoRoute(frozen)).toEqual({service, model: 'reader-private'}); expect(Object.isFrozen(frozen)).toBe(true);
        expect(() => gateway.createHarnessLanguageModel(frozen, service, 'reader-public')).toThrow('冲突');
    });
    it.each(['incognitoModel', 'customOpenAIProviders', 'proxy', 'customModels', 'customBody', 'customHeaders', 'apiKeyRecoveryMs', 'requireApiKey'] as const)('real normalized %s patch cancels an active private SDK request and suppresses late content', async field => {
        if (field === 'apiKeyRecoveryMs') await store.requestConfigPatch({token: {[service]: 'synthetic-first'}, apiKeys: {[service]: ['synthetic-first', 'synthetic-second']}, apiKeyRotationEnabled: {[service]: true}});
        const finish = delayNext(), current = connect(); await vi.waitFor(() => expect(calls).toHaveLength(1));
        const changes = {incognitoModel: 'reader-next', customOpenAIProviders: store.config.customOpenAIProviders.map(provider => ({...provider, endpoint: 'https://changed.synthetic.test/v1/chat/completions'})), proxy: {[service]: 'https://proxy.synthetic.test/v1/chat/completions'}, customModels: {openai: ['synthetic-added-model']}, customBody: {[service]: '{"temperature":0.2}'}, customHeaders: {[service]: '{"x-synthetic":"changed"}'}, apiKeyRecoveryMs: store.config.apiKeyRecoveryMs === 60_000 ? 120_000 : 60_000, requireApiKey: {...store.config.requireApiKey, [`v2:${JSON.stringify([service, 'reader-private'])}`]: true}};
        await store.requestConfigPatch({[field]: changes[field]}); expect(store.config[field]).toEqual(changes[field]);
        await vi.waitFor(() => expect(results(current)).toHaveLength(1)); expect(results(current)[0][0].response.cancelled).toBe(true); expect(calls[0].signal?.aborted).toBe(true);
        finish(response('reader-private', 'Late private content')); await settle(); expect(results(current)).toHaveLength(1);
        expect(current.postMessage.mock.calls.some(([value]) => value.type === 'progress' && value.progress.kind === 'text')).toBe(false);
        expect((await m.session!.list()).sessions).toEqual([]);
    });
    it.each(['close', 'navigate', 'remove', 'disable'] as const)('%s keeps late SDK output out of an existing regular reading session and out of the page', async reason => {
        const first = await run(native(false)); if (!first.result.success || !first.result.sessionId) throw new Error('Expected saved regular session');
        const sessionId = first.result.sessionId; calls = []; const finish = delayNext();
        const current = connect(native(false), {...request, requestId: 'followup', sessionId, question: 'Why?'}); await vi.waitFor(() => expect(calls).toHaveLength(1));
        if (reason === 'close') current.onDisconnect.emit(); else if (reason === 'navigate') m.updated.mock.calls.at(-1)![0](1, {status: 'loading'}); else if (reason === 'remove') m.removed.mock.calls.at(-1)![0](1); else await store.requestConfigPatch({harness: {...store.config.harness, enabled: false}});
        await vi.waitFor(async () => expect((await m.session!.get(sessionId))?.turns.at(-1)?.status).toBe('stopped'));
        const stopped = await m.session!.get(sessionId); finish(response('reader-public', 'Late stale regular content')); await settle();
        expect(await m.session!.get(sessionId)).toEqual(stopped); expect(JSON.stringify(stopped)).not.toContain('Late stale');
        expect(current.postMessage.mock.calls.some(([value]) => value.type === 'result' && value.response.success)).toBe(false);
        expect(current.postMessage.mock.calls.some(([value]) => value.type === 'progress' && value.progress.kind === 'text')).toBe(false);
    });
    it('direct runtime boolean cannot substitute for internal native source authority', async () => {
        const {createHarnessRuntime} = await import('@/src/services/harness/runtime');
        const result = await createHarnessRuntime(() => store.config).run({...request, privateContext: true} as ReadingRequest, new AbortController().signal, undefined, true);
        expect(result).toMatchObject({success: false, error: expect.stringContaining('来源')}); expect(calls).toHaveLength(0);
    });
});
