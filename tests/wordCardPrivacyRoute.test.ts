/** 真实 SelectionTranslator setup→词典原文/辅助编排→文本 client/原生 Port/handler/registry→broker/IndexedDB/SDK；仅布局、非模型 lookup provider、浏览器和合成 HTTP 使用边界。 */
import 'fake-indexeddb/auto';
import {appendFileSync,readFileSync} from 'node:fs';
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
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};}
const card=()=>({word:'fixture',normalizedWord:'fixture',phonetics:[],sources:[{id:'free-dictionary' as const,label:'Synthetic non-model dictionary',url:'https://dictionary.synthetic.test'}],meanings:[{partOfSpeech:'noun',definitions:[{definition:'A readable dictionary definition.',example:'A readable dictionary example.'},{definition:'A readable dictionary definition.'}]}]});
let store:typeof import('@/src/services/config/store'),cache:typeof import('@/src/services/translation/cache');
let cacheRead:MockInstance,cacheWrite:MockInstance,cacheIdentity:MockInstance,transport:ReturnType<typeof vi.fn>,resetFetch:()=>void;
let calls:Array<{url:string;body:any;signal?:AbortSignal|null}>,dispatch:ReturnType<typeof vi.fn>,nativeSender:any,browserBoundary:any;
let server:ReturnType<typeof import('@/src/services/translation/documentChannel').createTranslationDocumentPortHandler>,pairs:ReturnType<typeof documentPortPair>[],pendingResponses:Array<(value:Response)=>void>;
let lookup:ReturnType<typeof import('@/src/features/selection-translation/services/wordDictionary').createWordDictionaryLookup>,lookupBoundary:ReturnType<typeof vi.fn>;
let state:Record<string,any>,scope:vue.EffectScope,mounted:Array<()=>void>,unmounted:Array<()=>void>,windowEvents:Map<string,Set<(event:any)=>void>>;
let domApp:vue.App|undefined,domHost:HTMLElement|undefined,bridgeDispose:(()=>void)|undefined;
let fixtureNativeCapability=true;
const routeEvent='fluentread-route-change';
async function pump(until:()=>boolean=()=>false,rounds=400){for(let i=0;i<rounds&&!until();i++){await vi.advanceTimersByTimeAsync(10);await settle();}}
async function mountPage(nativeCapability=true){
 fixtureNativeCapability=nativeCapability;
 domApp?.unmount();domApp=undefined;domHost?.remove();domHost=undefined;unmounted?.forEach(fn=>fn());scope?.stop();mounted=[];unmounted=[];
 const modules:Record<string,unknown>={
  vue:{...vue,useTemplateRef:()=>vue.ref(null),onMounted:(fn:()=>void)=>mounted.push(fn),onBeforeUnmount:(fn:()=>void)=>unmounted.push(fn)},
  'webextension-polyfill':browserBoundary,'@/src/services/config/store':store,
  '@/src/app/translation/client':await import('@/src/app/translation/client'),
  '@/src/core/config/incognitoRoute':{...await import('@/src/core/config/incognitoRoute'),NATIVE_PRIVATE_ROUTE_SUPPORTED:nativeCapability},
  '@/src/services/translation/requestPrivacy':await import('@/src/services/translation/requestPrivacy'),
  '@/src/features/selection-translation/background/wordLookupHandler':await import('@/src/features/selection-translation/background/wordLookupHandler'),
  '@/src/core/i18n/messages/native-dictionary-feedback':await import('@/src/core/i18n/messages/native-dictionary-feedback'),
  '@/src/services/translation/documentClient':await import('@/src/services/translation/documentClient'),
  '@/src/services/translation/requestRegistry':await import('@/src/services/translation/requestRegistry'),
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
    const legacyWord=word.createSelectionWordLookupHandler({lookupWord:value=>lookup.lookup(value),getDefaultTargetLanguage:()=>store.config.to,translate:backend.translateWithCache,warn:vi.fn()});
    const nativeWord=(word as any).createNativeSelectionWordLookupRuntime?.({ready:store.configReady,getConfig:()=>store.config,runtime:browserBoundary.runtime,subscribeConfig:store.subscribeConfig,
        lookup:(dictionary as any).createNativeWordDictionaryLookup({providers:[{id:'ecdict-local',lookup:lookupBoundary}]})});
    functionsForDictionaryCleanup.push(()=>nativeWord?.dispose());
    const router = createBackgroundMessageRouter<any>([handlers.createTranslationCancelHandler(registry), ...(nativeWord?.handlers??[legacyWord])],
        handlers.createNativeTranslationRequestFallback(browserBoundary.runtime, {ready: store.configReady,
            translate: backend.translateWithCache, serializeError: serializeTranslationError, requestRegistry: registry, requireDocumentOwner: true}));
    dispatch = vi.fn(async(message, context) => !fixtureNativeCapability&&message.type==='selectionWordLookup'&&!message.clientRequestId
        ? {handled:true,response:await legacyWord.handle(message)} : router.dispatch(message, context));
    server = (await import('@/src/services/translation/documentChannel')).createTranslationDocumentPortHandler({runtimeId: 'ext', dispatch, registries: [registry,...(nativeWord?[nativeWord.registry]:[])]});
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
  expect(card().meanings[0].definitions[0]).not.toHaveProperty('translatedDefinition');expect(dispatch.mock.calls.filter(([message]:any)=>message.type==='selectionWordLookup').map(([message]:any)=>message.translateFields)).toEqual([false]);
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
  expect(lookupBoundary).toHaveBeenCalledTimes(2);expect(JSON.stringify(calls.map(call=>call.body))).not.toMatch(/clientRequestId|inIncognitoContext|incognitoService|trusted-private-source/u);expect(JSON.stringify(cacheIdentity.mock.calls)).not.toMatch(/clientRequestId|inIncognitoContext|incognitoService|trusted-private-source/u);
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
  m.target='chrome';vi.stubGlobal('browser',undefined);try{await runWord();expect(calls).toHaveLength(2);expect(calls.every(call=>call.url===privateURL)).toBe(true);expect(browserBoundary.runtime.connect).toHaveBeenCalledOnce();expect(dispatch.mock.calls.filter(([message]:any)=>message.type==='selectionWordLookup')).toHaveLength(1);}finally{vi.stubGlobal('browser',browserBoundary);}
 });
});

