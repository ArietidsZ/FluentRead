import {afterEach, describe, expect, it, vi} from 'vitest';
import {captureTranslationRequestContext, createTranslationRequestRegistry} from '@/src/services/translation/requestRegistry';
import {assertNativeDocumentContext, copyNativeDocumentSession, createNativeDocumentPortHandler, getNativeDocumentSession, type NativeDocumentPort} from '@/src/platform/browser/documentSession';
import {createTranslationDocumentPortHandler, isTranslationDocumentOperation, TRANSLATION_DOCUMENT_PORT} from '@/src/services/translation/documentChannel';
import {createTranslationDocumentClient} from '@/src/services/translation/documentClient';
import {createTranslationCancelHandler, createTranslationRequestFallback} from '@/src/app/background/handlers/translation';
import {createInputBoxTranslationCancelHandler, createInputBoxTranslationHandler} from '@/src/features/input-translation/background/handler';
import {createBackgroundMessageRouter} from '@/src/app/background/messageRouter';
import {getTranslationRequestControl} from '@/src/services/translation/requestSnapshot';
import type {TranslationRequestMessage} from '@/src/services/translation/types';
import {Config} from '@/src/core/config/model';
import {documentPortPair} from './helpers/imageDocumentPorts';
import {incognitoInputRuntime, nativeInputSender} from './helpers/incognitoInputRuntime';
import {waitForTranslationRuntimeRequest} from '@/src/services/translation/runtimeTransport';

