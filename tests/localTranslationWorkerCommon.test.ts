import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const fake=vi.hoisted(()=>({supported:vi.fn(),engine:undefined as any,make:vi.fn(),chunks:undefined as any,artifacts:undefined as any,match:vi.fn(),old:vi.fn(),read:vi.fn(),dispose:vi.fn(),compressed:vi.fn(),oldEnv:{backends:{onnx:{wasm:{}}}} as any}));
vi.mock('@huggingface/transformers',()=>({env:fake.oldEnv,pipeline:fake.old,InterruptableStoppingCriteria:class{runtime='old';interrupted=false;interrupt(){this.interrupted=true;}}}));
// The installed alias exists in both independent heads; only the OPUS head imports it.
vi.mock('@huggingface/transformers-kokoro',()=>({env:{backends:{onnx:{wasm:{}}}},MarianTokenizer:class{},AutoModelForSeq2SeqLM:{},TranslationPipeline:class{},InterruptableStoppingCriteria:class{}}));
vi.mock('@wllama/wllama/esm/index.js',()=>({Wllama:class{constructor(...args:any[]){fake.make(...args);for(const fn of Object.values(args[1].logger) as Array<()=>void>)fn();return fake.engine;}}}));
vi.mock('@/src/features/local-translation/offscreen/artifactStore',async(importOriginal)=>{const actual=await importOriginal<typeof import('@/src/features/local-translation/offscreen/artifactStore')>();return{...actual,getTranslationArtifacts:(model:string)=>fake.artifacts??actual.getTranslationArtifacts(model),matchTranslationArtifact:fake.match,translationArtifactBlob:fake.read};});
vi.mock('@/src/platform/browser/localTranslationSupport',()=>({supportsHunyuanTranslation:fake.supported}));
vi.mock('@/src/core/translation/localInference',async(importOriginal)=>{const actual=await importOriginal<typeof import('@/src/core/translation/localInference')>();return{...actual,splitLocalTranslationText:(text:string)=>fake.chunks??actual.splitLocalTranslationText(text)};});
vi.mock('@/src/shared/onnx/wasmBinary',()=>({configureOnnxWasmBackend:(backend:any,paths:any)=>{backend.wasmPaths=paths;},withCompressedWasmBinary:(...args:any[])=>fake.compressed(...args)}));
import {LOCAL_TRANSLATION_MODEL_IDS as ids} from '@/src/core/config/localTranslation';
let listener:(event:any)=>void,post:ReturnType<typeof vi.fn>,call:ReturnType<typeof vi.fn>;
beforeEach(async()=>{
    vi.resetModules();vi.clearAllMocks();fake.artifacts=undefined;fake.chunks=undefined;fake.match.mockReset();fake.supported.mockReset().mockReturnValue(true);
    fake.engine={setCompat:vi.fn(),loadModel:vi.fn().mockResolvedValue(undefined),exit:vi.fn().mockResolvedValue(undefined),createChatCompletion:vi.fn().mockResolvedValue({choices:[{message:{content:'Translated'}}]})};
    vi.stubGlobal('navigator',{});vi.stubGlobal('WebAssembly',{});fake.oldEnv.backends.onnx.wasm={};
    call=vi.fn(async()=>[{translation_text:'Translated'}]);Object.assign(call,{dispose:fake.dispose});fake.old.mockResolvedValue(call);fake.dispose.mockResolvedValue(undefined);
    fake.read.mockReset().mockImplementation(async(file:any)=>new Blob([JSON.stringify(file)]));fake.compressed.mockImplementation(async(_backend,_url,create)=>create());
    post=vi.fn();vi.stubGlobal('self',{location:{href:'chrome-extension://test/localTranslationWorker.js'},setTimeout,clearTimeout,postMessage:post,addEventListener:(_type:string,handler:any)=>{listener=handler;}});
    const {startLocalTranslationWorker}=await import('@/src/features/local-translation/offscreen/translation.worker');startLocalTranslationWorker();
});
afterEach(()=>vi.unstubAllGlobals());
async function send(model:string,source='en',target='zh',requestId=1){listener({data:{requestId,type:'translate',model,text:'Hello.',sourceLanguage:source,targetLanguage:target}});await vi.waitFor(()=>expect(post).toHaveBeenCalledWith(expect.objectContaining({requestId})));return post.mock.calls.find(([data])=>data.requestId===requestId)![0];}
describe('Common Q8 and Hunyuan production Worker contracts',()=>{
    it('keeps Q8 on the original WASM pipeline',async()=>{
        expect(await send(ids.opusZhEn)).toMatchObject({success:true,backend:'wasm'});
        expect(fake.old).toHaveBeenCalledWith('translation','Xenova/opus-mt-en-zh',expect.objectContaining({device:'wasm',dtype:'q8'}));

        expect(fake.oldEnv.backends.onnx.wasm.wasmPaths).toEqual({
            mjs:'chrome-extension://test/fluent-read-ai/ort-wasm-simd-threaded.jsep.mjs',
            wasm:'chrome-extension://test/fluent-read-ai/ort-wasm-simd-threaded.jsep.wasm',
        });
        expect(fake.compressed.mock.calls[0][0]).toBe(fake.oldEnv.backends.onnx.wasm);
        expect(fake.compressed.mock.calls[0][1]).toBe('chrome-extension://test/fluent-read-ai/ort-wasm-simd-threaded.jsep.wasm');
        expect(call.mock.calls[0][1].stopping_criteria.runtime).toBe('old');
    });
    it('forwards exact remote cache keys, suppresses local probes and rejects writes',async()=>{
        const legacy=vi.fn().mockResolvedValue('legacy-response'),open=vi.fn().mockResolvedValue({match:legacy});
        vi.stubGlobal('caches',{open});
        const cache=fake.oldEnv.customCache;
        expect(await cache.match(fake.oldEnv.localModelPath+'optional.json')).toBeUndefined();
        expect(fake.match).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();
        fake.match.mockResolvedValueOnce('verified-response');
        expect(await cache.match(new Request('https://example.test/pinned'))).toBe('verified-response');
        expect(fake.match).toHaveBeenLastCalledWith('https://example.test/pinned');expect(open).not.toHaveBeenCalled();
        fake.match.mockResolvedValueOnce(undefined);
        expect(await cache.match('https://example.test/legacy')).toBe('legacy-response');
        expect(open).toHaveBeenCalledWith('transformers-cache');expect(legacy).toHaveBeenCalledWith('https://example.test/legacy');
        await expect(cache.put()).rejects.toThrow('LOCAL_TRANSLATION_NOT_DOWNLOADED');
    });
    it('ignores malformed addressed messages and acknowledges explicit disposal',async()=>{
        listener({data:null});listener({data:{requestId:'invalid'}});
        expect(post).not.toHaveBeenCalled();
        await send(ids.opusZhEn);
        listener({data:{requestId:2,type:'dispose'}});
        await vi.waitFor(()=>expect(post).toHaveBeenCalledWith({requestId:2,success:true}));
        expect(fake.dispose).toHaveBeenCalledTimes(1);
    });
    it('retains generic transport error ownership for non-Error failures',async()=>{
        call.mockRejectedValueOnce('runtime rejection');
        expect(await send(ids.opusZhEn)).toMatchObject({success:false,error:'LOCAL_TRANSLATION_FAILED'});
    });
    it.each([{text:''},{sourceLanguage:''},{targetLanguage:''}])('rejects incomplete translation requests %o',async(patch)=>{
        listener({data:{requestId:9,type:'translate',model:ids.opusZhEn,text:'Hello',sourceLanguage:'en',targetLanguage:'zh',...patch}});
        await vi.waitFor(()=>expect(post).toHaveBeenCalledWith({requestId:9,success:false,error:'LOCAL_TRANSLATION_INVALID_REQUEST'}));
    });
    it('preserves whitespace chunks and accepts the native singleton output shape',async()=>{
        fake.chunks=['  ',' Hello. '];call.mockResolvedValueOnce({translation_text:'Translated'});
        expect(await send(ids.opusZhEn)).toMatchObject({success:true,result:'   Translated '});
        expect(call).toHaveBeenCalledTimes(1);
    });
    it.each([[],null,[{}]])('rejects missing native output %j',async(value)=>{
        call.mockResolvedValueOnce(value);
        expect(await send(ids.opusZhEn)).toMatchObject({success:false});
    });
    it('interrupts timed-out generation and preserves timeout ownership',async()=>{
        self.setTimeout=((fn:any,ms:number)=>{if(ms===90000){fn();return 1;}return setTimeout(fn,ms);}) as any;
        expect(await send(ids.opusZhEn)).toMatchObject({success:false,error:'LOCAL_TRANSLATION_TIMEOUT'});
    });



    it('rejects Hunyuan on unsupported browsers and missing model artifacts',async()=>{
        fake.supported.mockReturnValueOnce(false);
        expect(await send(ids.hunyuan)).toMatchObject({success:false,error:'LOCAL_TRANSLATION_BROWSER_UNSUPPORTED'});
        fake.artifacts=[];
        expect(await send(ids.hunyuan,'en','zh',2)).toMatchObject({success:false,error:'LOCAL_TRANSLATION_INVALID_MODEL'});
    });
    it('reuses Hunyuan CPU engine and disposes it on an OPUS switch',async()=>{
        await send(ids.hunyuan);await send(ids.hunyuan,'en','zh',2);
        expect(fake.engine.loadModel).toHaveBeenCalledTimes(1);
        expect(fake.engine.loadModel).toHaveBeenCalledWith(expect.any(Array),expect.objectContaining({n_gpu_layers:0}));
        await send(ids.opusZhEn,'en','zh',3);expect(fake.engine.exit).toHaveBeenCalledTimes(1);
    });
    it('uses the Hunyuan GPU path when native capabilities are present',async()=>{
        vi.stubGlobal('navigator',{gpu:{}});vi.stubGlobal('WebAssembly',{Suspending:function(){}});
        expect(await send(ids.hunyuan)).toMatchObject({success:true,backend:'webgpu'});
        expect(fake.engine.loadModel).toHaveBeenCalledWith(expect.any(Array),expect.objectContaining({n_gpu_layers:99}));
    });
    it.each([false,true])('handles Hunyuan GPU load failure and CPU fallback failure=%s',async(failFallback)=>{
        vi.stubGlobal('navigator',{gpu:{}});vi.stubGlobal('WebAssembly',{Suspending:function(){}});
        fake.engine.loadModel.mockRejectedValueOnce(new Error('GPU init'));
        fake.engine.exit.mockRejectedValue(new Error('cleanup failure'));
        if(failFallback)fake.engine.loadModel.mockRejectedValueOnce(new Error('CPU init'));
        expect(await send(ids.hunyuan)).toMatchObject(failFallback?{success:false,error:'CPU init'}:{success:true,backend:'wasm'});
        expect(fake.engine.loadModel).toHaveBeenCalledTimes(2);
    });
    it('preserves a Hunyuan CPU initialization error without retry',async()=>{
        fake.engine.loadModel.mockRejectedValueOnce(new Error('CPU init'));
        expect(await send(ids.hunyuan)).toMatchObject({success:false,error:'CPU init'});
        expect(fake.engine.loadModel).toHaveBeenCalledTimes(1);
    });
    it.each([{choices:[{finish_reason:'length'}]},{choices:[]},{choices:[{message:{}}]}])('rejects truncated or absent Hunyuan output %j',async(value)=>{
        fake.engine.createChatCompletion.mockResolvedValueOnce(value);
        expect(await send(ids.hunyuan)).toMatchObject({success:false});
    });

    it('continues the serial queue after transport posting itself throws',async()=>{
        post.mockImplementationOnce(()=>{throw new Error('transport failed');}).mockImplementationOnce(()=>{throw new Error('transport still failed');});
        listener({data:{requestId:1,type:'dispose'}});
        listener({data:{requestId:2,type:'dispose'}});
        await vi.waitFor(()=>expect(post).toHaveBeenCalledWith({requestId:2,success:true}));
    });
    it('supports legacy repository IDs and pipelines with no optional disposer',async()=>{
        delete (call as any).dispose;
        expect(await send('Xenova/m2m100_418M')).toMatchObject({success:true,backend:'wasm'});
        expect(fake.old).toHaveBeenCalledWith('translation','Xenova/m2m100_418M',expect.objectContaining({revision:'main'}));
        await send(ids.opusZhEn,'en','zh',2);
        expect(fake.dispose).not.toHaveBeenCalled();
    });


    it('reuses the baseline repository without allocating another pipeline',async()=>{
        await send(ids.opusZhEn);await send(ids.opusZhEn,'en','zh',2);expect(fake.old).toHaveBeenCalledTimes(1);
    });
    it('supports the baseline runtime without its optional WASM backend object',async()=>{
        fake.oldEnv.backends.onnx.wasm=undefined;
        const {startLocalTranslationWorker}=await import('@/src/features/local-translation/offscreen/translation.worker');startLocalTranslationWorker();
        expect(await send(ids.opusZhEn)).toMatchObject({success:true,backend:'wasm'});expect(fake.compressed).not.toHaveBeenCalled();
    });

});
