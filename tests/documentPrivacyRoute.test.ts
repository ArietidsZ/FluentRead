/** 真实 DocumentApp setup→文档编排/客户端→原生文本 Port/handler/registry→broker/IndexedDB/SDK；只模拟浏览器/持久端口、下载延迟与合成 HTTP，验证有效路由、真实保存取消和迟到写回/导出。 */
import 'fake-indexeddb/auto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {afterEach, beforeEach, describe, expect, it, vi, type MockInstance} from 'vitest';
import {compileScript, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import * as vue from 'vue';
import {documentPortPair} from './helpers/imageDocumentPorts';
import {Config} from '@/src/core/config/model';
import * as catalog from '@/src/core/config/catalog';
import * as documentCore from '@/src/features/document-translation/core/document';
import * as presentation from '@/src/features/document-translation/ui/presentation';
import * as customProviders from '@/src/core/config/customOpenAI';
import * as credentials from '@/src/core/config/validation';
import {hasDistinctTranslation} from '@/src/core/translation/result';
import {TranslationRequestError} from '@/src/services/translation/errors';
import {buildGlossaryRevision} from '@/src/core/glossary';
import {getIncognitoRouteCopy} from '@/src/features/settings/ui/incognitoRouteCopy';

const m = vi.hoisted(() => ({values: new Map<string, unknown>(), contexts: vi.fn(), record: vi.fn(), target: 'firefox'}));
vi.mock('@/src/platform/storage/configStorageRuntime', () => ({configStorage: {
    writeOwner: true, getItem: async (key: string) => m.values.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {m.values.set(key, structuredClone(value));},
    removeItem: async (key: string) => {m.values.delete(key);}, watch: () => () => undefined,
}}));
vi.mock('webextension-polyfill', () => ({default: new Proxy({}, {get: (_target, key) => Reflect.get(globalThis.browser, key)})}));
vi.mock('@/src/platform/browser/capabilities', async original => ({
    ...await original<object>(), browserCapabilities: {get browser() {return m.target;}, manifestVersion: 2},
}));
vi.mock('@/src/platform/storage/modelUsageRepository', () => ({modelUsageRepository: {captureGeneration: () => 1, recordMany: m.record}}));
vi.mock('@/src/platform/storage/translationStatsRepository', () => ({translationStatsRepository: {captureGeneration: () => 1, record: m.record}}));

const require = createRequire(import.meta.url);
const filename = 'src/app/document-translation/DocumentApp.vue';
const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename});
const compiled = ts.transpileModule(compileScript(descriptor, {id: 'document-private-route'}).content, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
}).outputText;
const publicService = 'custom:document-public', privateService = 'custom:document-private';
const publicURL = 'https://public-document.synthetic.test/v1/chat/completions';
const privateURL = 'https://private-document.synthetic.test/v1/chat/completions';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const settle = async () => {await tick(); await tick();};
const file = (name: string, text = 'Readable synthetic source paragraph.') => new File([text], name, {type: 'text/plain'});
function response(model = 'document-private', content = `合成译文 ${model}`) {
    return new Response(JSON.stringify({id: 'synthetic', object: 'chat.completion', model,
        choices: [{index: 0, message: {role: 'assistant', content}, finish_reason: 'stop'}]}), {headers: {'content-type': 'application/json'}});
}
function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};}

let state: Record<string, any>, scope: vue.EffectScope;
let store: typeof import('@/src/services/config/store');
let runtime: typeof import('@/src/app/document-translation/runtime');
let cache: typeof import('@/src/services/translation/cache');
let cacheRead: MockInstance, cacheWrite: MockInstance, cacheIdentity: MockInstance;
let transport: ReturnType<typeof vi.fn>, resetFetch: () => void;
let calls: Array<{url: string; body: any; signal?: AbortSignal | null}>;
let dispatch: ReturnType<typeof vi.fn>, nativeSender: any, browserBoundary: any;
let server: ReturnType<typeof import('@/src/services/translation/documentChannel').createTranslationDocumentPortHandler>;
let pairs: ReturnType<typeof documentPortPair>[];
let mounted: (() => void)[], unmounted: (() => void)[], windowEvents: Map<string, Set<(event: any) => void>>;
let download: ReturnType<typeof vi.fn>, parseFile: ReturnType<typeof vi.fn>;
let anchorClick: ReturnType<typeof vi.fn>, objectURL: MockInstance;
let pendingResponses: Array<(value: Response) => void>;
let pendingDownloads: Array<() => void>;
let pageApi: Record<string, any>;

