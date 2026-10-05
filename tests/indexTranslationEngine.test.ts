import {beforeEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({gpu:vi.fn(),load:vi.fn(),exit:vi.fn(),chat:vi.fn(),read:vi.fn(),proof:vi.fn(),create:vi.fn(),count:vi.fn(),files:vi.fn()}));
vi.mock('@/src/features/local-translation/offscreen/indexGpu',()=>({requireIndexGpu:f.gpu,createGpuOffloadProof:()=>({assert:f.proof,logger:{debug(){},log(){},warn(){},error(){}}})}));
vi.mock('@/src/features/local-translation/offscreen/artifactStore',()=>({getTranslationArtifacts:f.files,translationArtifactBlob:f.read}));
vi.mock('@huggingface/tokenizers',()=>({Tokenizer:class{encode(text:string){return {ids:Array(f.count(text)).fill(1)};}}}));
vi.mock('@wllama/wllama/esm/index.js',()=>({Wllama:class{constructor(...args:unknown[]){f.create(...args);}setCompat=vi.fn();loadModel=f.load;exit=f.exit;createChatCompletion=f.chat;}}));
import {createIndexTranslator} from '@/src/features/local-translation/offscreen/indexEngine';
beforeEach(()=>{vi.clearAllMocks();f.files.mockReturnValue(['tokenizer.json','tokenizer_config.json','Index-Translate-2B.Q6_K.gguf'].map(path=>({path})));f.gpu.mockResolvedValue(undefined);f.proof.mockImplementation(()=>undefined);f.load.mockResolvedValue(undefined);f.exit.mockResolvedValue(undefined);f.count.mockImplementation((s:string)=>s.length);f.read.mockResolvedValue(new Blob(['{}']));f.chat.mockResolvedValue({choices:[{finish_reason:'stop',message:{content:'译文'}}],usage:{prompt_tokens:100}});});
describe('Index native GPU session',()=>{
 it('loads once, uses greedy native template, preserves lines and releases once',async()=>{
  const engine=await createIndexTranslator('index','wasm');
  expect(f.load).toHaveBeenCalledWith(expect.any(Array),expect.objectContaining({n_gpu_layers:99,n_parallel:1,ctx_shift:false,default_template_kwargs:{enable_thinking:false}}));
  expect(await engine.translate('First sentence. Second sentence.\n\nNext.','zh',{},new AbortController().signal)).toBe('译文\n\n译文');
  expect(f.chat).toHaveBeenCalledTimes(2);
  expect(f.chat.mock.calls[0][0]).toMatchObject({temperature:0,cache_prompt:true,max_tokens:768,chat_template_kwargs:{enable_thinking:false}});
  await engine.dispose();await engine.dispose();expect(f.exit).toHaveBeenCalledTimes(1);
  await expect(engine.translate('x','en',{},new AbortController().signal)).rejects.toThrow('GPU_UNVERIFIED');
 });
 it('rejects an incomplete pinned manifest before creating a session',async()=>{f.files.mockReturnValue([]);await expect(createIndexTranslator('index','wasm')).rejects.toThrow('INVALID_MODEL');expect(f.create).not.toHaveBeenCalled();});
 it('never retries load on CPU and preserves the initial error if cleanup fails',async()=>{
  f.load.mockRejectedValue(new Error('GPU load'));f.exit.mockRejectedValue(new Error('release'));
  await expect(createIndexTranslator('index','wasm')).rejects.toThrow('GPU load');
  expect(f.load).toHaveBeenCalledTimes(1);expect(f.exit).toHaveBeenCalledTimes(1);
 });
 it.each(['length','tokens','empty','placeholder','device'])('poisons and releases failed %s inference',async(kind)=>{
  const engine=await createIndexTranslator('index','wasm');
  const response={choices:[{finish_reason:kind==='length'?'length':'stop',message:{content:kind==='empty'?'':'text'}}],usage:{prompt_tokens:kind==='tokens'?1281:100}};
  f.chat.mockResolvedValue(response);if(kind==='device')f.proof.mockImplementation(()=>{throw new Error('device lost');});
  await expect(engine.translate(kind==='placeholder'?'__FRTERM_a__':'source','en',{},new AbortController().signal)).rejects.toThrow();
  expect(f.exit).toHaveBeenCalledTimes(1);
 });
 it('honors cancellation before and after native completion',async()=>{
  for(const after of [false,true]){
   const engine=await createIndexTranslator('index','wasm'),abort=new AbortController();
   if(after)f.chat.mockImplementation(async()=>{abort.abort();return {choices:[],usage:{prompt_tokens:1}};});else abort.abort();
   await expect(engine.translate('source','en',{},abort.signal)).rejects.toMatchObject({name:'AbortError'});
  }
 });
});
