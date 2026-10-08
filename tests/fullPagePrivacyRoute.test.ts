/** 实际 content composition→全页入口/快照/DOM→文本 Port/handler/registry→broker/SDK/cache；仅其他 feature、浏览器/存储边界、布局与合成 HTTP 使用离线夹具。 */
import 'fake-indexeddb/auto';
import {afterEach, beforeEach, describe, expect, it, vi, type MockInstance} from 'vitest';
import {parseHTML} from 'linkedom';
import {documentPortPair} from './helpers/imageDocumentPorts';
import {Config} from '@/src/core/config/model';
import * as catalog from '@/src/core/config/catalog';
const m = vi.hoisted(() => ({values: new Map<string, unknown>(), contexts: vi.fn(), record: vi.fn(), target: 'firefox', pageRuntime: {} as Record<string, any>, shareMounted: false, nativeAPI: {} as Record<string, any>}));
vi.mock('@/src/platform/storage/configStorageRuntime', () => ({configStorage: {
    writeOwner: true, getItem: async (key: string) => m.values.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {m.values.set(key, structuredClone(value));},
    removeItem: async (key: string) => {m.values.delete(key);}, watch: () => () => undefined,
}}));
vi.mock('webextension-polyfill', () => ({default: new Proxy({}, {get: (_target, key) => Reflect.get(m.nativeAPI, key)})}));
vi.mock('@/src/platform/browser/capabilities', async original => ({
    ...await original<object>(), browserCapabilities: {get browser() {return m.target;}, manifestVersion: 2},
}));
vi.mock('@/src/platform/storage/modelUsageRepository', () => ({modelUsageRepository: {captureGeneration: () => 1, recordMany: m.record}}));
vi.mock('@/src/platform/storage/translationStatsRepository', () => ({translationStatsRepository: {captureGeneration: () => 1, record: m.record}}));