/** 使用默认真实词典适配器；只把 extension 资源和 HTTP 响应放在离线边界。 */
async function installActualDictionaryBoundary(hold=false,optionalCache=false){
 Object.assign(window,{getSelection:()=>null});
 const dictionary=await import('@/src/features/selection-translation/services/wordDictionary');
 const word=await import('@/src/features/selection-translation/background/wordLookupHandler');
 const requestModule=await import('@/src/services/translation/requestRegistry');
 const registry=requestModule.createTranslationRequestRegistry(true);
 const network:Array<{url:string;signal?:AbortSignal|null}>=[];let ended=0;
 let held=hold;const gate=deferred<Response>();pendingResponses.push(()=>gate.resolve(new Response(JSON.stringify([{word:'secretwordfixture',meanings:[{partOfSpeech:'noun',definitions:[{definition:'old dictionary result'}]}]}]),{headers:{'content-type':'application/json'}})));
 if(optionalCache)vi.stubGlobal('caches',{open:vi.fn(async()=>({match:vi.fn(async()=>undefined),put:vi.fn(),delete:vi.fn()})),match:vi.fn(async()=>undefined)});
 const http=await import('@/src/platform/http/runtime');http.setRuntimeFetch(async(url,init)=>{
  if(init?.body)return transport(url,init);
  const value=String(url);network.push({url:value,signal:init?.signal});
  if(value.startsWith('moz-extension://ext/'))return new Response(JSON.stringify([['fixture','/fixture/','n. local definition','n. 本地词义']]),{headers:{'content-type':'application/json'}});
  if(held)return gate.promise.then(response=>response.clone());
  if(value.includes('api.dictionaryapi.dev'))return new Response(JSON.stringify([{word:'secretwordfixture',meanings:[{partOfSpeech:'noun',definitions:[{definition:'fresh dictionary result'}]}]}]),{headers:{'content-type':'application/json'}});
  return new Response('[]',{headers:{'content-type':'application/json'},status:404});
 });
 const native=(word as any).createNativeSelectionWordLookupRuntime;
 const runtime=native ? (await import('@/src/app/background/selectionDictionaryRuntime')).createSelectionDictionaryRuntime() : undefined;
 const handlers:Array<{type:string;handle(message:any,context:any):any}>=[...(runtime?.handlers??[word.createSelectionWordLookupHandler({lookupWord:dictionary.lookupWord,getDefaultTargetLanguage:()=>store.config.to,translate:(await import('@/src/app/translation/runtime')).translateWithCache,warn:vi.fn()})])];
 const original=handlers[0].handle;handlers[0]={...handlers[0],async handle(message:any,context:any){try{return await original(message,context);}finally{ended++;}}};
 const router=(await import('@/src/app/background/messageRouter')).createBackgroundMessageRouter<any>(handlers);
 dispatch=vi.fn((message,context)=>router.dispatch({...message,incognito:false,sourcePrivacy:'regular',documentId:'forged'},context));
 server=(await import('@/src/services/translation/documentChannel')).createTranslationDocumentPortHandler({runtimeId:'ext',dispatch,registries:[runtime?.registry??registry]});
 functionsForDictionaryCleanup.push(()=>{if(runtime && 'dispose' in runtime)runtime.dispose();});
 return {network,gate,runtime,external:()=>network.filter(item=>!item.url.startsWith('moz-extension://')),ended:()=>ended,resume:()=>{held=false;}};
}
const functionsForDictionaryCleanup:Array<()=>void>=[];
afterEach(()=>{functionsForDictionaryCleanup.splice(0).forEach(fn=>fn());});
function recordDictionary(value:Record<string,unknown>){const path=process.env.FLUENTREAD_DICTIONARY_OBSERVATIONS;if(path)appendFileSync(path,JSON.stringify(value)+'\n');}
function rawRequest(word='secretwordfixture'){state.snapshot={text:word,parts:[{kind:'text',text:word}]};state.selectedText=word;return state.beginSelectionContentRequest(word);}
async function rawWord(word='secretwordfixture'){await complete(state.requestWordCard(rawRequest(word)));}

