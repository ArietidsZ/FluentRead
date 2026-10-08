import {afterEach, describe, expect, it, vi} from 'vitest';
import {documentPortPair} from './helpers/imageDocumentPorts';
import {createImageDocumentPortHandler, getImageDocumentSession, assertImageDocumentContext, copyImageDocumentSession} from '@/src/features/image-translation/background/documentSession';
import {createImageOperationRegistry} from '@/src/features/image-translation/background/operationRegistry';
import {createImageDocumentClient, imageDocumentClient, subscribeImageSourceValidation} from '@/src/features/image-translation/services/documentClient';
import {IMAGE_DOCUMENT_VERSION, isImageDocumentOperation} from '@/src/features/image-translation/documentChannel';
import {createImageSourceVerifier, imageTranslationProgressTransport} from '@/src/features/image-translation/background/offscreenAdapter';
import {createImageGlossaryContext} from '@/src/app/background/imageGlossaryContext';
import {createAreaTranslationBackgroundHandlers} from '@/src/features/area-translation/background/handlers';
import {withImageSourceAuthorization} from '@/src/features/image-translation/content/sourceAuthorization';
const gates = <T = unknown>() => {let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((r,j) => {resolve=r;reject=j;}); return {promise,resolve,reject};};
const pairs: ReturnType<typeof documentPortPair>[] = []; const subscriptions: (() => void)[] = [];
const tick = async () => {for(let i=0;i<25;i++) await Promise.resolve();};
afterEach(async () => {for(const pair of pairs.splice(0)) pair.close(); for(const unsubscribe of subscriptions.splice(0)) unsubscribe(); await tick(); vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
function fixture(invoke?: (message: any, context: any, registry: ReturnType<typeof createImageOperationRegistry>) => Promise<unknown>) {
    const registry=createImageOperationRegistry('channel', c=>c.sender?.id==='extension'&&c.sender.url==='extension://offscreen',Date.now,true);
    const contexts: any[]=[];
    const dispatch=vi.fn(async(message:any,context:any)=>{contexts.push(context); if(invoke) return invoke(message,context,registry);
        return registry.run(message,async()=>({success:true,image:'done',lines:[]}),context);});
    const server=createImageDocumentPortHandler({runtimeId:'extension',dispatch,releaseOwner:registry.releaseOwner});
    const add=(frameId=0)=>{const pair=documentPortPair({id:'extension',tab:{id:1,windowId:2},frameId,url:'https://example.test/same'});pairs.push(pair);server.connect(pair.background);const client=createImageDocumentClient(()=>pair.client);return {pair,client};};
    return {registry,server,dispatch,contexts,add};
}
const request=(client:ReturnType<typeof createImageDocumentClient>,id='public',type='fluentReadImageTranslate',extra={})=>client.request({type,...extra},{requestId:id,timeoutMs:1000},'deadline');
describe('浏览器拥有的图片文档Port',()=>{
    it('无documentId的同URL旧新文档相同ID可并发，进度与结果仍只达原peer',async()=>{
        const a=gates();const b=gates();const opts:any[]=[];
        const h=fixture((m,c,r)=>r.run(m,o=>{opts.push(o);return m.which==='a'?a.promise:b.promise;},c));const A=h.add();const B=h.add();
        const first=request(A.client,'same',undefined,{which:'a'});const second=request(B.client,'same',undefined,{which:'b'});const observed=Promise.allSettled([first,second]);await tick();
        expect(h.contexts[0].sender).toEqual(h.contexts[1].sender);expect(h.contexts[0].sender.documentId).toBeUndefined();
        expect(getImageDocumentSession(h.contexts[0])!.ownerKey).not.toBe(getImageDocumentSession(h.contexts[1])!.ownerKey);
        await imageTranslationProgressTransport.sendProgress(h.registry.bind(h.contexts[0],opts[0]),{type:'fluentReadImageProgress',requestId:'same',stage:'translating'});
        await tick();expect(vi.mocked(B.pair.background.postMessage).mock.calls.flat().filter((x:any)=>x.kind==='progress')).toHaveLength(0);
        a.resolve('a');b.resolve('b');expect(await observed).toEqual([{status:'fulfilled',value:'a'},{status:'fulfilled',value:'b'}]);
    });
    it('新文档取消旧ID无效，原owner重复ID拒绝但不覆盖第一条pending',async()=>{
        const work=gates();const h=fixture((m,c,r)=>m.type==='fluentReadImageCancel'?Promise.resolve(r.cancel(m.requestId,c)):r.run(m,()=>work.promise,c));const A=h.add();const B=h.add();
        const first=request(A.client,'same');const observed=Promise.allSettled([first]);await tick();
        await expect(request(A.client,'same')).rejects.toThrow('正在执行');
        await expect(request(B.client,'same','fluentReadImageCancel')).resolves.toMatchObject({cancelled:false});
        expect(h.registry.cancel('same',h.contexts[0]).cancelled).toBe(true);await observed;work.resolve('late');
    });
    it('延迟disconnect的同URL刷新和iframe替换不把旧消息定向新Port',async()=>{
        for(const frameId of [0,3]){const work=gates();const h=fixture((m,c,r)=>r.run(m,()=>work.promise,c));const A=h.add(frameId);
            const old=request(A.client,'same');const observed=Promise.allSettled([old]);await tick();const oldContext=h.contexts[0];expect(oldContext.sender.frameId).toBe(frameId);const B=h.add(frameId);
            A.pair.close(false);await expect(imageTranslationProgressTransport.sendProgress(oldContext,{type:'fluentReadImageProgress',requestId:'same',stage:'rendering'})).rejects.toThrow('closed');
            const second=request(B.client,'same');const secondObserved=Promise.allSettled([second]);await tick();
            work.resolve('late');A.pair.notifyDisconnect();await observed;expect(await secondObserved).toEqual([{status:'fulfilled',value:'late'}]);
            expect(vi.mocked(B.pair.background.postMessage).mock.calls.flat().some((x:any)=>x.kind==='progress')).toBe(false);
        }
    });
    it('断开先撤销恢复权限，重复disconnect/tabclose和迟到finally不删除新事务',async()=>{
        const old=gates();const next=gates();const opts:any[]=[];const h=fixture((m,c,r)=>r.run(m,o=>{opts.push(o);return m.next?next.promise:old.promise;},c));const A=h.add();
        const first=request(A.client,'same');const firstObserved=Promise.allSettled([first]);await tick();let denied=false;
        opts[0].signal.addEventListener('abort',()=>{try{h.registry.restore(opts[0].requestId,{sender:{id:'extension',url:'extension://offscreen'}});}catch{denied=true;}});
        A.pair.close();A.pair.notifyDisconnect();expect(denied).toBe(true);
        const B=h.add();const second=request(B.client,'same',undefined,{next:true});const secondObserved=Promise.allSettled([second]);await tick();old.resolve('late');await firstObserved;await tick();expect(opts[1].signal.aborted).toBe(false);
        h.server.releaseTab(999);h.server.releaseTab(1);h.server.releaseTab(1);await secondObserved;next.resolve('late');
    });
    it('configReady期间断开不创建快照或恢复事务',async()=>{
        const ready=gates();const handler=vi.fn(async()=>({success:true}));const snapshot=vi.fn(()=> 'en');
        const wrapped=createImageGlossaryContext({ready:ready.promise,offscreenUrl:'extension://offscreen',getSourceLanguage:snapshot,getGlossaryRevision:()=>''}).wrap([{type:'fluentReadImageTranslate',handle:handler}]);
        const h=fixture((m,c)=>Promise.resolve(wrapped[0].handle(m,c)));const A=h.add();const pending=request(A.client);const observed=Promise.allSettled([pending]);await tick();A.pair.close();ready.resolve(undefined);await observed;await tick();expect(handler).not.toHaveBeenCalled();expect(snapshot).not.toHaveBeenCalled();
    });
    it('可信session穿过冻结ownerContext/bind与离屏借用，断开中止OCR/provider',async()=>{
        const work=gates();let opts:any;const h=fixture((m,c,r)=>r.run(m,o=>{opts=o;return work.promise;},c));const A=h.add();const parent=request(A.client);const observed=Promise.allSettled([parent]);await tick();
        const bound=h.registry.bind(h.contexts[0],opts);expect(getImageDocumentSession(bound)).toBe(getImageDocumentSession(h.contexts[0]));
        const provider=gates();const child=h.registry.run({requestId:opts.requestId},()=>provider.promise,{sender:{id:'extension',url:'extension://offscreen'}});const childObserved=Promise.allSettled([child]);
        await tick();A.pair.close();expect(opts.signal.aborted).toBe(true);expect((await childObserved)[0]).toMatchObject({status:'rejected'});await observed;provider.resolve('late');work.resolve('late');
    });
    it('缺doc和未接受Port时只拒绝事务；伪造payload身份不能产生capability',async()=>{
        const h=fixture();await expect(h.registry.run({requestId:'bad'},async()=>'',{sender:{id:'extension',tab:{id:1},frameId:0,url:'https://example.test/same'}})).rejects.toThrow('刷新');
        const forged={sender:{id:'extension'},ownerKey:'image-port:claimed',documentSession:{ownerKey:'forged'}};expect(getImageDocumentSession(forged)).toBeUndefined();expect(copyImageDocumentSession(forged,{})).toEqual({});expect(()=>assertImageDocumentContext(forged,true)).toThrow('刷新');
        const unknown=documentPortPair();pairs.push(unknown);expect(h.server.connect({...unknown.background,name:'another-port'})).toBe(false);expect(unknown.background.disconnect).not.toHaveBeenCalled();
        for(const sender of [undefined,{id:'other'}]){const p=documentPortPair(sender);pairs.push(p);expect(h.server.connect({...p.background,sender})).toBe(true);expect(p.background.disconnect).toHaveBeenCalled();}
    });
    it('严格白名单/版本与RPC校验不开放语言下载或任意后台接口',async()=>{
        const h=fixture();const A=h.add();for(const packet of [null,false,{}, {kind:'request'}, {kind:'request',version:0,rpcId:'x',message:{type:'fluentReadImageTranslate'}}, {kind:'request',version:1,rpcId:0,message:{}},{kind:'request',version:1,rpcId:'bad id',message:{}},{kind:'request',version:1,rpcId:'x'}, {kind:'request',version:1,rpcId:'x',message:{type:'fluentReadImageDownloadLanguages'}}]) A.pair.client.postMessage(packet);
        await tick();expect(h.dispatch).not.toHaveBeenCalled();expect(isImageDocumentOperation('fluentReadAreaCapture')).toBe(true);expect(isImageDocumentOperation(null)).toBe(false);
    });
});

describe('同Port来源核验与截图生命周期',()=>{
    it('B伪造相同challenge RPC只影响B，不能满足A；保留原source公开ID',async()=>{
        const send=vi.fn();const verify=createImageSourceVerifier(send);
        const h=fixture((m,c,r)=>r.run(m,async o=>{await verify('https://cdn.example/image.png',o,c);return {success:true};},c));
        const A=h.add();const B=h.add(); // raw peers below intentionally do not attach client RPC listeners.
        A.pair.client.postMessage({kind:'request',version:1,rpcId:'a',message:{type:'fluentReadImageFetch',requestId:'image-source-selected'}});
        B.pair.client.postMessage({kind:'request',version:1,rpcId:'b',message:{type:'fluentReadImageFetch',requestId:'image-source-selected'}});await tick();
        const a=vi.mocked(A.pair.background.postMessage).mock.calls.map(([p])=>p as any).find(p=>p.kind==='sourceChallenge');
        const b=vi.mocked(B.pair.background.postMessage).mock.calls.map(([p])=>p as any).find(p=>p.kind==='sourceChallenge');
        expect(a.message.requestId).toBe('image-source-selected');expect(a.message.requestId).not.toMatch(/^image-transaction:/u);
        B.pair.client.postMessage({kind:'sourceReply',rpcId:a.rpcId,response:{valid:true}});await tick();
        expect(vi.mocked(A.pair.background.postMessage).mock.calls.map(([p])=>p as any).some(p=>p.kind==='result')).toBe(false);
        expect(vi.mocked(B.pair.background.postMessage).mock.calls.map(([p])=>p as any).find(p=>p.kind==='result').response).toEqual({success:true});
        A.pair.client.postMessage({kind:'sourceReply',rpcId:a.rpcId,response:{valid:true}});await tick();
        expect(send).not.toHaveBeenCalled();expect(b.rpcId).toBe(a.rpcId);
    });
    it.each(['cancel','disconnect','timeout'] as const)('来源挑战 %s 撤销，迟到reply不继续读取',async ending=>{
        vi.useFakeTimers();const h=fixture();const A=h.add();A.pair.client.postMessage({kind:'request',version:1,rpcId:'seed',message:{type:'fluentReadImageTranslate',requestId:'seed'}});await tick();const session=getImageDocumentSession(h.contexts[0])!;const ctrl=new AbortController();
        const waiting=session.challenge({type:'fluentReadImageValidateSource',requestId:'image-source-original',url:'https://cdn.test/a',documentUrl:'https://example.test/same'},ctrl.signal,10);const observed=Promise.allSettled([waiting]);
        if(ending==='cancel')ctrl.abort();else if(ending==='disconnect')A.pair.close();else await vi.advanceTimersByTimeAsync(10);
        expect((await observed)[0]).toMatchObject({status:'rejected'});
        A.pair.backgroundMessages.emit({kind:'sourceReply',rpcId:'source-1',response:{valid:true}});
    });
    it('预取消挑战和死session不能建立新的授权；无session/doc不按frame回退',async()=>{
        const h=fixture();const A=h.add();await request(A.client);const session=getImageDocumentSession(h.contexts[0])!;const ctrl=new AbortController();ctrl.abort();
        await expect(session.challenge({} as any,ctrl.signal,10)).rejects.toMatchObject({name:'AbortError'});
        A.pair.close();await expect(session.challenge({} as any,new AbortController().signal,10)).rejects.toThrow('中断');
        const send=vi.fn();const verify=createImageSourceVerifier(send);const context={sender:{tab:{id:1},frameId:0,url:'https://example.test/same'}};
        await expect(verify('https://cdn.test/a',{requestId:'original',signal:new AbortController().signal,timeoutMs:10},context)).rejects.toThrow('失效');
        vi.stubGlobal('browser',{tabs:{sendMessage:send}});await imageTranslationProgressTransport.sendProgress(context,{type:'fluentReadImageProgress',requestId:'original',stage:'recognizing'});expect(send).not.toHaveBeenCalled();
    });
    it('真实DOM/currentSrc授权仍保留，换图使同channel challenge拒绝',async()=>{
        const source='https://cdn.test/a';const doc={URL:'https://example.test/same'};const attrs={src:source,srcset:null,sizes:null};
        const image={ownerDocument:doc,isConnected:true,currentSrc:source,src:source,getAttribute:(name:string)=>(attrs as any)[name]} as any;
        vi.stubGlobal('document',doc);vi.stubGlobal('browser',{runtime:{id:'extension',onMessage:{addListener:vi.fn(),removeListener:vi.fn()}}});
        const verify=createImageSourceVerifier(vi.fn());const h=fixture((m,c,r)=>r.run(m,async o=>{await verify(source,o,c);return {success:true};},c));const A=h.add();
        await expect(withImageSourceAuthorization(image,source,undefined,id=>{const pending=request(A.client,id,'fluentReadImageFetch');
            for(const message of [undefined,{type:'wrong'},{type:'fluentReadImageValidateSource',requestId:'foreign'}])A.pair.clientMessages.emit({kind:'sourceChallenge',rpcId:'stranger',message});
            return pending;})).resolves.toEqual({success:true});
        const active=withImageSourceAuthorization(image,source,undefined,id=>request(A.client,id,'fluentReadImageFetch'));image.currentSrc='https://cdn.test/changed';
        await expect(active).resolves.toMatchObject({success:false,error:expect.stringContaining('失效')});
    });
    it.each(['queue','ownership','capture'] as const)('截图 %s 等待中断开保留真实owner校验且不返回截图',async phase=>{
        const wait=gates();let time=0;const capture=vi.fn(async()=> 'data:image/png,x');const owner=vi.fn(async()=>{});
        let handlers:ReturnType<typeof createAreaTranslationBackgroundHandlers>;
        const h=fixture((m,c)=>Promise.resolve(handlers.find(x=>x.type===m.type)!.handle(m,c)));
        handlers=createAreaTranslationBackgroundHandlers({operationRegistry:h.registry,requireDocumentOwner:true,captureNow:()=>time,
            waitForCapture:()=>wait.promise as Promise<void>,captureVisibleTab:capture,assertCaptureOwner:owner,
            getDefaultSourceLanguage:()=> 'en',assertLanguagesDownloaded:async()=>{},translateArea:async()=>({})});
        const A=h.add();
        if(phase==='queue')await request(A.client,'first','fluentReadAreaCapture');
        else if(phase==='ownership')owner.mockImplementationOnce(()=>wait.promise as Promise<void>);
        else capture.mockImplementationOnce(async()=>{await wait.promise;return 'data:image/png,x';});
        const pending=request(A.client,'capture','fluentReadAreaCapture');const observed=Promise.allSettled([pending]);await tick();A.pair.close();time=1000;wait.resolve(undefined);await observed;await tick();
        expect(capture).toHaveBeenCalledTimes(phase==='ownership'?0:1);
        if(phase!=='ownership')expect(owner).toHaveBeenCalledWith(2,1);
        const results=vi.mocked(A.pair.background.postMessage).mock.calls.map(([p])=>p as any).filter(p=>p.kind==='result'&&p.response?.image);
        expect(results).toHaveLength(phase==='queue'?1:0);
    });
});

describe('客户端完整连接纪律',()=>{
    it('同context复用一个Port；后台下载不随页面Port断开取消',async()=>{
        const pair=documentPortPair();pairs.push(pair);const download=gates();const sendMessage=vi.fn(()=>download.promise);const connect=vi.fn(()=>pair.client);
        vi.stubGlobal('browser',{runtime:{connect,sendMessage}});
        const a=imageDocumentClient();expect(imageDocumentClient()).toBe(a);
        const {prepareImageOcrLanguages}=await import('@/src/features/image-translation/services/client');
        const pending=prepareImageOcrLanguages('en');const observed=Promise.allSettled([pending]);pair.close();
        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({type:'fluentReadImageOcrDownload'}));expect(connect).not.toHaveBeenCalled();
        download.resolve({success:true});expect((await observed)[0].status).toBe('fulfilled');
        const work=a.request({type:'fluentReadAreaCapture'},{requestId:'fresh',timeoutMs:10},'timeout');const rejected=Promise.allSettled([work]);await rejected;expect(connect).toHaveBeenCalledWith({name:'fluentReadImageDocument:v1'});
    });
    it('取消/超时经原Port；迟到abort不能取消相同ID的新pending',async()=>{
        vi.useFakeTimers();const h=fixture(()=>gates().promise);const A=h.add();const ctrl=new AbortController();const spy=vi.spyOn(ctrl.signal,'addEventListener');
        const pending=A.client.request({type:'fluentReadImageTranslate'},{requestId:'repeat',timeoutMs:10,signal:ctrl.signal},'timeout');const observed=Promise.allSettled([pending]);await tick();
        const oldAbort=spy.mock.calls[0][1] as ()=>void;ctrl.abort();expect((await observed)[0]).toMatchObject({status:'rejected',reason:{name:'AbortError'}});await tick();
        const second=request(A.client,'repeat');const secondObserved=Promise.allSettled([second]);await tick();const calls=vi.mocked(A.pair.client.postMessage).mock.calls.length;oldAbort();expect(vi.mocked(A.pair.client.postMessage)).toHaveBeenCalledTimes(calls);
        await vi.advanceTimersByTimeAsync(1000);expect((await secondObserved)[0]).toMatchObject({status:'rejected',reason:{name:'TimeoutError'}});
        const cancelled=vi.mocked(A.pair.client.postMessage).mock.calls.map(([p])=>p as any).filter(p=>p.message?.type==='fluentReadImageCancel');expect(cancelled).toHaveLength(2);
    });
    it('预取消不建Port，连接失败原错误保留；版本不匹配拒绝pending',async()=>{
        const ctrl=new AbortController();ctrl.abort();const connect=vi.fn(()=>{throw new Error('connect denied');});const c=createImageDocumentClient(connect);
        await expect(c.request({}, {requestId:'pre',timeoutMs:10,signal:ctrl.signal},'timeout')).rejects.toMatchObject({name:'AbortError'});expect(connect).not.toHaveBeenCalled();
        await expect(request(c)).rejects.toThrow('connect denied');c.reset();
        const pair=documentPortPair();pairs.push(pair);const client=createImageDocumentClient(()=>pair.client);const pending=request(client);const observed=Promise.allSettled([pending]);pair.clientMessages.emit({kind:'ready',version:IMAGE_DOCUMENT_VERSION+1});expect((await observed)[0].status).toBe('rejected');
    });
    it('旧Port的迟到监听和结果不能结算重连的新owner；源validator不跨重连',async()=>{
        const a=documentPortPair();const b=documentPortPair();pairs.push(a,b);let index=0;const client=createImageDocumentClient(()=>[a.client,b.client][index++]);
        subscriptions.push(subscribeImageSourceValidation(()=>({valid:true})));
        const first=request(client);const firstObserved=Promise.allSettled([first]);const oldReceive=[...a.clientMessages.listeners][0];const oldDisconnect=[...(a.client.onDisconnect as any).listeners] as (()=>void)[];
        client.reset();await firstObserved;
        const second=request(client);const secondObserved=Promise.allSettled([second]);oldReceive({kind:'result',rpcId:'request-1',response:'stale'});
        a.clientMessages.emit(null);for(const late of oldDisconnect) late();
        b.clientMessages.emit({kind:'sourceChallenge',rpcId:'challenge',message:{requestId:'old'}});await tick();
        expect(vi.mocked(b.client.postMessage).mock.calls.map(([p])=>p as any).find(p=>p.kind==='sourceReply').response).toEqual({valid:false});
        b.clientMessages.emit({kind:'result',rpcId:'request-2',response:'new'});expect(await secondObserved).toEqual([{status:'fulfilled',value:'new'}]);
    });
    it('坏进度/未知包被忽略，展示异常不终止事务，来源validator异常不授权',async()=>{
        const pair=documentPortPair();pairs.push(pair);const client=createImageDocumentClient(()=>pair.client);const progress=vi.fn(()=>{throw new Error('display');});
        subscriptions.push(subscribeImageSourceValidation(()=>{throw new Error('validation');}),subscribeImageSourceValidation(()=>undefined));
        const pending=client.request({type:'fluentReadImageTranslate'},{requestId:'task',timeoutMs:1000,onProgress:progress},'timeout');const observed=Promise.allSettled([pending]);
        for(const packet of [null,1,{}, {kind:'progress'}, {kind:'progress',message:{type:'wrong'}}, {kind:'progress',message:{type:'fluentReadImageProgress',stage:'wrong'}}, {kind:'progress',message:{type:'fluentReadImageProgress',stage:'translating',requestId:'other'}}]) pair.clientMessages.emit(packet);
        pair.clientMessages.emit({kind:'progress',message:{type:'fluentReadImageProgress',stage:'translating',requestId:'task',progress:150}});expect(progress).toHaveBeenCalledWith('translating',undefined);
        pair.clientMessages.emit({kind:'sourceChallenge',rpcId:'validation',message:{}});await tick();expect(vi.mocked(pair.client.postMessage).mock.calls.map(([p])=>p as any).find(p=>p.kind==='sourceReply').response).toEqual({valid:false});
        pair.clientMessages.emit({kind:'result',rpcId:'unknown',response:'wrong'});pair.clientMessages.emit({kind:'result',rpcId:'request-1',response:'ok'});expect(await observed).toEqual([{status:'fulfilled',value:'ok'}]);
    });
    for(const phase of ['start','cancel','source'] as const) it(`${phase}发送失败终止peer，无frame降级`,async()=>{
        const pair=documentPortPair();pairs.push(pair);const client=createImageDocumentClient(()=>pair.client);const ctrl=new AbortController();
        if(phase==='start') vi.mocked(pair.client.postMessage).mockImplementationOnce(()=>{throw new Error('post failed');});
        const pending=client.request({type:'fluentReadImageTranslate'},{requestId:'task',timeoutMs:1000,signal:ctrl.signal},'timeout');const observed=Promise.allSettled([pending]);
        if(phase!=='start'){
            vi.mocked(pair.client.postMessage).mockImplementationOnce(()=>{throw new Error('post failed');});
            vi.mocked(pair.client.disconnect).mockImplementationOnce(()=>{throw new Error('already closed');});
            if(phase==='cancel')ctrl.abort();else pair.clientMessages.emit({kind:'sourceChallenge',rpcId:'source',message:{}});
        }
        expect((await observed)[0].status).toBe('rejected');expect(pair.client.disconnect).toHaveBeenCalled();expect(pair.clientMessages.listeners.size).toBe(0);
    });
});

describe('后台异常与重复调用',()=>{
    it.each([new Error('provider rejected'),Object.assign(new Error('language failure'),{errorCode:'language'}),'primitive',null])('保留失败协议 %#',async value=>{
        const h=fixture(async()=>{throw value;});const A=h.add();expect(await request(A.client)).toMatchObject({success:false,error:String(value instanceof Error?value.message:value)});
    });
    it('同session不同RPC重复callerID只拒绝第二条，原pending不受影响',async()=>{
        const work=gates();const h=fixture((m,c,r)=>r.run(m,()=>work.promise,c));const A=h.add();
        const send=(rpcId:string)=>A.pair.client.postMessage({kind:'request',version:1,rpcId,message:{type:'fluentReadImageTranslate',requestId:'duplicate'}});
        send('first');send('second');send('first');await tick();expect(h.dispatch).toHaveBeenCalledTimes(2);
        const result=vi.mocked(A.pair.background.postMessage).mock.calls.map(([p])=>p as any).find(p=>p.kind==='result');expect(result.rpcId).toBe('second');expect(result.response.error).toContain('正在执行');
        work.resolve('first-result');await tick();expect(vi.mocked(A.pair.background.postMessage).mock.calls.map(([p])=>p as any).find(p=>p.kind==='result'&&p.rpcId==='first').response).toBe('first-result');
    });
    it.each(['handshake','result','challenge'] as const)('后台 %s post失败幂等撤销session',async phase=>{
        const h=fixture();const pair=documentPortPair({id:'extension',url:'extension://options'});pairs.push(pair);
        if(phase==='handshake')vi.mocked(pair.background.postMessage).mockImplementationOnce(()=>{throw new Error('post failed');});
        h.server.connect(pair.background);
        if(phase==='result'){
            vi.mocked(pair.background.postMessage).mockImplementationOnce(()=>{throw new Error('post failed');});
            pair.client.postMessage({kind:'request',version:1,rpcId:'start',message:{type:'fluentReadImageTranslate',requestId:'public'}});await tick();
        }else if(phase==='challenge'){
            pair.client.postMessage({kind:'request',version:1,rpcId:'start',message:{type:'fluentReadImageTranslate',requestId:'public'}});await tick();
            const session=getImageDocumentSession(h.contexts[0])!;vi.mocked(pair.background.disconnect).mockImplementationOnce(()=>{throw new Error('already closed');});vi.mocked(pair.background.postMessage).mockImplementationOnce(()=>{throw new Error('post failed');});
            await expect(session.challenge({} as any,new AbortController().signal,10)).rejects.toThrow('中断');session.revoke();
        }
        expect(pair.background.disconnect).toHaveBeenCalled();
    });
});


it('同一个真实Port重复接收保持同owner，后端随机源重复也不混合同sender新Port',async()=>{
    vi.spyOn(crypto,'randomUUID').mockReturnValue('11111111-1111-1111-1111-111111111111');
    const h=fixture();const A=h.add();const before=vi.mocked(A.pair.background.postMessage).mock.calls.length;
    expect(h.server.connect(A.pair.background)).toBe(true);expect(A.pair.background.postMessage).toHaveBeenCalledTimes(before);
    await request(A.client);const B=h.add();await request(B.client);
    expect(getImageDocumentSession(h.contexts[0])!.ownerKey).not.toBe(getImageDocumentSession(h.contexts[1])!.ownerKey);
});

it('存活session的截图取消在队列等待后拒绝capture，不依赖disconnect',async()=>{
    const wait=gates();const capture=vi.fn(async()=> 'data:image/png,x');let handlers:ReturnType<typeof createAreaTranslationBackgroundHandlers>;
    const h=fixture((m,c)=>Promise.resolve(handlers.find(x=>x.type===m.type)!.handle(m,c)));
    handlers=createAreaTranslationBackgroundHandlers({operationRegistry:h.registry,captureNow:()=>0,waitForCapture:()=>wait.promise as Promise<void>,
        captureVisibleTab:capture,getDefaultSourceLanguage:()=> 'en',assertLanguagesDownloaded:async()=>{},translateArea:async()=>({})});
    const A=h.add();await request(A.client,'seed','fluentReadAreaCapture');const queued=request(A.client,'queued','fluentReadAreaCapture');const observed=Promise.allSettled([queued]);await tick();
    expect(h.registry.cancel('queued',h.contexts[1]).cancelled).toBe(true);expect((await observed)[0].status).toBe('rejected');
    wait.resolve(undefined);await tick();expect(capture).toHaveBeenCalledOnce();expect(()=>getImageDocumentSession(h.contexts[1])!.assertLive()).not.toThrow();
});

it('现代document owner释放清除预取消及活跃工作，不影响其他document',async()=>{
    const r=createImageOperationRegistry();const a={sender:{id:'extension',tab:{id:1},documentId:'a'}};const b={sender:{...a.sender,documentId:'b'}};
    const old=gates();const other=gates();const first=r.run({requestId:'same'},()=>old.promise,a);const second=r.run({requestId:'same'},()=>other.promise,b);const observed=Promise.allSettled([first,second]);
    r.cancel('pre',a);r.releaseOwner(a);await expect(r.run({requestId:'pre'},async()=> 'new',a)).resolves.toBe('new');old.resolve('old');other.resolve('other');
    expect(await observed).toEqual([expect.objectContaining({status:'rejected'}),{status:'fulfilled',value:'other'}]);
    const send=vi.fn();vi.stubGlobal('browser',{tabs:{sendMessage:send}});await imageTranslationProgressTransport.sendProgress({sender:{documentId:'no-tab'}},{type:'fluentReadImageProgress',requestId:'pre',stage:'recognizing'});expect(send).not.toHaveBeenCalled();
});
