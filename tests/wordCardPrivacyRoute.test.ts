/** 真实 SelectionTranslator setup→词典原文/辅助编排→文本 client/原生 Port/handler/registry→broker/IndexedDB/SDK；仅布局、非模型 lookup provider、浏览器和合成 HTTP 使用边界。 */
import 'fake-indexeddb/auto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {afterEach,beforeEach,describe,expect,it,vi,type MockInstance} from 'vitest';
import {parseHTML} from 'linkedom';
import {compileScript,compileTemplate,parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import * as vue from 'vue';
import {Config} from '@/src/core/config/model';
import * as catalog from '@/src/core/config/catalog';
import {documentPortPair} from './helpers/imageDocumentPorts';
const m=vi.hoisted(()=>({values:new Map<string,unknown>(),contexts:vi.fn(),record:vi.fn(),target:'firefox',nativeAPI:{} as Record<string,any>}));
vi.mock('@/src/platform/storage/configStorageRuntime',()=>({configStorage:{writeOwner:true,getItem:async(key:string)=>m.values.get(key)??null,setItem:async(key:string,value:unknown)=>{m.values.set(key,structuredClone(value));},removeItem:async(key:string)=>{m.values.delete(key);},watch:()=>()=>{}}}));
vi.mock('webextension-polyfill',()=>({default:new Proxy({},{get:(_t,k)=>Reflect.get(m.nativeAPI,k)})}));
vi.mock('@/src/platform/browser/capabilities',async original=>({...await original<object>(),browserCapabilities:{get browser(){return m.target;},manifestVersion:2}}));
vi.mock('@/src/platform/storage/modelUsageRepository',()=>({modelUsageRepository:{captureGeneration:()=>1,recordMany:m.record}}));
vi.mock('@/src/platform/storage/translationStatsRepository',()=>({translationStatsRepository:{captureGeneration:()=>1,record:m.record}}));
const require=createRequire(import.meta.url),filename='src/features/selection-translation/ui/SelectionTranslator.vue';
const {descriptor}=parse(readFileSync(filename,'utf8'),{filename});
const script=compileScript(descriptor,{id:'word-card-privacy'});
const toCommonJS=(source:string)=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const compiled=toCommonJS(script.content);
const template=toCommonJS(compileTemplate({source:descriptor.template!.content,filename,id:'word-card-privacy',compilerOptions:{bindingMetadata:script.bindings}}).code);
class BoundaryObserver {observe(){} unobserve(){} disconnect(){} takeRecords(){return [];} }
const publicService='custom:document-public',privateService='custom:document-private';
const publicURL='https://public-document.synthetic.test/v1/chat/completions',privateURL='https://private-document.synthetic.test/v1/chat/completions';
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const settle=async()=>{await tick();await tick();await vue.nextTick();};
function response(model='document-private',content=`合成译文 ${model}`){return new Response(JSON.stringify({id:'synthetic',object:'chat.completion',model,choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
const card=()=>({word:'fixture',normalizedWord:'fixture',phonetics:[],sources:[{id:'free-dictionary' as const,label:'Synthetic non-model dictionary',url:'https://dictionary.synthetic.test'}],meanings:[{partOfSpeech:'noun',definitions:[{definition:'A readable dictionary definition.',example:'A readable dictionary example.'},{definition:'A readable dictionary definition.'}]}]});
let store:typeof import('@/src/services/config/store'),cache:typeof import('@/src/services/translation/cache');
let cacheRead:MockInstance,cacheWrite:MockInstance,cacheIdentity:MockInstance,transport:ReturnType<typeof vi.fn>,resetFetch:()=>void;
let calls:Array<{url:string;body:any;signal?:AbortSignal|null}>,dispatch:ReturnType<typeof vi.fn>,nativeSender:any,browserBoundary:any;
let server:ReturnType<typeof import('@/src/services/translation/documentChannel').createTranslationDocumentPortHandler>,pairs:ReturnType<typeof documentPortPair>[],pendingResponses:Array<(value:Response)=>void>;
let lookup:ReturnType<typeof import('@/src/features/selection-translation/services/wordDictionary').createWordDictionaryLookup>,lookupBoundary:ReturnType<typeof vi.fn>;
let state:Record<string,any>,scope:vue.EffectScope,mounted:Array<()=>void>,unmounted:Array<()=>void>,windowEvents:Map<string,Set<(event:any)=>void>>;
let domApp:vue.App|undefined,domHost:HTMLElement|undefined,bridgeDispose:(()=>void)|undefined;
const routeEvent='fluentread-route-change';
async function pump(until:()=>boolean=()=>false,rounds=400){for(let i=0;i<rounds&&!until();i++){await vi.advanceTimersByTimeAsync(10);await settle();}}
async function mountPage(nativeCapability=true){
 domApp?.unmount();domApp=undefined;domHost?.remove();domHost=undefined;unmounted?.forEach(fn=>fn());scope?.stop();mounted=[];unmounted=[];
 const modules:Record<string,unknown>={
  vue:{...vue,useTemplateRef:()=>vue.ref(null),onMounted:(fn:()=>void)=>mounted.push(fn),onBeforeUnmount:(fn:()=>void)=>unmounted.push(fn)},
  'webextension-polyfill':browserBoundary,'@/src/services/config/store':store,
  '@/src/app/translation/client':await import('@/src/app/translation/client'),
  '@/src/core/config/incognitoRoute':{...await import('@/src/core/config/incognitoRoute'),NATIVE_PRIVATE_ROUTE_SUPPORTED:nativeCapability},
  '@/src/services/translation/requestPrivacy':await import('@/src/services/translation/requestPrivacy'),
  '@/src/features/selection-translation/background/wordLookupHandler':await import('@/src/features/selection-translation/background/wordLookupHandler'),
  '@/src/features/share-card/public':{isShareCardMounted:()=>false},
  '@/src/features/reading-assistant/public':{ReadingPanel:{}},
  '@/src/features/selection-translation/content/contextMenuBridge':{setSelectionContextMenuHandler:()=>()=>{}},
  '@/src/ui/i18n':{useUiI18n:()=>({t:(key:string)=>key,translateLegacy:(value:string)=>value})},
 };
 for(const path of ['@/src/platform/browser/runtimeMessages','@/src/core/language/detect','@/src/core/hotkey','@/src/core/language/partOfSpeech','@/src/features/selection-translation/services/wordNormalization','@/src/features/selection-translation/core','@/src/features/selection-translation/protocol','@/src/features/selection-translation/content/selectionTtsContentController','@/src/features/selection-translation/pageZoom','@/src/features/vocabulary/protocol','@/src/core/config/harness','@/src/core/tts/speechProgress','@/src/core/translation/result']) modules[path]=await vi.importActual(path);
 const exports:Record<string,any>={};new Function('require','exports',compiled)((id:string)=>id in modules?modules[id]:id.endsWith('.vue')?vue.defineComponent({props:['text'],setup:props=>()=>vue.h('span',props.text)}):require(id),exports);
 scope=vue.effectScope();state=scope.run(()=>vue.proxyRefs(exports.default.setup({}, {expose:()=>{}})))!;await vue.nextTick();mounted.forEach(fn=>fn());await settle();
}
function begin(){state.snapshot={text:'fixture',parts:[{kind:'text',text:'fixture'}]};state.selectedText='fixture';return state.beginSelectionContentRequest('fixture');}
function delaySDK(){const gate=deferred<Response>();pendingResponses.push(gate.resolve);transport.mockImplementationOnce(async(url:RequestInfo|URL,init?:RequestInit)=>{calls.push({url:String(url),body:JSON.parse(String(init?.body)),signal:init?.signal});return gate.promise;});return gate;}
const requests=()=>dispatch.mock.calls.map(([message])=>message).filter(message=>'origin' in message);
beforeEach(async()=>{
 mounted=[];unmounted=[];windowEvents=new Map();lookupBoundary=vi.fn(async()=>card());

    vi.resetModules(); vi.clearAllMocks(); m.values.clear(); m.target = 'firefox'; m.record.mockResolvedValue(undefined);
    calls = []; pairs = []; pendingResponses = [];  vi.useFakeTimers({toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']});
    const dom = parseHTML('<html><head><title>Synthetic page source title</title></head><body><main><p id="source">Readable synthetic source paragraph.</p></main></body></html>');
    for (const key of ['window','document','Node','Element','HTMLElement','Text','ShadowRoot','DOMParser'] as const) vi.stubGlobal(key, dom.window[key]);
    vi.stubGlobal('MutationObserver', BoundaryObserver); vi.stubGlobal('IntersectionObserver', BoundaryObserver);
    vi.stubGlobal('getComputedStyle', () => ({display: 'block', visibility: 'visible', opacity: '1', position: 'static', whiteSpace: 'normal', overflowY: 'visible', getPropertyValue: () => ''}));
    vi.stubGlobal('innerHeight', 800); vi.stubGlobal('scrollY', 0); vi.stubGlobal('scrollX', 0); vi.stubGlobal('scrollBy', vi.fn());
    const win=window;
    vi.stubGlobal('window',{innerWidth:1000,innerHeight:800,setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame:(fn:()=>void)=>setTimeout(fn,16),cancelAnimationFrame:clearTimeout,matchMedia:()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}),speechSynthesis:{cancel:vi.fn()},addEventListener:(name:string,fn:(event:any)=>void)=>{const set=windowEvents.get(name)??new Set();set.add(fn);windowEvents.set(name,set);},removeEventListener:(name:string,fn:(event:any)=>void)=>windowEvents.get(name)?.delete(fn),Event:win.Event});
    const location = {protocol: 'https:', href: 'https://page.synthetic.test/article'};
    vi.stubGlobal('location', location);
    Object.defineProperty(document, 'location', {configurable: true, value: location});
    Object.defineProperty(document, 'URL', {configurable: true, value: location.href});
    Object.defineProperty(document, 'contentType', {configurable: true, value: 'text/html'});
    Object.defineProperty(HTMLElement.prototype, 'getClientRects', {configurable: true, value: () => Object.assign([{width: 600, height: 60, top: 0, left: 0, bottom: 60, right: 600}], {item: () => null})});
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {configurable: true, value: () => ({width: 600, height: 60, top: 0, left: 0, bottom: 60, right: 600})});
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
            : 'origin' in message || message.type === 'fluentReadTranslationCancel' || message.type === 'selectionWordLookup' ? (await dispatch(message, {sender: nativeSender})).response : {success: true}),
        onMessage: {addListener: vi.fn(), removeListener: vi.fn()},
    }, tabs: {create: vi.fn().mockResolvedValue({})}};
    m.nativeAPI=browserBoundary;vi.stubGlobal('browser', browserBoundary);
    const initial = new Config();
    initial.service = initial.selectionTranslationService = publicService;
    initial.customOpenAIProviders = [
        {id: publicService, name: 'Synthetic public document', endpoint: publicURL, models: ['document-public']},
        {id: privateService, name: 'Synthetic private document', endpoint: privateURL, models: ['document-private', 'document-next', 'private-ordinary']},
    ];
    initial.model = {[publicService]: 'document-public', [privateService]: 'private-ordinary'};
    initial.documentModel = {[publicService]: 'document-public', [privateService]: 'private-ordinary'};
    initial.incognitoService = privateService; initial.incognitoModel = 'document-private';
    initial.requireApiKey = Object.fromEntries([[publicService, 'document-public'], ...['document-private', 'document-next', 'private-ordinary'].map(model => [privateService, model])]
        .map(pair => [`v2:${JSON.stringify(pair)}`, false]));
    initial.selectionTranslatorMode = 'bilingual'; initial.theme = 'light'; initial.display = 1; initial.fullPageTranslationMode = 'all'; initial.pageTitleTranslationEnabled = false;
    initial.disableFloatingBall = true; initial.disableSelectionTranslator = false; initial.disableImageTranslator = true; initial.selectionAreaEnabled = false;
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
    const word = await import('@/src/features/selection-translation/background/wordLookupHandler');
    const dictionary = await import('@/src/features/selection-translation/services/wordDictionary');
    lookup = dictionary.createWordDictionaryLookup({providers: [{id: 'free-dictionary', lookup: lookupBoundary}]});
    const router = createBackgroundMessageRouter<any>([handlers.createTranslationCancelHandler(registry), word.createSelectionWordLookupHandler({lookupWord: value => lookup.lookup(value), getDefaultTargetLanguage: () => store.config.to, translate: backend.translateWithCache, warn: vi.fn()})],
        handlers.createNativeTranslationRequestFallback(browserBoundary.runtime, {ready: store.configReady,
            translate: backend.translateWithCache, serializeError: serializeTranslationError, requestRegistry: registry, requireDocumentOwner: true}));
    dispatch = vi.fn((message, context) => router.dispatch(message, context));
    server = (await import('@/src/services/translation/documentChannel')).createTranslationDocumentPortHandler({runtimeId: 'ext', dispatch, registries: [registry]});
    await mountPage();
});
afterEach(async()=>{
 domApp?.unmount();domApp=undefined;domHost?.remove();domHost=undefined;bridgeDispose?.();bridgeDispose=undefined;
 unmounted?.forEach(fn=>fn());scope?.stop();pairs.forEach(pair=>pair.close());pendingResponses.forEach(finish=>finish(response('document-private','迟到合成译文')));
 (await import('@/src/app/translation/client')).cancelAllTranslations();await settle();resetFetch?.();if(cache){await cache.translationCache.clear();cache.translationCacheDb.close();}
 vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();
});

/** 生产模板交给 Vue renderer；仅 DOM/Range/History 与 HTTP 是离线边界，路由桥和请求链均为实际模块。 */
function renderCardDOM(){
 const exports:Record<string,any>={};new Function('require','exports',template)((id:string)=>id==='vue'?vue:require(id),exports);
 const renderer=vue.createRenderer<Node,HTMLElement>({
  insert:(child,parent,anchor)=>parent.insertBefore(child,anchor??null),remove:node=>node.parentNode?.removeChild(node),
  createElement:tag=>document.createElement(tag),createText:text=>document.createTextNode(text),createComment:text=>document.createComment(text),
  setText:(node,text)=>{node.nodeValue=text;},setElementText:(node,text)=>{node.textContent=text;},parentNode:node=>node.parentNode as HTMLElement|null,nextSibling:node=>node.nextSibling,
  patchProp:(node,key,_previous,value)=>{if(key==='style'){Object.assign(node.style,value??{});}else if(/^on[A-Z]/u.test(key)){}else if(value==null)node.removeAttribute(key);else node.setAttribute(key,String(value));},
 });
 domHost=document.createElement('div');domHost.id='fluent-read-selection-translator-container';document.body.append(domHost);
 domApp=renderer.createApp({setup:()=>state,render:exports.render});domApp.directive('ui-i18n',{});domApp.mount(domHost);
}
function persistentSelection(){
 const source=document.getElementById('source')!;source.textContent='fixture';const text=source.firstChild!;
 const rect={top:20,right:80,bottom:40,left:20,width:60,height:20};
 const range={startContainer:text,endContainer:text,commonAncestorContainer:text,startOffset:0,endOffset:7,cloneRange:()=>range,getClientRects:()=>[rect],getBoundingClientRect:()=>rect,intersectsNode:()=>false};
 const selection={rangeCount:1,isCollapsed:false,anchorNode:text,anchorOffset:0,getRangeAt:()=>range,containsNode:()=>false,toString:()=>text.textContent};
 Object.assign(window,{getSelection:()=>selection,location});vi.stubGlobal('CustomEvent',document.defaultView!.CustomEvent);
 const historyBoundary={pushState:vi.fn((_state:unknown,_unused:string,url?:string|URL|null)=>{if(url!=null)location.href=new URL(String(url),location.href).href;}),replaceState:vi.fn((_state:unknown,_unused:string,url?:string|URL|null)=>{if(url!=null)location.href=new URL(String(url),location.href).href;})};
 vi.stubGlobal('history',historyBoundary);return {source,text,selection,range,historyBoundary};
}
async function startDelayedBoth(){
 let released=false;const gates:Array<ReturnType<typeof deferred<Response>>>=[];transport.mockImplementation(async(url:RequestInfo|URL,init?:RequestInit)=>{calls.push({url:String(url),body:JSON.parse(String(init?.body)),signal:init?.signal});if(released)return response();const gate=deferred<Response>();gates.push(gate);pendingResponses.push(gate.resolve);return gate.promise;});
 state.snapshot=state.readSelectionSnapshot();state.selectedText='fixture';state.showTooltip=true;
 const request=state.beginSelectionContentRequest('fixture'),main=state.requestTranslation(request),support=state.requestWordCard(request);await pump(()=>calls.length>=2);expect(calls.length).toBeGreaterThanOrEqual(2);await vue.nextTick();expect(domHost!.querySelector('.fr-word-definition-en')?.textContent).toBe('A readable dictionary definition.');
 return {request,release:()=>{released=true;gates.forEach(gate=>gate.resolve(response()));},pending:Promise.all([main,support])};
}
describe('actual SPA route bridge with a persistent selection',()=>{
 it.each(['pushState','replaceState'] as const)('%s invalidates both delayed SDK requests without selectionchange/popstate/hashchange and rejects late DOM/cache',async method=>{
  const selected=persistentSelection();renderCardDOM();const bridge=await import('@/src/platform/shadow-ui/pageBridge');bridgeDispose=bridge.installShadowAndRouteBridge();const routed=vi.fn();document.addEventListener(routeEvent,routed);
  const {release,pending}=await startDelayedBoth();expect(state.readSelectionSnapshot()?.text).toBe('fixture');history[method]({step:1},'','/next');expect(routed).toHaveBeenCalledOnce();expect(selected.text.isConnected).toBe(true);expect(state.readSelectionSnapshot()?.range.startContainer).toBe(selected.text);expect(state.readSelectionSnapshot()?.text).toBe('fixture');
  await settle();const aborted=calls.every(call=>call.signal?.aborted);release();await complete(pending);await vue.nextTick();
  // 所有负控断言在释放响应之后执行，旧源码会真实呈现迟到结果而不是测试挂起。
  expect({aborted,main:state.translationResult,card:state.wordCard,lateMainDOM:domHost!.querySelector('.fr-word-translation pre')?.textContent??null,lateSupportDOM:domHost!.querySelector('.fr-word-definition-zh')?.textContent??null,cacheWrites:cacheWrite.mock.calls.length}).toEqual({aborted:true,main:'',card:null,lateMainDOM:null,lateSupportDOM:null,cacheWrites:0});
  expect(selected.source.textContent).toBe('fixture');document.removeEventListener(routeEvent,routed);
 });
 it.each(['pushState','replaceState'] as const)('%s with unchanged href preserves current main/aux generation',async method=>{
  persistentSelection();renderCardDOM();bridgeDispose=(await import('@/src/platform/shadow-ui/pageBridge')).installShadowAndRouteBridge();const routed=vi.fn();document.addEventListener(routeEvent,routed);
  const {request,release,pending}=await startDelayedBoth();history[method]({step:1},'',location.href);expect(routed).not.toHaveBeenCalled();expect(state.activeContentRequest).toEqual(request);expect(calls.every(call=>!call.signal?.aborted)).toBe(true);release();await complete(pending);expect(domHost!.querySelector('.fr-word-translation pre')?.textContent).toBe('合成译文 document-private');expect(domHost!.querySelector('.fr-word-definition-zh')?.textContent).toBe('合成译文 document-private');expect(cacheWrite).toHaveBeenCalledTimes(3);document.removeEventListener(routeEvent,routed);
 });
 it('duplicate bridge events preserve a fresh generation after the first route invalidates the old one',async()=>{
  persistentSelection();renderCardDOM();bridgeDispose=(await import('@/src/platform/shadow-ui/pageBridge')).installShadowAndRouteBridge();const old=await startDelayedBoth();history.pushState({},'','/next');await settle();expect(calls.every(call=>call.signal?.aborted)).toBe(true);old.release();await complete(old.pending);expect(cacheWrite).not.toHaveBeenCalled();calls=[];
  const fresh=await startDelayedBoth();document.dispatchEvent(new CustomEvent(routeEvent));document.dispatchEvent(new CustomEvent(routeEvent));expect(state.activeContentRequest).toEqual(fresh.request);expect(calls.every(call=>!call.signal?.aborted)).toBe(true);fresh.release();await complete(fresh.pending);expect(domHost!.querySelector('.fr-word-definition-zh')?.textContent).toBe('合成译文 document-private');
 });
 it.each(['close','unmount'] as const)('%s rejects delayed DOM/cache and has bounded listener lifetime across repeated cleanup/remount',async action=>{
  persistentSelection();const listeners=new Set<EventListenerOrEventListenerObject>();const add=document.addEventListener.bind(document),remove=document.removeEventListener.bind(document);
  vi.spyOn(document,'addEventListener').mockImplementation((name,fn,options)=>{if(name===routeEvent)listeners.add(fn);add(name,fn,options);});vi.spyOn(document,'removeEventListener').mockImplementation((name,fn,options)=>{if(name===routeEvent)listeners.delete(fn);remove(name,fn,options);});
  await mountPage();renderCardDOM();bridgeDispose=(await import('@/src/platform/shadow-ui/pageBridge')).installShadowAndRouteBridge();expect(listeners.size).toBe(1);const old=await startDelayedBoth();
  if(action==='close'){state.closeTooltip();state.closeTooltip();expect(listeners.size).toBe(1);}else{unmounted.forEach(fn=>fn());unmounted.forEach(fn=>fn());unmounted=[];scope.stop();domApp!.unmount();domApp=undefined;expect(listeners.size).toBe(0);}
  await settle();expect(calls.every(call=>call.signal?.aborted)).toBe(true);old.release();await complete(old.pending);expect(state.wordCard).toBeNull();expect(domHost!.querySelector('.fr-word-translation pre, .fr-word-definition-zh')).toBeNull();expect(cacheWrite).not.toHaveBeenCalled();
  await mountPage();renderCardDOM();expect(listeners.size).toBe(1);calls=[];const fresh=await startDelayedBoth();history.replaceState({},'','/after-cleanup');await settle();expect(calls.every(call=>call.signal?.aborted)).toBe(true);fresh.release();await complete(fresh.pending);expect(cacheWrite).not.toHaveBeenCalled();unmounted.forEach(fn=>fn());unmounted.forEach(fn=>fn());unmounted=[];scope.stop();expect(listeners.size).toBe(0);
 });
 it('native capability false installs no card route listener and preserves ordinary legacy translation after pushState',async()=>{
  persistentSelection();const add=vi.spyOn(document,'addEventListener');await mountPage(false);renderCardDOM();bridgeDispose=(await import('@/src/platform/shadow-ui/pageBridge')).installShadowAndRouteBridge();expect(add.mock.calls.filter(([name])=>name===routeEvent)).toEqual([]);
  browserBoundary.extension.inIncognitoContext=false;nativeSender.tab.incognito=false;state.snapshot=state.readSelectionSnapshot();state.selectedText='fixture';state.showTooltip=true;const request=state.beginSelectionContentRequest('fixture'),gate=delaySDK(),pending=state.requestTranslation(request);await pump(()=>calls.length>0);history.pushState({},'','/legacy-next');expect(calls[0].signal?.aborted).toBe(false);expect(state.activeContentRequest).toEqual(request);gate.resolve(response('document-public'));await complete(pending);expect(calls[0]).toMatchObject({url:publicURL,body:{model:'document-public'}});expect(domHost!.querySelector('.fr-translation-result pre')?.textContent).toBe('合成译文 document-public');
 });
});
describe('native word-card effective pair and lifetime',()=>{
 it('enriches actual visible dictionary fields through native text Port and SDK while preserving raw semantics',async()=>{
  const pending=state.requestWordCard(begin());await pump(()=>Boolean(state.wordCard?.meanings[0].definitions[0].translatedDefinition));await pending;
  expect(lookupBoundary).toHaveBeenCalledOnce();expect(calls).toHaveLength(2);expect(calls.every(call=>call.url===privateURL&&call.body.model==='document-private')).toBe(true);
  expect(requests()[0]).toMatchObject({origin:['A readable dictionary definition.','A readable dictionary example.'],context:'',pageContext:undefined,enableAIContext:false,useCache:true,serviceOverride:privateService,modelOverride:'document-private'});
  expect(state.wordCard.meanings[0].definitions[0]).toMatchObject({definition:'A readable dictionary definition.',example:'A readable dictionary example.',translatedDefinition:'合成译文 document-private'});
  expect(card().meanings[0].definitions[0]).not.toHaveProperty('translatedDefinition');expect(browserBoundary.runtime.sendMessage.mock.calls.filter(([message]:any)=>message.type==='selectionWordLookup').map(([message]:any)=>message.translateFields)).toEqual([false]);
 });
 it('selects the effective frontend pair before ordinary missing-model capability planning and preserves private prompt',async()=>{
  await store.requestConfigPatch({service:catalog.services.openai,selectionTranslationService:catalog.services.openai,model:{},customModel:{},system_role:{[privateService]:'PRIVATE_CARD_PROMPT',openai:'PUBLIC_CARD_PROMPT'}});
  await state.requestTranslation(begin());expect(requests()[0]).toMatchObject({serviceOverride:privateService,modelOverride:'document-private'});expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({url:privateURL,body:{model:'document-private'}});expect(JSON.stringify(calls[0].body)).toContain('PRIVATE_CARD_PROMPT');expect(JSON.stringify(calls[0].body)).not.toContain('PUBLIC_CARD_PROMPT');expect(state.translationResult).toBe('合成译文 document-private');
 });
});

async function complete(promise:Promise<unknown>){let done=false;const pending=promise.finally(()=>{done=true;});await pump(()=>done);expect(done).toBe(true);await pending;}
async function runWord(){await complete(state.requestWordCard(begin()));}
describe('word-card model safety and compatibility',()=>{
 it.each([undefined,'true',1])('frontend unknown %s closes model requests while independent raw lookup remains',async hint=>{
  browserBoundary.extension.inIncognitoContext=hint;await runWord();await complete(state.requestTranslation(begin()));
  expect(lookupBoundary).toHaveBeenCalledOnce();expect(calls).toEqual([]);expect(cacheRead).not.toHaveBeenCalled();expect(cacheWrite).not.toHaveBeenCalled();expect(state.error).toBe('翻译失败，请重试');
 });
 it.each([undefined,'true',1])('native unknown %s cannot be authorized by a frontend true hint',async hint=>{
  nativeSender.tab.incognito=hint;await runWord();expect(lookupBoundary).toHaveBeenCalledOnce();expect(state.wordCard.meanings[0].definitions[0].translatedDefinition).toBeUndefined();expect(calls).toEqual([]);expect(cacheRead).not.toHaveBeenCalled();expect(cacheWrite).not.toHaveBeenCalled();
 });
 it.each(['regular-invalid-pair','regular-empty','private-empty','unknown-empty'] as const)('%s retains ordinary model path',async kind=>{
  const regular=kind.startsWith('regular');browserBoundary.extension.inIncognitoContext=regular?false:kind==='unknown-empty'?undefined:true;nativeSender.tab.incognito=regular?false:kind==='unknown-empty'?undefined:true;
  await store.requestConfigPatch({incognitoService:kind==='regular-invalid-pair'?'custom:missing':'',incognitoModel:kind==='regular-invalid-pair'?'missing':''});await runWord();expect(calls).toHaveLength(2);expect(calls.every(call=>call.url===publicURL&&call.body.model==='document-public')).toBe(true);
 });
 it('missing dedicated model requirement closes enrichment but preserves dictionary definition',async()=>{
  await store.requestConfigPatch({requireApiKey:{[`v2:${JSON.stringify([privateService,'document-private'])}`]:true}});await runWord();expect(state.wordCard.meanings[0].definitions[0].definition).toBe('A readable dictionary definition.');expect(calls).toEqual([]);expect(cacheRead).not.toHaveBeenCalled();
 });
 it('ordinary/private/endpoint cache identities are actual and markers do not enter payload or persisted keys',async()=>{
  browserBoundary.extension.inIncognitoContext=false;nativeSender.tab.incognito=false;await runWord();expect(calls).toHaveLength(2);
  browserBoundary.extension.inIncognitoContext=true;nativeSender.tab.incognito=true;await runWord();expect(calls).toHaveLength(4);await runWord();expect(calls).toHaveLength(4);
  await store.requestConfigPatch({customOpenAIProviders:store.config.customOpenAIProviders.map(p=>p.id===privateService?{...p,endpoint:'https://next-private.synthetic.test/v1/chat/completions'}:p)});await runWord();expect(calls).toHaveLength(6);expect(calls.slice(-2).every(call=>call.url==='https://next-private.synthetic.test/v1/chat/completions')).toBe(true);
  expect(lookupBoundary).toHaveBeenCalledOnce();expect(JSON.stringify(calls.map(call=>call.body))).not.toMatch(/clientRequestId|inIncognitoContext|incognitoService|trusted-private-source/u);expect(JSON.stringify(cacheIdentity.mock.calls)).not.toMatch(/clientRequestId|inIncognitoContext|incognitoService|trusted-private-source/u);
 });
 const patches={
  model:()=>({incognitoModel:'document-next'}),endpoint:()=>({customOpenAIProviders:store.config.customOpenAIProviders.map(p=>p.id===privateService?{...p,endpoint:'https://save-private.synthetic.test/v1/chat/completions'}:p)}),
  selectionService:()=>({selectionTranslationService:catalog.services.microsoft}),ordinaryModel:()=>({model:{...store.config.model,[publicService]:'ordinary-changed'}}),prompt:()=>({system_role:{[privateService]:'UPDATED_CARD_PROMPT'}}),
  context:()=>({enableAIContext:true}),cache:()=>({useCache:false}),sourceLanguage:()=>({from:'auto'}),targetLanguage:()=>({to:'de'}),thinking:()=>({modelThinking:{[privateService]:{'document-private':true}}}),multiSegment:()=>({enableAIMultiSegment:true}),
 };
 it.each(Object.keys(patches) as Array<keyof typeof patches>)('actual save/subscriber %s aborts SDK and prevents late old-card/cache updates',async kind=>{
  const gate=delaySDK(),pending=state.requestWordCard(begin());await pump(()=>calls.length>0);expect(calls).toHaveLength(1);expect(calls[0].signal?.aborted).toBe(false);
  await store.requestConfigPatch(patches[kind]());expect(calls[0].signal?.aborted).toBe(true);expect(state.wordCard).toBeNull();expect(state.selectedText).toBe('fixture');gate.resolve(response());await complete(pending);expect(state.wordCard).toBeNull();expect(cacheWrite).not.toHaveBeenCalled();
 });
 it.each(['close','pagehide','popstate','hashchange','unmount'] as const)('%s aborts old enrichment, preserving raw dictionary provider object',async action=>{
  const gate=delaySDK(),pending=state.requestWordCard(begin());await pump(()=>calls.length>0);
  if(action==='close')state.closeTooltip();else if(action==='unmount'){unmounted.forEach(fn=>fn());unmounted=[];scope.stop();}else windowEvents.get(action)?.forEach(fn=>fn({isTrusted:true}));
  await settle();expect(calls[0].signal?.aborted).toBe(true);gate.resolve(response());await complete(pending);expect(state.wordCard).toBeNull();expect(cacheWrite).not.toHaveBeenCalled();expect(card().meanings[0].definitions[0]).not.toHaveProperty('translatedDefinition');
 });
 it('counts/UI saves do not cancel current card and its current result may commit',async()=>{
  const gate=delaySDK(),pending=state.requestWordCard(begin());await pump(()=>calls.length>0);await store.requestConfigPatch({count:8,uiLanguage:'en-US'});expect(calls[0].signal?.aborted).toBe(false);gate.resolve(response());await complete(pending);expect(state.wordCard.meanings[0].definitions[0].translatedDefinition).toBe('合成译文 document-private');
 });
 it('enrichment deadline ends actual SDK rather than merely hiding a late response',async()=>{
  delaySDK();const pending=state.requestWordCard(begin());await pump(()=>calls.length>0);await vi.advanceTimersByTimeAsync(2500);await complete(pending);expect(calls[0].signal?.aborted).toBe(true);expect(state.wordCard.meanings[0].definitions[0].translatedDefinition).toBeUndefined();expect(cacheWrite).not.toHaveBeenCalled();
 });
 it('native capability false keeps legacy typed enrichment and does not touch privacy helpers',async()=>{
  await mountPage(false);browserBoundary.extension.inIncognitoContext=undefined;await runWord();
  expect(browserBoundary.runtime.sendMessage.mock.calls.filter(([message]:any)=>message.type==='selectionWordLookup').map(([message]:any)=>message.translateFields)).toEqual([false,true]);expect(requests()).toEqual([]);expect(calls).toEqual([]);expect(windowEvents.get('popstate')?.size??0).toBe(0);
 });
});

describe('word-card native API and concurrent source controls',()=>{
 it('missing frontend extension API keeps dictionary original but closes model requests',async()=>{
  delete browserBoundary.extension;await mountPage();await runWord();expect(state.wordCard.meanings[0].definitions[0].definition).toBe('A readable dictionary definition.');expect(calls).toEqual([]);expect(cacheRead).not.toHaveBeenCalled();
 });
 it.each(['save','close','pagehide'] as const)('%s cancels both main word translation and auxiliary SDK before late cache/card commits',async action=>{
  const gates:Array<ReturnType<typeof deferred<Response>>>=[];transport.mockImplementation(async(url:RequestInfo|URL,init?:RequestInit)=>{calls.push({url:String(url),body:JSON.parse(String(init?.body)),signal:init?.signal});const gate=deferred<Response>();gates.push(gate);pendingResponses.push(gate.resolve);return gate.promise;});
  const request=begin(),main=state.requestTranslation(request),support=state.requestWordCard(request);await pump(()=>calls.length>=2);expect(calls.length).toBeGreaterThanOrEqual(2);
  if(action==='save')await store.requestConfigPatch({incognitoModel:'document-next'});else if(action==='close')state.closeTooltip();else windowEvents.get('pagehide')?.forEach(fn=>fn({isTrusted:true}));
  await settle();expect(calls.every(call=>call.signal?.aborted)).toBe(true);gates.forEach(gate=>gate.resolve(response()));await complete(Promise.all([main,support]));expect(state.wordCard).toBeNull();expect(state.translationResult).toBe('');expect(cacheWrite).not.toHaveBeenCalled();
 });
 it('closing before dictionary response prevents a late card or new model request',async()=>{
  const gate=deferred<ReturnType<typeof card>>();lookupBoundary.mockImplementationOnce(()=>gate.promise);const pending=state.requestWordCard(begin());await settle();expect(lookupBoundary).toHaveBeenCalledOnce();state.closeTooltip();gate.resolve(card());await complete(pending);expect(state.wordCard).toBeNull();expect(calls).toEqual([]);expect(cacheRead).not.toHaveBeenCalled();
 });
 it('ordinary missing credentials cannot block dedicated auxiliary fields and private prompt/thinking are preserved',async()=>{
  await store.requestConfigPatch({selectionTranslationService:catalog.services.openai,model:{},system_role:{openai:'ORDINARY_DICTIONARY_PROMPT',[privateService]:'DEDICATED_DICTIONARY_PROMPT'},modelThinking:{[privateService]:{'document-private':true}},enableAIContext:true});
  await runWord();expect(calls).toHaveLength(2);expect(requests()[0]).toMatchObject({serviceOverride:privateService,modelOverride:'document-private',thinkingOverride:true,context:'',enableAIContext:false,pageContext:undefined});expect(JSON.stringify(calls.map(call=>call.body))).toContain('DEDICATED_DICTIONARY_PROMPT');expect(JSON.stringify(calls.map(call=>call.body))).not.toContain('ORDINARY_DICTIONARY_PROMPT');expect(state.wordCard.meanings[0].definitions[0].translatedDefinition).toBe('合成译文 document-private');
 });
 it('Chrome direct runtime uses module API and actual native sender without global browser',async()=>{
  m.target='chrome';vi.stubGlobal('browser',undefined);try{await runWord();expect(calls).toHaveLength(2);expect(calls.every(call=>call.url===privateURL)).toBe(true);expect(browserBoundary.runtime.connect).not.toHaveBeenCalled();}finally{vi.stubGlobal('browser',browserBoundary);}
 });
});