describe('actual non-model dictionary privacy and document boundary',()=>{
 it.each(['private','unknown'] as const)('restricted %s miss sends no word or optional download to external providers',async privacy=>{
  nativeSender.tab.incognito=privacy==='private'?true:undefined;browserBoundary.extension.inIncognitoContext=false;
  const boundary=await installActualDictionaryBoundary(false,true);await rawWord();
  recordDictionary({phase:'restricted-miss',privacy,externalRequests:boundary.external().length,cardPresent:Boolean(state.wordCard),note:state.wordCardError});
  expect(boundary.external()).toEqual([]);expect(state.wordCard).toBeNull();expect(state.wordCardError).toContain('在线查询');
 });
 it('restricted private source retains the actual bundled local provider result',async()=>{
  const boundary=await installActualDictionaryBoundary(false,true);await rawWord('fixture');
  expect(boundary.external()).toEqual([]);expect(state.wordCard.sources[0].id).toBe('ecdict-local');expect(state.wordCardError).toContain('在线查询');
 });
 it.each(['regular','private-empty','unknown-empty'] as const)('%s retains normal online dictionary fallback',async kind=>{
  nativeSender.tab.incognito=kind==='regular'?false:kind==='private-empty'?true:undefined;
  if(kind!=='regular')await store.requestConfigPatch({incognitoService:'',incognitoModel:''});
  const boundary=await installActualDictionaryBoundary();await rawWord();expect(boundary.external().length).toBeGreaterThan(0);expect(state.wordCard.meanings[0].definitions[0].definition).toBe('fresh dictionary result');
 });
 it('regular raw cache cannot supply another native document',async()=>{
  nativeSender.tab.incognito=false;const boundary=await installActualDictionaryBoundary();await rawWord();const first=boundary.external().length;
  state.closeTooltip();nativeSender.documentId='another-document';await rawWord();
  recordDictionary({phase:'regular-documents',firstExternal:first,finalExternal:boundary.external().length});expect(boundary.external().length).toBeGreaterThan(first);
 });
 it('regular raw cache cannot supply a restricted private document',async()=>{
  nativeSender.tab.incognito=false;const boundary=await installActualDictionaryBoundary();await rawWord();const first=boundary.external().length;
  state.closeTooltip();nativeSender.tab.incognito=true;nativeSender.documentId='private-document';await rawWord();
  recordDictionary({phase:'profile-cache',firstExternal:first,finalExternal:boundary.external().length,cardPresent:Boolean(state.wordCard)});
  expect(boundary.external()).toHaveLength(first);expect(state.wordCard).toBeNull();expect(state.wordCardError).toContain('在线查询');
 });
 it.each(['close','pagehide','config'] as const)('%s releases held online lookup and prevents late raw cache/card publication',async action=>{
  nativeSender.tab.incognito=false;const boundary=await installActualDictionaryBoundary(true);const pending=state.requestWordCard(rawRequest());
  await pump(()=>boundary.external().length===5);expect(boundary.external()).toHaveLength(5);
  if(action==='close')state.closeTooltip();else if(action==='pagehide')windowEvents.get('pagehide')?.forEach(fn=>fn({isTrusted:true}));else await store.requestConfigPatch({incognitoModel:'document-next'});
  for(let i=0;i<5;i++)await settle();const held={phase:'cancel-held',action,gateReleased:false,handlerEnded:boundary.ended(),signalsAborted:boundary.external().every(item=>item.signal?.aborted),cardPresent:Boolean(state.wordCard)};recordDictionary(held);
  boundary.gate.resolve(new Response(JSON.stringify([{word:'secretwordfixture',meanings:[{partOfSpeech:'noun',definitions:[{definition:'old dictionary result'}]}]}]),{headers:{'content-type':'application/json'}}));await complete(pending);await settle();
  expect(held).toMatchObject({handlerEnded:1,signalsAborted:true,cardPresent:false});expect(state.wordCard).toBeNull();
  boundary.resume();await rawWord();const definition=state.wordCard.meanings[0].definitions[0].definition;
  recordDictionary({phase:'fresh-after-cancel',action,externalRequests:boundary.external().length,definition});
  expect(boundary.external()).toHaveLength(10);expect(definition).toBe('fresh dictionary result');
 });
});

