/** 实际视频 root→YouTube/X 与 platform runtime→文本 client/原生 Port/handler/registry→broker/cache/provider SDK；DOM/布局、源字幕与 HTTP 使用离线边界。 */
import 'fake-indexeddb/auto';
import {afterEach,beforeEach,describe,expect,it,vi,type MockInstance} from 'vitest';
import {parseHTML} from 'linkedom';
import {Config} from '@/src/core/config/model';
import * as catalog from '@/src/core/config/catalog';
import {documentPortPair} from './helpers/imageDocumentPorts';
const m=vi.hoisted(()=>({values:new Map<string,unknown>(),contexts:vi.fn(),record:vi.fn(),target:'firefox',native:true,cachedAiCues:[] as Array<{startMs:number;durationMs:number;text:string}>,nativeAPI:{} as Record<string,any>}));
vi.mock('@/src/platform/storage/configStorageRuntime',()=>({configStorage:{writeOwner:true,getItem:async(key:string)=>m.values.get(key)??null,setItem:async(key:string,value:unknown)=>{m.values.set(key,structuredClone(value));},removeItem:async(key:string)=>{m.values.delete(key);},watch:()=>()=>{}}}));
vi.mock('webextension-polyfill',()=>({default:new Proxy({},{get:(_t,k)=>Reflect.get(m.nativeAPI,k)})}));
vi.mock('@/src/platform/browser/capabilities',async original=>({...await original<object>(),browserCapabilities:{get browser(){return m.target;},manifestVersion:2}}));
vi.mock('@/src/core/config/incognitoRoute',async original=>({...await original<object>(),get NATIVE_PRIVATE_ROUTE_SUPPORTED(){return m.native;}}));
vi.mock('@/src/platform/storage/modelUsageRepository',()=>({modelUsageRepository:{captureGeneration:()=>1,recordMany:m.record}}));
vi.mock('@/src/platform/storage/translationStatsRepository',()=>({translationStatsRepository:{captureGeneration:()=>1,record:m.record}}));
class BoundaryObserver {
 static instances:BoundaryObserver[]=[];readonly targets=new Set<Node>();
 constructor(readonly callback?:(records:MutationRecord[])=>void){BoundaryObserver.instances.push(this);}
 observe(target:Node){this.targets.add(target);} unobserve(){} disconnect(){this.targets.clear();} takeRecords(){return [];}
}
const publicService='custom:document-public',privateService='custom:document-private';
const publicURL='https://public-document.synthetic.test/v1/chat/completions',privateURL='https://private-document.synthetic.test/v1/chat/completions';
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const settle=async()=>{await tick();await tick();};
function response(model='document-private',content=`合成译文 ${model}`){return new Response(JSON.stringify({id:'synthetic',object:'chat.completion',model,choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
let store:typeof import('@/src/services/config/store'),cache:typeof import('@/src/services/translation/cache');
let cacheRead:MockInstance,cacheWrite:MockInstance,cacheIdentity:MockInstance,transport:ReturnType<typeof vi.fn>,resetFetch:()=>void;
let calls:Array<{url:string;body:any;signal?:AbortSignal|null}>,dispatch:ReturnType<typeof vi.fn>,nativeSender:any,browserBoundary:any;
let server:ReturnType<typeof import('@/src/services/translation/documentChannel').createTranslationDocumentPortHandler>,pairs:ReturnType<typeof documentPortPair>[],pendingResponses:Array<(value:Response)=>void>;
let dispose:(()=>void)|undefined,restoreBridge:(()=>void)|undefined,save:MockInstance;
let runtime:typeof import('@/src/features/video-subtitle/content/runtime');
let downloads:ReturnType<typeof import('@/src/features/video-subtitle/content/downloads').createVideoSubtitleDownloads>|undefined;
const sentence='A complete original video sentence.';
let video:HTMLVideoElement,source:HTMLElement,mode:'youtube'|'platform'|'x'='youtube';
async function pump(until:()=>boolean=()=>false,rounds=400){for(let i=0;i<rounds&&!until();i++){await vi.advanceTimersByTimeAsync(10);await settle();}}
async function mountVideo(kind:'youtube'|'platform'|'x'='youtube'){
 dispose?.();dispose=undefined;mode=kind;
 Object.assign(location,new URL(kind==='youtube'?'https://www.youtube.com/watch?v=synthetic':kind==='x'?'https://x.com/synthetic/status/123':'https://www.udemy.com/course/synthetic/learn/lecture/1'));
 location.href=kind==='youtube'?'https://www.youtube.com/watch?v=synthetic':kind==='x'?'https://x.com/synthetic/status/123':'https://www.udemy.com/course/synthetic/learn/lecture/1';
 // URL accessors are explicit browser-boundary fields, not real page navigation.
 for(const key of ['hostname','pathname','search','origin'])Object.assign(location,{[key]:new URL(location.href)[key as 'hostname']});
 document.body.innerHTML=kind!=='platform'?'<div id="movie_player" class="html5-video-player"><video class="html5-main-video"></video><div class="ytp-caption-window-container"><span class="ytp-caption-segment"></span></div><div class="ytp-right-controls"><button class="ytp-fullscreen-button" aria-label="Full screen"></button></div></div>':'<div><video></video><span data-purpose="captions-cue-text"></span></div>';
 video=document.querySelector('video')!;source=document.querySelector(kind!=='platform'?'.ytp-caption-segment':'[data-purpose="captions-cue-text"]')!;source.textContent=sentence;
 for(const [key,value] of Object.entries({currentTime:1,duration:60,paused:false,ended:false,seeking:false,readyState:4,playbackRate:1,currentSrc:'https://media.synthetic.test/first.mp4',src:'https://media.synthetic.test/first.mp4',textTracks:Object.assign([],{addEventListener:vi.fn(),removeEventListener:vi.fn()})}))Object.defineProperty(video,key,{configurable:true,writable:true,value});
 const downloadModule=await import('@/src/features/video-subtitle/content/downloads');if(!vi.isMockFunction(downloadModule.createVideoSubtitleDownloads)){const original=downloadModule.createVideoSubtitleDownloads;vi.spyOn(downloadModule,'createVideoSubtitleDownloads').mockImplementation(ports=>{downloads=original(ports);return downloads;});}
 runtime=await import('@/src/features/video-subtitle/content/runtime');const ui=await import('@/src/features/video-subtitle/content/ui');save=vi.spyOn(ui,'downloadSubtitleSrt').mockImplementation(()=>{});dispose=runtime.mountVideoSubtitleTranslation();await settle();
}
function translatedDOM(){return (mode==='platform'?document.getElementById('fluent-read-platform-captions')?.shadowRoot?.querySelector('.translation')?.textContent:document.getElementById('fluent-read-video-subtitle')?.textContent)??'';}
const requests=()=>dispatch.mock.calls.map(([message])=>message).filter(message=>'origin' in message);
beforeEach(async()=>{
 dispose=undefined;restoreBridge=undefined;

    vi.resetModules(); vi.clearAllMocks(); BoundaryObserver.instances=[];m.values.clear(); m.target = 'firefox';m.native=true;m.cachedAiCues=[]; m.record.mockResolvedValue(undefined);
    calls = []; pairs = []; pendingResponses = [];  vi.useFakeTimers({toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']});
    const dom = parseHTML('<html><head><title>Synthetic page source title</title></head><body><main><p id="source">Readable synthetic source paragraph.</p></main></body></html>');
    for (const key of ['window','document','Node','Element','HTMLElement','Text','ShadowRoot','DOMParser','HTMLStyleElement','HTMLVideoElement','HTMLButtonElement','HTMLSelectElement','Event','CustomEvent'] as const) vi.stubGlobal(key, dom.window[key]);
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('Unexpected external source fetch in offline video fixture');}));
    const stylePrototype=Object.getPrototypeOf(document.body.style);if(!stylePrototype.getPropertyPriority)stylePrototype.getPropertyPriority=()=>'';
    const selectedValues=new WeakMap<object,string>();Object.defineProperty(HTMLSelectElement.prototype,'value',{configurable:true,get(){return selectedValues.get(this)||'';},set(value){selectedValues.set(this,value);}});
    vi.stubGlobal('MutationObserver', BoundaryObserver); vi.stubGlobal('IntersectionObserver', BoundaryObserver);
    vi.stubGlobal('getComputedStyle', () => ({display: 'block', visibility: 'visible', opacity: '1', position: 'static', whiteSpace: 'normal', overflowY: 'visible', getPropertyValue: () => ''}));
    vi.stubGlobal('innerHeight', 800); vi.stubGlobal('scrollY', 0); vi.stubGlobal('scrollX', 0); vi.stubGlobal('scrollBy', vi.fn());
    const win=window;
    Object.assign(win,{innerWidth:1000,innerHeight:800,setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame:(fn:()=>void)=>setTimeout(fn,16),cancelAnimationFrame:clearTimeout,getComputedStyle,matchMedia:()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})});
    const location = {protocol: 'https:', href: 'https://page.synthetic.test/article'};
    vi.stubGlobal('location', location);Object.defineProperty(window,'location',{configurable:true,value:location});
    Object.defineProperty(document, 'location', {configurable: true, value: location});
    Object.defineProperty(document, 'URL', {configurable: true, value: location.href});
    Object.defineProperty(document, 'contentType', {configurable: true, value: 'text/html'});
    if(!HTMLElement.prototype.focus)HTMLElement.prototype.focus=()=>{};
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
        }), sendMessage: vi.fn(async (message: any) => message.type==='fluentReadGetVideoAiSubtitleCache'?{success:true,hit:m.cachedAiCues.length>0,cues:m.cachedAiCues}:message.type === 'incrementConfigCount'
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
    initial.videoService=publicService;initial.videoTranslationEnabled=true;initial.videoSubtitleVisible=true;initial.videoSubtitleDisplayMode='bilingual';initial.videoPreferHumanSubtitles=false;initial.videoMeetingAutoEnabled=false;initial.from = 'en'; initial.to = 'zh-Hans'; initial.enableAIContext = false; initial.translationMaxRetries = 0;
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
    await mountVideo();
});
afterEach(async()=>{
 dispose?.();restoreBridge?.();pairs.forEach(pair=>pair.close());pendingResponses.forEach(finish=>finish(response('document-private','迟到合成译文')));
 (await import('@/src/app/translation/client')).cancelAllTranslations();await settle();resetFetch?.();if(cache){await cache.translationCache.clear();cache.translationCacheDb.close();}
 vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();
});


