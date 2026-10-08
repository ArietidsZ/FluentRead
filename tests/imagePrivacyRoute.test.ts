/** 原生图片/圈选 Port 与三态 sender、真实 normalize/save/subscriber、handler→能力 probe/broker/SDK→合成 fetch；OCR/裁剪与存储为隔离边界，覆盖冻结有效专用 pair、普通/能力缓存隔离及真实保存取消迟到结果。 */
import 'fake-indexeddb/auto';
import {afterEach, beforeEach, describe, expect, it, vi, type MockInstance} from 'vitest';
import {documentPortPair} from './helpers/imageDocumentPorts';
import type {ImageGlossarySenderContext} from '@/src/app/background/imageGlossaryContext';
const m = vi.hoisted(() => ({values: new Map<string, unknown>(), send: vi.fn(), contexts: vi.fn(), record: vi.fn(), source: vi.fn(), probeLoad: vi.fn(), probeSave: vi.fn()}));
vi.mock('@/src/platform/storage/configStorageRuntime', () => ({configStorage: {
    writeOwner: true, getItem: async (key: string) => m.values.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {m.values.set(key, structuredClone(value));},
    removeItem: async (key: string) => {m.values.delete(key);}, watch: () => () => undefined,
}}));
vi.mock('@/src/platform/offscreen/extensionClient', () => ({extensionDomClient: {send: m.send}}));
vi.mock('@/src/platform/storage/visionProbeStorage', () => ({visionProbeStorage: {load: m.probeLoad, save: m.probeSave}}));
vi.mock('webextension-polyfill', () => ({default: globalThis.browser}));
vi.mock('@/src/platform/storage/modelUsageRepository', () => ({modelUsageRepository: {captureGeneration: () => 1, recordMany: m.record}}));
vi.mock('@/src/platform/storage/translationStatsRepository', () => ({translationStatsRepository: {captureGeneration: () => 1, record: m.record}}));
const publicService = 'custom:image-public', privateService = 'custom:image-private';
const publicURL = 'https://public-image.synthetic.test/v1/chat/completions', privateURL = 'https://private-image.synthetic.test/v1/chat/completions';
const image = 'data:image/png;base64,AQ==';
const native = (incognito: unknown = true): ImageGlossarySenderContext => ({sender: {id: 'ext', documentId: 'image-document', frameId: 0,
    url: 'https://example.test/same?incognito=true', tab: {id: 1, incognito: incognito as boolean}}});
const request = {type: 'fluentReadImageTranslate', requestId: 'image-fixture', image, sourceLanguage: 'en', title: 'Synthetic title'};
function response(model: string, content = '合成译文。') {return new Response(JSON.stringify({id: 'synthetic', object: 'chat.completion', model,
    choices: [{index: 0, message: {role: 'assistant', content}, finish_reason: 'stop'}]}), {headers: {'content-type': 'application/json'}});}
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
    initial.areaTranslationService = publicService; initial.areaTranslationMode = 'standard'; initial.areaRecognitionMode = 'ocr';
    initial.customOpenAIProviders = [{id: publicService, name: 'Synthetic public image', endpoint: publicURL, models: ['image-public']},
        {id: privateService, name: 'Synthetic private image', endpoint: privateURL, models: ['image-private', 'image-next', 'private-ordinary']}];
    initial.model = {[publicService]: 'image-public', [privateService]: 'private-ordinary'};
    initial.incognitoService = privateService; initial.incognitoModel = 'image-private';
    initial.requireApiKey = Object.fromEntries([[publicService, 'image-public'], ...['image-private', 'image-next', 'private-ordinary'].map(model => [privateService, model])]
        .map(pair => [`v2:${JSON.stringify(pair)}`, false]));
    initial.translationMaxRetries = 0; initial.imageTranslationOcrEngine = 'tesseract';
    m.values.set('local:config', initial); m.probeLoad.mockImplementation(async () => m.values.get('vision-probe') ?? []); m.probeSave.mockImplementation(async records => {m.values.set('vision-probe', structuredClone(records));}); m.record.mockResolvedValue(undefined); m.contexts.mockResolvedValue([]); m.source.mockResolvedValue({valid: true});
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
        : message.type === 'FLUENT_READ_IMAGE_FETCH_OFFSCREEN' ? {success: true, image}
        : /^FLUENT_READ_AREA_(?:TRANSLATE|CROP)_OFFSCREEN$/u.test(message.type) ? {success: true, image: 'data:image/png;base64,Ag==', lines: [{text: 'Synthetic source phrase.'}]} : {success: true});
    languages = vi.fn(async () => {});
    const {resolveBrowserCapabilities} = await import('@/src/platform/browser/capabilities');
    app = (await import('@/src/app/background/areaRuntime')).createImageAreaTranslationRuntime({assertDownloaded: languages, getDownloaded: async () => [],
        markDownloaded: async () => [], markRemoved: async () => []} as any, resolveBrowserCapabilities({browser: 'chrome', manifestVersion: 3}));
});