vi.mock('@/src/services/config/store', () => ({config: {}}));
const pairs: ReturnType<typeof documentPortPair>[] = [];
afterEach(() => {for (const pair of pairs.splice(0)) pair.close(); vi.unstubAllGlobals(); vi.restoreAllMocks();});
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function gate<T>() {let resolve!: (value:T)=>void, reject!: (error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function pair(sender:NativeDocumentPort['sender']=missingDocument.sender) {const p=documentPortPair(sender);pairs.push(p);return {...p,client:{...p.client,name:TRANSLATION_DOCUMENT_PORT},background:{...p.background,name:TRANSLATION_DOCUMENT_PORT}};}
const message=(kind='text',id='same-id')=>kind==='input'?{type:'inputBoxTranslation',text:'Readable sentence.',targetLang:'zh-Hans',clientRequestId:id}:{origin:kind==='batch'?['Readable sentence.','Second sentence.']:'Readable sentence.',clientRequestId:id};
function fixture(options:{ready?:Promise<unknown>;source?:()=>Promise<'regular'|'private'>;translate?:(m:TranslationRequestMessage)=>Promise<string|string[]>}={}) {
    const generic=createTranslationRequestRegistry(true),input=createTranslationRequestRegistry(true),contexts:any[]=[];
    const translate=vi.fn(options.translate??(async m=>Array.isArray(m.origin)?['译文一','译文二']:'新译文'));
    const ready=options.ready??Promise.resolve(),source=vi.fn(options.source??(async()=> 'regular' as const));
    const getConfig=vi.fn(()=>new Config());
    const fallback=createTranslationRequestFallback<any>({ready,resolveSourcePrivacy:source,requireDocumentOwner:true,requestRegistry:generic,translate,serializeError:error=>({name:(error as Error).name,message:(error as Error).message})});
    const inputHandler=createInputBoxTranslationHandler({ready,resolveSourcePrivacy:source,requireDocumentOwner:true,requestRegistry:input,getConfig,translate});
    const router=createBackgroundMessageRouter<any>([createTranslationCancelHandler(generic),createInputBoxTranslationCancelHandler(input),inputHandler],fallback);
    const dispatch=vi.fn(async(m,c)=>{contexts.push(c);return router.dispatch(m,c);});
    const server=createTranslationDocumentPortHandler({runtimeId:'extension',dispatch,registries:[generic,input]});
    const add=(sender=missingDocument.sender)=>{const p=pair(sender);expect(server.connect(p.background)).toBe(true);return {p,client:createTranslationDocumentClient(()=>p.client)};};
    return {generic,input,source,translate,getConfig,dispatch,contexts,server,add,fallback,inputHandler};
}

const missingDocument = {sender: {id: 'extension', tab: {id: 11, incognito: false}, frameId: 0, url: 'https://example.test/same'}};
describe('native translation document lifetime', () => {
    it('required document ownership rejects frame-only start before provider preparation', async () => {
        const registry = createTranslationRequestRegistry(true);
        const operation = vi.fn(async () => 'unexpected provider start');
        await expect(registry.run('same-id', missingDocument, operation)).rejects.toThrow('文档');
        expect(operation).not.toHaveBeenCalled();
    });
    it('client document strings and boolean fields cannot grant a missing native document identity', async () => {
        const registry = createTranslationRequestRegistry(true);
        const operation = vi.fn(async () => 'unexpected provider start');
        const forged = {...missingDocument, documentId: 'client-nonce', documentConnected: true};
        await expect(registry.run('same-id', forged, operation)).rejects.toThrow('文档');
        expect(operation).not.toHaveBeenCalled();
    });
    it('native documentId direct path and legacy nonnative registry remain compatible', async()=>{
        const required=createTranslationRequestRegistry(true),legacy=createTranslationRequestRegistry();
        await expect(required.run('id',{sender:{...missingDocument.sender,documentId:'native-doc'}},async()=> 'native')).resolves.toBe('native');
        await expect(legacy.run('id',{},async()=> 'userscript-compatible')).resolves.toBe('userscript-compatible');
        expect(required.cancel('id',{sender:{...missingDocument.sender,documentId:'native-doc'}}).cancelled).toBe(false);
        required.releaseOwner({});legacy.releaseOwner({});
    });
    it.each(['text','batch','input'])('%s uses a live native connection while sender has no documentId',async kind=>{
        const h=fixture(),A=h.add();await expect(A.client.request(message(kind))).resolves.toEqual(kind==='input'?{success:true,translatedText:'新译文'}:kind==='batch'?['译文一','译文二']:'新译文');
        const c=h.contexts[0],captured=captureTranslationRequestContext(c);expect(c.sender.documentId).toBeUndefined();expect(Object.isFrozen(c.sender.tab)).toBe(true);expect(getNativeDocumentSession(captured)).toBe(getNativeDocumentSession(c));expect(()=>assertNativeDocumentContext(captured,true)).not.toThrow();
        expect(getTranslationRequestControl(h.translate.mock.calls[0][0])?.ownershipKey).toContain('native-document-port:');expect(h.translate.mock.calls[0][0]).not.toHaveProperty('clientRequestId');
        expect(copyNativeDocumentSession({},captured)).toBe(captured);A.p.close();expect(()=>assertNativeDocumentContext(captured)).toThrow('文档');
    });
    it.each(['text','batch','input'].flatMap(kind=>['ready','source'].flatMap(wait=>['pending','resolve','reject'].map(late=>[kind,wait,late]))))('%s disconnect settles never-returning %s preparation; late %s cannot dispatch',async(kind,wait,late)=>{
        const held=gate<'regular'>(),h=fixture({ready:wait==='ready'?held.promise:Promise.resolve(),source:wait==='source'?()=>held.promise:undefined}),A=h.add();
        const outcome=A.client.request(message(kind)).catch(error=>error);await tick();const captured=h.contexts[0];expect(captured).toBeDefined();const registry=kind==='input'?h.input:h.generic;
        expect(registry.cancel('unrelated',captured).cancelled).toBe(false);A.p.close();await expect(outcome).resolves.toMatchObject({name:'AbortError'});await tick();expect(h.translate).not.toHaveBeenCalled();expect(h.getConfig).not.toHaveBeenCalled();
        if(kind==='input')await expect(h.dispatch.mock.results[0].value).rejects.toMatchObject({name:'AbortError'});else await expect(h.dispatch.mock.results[0].value).resolves.toMatchObject({response: {name:'AbortError'}});
        expect(()=>registry.cancel('same-id',captured)).toThrow('文档');
        const unhandled=vi.fn();process.on('unhandledRejection',unhandled);try{if(late==='resolve')held.resolve('regular');if(late==='reject')held.reject(new Error('late gate failure'));await tick();expect(unhandled).not.toHaveBeenCalled();expect(h.translate).not.toHaveBeenCalled();}finally{process.off('unhandledRejection',unhandled);}
    });
    it.each(['text','batch','input'])('%s same URL/frame navigation reuses public ID on a new connection without old cancellation',async kind=>{
        const old=gate<string>(),fresh=gate<string>();let starts=0;const h=fixture({translate:()=>++starts===1?old.promise:fresh.promise}),A=h.add(),B=h.add();
        const first=A.client.request(message(kind)).catch(error=>error),second=B.client.request(message(kind));await tick();const [a,b]=h.contexts;const registry=kind==='input'?h.input:h.generic;
        expect(a.sender).toEqual(b.sender);expect(getNativeDocumentSession(a)!.ownerKey).not.toBe(getNativeDocumentSession(b)!.ownerKey);expect(h.translate).toHaveBeenCalledTimes(2);
        A.p.close();await expect(first).resolves.toMatchObject({name:'AbortError'});expect(getTranslationRequestControl(h.translate.mock.calls[0][0])!.signal.aborted).toBe(true);expect(getTranslationRequestControl(h.translate.mock.calls[1][0])!.signal.aborted).toBe(false);
        expect(()=>registry.cancel('same-id',a)).toThrow('文档');await expect(A.client.request({type:kind==='input'?'inputBoxTranslationCancel':'fluentReadTranslationCancel',clientRequestId:'same-id'})).resolves.toMatchObject({cancelled:false});
        old.resolve('late old response');await tick();expect(getTranslationRequestControl(h.translate.mock.calls[1][0])!.signal.aborted).toBe(false);fresh.resolve('new response');await expect(second).resolves.toEqual(kind==='input'?{success:true,translatedText:'new response'}:'new response');
    });
    it('one peer disconnect aborts all associated generic/batch/input requests and keeps another frame alive',async()=>{
        const held=gate<string>(),h=fixture({translate:()=>held.promise}),A=h.add(),B=h.add({...missingDocument.sender,frameId:1});
        const all=Promise.allSettled([A.client.request(message('text','a')),A.client.request(message('batch','b')),A.client.request(message('input','i'))]);const other=B.client.request(message('text','a'));await tick();A.p.close();expect((await all).every(r=>r.status==='rejected'&&(r.reason as Error).name==='AbortError')).toBe(true);
        expect(h.translate.mock.calls.slice(0,3).every(([m])=>getTranslationRequestControl(m)!.signal.aborted)).toBe(true);expect(getTranslationRequestControl(h.translate.mock.calls[3][0])!.signal.aborted).toBe(false);held.resolve('settled');await expect(other).resolves.toBe('settled');
    });
    it('same public ID in generic and input is isolated; own cancel stays on the original peer',async()=>{
        const held=gate<string>(),h=fixture({translate:()=>held.promise}),A=h.add();const text=A.client.request(message()).catch(error=>error),input=A.client.request(message('input')).catch(error=>error);await tick();
        await expect(A.client.request({type:'inputBoxTranslationCancel',clientRequestId:'same-id'})).resolves.toMatchObject({cancelled:true});expect(getTranslationRequestControl(h.translate.mock.calls[0][0])!.signal.aborted).toBe(false);expect(getTranslationRequestControl(h.translate.mock.calls[1][0])!.signal.aborted).toBe(true);
        await expect(A.client.request({type:'fluentReadTranslationCancel',clientRequestId:'same-id'})).resolves.toMatchObject({cancelled:true});held.resolve('late');await expect(text).resolves.toMatchObject({name:'AbortError'});await expect(input).resolves.toMatchObject({success:false});
    });
    it('raw early cancel affects only its native connection, never a same-frame new document',async()=>{
        const h=fixture(),A=h.add(),B=h.add();A.p.client.postMessage({kind:'request',version:1,rpcId:'early',message:{type:'fluentReadTranslationCancel',clientRequestId:'same-id'}});await tick();await expect(A.client.request(message())).resolves.toMatchObject({name:'AbortError'});await expect(B.client.request(message())).resolves.toBe('新译文');
    });
    it('handler guard rejects missing document ownership even for legacy messages without a public ID',async()=>{
        const h=fixture();await expect(h.fallback.handle({origin:'legacy'},missingDocument)).resolves.toMatchObject({name:'AbortError'});await expect(h.inputHandler.handle({type:'inputBoxTranslation',text:'legacy',targetLang:'zh-Hans'},missingDocument)).rejects.toMatchObject({name:'AbortError'});expect(h.translate).not.toHaveBeenCalled();
    });
    it('revoked or forged capability cannot be replayed through a copied or bare frame context',async()=>{
        const h=fixture(),A=h.add();await A.client.request(message());const context=h.contexts[0],symbol=Reflect.ownKeys(context).find(k=>typeof k==='symbol')!;
        const forged={...missingDocument,[symbol]:{ownerKey:getNativeDocumentSession(context)!.ownerKey,assertLive(){}}};expect(getNativeDocumentSession(forged)).toBeUndefined();expect(()=>assertNativeDocumentContext(forged,true)).toThrow();expect(copyNativeDocumentSession(forged,missingDocument)).toBe(missingDocument);
        A.p.close();await expect(h.generic.run('late',captureTranslationRequestContext(context),async()=> 'never')).rejects.toThrow('文档');
    });
    it.each(['text','input'])('%s native disconnect preserves actual provider lease until ignored abort transport settles',async kind=>{
        const f=incognitoInputRuntime(),held=gate<string>();f.setProviderResponse(held.promise);f.config.maxConcurrentTranslations=1;f.config.translationRequestsPerSecond=0;f.config.translationRequestsPerMinute=0;
        const generic=createTranslationRequestRegistry(true),input=createTranslationRequestRegistry(true),contexts:any[]=[];
        const fallback=createTranslationRequestFallback<any>({requestRegistry:generic,requireDocumentOwner:true,ready:Promise.resolve(),resolveSourcePrivacy:f.resolveSourcePrivacy,translate:f.availability.translateWithCache,serializeError:error=>error});
        const inputHandler=createInputBoxTranslationHandler({requestRegistry:input,requireDocumentOwner:true,ready:Promise.resolve(),getConfig:f.getConfig,resolveSourcePrivacy:f.resolveSourcePrivacy,translate:f.availability.translateWithCache});
        const dispatch=async(m:any,c:any)=>{contexts.push(c);return kind==='input'?inputHandler.handle(m,c):fallback.handle(m,c);};
        const server=createNativeDocumentPortHandler({runtimeId:nativeInputSender.id!,name:TRANSLATION_DOCUMENT_PORT,version:1,accepts:isTranslationDocumentOperation,dispatch,releaseOwner:c=>{generic.releaseOwner(c);input.releaseOwner(c);}});
        const a=pair({...missingDocument.sender,id:nativeInputSender.id,tab:{id:11,incognito:true}}),b=pair({...missingDocument.sender,id:nativeInputSender.id,tab:{id:11,incognito:true}});server.connect(a.background);server.connect(b.background);const A=createTranslationDocumentClient(()=>a.client),B=createTranslationDocumentClient(()=>b.client);
        const first=A.request(message(kind,'first')).catch(error=>error);await vi.waitFor(()=>expect(f.providerRequests).toHaveLength(1));a.close();await expect(first).resolves.toMatchObject({name:'AbortError'});expect(f.providerRequests[0].abortSignal?.aborted).toBe(true);
        const second=B.request({...message(kind,'second'),...(kind==='input'?{text:'Second readable sentence.'}:{origin:'Second readable sentence.'})});await tick();expect(f.providerRequests).toHaveLength(1);held.resolve('迟到传输结果');await expect(second).resolves.toEqual(kind==='input'?{success:true,translatedText:'迟到传输结果'}:'迟到传输结果');expect(f.providerRequests).toHaveLength(2);
    });
    it('runtime transport pending cancellation after disconnect never opens a new peer for the old request',async()=>{
        const h=fixture({source:()=>new Promise(()=>{})}),A=h.add(),connect=vi.fn(()=>A.p.client),client=createTranslationDocumentClient(connect),controller=new AbortController();
        const pending=waitForTranslationRuntimeRequest(m=>client.request(m as Record<string,unknown>),{origin:'source'},1000,controller.signal,undefined,'fluentReadTranslationCancel').catch(error=>error);await tick();A.p.close();controller.abort();await expect(pending).resolves.toMatchObject({name:'AbortError'});await tick();expect(connect).toHaveBeenCalledOnce();
    });
});