describe('actual video entry effective model route',()=>{
 it.each(['youtube','platform'] as const)('%s chooses the frontend effective pair before context/thinking/cache planning',async kind=>{
  if(kind==='platform')await mountVideo(kind);await pump(()=>calls.length>0);expect(calls.length).toBeGreaterThan(0);expect(requests()[0]).toMatchObject({serviceOverride:privateService,modelOverride:'document-private'});expect(calls.every(call=>call.url===privateURL&&call.body.model==='document-private')).toBe(true);expect(source.textContent).toBe(sentence);
 });
});

function holdSDK(){
 const gates:Array<ReturnType<typeof deferred<Response>>>=[];let released=false;
 transport.mockImplementation(async(url:RequestInfo|URL,init?:RequestInit)=>{calls.push({url:String(url),body:JSON.parse(String(init?.body)),signal:init?.signal});if(released)return response();const gate=deferred<Response>();gates.push(gate);pendingResponses.push(gate.resolve);return gate.promise;});
 return {gates,release:()=>{released=true;gates.forEach(gate=>gate.resolve(response()));}};
}
async function startHeld(kind:'youtube'|'platform'='youtube'){const held=holdSDK();if(kind==='platform')await mountVideo(kind);await pump(()=>calls.length>0);expect(calls.length).toBeGreaterThan(0);return held;}
function capture(cues=[{startMs:0,durationMs:5000,text:sentence}]){
 const event=new Event('message');Object.defineProperties(event,{source:{value:window},origin:{value:location.origin},data:{value:{source:'fluent-read',type:'fluent-read-youtube-timedtext',url:'https://www.youtube.com/api/timedtext?v=synthetic&lang=en',responseText:JSON.stringify({events:cues.map(cue=>({tStartMs:cue.startMs,dDurationMs:cue.durationMs,segs:[{utf8:cue.text}]}))})}}});window.dispatchEvent(event);
}
function exportButton(bilingual=false){const eventOpen=new Event('click',{bubbles:true,cancelable:true});Object.defineProperty(eventOpen,'isTrusted',{value:true});document.querySelector<HTMLButtonElement>('#fluent-read-video-subtitle-button')!.dispatchEvent(eventOpen);const button=document.querySelector<HTMLButtonElement>(`[data-action="download-${bilingual?'bilingual':'translated'}-subtitles"]`);expect(button).not.toBeNull();const event=new Event('click',{bubbles:true,cancelable:true});Object.defineProperty(event,'isTrusted',{value:true});button!.dispatchEvent(event);return button!;}
async function routeBridge(){vi.stubGlobal('history',{pushState:(_state:unknown,_unused:string,url?:string|URL|null)=>changeURL(new URL(String(url),location.href).href),replaceState:(_state:unknown,_unused:string,url?:string|URL|null)=>changeURL(new URL(String(url),location.href).href)});restoreBridge=(await import('@/src/platform/shadow-ui/pageBridge')).installShadowAndRouteBridge();}
function changeURL(href:string){const next=new URL(href);for(const key of ['href','hostname','pathname','search','origin'] as const)Object.assign(location,{[key]:next[key]});nativeSender.url=href;}