const areaRequest = {...request, type: 'fluentReadAreaTranslateCapture', selection: {left: 0, top: 0, width: 20, height: 20, viewportWidth: 100, viewportHeight: 100}};
async function visionMode(overrides: Record<string, Record<string, boolean>> = {}) {
    await store.requestConfigPatch({areaRecognitionMode: 'prefer-vision', modelVision: overrides});
    const random = crypto.getRandomValues.bind(crypto);
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array: any) => {
        if (array.byteLength === 3) {array.set([0xab, 0xcd, 0xef]); return array;}
        return random(array);
    });
    transport.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)); calls.push({url: String(url), body, signal: init?.signal});
        const probe = JSON.stringify(body).includes('six hexadecimal');
        const vision = JSON.stringify(body).includes('image_url');
        return response(body.model, probe ? 'ABCDEF' : vision ? 'Synthetic source phrase.' : '合成译文。');
    });
}
const phase = (body: any) => JSON.stringify(body).includes('six hexadecimal') ? 'probe' : JSON.stringify(body).includes('image_url') ? 'vision' : 'text';
describe('native area frozen private route through real capability probe, broker and SDK', () => {
    it('OCR stays selected and the actual text SDK/cache identity uses the dedicated pair', async () => {
        expect(await (await portRequest(native(), areaRequest)).pending).toMatchObject({success: true, service: privateService, model: 'image-private', recognitionMethod: 'ocr'});
        expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({url: privateURL, body: {model: 'image-private'}});
        expect(m.send.mock.calls[0][0].type).toBe('FLUENT_READ_AREA_TRANSLATE_OFFSCREEN'); expect(languages).toHaveBeenCalledOnce();
        expect(m.probeSave).not.toHaveBeenCalled(); expect(store.config.areaTranslationService).toBe(publicService); expect(store.config.model[privateService]).toBe('private-ordinary');
    });
    it('the unknown dedicated model is probed before crop using its real endpoint/model, then reused for vision and text', async () => {
        await visionMode();
        const {createVisionProbeIdentity} = await import('@/src/core/config/visionProbe');
        m.values.set('vision-probe', [{identity: createVisionProbeIdentity(store.config, publicService, 'image-public'), capability: 'supported', checkedAt: Date.now()}]);
        const result = await (await portRequest(native(), areaRequest)).pending;
        expect(result).toMatchObject({success: true, service: privateService, model: 'image-private', recognitionMethod: 'vision'});
        expect(calls.map(c => phase(c.body))).toEqual(['probe', 'vision', 'text']);
        expect(calls.every(c => c.url === privateURL && c.body.model === 'image-private')).toBe(true);
        expect(m.send.mock.calls.map(([message]) => message.type)).toEqual(['FLUENT_READ_AREA_CROP_OFFSCREEN']); expect(languages).not.toHaveBeenCalled();
        const saved = m.values.get('vision-probe') as any[];
        const effective = {...store.config, model: {...store.config.model, [privateService]: 'image-private'}, customModel: {...store.config.customModel, [privateService]: 'image-private'}};
        expect(saved.some(r => r.identity === createVisionProbeIdentity(effective, privateService, 'image-private'))).toBe(true);
        expect(JSON.stringify(saved)).not.toMatch(/image-private|base64|ABCDEF/u);
        expect(await call({...areaRequest, requestId: 'area-repeat'})).toMatchObject({success: true, recognitionMethod: 'vision'});
        expect(calls.map(c => phase(c.body))).toEqual(['probe', 'vision', 'text', 'vision']);
    });
    it.each([true, false])('manual dedicated vision=%s is respected without probing or using the ordinary override', async supported => {
        await visionMode({[privateService]: {'image-private': supported}, [publicService]: {'image-public': !supported}});
        expect(await call(areaRequest)).toMatchObject({success: true, recognitionMethod: supported ? 'vision' : 'ocr'});
        expect(calls.map(c => phase(c.body))).toEqual(supported ? ['vision', 'text'] : ['text']);
        expect(calls.every(c => c.url === privateURL && c.body.model === 'image-private')).toBe(true);
        expect(languages).toHaveBeenCalledTimes(supported ? 0 : 1); expect(m.probeSave).not.toHaveBeenCalled();
    });
    it('explicit dedicated image rejection retains the original OCR fallback and translates with the same private model', async () => {
        await visionMode(); transport.mockImplementationOnce(async (url: RequestInfo | URL, init?: RequestInit) => {
            calls.push({url: String(url), body: JSON.parse(String(init?.body)), signal: init?.signal});
            return new Response(JSON.stringify({error: {message: 'This model does not support image input'}}), {status: 400});
        });
        expect(await call(areaRequest)).toMatchObject({success: true, recognitionMethod: 'ocr', recognitionFallback: 'unsupported', service: privateService, model: 'image-private'});
        expect(calls.map(c => phase(c.body))).toEqual(['probe', 'text']); expect(calls.every(c => c.body.model === 'image-private')).toBe(true);
        expect(m.send.mock.calls[0][0].type).toBe('FLUENT_READ_AREA_TRANSLATE_OFFSCREEN'); expect(languages).toHaveBeenCalledOnce();
    });
    it('regular sender ignores forged privacy and an invalid dedicated pair, including before the probe', async () => {
        await visionMode(); await store.requestConfigPatch({incognitoModel: 'missing-model'});
        expect(await call({...areaRequest, privateContext: true, serviceOverride: privateService, modelOverride: 'image-private'}, native(false))).toMatchObject({success: true, service: publicService, model: 'image-public'});
        expect(calls.map(c => phase(c.body))).toEqual(['probe', 'vision', 'text']); expect(calls.every(c => c.url === publicURL && c.body.model === 'image-public')).toBe(true);
    });
    it.each([undefined, 'true', 1])('unknown native source=%s rejects before capability/cache/OCR/SDK', async value => {
        await visionMode(); const sender = native(); (sender.sender!.tab as any).incognito = value;
        expect(await (await portRequest(sender, areaRequest)).pending).toMatchObject({success: false, error: expect.stringContaining('来源')});
        expect(m.send).not.toHaveBeenCalled(); expect(readCache).not.toHaveBeenCalled(); expect(m.probeSave).not.toHaveBeenCalled(); expect(m.probeLoad).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
    });
    it('both-empty dedicated pair retains unknown-source probe and normal area compatibility', async () => {
        await visionMode(); await store.requestConfigPatch({incognitoService: '', incognitoModel: ''}); const sender = native(); delete (sender.sender!.tab as any).incognito;
        expect(await call(areaRequest, sender)).toMatchObject({success: true, service: publicService, model: 'image-public'});
        expect(calls.map(c => phase(c.body))).toEqual(['probe', 'vision', 'text']); expect(calls.every(c => c.body.model === 'image-public')).toBe(true);
    });
    it.each([{incognitoModel: 'missing-model'}, {incognitoService: ''}, {customBody: {[privateService]: '{"model":"private-ordinary"}'}}])('invalid private area configuration stops before probe/cache/OCR: %j', async patch => {
        await visionMode(); await store.requestConfigPatch(patch); await expect(call(areaRequest)).rejects.toThrow(/无效|冲突/u);
        expect(m.send).not.toHaveBeenCalled(); expect(readCache).not.toHaveBeenCalled(); expect(m.probeSave).not.toHaveBeenCalled(); expect(m.probeLoad).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
    });
    it('ordinary area text cache is not reused by the dedicated model', async () => {
        expect(await call(areaRequest, native(false))).toMatchObject({success: true}); expect(await call(areaRequest)).toMatchObject({success: true});
        expect(calls.map(c => c.body.model)).toEqual(['image-public', 'image-private']); expect(await call(areaRequest)).toMatchObject({success: true}); expect(calls).toHaveLength(2);
    });
    it.each(['probe', 'vision', 'text'].flatMap(stage => ['model', 'endpoint'].map(field => [stage, field] as const)))('real normalized %s-phase %s patch cancels SDK and rejects late output/cache', async (stage, field) => {
        await visionMode(stage === 'vision' ? {[privateService]: {'image-private': true}} : stage === 'text' ? {[privateService]: {'image-private': false}} : {});
        const finish = delayNext(), {pending, pair} = await portRequest(native(), areaRequest); await vi.waitFor(() => expect(calls).toHaveLength(1));
        expect(phase(calls[0].body)).toBe(stage); const rejected = expect(pending).rejects.toMatchObject({name: 'AbortError'});
        await store.requestConfigPatch(field === 'model' ? {incognitoModel: 'image-next'} : {customOpenAIProviders: store.config.customOpenAIProviders.map(p => ({...p, endpoint: p.id === privateService ? 'https://changed-area.synthetic.test/v1' : p.endpoint}))}); await rejected; expect(calls[0].signal?.aborted).toBe(true);
        const before = vi.mocked(pair.background.postMessage).mock.calls.filter(([p]) => (p as any).kind === 'result').length;
        finish(); await settle(); expect(vi.mocked(pair.background.postMessage).mock.calls.filter(([p]) => (p as any).kind === 'result')).toHaveLength(before);
        expect((m.values.get('vision-probe') as any[] | undefined)?.some(r => r.capability === 'supported')).not.toBe(true);
        expect(await cache.translationCache.getStats()).toMatchObject({entries: 0});
    });
    it.each(['areaTranslationService', 'areaTranslationMode', 'areaRecognitionMode', 'areaVisionPrompt', 'modelVision'] as const)('actual save subscription cancels active area work after %s changes', async field => {
        let finish!: (value: unknown) => void; m.send.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
        const {pending} = await portRequest(native(), areaRequest); await vi.waitFor(() => expect(m.send).toHaveBeenCalledOnce());
        const patch = {areaTranslationService: 'google', areaTranslationMode: 'ai', areaRecognitionMode: 'prefer-vision', areaVisionPrompt: 'Synthetic changed prompt', modelVision: {[privateService]: {'image-private': true}}};
        const rejected = expect(pending).rejects.toMatchObject({name: 'AbortError'}); await store.requestConfigPatch({[field]: patch[field]}); await rejected;
        finish({success: true, image, lines: [{text: 'late synthetic text'}]}); await settle(); expect(calls).toHaveLength(0);
    });
    it('closing the native area document cancels a delayed probe and denies a same-URL replacement its late result', async () => {
        await visionMode(); const finish = delayNext(), old = await portRequest(native(), areaRequest); await vi.waitFor(() => expect(calls).toHaveLength(1)); old.pair.close(); await expect(old.pending).rejects.toThrow('port closed');
        expect(calls[0].signal?.aborted).toBe(true); finish(); await settle();
        expect(vi.mocked(old.pair.background.postMessage).mock.calls.filter(([p]) => (p as any).kind === 'result')).toHaveLength(0);
        expect((m.values.get('vision-probe') as any[]).some(r => r.capability === 'supported')).toBe(false);
        expect(await (await portRequest(native(), areaRequest)).pending).toMatchObject({success: true, recognitionMethod: 'vision'});
        expect(calls.filter(c => phase(c.body) === 'probe')).toHaveLength(2);
    });
    it('an inconclusive dedicated probe retains OCR fallback and never probes an ordinary model', async () => {
        await visionMode(); transport.mockImplementationOnce(async (url: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body)); calls.push({url: String(url), body, signal: init?.signal}); return response(body.model, 'UNKNOWN');
        });
        expect(await call(areaRequest)).toMatchObject({success: true, recognitionMethod: 'ocr', recognitionFallback: 'unknown', model: 'image-private'});
        expect(calls.map(c => phase(c.body))).toEqual(['probe', 'text']); expect(calls.every(c => c.url === privateURL && c.body.model === 'image-private')).toBe(true);
        expect((m.values.get('vision-probe') as any[]).some(r => r.capability === 'supported')).toBe(false); expect(languages).toHaveBeenCalledOnce();
    });
    it.each(['authentication', 'network'] as const)('a dedicated probe %s error does not fall back to OCR or ordinary routing', async kind => {
        await visionMode(); transport.mockImplementationOnce(async (url: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body)); calls.push({url: String(url), body, signal: init?.signal});
            if (kind === 'network') throw new TypeError('synthetic network failure');
            return new Response(JSON.stringify({error: {message: 'synthetic authentication failure'}}), {status: 401});
        });
        expect(await (await portRequest(native(), areaRequest)).pending).toMatchObject({success: false});
        expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({url: privateURL, body: {model: 'image-private'}});
        expect(m.send).not.toHaveBeenCalled(); expect(languages).not.toHaveBeenCalled(); expect(readCache).not.toHaveBeenCalled();
    });
    it('exact native context preparation freezes area model and endpoint before the source gate returns', async () => {
        let finish!: (value: unknown) => void; m.contexts.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
        const context = {sender: {id: 'ext', documentId: 'area-native-ui', frameId: 0, url: 'chrome-extension://ext/options.html'}};
        const started = await portRequest(context, areaRequest); await vi.waitFor(() => expect(m.contexts).toHaveBeenCalledOnce());
        // Deliberate in-memory mutation without publishing a save tests the frozen snapshot, independently of cancellation subscription.
        store.config.incognitoModel = 'image-next'; store.config.model[privateService] = 'image-next';
        store.config.customOpenAIProviders.find(p => p.id === privateService)!.endpoint = 'https://late.synthetic.test/v1';
        finish([{documentId: 'area-native-ui', contextId: 'area-exact', contextType: 'TAB', incognito: true, frameId: 0,
            documentOrigin: 'chrome-extension://ext', documentUrl: context.sender.url}]);
        expect(await started.pending).toMatchObject({success: true, model: 'image-private'});
        expect(calls[0]).toMatchObject({url: privateURL, body: {model: 'image-private'}});
    });
    it('the internal area factory keeps the unmarked both-empty compatibility path on a real connected owner', async () => {
        await store.requestConfigPatch({incognitoService: '', incognitoModel: ''});
        const sender = native(false); (sender.sender!.tab as any).windowId = 2;
        const handler = app.handlers.find(h => h.type === areaRequest.type)!; const handle = vi.spyOn(handler, 'handle');
        expect(await (await portRequest(sender, areaRequest)).pending).toMatchObject({success: true});
        const context = handle.mock.calls[0][1];
        const bare = (await import('@/src/app/background/areaRuntime')).createAreaTranslationRuntime(languages);
        expect(await bare[1].handle({...areaRequest, type: 'fluentReadAreaTranslateCapture', requestId: 'bare-compatible'}, context)).toMatchObject({success: true, model: 'image-public'});
        (globalThis.browser.tabs as any).get = vi.fn(async (id: number) => ({id, windowId: 2, active: true}));
        (globalThis.browser.tabs as any).captureVisibleTab = vi.fn(async () => image);
        expect(await bare[0].handle({type: 'fluentReadAreaCapture', requestId: 'bare-capture'}, context)).toMatchObject({success: true, image});
        expect(globalThis.browser.tabs.captureVisibleTab).toHaveBeenCalledWith(2, {format: 'png'});
        app.releaseTab(1);
        await expect(bare[1].handle({...areaRequest, type: 'fluentReadAreaTranslateCapture', requestId: 'released'}, context)).rejects.toThrow(/文档|连接/u);
    });
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
    it.each(['disconnect', 'configuration'] as const)('async exact-context privacy resolution ends %s dispatch before getContexts returns', async kind => {
        let finish!: (value: unknown) => void; m.contexts.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
        const context = {sender: {id: 'ext', documentId: 'native-ui', frameId: 0, url: 'chrome-extension://ext/options.html'}};
        const handler = app.handlers.find(h => h.type === request.type)!; const handle = vi.spyOn(handler, 'handle');
        const {pair, pending} = await portRequest(context); await vi.waitFor(() => expect(m.contexts).toHaveBeenCalledOnce());
        let ended = false; void Promise.resolve(handle.mock.results[0].value).then(() => {ended = true;}, () => {ended = true;});
        const rejected = expect(pending).rejects.toThrow(kind === 'disconnect' ? 'port closed' : '取消');
        try {
            if (kind === 'disconnect') pair.close(); else await store.requestConfigPatch({incognitoModel: 'image-next'});
            await vi.waitFor(() => expect(ended).toBe(true)); await rejected;
            expect(m.send).not.toHaveBeenCalled(); expect(calls).toHaveLength(0);
        } finally {
            finish([{documentId: 'native-ui', contextId: 'native-context', contextType: 'TAB', incognito: true, frameId: 0,
                documentOrigin: 'chrome-extension://ext', documentUrl: context.sender.url}]); await settle();
        }
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
    it('a permitted Offscreen child restores the native area snapshot provenance in the actual broker adapter', async () => {
        await store.requestConfigPatch({areaRecognitionMode: 'ocr'});
        let restored: any;
        m.send.mockImplementationOnce(async message => {
            expect(message.type).toBe('FLUENT_READ_AREA_TRANSLATE_OFFSCREEN');
            restored = await call({type: 'fluentReadImageTranslateTexts', requestId: message.requestId,
                texts: ['Synthetic restored source.']}, offscreen());
            // 只验证已归属的 Offscreen 子调用恢复同一圈选来源；外层在 OCR 边界停止。
            return {success: false, error: 'synthetic stop after restoration'};
        });
        const {pending} = await portRequest(native(), {...request, type: 'fluentReadAreaTranslateCapture',
            selection: {left: 0, top: 0, width: 20, height: 20, viewportWidth: 100, viewportHeight: 100}} as any);
        expect(await pending).toMatchObject({success: false, error: 'synthetic stop after restoration'});
        expect(restored).toMatchObject({success: true}); expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({url: privateURL, body: {model: 'image-private'}});
    });
});