vi.mock('wxt/utils/content-script-ui/shadow-root', () => ({createShadowRootUi: vi.fn()}));
vi.mock('@/src/features/page-notice/public', () => ({sendErrorMessage: m.record}));
vi.mock('@/src/app/content/learningFeatures', () => ({createLearningContentFeatures: () => []}));
vi.mock('@/src/app/content/pageStyles', () => ({installPageStyles: () => () => {}}));
vi.mock('@/src/platform/i18n/uiLanguageBundles', () => ({ensureUiLanguageBundle: async () => {}}));
vi.mock('@/src/app/content/hotkeyRuntime', () => ({createContentHotkeyRuntime: () => ({installFloatingBallHotkey: () => () => {}, selectionShortcutPorts: {}})}));
vi.mock('@/src/app/content/quickTranslationRuntime', () => ({mountConfiguredQuickTranslation: () => {}}));
vi.mock('@/src/app/content/qqMailFrameRuntime', () => ({installQqMailTopFrameBridge: () => undefined, installNeteaseMailTopFrameBridge: () => undefined}));
vi.mock('@/src/app/content/embeddedFrameRuntime', () => ({installEmbeddedTopFrameBridge: () => {}}));
vi.mock('@/src/app/content/mainWorldBridgeLifecycle', () => ({setMainWorldBridgesEnabled: () => {}}));
vi.mock('@/src/app/content/messageRuntime', () => ({createContentRuntimeMessageHandler: () => () => {}}));
vi.mock('@/src/app/content/bilingualSentenceHighlight', () => ({syncBilingualSentenceHighlight: () => {}}));
vi.mock('@/src/app/content/features', async () => ({
    ...Object.fromEntries(['autoTranslateEnglishPage','cancelPendingHoverTranslation','handleTranslation','isFullPageTranslationActive','restoreOriginalContent','resetFullPageTranslationRouteState'].map(name => [name, (...args: any[]) => m.pageRuntime[name](...args)])),
    ...Object.fromEntries(['mountAreaTranslator', 'mountFloatingBall', 'mountImageTranslator', 'mountSelectionTranslator',
        'mountMangaEntry', 'unmountMangaEntry', 'mountTranslationProgressPanel', 'mountVideoSubtitleTranslation',
        'mountParagraphCopyContentFeature', 'mountSectionTranslationContentFeature', 'unmountAreaTranslator',
        'unmountFloatingBall', 'unmountImageTranslator', 'unmountSelectionTranslator', 'unmountTranslationProgressPanel',
        'mountVocabularyReencounter', 'unmountVocabularyReencounter', 'mountShareCard', 'unmountShareCard',
        'isFloatingBallAllowedOnPage', 'isAreaTranslatorMounted', 'isImageTranslatorNeeded', 'isMangaReaderPage',
        'isSupportedVideoPage', 'isShareCardMounted', 'startAreaTranslationFromContextMenu', 'noteBilingualHostGesture'].map(name => [name, () => false])),
    mountShareCard: () => {m.shareMounted = true;}, unmountShareCard: () => {m.shareMounted = false;}, isShareCardMounted: () => m.shareMounted,
    imageDocumentClient: () => undefined, inputBoxTranslationConfigKey: () => '',
    createInputTranslationContentFeature: () => ({mount: () => {}, invalidate: () => {}}),
    mountHoverTranslationContentFeature: () => () => {},
}));
vi.mock('@/src/features/full-page-translation/public', () => ({restoreOriginalContent: (...args: any[]) => m.pageRuntime.restoreOriginalContent(...args)}));
vi.mock('@/src/services/translation/context', () => ({
    resetPageTranslationContextCache: vi.fn(), getPageTranslationContext: vi.fn(async () => 'Synthetic readable page context.'),
}));
class BoundaryObserver {
    static instances: BoundaryObserver[] = [];
    observed = new Set<Element>();
    constructor(readonly callback: (...args: any[]) => void) {BoundaryObserver.instances.push(this);}
    observe(target: Element) {this.observed.add(target);}
    unobserve(target: Element) {this.observed.delete(target);}
    disconnect() {this.observed.clear();}
    takeRecords() {return [];}
}
const publicService = 'custom:document-public', privateService = 'custom:document-private';
const publicURL = 'https://public-document.synthetic.test/v1/chat/completions';
const privateURL = 'https://private-document.synthetic.test/v1/chat/completions';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const settle = async () => {await tick(); await tick();};
function response(model = 'document-private', content = `合成译文 ${model}`) {
    return new Response(JSON.stringify({id: 'synthetic', object: 'chat.completion', model,
        choices: [{index: 0, message: {role: 'assistant', content}, finish_reason: 'stop'}]}), {headers: {'content-type': 'application/json'}});
}
function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};}
let store: typeof import('@/src/services/config/store');
let runtime: typeof import('@/src/features/full-page-translation/content/runtime');
let cache: typeof import('@/src/services/translation/cache');
let cacheRead: MockInstance, cacheWrite: MockInstance, cacheIdentity: MockInstance;
let transport: ReturnType<typeof vi.fn>, resetFetch: () => void;
let calls: Array<{url: string; body: any; signal?: AbortSignal | null}>;
let dispatch: ReturnType<typeof vi.fn>, nativeSender: any, browserBoundary: any;
let server: ReturnType<typeof import('@/src/services/translation/documentChannel').createTranslationDocumentPortHandler>;
let pairs: ReturnType<typeof documentPortPair>[];
let pendingResponses: Array<(value: Response) => void>;
let disposeContent: () => void, context: any;
async function pump(until: () => boolean = () => false, rounds = 400) {
    for (let i = 0; i < rounds && !until(); i++) {await vi.advanceTimersByTimeAsync(10); await settle();}
}
function paragraph(id = 'source') {return document.getElementById(id)! as HTMLElement;}
function trustedPagehide(persisted = false) {
    const event = new window.Event('pagehide'); Object.assign(event, {persisted});
    Object.defineProperty(event, 'isTrusted', {value: true}); window.dispatchEvent(event);
}
beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks(); m.values.clear(); m.target = 'firefox'; m.record.mockResolvedValue(undefined);
    calls = []; pairs = []; pendingResponses = []; BoundaryObserver.instances = []; m.shareMounted = false; vi.useFakeTimers({toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']});
    const dom = parseHTML('<html><head><title>Synthetic page source title</title></head><body><main><p id="source">Readable synthetic source paragraph.</p></main></body></html>');
    for (const key of ['window','document','Node','Element','HTMLElement','Text','ShadowRoot','DOMParser'] as const) vi.stubGlobal(key, dom.window[key]);
    vi.stubGlobal('MutationObserver', BoundaryObserver); vi.stubGlobal('IntersectionObserver', BoundaryObserver);
    vi.stubGlobal('getComputedStyle', () => ({display: 'block', visibility: 'visible', opacity: '1', position: 'static', whiteSpace: 'normal', overflowY: 'visible', getPropertyValue: () => ''}));
    vi.stubGlobal('innerHeight', 800); vi.stubGlobal('scrollY', 0); vi.stubGlobal('scrollX', 0); vi.stubGlobal('scrollBy', vi.fn());
    const location = {protocol: 'https:', href: 'https://page.synthetic.test/article'};
    vi.stubGlobal('location', location);
    Object.defineProperty(document, 'location', {configurable: true, value: location});
    Object.defineProperty(document, 'URL', {configurable: true, value: location.href});
    Object.defineProperty(document, 'contentType', {configurable: true, value: 'text/html'});
    Object.defineProperty(window.HTMLElement.prototype, 'getClientRects', {configurable: true, value: () => Object.assign([{width: 600, height: 60, top: 0, left: 0, bottom: 60, right: 600}], {item: () => null})});
    Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {configurable: true, value: () => ({width: 600, height: 60, top: 0, left: 0, bottom: 60, right: 600})});
    nativeSender = {id: 'ext', documentId: 'native-page-document', frameId: 0, url: location.href, tab: {id: 4, incognito: true}};
    browserBoundary = {extension: {inIncognitoContext: true}, runtime: {
        id: 'ext', getURL: (path: string) => `moz-extension://ext/${path.replace(/^\//u, '')}`, getContexts: m.contexts,
        connect: vi.fn(() => {
            const pair = documentPortPair(nativeSender);
            const client = {...pair.client, name: 'fluentReadTranslationDocument:v1'};
            const background = {...pair.background, name: 'fluentReadTranslationDocument:v1'};
            pairs.push(pair); expect(server.connect(background)).toBe(true); return client;
        }), sendMessage: vi.fn(async (message: any) => message.type === 'incrementConfigCount'
            ? {success: true, count: await store.incrementConfigCount(message.delta, message.operationId)}
            : 'origin' in message || message.type === 'cancelTranslation' ? (await dispatch(message, {sender: nativeSender})).response : {success: true}),
        onMessage: {addListener: vi.fn(), removeListener: vi.fn()},
    }, tabs: {create: vi.fn().mockResolvedValue({})}};
    m.nativeAPI=browserBoundary;vi.stubGlobal('browser', browserBoundary);
    const initial = new Config();
    initial.service = initial.documentService = publicService;
    initial.customOpenAIProviders = [
        {id: publicService, name: 'Synthetic public document', endpoint: publicURL, models: ['document-public']},
        {id: privateService, name: 'Synthetic private document', endpoint: privateURL, models: ['document-private', 'document-next', 'private-ordinary']},
    ];
    initial.model = {[publicService]: 'document-public', [privateService]: 'private-ordinary'};
    initial.documentModel = {[publicService]: 'document-public', [privateService]: 'private-ordinary'};
    initial.incognitoService = privateService; initial.incognitoModel = 'document-private';
    initial.requireApiKey = Object.fromEntries([[publicService, 'document-public'], ...['document-private', 'document-next', 'private-ordinary'].map(model => [privateService, model])]
        .map(pair => [`v2:${JSON.stringify(pair)}`, false]));
    initial.display = 1; initial.fullPageTranslationMode = 'all'; initial.pageTitleTranslationEnabled = false;
    initial.disableFloatingBall = true; initial.disableSelectionTranslator = true; initial.disableImageTranslator = true; initial.selectionAreaEnabled = false;
    initial.translationProgressPanelEnabled = false; initial.vocabularyReencounterEnabled = false; initial.alwaysTranslateDomains = []; initial.enableAIMultiSegment = false;
    initial.from = 'en'; initial.to = 'zh-Hans'; initial.enableAIContext = false; initial.translationMaxRetries = 0;
    m.values.set('local:config', initial); m.contexts.mockResolvedValue([]);
    store = await import('@/src/services/config/store'); await store.configReady;
    const http = await import('@/src/platform/http/runtime'); resetFetch = () => http.setRuntimeFetch();
    transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)); calls.push({url: String(url), body, signal: init?.signal});
        const userText = String(body.messages?.findLast((message: any) => message.role === 'user')?.content ?? '');
        const packets = [...userText.matchAll(/(___FLUENTREAD_([a-z0-9_-]+)_(\d+)_BEGIN___)[\s\S]*?(___FLUENTREAD_\2_\3_END___)/giu)];
        return Array.isArray(body) ? new Response(JSON.stringify(body.map(() => ({translations: [{text: '合成批量译文'}]}))), {headers: {'content-type': 'application/json'}})
            : response(body.model, packets.length ? packets.map(match => `${match[1]}\n合成分段译文 ${match[3]}\n${match[4]}`).join('\n') : `合成译文 ${body.model}`);
    }); http.setRuntimeFetch(transport);
    cache = await import('@/src/services/translation/cache'); await cache.translationCache.clear();
    cacheRead = vi.spyOn(cache.translationCache, 'get'); cacheWrite = vi.spyOn(cache.translationCache, 'set'); cacheIdentity = vi.spyOn(cache, 'buildTranslationCacheKey');
    const handlers = await import('@/src/app/background/handlers/translation');
    const {createBackgroundMessageRouter} = await import('@/src/app/background/messageRouter');
    const backend = await import('@/src/app/translation/runtime');
    const registry = handlers.createTranslationRequestRegistry(true);
    const {serializeTranslationError} = await import('@/src/services/translation/errors');
    const router = createBackgroundMessageRouter<any>([handlers.createTranslationCancelHandler(registry)],
        handlers.createNativeTranslationRequestFallback(browserBoundary.runtime, {ready: store.configReady,
            translate: backend.translateWithCache, serializeError: serializeTranslationError, requestRegistry: registry, requireDocumentOwner: true}));
    dispatch = vi.fn((message, context) => router.dispatch(message, context));
    server = (await import('@/src/services/translation/documentChannel')).createTranslationDocumentPortHandler({runtimeId: 'ext', dispatch, registries: [registry]});
    runtime = await import('@/src/features/full-page-translation/content/runtime'); m.pageRuntime = runtime;
    context = {isInvalid: false, onInvalidated: (fn: () => void) => {disposeContent = fn;}};
    await (await import('@/src/app/content/runtime')).startContentApp(context, {browser: m.target, manifestVersion: 2} as any);
});

