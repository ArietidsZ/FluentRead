/** 原生图片 Port／sender、真实 normalize/save/subscriber、图片 handler／broker／SDK → 合成 fetch；OCR 和存储为隔离本地边界。 */
import 'fake-indexeddb/auto';
import {afterEach, beforeEach, describe, expect, it, vi, type MockInstance} from 'vitest';
import {documentPortPair} from './helpers/imageDocumentPorts';
import type {ImageGlossarySenderContext} from '@/src/app/background/imageGlossaryContext';
const m = vi.hoisted(() => ({values: new Map<string, unknown>(), send: vi.fn(), contexts: vi.fn(), record: vi.fn(), source: vi.fn()}));
vi.mock('@/src/platform/storage/configStorageRuntime', () => ({configStorage: {
    writeOwner: true, getItem: async (key: string) => m.values.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {m.values.set(key, structuredClone(value));},
    removeItem: async (key: string) => {m.values.delete(key);}, watch: () => () => undefined,
}}));
vi.mock('@/src/platform/offscreen/extensionClient', () => ({extensionDomClient: {send: m.send}}));
vi.mock('webextension-polyfill', () => ({default: globalThis.browser}));
vi.mock('@/src/platform/storage/modelUsageRepository', () => ({modelUsageRepository: {captureGeneration: () => 1, recordMany: m.record}}));
vi.mock('@/src/platform/storage/translationStatsRepository', () => ({translationStatsRepository: {captureGeneration: () => 1, record: m.record}}));
const publicService = 'custom:image-public', privateService = 'custom:image-private';
const publicURL = 'https://public-image.synthetic.test/v1/chat/completions', privateURL = 'https://private-image.synthetic.test/v1/chat/completions';
const image = 'data:image/png;base64,AQ==';
const native = (incognito: unknown = true): ImageGlossarySenderContext => ({sender: {id: 'ext', documentId: 'image-document', frameId: 0,
    url: 'https://example.test/same?incognito=true', tab: {id: 1, incognito: incognito as boolean}}});
const request = {type: 'fluentReadImageTranslate', requestId: 'image-fixture', image, sourceLanguage: 'en', title: 'Synthetic title'};
function response(model: string) {return new Response(JSON.stringify({id: 'synthetic', object: 'chat.completion', model,
    choices: [{index: 0, message: {role: 'assistant', content: '合成译文。'}, finish_reason: 'stop'}]}), {headers: {'content-type': 'application/json'}});}
