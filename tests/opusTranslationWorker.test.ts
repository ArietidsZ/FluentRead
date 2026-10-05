import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const fake = vi.hoisted(() => ({
    artifacts:undefined as any, old:vi.fn(), modern:vi.fn(), tokenizer:vi.fn(), read:vi.fn(), construct:vi.fn(), modelDispose:vi.fn(), translator:undefined as any, requireGpu:vi.fn(), compressed:vi.fn(), dispose:vi.fn(),
    oldEnv:{backends:{onnx:{wasm:{}}}} as any, modernEnv:{backends:{onnx:{wasm:{}}}} as any,
}));
vi.mock('@huggingface/transformers', () => ({env:fake.oldEnv, pipeline:fake.old,
    InterruptableStoppingCriteria:class {runtime='old'; interrupted=false; interrupt(){this.interrupted=true;}}}));
vi.mock('@huggingface/transformers-kokoro', () => ({env:fake.modernEnv,
    MarianTokenizer:class{constructor(...args:any[]){fake.tokenizer(...args);return {tokenizer:'pinned'};}},AutoModelForSeq2SeqLM:{from_pretrained:fake.modern},
    TranslationPipeline:class{constructor(options:any){fake.construct(options);return fake.translator;}},
    InterruptableStoppingCriteria:class {runtime='modern'; interrupted=false; interrupt(){this.interrupted=true;}}}));
vi.mock('@wllama/wllama/esm/index.js', () => ({Wllama:class {}}));
vi.mock('@/src/features/local-translation/offscreen/artifactStore',async(importOriginal)=>{const actual=await importOriginal<typeof import('@/src/features/local-translation/offscreen/artifactStore')>();return{...actual,getTranslationArtifacts:(model:string)=>fake.artifacts??actual.getTranslationArtifacts(model),translationArtifactBlob:fake.read};});
vi.mock('@/src/features/local-translation/offscreen/opusGpu', () => ({requireOpusGpu:fake.requireGpu,
    opusGpuSessionOptions:()=>({executionProviders:['webgpu'],graphOptimizationLevel:'all'})}));
vi.mock('@/src/shared/onnx/wasmBinary', () => ({configureOnnxWasmBackend:(backend:any, paths:any)=>{backend.wasmPaths=paths;},
    withCompressedWasmBinary:(...args:any[])=>fake.compressed(...args)}));