describe('dictionary background composition compatibility',()=>{
 it('legacy composition keeps configured target/service and reports enrichment failure',async()=>{
  nativeSender.tab.incognito=false;await installActualDictionaryBoundary();
  const compose=(await import('@/src/app/background/selectionDictionaryRuntime')).createSelectionDictionaryRuntime;
  const legacy=compose(false);expect(legacy.registry).toBeUndefined();
  const translate=vi.spyOn(await import('@/src/app/translation/runtime'),'translateWithCache').mockResolvedValueOnce(['兼容释义']);
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>undefined);
  try {
   await store.requestConfigPatch({selectionTranslationService:publicService});
   const success:any=await legacy.handlers[0].handle({type:'selectionWordLookup',word:'secretwordfixture'} as any,{});
   expect(success.data.meanings[0].definitions[0].translatedDefinition).toBe('兼容释义');expect(translate.mock.calls[0][0]).toMatchObject({serviceOverride:publicService,targetLanguage:store.config.to});
   await store.requestConfigPatch({selectionTranslationService:''});translate.mockRejectedValueOnce(new Error('synthetic enrichment failure'));
   const result:any=await legacy.handlers[0].handle({type:'selectionWordLookup',word:'secretwordfixture'} as any,{});expect(result.success).toBe(true);expect(warn).toHaveBeenCalled();expect(translate.mock.calls[1][0].serviceOverride).toBe(store.config.service);
  } finally {warn.mockRestore();translate.mockRestore();}
 });
});

