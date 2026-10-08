import {afterEach, describe, expect, it, vi} from 'vitest';
import {createNativeDocumentPortHandler, getNativeDocumentSession} from '@/src/platform/browser/documentSession';
import {createTranslationDocumentClient, sendTranslationRuntimeMessage, translationDocumentClient} from '@/src/services/translation/documentClient';
import {createTranslationDocumentPortHandler, isTranslationDocumentOperation, TRANSLATION_DOCUMENT_PORT} from '@/src/services/translation/documentChannel';
import {documentPortPair} from './helpers/imageDocumentPorts';

const capabilities=vi.hoisted(()=>({browser:'chrome'}));
vi.mock('@/src/platform/browser/capabilities',()=>({browserCapabilities:capabilities}));
const pairs:ReturnType<typeof documentPortPair>[]=[];
afterEach(()=>{for(const p of pairs.splice(0))p.close();capabilities.browser='chrome';vi.unstubAllGlobals();vi.restoreAllMocks();});
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const msg=(id='one')=>({origin:'Synthetic text.',clientRequestId:id});
const packet=(rpcId='one',message=msg())=>({kind:'request',version:1,rpcId,message});
function pair(sender:Parameters<typeof documentPortPair>[0]={id:'extension',tab:{id:1},frameId:0,url:'https://example.test/same'}){const p=documentPortPair(sender);pairs.push(p);return {...p,client:{...p.client,name:TRANSLATION_DOCUMENT_PORT},background:{...p.background,name:TRANSLATION_DOCUMENT_PORT}};}
function server(invoke:(message:Record<string,unknown>,context:import('@/src/platform/browser/requestOwner').BrowserRequestContext)=>Promise<unknown>=async()=> 'result'){const dispatch=vi.fn(invoke),releaseOwner=vi.fn();return{dispatch,releaseOwner,...createNativeDocumentPortHandler({runtimeId:'extension',name:TRANSLATION_DOCUMENT_PORT,version:1,accepts:isTranslationDocumentOperation,dispatch,releaseOwner})};}