import {LOCAL_TRANSLATION_MODEL_IDS as ids} from '@/src/core/config/localTranslation';
let listener:(event:any)=>void, post:ReturnType<typeof vi.fn>, call:ReturnType<typeof vi.fn>;
beforeEach(async () => {
    vi.resetModules(); vi.clearAllMocks();fake.artifacts=undefined;
    fake.oldEnv.backends.onnx.wasm={};
    fake.modernEnv.backends.onnx.wasm={};
    fake.modernEnv.useWasmCache=true;
    call=vi.fn(async()=>[{translation_text:'Translated'}]);
    Object.assign(call,{dispose:fake.dispose});
    fake.old.mockResolvedValue(call);fake.translator=call;fake.modelDispose.mockReset().mockResolvedValue(undefined);fake.construct.mockReset();fake.modern.mockResolvedValue({model:'native',dispose:fake.modelDispose});fake.tokenizer.mockReset();fake.read.mockReset().mockImplementation(async(file:any)=>new Blob([JSON.stringify({repo:file.repo,path:file.path,revision:file.revision})]));
    fake.requireGpu.mockResolvedValue(undefined); fake.dispose.mockResolvedValue(undefined);
    fake.compressed.mockImplementation(async(_backend,_url,create)=>create());
    post=vi.fn();
    vi.stubGlobal('self',{location:{href:'chrome-extension://test/local-translation-worker.js'},
        setTimeout,clearTimeout,postMessage:post,addEventListener:(_type:string,handler:any)=>{listener=handler;}});
    const {startLocalTranslationWorker}=await import('@/src/features/local-translation/offscreen/translation.worker');
    startLocalTranslationWorker();
});
afterEach(()=>vi.unstubAllGlobals());
async function send(model:string, source='en',target='zh',requestId=1) {
    listener({data:{requestId,type:'translate',model,text:'Hello.',sourceLanguage:source,targetLanguage:target}});
    await vi.waitFor(()=>expect(post).toHaveBeenCalledWith(expect.objectContaining({requestId})));
    return post.mock.calls.find(([data])=>data.requestId===requestId)![0];
}
describe('OPUS precision routes in the production Worker',()=>{
    it('uses matching native ORT assets and stopping criteria only for Chinese FP16',async()=>{
        expect(await send(ids.opusZhEnGpu)).toMatchObject({success:true,backend:'webgpu'});
        expect(fake.requireGpu).toHaveBeenCalledWith('fp16');
        expect(fake.modernEnv.useWasmCache).toBe(false);
        expect(fake.modern).toHaveBeenCalledWith('Xenova/opus-mt-en-zh',expect.objectContaining({device:'webgpu',dtype:'fp16',revision:'046f55aec303cdee3e0318604406d4df20f1e8ea',local_files_only:true,
            session_options:expect.objectContaining({executionProviders:['webgpu']})}));
        expect(fake.old).not.toHaveBeenCalled();
        expect(fake.tokenizer).toHaveBeenCalledWith({repo:'Xenova/opus-mt-en-zh',path:'tokenizer.json',revision:'046f55aec303cdee3e0318604406d4df20f1e8ea'},{repo:'Xenova/opus-mt-en-zh',path:'tokenizer_config.json',revision:'046f55aec303cdee3e0318604406d4df20f1e8ea'});
        expect(fake.construct).toHaveBeenCalledWith({task:'translation',model:{model:'native',dispose:fake.modelDispose},tokenizer:{tokenizer:'pinned'}});
        expect(fake.modernEnv.backends.onnx.wasm.wasmPaths).toEqual({
            mjs:'chrome-extension://test/fluent-read-ai/tts-ort-wasm-simd-threaded.asyncify.mjs',
            wasm:'chrome-extension://test/fluent-read-ai/tts-ort-wasm-simd-threaded.asyncify.wasm',
        });
        expect(fake.compressed.mock.calls[0][0]).toBe(fake.modernEnv.backends.onnx.wasm);
        expect(fake.compressed.mock.calls[0][1]).toBe('chrome-extension://test/fluent-read-ai/tts-ort-wasm-simd-threaded.asyncify.wasm');
        expect(call.mock.calls[0][1].stopping_criteria.runtime).toBe('modern');
    });
    it('uses the original runtime for the validated one-way Japanese FP32 profile',async()=>{
        expect(await send(ids.opusJaEnGpu,'ja','en')).toMatchObject({success:true,backend:'webgpu'});
        expect(fake.requireGpu).toHaveBeenCalledWith('fp32');
        expect(fake.old).toHaveBeenCalledWith('translation','Xenova/opus-mt-ja-en',expect.objectContaining({device:'webgpu',dtype:'fp32'}));
        expect(fake.oldEnv.backends.onnx.wasm.wasmPaths).toEqual({
            mjs:'chrome-extension://test/fluent-read-ai/ort-wasm-simd-threaded.jsep.mjs',
            wasm:'chrome-extension://test/fluent-read-ai/ort-wasm-simd-threaded.jsep.wasm',
        });
        expect(fake.compressed.mock.calls[0][0]).toBe(fake.oldEnv.backends.onnx.wasm);
        expect(fake.compressed.mock.calls[0][1]).toBe('chrome-extension://test/fluent-read-ai/ort-wasm-simd-threaded.jsep.wasm');
        expect(fake.modern).not.toHaveBeenCalled();
        expect(await send(ids.opusJaEnGpu,'en','ja',2)).toMatchObject({success:false,error:'LOCAL_TRANSLATION_LANGUAGE_UNSUPPORTED'});
    });
    it('keys reuse by precision and disposes the previous pipeline on a same-repository precision switch',async()=>{
        await send(ids.opusZhEn); await send(ids.opusZhEn,'en','zh',2);
        expect(fake.old).toHaveBeenCalledTimes(1);expect(fake.modern).not.toHaveBeenCalled();expect(fake.requireGpu).not.toHaveBeenCalled();
        await send(ids.opusZhEnGpu,'en','zh',3);
        expect(fake.dispose).toHaveBeenCalledTimes(1);expect(fake.modern).toHaveBeenCalledTimes(1);
    });
    it('keeps every component pinned across a Chinese repository switch and releases the previous pipeline',async()=>{
        await send(ids.opusZhEnGpu);await send(ids.opusZhEnGpu,'zh','en',2);
        expect(fake.modern).toHaveBeenCalledTimes(2);expect(fake.dispose).toHaveBeenCalledTimes(1);
        expect(fake.read).toHaveBeenLastCalledWith(expect.objectContaining({repo:'Xenova/opus-mt-zh-en',path:'tokenizer_config.json',revision:'39d480d52a9ea3065a1f117adfe4dbc55de10e6f'}));
        expect(fake.modern).toHaveBeenLastCalledWith('Xenova/opus-mt-zh-en',expect.objectContaining({revision:'39d480d52a9ea3065a1f117adfe4dbc55de10e6f',local_files_only:true}));
    });
    it('rejects absent pinned tokenizer artifacts before allocating model resources',async()=>{
        fake.artifacts=[];
        expect(await send(ids.opusZhEnGpu)).toMatchObject({success:false,error:'LOCAL_TRANSLATION_INVALID_MODEL'});
        expect(fake.modern).not.toHaveBeenCalled();expect(fake.tokenizer).not.toHaveBeenCalled();
    });
    it('rejects malformed pinned tokenizer JSON before allocating model resources',async()=>{
        fake.read.mockResolvedValueOnce(new Blob(['{invalid']));
        expect(await send(ids.opusZhEnGpu)).toMatchObject({success:false});
        expect(fake.modern).not.toHaveBeenCalled();expect(fake.tokenizer).not.toHaveBeenCalled();
    });
    it('uses native pinned constructors when the optional WASM configuration object is absent',async()=>{
        fake.modernEnv.backends.onnx.wasm=undefined;
        expect(await send(ids.opusZhEnGpu)).toMatchObject({success:true,backend:'webgpu'});
        expect(fake.compressed).not.toHaveBeenCalled();expect(fake.modern).toHaveBeenCalledTimes(1);
    });
    it('does not load model resources after a tokenizer load failure',async()=>{
        fake.read.mockRejectedValueOnce(new Error('tokenizer missing'));
        expect(await send(ids.opusZhEnGpu)).toMatchObject({success:false,error:'tokenizer missing'});
        expect(fake.modern).not.toHaveBeenCalled();expect(fake.construct).not.toHaveBeenCalled();expect(fake.old).not.toHaveBeenCalled();
    });
    it.each([false,true])('releases a loaded native model after pipeline construction fails, cleanup rejection=%s',async(reject)=>{
        fake.construct.mockImplementationOnce(()=>{throw new Error('pipeline construction');});
        if(reject)fake.modelDispose.mockRejectedValueOnce(new Error('cleanup failure'));
        expect(await send(ids.opusZhEnGpu)).toMatchObject({success:false,error:'pipeline construction'});
        expect(fake.modelDispose).toHaveBeenCalledTimes(1);expect(fake.old).not.toHaveBeenCalled();
    });
    it('rejects a stopped native generation instead of returning its late output',async()=>{
        call.mockImplementationOnce(async(_text:any,options:any)=>{options.stopping_criteria.interrupt();return[{translation_text:'late output'}];});
        expect(await send(ids.opusZhEnGpu)).toMatchObject({success:false,error:'LOCAL_TRANSLATION_TIMEOUT'});
    });
    it.each(['preflight','load','run'])('reports %s failure without switching the GPU request to CPU',async(stage)=>{
        if(stage==='preflight')fake.requireGpu.mockRejectedValueOnce(new Error('GPU unavailable'));
        if(stage==='load')fake.modern.mockRejectedValueOnce(new Error('GPU init'));
        if(stage==='run')call.mockRejectedValueOnce(new Error('GPU lost'));
        expect(await send(ids.opusZhEnGpu)).toMatchObject({success:false});
        expect(fake.old).not.toHaveBeenCalled();
        expect(fake.modern).toHaveBeenCalledTimes(stage==='preflight'?0:1);
    });

});