describe('both actual video runtimes native lifetime and safety',()=>{
 it.each(['youtube','platform'] as const)('%s freezes dedicated prompt/thinking and ignores missing ordinary model credentials',async kind=>{
  await store.requestConfigPatch({service:catalog.services.openai,videoService:catalog.services.openai,model:{},customModel:{},system_role:{openai:'ORDINARY_VIDEO_PROMPT',[privateService]:'PRIVATE_VIDEO_PROMPT'},modelThinking:{[privateService]:{'document-private':true}}});if(kind==='platform')await mountVideo(kind);await pump(()=>calls.length>0);expect(requests()[0]).toMatchObject({serviceOverride:privateService,modelOverride:'document-private',thinkingOverride:true});expect(JSON.stringify(calls.map(call=>call.body))).toContain('PRIVATE_VIDEO_PROMPT');expect(JSON.stringify(calls.map(call=>call.body))).not.toContain('ORDINARY_VIDEO_PROMPT');expect(source.textContent).toBe(sentence);
 });
 it.each(['youtube','platform'] as const)('%s frontend unknown closes before cache/SDK while original subtitle remains',async kind=>{
  browserBoundary.extension.inIncognitoContext=undefined;if(kind==='platform')await mountVideo(kind);await pump();expect(requests()).toEqual([]);expect(calls).toEqual([]);expect(cacheRead).not.toHaveBeenCalled();expect(cacheWrite).not.toHaveBeenCalled();expect(source.textContent).toBe(sentence);
 });
 it.each(['youtube','platform'] as const)('%s native unknown refuses frontend true without cache/SDK',async kind=>{
  nativeSender.tab.incognito=undefined;if(kind==='platform')await mountVideo(kind);await pump();expect(requests().length).toBeGreaterThan(0);expect(calls).toEqual([]);expect(cacheRead).not.toHaveBeenCalled();expect(cacheWrite).not.toHaveBeenCalled();expect(source.textContent).toBe(sentence);
 });
 it.each(['youtube','platform'] as const)('%s missing dedicated requirement blocks provider and preserves raw source',async kind=>{
  await store.requestConfigPatch({requireApiKey:{[`v2:${JSON.stringify([privateService,'document-private'])}`]:true}});if(kind==='platform')await mountVideo(kind);await pump();expect(calls).toEqual([]);expect(cacheRead).not.toHaveBeenCalled();expect(source.textContent).toBe(sentence);
 });
 const patches={model:()=>({incognitoModel:'document-next'}),endpoint:()=>({customOpenAIProviders:store.config.customOpenAIProviders.map(p=>p.id===privateService?{...p,endpoint:'https://saved-video.synthetic.test/v1/chat/completions'}:p)}),videoService:()=>({videoService:catalog.services.microsoft}),ordinaryModel:()=>({model:{...store.config.model,[publicService]:'ordinary-changed'}}),prompt:()=>({system_role:{[privateService]:'UPDATED_VIDEO_PROMPT'}}),thinking:()=>({modelThinking:{[privateService]:{'document-private':true}}}),context:()=>({enableAIContext:true}),cache:()=>({useCache:false}),from:()=>({from:'auto'}),to:()=>({to:'de'}),multiSegment:()=>({enableAIMultiSegment:true})};
 it.each((['youtube','platform'] as const).flatMap(kind=>(Object.keys(patches) as Array<keyof typeof patches>).map(patch=>[kind,patch] as const)))('%s actual save %s cancels old SDK/DOM/cache and retains source',async(kind,patch)=>{
  const held=await startHeld(kind),old=calls[0];await store.requestConfigPatch(patches[patch]());await settle();expect(old.signal?.aborted).toBe(true);held.gates[0].resolve(response('document-private','迟到旧视频译文'));await settle();expect(translatedDOM()).not.toContain('迟到旧视频译文');expect(cacheWrite).not.toHaveBeenCalled();expect(source.textContent).toBe(sentence);
 });
 it.each((['youtube','platform'] as const).flatMap(kind=>(['pushState','replaceState'] as const).map(method=>[kind,method] as const)))('%s actual bridge %s cancels old SDK before poll and prevents late result',async(kind,method)=>{
  await routeBridge();const held=await startHeld(kind),old=calls[0];history[method]({},'',kind==='youtube'?'/watch?v=second':'/course/synthetic/learn/lecture/2');await settle();expect(old.signal?.aborted).toBe(true);held.gates[0].resolve(response('document-private','迟到导航译文'));await settle();expect(translatedDOM()).not.toContain('迟到导航译文');expect(cacheWrite).not.toHaveBeenCalled();expect(source.textContent).toBe(sentence);
 });
 it.each(['youtube','platform'] as const)('%s changed media signal cancels without waiting for polling',async kind=>{
  const held=await startHeld(kind),old=calls[0];Object.defineProperty(video,'currentSrc',{configurable:true,writable:true,value:'https://media.synthetic.test/second.mp4'});video.dispatchEvent(new Event('loadedmetadata',{bubbles:true}));await settle();expect(old.signal?.aborted).toBe(true);held.gates[0].resolve(response('document-private','迟到旧媒体译文'));await settle();expect(translatedDOM()).not.toContain('迟到旧媒体译文');expect(cacheWrite).not.toHaveBeenCalled();expect(source.textContent).toBe(sentence);
 });
 it.each((['youtube','platform'] as const).flatMap(kind=>(['pagehide','unmount'] as const).map(action=>[kind,action] as const)))('%s %s cancels requests and rejects late source generation',async(kind,action)=>{
  const held=await startHeld(kind),old=calls[0];if(action==='pagehide')window.dispatchEvent(new Event('pagehide'));else{dispose?.();dispose=undefined;}await settle();expect(old.signal?.aborted).toBe(true);held.gates[0].resolve(response('document-private','迟到卸载译文'));await settle();expect(translatedDOM()).not.toContain('迟到卸载译文');expect(cacheWrite).not.toHaveBeenCalled();expect(source.textContent).toBe(sentence);
 });
 it.each(['youtube','platform'] as const)('%s count/UI saves preserve current request',async kind=>{const held=await startHeld(kind),old=calls[0];await store.requestConfigPatch({count:5,uiLanguage:'en'});expect(old.signal?.aborted).toBe(false);held.release();await pump(()=>translatedDOM().includes('合成译文'));expect(cacheWrite).toHaveBeenCalled();expect(translatedDOM()).toContain('合成译文');});
 it.each(['youtube','platform'] as const)('%s native false keeps ordinary pair and installs no lifetime route handler',async kind=>{
  dispose?.();dispose=undefined;m.native=false;delete browserBoundary.extension;nativeSender.tab.incognito=undefined;const add=vi.spyOn(document,'addEventListener');await mountVideo(kind);await pump(()=>calls.length>0);expect(calls[0]).toMatchObject({url:publicURL,body:{model:'document-public'}});expect(requests()[0]).toMatchObject({serviceOverride:publicService,modelOverride:'document-public'});expect(add.mock.calls.filter(([name])=>name==='fluentread-route-change')).toEqual([]);
 });
});