async function mountPage() {
    unmounted.forEach(fn => fn()); scope?.stop(); mounted = []; unmounted = [];
    const exports: Record<string, any> = {};
    new Function('require', 'exports', compiled)((id: string) => {
        if (id === 'vue') return {...vue, onMounted: (fn: () => void) => mounted.push(fn), onUnmounted: (fn: () => void) => unmounted.push(fn)};
        if (id === '@/src/app/document-translation' || id === '@/src/core/translation/result') return pageApi;
        if (id === 'webextension-polyfill') return browserBoundary;
        if (id.startsWith('element-plus') || id.endsWith('.css') || id.endsWith('.vue')) return {};
        return require(id);
    }, exports);
    scope = vue.effectScope(); state = scope.run(() => vue.proxyRefs(exports.default.setup({}, {expose: () => {}})))!;
    await vue.nextTick(); mounted.forEach(fn => fn());
}

beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks(); m.values.clear(); m.target = 'firefox'; m.record.mockResolvedValue(undefined);
    calls = []; pairs = []; mounted = []; unmounted = []; pendingResponses = []; pendingDownloads = []; windowEvents = new Map();
    nativeSender = {id: 'ext', documentId: 'native-document-page', frameId: 0,
        url: 'moz-extension://ext/document.html', tab: {id: 4, incognito: true}};
    anchorClick = vi.fn();
    vi.stubGlobal('location', {protocol: 'moz-extension:', href: nativeSender.url});
    vi.stubGlobal('document', {title: 'Synthetic document page'});
    vi.stubGlobal('window', {matchMedia: () => ({matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()}),
        addEventListener: (name: string, callback: (event: any) => void) => {
            const listeners = windowEvents.get(name) ?? new Set(); listeners.add(callback); windowEvents.set(name, listeners);
        }, removeEventListener: (name: string, callback: (event: any) => void) => windowEvents.get(name)?.delete(callback),
        setTimeout: (callback: () => void) => {callback(); return 0;},
        document: {createElement: () => ({click: anchorClick})}});
    objectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-document');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    browserBoundary = {extension: {inIncognitoContext: true}, runtime: {
        id: 'ext', getURL: (path: string) => `moz-extension://ext/${path.replace(/^\//u, '')}`, getContexts: m.contexts,
        connect: vi.fn(() => {
            const pair = documentPortPair(nativeSender);
            const client = {...pair.client, name: 'fluentReadTranslationDocument:v1'};
            const background = {...pair.background, name: 'fluentReadTranslationDocument:v1'};
            pairs.push(pair); expect(server.connect(background)).toBe(true); return client;
        }), sendMessage: vi.fn(async (message: any) => (await dispatch(message, {sender: nativeSender})).response),
    }, tabs: {create: vi.fn().mockResolvedValue({})}};
    vi.stubGlobal('browser', browserBoundary);
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
    initial.from = 'en'; initial.to = 'zh-Hans'; initial.enableAIContext = false; initial.translationMaxRetries = 0;
    m.values.set('local:config', initial); m.contexts.mockResolvedValue([]);
    store = await import('@/src/services/config/store'); await store.configReady;
    const http = await import('@/src/platform/http/runtime'); resetFetch = () => http.setRuntimeFetch();
    transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)); calls.push({url: String(url), body, signal: init?.signal});
        return Array.isArray(body) ? new Response(JSON.stringify(body.map(() => ({translations: [{text: '合成批量译文'}]}))), {headers: {'content-type': 'application/json'}}) : response(body.model);
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
    runtime = await import('@/src/app/document-translation/runtime');
    const publicFeature = await import('@/src/features/document-translation/public');
    parseFile = vi.fn(publicFeature.parseDocumentFile);
    download = vi.fn(runtime.createDocumentDownload);
    const capabilities = await import('@/src/services/translation/capabilities');
    pageApi = {...publicFeature, ...documentCore, ...presentation, ...catalog, ...customProviders, ...credentials, ...capabilities,
        ...runtime, Config, TranslationRequestError, hasDistinctTranslation, buildGlossaryRevision, getIncognitoRouteCopy,
        parseDocumentFile: parseFile, createDocumentDownload: download,
        runtimeConfig: store.config, configReady: store.configReady, requestConfigPatch: store.requestConfigPatch, subscribeConfig: store.subscribeConfig,
        useUiI18n: () => ({language: vue.ref('zh-CN'), t: (key: string) => key, translateLegacy: (text: string) => text}), ElSelect: {},
    };
    await mountPage();
});

