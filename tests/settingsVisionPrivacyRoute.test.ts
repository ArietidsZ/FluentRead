/** 真实设置 SFC→保存/原生文档 Port/typed handler/registry→共享 probe/broker/SDK；仅浏览器、本地存储和合成 HTTP 是边界。 */
import 'fake-indexeddb/auto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {compileScript,compileTemplate,parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import * as vue from 'vue';
import {Config} from '@/src/core/config/model';
import {documentPortPair} from './helpers/imageDocumentPorts';

const m=vi.hoisted(()=>({values:new Map<string,unknown>(),watchers:new Map<string,Set<(value:unknown)=>void>>(),contexts:vi.fn(),record:vi.fn(),api:{} as Record<string,any>,writes:vi.fn(),hold:undefined as undefined|((records:any[])=>Promise<void>)}));
vi.mock('@/src/platform/storage/configStorageRuntime',()=>({configStorage:{writeOwner:true,getItem:async(key:string)=>m.values.get(key)??null,setItem:async(key:string,value:unknown)=>{m.values.set(key,structuredClone(value));},removeItem:async(key:string)=>{m.values.delete(key);},watch:()=>()=>{}}}));
vi.mock('@wxt-dev/storage',()=>({storage:{getItem:async(key:string)=>m.values.get(key)??null,setItem:async(key:string,value:any[])=>{m.writes(key,structuredClone(value));await m.hold?.(value);m.values.set(key,structuredClone(value));for(const fn of m.watchers.get(key)??[])fn(value);},watch:(key:string,fn:(value:unknown)=>void)=>{const set=m.watchers.get(key)??new Set();set.add(fn);m.watchers.set(key,set);return()=>set.delete(fn);}}}));
vi.mock('webextension-polyfill',()=>({default:new Proxy({},{get:(_t,k)=>Reflect.get(m.api,k)})}));
vi.mock('@/src/platform/storage/modelUsageRepository',()=>({modelUsageRepository:{captureGeneration:()=>1,recordMany:m.record}}));
vi.mock('@/src/platform/storage/translationStatsRepository',()=>({translationStatsRepository:{captureGeneration:()=>1,record:m.record}}));