describe('actual YouTube entry export request ownership',()=>{
 it.each([false,true])('actual %s export uses dedicated pair and keeps captured original cues',async bilingual=>{
  capture();exportButton(bilingual);await pump(()=>save.mock.calls.length>0);expect(save).toHaveBeenCalledOnce();expect(requests().every(request=>request.serviceOverride===privateService&&request.modelOverride==='document-private')).toBe(true);expect(save.mock.calls[0][0][0].text).toContain('合成译文');if(bilingual)expect(save.mock.calls[0][0][0].text).toContain(sentence);expect((await downloads!.resolve()).cues[0].text).toBe(sentence);expect(source.textContent).toBe(sentence);
 });
 it('export-only cancel aborts its request identity while same-source playback continues',async()=>{
  const held=holdSDK();capture();await pump(()=>calls.length>0);exportButton();await pump(()=>calls.length>=2);expect(requests()).toHaveLength(2);expect(new Set(requests().map(request=>request.clientRequestId)).size).toBe(2);downloads!.cancel();await settle();expect(calls[0].signal?.aborted).toBe(false);expect(calls[1].signal?.aborted).toBe(true);held.release();await pump(()=>translatedDOM().includes('合成译文'));expect(save).not.toHaveBeenCalled();expect(translatedDOM()).toContain('合成译文');expect((await downloads!.resolve()).cues[0].text).toBe(sentence);
 });
 it('playback-only original mode aborts its request while same-source export keeps its own identity',async()=>{
  const held=holdSDK();capture();await pump(()=>calls.length>0);exportButton();await pump(()=>calls.length>=2);await store.requestConfigPatch({videoSubtitleDisplayMode:'original-only'});await settle();expect(calls[0].signal?.aborted).toBe(true);expect(calls[1].signal?.aborted).toBe(false);held.release();await pump(()=>save.mock.calls.length>0);expect(save).toHaveBeenCalledOnce();expect(save.mock.calls[0][0][0].text).toContain('合成译文');expect((await downloads!.resolve()).cues[0].text).toBe(sentence);
 });
 it.each(['save','route','media','unmount'] as const)('%s cancels playback and export identities before late save/cache',async action=>{
  await routeBridge();const held=holdSDK();capture();await pump(()=>calls.length>0);exportButton(true);await pump(()=>calls.length>=2);const old=[...calls];if(action==='save')await store.requestConfigPatch({incognitoModel:'document-next'});else if(action==='route')history.pushState({},'','/watch?v=second');else if(action==='media'){Object.defineProperty(video,'currentSrc',{configurable:true,writable:true,value:'https://media.synthetic.test/second.mp4'});video.dispatchEvent(new Event('loadedmetadata',{bubbles:true}));}else{dispose?.();dispose=undefined;}await settle();expect(old.every(call=>call.signal?.aborted)).toBe(true);held.gates.slice(0,2).forEach(gate=>gate.resolve(response('document-private','迟到导出译文')));await settle();expect(save).not.toHaveBeenCalled();expect(cacheWrite).not.toHaveBeenCalled();expect(translatedDOM()).not.toContain('迟到导出译文');expect(source.textContent).toBe(sentence);
 });
});