describe('native dictionary admission and shared raw query',()=>{
 const message=(clientRequestId='word-one')=>({type:'selectionWordLookup' as const,word:'fixture',translateFields:false,clientRequestId});
 async function local(ready:Promise<void>=store.configReady,runtime:typeof browserBoundary.runtime=browserBoundary.runtime){
  const dictionary=await import('@/src/features/selection-translation/services/wordDictionary');
  const native=(await import('@/src/features/selection-translation/background/wordLookupHandler')).createNativeSelectionWordLookupRuntime({ready,getConfig:()=>store.config,runtime,subscribeConfig:store.subscribeConfig,
   lookup:dictionary.createNativeWordDictionaryLookup({providers:[{id:'ecdict-local',lookup:lookupBoundary}]})});functionsForDictionaryCleanup.push(()=>native.dispose());
  let context!:import('@/src/services/translation/requestRegistry').TranslationRequestContext;
  const channel=(await import('@/src/services/translation/documentChannel')).createTranslationDocumentPortHandler({runtimeId:'ext',dispatch:async(_message,captured)=>{context=captured;return{handled:true,response:{success:true}};},registries:[native.registry]});
  const pair=documentPortPair(nativeSender);pairs.push(pair);channel.connect({...pair.background,name:'fluentReadTranslationDocument:v1'});
  const client=(await import('@/src/services/translation/documentClient')).createTranslationDocumentClient(()=>({...pair.client,name:'fluentReadTranslationDocument:v1'}));await client.request(message('capture'));functionsForDictionaryCleanup.push(()=>client.dispose());return{...native,context};
 }
 it.each(['foreign-extension','missing-extension','missing-port','bad-id','bad-word','translate-fields','target'] as const)('%s refuses raw lookup before any provider',async kind=>{
  const runtime=await local(),msg:any=message();let context:any=(await import('@/src/services/translation/requestRegistry')).captureTranslationRequestContext(runtime.context);
  if(kind==='foreign-extension')context.sender.id='foreign';if(kind==='missing-extension')delete browserBoundary.runtime.id;if(kind==='missing-port')context={sender:nativeSender};
  if(kind==='bad-id')msg.clientRequestId='bad id';if(kind==='bad-word')msg.word=null;if(kind==='translate-fields')msg.translateFields=true;if(kind==='target')msg.targetLanguage=' ';
  await expect(runtime.handlers[0].handle(msg,context)).rejects.toThrow();expect(lookupBoundary).not.toHaveBeenCalled();
 });
 it.each(['private','regular'] as const)('local provider failure is explicit and no online replacement occurs for %s',async privacy=>{
  nativeSender.tab.incognito=privacy==='private';lookupBoundary.mockRejectedValue(new Error('synthetic local unavailable'));const runtime=await local();const pending=runtime.handlers[0].handle(message(),runtime.context);
  if(privacy==='private')await expect(pending).resolves.toMatchObject({success:true,data:null,onlineDictionaryRestricted:true});else await expect(pending).rejects.toThrow('不可用');expect(lookupBoundary).toHaveBeenCalledOnce();expect(calls).toEqual([]);
 });
 it.each(['cancel','deadline','source-cancel'] as const)('%s releases native preparation before late readiness/source response',async action=>{
  const gate=deferred<void>(),contextGate=deferred<unknown>();
  if(action==='source-cancel'){delete nativeSender.tab;nativeSender.url='moz-extension://ext/popup.html';m.contexts.mockReturnValue(contextGate.promise);}
  const runtime=await local(action==='source-cancel'?store.configReady:gate.promise),context=runtime.context,pending=runtime.handlers[0].handle(message(),context).catch(error=>error);await settle();
  if(action==='deadline')await vi.advanceTimersByTimeAsync(3501);else runtime.handlers[1].handle({clientRequestId:'word-one'},context);
  await expect(pending).resolves.toMatchObject({name:'AbortError'});expect(runtime.registry.cancel('word-one',context).cancelled).toBe(false);gate.resolve();if(action==='source-cancel')contextGate.reject(new Error('late context failure'));else contextGate.resolve([]);await settle();expect(lookupBoundary).not.toHaveBeenCalled();
 });
 it('real Port cancellation preserves the other subscriber and the shared HTTP query',async()=>{
  nativeSender.tab.incognito=false;const boundary=await installActualDictionaryBoundary(true);const client=(await import('@/src/services/translation/documentClient')).createTranslationDocumentClient(()=>browserBoundary.runtime.connect({name:'fluentReadTranslationDocument:v1'}));
  const first=client.request({...message('first'),word:'secretwordfixture'}),second=client.request({...message('second'),word:'secretwordfixture'});await pump(()=>boundary.external().length===5);expect(boundary.external()).toHaveLength(5);
  await client.request({type:'selectionWordLookupCancel',clientRequestId:'first'});await expect(first).resolves.toMatchObject({success:false});expect(boundary.external().every(item=>!item.signal?.aborted)).toBe(true);
  boundary.gate.resolve(new Response(JSON.stringify([{word:'secretwordfixture',meanings:[{partOfSpeech:'noun',definitions:[{definition:'valid shared result'}]}]}]),{headers:{'content-type':'application/json'}}));
  await expect(second).resolves.toMatchObject({success:true,data:{word:'secretwordfixture'}});expect(boundary.external()).toHaveLength(5);client.dispose();
 });
 it('restricted cached data is displayed with a visible explicit limitation and never enters persistent raw storage',async()=>{
  await installActualDictionaryBoundary();await rawWord('fixture');state.showTooltip=true;renderCardDOM();await vue.nextTick();expect(domHost!.querySelector('.fr-word-fallback-note')?.textContent).toContain('仅显示本地词典，在线查询不可用');
   await store.requestConfigPatch({uiLanguage:'en-US'});await vue.nextTick();expect(domHost!.querySelector('.fr-word-fallback-note')?.textContent).toContain('Local dictionary only. Online lookup is unavailable.');await store.requestConfigPatch({uiLanguage:'zh-CN'});await vue.nextTick();expect(domHost!.querySelector('.fr-word-fallback-note')?.textContent).toContain('仅显示本地词典，在线查询不可用');
  expect([...m.values.keys()].some(key=>/word|dictionary/iu.test(key))).toBe(false);expect(cacheWrite).not.toHaveBeenCalled();expect(calls).toEqual([]);
 });
});


describe('native dictionary feedback localization',()=>{
 it.each(['zh-CN','en-US','ja-JP','ko-KR','fr-FR','ru-RU','es-ES'] as const)('%s provides both short restriction notes',async language=>{
  const {nativeDictionaryFeedback:source,localizeNativeDictionaryFeedback:localize}=await import('@/src/core/i18n/messages/native-dictionary-feedback');const copy={local:source('local'),missing:source('missing')};
  const local=localize(copy.local,language),missing=localize(copy.missing,language);expect(local).toBeTruthy();expect(missing).toBeTruthy();expect(local).not.toBe(missing);
  if(language!=='zh-CN')expect(local).not.toBe(copy.local);expect(localize(local!, 'zh-CN')).toBe(copy.local);expect(localize(missing!, 'zh-CN')).toBe(copy.missing);expect(localize('ordinary feedback',language)).toBeUndefined();
 });
 it('falls back to Chinese for an unrecognized interface language',async()=>{
  const {nativeDictionaryFeedback:source,localizeNativeDictionaryFeedback:localize}=await import('@/src/core/i18n/messages/native-dictionary-feedback');const copy={local:source('local'),missing:source('missing')};expect(localize(copy.local,'invalid' as any)).toBe(copy.local);
 });
});