describe('native text Port protocol and lifecycle controls',()=>{
    it('protocol accepts only bounded IDs and text/input start/cancel, never image or unknown typed messages',()=>{
        for(const m of [msg(),{...msg(),origin:['a','b']},{type:'inputBoxTranslation',clientRequestId:'input'},{type:'inputBoxTranslationCancel',clientRequestId:'input'},{type:'fluentReadTranslationCancel',clientRequestId:'text'}])expect(isTranslationDocumentOperation(m)).toBe(true);
        for(const m of [undefined,null,false,[],{...msg(),clientRequestId:undefined},{origin:'text'}, {...msg(),clientRequestId:''},{...msg(),clientRequestId:'x'.repeat(129)},{...msg(),clientRequestId:3},{...msg(),type:undefined},{...msg(),type:'fluentReadImageTranslate'},{clientRequestId:'own',extra:true},Object.create(msg())])expect(isTranslationDocumentOperation(m)).toBe(false);
    });
    it('specialized production port delegates to the same router and revokes every injected registry; unhandled replies fail closed', async () => {
        const releases = [vi.fn(), vi.fn()], dispatch = vi.fn(async (_message: Record<string, unknown>, _context: import('@/src/platform/browser/requestOwner').BrowserRequestContext) => ({handled: false}));
        const h = createTranslationDocumentPortHandler({runtimeId: 'extension', dispatch,
            registries: releases.map(releaseOwner => ({run: vi.fn(), cancel: vi.fn(), releaseOwner}))});
        const p = pair(); h.connect(p.background);
        await expect(createTranslationDocumentClient(() => p.client).request(msg())).resolves.toEqual({success: false, error: '不支持的后台消息'});
        expect(dispatch).toHaveBeenCalledOnce(); p.close();
        for (const release of releases) expect(release).toHaveBeenCalledWith(dispatch.mock.calls[0][1]);
    });
    it('foreign sender and wrong port name cannot obtain document capability; repeated native onConnect is idempotent',()=>{
        const h=server(),wrong=pair({id:'foreign'}),unnamed=pair(),valid=pair();
        expect(h.connect({...unnamed.background,name:'unrelated'})).toBe(false);expect(unnamed.background.disconnect).not.toHaveBeenCalled();expect(h.connect(wrong.background)).toBe(true);expect(wrong.background.disconnect).toHaveBeenCalled();
        expect(h.connect(valid.background)).toBe(true);expect(h.connect(valid.background)).toBe(true);expect(valid.backgroundMessages.listeners.size).toBe(1);expect(valid.background.postMessage).toHaveBeenCalledOnce();const oldDisconnect=[...(valid.background.onDisconnect as typeof valid.background.onDisconnect & {listeners:Set<()=>void>}).listeners][0];valid.close();oldDisconnect();expect(h.releaseOwner).toHaveBeenCalledOnce();
    });
    it('malformed, oversized, duplicate and image packets cannot dispatch text work or alter sender identity',async()=>{
        let finish!:(value:string)=>void;const dispatch=vi.fn(()=>new Promise<string>(r=>{finish=r;})),h=server(dispatch),p=pair();h.connect(p.background);
        for(const bad of [null,3,{kind:'result'}, {...packet(),version:2},{...packet(),rpcId:3},{...packet(),rpcId:'x'.repeat(129)},{...packet(),message:{...msg(),type:'fluentReadImageTranslate'}}])p.backgroundMessages.emit(bad);
        p.backgroundMessages.emit(packet('one',{...msg(),documentId:'forged',documentConnected:true} as ReturnType<typeof msg>));p.backgroundMessages.emit(packet());expect(dispatch).toHaveBeenCalledOnce();expect(h.dispatch.mock.calls[0][1].sender).toMatchObject({tab:{id:1},frameId:0});expect(h.dispatch.mock.calls[0][1].sender).not.toHaveProperty('documentId');finish('result');await tick();
        const listener=[...p.backgroundMessages.listeners][0];p.close();listener(packet('late'));expect(dispatch).toHaveBeenCalledOnce();
    });
    it.each([new Error('dispatch failure'),'plain failure'])('dispatch failure is serialized for a still-live peer: %s',async error=>{
        const h=server(vi.fn(async()=>{throw error;})),p=pair();h.connect(p.background);const client=createTranslationDocumentClient(()=>p.client);await expect(client.request(msg())).resolves.toEqual({success:false,error:error instanceof Error?error.message:error});
    });
    it('failed ready handshake revokes its owner without retaining listeners or affecting another session',()=>{
        const h=server(),broken=pair(),other=pair();vi.mocked(broken.background.postMessage).mockImplementationOnce(()=>{throw new Error('handshake closed');});expect(h.connect(broken.background)).toBe(true);h.connect(other.background);expect(h.releaseOwner).toHaveBeenCalledOnce();expect(broken.backgroundMessages.listeners.size).toBe(0);expect(other.backgroundMessages.listeners.size).toBe(1);
        h.releaseTab(999);expect(h.releaseOwner).toHaveBeenCalledOnce();h.releaseTab(1);expect(h.releaseOwner).toHaveBeenCalledTimes(2);
    });
    it('reply post failure closes only its peer and safely consumes a second failed disconnect',async()=>{
        const h=server(),p=pair();h.connect(p.background);vi.mocked(p.background.postMessage).mockImplementationOnce(()=>{throw new Error('reply closed');});vi.mocked(p.background.disconnect).mockImplementationOnce(()=>{throw new Error('already disconnected');});p.backgroundMessages.emit(packet());await tick();expect(h.releaseOwner).toHaveBeenCalledOnce();expect(p.backgroundMessages.listeners.size).toBe(0);
    });
    it('native sender metadata is cloned before caller mutation, with and without tab fields',async()=>{
        const h=server(),original={id:'extension',tab:{id:1},url:'https://before.test',frameId:0},p=pair(original);h.connect(p.background);original.tab.id=2;original.url='https://after.test';p.backgroundMessages.emit(packet());await tick();const context=h.dispatch.mock.calls[0][1];expect(context.sender!.tab!.id).toBe(1);expect(context.sender!.url).toBe('https://before.test');expect(Object.isFrozen(context)).toBe(true);expect(getNativeDocumentSession(context)!.ownerKey).toContain('native-document-port:');
        const page=pair({id:'extension',url:'moz-extension://extension/document.html'});h.connect(page.background);page.backgroundMessages.emit(packet());await tick();expect(h.dispatch.mock.calls[1][1].sender!.tab).toBeUndefined();
    });
    it('same caller ID duplicate is rejected without replacing pending; completion makes a late cancel a no-op',async()=>{
        const p=pair(),connect=vi.fn(()=>p.client),client=createTranslationDocumentClient(connect);const first=client.request(msg());await expect(client.request(msg())).rejects.toThrow('正在使用');expect(connect).toHaveBeenCalledOnce();p.clientMessages.emit({kind:'result',rpcId:'request-1',response:'done'});p.clientMessages.emit({kind:'result',rpcId:'request-1',response:'duplicate'});await expect(first).resolves.toBe('done');await expect(client.request({type:'fluentReadTranslationCancel',clientRequestId:'one'})).resolves.toMatchObject({cancelled:false});expect(p.client.postMessage).toHaveBeenCalledOnce();
    });
    it('disconnect reconnects only for a new request; old receive/cancel cannot affect the new peer',async()=>{
        const a=pair(),b=pair(),connect=vi.fn().mockReturnValueOnce(a.client).mockReturnValueOnce(b.client),client=createTranslationDocumentClient(connect);const first=client.request(msg()).catch(e=>e),old=[...a.clientMessages.listeners][0];a.close();await expect(first).resolves.toMatchObject({name:'AbortError'});const second=client.request(msg('new'));old({kind:'result',rpcId:'request-2',response:'old forged result'});old(null);await expect(client.request({type:'fluentReadTranslationCancel',clientRequestId:'one'})).resolves.toMatchObject({cancelled:false});expect(b.client.disconnect).not.toHaveBeenCalled();b.clientMessages.emit({kind:'result',rpcId:'request-2',response:'new result'});await expect(second).resolves.toBe('new result');expect(connect).toHaveBeenCalledTimes(2);
    });
    it('malformed result or unrelated packet leaves pending alive; ready version mismatch closes it',async()=>{
        const p=pair(),client=createTranslationDocumentClient(()=>p.client);const outcome=client.request(msg()).catch(e=>e);for(const bad of [null,3,{kind:'unknown'},{kind:'result',rpcId:'missing',response:'bad'},{kind:'ready',version:1}])p.clientMessages.emit(bad);p.clientMessages.emit({kind:'ready',version:2});await expect(outcome).resolves.toMatchObject({name:'AbortError'});expect(p.clientMessages.listeners.size).toBe(0);expect(p.client.disconnect).toHaveBeenCalled();
    });
    it('suspend/dispose cancel pending even if native disconnect throws; disposed cannot resume',async()=>{
        const p=pair(),connect=vi.fn(()=>p.client),client=createTranslationDocumentClient(connect);const outcome=client.request(msg()).catch(e=>e);vi.mocked(p.client.disconnect).mockImplementationOnce(()=>{throw new Error('already closed');});client.suspend();client.suspend();await expect(outcome).resolves.toMatchObject({name:'AbortError'});await expect(client.request(msg())).rejects.toMatchObject({name:'AbortError'});client.resume();client.dispose();client.dispose();client.suspend();client.resume();await expect(client.request(msg())).rejects.toMatchObject({name:'AbortError'});expect(connect).toHaveBeenCalledOnce();
    });
    it('disposing a live peer revokes it, while an active request post throw clears pending and permits a fresh connection',async()=>{
        const a=pair(),b=pair(),connect=vi.fn().mockReturnValueOnce(a.client).mockReturnValueOnce(b.client),client=createTranslationDocumentClient(connect);vi.mocked(a.client.postMessage).mockImplementationOnce(()=>{throw new Error('start post failure');});await expect(client.request(msg())).rejects.toThrow('start post failure');const next=client.request(msg('new')).catch(e=>e);client.dispose();await expect(next).resolves.toMatchObject({name:'AbortError'});expect(b.client.disconnect).toHaveBeenCalled();
    });
    it('failed cancel post rejects its RPC and closes the associated start without creating a replacement peer',async()=>{
        const p=pair(),connect=vi.fn(()=>p.client),client=createTranslationDocumentClient(connect),first=client.request(msg()).catch(e=>e);vi.mocked(p.client.postMessage).mockImplementationOnce(()=>{throw new Error('cancel post failure');});await expect(client.request({type:'fluentReadTranslationCancel',clientRequestId:'one'})).rejects.toThrow('cancel post failure');await expect(first).resolves.toMatchObject({name:'AbortError'});expect(connect).toHaveBeenCalledOnce();
    });
    it('connect exceptions reject without a pending leak',async()=>{const connect=vi.fn(()=>{throw new Error('revoked runtime');}),client=createTranslationDocumentClient(connect);await expect(client.request(msg())).rejects.toThrow('revoked runtime');await expect(client.request(msg('next'))).rejects.toThrow('revoked runtime');expect(connect).toHaveBeenCalledTimes(2);});
    it('Chrome direct sender uses the injected native runtime and never creates a document Port',async()=>{const runtime={sendMessage:vi.fn(async()=> 'chrome-native'),connect:vi.fn()};await expect(sendTranslationRuntimeMessage(msg(),runtime)).resolves.toBe('chrome-native');expect(runtime.connect).not.toHaveBeenCalled();vi.stubGlobal('browser',{runtime});await expect(sendTranslationRuntimeMessage(msg())).resolves.toBe('chrome-native');});
    it.each(['firefox','thunderbird'])('%s production sender and cached client use native connect; fake page lifecycle cannot revoke it',async browserName=>{
        capabilities.browser=browserName;const h=server(),p=pair();h.connect(p.background);const runtime={connect:vi.fn(()=>p.client),sendMessage:vi.fn()},listeners=new Map<string,(event:{isTrusted:boolean})=>void>();vi.stubGlobal('window',{addEventListener:(type:string,listener:(event:{isTrusted:boolean})=>void)=>listeners.set(type,listener)});vi.stubGlobal('browser',{runtime});
        const c=translationDocumentClient();expect(translationDocumentClient(runtime)).toBe(c);await expect(sendTranslationRuntimeMessage(msg())).resolves.toBe('result');expect(runtime.connect).toHaveBeenCalledWith({name:TRANSLATION_DOCUMENT_PORT});expect(runtime.sendMessage).not.toHaveBeenCalled();listeners.get('pagehide')!({isTrusted:false});listeners.get('pageshow')!({isTrusted:false});expect(p.client.disconnect).not.toHaveBeenCalled();listeners.get('pagehide')!({isTrusted:true});await expect(c.request(msg('paused'))).rejects.toMatchObject({name:'AbortError'});listeners.get('pageshow')!({isTrusted:true});const next=pair();h.connect(next.background);runtime.connect.mockReturnValueOnce(next.client);await expect(c.request(msg('restored'))).resolves.toBe('result');c.dispose();
    });
    it('singleton works in an extension runtime without Window globals',()=>{vi.stubGlobal('window',undefined);const runtime={connect:vi.fn(),sendMessage:vi.fn()};vi.stubGlobal('browser',{runtime});expect(translationDocumentClient()).toBe(translationDocumentClient(runtime));translationDocumentClient(runtime).dispose();});
});