describe('video cache/source and compatibility controls',()=>{
 it.each(['youtube','platform'] as const)('%s resolves private context capability before ordinary machine path',async kind=>{
  const context=await import('@/src/services/translation/context');const captureContext=vi.spyOn(context,'getPageTranslationContext').mockResolvedValue('SYNTHETIC_PRIVATE_VIDEO_CONTEXT');await store.requestConfigPatch({service:catalog.services.microsoft,videoService:catalog.services.microsoft,enableAIContext:true});if(kind==='platform')await mountVideo(kind);await pump(()=>calls.length>0);expect(captureContext).toHaveBeenCalled();expect(requests()[0]).toMatchObject({serviceOverride:privateService,modelOverride:'document-private',pageContext:'SYNTHETIC_PRIVATE_VIDEO_CONTEXT'});expect(calls[0]).toMatchObject({url:privateURL,body:{model:'document-private'}});
 });
 it.each((['youtube','platform'] as const).flatMap(kind=>['true',1].map(hint=>[kind,hint] as const)))('%s wrong-typed native %s refuses despite frontend true',async(kind,hint)=>{
  nativeSender.tab.incognito=hint;if(kind==='platform')await mountVideo(kind);await pump();expect(calls).toEqual([]);expect(cacheRead).not.toHaveBeenCalled();expect(source.textContent).toBe(sentence);
 });
 it.each((['youtube','platform'] as const).flatMap(kind=>['true',1].map(hint=>[kind,hint] as const)))('%s wrong-typed frontend %s refuses before message/cache',async(kind,hint)=>{
  browserBoundary.extension.inIncognitoContext=hint;if(kind==='platform')await mountVideo(kind);await pump();expect(requests()).toEqual([]);expect(calls).toEqual([]);expect(cacheRead).not.toHaveBeenCalled();expect(source.textContent).toBe(sentence);
 });
 it.each((['youtube','platform'] as const).flatMap(kind=>(['regular-invalid','private-empty','unknown-empty'] as const).map(variant=>[kind,variant] as const)))('%s %s uses ordinary model path',async(kind,variant)=>{
  browserBoundary.extension.inIncognitoContext=variant==='regular-invalid'?false:variant==='unknown-empty'?undefined:true;nativeSender.tab.incognito=browserBoundary.extension.inIncognitoContext;
  await store.requestConfigPatch({incognitoService:variant==='regular-invalid'?'custom:missing':'',incognitoModel:variant==='regular-invalid'?'missing':''});if(kind==='platform')await mountVideo(kind);await pump(()=>calls.length>0);expect(calls[0]).toMatchObject({url:publicURL,body:{model:'document-public'}});expect(source.textContent).toBe(sentence);
 });
 it.each(['youtube','platform'] as const)('%s actual regular/private/endpoint cache identity stays distinct without transport markers',async kind=>{
  if(kind==='platform')await mountVideo(kind);await pump(()=>translatedDOM().includes('合成译文'));expect(calls).toHaveLength(1);await mountVideo(kind);await pump(()=>translatedDOM().includes('合成译文'));expect(calls).toHaveLength(1);expect(cacheRead.mock.calls.length).toBeGreaterThan(1);
  pairs.forEach(pair=>pair.close());await settle();browserBoundary.extension.inIncognitoContext=false;nativeSender={...nativeSender,documentId:'native-regular-video-document',tab:{id:5,incognito:false}};await store.requestConfigPatch({incognitoModel:'document-next'});await pump(()=>calls.length>=2);expect(calls[1]).toMatchObject({url:publicURL,body:{model:'document-public'}});
  pairs.forEach(pair=>pair.close());await settle();browserBoundary.extension.inIncognitoContext=true;nativeSender={...nativeSender,documentId:'native-next-private-video-document',tab:{id:6,incognito:true}};await store.requestConfigPatch({videoService:publicService,customOpenAIProviders:store.config.customOpenAIProviders.map(p=>p.id===privateService?{...p,endpoint:'https://next-video.synthetic.test/v1/chat/completions'}:p)});await pump(()=>calls.some(call=>call.url==='https://next-video.synthetic.test/v1/chat/completions'));expect(cacheIdentity.mock.calls.length).toBeGreaterThan(1);expect(JSON.stringify(calls.map(call=>call.body))).not.toMatch(/clientRequestId|inIncognitoContext|incognitoService|trusted-private-source/u);expect(JSON.stringify(cacheIdentity.mock.calls)).not.toMatch(/clientRequestId|inIncognitoContext|incognitoService|trusted-private-source/u);
 });
 it('a cancelled previous export cannot replace a newer completed export feedback or file',async()=>{
  const held=holdSDK();capture();exportButton(false);await pump(()=>calls.length>=2);const menu=document.getElementById('fluent-read-video-subtitle-menu')!,button=menu.querySelector<HTMLButtonElement>('[data-action="download-bilingual-subtitles"]')!;
  const latest=downloads!.translated(menu,button,true);await settle();expect(calls[1].signal?.aborted).toBe(true);held.release();let done=false;void latest.finally(()=>{done=true;});await pump(()=>done);await latest;expect(save).toHaveBeenCalledOnce();expect(save.mock.calls[0][1]).toBe('zh-Hans-bilingual');expect(menu.querySelector('[data-download-status]')?.textContent).not.toContain('取消');
 });
 it('native false export keeps legacy shared frontend request and succeeds with ordinary model',async()=>{
  dispose?.();dispose=undefined;m.native=false;await mountVideo();const held=holdSDK();capture();await pump(()=>calls.length>0);exportButton();await settle();expect(requests()).toHaveLength(1);held.release();await pump(()=>save.mock.calls.length>0);expect(save).toHaveBeenCalledOnce();expect(calls[0].url).toBe(publicURL);
 });
 it('X restores synthetic cached ASR source without inference/download and retains it across model save/export',async()=>{
  m.cachedAiCues=[{startMs:0,durationMs:5000,text:'An original cached ASR sentence.'}];const raw=structuredClone(m.cachedAiCues);await mountVideo('x');await pump(()=>calls.length>0);expect(requests()[0]).toMatchObject({serviceOverride:privateService,modelOverride:'document-private'});const sourceCues=(await downloads!.resolve()).cues;expect(sourceCues).toMatchObject(raw);await store.requestConfigPatch({incognitoModel:'document-next'});expect((await downloads!.resolve()).cues).toEqual(sourceCues);expect(m.cachedAiCues).toEqual(raw);exportButton(true);await pump(()=>save.mock.calls.length>0);expect(save).toHaveBeenCalledOnce();expect(save.mock.calls[0][0][0].text).toContain(raw[0].text);expect(browserBoundary.runtime.sendMessage.mock.calls.map(([message]:any)=>message.type)).not.toContain('fluentReadTranscribeLocalVideoAudio');
 });
});