afterEach(async () => {
    disposeContent?.(); runtime?.restoreOriginalContent(); pairs.forEach(pair => pair.close());
    pendingResponses.forEach(finish => finish(response('document-private', '迟到合成译文')));
    (await import('@/src/app/translation/client')).cancelAllTranslations();
    await settle(); resetFetch?.(); await cache.translationCache.clear(); cache.translationCacheDb.close();
    vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function delaySDK() {
    const gate = deferred<Response>(); pendingResponses.push(gate.resolve);
    transport.mockImplementationOnce(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({url: String(url), body: JSON.parse(String(init?.body)), signal: init?.signal}); return gate.promise;
    }); return gate;
}
const translationRequests = () => dispatch.mock.calls.map(([message]) => message).filter(message => 'origin' in message);

describe('full-page native effective route through actual content lifetime', () => {
    it('uses the dedicated pair before ordinary missing-model precheck and commits real DOM translation', async () => {
        await store.requestConfigPatch({service: catalog.services.openai, model: {}, customModel: {}});
        runtime.autoTranslateEnglishPage(); await pump(() => calls.length > 0); await pump(() => paragraph().querySelector('[data-fr-translation-owned]') !== null);
        expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({url: privateURL, body: {model: 'document-private'}});
        expect(translationRequests()[0]).toMatchObject({serviceOverride: privateService, modelOverride: 'document-private'});
        expect(paragraph().textContent).toContain('合成译文'); expect(paragraph().textContent).toContain('Readable synthetic source paragraph.');
        runtime.restoreOriginalContent(); expect(paragraph().textContent).toBe('Readable synthetic source paragraph.');
    });
    it('uses dedicated prompt/context/thinking capability despite an ordinary qwen-mt model', async () => {
        const ordinaryModel = catalog.models.get(catalog.services.tongyi)!.find(model => model.startsWith('qwen-mt'))!;
        await store.requestConfigPatch({service: catalog.services.tongyi, model: {[catalog.services.tongyi]: ordinaryModel}, enableAIContext: true,
            modelThinking: {[privateService]: {'document-private': true}},
            system_role: {[catalog.services.tongyi]: 'PUBLIC_PAGE_SYSTEM', [privateService]: 'PRIVATE_PAGE_SYSTEM'}});
        runtime.autoTranslateEnglishPage(); await pump(() => calls.length > 0); await pump(() => paragraph().textContent!.includes('合成译文'));
        expect(runtime.getFullPageTranslationFrameState().translationConfig).toMatchObject({service: privateService, model: 'document-private', thinking: true});
        expect(store.config.system_role[privateService]).toBe('PRIVATE_PAGE_SYSTEM');
        expect(translationRequests()[0]).toMatchObject({pageContext: 'Synthetic readable page context.', serviceOverride: privateService, modelOverride: 'document-private'});
        expect(calls.every(call => call.url === privateURL && call.body.model === 'document-private')).toBe(true);
        expect(JSON.stringify(calls.map(call => call.body))).toContain('PRIVATE_PAGE_SYSTEM'); expect(JSON.stringify(calls.map(call => call.body))).not.toContain('PUBLIC_PAGE_SYSTEM');
    });
    it('overrides public quick-profile/inherited service/model with the native page dedicated pair', async () => {
        const {captureFullPageTranslationConfig} = await import('@/src/features/full-page-translation/content/translationRequest');
        const inherited = {...captureFullPageTranslationConfig(), service: publicService, model: 'document-public', sourceLanguage: 'en', profileId: 'public-profile'};
        runtime.autoTranslateEnglishPage({service: catalog.services.google, model: 'public-profile-model', displayMode: 'single'}, inherited);
        await pump(() => calls.length > 0);
        expect(calls[0]).toMatchObject({url: privateURL, body: {model: 'document-private'}});
        expect(runtime.getFullPageTranslationFrameState().translationConfig).toMatchObject({service: privateService, model: 'document-private', profileId: 'public-profile'});
    });
    it('keeps private transport IDs and local configuration identity out of provider and persistent cache', async () => {
        runtime.autoTranslateEnglishPage(); await pump(() => paragraph().textContent!.includes('合成译文'));
        expect(translationRequests()[0].clientRequestId).toEqual(expect.any(String));
        expect(JSON.stringify([calls.map(call => call.body),cacheIdentity.mock.calls])).not.toMatch(/clientRequestId|native-page-document|native-document-port|incognito|privateContext|fullPageConfigKey/u);
        expect(cacheRead.mock.calls.every(([key]) => /^v3:[a-f0-9]{64}$/u.test(key))).toBe(true);
    });
    it('isolates ordinary cache, reuses private cache and changes endpoint identity after a real save', async () => {
        nativeSender.tab.incognito = false; browserBoundary.extension.inIncognitoContext = false;
        runtime.autoTranslateEnglishPage(); await pump(() => paragraph().textContent!.includes('合成译文'));
        expect(calls[0].url).toBe(publicURL); runtime.restoreOriginalContent();
        pairs.forEach(pair => pair.close());
        nativeSender.tab.incognito = true; browserBoundary.extension.inIncognitoContext = true;
        runtime.autoTranslateEnglishPage(); await pump(() => paragraph().textContent!.includes('合成译文'));
        expect(calls).toHaveLength(2); expect(calls[1].url).toBe(privateURL); runtime.restoreOriginalContent();
        runtime.autoTranslateEnglishPage(); await pump(() => paragraph().textContent!.includes('合成译文'));
        expect(calls).toHaveLength(2);
        await store.requestConfigPatch({customOpenAIProviders: store.config.customOpenAIProviders.map(item => item.id === privateService ? {...item,endpoint:'https://next-document.synthetic.test/v1/chat/completions'} : item)});
        expect(paragraph().textContent).toBe('Readable synthetic source paragraph.');
        runtime.autoTranslateEnglishPage(); await pump(() => paragraph().textContent!.includes('合成译文'));
        expect(calls).toHaveLength(3);expect(calls[2].url).toBe('https://next-document.synthetic.test/v1/chat/completions');
    });
    it.each([undefined, 'true', 1])('frontend hint cannot authorize unknown native evidence %s', async nativeHint => {
        nativeSender.tab.incognito = nativeHint;
        runtime.autoTranslateEnglishPage();await pump();
        expect(calls).toHaveLength(0);expect(cacheRead).not.toHaveBeenCalled();expect(cacheWrite).not.toHaveBeenCalled();
        expect(paragraph().textContent).toContain('Readable synthetic source paragraph.');expect(paragraph().textContent).not.toContain('合成译文');
    });
    it.each([undefined, 'true', 1])('unknown frontend hint %s rejects configured pair before native request or cache', async frontendHint => {
        browserBoundary.extension.inIncognitoContext = frontendHint;
        runtime.autoTranslateEnglishPage(); await pump();
        expect(translationRequests()).toHaveLength(0);expect(calls).toHaveLength(0);expect(cacheRead).not.toHaveBeenCalled();
        expect(runtime.isFullPageTranslationActive()).toBe(false);expect(paragraph().textContent).toBe('Readable synthetic source paragraph.');
    });
    it.each([false, true, undefined])('both-empty remains compatible for page privacy %s', async privacy => {
        await store.requestConfigPatch({incognitoService:'',incognitoModel:''});
        browserBoundary.extension.inIncognitoContext=privacy;nativeSender.tab.incognito=privacy;
        runtime.autoTranslateEnglishPage();await pump(() => paragraph().textContent!.includes('合成译文'));
        expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({url:publicURL,body:{model:'document-public'}});
    });
    it('ordinary native page ignores invalid dedicated pair and keeps its ordinary route', async () => {
        browserBoundary.extension.inIncognitoContext=false;nativeSender.tab.incognito=false;
        await store.requestConfigPatch({incognitoService:privateService,incognitoModel:'missing-private-model'});
        runtime.autoTranslateEnglishPage();await pump(() => paragraph().textContent!.includes('合成译文'));
        expect(calls).toHaveLength(1);expect(calls[0].url).toBe(publicURL);
    });
    it.each([
        {incognitoModel:'missing-private-model'},
        {incognitoService:'',incognitoModel:'document-private'},
        {customBody:{[privateService]:JSON.stringify({model:'wrong-private-model'})}},
    ])('invalid configured pair/body stops before client, cache and SDK: %j', async patch => {
        await store.requestConfigPatch(patch);
        runtime.autoTranslateEnglishPage();await pump();
        expect(runtime.isFullPageTranslationActive()).toBe(false);expect(translationRequests()).toHaveLength(0);
        expect(calls).toHaveLength(0);expect(cacheRead).not.toHaveBeenCalled();expect(paragraph().textContent).toBe('Readable synthetic source paragraph.');
    });
    it('requires dedicated credentials at the authoritative broker boundary', async () => {
        await store.requestConfigPatch({requireApiKey:{...store.config.requireApiKey,[`v2:${JSON.stringify([privateService,'document-private'])}`]:true}});
        runtime.autoTranslateEnglishPage();await pump();
        expect(calls).toHaveLength(0);expect(cacheWrite).not.toHaveBeenCalled();expect(paragraph().textContent).not.toContain('合成译文');
    });
    const savedPatches = [
        ['model', () => ({incognitoModel:'document-next'})],
        ['endpoint', () => ({customOpenAIProviders:store.config.customOpenAIProviders.map(item => item.id===privateService ? {...item,endpoint:'https://changed-document.synthetic.test/v1/chat/completions'}:item)})],
        ['ordinary-model', () => ({model:{...store.config.model,[publicService]:'ordinary-changed'}})],
        ['prompt', () => ({system_role:{[privateService]:'CHANGED_PRIVATE_SYSTEM'}})],
        ['context', () => ({enableAIContext:true})],
        ['cache', () => ({useCache:false})],
        ['language', () => ({to:'de'})],
        ['excluded-language', () => ({excludedLanguages:['ja']})],
        ['display', () => ({display:0})],
        ['multi-segment', () => ({enableAIMultiSegment:true})],
        ['sidebar-scope', () => ({sidebarTranslationEnabled:!store.config.sidebarTranslationEnabled})],
    ] as const;
    it.each(savedPatches)('actual save/subscriber %s cancels SDK and late DOM/cache while retaining source Text', async (_name,patch) => {
        const node=paragraph(),source=node.firstChild,gate=delaySDK();
        runtime.autoTranslateEnglishPage();await pump(() => calls.length>0);
        expect(calls).toHaveLength(1);expect(calls[0].signal?.aborted).toBe(false);
        const savedPatch=patch();await store.requestConfigPatch(savedPatch);
        expect(calls[0].signal?.aborted).toBe(true);expect(runtime.isFullPageTranslationActive()).toBe(false);
        expect(node.firstChild).toBe(source);expect(node.textContent).toBe('Readable synthetic source paragraph.');
        expect(m.values.get('local:config')).toMatchObject(savedPatch);
        gate.resolve(response('document-private','迟到私密译文'));await pump();
        expect(node.firstChild).toBe(source);expect(node.textContent).toBe('Readable synthetic source paragraph.');expect(cacheWrite).not.toHaveBeenCalled();
    });
    it.each(['route','pagehide','bfcache','close','disable','port'])('%s ends old generation and blocks late DOM/cache', async boundary => {
        const node=paragraph(),source=node.firstChild,gate=delaySDK();runtime.autoTranslateEnglishPage();await pump(() => calls.length>0);
        if(boundary==='route') {location.href='https://page.synthetic.test/next';document.dispatchEvent(new window.Event('fluentread-route-change'));}
        else if(boundary==='pagehide'||boundary==='bfcache')trustedPagehide(boundary==='bfcache');
        else if(boundary==='close') {context.isInvalid=true;disposeContent();}
        else if(boundary==='disable')await store.requestConfigPatch({on:false});
        else pairs.forEach(pair=>pair.close());
        await settle();expect(calls[0].signal?.aborted).toBe(true);
        gate.resolve(response('document-private','迟到页面译文'));await pump();
        expect(node.textContent).not.toContain('迟到页面译文');expect(node.textContent).toContain('Readable synthetic source paragraph.');expect(cacheWrite).not.toHaveBeenCalled();
        if(boundary!=='port')expect(node.firstChild).toBe(source);
    });
    it('route/config restoration keeps host edits and starts a fresh dedicated model generation', async () => {
        runtime.autoTranslateEnglishPage();await pump(() => paragraph().textContent!.includes('合成译文'));
        const node=paragraph();node.firstChild!.nodeValue='Host replaced the readable page source.';
        await store.requestConfigPatch({incognitoModel:'document-next'});
        expect(node.textContent).toBe('Host replaced the readable page source.');
        runtime.autoTranslateEnglishPage();await pump(() => calls.length===2);await pump(() => node.textContent!.includes('合成译文'));
        expect(runtime.getFullPageTranslationFrameState().translationConfig).toMatchObject({model:'document-next'});
        expect(translationRequests()).toHaveLength(2);
        expect(calls[1].body.model).toBe('document-next');expect(node.textContent).toContain('Host replaced the readable page source.');
    });
    it('title and body SDK requests share dedicated route and abort on actual save before late title/DOM writes', async () => {
        await store.requestConfigPatch({pageTitleTranslationEnabled:true});
        const gates:ReturnType<typeof deferred<Response>>[]=[];
        transport.mockImplementation(async(url:RequestInfo|URL,init?:RequestInit)=>{const gate=deferred<Response>();gates.push(gate);pendingResponses.push(gate.resolve);calls.push({url:String(url),body:JSON.parse(String(init?.body)),signal:init?.signal});return gate.promise;});
        runtime.autoTranslateEnglishPage();await pump(()=>calls.length>=2);
        expect(calls).toHaveLength(2);expect(calls.every(call=>call.url===privateURL&&call.body.model==='document-private')).toBe(true);
        await store.requestConfigPatch({incognitoModel:'document-next'});expect(calls.every(call=>call.signal?.aborted)).toBe(true);
        gates.forEach(gate=>gate.resolve(response('document-private','迟到标题正文译文')));await pump();
        expect(document.title).toBe('Synthetic page source title');expect(paragraph().textContent).toBe('Readable synthetic source paragraph.');expect(cacheWrite).not.toHaveBeenCalled();
    });
    it('count and UI saves preserve the current in-flight generation', async () => {
        const gate=delaySDK();runtime.autoTranslateEnglishPage();await pump(()=>calls.length>0);
        await store.requestConfigPatch({count:store.config.count+1,uiLanguage:'en'});
        expect(calls[0].signal?.aborted).toBe(false);expect(runtime.isFullPageTranslationActive()).toBe(true);
        gate.resolve(response());await pump(()=>paragraph().textContent!.includes('合成译文'));expect(cacheWrite).toHaveBeenCalled();
    });

    it('private AI chooses serialized protected text slots before ordinary Microsoft batching', async () => {
        await store.requestConfigPatch({service:catalog.services.microsoft});
        paragraph().innerHTML='Readable beginning source <code>const value = 1</code> readable ending source.';
        runtime.autoTranslateEnglishPage();await pump(()=>paragraph().textContent!.includes('合成分段译文'));
        expect(translationRequests()).toHaveLength(1);expect(typeof translationRequests()[0].origin).toBe('string');
        expect(translationRequests()[0].origin).toContain('___FLUENTREAD_');expect(calls).toHaveLength(1);expect(calls[0].body.model).toBe('document-private');
        expect(paragraph().querySelector('code')!.textContent).toBe('const value = 1');
    });
    it('dedicated machine route chooses actual batch-array slots before ordinary AI capability', async () => {
        await store.requestConfigPatch({incognitoService:catalog.services.microsoft,incognitoModel:''});
        paragraph().innerHTML='Readable beginning source <code>const value = 1</code> readable ending source.';
        runtime.autoTranslateEnglishPage();await pump(()=>paragraph().textContent!.includes('合成批量译文'));
        expect(translationRequests()).toHaveLength(1);expect(translationRequests()[0].origin).toHaveLength(2);expect(Array.isArray(translationRequests()[0].origin)).toBe(true);
        expect(calls).toHaveLength(1);expect(Array.isArray(calls[0].body)).toBe(true);expect(calls[0].url).toContain('https://edge.microsoft.com/translate/translatetext');
        expect(paragraph().querySelector('code')!.textContent).toBe('const value = 1');
    });
    it('effective dedicated AI enables actual cross-candidate multi-segment batching', async () => {
        await store.requestConfigPatch({service:catalog.services.microsoft,enableAIMultiSegment:true,maxConcurrentTranslations:4});
        document.body.innerHTML='<main>'+Array.from({length:4},(_,id)=>`<p id="source${id}">Readable synthetic paragraph number ${id}.</p>`).join('')+'</main>';
        runtime.autoTranslateEnglishPage();await pump(()=>Array.from(document.querySelectorAll('p')).every(node=>node.textContent!.includes('合成分段译文')));
        expect(translationRequests()).toHaveLength(1);expect(translationRequests()[0]).toMatchObject({aiMultiSegment:true,serviceOverride:privateService,modelOverride:'document-private'});
        expect(calls).toHaveLength(1);expect(calls[0].body.model).toBe('document-private');
        expect(document.querySelectorAll('.fluent-read-bilingual-content')).toHaveLength(4);
    });
    it('no-tab webpage remains unknown despite a private extension-context claim', async () => {
        nativeSender.tab=undefined;
        m.contexts.mockResolvedValue([{documentId:nativeSender.documentId,contextId:'claimed-page-context',contextType:'TAB',incognito:true,documentOrigin:'https://page.synthetic.test',documentUrl:nativeSender.url,frameId:0}]);
        runtime.autoTranslateEnglishPage();await pump();
        expect(m.contexts).not.toHaveBeenCalled();expect(calls).toHaveLength(0);expect(cacheRead).not.toHaveBeenCalled();expect(cacheWrite).not.toHaveBeenCalled();
    });
    it('actual save cancels pending native privacy resolution before cache or SDK and refuses its late result', async () => {
        nativeSender.tab=undefined;location.protocol='moz-extension:';location.href=nativeSender.url='moz-extension://ext/full-page-fixture.html';
        Object.defineProperty(document,'URL',{configurable:true,value:location.href});
        const gate=deferred<any[]>();m.contexts.mockReturnValueOnce(gate.promise);
        runtime.autoTranslateEnglishPage();await pump(()=>m.contexts.mock.calls.length>0);expect(m.contexts).toHaveBeenCalledOnce();
        await store.requestConfigPatch({incognitoModel:'document-next'});
        gate.resolve([{documentId:nativeSender.documentId,contextId:'late-native-context',contextType:'TAB',incognito:true,documentOrigin:'moz-extension://ext',documentUrl:nativeSender.url,frameId:0}]);await pump();
        expect(calls).toHaveLength(0);expect(cacheRead).not.toHaveBeenCalled();expect(cacheWrite).not.toHaveBeenCalled();expect(paragraph().textContent).toBe('Readable synthetic source paragraph.');
    });

    it('native capability false keeps userscript ordinary snapshot and never reads the browser private hint', async () => {
        const rules=await vi.importActual<typeof import('@/src/core/config/incognitoRoute')>('@/src/core/config/incognitoRoute');
        vi.doMock('@/src/core/config/incognitoRoute',()=>({...rules,NATIVE_PRIVATE_ROUTE_SUPPORTED:false}));
        try {
            vi.resetModules();
            Object.defineProperty(browserBoundary.extension,'inIncognitoContext',{configurable:true,get:()=>{throw new Error('userscript must not query native privacy');}});
            const request=await import('@/src/features/full-page-translation/content/translationRequest');
            const snapshot=request.captureFullPageTranslationConfig({service:publicService,model:'document-public'});
            expect(snapshot).toMatchObject({service:publicService,model:'document-public'});
            expect(request.createSnapshotTranslateOptions(snapshot)).toMatchObject({serviceOverride:publicService,modelOverride:'document-public'});
            expect(request.getTranslationInvocationIdentity(snapshot)).not.toContain('document-private');
            await (await import('@/src/services/config/store')).configReady;
            const pages=await import('@/src/features/full-page-translation/content/runtime');
            const {getHoverTranslationRequestSession}=await import('@/src/features/full-page-translation/content/requestSession');
            const hover=getHoverTranslationRequestSession(),generation=hover.renderCommitGeneration;
            try {
                pages.autoTranslateEnglishPage();expect(pages.isFullPageTranslationActive()).toBe(true);
                expect(pages.getFullPageTranslationFrameState().translationConfig).toMatchObject({service:publicService,model:'document-public'});
                pages.resetFullPageTranslationRouteState();
                expect(pages.isFullPageTranslationActive()).toBe(true);expect(getHoverTranslationRequestSession()).toBe(hover);
                expect(hover.renderCommitGeneration).toBe(generation+1);expect(hover.active).toBe(true);expect(calls).toHaveLength(0);
            } finally {pages.restoreOriginalContent();}

        } finally {vi.doUnmock('@/src/core/config/incognitoRoute');}
    });

    it('shared hover invocation rejects an unknown native hint without an unhandled throw or translation', async () => {
        browserBoundary.extension.inIncognitoContext=undefined;
        expect(()=>runtime.handleTranslation(0,0)).not.toThrow();await pump();
        expect(translationRequests()).toHaveLength(0);expect(calls).toHaveLength(0);expect(paragraph().textContent).toBe('Readable synthetic source paragraph.');
    });

    it.each(['extension','browser'])('absent native %s boundary refuses configured pair before request', async boundary => {
        if(boundary==='extension')browserBoundary.extension=undefined;else m.nativeAPI={};
        runtime.autoTranslateEnglishPage();await pump();
        expect(translationRequests()).toHaveLength(0);expect(calls).toHaveLength(0);expect(runtime.isFullPageTranslationActive()).toBe(false);
        if(boundary==='extension')browserBoundary.extension={inIncognitoContext:true};else m.nativeAPI=browserBoundary;
    });

    it('Chrome direct runtime uses the module browser API when global browser is absent', async () => {
        m.target='chrome';vi.stubGlobal('browser',undefined);
        try {
            runtime.autoTranslateEnglishPage();await pump(()=>paragraph().textContent!.includes('合成译文'));
            expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({url:privateURL,body:{model:'document-private'}});
            expect(runtime.getFullPageTranslationFrameState().translationConfig).toMatchObject({service:privateService,model:'document-private'});
            expect(browserBoundary.runtime.connect).not.toHaveBeenCalled();expect(browserBoundary.runtime.sendMessage).toHaveBeenCalled();
        } finally {vi.stubGlobal('browser',browserBoundary);}
    });

});