afterEach(async () => {
    unmounted.forEach(fn => fn()); scope?.stop(); pairs.forEach(pair => pair.close());
    pendingResponses.forEach(finish => finish(response('document-private', '迟到合成译文')));
    pendingDownloads.forEach(finish => finish());
    (await import('@/src/app/translation/client')).cancelAllTranslations();
    await settle(); resetFetch?.(); await cache.translationCache.clear(); cache.translationCacheDb.close();
    vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function load(text = 'Readable synthetic source paragraph.', name = 'source.txt') {await state.loadFiles([file(name, text)]); return state.parsedDocument;}
function delaySDK() {
    const gate = deferred<Response>(); pendingResponses.push(gate.resolve);
    transport.mockImplementationOnce(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({url: String(url), body: JSON.parse(String(init?.body)), signal: init?.signal}); return gate.promise;
    }); return gate;
}
const translationRequests = () => dispatch.mock.calls.map(([message]) => message).filter(message => 'origin' in message);

describe('native document page effective private route and saved lifecycle', () => {
    it('shows and prechecks the dedicated pair despite missing ordinary credentials and an unrelated ordinary model', async () => {
        await store.requestConfigPatch({requireApiKey: {...store.config.requireApiKey, [`v2:${JSON.stringify([publicService, 'document-public'])}`]: true}});
        await load();
        expect(state.effectiveDocumentService).toBe(privateService); expect(state.selectedDocumentModel).toBe('document-private');
        expect(state.documentModelOptions).toEqual(['document-private']); expect(state.credentialWarning).toBeFalsy();
        expect(state.translationSettingsSummary).toContain('Synthetic private document');
        expect(state.privateRouteCopy.title).toBe(getIncognitoRouteCopy('zh-CN').title);
        state.selectedDocumentService = publicService; state.selectedDocumentModel = 'private-ordinary';
        expect(state.config.documentService).toBe(publicService); expect(state.selectedDocumentModel).toBe('document-private');
        await state.startTranslation();
        expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({url: privateURL, body: {model: 'document-private'}});
        expect(state.translationComplete).toBe(true); expect(store.config.documentModel[publicService]).toBe('document-public');
    });
    it('dedicated AI routing happens before document chunk selection while an ordinary batch service is configured', async () => {
        await store.requestConfigPatch({documentService: catalog.services.microsoft});
        await load(Array.from({length: 18}, (_, id) => `Readable sentence number ${id}.`).join('\n\n'));
        await state.startTranslation();
        expect(translationRequests()).toHaveLength(18); expect(translationRequests().every(request => typeof request.origin === 'string')).toBe(true);
        expect(calls).toHaveLength(18); expect(calls.every(call => call.url === privateURL && call.body.model === 'document-private')).toBe(true);
        expect(state.completedSegments).toBe(18);
    });
    it('a dedicated machine service keeps actual 16/2 batching and has no ordinary model credential precheck', async () => {
        await store.requestConfigPatch({incognitoService: catalog.services.microsoft, incognitoModel: ''});
        await load(Array.from({length: 18}, (_, id) => `Readable sentence number ${id}.`).join('\n\n'));
        expect(state.documentUsesModel).toBe(false); expect(state.credentialWarning).toBeFalsy();
        await state.startTranslation();
        expect(translationRequests().map(request => request.origin.length)).toEqual([16, 2]);
        expect(calls.every(call => call.url.startsWith('https://edge.microsoft.com/translate/translatetext'))).toBe(true);
        expect(state.translationComplete).toBe(true);
    });
    it('the runtime adapter also resolves the private pair before chunking direct document calls', async () => {
        const source = await load();
        await runtime.translateDocumentSegments(source.segments, {fileName: source.fileName, serviceOverride: catalog.services.microsoft, modelOverride: 'ordinary-injected-model'});
        expect(translationRequests()[0]).toMatchObject({serviceOverride: privateService, modelOverride: 'document-private'});
        expect(typeof translationRequests()[0].origin).toBe('string'); expect(calls[0].body.model).toBe('document-private');
    });
    it('both-empty direct document adapter keeps its default service and glossary selection', async () => {
        await store.requestConfigPatch({incognitoService: '', incognitoModel: ''});
        const source = await load(); await runtime.translateDocumentSegments(source.segments, {fileName: source.fileName});
        expect(translationRequests()[0]).toMatchObject({serviceOverride: publicService, glossaryContext: 'document'});
        expect(calls[0]).toMatchObject({url: publicURL, body: {model: 'document-public'}});
    });
    it('uses the private prompt/context capability before request construction and keeps file context', async () => {
        const ordinaryModel = catalog.models.get(catalog.services.tongyi)!.find(model => model.startsWith('qwen-mt'))!;
        expect(catalog.servicesType.isUseAIContext(catalog.services.tongyi, ordinaryModel)).toBe(false);
        await store.requestConfigPatch({documentService: catalog.services.tongyi, documentModel: {[catalog.services.tongyi]: ordinaryModel}, enableAIContext: true,
            system_role: {[catalog.services.tongyi]: 'PUBLIC_DOCUMENT_SYSTEM', [privateService]: 'PRIVATE_DOCUMENT_SYSTEM'}});
        await load('A long readable synthetic source paragraph used to establish file-level context.', 'evidence.txt');
        await state.startTranslation();
        expect(translationRequests()[0].pageContext).toContain('Document: evidence.txt');
        expect(calls.every(call => call.url === privateURL && call.body.model === 'document-private')).toBe(true);
        expect(JSON.stringify(calls.map(call => call.body))).toContain('PRIVATE_DOCUMENT_SYSTEM');
        expect(JSON.stringify(calls.map(call => call.body))).not.toContain('PUBLIC_DOCUMENT_SYSTEM');
    });
    it('keeps native transport IDs and privacy/configuration markers out of provider payloads and cache identity', async () => {
        await load(); await state.startTranslation();
        expect(browserBoundary.runtime.connect).toHaveBeenCalledOnce();
        expect(translationRequests()[0].clientRequestId).toEqual(expect.any(String));
        const serialized = JSON.stringify([calls.map(call => call.body), cacheIdentity.mock.calls]);
        expect(serialized).not.toMatch(/clientRequestId|native-document-page|native-document-port|incognito|privateContext|routeConfiguration/u);
        expect(cacheRead.mock.calls.every(([key]) => /^v3:[a-f0-9]{64}$/u.test(key))).toBe(true);
    });
    it('isolates ordinary text cache, reuses private cache and changes its identity on a saved endpoint', async () => {
        browserBoundary.extension.inIncognitoContext = false; nativeSender.tab.incognito = false;
        await store.requestConfigPatch({documentService: publicService});
        await mountPage();
        await load(); await state.startTranslation(); expect(calls[0].body.model).toBe('document-public');
        browserBoundary.extension.inIncognitoContext = true; pairs.forEach(pair => pair.close()); nativeSender.tab.incognito = true;
        await store.requestConfigPatch({documentModel: {...store.config.documentModel, [publicService]: 'ordinary-unrelated-model'}});
        await mountPage(); await load();
        await state.startTranslation(); expect(calls.at(-1)!.body.model).toBe('document-private');
        const afterPrivate = calls.length; await state.startTranslation(true); expect(calls).toHaveLength(afterPrivate);
        await store.requestConfigPatch({customOpenAIProviders: store.config.customOpenAIProviders.map(provider => provider.id === privateService ? {...provider, endpoint: 'https://changed-document.synthetic.test/v1/chat/completions'} : provider)});
        await state.startTranslation(); expect(calls).toHaveLength(afterPrivate + 1); expect(calls.at(-1)!.url).toContain('changed-document.synthetic.test');
    });
    it('regular native context ignores invalid dedicated settings and keeps document model overrides', async () => {
        browserBoundary.extension.inIncognitoContext = false; nativeSender.tab.incognito = false;
        await store.requestConfigPatch({incognitoModel: 'missing-private-model'}); await mountPage(); await load();
        expect(state.selectedDocumentModel).toBe('document-public'); expect(state.credentialWarning).toBeFalsy();
        await state.startTranslation(); expect(calls[0]).toMatchObject({url: publicURL, body: {model: 'document-public'}});
    });
    it.each([undefined, 'true', 1])('frontend private hint cannot authorize unknown native tab evidence %s', async evidence => {
        nativeSender.tab.incognito = evidence; await load(); await state.startTranslation();
        expect(state.runState).toBe('failed'); expect(state.errorMessage).toContain('来源'); expect(calls).toHaveLength(0); expect(cacheRead).not.toHaveBeenCalled();
    });
    it.each([undefined, 'true', 1])('unknown frontend native hint %s fails precheck without emitting a request', async hint => {
        browserBoundary.extension.inIncognitoContext = hint;
        await mountPage(); await load();
        expect(state.credentialWarning).toContain('来源'); await state.startTranslation();
        expect(translationRequests()).toHaveLength(0); expect(calls).toHaveLength(0);
    });
    it('an absent native extension context is unknown and cannot authorize configured private routing', async () => {
        delete browserBoundary.extension; await mountPage(); await load();
        expect(state.credentialWarning).toContain('来源'); await state.startTranslation();
        expect(calls).toHaveLength(0); expect(translationRequests()).toHaveLength(0);
    });
    it.each([true, undefined])('both-empty preserves document routing for private/unknown hint %s', async hint => {
        browserBoundary.extension.inIncognitoContext = hint; nativeSender.tab.incognito = hint;
        await store.requestConfigPatch({incognitoService: '', incognitoModel: ''}); await load(); await state.startTranslation();
        expect(calls[0]).toMatchObject({url: publicURL, body: {model: 'document-public'}}); expect(state.translationComplete).toBe(true);
    });
    it.each([{incognitoModel: 'missing-private-model'}, {incognitoService: ''}, {customBody: {[privateService]: '{"model":"private-ordinary"}'}}])('invalid dedicated configuration fails before client/cache: %j', async patch => {
        await store.requestConfigPatch(patch); await load(); expect(state.credentialWarning).toMatch(/私密|配置|冲突/u);
        await state.startTranslation(); expect(calls).toHaveLength(0); expect(cacheRead).not.toHaveBeenCalled();
    });
    it('exact native getContexts document evidence authorizes the pair independently of the frontend hint', async () => {
        delete nativeSender.tab;
        m.contexts.mockResolvedValue([{documentId: nativeSender.documentId, contextId: 'native-context', contextType: 'TAB', incognito: true,
            documentOrigin: 'moz-extension://ext', documentUrl: nativeSender.url, frameId: 0}]);
        await load(); await state.startTranslation();
        expect(m.contexts).toHaveBeenCalledWith({documentIds: ['native-document-page']}); expect(calls[0].body.model).toBe('document-private');
    });
    it.each(['incognitoModel', 'endpoint', 'documentModel', 'system_role', 'enableAIContext', 'useCache', 'from', 'to', 'documentGlossaryIds'] as const)('real normalized %s save aborts SDK work, keeps parsed files and rejects late translation/cache', async field => {
        const source = await load(); await state.loadFiles([file('second.txt', 'Second imported source.')]);
        const documents = state.documentQueue.map((item: any) => item.document);
        const delayed = delaySDK(), work = state.startTranslation(); await vi.waitFor(() => expect(calls).toHaveLength(1));
        const changes = {incognitoModel: 'document-next', endpoint: store.config.customOpenAIProviders.map(provider => provider.id === privateService ? {...provider, endpoint: 'https://next-document.synthetic.test/v1/chat/completions'} : provider),
            documentModel: {...store.config.documentModel, [publicService]: 'different-ordinary-model'}, system_role: {[privateService]: 'NEW_DOCUMENT_SYSTEM'}, enableAIContext: true, useCache: false,
            from: 'fr', to: 'ja', documentGlossaryIds: []};
        await store.requestConfigPatch(field === 'endpoint' ? {customOpenAIProviders: changes.endpoint} : {[field]: changes[field]});
        await vi.waitFor(() => expect(calls[0].signal?.aborted).toBe(true));
        expect(state.parsedDocument).toBe(source); expect(state.documentQueue.map((item: any) => item.document)).toEqual(documents);
        delayed.resolve(response('document-private', '迟到私密译文')); await work; await settle();
        expect(state.translatedSegments).toEqual([]); expect(state.documentQueue.every((item: any) => item.translations.length === 0)).toBe(true);
        expect(cacheWrite).not.toHaveBeenCalled(); expect(state.hasTranslation).toBe(false); expect(state.downloadedRevision).toBe(0);
    });
    it('saving the route clears completed/manual results across the queue and permits new translation of the same source', async () => {
        const source = await load(); await state.loadFiles([file('second.txt', 'Second imported source.')]); await state.startBatch();
        expect(state.batchCompletedCount).toBe(2); state.editSegment(0, '人工校订');
        await store.requestConfigPatch({incognitoModel: 'document-next'});
        expect(state.documentQueue).toHaveLength(2); expect(state.documentQueue[0].document).toBe(source);
        expect(state.documentQueue.every((item: any) => item.translations.length === 0 && !item.fingerprint && item.revision === 0)).toBe(true);
        expect(state.translatedSegments).toEqual([]); expect(state.downloadPreview).toBe('');
        await state.startTranslation(); expect(calls.at(-1)!.body.model).toBe('document-next'); expect(state.translationComplete).toBe(true);
    });
    it('a route save retains imported sources, import errors and an in-progress source parser', async () => {
        const source = await load(); await state.loadFiles([file('broken.json', '{')]);
        const failed = state.documentQueue[1], error = failed.error;
        const gate = deferred<documentCore.ParsedDocument>(); parseFile.mockReturnValueOnce(gate.promise);
        const importing = state.loadFiles([file('next.txt', 'Next imported source.')]);
        await store.requestConfigPatch({incognitoModel: 'document-next'});
        gate.resolve(documentCore.parseDocument('next.txt', 'Next imported source.')); await importing;
        expect(state.parsedDocument).toBe(source); expect(state.documentQueue).toHaveLength(3);
        expect(state.documentQueue[1]).toBe(failed); expect(failed.error).toBe(error);
        expect(state.documentQueue[2].document.segments[0].source).toBe('Next imported source.');
    });
    it('route invalidation releases translated preview URLs while retaining original preview/source ownership', async () => {
        const source = await load();
        state.pdfPreviewPageStates = [{pageNumber: 1, originalUrl: 'blob:original-source', translatedUrl: 'blob:old-translation', loading: true},
            {pageNumber: 2, originalUrl: 'blob:second-original', translatedUrl: '', loading: false}];
        await store.requestConfigPatch({incognitoModel: 'document-next'});
        expect(state.parsedDocument).toBe(source); expect(state.pdfPreviewPageStates.map((page: any) => page.originalUrl)).toEqual(['blob:original-source', 'blob:second-original']);
        expect(state.pdfPreviewPageStates.every((page: any) => !page.translatedUrl && !page.loading)).toBe(true);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:old-translation'); expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:original-source');
    });
    it.each(['single', 'batch'])('%s export route save aborts generation and suppresses late progress/object URL/click', async mode => {
        const source = await load(); await state.startTranslation(); const gate = deferred<any>();
        pendingDownloads.push(() => gate.resolve({data: '迟到导出', fileName: 'source.txt', mimeType: 'text/plain'}));
        download.mockReturnValueOnce(gate.promise);
        const work = mode === 'single' ? state.downloadDocument() : state.downloadBatch();
        await vi.waitFor(() => expect(download).toHaveBeenCalledOnce()); const options = download.mock.calls[0][3];
        await store.requestConfigPatch({incognitoModel: 'document-next'});
        expect(options.signal.aborted).toBe(true); expect(state.parsedDocument).toBe(source);
        options.onPdfProgress({phase: 'saving', completedPages: 1, totalPages: 1}); options.onArchiveProgress(99);
        gate.resolve({data: '迟到文件内容', fileName: 'source.txt', mimeType: 'text/plain'}); await work; await settle();
        expect(objectURL).not.toHaveBeenCalled(); expect(anchorClick).not.toHaveBeenCalled(); expect(state.downloadProgress).toBe('');
        expect(state.downloadedRevision).toBe(0); expect(state.documentQueue.every((item: any) => item.downloaded === 0)).toBe(true);
    });
    it('language save cancels pending export while preserving already reviewed results and source', async () => {
        const source = await load(); await state.startTranslation(); const translations = [...state.translatedSegments], gate = deferred<any>();
        pendingDownloads.push(() => gate.resolve({data: '迟到导出', fileName: 'source.txt', mimeType: 'text/plain'})); download.mockReturnValueOnce(gate.promise);
        const work = state.downloadDocument(), options = download.mock.calls[0][3];
        await store.requestConfigPatch({to: 'ja'}); expect(options.signal.aborted).toBe(true); expect(state.parsedDocument).toBe(source);
        expect(state.translatedSegments).toEqual(translations); expect(state.settingsChanged).toBe(true);
        options.onArchiveProgress(99); gate.resolve({data: '迟到文件内容', fileName: 'source.txt', mimeType: 'text/plain'}); await work;
        expect(objectURL).not.toHaveBeenCalled(); expect(anchorClick).not.toHaveBeenCalled(); expect(state.downloadedRevision).toBe(0);
    });
    it.each(['disable', 'pagehide', 'unmount'].flatMap(reason => ['single', 'batch'].map(mode => [reason, mode])))('%s stops pending %s export before late progress or download', async (reason, mode) => {
        await load(); await state.startTranslation(); const gate = deferred<any>();
        pendingDownloads.push(() => gate.resolve({data: '迟到导出', fileName: 'source.txt', mimeType: 'text/plain'}));
        download.mockReturnValueOnce(gate.promise);
        const work = mode === 'single' ? state.downloadDocument() : state.downloadBatch();
        await vi.waitFor(() => expect(download).toHaveBeenCalledOnce()); const options = download.mock.calls[0][3];
        if (reason === 'disable') await store.requestConfigPatch({on: false});
        else if (reason === 'pagehide') for (const callback of [...(windowEvents.get('pagehide') ?? [])]) callback({isTrusted: true});
        else {unmounted.forEach(fn => fn()); unmounted = []; scope.stop();}
        expect(options.signal.aborted).toBe(true);
        options.onPdfProgress({phase: 'saving', completedPages: 1, totalPages: 1}); options.onArchiveProgress(99);
        gate.resolve({data: '迟到文件内容', fileName: 'source.txt', mimeType: 'text/plain'}); await work; await settle();
        expect(objectURL).not.toHaveBeenCalled(); expect(anchorClick).not.toHaveBeenCalled(); expect(state.downloadedRevision).toBe(0);
    });
    it('a saved pair cancels an unresolved native source gate before cache/SDK and retains the imported source', async () => {
        delete nativeSender.tab; const gate = deferred<unknown[]>(); m.contexts.mockReturnValueOnce(gate.promise);
        const source = await load(), work = state.startTranslation(); await vi.waitFor(() => expect(m.contexts).toHaveBeenCalledOnce());
        await store.requestConfigPatch({incognitoModel: 'document-next'}); await work;
        expect(state.parsedDocument).toBe(source); expect(calls).toHaveLength(0); expect(cacheRead).not.toHaveBeenCalled();
        gate.resolve([{documentId: nativeSender.documentId, contextId: 'late-context', contextType: 'TAB', incognito: true,
            documentOrigin: 'moz-extension://ext', documentUrl: nativeSender.url, frameId: 0}]);
        await settle(); expect(calls).toHaveLength(0); expect(state.translatedSegments).toEqual([]);
    });
    it('real private model credential policy rejects before client/cache without accepting ordinary credentials', async () => {
        await store.requestConfigPatch({requireApiKey: {...store.config.requireApiKey, [`v2:${JSON.stringify([privateService, 'document-private'])}`]: true}});
        await load(); expect(state.credentialWarning).toContain('Synthetic private document'); await state.startTranslation();
        expect(calls).toHaveLength(0); expect(cacheRead).not.toHaveBeenCalled(); expect(translationRequests()).toHaveLength(0);
    });
    it('the document runtime consumes a cancelled pre-start signal before selecting or dispatching', async () => {
        const source = await load(), controller = new AbortController(); controller.abort();
        await expect(runtime.translateDocumentSegments(source.segments, {fileName: source.fileName, signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
        expect(calls).toHaveLength(0); expect(translationRequests()).toHaveLength(0);
    });
    it('document download adapter preserves an explicitly injected PDF rasterizer and ordinary text export', async () => {
        const source = await load(), rasterizer = vi.fn();
        const output = await runtime.createDocumentDownload(source, ['人工译文'], 'translated', {pdfPageRasterizer: rasterizer});
        expect(output.data).toContain('人工译文'); expect(rasterizer).not.toHaveBeenCalled();
        const ordinary = await runtime.createDocumentDownload(source, ['另一译文'], 'bilingual'); expect(ordinary.data).toContain(source.segments[0].source);
    });
    it.each(['disable', 'pagehide', 'close-port', 'unmount'])('%s cancels actual native SDK ownership and cannot write late text/cache/export', async reason => {
        await load(); const delayed = delaySDK(), work = state.startTranslation(); await vi.waitFor(() => expect(calls).toHaveLength(1));
        if (reason === 'disable') await store.requestConfigPatch({on: false});
        else if (reason === 'pagehide') for (const callback of [...(windowEvents.get('pagehide') ?? [])]) callback({isTrusted: true});
        else if (reason === 'close-port') pairs[0].close();
        else {unmounted.forEach(fn => fn()); unmounted = []; scope.stop();}
        await vi.waitFor(() => expect(calls[0].signal?.aborted).toBe(true)); delayed.resolve(response('document-private', '迟到被取消译文'));
        await work; await settle(); expect(state.translatedSegments).toEqual([]); expect(cacheWrite).not.toHaveBeenCalled(); expect(anchorClick).not.toHaveBeenCalled();
    });
    it('count/UI saves do not invalidate completed results or route identity', async () => {
        await load(); await state.startTranslation(); const before = [...state.translatedSegments], key = runtime.documentTranslationRouteKey(store.config);
        await store.requestConfigPatch({count: store.config.count + 2, uiLanguage: 'en'});
        expect(runtime.documentTranslationRouteKey(store.config)).toBe(key); expect(state.translatedSegments).toEqual(before); expect(state.translationComplete).toBe(true);
    });
    it('Chromium direct text transport keeps native authority and the same dedicated SDK pair', async () => {
        m.target = 'chrome'; await load(); await state.startTranslation();
        expect(browserBoundary.runtime.connect).not.toHaveBeenCalled(); expect(browserBoundary.runtime.sendMessage).toHaveBeenCalled();
        expect(calls[0]).toMatchObject({url: privateURL, body: {model: 'document-private'}});
    });
});