let store: typeof import('@/src/services/config/store');
let app: ReturnType<typeof import('@/src/app/background/areaRuntime').createImageAreaTranslationRuntime>;
let transport: ReturnType<typeof vi.fn>, resetFetch: () => void;
let calls: Array<{url: string; body: any; signal?: AbortSignal | null}>;
let cache: typeof import('@/src/services/translation/cache');
let readCache: MockInstance<(key: string, now?: number) => Promise<string | null>>;
let originalLocation: PropertyDescriptor | undefined;
let ports: ReturnType<typeof documentPortPair>[];
let ocr: (message: any, options: any) => Promise<unknown>;
let languages: ReturnType<typeof vi.fn>;
const offscreen = () => ({sender: {id: 'ext', url: 'chrome-extension://ext/offscreen.html'}});
const settle = async () => {await new Promise<void>(resolve => setImmediate(resolve)); await new Promise<void>(resolve => setImmediate(resolve));};
async function call(message: Record<string, unknown> & {type: string}, context = native()) {
    return app.handlers.find(handler => handler.type === message.type)!.handle(message, context) as Promise<any>;
}
beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks(); m.values.clear(); calls = []; ports = [];
    originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', {configurable: true, value: {protocol: 'chrome-extension:'}});
    vi.stubGlobal('browser', {runtime: {id: 'ext', getURL: (path: string) => `chrome-extension://ext/${path.replace(/^\//u, '')}`, getContexts: m.contexts}, tabs: {sendMessage: m.source}});
    const {Config} = await import('@/src/core/config/model'); const initial = new Config();
    initial.service = publicService; initial.imageTranslationService = publicService;
    initial.customOpenAIProviders = [{id: publicService, name: 'Synthetic public image', endpoint: publicURL, models: ['image-public']},
        {id: privateService, name: 'Synthetic private image', endpoint: privateURL, models: ['image-private', 'image-next', 'private-ordinary']}];
    initial.model = {[publicService]: 'image-public', [privateService]: 'private-ordinary'};
    initial.incognitoService = privateService; initial.incognitoModel = 'image-private';
    initial.requireApiKey = Object.fromEntries([[publicService, 'image-public'], ...['image-private', 'image-next', 'private-ordinary'].map(model => [privateService, model])]
        .map(pair => [`v2:${JSON.stringify(pair)}`, false]));
    initial.translationMaxRetries = 0; initial.imageTranslationOcrEngine = 'tesseract';
    m.values.set('local:config', initial); m.record.mockResolvedValue(undefined); m.contexts.mockResolvedValue([]); m.source.mockResolvedValue({valid: true});
    store = await import('@/src/services/config/store'); await store.configReady;
    const http = await import('@/src/platform/http/runtime'); resetFetch = () => http.setRuntimeFetch();
    transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {const body = JSON.parse(String(init?.body)); calls.push({url: String(url), body, signal: init?.signal}); return response(body.model);});
    http.setRuntimeFetch(transport);
    cache = await import('@/src/services/translation/cache'); await cache.translationCache.clear(); readCache = vi.spyOn(cache.translationCache, 'get');
    ocr = async message => {
        const result = await call({type: 'fluentReadImageTranslateTexts', requestId: message.requestId, texts: ['Synthetic source phrase.'], title: message.title}, offscreen());
        if (!result.success) return result;
        return {success: true, image, lines: result.translations};
    };
    m.send.mockImplementation(async (message, options) => message.type === 'FLUENT_READ_IMAGE_TRANSLATE_OFFSCREEN' ? ocr(message, options)
        : message.type === 'FLUENT_READ_IMAGE_FETCH_OFFSCREEN' ? {success: true, image} : {success: true});
    languages = vi.fn(async () => {});
    const {resolveBrowserCapabilities} = await import('@/src/platform/browser/capabilities');
    app = (await import('@/src/app/background/areaRuntime')).createImageAreaTranslationRuntime({assertDownloaded: languages, getDownloaded: async () => [],
        markDownloaded: async () => [], markRemoved: async () => []} as any, resolveBrowserCapabilities({browser: 'chrome', manifestVersion: 3}));
});
afterEach(async () => {
    for (const port of ports) port.close(); resetFetch?.(); await cache?.translationCache.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation); else Reflect.deleteProperty(globalThis, 'location');
});
async function portRequest(context = native(), message = request) {
    const pair = documentPortPair(context.sender); ports.push(pair); app.connect(pair.background);
    const {createImageDocumentClient} = await import('@/src/features/image-translation/services/documentClient');
    const client = createImageDocumentClient(() => pair.client);
    const pending = client.request(message, {requestId: message.requestId, timeoutMs: 5000}, 'synthetic timeout');
    void pending.catch(() => {}); return {pair, pending};
}
function delayNext() {
    let finish!: (value: Response) => void;
    transport.mockImplementationOnce(async (url: RequestInfo | URL, init?: RequestInit) => {calls.push({url: String(url), body: JSON.parse(String(init?.body)), signal: init?.signal}); return new Promise<Response>(resolve => {finish = resolve;});});
    return (model = 'image-private') => finish(response(model));
}
describe('native image private route through OCR transaction, actual broker and SDK', () => {
    it.each(['tesseract', 'paddle', 'manga'] as const)('%s retains OCR selection and uses the frozen dedicated pair in the real SDK', async mode => {
        if (mode === 'paddle') await store.requestConfigPatch({imageTranslationOcrEngine: 'paddle'});
        const {pending} = await portRequest(native(), {...request, ...(mode === 'manga' ? {manga: true} : {})});
        expect(await pending).toMatchObject({success: true, lines: ['合成译文。']});
        expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({url: privateURL, body: {model: 'image-private'}});
        expect(m.send.mock.calls[0][0]).toMatchObject(mode === 'manga' ? {manga: true} : mode === 'paddle' ? {ocrEngine: 'paddle'} : {sourceLanguage: 'en'});
        expect(languages).toHaveBeenCalledTimes(mode === 'tesseract' ? 1 : 0);
        expect(m.send.mock.calls.every(([message]) => !String(message.type).includes('DOWNLOAD'))).toBe(true);
        expect(store.config.imageTranslationService).toBe(publicService); expect(store.config.model[privateService]).toBe('private-ordinary');
    });
    it('regular native sender ignores forged frontend privacy, route and invalid private configuration', async () => {
        await store.requestConfigPatch({incognitoModel: 'missing-model'});
        expect(await call({...request, privateContext: true, incognitoService: privateService, incognitoModel: 'image-private'}, native(false))).toMatchObject({success: true});
        expect(calls[0]).toMatchObject({url: publicURL, body: {model: 'image-public'}});
    });
    it.each([undefined, 'true', 1])('nonboolean native incognito=%s fails closed before OCR/cache/SDK', async value => {
        const sender = native(); (sender.sender!.tab as any).incognito = value; const {pending} = await portRequest(sender); expect(await pending).toMatchObject({success: false, error: expect.stringContaining('来源')});
        expect(m.send).not.toHaveBeenCalled(); expect(readCache).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
    });
    it('both-empty dedicated pair keeps unknown-source compatibility', async () => {
        await store.requestConfigPatch({incognitoService: '', incognitoModel: ''}); const sender = native(); delete (sender.sender!.tab as any).incognito;
        expect(await call(request, sender)).toMatchObject({success: true}); expect(calls[0].body.model).toBe('image-public');
    });
    it.each([{incognitoModel: 'missing-model'}, {incognitoService: ''}, {customBody: {[privateService]: '{"model":"private-ordinary"}'}}])('invalid private pair/body is rejected before OCR and ordinary fallback: %j', async patch => {
        await store.requestConfigPatch(patch); await expect(call(request)).rejects.toThrow(/无效|冲突/u);
        expect(m.send).not.toHaveBeenCalled(); expect(calls).toHaveLength(0); expect(readCache).not.toHaveBeenCalled();
    });
    it('ordinary persisted cache is never reused for the private model', async () => {
        expect(await call(request, native(false))).toMatchObject({success: true}); expect(await call(request)).toMatchObject({success: true});
        expect(calls.map(call => call.body.model)).toEqual(['image-public', 'image-private']);
        expect(await call(request)).toMatchObject({success: true}); expect(calls).toHaveLength(2);
    });
    it('a direct OCR-text handler obtains its own native provenance instead of public payload claims', async () => {
        expect(await call({type: 'fluentReadImageTranslateTexts', requestId: 'direct-text', texts: ['Synthetic source phrase.'], privateContext: false, serviceOverride: publicService})).toMatchObject({success: true, translations: ['合成译文。']});
        expect(calls[0].body.model).toBe('image-private');
    });
    it.each(['model', 'endpoint', 'body', 'require-key', 'recovery', 'OCR'] as const)('real normalized %s patch cancels a delayed SDK and rejects late output', async field => {
        if (field === 'recovery') await store.requestConfigPatch({token: {[privateService]: 'synthetic-first'}, apiKeys: {[privateService]: ['synthetic-first', 'synthetic-second']}, apiKeyRotationEnabled: {[privateService]: true}});
        const finish = delayNext(), {pending, pair} = await portRequest(); await vi.waitFor(() => expect(calls).toHaveLength(1));
        const patches = {model: {incognitoModel: 'image-next'}, endpoint: {customOpenAIProviders: store.config.customOpenAIProviders.map(provider => ({...provider, endpoint: provider.id === privateService ? 'https://changed.synthetic.test/v1' : provider.endpoint}))},
            body: {customBody: {[privateService]: '{"temperature":0.3}'}}, 'require-key': {requireApiKey: {...store.config.requireApiKey, 'v2:["custom:image-private","image-private"]': true}},
            recovery: {apiKeyRecoveryMs: store.config.apiKeyRecoveryMs === 60_000 ? 120_000 : 60_000}, OCR: {imageTranslationOcrEngine: 'paddle'}};
        const rejected = expect(pending).rejects.toMatchObject({name: 'AbortError'}); await store.requestConfigPatch(patches[field]); await rejected;
        expect(calls[0].signal?.aborted).toBe(true); const replies = vi.mocked(pair.background.postMessage).mock.calls.filter(([message]) => (message as any).kind === 'result');
        finish(); await settle(); expect(vi.mocked(pair.background.postMessage).mock.calls.filter(([message]) => (message as any).kind === 'result')).toHaveLength(replies.length);
    });
    it('closing the native document cancels the SDK and denies the same-URL replacement its late fetch result', async () => {
        await store.requestConfigPatch({maxConcurrentTranslations: 1});
        const finish = delayNext(), old = await portRequest(); await vi.waitFor(() => expect(calls).toHaveLength(1)); old.pair.close(); await expect(old.pending).rejects.toThrow('port closed');
        expect(calls[0].signal?.aborted).toBe(true);
        const replacement = await portRequest(native(), {...request, requestId: request.requestId});
        await vi.waitFor(() => expect(calls).toHaveLength(2)); expect(await replacement.pending).toMatchObject({success: true}); finish(); await settle();
        expect(vi.mocked(old.pair.background.postMessage).mock.calls.filter(([packet]) => (packet as any).kind === 'result')).toHaveLength(0);
        expect(vi.mocked(replacement.pair.background.postMessage).mock.calls.filter(([packet]) => (packet as any).kind === 'result')).toHaveLength(1);
    });
    it('a provider that ignores abort keeps the real broker lease until its provider Promise settles', async () => {
        await store.requestConfigPatch({maxConcurrentTranslations: 1});
        const {translationProviderRegistry} = await import('@/src/providers/translation/registry');
        let finish!: (value: string) => void;
        const provider = vi.spyOn(translationProviderRegistry, 'custom').mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
        const old = await portRequest(); await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce()); old.pair.close(); await expect(old.pending).rejects.toThrow('port closed');
        expect(provider.mock.calls[0][0].abortSignal.aborted).toBe(true);
        const replacement = await portRequest(); await settle(); expect(provider).toHaveBeenCalledOnce(); expect(calls).toHaveLength(0);
        finish('合成迟到译文。'); await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2)); expect(await replacement.pending).toMatchObject({success: true});
        expect(calls[0]).toMatchObject({url: privateURL, body: {model: 'image-private'}});
        expect(vi.mocked(old.pair.background.postMessage).mock.calls.filter(([packet]) => (packet as any).kind === 'result')).toHaveLength(0);
    });
    it('both-empty private native requests retain the original image provider and model', async () => {
        await store.requestConfigPatch({incognitoService: '', incognitoModel: ''});
        expect(await call(request)).toMatchObject({success: true}); expect(calls[0].body.model).toBe('image-public');
    });
    it('removing the private model from a saved provider catalog fails before OCR even when the dedicated fields stay unchanged', async () => {
        await store.requestConfigPatch({customOpenAIProviders: store.config.customOpenAIProviders.map(provider => ({...provider,
            models: provider.id === privateService ? ['image-next', 'private-ordinary'] : provider.models}))});
        expect(store.config.incognitoModel).toBe('image-private'); await expect(call(request)).rejects.toThrow('无效');
        expect(m.send).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
    });
    it('cancelled transactions leave the configuration cancellation set even when the OCR boundary has not settled', async () => {
        let finish!: (value: unknown) => void; ocr = () => new Promise(resolve => {finish = resolve;});
        const {pending} = await portRequest(); await vi.waitFor(() => expect(m.send).toHaveBeenCalledOnce());
        const rejected = expect(pending).rejects.toThrow('取消'); await store.requestConfigPatch({incognitoModel: 'image-next'}); await rejected;
        const abort = vi.spyOn(AbortController.prototype, 'abort');
        await store.requestConfigPatch({incognitoModel: 'image-private'}); expect(abort).not.toHaveBeenCalled();
        finish({success: true, image, lines: []}); await settle(); expect(calls).toHaveLength(0);
    });
    it('native Port captures its sender before frontend mutation and does not borrow the current tab', async () => {
        const sender = native(); const started = await portRequest(sender); (sender.sender!.tab as any).incognito = false;
        expect(await started.pending).toMatchObject({success: true}); expect(calls[0].body.model).toBe('image-private'); expect(m.contexts).not.toHaveBeenCalled();
    });
    it.each(['disconnect', 'configuration'] as const)('async exact-context privacy resolution rechecks %s before starting OCR', async kind => {
        let finish!: (value: unknown) => void; m.contexts.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
        const context = {sender: {id: 'ext', documentId: 'native-ui', frameId: 0, url: 'chrome-extension://ext/options.html'}};
        const {pair, pending} = await portRequest(context); await vi.waitFor(() => expect(m.contexts).toHaveBeenCalledOnce());
        const rejected = expect(pending).rejects.toThrow(kind === 'disconnect' ? 'port closed' : '取消');
        if (kind === 'disconnect') pair.close(); else await store.requestConfigPatch({incognitoModel: 'image-next'});
        finish([{documentId: 'native-ui', contextId: 'native-context', contextType: 'TAB', incognito: true, frameId: 0,
            documentOrigin: 'chrome-extension://ext', documentUrl: context.sender.url}]);
        await rejected; await settle(); expect(m.send).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
    });
    it('a trusted exact native extension context routes the image and malformed/ambiguous contexts remain unknown', async () => {
        const context = {sender: {id: 'ext', documentId: 'native-ui', frameId: 0, url: 'chrome-extension://ext/options.html'}};
        const record = {documentId: 'native-ui', contextId: 'native-context', contextType: 'TAB', incognito: true, frameId: 0,
            documentOrigin: 'chrome-extension://ext', documentUrl: context.sender.url};
        m.contexts.mockResolvedValueOnce([record]); expect(await call(request, context)).toMatchObject({success: true}); expect(calls[0].body.model).toBe('image-private');
        m.contexts.mockResolvedValueOnce([record, record]); await expect(call(request, context)).rejects.toThrow('来源'); expect(calls).toHaveLength(1);
    });
    it('real image-source authorization still precedes remote image retrieval', async () => {
        expect(await call({type: 'fluentReadImageFetch', requestId: 'fetch', url: 'https://cdn.example.com/image.png'})).toMatchObject({success: true, image});
        expect(m.source).toHaveBeenCalledWith(1, expect.objectContaining({type: 'fluentReadImageValidateSource'}), {frameId: 0, documentId: 'image-document'});
        m.source.mockResolvedValueOnce({valid: false}); await expect(call({type: 'fluentReadImageFetch', requestId: 'fetch-again', url: 'https://cdn.example.com/image.png'})).rejects.toThrow('来源已失效');
        expect(m.send.mock.calls.filter(([message]) => message.type === 'FLUENT_READ_IMAGE_FETCH_OFFSCREEN')).toHaveLength(1); expect(calls).toHaveLength(0);
    });
});