/** DOM replacement is real; the MutationObserver delivery and unflushed RAF are explicit browser boundaries. */
function replaceSelectedVideo(sameURL:boolean){
 const old=video,next=document.createElement('video');next.className=old.className;
 for(const [key,value] of Object.entries({currentTime:1,duration:60,paused:false,ended:false,seeking:false,readyState:4,playbackRate:1,currentSrc:sameURL?old.currentSrc:'https://media.synthetic.test/replacement.mp4',src:sameURL?old.src:'https://media.synthetic.test/replacement.mp4',textTracks:Object.assign([],{addEventListener:vi.fn(),removeEventListener:vi.fn()})}))Object.defineProperty(next,key,{configurable:true,writable:true,value});
 const parent=old.parentElement!;old.replaceWith(next);video=next;
 const record={type:'childList',target:parent,addedNodes:[next],removedNodes:[old]} as unknown as MutationRecord;
 BoundaryObserver.instances.filter(observer=>observer.targets.has(document.documentElement)).forEach(observer=>observer.callback?.([record]));
 return {old,next};
}
function holdLocatorFrames(){
 const frames=new Map<number,FrameRequestCallback>();let id=100000;
 vi.spyOn(window,'requestAnimationFrame').mockImplementation(callback=>{frames.set(++id,callback);return id;});
 const cancel=window.cancelAnimationFrame.bind(window);vi.spyOn(window,'cancelAnimationFrame').mockImplementation(handle=>{if(!frames.delete(handle))cancel(handle);});
 return frames;
}
async function observeProviderSettlements(){
 const {translationRequestScheduler:scheduler}=await import('@/src/app/translation/runtime');
 const settlements:Array<{settled:boolean}>=[],schedule=scheduler.schedule.bind(scheduler);
 vi.spyOn(scheduler,'schedule').mockImplementation((task,options)=>schedule(lease=>{
  const hold=lease.holdUntil.bind(lease);vi.spyOn(lease,'holdUntil').mockImplementation(operation=>{const state={settled:false};settlements.push(state);void Promise.resolve(operation).then(()=>{state.settled=true;},()=>{state.settled=true;});hold(operation);});return task(lease);
 },options));return settlements;
}
describe('actual video node replacement before locator frame',()=>{
 it.each((['youtube','x'] as const).flatMap(kind=>(['loadstart','loadedmetadata'] as const).flatMap(event=>[true,false].flatMap(sameURL=>(['play','export'] as const).map(owner=>[kind,event,sameURL,owner] as const)))))('%s %s sameURL=%s %s revokes old result before RAF',async(kind,event,sameURL,owner)=>{
  const settlements=await observeProviderSettlements(),held=holdSDK();if(kind==='x'){m.cachedAiCues=[{startMs:0,durationMs:5000,text:sentence}];await mountVideo('x');}else capture();const raw=structuredClone(m.cachedAiCues);await pump(()=>calls.length>0);
  if(owner==='export'){exportButton(true);await pump(()=>calls.length>=2);}const oldCalls=[...calls],oldGates=[...held.gates],oldLeases=[...settlements],sourceCues=(await downloads!.resolve()).cues;
  expect(oldLeases.length).toBe(oldCalls.length);expect(oldLeases.every(state=>!state.settled)).toBe(true);
  const frames=holdLocatorFrames(),{old,next}=replaceSelectedVideo(sameURL);expect(old.isConnected).toBe(false);expect(document.querySelector('video')).toBe(next);expect(frames.size).toBeGreaterThan(0);
  next.dispatchEvent(new Event(event,{bubbles:true}));await settle();const immediateAbort=oldCalls.every(call=>call.signal?.aborted);
  oldGates.forEach(gate=>gate.resolve(response('document-private','迟到旧节点译文')));for(let i=0;i<20;i++)await settle();
  const observation={immediateAbort,oldCacheWrites:cacheWrite.mock.calls.length,oldFileSaves:save.mock.calls.length,lateDOM:translatedDOM().includes('迟到旧节点译文')};console.info('replacement-observation',JSON.stringify({kind,event,sameURL,owner,...observation,rafDelivered:0,providerSettled:oldLeases.every(state=>state.settled)}));expect(observation).toEqual({immediateAbort:true,oldCacheWrites:0,oldFileSaves:0,lateDOM:false});
  expect(oldLeases.every(state=>state.settled)).toBe(true);expect(next.textTracks.addEventListener).toHaveBeenCalled();expect(document.querySelector('video')).toBe(next);expect(source.textContent).toBe(sentence);expect(document.title).toBe('Synthetic page source title');expect(m.cachedAiCues).toEqual(raw);if(sameURL)expect((await downloads!.resolve()).cues).toEqual(sourceCues);
 });
 it.each(['youtube','x'] as const)('%s duplicate detached and interleaved old events retain new playback when export cancels',async kind=>{
  const settlements=await observeProviderSettlements(),held=holdSDK();if(kind==='x'){m.cachedAiCues=[{startMs:0,durationMs:5000,text:sentence}];await mountVideo('x');}else capture();const raw=structuredClone(m.cachedAiCues);await pump(()=>calls.length>0);
  const oldCalls=[...calls],oldGates=[...held.gates],sourceCues=(await downloads!.resolve()).cues,frames=holdLocatorFrames(),{old,next}=replaceSelectedVideo(true);next.dispatchEvent(new Event('loadstart',{bubbles:true}));await settle();expect(oldCalls.every(call=>call.signal?.aborted)).toBe(true);await pump(()=>calls.length>oldCalls.length);const playing=calls[oldCalls.length];expect(playing.signal?.aborted).toBe(false);const registrations=vi.mocked(next.textTracks.addEventListener).mock.calls.length;
  for(const event of ['loadstart','loadedmetadata','emptied']){next.dispatchEvent(new Event(event,{bubbles:true}));old.dispatchEvent(new Event(event,{bubbles:true}));await settle();expect(playing.signal?.aborted).toBe(false);}
  next.parentElement!.append(old);for(const event of ['loadstart','loadedmetadata','emptied']){old.dispatchEvent(new Event(event,{bubbles:true}));next.dispatchEvent(new Event(event,{bubbles:true}));await settle();expect(playing.signal?.aborted).toBe(false);}old.remove();old.dispatchEvent(new Event('loadedmetadata',{bubbles:true}));await settle();expect(vi.mocked(next.textTracks.addEventListener).mock.calls).toHaveLength(registrations);expect(document.querySelector('video')).toBe(next);expect(frames.size).toBeGreaterThan(0);
  const beforeExport=calls.length;exportButton(true);await pump(()=>calls.length>beforeExport);const exporting=calls[beforeExport];expect(new Set(requests().map(request=>request.clientRequestId)).size).toBe(requests().length);downloads!.cancel();await settle();expect(exporting.signal?.aborted).toBe(true);expect(playing.signal?.aborted).toBe(false);
  oldGates.forEach(gate=>gate.resolve(response('document-private','迟到交错旧节点译文')));for(let i=0;i<20;i++)await settle();expect(cacheWrite).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();expect(translatedDOM()).not.toContain('迟到交错旧节点译文');held.release();await pump(()=>translatedDOM().includes('合成译文'));for(let i=0;i<20;i++)await settle();expect(translatedDOM()).toContain('合成译文');expect(cacheWrite).toHaveBeenCalledOnce();expect(save).not.toHaveBeenCalled();expect(settlements.every(state=>state.settled)).toBe(true);expect((await downloads!.resolve()).cues).toEqual(sourceCues);expect(m.cachedAiCues).toEqual(raw);expect(source.textContent).toBe(sentence);expect(document.title).toBe('Synthetic page source title');
 });
});
