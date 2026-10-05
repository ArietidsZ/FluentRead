import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const cache=vi.hoisted(()=>({isCached:vi.fn(),remove:vi.fn(),prepare:vi.fn()}));
vi.mock('@/src/features/local-tts/offscreen/modelCache',()=>({isLocalTtsModelCached:cache.isCached,removeLocalTtsModelFiles:cache.remove,cacheLocalTtsModelFiles:cache.prepare}));
class Worker {static all:Worker[]=[];onmessage:any;onerror:any;message:any;terminate=vi.fn();constructor(){Worker.all.push(this);}postMessage(message:any){this.message=message;}reply(){this.onmessage({data:{requestId:this.message.requestId,success:true,audio:new ArrayBuffer(46),backend:'webgpu'}});}}
const deferred=()=>{let resolve!:(value:any)=>void;let reject!:(error:any)=>void;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
beforeEach(()=>{vi.resetModules();cache.isCached.mockReset().mockResolvedValue(true);cache.remove.mockReset().mockResolvedValue(undefined);cache.prepare.mockReset().mockResolvedValue(undefined);Worker.all=[];vi.stubGlobal('Worker',Worker);vi.stubGlobal('window',{setTimeout,clearTimeout,location:{href:'https://extension.test/offscreen.html'}});});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
const load=()=>import('@/src/features/local-tts/offscreen/tts');
describe('TTS admission and teardown',()=>{
 it('blocks removal during asynchronous cache preflight and releases the lease on failure',async()=>{
  const gate=deferred();cache.isCached.mockReturnValueOnce(gate.promise);const owner=await load();
  const pending=owner.synthesizeLocalTts('hello','en','auto'),rejected=expect(pending).rejects.toThrow('cache failed');
  await expect(owner.removeLocalTtsModel()).rejects.toThrow('正在运行');expect(cache.remove).not.toHaveBeenCalled();
  gate.reject(new Error('cache failed'));await rejected;await owner.removeLocalTtsModel();expect(cache.remove).toHaveBeenCalledOnce();
 });
 it('blocks new synthesis during deletion and resets after a failed delete',async()=>{
  const gate=deferred();cache.remove.mockReturnValueOnce(gate.promise);const owner=await load();
  const removal=owner.removeLocalTtsModel(),rejected=expect(removal).rejects.toThrow('delete failed');
  await expect(owner.synthesizeLocalTts('hello','en','auto')).rejects.toThrow();expect(cache.isCached).not.toHaveBeenCalled();
  await expect(owner.removeLocalTtsModel()).rejects.toThrow('正在运行');gate.reject(new Error('delete failed'));await rejected;
  await owner.removeLocalTtsModel();expect(cache.remove).toHaveBeenCalledTimes(2);
 });
 it('invalidates preflight work on disposal without creating a worker',async()=>{
  const gate=deferred();cache.isCached.mockReturnValueOnce(gate.promise);const owner=await load();
  const pending=owner.synthesizeLocalTts('hello','en','auto'),rejected=expect(pending).rejects.toMatchObject({name:'AbortError'});
  owner.disposeLocalTtsWorker();gate.resolve(true);await rejected;expect(Worker.all).toHaveLength(0);
 });
 it('rejects pending and queued jobs on disposal without CPU resurrection, then accepts a new generation',async()=>{
  const owner=await load();const first=owner.synthesizeLocalTts('one','en','auto'),second=owner.synthesizeLocalTts('two','en','auto');
  const errors=Promise.all([expect(first).rejects.toMatchObject({name:'AbortError'}),expect(second).rejects.toMatchObject({name:'AbortError'})]);
  await vi.waitFor(()=>expect(Worker.all).toHaveLength(1));owner.disposeLocalTtsWorker();await errors;expect(Worker.all).toHaveLength(1);expect(Worker.all[0].terminate).toHaveBeenCalledOnce();
  const next=owner.synthesizeLocalTts('three','en','auto');await vi.waitFor(()=>expect(Worker.all).toHaveLength(2));Worker.all[1].reply();await expect(next).resolves.toMatchObject({backend:'webgpu'});owner.disposeLocalTtsWorker();
 });
});

describe('TTS owner execution policy',()=>{
 it.each(['GPU crash',''])('rejects a GPU crash (%s) without CPU retry and starts a fresh GPU worker',async(message)=>{
  const owner=await load();const first=owner.synthesizeLocalTts('one','en','auto'),rejected=expect(first).rejects.toThrow(message||'本地 TTS Worker 已停止');
  await vi.waitFor(()=>expect(Worker.all).toHaveLength(1));expect(Worker.all[0].message.execution).toBe('gpu');Worker.all[0].onerror({message});await rejected;expect(Worker.all).toHaveLength(1);
  const next=owner.synthesizeLocalTts('two','en','auto');await vi.waitFor(()=>expect(Worker.all).toHaveLength(2));Worker.all[1].reply();await next;owner.disposeLocalTtsWorker();
 });
 it('rejects a WASM result in GPU mode instead of relabeling it',async()=>{
  const owner=await load();const pending=owner.synthesizeLocalTts('one','en','auto'),rejected=expect(pending).rejects.toThrow('不允许 CPU');
  await vi.waitFor(()=>expect(Worker.all).toHaveLength(1));const worker=Worker.all[0];worker.onmessage({data:{requestId:worker.message.requestId,success:true,audio:new ArrayBuffer(46),backend:'wasm'}});await rejected;expect(worker.terminate).toHaveBeenCalledOnce();
 });
 it('replaces the compatibility session when changing to GPU execution',async()=>{
  const owner=await load();const first=owner.synthesizeLocalTts('one','en','auto',undefined,'compatible');await vi.waitFor(()=>expect(Worker.all).toHaveLength(1));Worker.all[0].reply();await first;
  const next=owner.synthesizeLocalTts('two','en','auto',undefined,'gpu');await vi.waitFor(()=>expect(Worker.all).toHaveLength(2));expect(Worker.all[0].terminate).toHaveBeenCalledOnce();Worker.all[1].reply();await next;owner.disposeLocalTtsWorker();
 });
});

it('uses the full GPU deadline and never creates a CPU worker after timeout',async()=>{
 vi.useFakeTimers();vi.stubGlobal('window',{setTimeout,clearTimeout,location:{href:'https://extension.test/offscreen.html'}});const owner=await load(),pending=owner.synthesizeLocalTts('one','en','auto'),rejected=expect(pending).rejects.toThrow('120');
 await vi.advanceTimersByTimeAsync(0);expect(Worker.all).toHaveLength(1);
 await vi.advanceTimersByTimeAsync(60_000);expect(Worker.all[0].terminate).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(60_000);await rejected;expect(Worker.all).toHaveLength(1);expect(Worker.all[0].terminate).toHaveBeenCalledOnce();
});

describe('TTS owner failure and idle boundaries',()=>{
 it('prepares cache without claiming a warm model, and reports cache status accurately',async()=>{
  const owner=await load();expect(await owner.prepareLocalTtsModel(true)).toMatchObject({warm:false,dtype:'fp32'});expect(cache.prepare).toHaveBeenCalledOnce();expect(Worker.all).toHaveLength(0);
  expect((await owner.getLocalTtsModelStatus()).models[0].downloaded).toBe(true);cache.isCached.mockResolvedValue(false);
  expect((await owner.getLocalTtsModelStatus()).models[0].downloaded).toBe(false);await expect(owner.prepareLocalTtsModel()).rejects.toThrow('缓存不完整');
  await expect(owner.synthesizeLocalTts('hello','en','auto')).rejects.toThrow('尚未下载');await expect(owner.synthesizeLocalTts('bonjour','fr','auto')).rejects.toThrow('不支持语言');await owner.removeLocalTtsModel();
 });
 it.each([new Error('post failed'),'string failure',{}])('cleans up synchronous postMessage failure %#',async(error)=>{
  vi.stubGlobal('Worker',class extends Worker{postMessage(){throw error;}});const owner=await load(),controller=new AbortController();
  await expect(owner.synthesizeLocalTts('hello','en','auto',controller.signal)).rejects.toThrow();expect(Worker.all[0].terminate).toHaveBeenCalledOnce();await owner.removeLocalTtsModel();
 });
 it('rejects empty audio and worker protocol errors without losing admission ownership',async()=>{
  const owner=await load();
  let requestId=0;
  for(const response of [{success:true,backend:'webgpu'},{success:false},{success:false,error:'failed'},{success:false,retryWithCpu:true}]){
   const pending=owner.synthesizeLocalTts('hello','en','auto'),rejected=expect(pending).rejects.toThrow();
   requestId++;await vi.waitFor(()=>expect(Worker.all.at(-1)?.message.requestId).toBe(requestId));
   const w=Worker.all.at(-1)!;w.onmessage({data:null});w.onmessage({data:{requestId:-1,success:false}});w.onmessage({data:{requestId:w.message.requestId,...response}});await rejected;
  }
  owner.disposeLocalTtsWorker();await owner.removeLocalTtsModel();
 });
 it('keeps a queued active synthesis alive across the previous result idle timer',async()=>{
  vi.useFakeTimers();vi.stubGlobal('window',{setTimeout,clearTimeout,location:{href:'https://extension.test/offscreen.html'}});vi.stubGlobal('chrome',{runtime:{getURL:(path:string)=>'https://extension.test/'+path}});
  const owner=await load(),controller=new AbortController();const first=owner.synthesizeLocalTts('one','en','auto',controller.signal),second=owner.synthesizeLocalTts('two','en','auto');
  await vi.advanceTimersByTimeAsync(0);Worker.all[0].reply();await first;await vi.advanceTimersByTimeAsync(0);expect(Worker.all).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(30_000);expect(Worker.all[0].terminate).not.toHaveBeenCalled();Worker.all[0].reply();await second;
  await vi.advanceTimersByTimeAsync(30_000);expect(Worker.all[0].terminate).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
 });
 it('handles cancellation during worker construction before posting',async()=>{
  const controller=new AbortController();vi.stubGlobal('Worker',class extends Worker{constructor(){super();controller.abort();}});const owner=await load();
  await expect(owner.synthesizeLocalTts('one','en','auto',controller.signal)).rejects.toMatchObject({name:'AbortError'});expect(Worker.all[0].message).toBeUndefined();
 });
});