const require=createRequire(import.meta.url),filename='src/features/settings/ui/services/ModelVisionSettings.vue';
const {descriptor}=parse(readFileSync(filename,'utf8'),{filename});
const script=compileScript(descriptor,{id:'settings-vision-privacy'});
const compile=(source:string)=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const compiled=compile(script.content),template=compile(compileTemplate({source:descriptor.template!.content,filename,id:'settings-vision-privacy',compilerOptions:{bindingMetadata:script.bindings}}).code);
const publicService='custom:probe-public',privateService='custom:probe-private',publicModel='probe-public',privateModel='probe-private';
const publicURL='https://probe-public.synthetic.test/v1/chat/completions',privateURL='https://probe-private.synthetic.test/v1/chat/completions';
const storageKey='local:modelVisionProbe:v1';
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function settle(){await tick();await tick();await vue.nextTick();}
async function pump(until:()=>boolean,rounds=300){for(let i=0;i<rounds&&!until();i++){await vi.advanceTimersByTimeAsync(10);await settle();}expect(until()).toBe(true);}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
function response(model=privateModel,content='ABCDEF'){return new Response(JSON.stringify({id:'synthetic',object:'chat.completion',model,choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}]}),{headers:{'content-type':'application/json'}});}
let store:typeof import('@/src/services/config/store'),cache:typeof import('@/src/services/translation/cache'),shared:typeof import('@/src/app/translation/visionProbeRuntime');
let handlers:ReturnType<typeof import('@/src/app/background/handlers/visionProbe').createVisionProbeHandlers>,registry:import('@/src/services/translation/requestRegistry').TranslationRequestRegistry;
let server:ReturnType<typeof import('@/src/services/translation/documentChannel').createTranslationDocumentPortHandler>,dispatch:ReturnType<typeof vi.fn>,transport:ReturnType<typeof vi.fn>,resetFetch:()=>void;
let pairs:ReturnType<typeof documentPortPair>[],sender:any,calls:Array<{url:string;body:any;signal?:AbortSignal|null}>,releases:Array<()=>void>;
let props:{config:Config;service:string;model:string},state:any,app:vue.App|undefined,host:HTMLElement|undefined;
let functions:Array<()=>void>,scope:vue.EffectScope,windowEvents:Map<string,(event:any)=>void>;
function directMessage(id='probe-one',service=privateService,model=privateModel){return{type:'fluentReadModelVisionProbe',service,model,requestId:id,clientRequestId:id,identity:identity(service,model)};}
function identity(service=privateService,model=privateModel){return imports.core.createVisionProbeIdentity(imports.probe.freezeVisionProbeConfig(store.config),service,model);}
let imports:{core:typeof import('@/src/core/config/visionProbe');probe:typeof import('@/src/services/translation/visionProbe');privacy:typeof import('@/src/services/translation/requestPrivacy');client:typeof import('@/src/services/translation/documentClient');native:typeof import('@/src/core/config/incognitoRoute')};
function records(){return m.values.get(storageKey)??[];}
function delayHTTP(){const gate=deferred<Response>();releases.push(()=>gate.resolve(response()));transport.mockImplementationOnce(async(url:RequestInfo|URL,init?:RequestInit)=>{calls.push({url:String(url),body:JSON.parse(String(init?.body)),signal:init?.signal});return gate.promise;});return gate;}
async function complete(promise:unknown){let done=false;const outcome=Promise.resolve(promise).finally(()=>{done=true;});await pump(()=>done);return outcome;}
async function mount(native=true,service=privateService,model=privateModel){
 app?.unmount();functions?.forEach(fn=>fn());scope?.stop();host?.remove();functions=[];
 props=vue.reactive({config:Object.assign(new Config(),structuredClone(store.config)),service,model});
 functions.push(store.subscribeConfig(next=>{props.config=Object.assign(new Config(),structuredClone(next));}));
 const modules:Record<string,any>={vue,'webextension-polyfill':m.api,
  '@/src/core/config/vision':await import('@/src/core/config/vision'),'@/src/core/config/visionProbe':imports.core,
  '@/src/services/translation/visionProbe':imports.probe,'@/src/core/config/incognitoRoute':{...imports.native,NATIVE_PRIVATE_ROUTE_SUPPORTED:native},
  '@/src/services/translation/requestPrivacy':imports.privacy,'@/src/services/translation/documentClient':imports.client,
  './useVisionProbeStatus':await import('@/src/features/settings/ui/services/useVisionProbeStatus'),
  '@/src/services/config/store':store,'@/src/ui/i18n':{useUiI18n:()=>({t:(key:string)=>key})},
  '../components/SegmentedControl.vue':vue.defineComponent({setup:()=>()=>vue.h('span')})};
 const exports:Record<string,any>={};new Function('require','exports',compiled)((id:string)=>id in modules?modules[id]:require(id),exports);
 scope=vue.effectScope();
 const rendered:Record<string,any>={};new Function('require','exports',template)((id:string)=>id==='vue'?vue:require(id),rendered);
 const renderer=vue.createRenderer<Node,HTMLElement>({insert:(node,parent,anchor)=>parent.insertBefore(node,anchor??null),remove:node=>node.parentNode?.removeChild(node),createElement:tag=>document.createElement(tag),createText:text=>document.createTextNode(text),createComment:text=>document.createComment(text),setText:(node,text)=>{node.nodeValue=text;},setElementText:(node,text)=>{node.textContent=text;},parentNode:node=>node.parentNode as HTMLElement|null,nextSibling:node=>node.nextSibling,
  patchProp:(node,key,previous,value)=>{if(/^on[A-Z]/u.test(key)){const event=key.slice(2).toLowerCase();if(previous)node.removeEventListener(event,previous);if(value)node.addEventListener(event,value);}else if(key==='style')Object.assign(node.style,value??{});else if(value==null)node.removeAttribute(key);else node.setAttribute(key,String(value));}});
 exports.default.render=rendered.render;host=document.createElement('div');document.body.append(host);app=renderer.createApp({setup:()=>()=>vue.h(exports.default,props)});app.component('el-button',vue.defineComponent({setup:(_props,{slots})=>()=>vue.h('button',slots.default?.())}));app.component('SegmentedControl',modules['../components/SegmentedControl.vue']);app.mount(host);state=(app as any)._instance.subTree.component.setupState;await settle();
}
function click(){host!.querySelector('[data-testid="model-vision-probe"]')!.dispatchEvent(new window.Event('click'));}
function feedback(){return host!.querySelector('[data-testid="model-vision-probe-feedback"]')?.textContent??'';}
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();m.values.clear();m.watchers.clear();m.hold=undefined;m.record.mockResolvedValue(undefined);calls=[];pairs=[];releases=[];functions=[];windowEvents=new Map();
 vi.useFakeTimers({toFake:['Date','setTimeout','clearTimeout','setInterval','clearInterval']});
 const dom=parseHTML('<html><body></body></html>');for(const key of ['window','document','Node','Element','HTMLElement','Text'] as const)vi.stubGlobal(key,dom.window[key]);
 vi.stubGlobal('window',{Event:dom.window.Event,addEventListener:(name:string,fn:(event:any)=>void)=>windowEvents.set(name,fn),removeEventListener:(name:string)=>windowEvents.delete(name),setTimeout,clearTimeout});
 vi.stubGlobal('location',{protocol:'moz-extension:',href:'moz-extension://ext/options.html'});vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('real network forbidden');}));
 const rng=crypto.getRandomValues.bind(crypto);vi.spyOn(crypto,'getRandomValues').mockImplementation((array:any)=>{if(array.length===3){array.set([0xab,0xcd,0xef]);return array;}return rng(array);});
 sender={id:'ext',documentId:'settings-document',frameId:0,url:'moz-extension://ext/options.html',tab:{id:4,incognito:true}};
 m.api={extension:vue.reactive({inIncognitoContext:true}),runtime:{id:'ext',getURL:(path:string)=>`moz-extension://ext/${path.replace(/^\//u,'')}`,getContexts:m.contexts,
  connect:vi.fn(()=>{const pair=documentPortPair(sender);pairs.push(pair);expect(server.connect({...pair.background,name:'fluentReadTranslationDocument:v1'})).toBe(true);return{...pair.client,name:'fluentReadTranslationDocument:v1'};}),
  sendMessage:vi.fn(async(message:any)=>(await dispatch(message,{sender})).response),onMessage:{addListener:vi.fn(),removeListener:vi.fn()}},tabs:{create:vi.fn()}};
 vi.stubGlobal('browser',m.api);m.contexts.mockResolvedValue([]);
 const initial=new Config();initial.service=publicService;initial.model={[publicService]:publicModel,[privateService]:'probe-ordinary'};
 initial.customOpenAIProviders=[{id:publicService,name:'Synthetic public probe',endpoint:publicURL,models:[publicModel,'probe-public-next']},{id:privateService,name:'Synthetic private probe',endpoint:privateURL,models:[privateModel,'probe-next','probe-ordinary']}];
 initial.incognitoService=privateService;initial.incognitoModel=privateModel;initial.translationMaxRetries=0;initial.enableAIContext=false;initial.maxConcurrentTranslations=5;initial.translationRequestsPerSecond=100;
 initial.requireApiKey=Object.fromEntries([[publicService,publicModel],[publicService,'probe-public-next'],[privateService,privateModel],[privateService,'probe-next'],[privateService,'probe-ordinary']].map(pair=>[`v2:${JSON.stringify(pair)}`,false]));
 m.values.set('local:config',initial);store=await import('@/src/services/config/store');await store.configReady;
 const http=await import('@/src/platform/http/runtime');resetFetch=()=>http.setRuntimeFetch();transport=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));calls.push({url:String(url),body,signal:init?.signal});return response(body.model);});http.setRuntimeFetch(transport);
 cache=await import('@/src/services/translation/cache');await cache.translationCache.clear();shared=await import('@/src/app/translation/visionProbeRuntime');
 imports={core:await import('@/src/core/config/visionProbe'),probe:await import('@/src/services/translation/visionProbe'),privacy:await import('@/src/services/translation/requestPrivacy'),client:await import('@/src/services/translation/documentClient'),native:await import('@/src/core/config/incognitoRoute')};
 registry=(await import('@/src/services/translation/requestRegistry')).createTranslationRequestRegistry(true);
 handlers=(await import('@/src/app/background/handlers/visionProbe')).createVisionProbeHandlers({ready:store.configReady,getConfig:()=>store.config,runtime:m.api.runtime,requestRegistry:registry,subscribeConfig:store.subscribeConfig,isSettingsUrl:url=>url.split(/[?#]/u)[0]==='moz-extension://ext/options.html',resolve:shared.modelVisionProbe.resolve});
 const persistence=(await import('@/src/app/background/handlers/configPersistence')).createConfigPersistenceHandler({ready:store.configReady,getCurrentConfig:()=>store.config,prepareConfigSaveRequest:store.prepareConfigSaveRequest,prepareConfigPatchRequest:store.prepareConfigPatchRequest,saveConfig:store.saveConfig,getCurrentRevision:store.getConfigRevision,isExtensionUrl:url=>url.startsWith('moz-extension://ext/')});
 const router=(await import('@/src/app/background/messageRouter')).createBackgroundMessageRouter<any>([...handlers,persistence]);dispatch=vi.fn((message,context)=>router.dispatch(message,context));server=(await import('@/src/services/translation/documentChannel')).createTranslationDocumentPortHandler({runtimeId:'ext',dispatch,registries:[registry]});
 await mount();
});
afterEach(async()=>{
 app?.unmount();app=undefined;functions.forEach(fn=>fn());functions=[];scope?.stop();host?.remove();host=undefined;pairs.forEach(pair=>pair.close());releases.forEach(fn=>fn());await settle();resetFetch?.();if(cache){await cache.translationCache.clear();cache.translationCacheDb.close();}vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();
});

describe('settings probe actual UI and shared native chain',()=>{
 it('actual button saves first, tests the explicitly matching private target, displays it and persists only bounded hashes',async()=>{
  click();await pump(()=>!state.busy);expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({url:privateURL,body:{model:privateModel}});expect(m.api.runtime.connect).toHaveBeenCalledOnce();expect(m.api.runtime.sendMessage.mock.calls.map(([msg]:any)=>msg.type)).toEqual(['persistConfig']);expect(dispatch.mock.calls.map(([msg])=>msg.type)).toEqual(['persistConfig','fluentReadModelVisionProbe']);
  expect(feedback()).toContain(`${privateService} / ${privateModel}`);expect(feedback()).toContain('visionProbeSupported');expect(records()).toMatchObject([{identity:imports.core.createVisionProbeIdentity(imports.core.scopeVisionProbeConfig(store.config,'private'),privateService,privateModel),capability:'supported'}]);expect((records() as any[])[0].checkedAt).toBeLessThanOrEqual(Date.now());
  const body=JSON.stringify(calls[0].body);expect(body).toContain('data:image/png;base64,');expect(body).not.toContain('ABCDEF');expect(body).not.toContain('incognito');expect(JSON.stringify(records())).not.toContain(privateModel);expect(globalThis.fetch).not.toHaveBeenCalled();
 });
 it.each(['provider','model','missing'] as const)('actual UI refuses a mismatched %s in the native response instead of displaying successful original intent',async changed=>{
  const gate=delayHTTP();click();await pump(()=>calls.length===1);const post=pairs[0].background.postMessage as ReturnType<typeof vi.fn>,original=post.getMockImplementation()!;post.mockImplementation((packet:any)=>{if(packet.kind==='result'&&packet.response?.success){packet={...packet,response:{...packet.response}};if(changed==='provider')packet.response.service='custom:unexpected';else if(changed==='model')packet.response.model='unexpected';else{delete packet.response.service;delete packet.response.model;}}original(packet);});gate.resolve(response());await pump(()=>!state.busy);expect(feedback()).toContain('不一致');expect(feedback()).not.toContain('Supported');expect(calls[0].body.model).toBe(privateModel);
 });
 it('actual UI refuses private mismatched explicit selection without save, model request or ordinary cache conclusion',async()=>{
  await mount(true,publicService,publicModel);click();await pump(()=>!state.busy);expect(feedback()).toContain('不一致');expect(calls).toEqual([]);expect(m.api.runtime.sendMessage).not.toHaveBeenCalled();expect(records()).toEqual([]);expect(state.capabilityStatus).toEqual({capability:'unknown',source:'unknown'});
 });
 it.each([undefined,'true',1])('actual UI unknown hint %s with configured pair refuses before any call',async hint=>{
  m.api.extension.inIncognitoContext=hint;click();await pump(()=>!state.busy);expect(feedback()).toContain('无法确认');expect(calls).toEqual([]);expect(m.api.runtime.sendMessage).not.toHaveBeenCalled();
 });
 it('frontend false cannot elevate a native private sender into regular explicit selection',async()=>{
  m.api.extension.inIncognitoContext=false;await mount(true,publicService,publicModel);click();await pump(()=>!state.busy);expect(feedback()).toContain('不一致');expect(calls).toEqual([]);expect(dispatch.mock.calls.map(([msg])=>msg.type)).toContain('fluentReadModelVisionProbe');
 });
 it('regular window retains manual provider/model intent even with a configured private pair',async()=>{
  sender.tab.incognito=false;m.api.extension.inIncognitoContext=false;await mount(true,publicService,'probe-public-next');click();await pump(()=>!state.busy);expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({url:publicURL,body:{model:'probe-public-next'}});expect(feedback()).toContain('probe-public-next');expect((records() as any[])[0].identity).toBe(identity(publicService,'probe-public-next'));
 });
 it('native capability false preserves the ordinary UI direct-message contract and feedback',async()=>{
  sender.tab.incognito=false;m.api.extension.inIncognitoContext=false;await mount(false,publicService,publicModel);click();await pump(()=>!state.busy);expect(calls).toHaveLength(1);expect(calls[0].body.model).toBe(publicModel);expect(m.api.runtime.connect).not.toHaveBeenCalled();const message=m.api.runtime.sendMessage.mock.calls.map(([msg]:any)=>msg).find((msg:any)=>msg.type==='fluentReadModelVisionProbe');expect(message).not.toHaveProperty('clientRequestId');expect(state.feedback).toBe('settings.services.visionProbeSupported');
 });
 it('actual selected model change cancels its old Port request and never labels the new model with a late answer',async()=>{
  sender.tab.incognito=false;m.api.extension.inIncognitoContext=false;await mount(true,publicService,publicModel);const old=delayHTTP();click();await pump(()=>calls.length===1);props.model='probe-public-next';await settle();expect(calls[0].signal?.aborted).toBe(true);old.resolve(response(publicModel));await settle();expect(records()).toEqual([]);expect(feedback()).not.toContain('Supported');click();await pump(()=>calls.length===2&&!state.busy);expect(calls[1].body.model).toBe('probe-public-next');expect(feedback()).toContain('probe-public-next');expect(records()).toHaveLength(1);
 });
 it('actual component unmount stops the cache subscription and removes its lifetime timer',async()=>{
  click();await pump(()=>!state.busy);expect(m.watchers.get(storageKey)?.size).toBe(1);const timersBeforeUnmount=vi.getTimerCount();app!.unmount();app=undefined;expect(m.watchers.get(storageKey)?.size).toBe(0);expect(vi.getTimerCount()).toBe(timersBeforeUnmount-1);
 });
 it.each(['regular','private','unknown'] as const)('both-empty configuration preserves %s explicit manual execution',async privacy=>{
  await store.requestConfigPatch({incognitoService:'',incognitoModel:''});sender.tab.incognito=privacy==='unknown'?undefined:privacy==='private';m.api.extension.inIncognitoContext=privacy==='unknown'?undefined:privacy==='private';await mount(true,publicService,publicModel);click();await pump(()=>!state.busy);expect(calls).toHaveLength(1);expect(calls[0].body.model).toBe(publicModel);expect(feedback()).toContain(publicModel);
 });
 it('actual saved private pair change cancels pending HTTP and ignores late UI/cache before the new target succeeds',async()=>{
  const old=delayHTTP();click();await pump(()=>calls.length===1);await store.requestConfigPatch({incognitoModel:'probe-next'});await settle();expect(calls[0].signal?.aborted).toBe(true);old.resolve(response());await pump(()=>!state.busy);expect(records()).toEqual([]);expect(feedback()).not.toContain('Supported');props.model='probe-next';await settle();click();await pump(()=>calls.length===2&&!state.busy);expect(calls[1].body.model).toBe('probe-next');expect(feedback()).toContain('probe-next');expect(records()).toHaveLength(1);
 });
 it.each(['button','unmount','disconnect','native-pagehide'] as const)('%s cancels an owned delayed probe and rejects late UI/cache',async action=>{
  const old=delayHTTP();click();await pump(()=>calls.length===1);if(action==='button')click();else if(action==='unmount'){functions.forEach(fn=>fn());scope.stop();app!.unmount();app=undefined;}else if(action==='disconnect')pairs[0].close();else windowEvents.get('pagehide')!({isTrusted:true});await settle();expect(calls[0].signal?.aborted).toBe(true);old.resolve(response());await settle();expect(records()).toEqual([]);expect(feedback()).not.toContain('Supported');
 });
 it('ordinary count and UI preference saves do not cancel the active model probe',async()=>{
  const old=delayHTTP();click();await pump(()=>calls.length===1);await store.incrementConfigCount(1,'synthetic-count');await store.requestConfigPatch({theme:'dark'});await settle();expect(calls[0].signal?.aborted).toBe(false);old.resolve(response());await pump(()=>!state.busy);expect(feedback()).toContain('Supported');expect(records()).toHaveLength(1);
 });
 it('manual and automatic private probes share the frozen identity; cancelling manual leaves the automatic subscriber alive',async()=>{
  const old=delayHTTP();click();await pump(()=>calls.length===1);const source=imports.native.lockIncognitoRoute(imports.privacy.attachTranslationSourcePrivacy({...store.config,areaTranslationService:privateService,model:{...store.config.model,[privateService]:privateModel},customModel:{...store.config.customModel,[privateService]:privateModel},areaRecognitionMode:'prefer-vision' as const},'private'),{service:privateService,model:privateModel});
  const automatic=imports.probe.prepareModelVisionRoute(source,shared.modelVisionProbe.resolve)({});await settle();click();await settle();expect(calls).toHaveLength(1);expect(calls[0].signal?.aborted).toBe(false);old.resolve(response());await expect(complete(automatic)).resolves.toEqual({mode:'vision'});expect(records()).toHaveLength(1);expect(feedback()).toContain('Cancelled');
 });
 it('regular and private caches and active requests isolate the same provider/model',async()=>{
  const first=delayHTTP();const privateRun=handlers[0].handle(directMessage('private'),{sender});await pump(()=>calls.length===1);const regularRun=handlers[0].handle(directMessage('regular'),{sender:{...sender,documentId:'regular-doc',tab:{...sender.tab,incognito:false}}});await complete(regularRun);expect(calls).toHaveLength(2);first.resolve(response());await complete(privateRun);expect(records()).toHaveLength(2);expect(new Set((records() as any[]).map(r=>r.identity)).size).toBe(2);
 });
});

describe('native typed settings message admission and owner',()=>{
 it('native channel namespaces vision, input and text with the same public ID independently',async()=>{
  const channel=await import('@/src/services/translation/documentChannel'),id='same';const starts=[{type:'fluentReadModelVisionProbe',clientRequestId:id},{type:'inputBoxTranslation',clientRequestId:id},{origin:'synthetic',clientRequestId:id}],cancels=[{type:'fluentReadModelVisionProbeCancel',clientRequestId:id},{type:'inputBoxTranslationCancel',clientRequestId:id},{type:'fluentReadTranslationCancel',clientRequestId:id}];expect(starts.map(channel.translationDocumentRequestKey)).toEqual(['vision:same','input:same','text:same']);expect(cancels.map(channel.translationDocumentCancelKey)).toEqual(['vision:same','input:same','text:same']);expect([...starts,...cancels].every(channel.isTranslationDocumentOperation)).toBe(true);
 });
 it('native capability false keeps channel operations and cache identities on the ordinary contract',async()=>{
  vi.resetModules();vi.doMock('@/src/core/config/incognitoRoute',async original=>({...await original<object>(),NATIVE_PRIVATE_ROUTE_SUPPORTED:false}));try{const channel=await import('@/src/services/translation/documentChannel'),core=await import('@/src/core/config/visionProbe');expect(channel.isTranslationDocumentOperation({type:'fluentReadModelVisionProbe',clientRequestId:'probe'})).toBe(false);expect(channel.isTranslationDocumentOperation({type:'inputBoxTranslation',clientRequestId:'input'})).toBe(true);expect(channel.translationDocumentRequestKey({type:'fluentReadModelVisionProbe',clientRequestId:'probe'})).toBe('text:probe');expect(channel.translationDocumentCancelKey({type:'fluentReadModelVisionProbeCancel',clientRequestId:'probe'})).toBeUndefined();expect(core.createVisionProbeIdentity(core.scopeVisionProbeConfig(store.config,'private'),privateService,privateModel)).toBe(core.createVisionProbeIdentity(store.config,privateService,privateModel));}finally{vi.doUnmock('@/src/core/config/incognitoRoute');vi.resetModules();}
 });
 it.each([undefined,{getURL:()=> 'moz-extension://ext/'}])('a missing native runtime identity fails closed: %s',async runtime=>{
  const local=(await import('@/src/app/background/handlers/visionProbe')).createVisionProbeHandlers({ready:store.configReady,getConfig:()=>store.config,runtime,isSettingsUrl:()=>true,resolve:shared.modelVisionProbe.resolve});await expect(local[0].handle(directMessage(),{sender})).rejects.toThrow('当前扩展');expect(calls).toEqual([]);
 });
 it('typed cancel validates settings origin and native document owner before recording cancellation',()=>{
  expect(()=>handlers[1].handle({type:'fluentReadModelVisionProbeCancel',requestId:'probe-one'},{})).toThrow('设置页');expect(()=>handlers[1].handle({type:'fluentReadModelVisionProbeCancel',requestId:'probe-one'},{sender:{...sender,id:'foreign'}})).toThrow('当前扩展');expect(()=>handlers[1].handle({type:'fluentReadModelVisionProbeCancel',requestId:'probe-one'},{sender:{...sender,documentId:undefined}})).toThrow('失效');
 });
 it('native cancel-before-start rejects the same owned ID without touching providers',async()=>{
  handlers[1].handle({type:'fluentReadModelVisionProbeCancel',requestId:'probe-one'},{sender});await expect(handlers[0].handle(directMessage(),{sender})).rejects.toMatchObject({name:'AbortError'});expect(calls).toEqual([]);
 });
 it('sender mutation during native readiness cannot change captured owner or source',async()=>{
  const ready=deferred<void>(),local=(await import('@/src/app/background/handlers/visionProbe')).createVisionProbeHandlers({ready:ready.promise,getConfig:()=>store.config,runtime:m.api.runtime,isSettingsUrl:()=>true,resolve:shared.modelVisionProbe.resolve});const mutable={sender:{...sender,tab:{...sender.tab}}};const pending=local[0].handle(directMessage(),mutable);mutable.sender.tab.incognito=false;mutable.sender.documentId='replacement';ready.resolve();await complete(pending);expect(calls[0].body.model).toBe(privateModel);expect((records() as any[])[0].identity).toBe(imports.core.createVisionProbeIdentity(imports.core.scopeVisionProbeConfig(store.config,'private'),privateService,privateModel));
 });
 it('even an injected resolver that ignores abort cannot report a late successful capability',async()=>{
  const gate=deferred<import('@/src/core/config/visionProbe').VisionProbeResult>(),local=(await import('@/src/app/background/handlers/visionProbe')).createVisionProbeHandlers({ready:store.configReady,getConfig:()=>store.config,runtime:m.api.runtime,isSettingsUrl:()=>true,resolve:async()=>gate.promise});const pending=Promise.resolve(local[0].handle(directMessage(),{sender})).catch(error=>error);await settle();local[1].handle({type:'fluentReadModelVisionProbeCancel',requestId:'probe-one'},{sender});gate.resolve({capability:'supported',source:'probe'});await expect(complete(pending)).resolves.toMatchObject({name:'AbortError'});
 });
 it.each(['mismatch','unknown','foreign-extension','missing-document','wrong-url','stale-identity','bad-id','different-ids','bad-service','bad-model'] as const)('rejects %s before model dispatch and cache write',async kind=>{
  const msg:any=directMessage();const context:any={sender:{...sender,tab:{...sender.tab}}};
  if(kind==='mismatch'){msg.service=publicService;msg.model=publicModel;msg.identity=identity(publicService,publicModel);}if(kind==='unknown')context.sender.tab.incognito=undefined;if(kind==='foreign-extension')context.sender.id='foreign';if(kind==='missing-document')delete context.sender.documentId;if(kind==='wrong-url')context.sender.url='moz-extension://ext/options.html/other';if(kind==='stale-identity')msg.identity='stale';if(kind==='bad-id')msg.requestId='bad id';if(kind==='different-ids')msg.clientRequestId='other';if(kind==='bad-service')msg.service=null;if(kind==='bad-model')msg.model=' ';
  await expect(handlers[0].handle({...msg,incognito:false,trustedPrivateSource:false},context)).rejects.toThrow();expect(calls).toEqual([]);expect(m.writes).not.toHaveBeenCalled();
 });
 it('document-less Firefox native Port is sufficient for owner but forged message fields cannot supply privacy',async()=>{
  delete sender.documentId;sender.tab.incognito=undefined;const client=imports.client.translationDocumentClient(m.api.runtime);const result=await client.request({...directMessage(),incognito:false,sourcePrivacy:'regular',documentId:'forged'});expect(result).toMatchObject({success:false});expect(calls).toEqual([]);sender.tab.incognito=true;const fresh=documentPortPair(sender);pairs.push(fresh);server.connect({...fresh.background,name:'fluentReadTranslationDocument:v1'});const other=imports.client.createTranslationDocumentClient(()=>({...fresh.client,name:'fluentReadTranslationDocument:v1'}));await complete(other.request(directMessage('fresh')));expect(calls).toHaveLength(1);
 });
 it('cancel from another settings document cannot abort the same public ID',async()=>{
  const old=delayHTTP(),msg=directMessage();const pending=handlers[0].handle(msg,{sender});await pump(()=>calls.length===1);expect(handlers[1].handle({type:'fluentReadModelVisionProbeCancel',requestId:msg.requestId},{sender:{...sender,documentId:'foreign-document'}})).toMatchObject({cancelled:false});expect(calls[0].signal?.aborted).toBe(false);old.resolve(response());await complete(pending);expect(records()).toHaveLength(1);
 });
 it('same selected provider endpoint update cancels and old result never becomes new endpoint capability',async()=>{
  const old=delayHTTP(),pending=Promise.resolve(handlers[0].handle(directMessage(),{sender})).catch(error=>error);await pump(()=>calls.length===1);await store.requestConfigPatch({customOpenAIProviders:store.config.customOpenAIProviders.map(p=>p.id===privateService?{...p,endpoint:'https://probe-next.synthetic.test/v1/chat/completions'}:p)});expect(calls[0].signal?.aborted).toBe(true);old.resolve(response());await complete(pending);expect(records()).toEqual([]);await complete(handlers[0].handle(directMessage('new-endpoint'),{sender}));expect(calls[1].url).toContain('probe-next.synthetic.test');expect(records()).toHaveLength(1);
 });
 it('native getContexts resolves only the original exact document and never accepts frontend booleans',async()=>{
  delete sender.tab;m.contexts.mockResolvedValue([{documentId:sender.documentId,contextId:'native-context',contextType:'TAB',incognito:true,documentOrigin:'moz-extension://ext',documentUrl:sender.url,frameId:0}]);await complete(handlers[0].handle({...directMessage(),incognito:false} as any,{sender}));expect(m.contexts).toHaveBeenCalledWith({documentIds:['settings-document']});expect(calls[0].body.model).toBe(privateModel);
 });
 it('readiness cancellation is registered before ready and prevents all later source resolution',async()=>{
  const ready=deferred<void>(),local=(await import('@/src/app/background/handlers/visionProbe')).createVisionProbeHandlers({ready:ready.promise,getConfig:()=>store.config,runtime:m.api.runtime,requestRegistry:registry,isSettingsUrl:()=>true,resolve:shared.modelVisionProbe.resolve});const pending=Promise.resolve(local[0].handle(directMessage(),{sender})).catch(error=>error);expect(local[1].handle({type:'fluentReadModelVisionProbeCancel',requestId:'probe-one'},{sender})).toMatchObject({cancelled:true});await expect(complete(pending)).resolves.toMatchObject({name:'AbortError'});ready.resolve();await settle();expect(calls).toEqual([]);
 });
 it('source-resolution cancellation prevents a late exact context from starting a request',async()=>{
  delete sender.tab;const gate=deferred<unknown>();m.contexts.mockReturnValue(gate.promise);const pending=Promise.resolve(handlers[0].handle(directMessage(),{sender})).catch(error=>error);await pump(()=>m.contexts.mock.calls.length>0);handlers[1].handle({type:'fluentReadModelVisionProbeCancel',requestId:'probe-one'},{sender});await complete(pending);gate.resolve([]);await settle();expect(calls).toEqual([]);
 });
 it('native readiness has a bounded timeout',async()=>{
  const ready=deferred<void>(),local=(await import('@/src/app/background/handlers/visionProbe')).createVisionProbeHandlers({ready:ready.promise,getConfig:()=>store.config,runtime:m.api.runtime,isSettingsUrl:()=>true,resolve:shared.modelVisionProbe.resolve});const pending=Promise.resolve(local[0].handle(directMessage(),{sender})).catch(error=>error);await vi.advanceTimersByTimeAsync(30_001);await expect(pending).resolves.toMatchObject({name:'AbortError'});ready.resolve();
 });
});

describe('shared probe source and publication fences',()=>{
 it('cancelled standalone publication removes the actual persisted conclusion before any fresh probe',async()=>{
  const gate=deferred<void>();let held=false;m.hold=async value=>{if(value.length&&!held){held=true;await gate.promise;}};releases.push(()=>gate.resolve());const controller=new AbortController(),source=imports.privacy.attachTranslationSourcePrivacy(store.config,'private');const pending=shared.modelVisionProbe.resolve(source,privateService,privateModel,{force:true,signal:controller.signal}).catch(error=>error);await pump(()=>held);controller.abort();await complete(pending);gate.resolve();for(let i=0;i<10;i++)await settle();const result=await shared.modelVisionProbe.resolve(source,privateService,privateModel);process.stdout.write('settings-probe-observation '+JSON.stringify({phase:'publication-abort',recordCount:(records() as any[]).length,cacheSource:result.source,capability:result.capability,providerRequests:calls.length})+'\n');expect(records()).toEqual([]);expect(result).toEqual({capability:'unknown',source:'unknown'});expect(calls).toHaveLength(1);
 });
 it('unknown configured source cannot return override, built-in rule or a pre-existing ordinary capability',async()=>{
  const source={...store.config,modelVision:{[publicService]:{[publicModel]:true}}};for(const choice of [[publicService,publicModel],['deepseek','deepseek-flash'],['freeTranslation','']])await expect(shared.modelVisionProbe.resolve(imports.privacy.attachTranslationSourcePrivacy(source,'unknown'),choice[0],choice[1])).rejects.toThrow('无法确认');expect(calls).toEqual([]);expect(m.writes).not.toHaveBeenCalled();
 });
 it.each(['cancel','config','disconnect'] as const)('%s during delayed final storage commit restores prior records and permits the fresh model',async action=>{
  const gate=deferred<void>();let held=false;m.hold=async value=>{if(value.length&&!held){held=true;await gate.promise;}};releases.push(()=>gate.resolve());click();await pump(()=>held);if(action==='cancel')click();else if(action==='config')await store.requestConfigPatch({incognitoModel:'probe-next'});else pairs[0].close();await settle();gate.resolve();await settle();await pump(()=>JSON.stringify(records())==='[]');expect(feedback()).not.toContain('Supported');m.hold=undefined;await store.requestConfigPatch({incognitoModel:'probe-next'});props.model='probe-next';await settle();click();await pump(()=>calls.length===2&&!state.busy);expect(records()).toHaveLength(1);expect(feedback()).toContain('probe-next');
 });
 it('old delayed storage rollback cannot remove a fresh request queued for the same identity',async()=>{
  const gate=deferred<void>();let held=false;m.hold=async value=>{if(value.length&&!held){held=true;await gate.promise;}};releases.push(()=>gate.resolve());const controller=new AbortController(),source=imports.privacy.attachTranslationSourcePrivacy(store.config,'private');const old=shared.modelVisionProbe.resolve(source,privateService,privateModel,{force:true,signal:controller.signal}).catch(error=>error);await pump(()=>held);controller.abort();await complete(old);const fresh=shared.modelVisionProbe.resolve(source,privateService,privateModel,{force:true});gate.resolve();await expect(complete(fresh)).resolves.toMatchObject({capability:'supported'});expect(records()).toHaveLength(1);expect(calls).toHaveLength(2);
 });
 it('privacy-scoped identity separates unknown, private, regular, model and configured pair while preserving ordinary v1',()=>{
  const source=store.config,base=imports.core.createVisionProbeIdentity(source,privateService,privateModel);expect(imports.core.createVisionProbeIdentity(imports.core.scopeVisionProbeConfig(source,'regular'),privateService,privateModel)).toBe(base);const privateId=imports.core.createVisionProbeIdentity(imports.core.scopeVisionProbeConfig(source,'private'),privateService,privateModel);const unknownId=imports.core.createVisionProbeIdentity(imports.core.scopeVisionProbeConfig(source,'unknown'),privateService,privateModel);expect(new Set([base,privateId,unknownId]).size).toBe(3);expect(imports.core.createVisionProbeIdentity(imports.core.scopeVisionProbeConfig({...source,incognitoModel:'probe-next'},'private'),privateService,privateModel)).not.toBe(privateId);expect(imports.core.createVisionProbeIdentity(imports.core.scopeVisionProbeConfig(source,'private'),privateService,'probe-next')).not.toBe(privateId);
 });
});
