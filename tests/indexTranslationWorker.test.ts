import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const fake=vi.hoisted(()=>({index:vi.fn(),env:{backends:{onnx:{wasm:{}}}} as any}));
vi.mock('@huggingface/transformers',()=>({env:fake.env,pipeline:vi.fn(),InterruptableStoppingCriteria:class{}}));
vi.mock('@huggingface/transformers-kokoro',()=>({env:fake.env,MarianTokenizer:class{},AutoModelForSeq2SeqLM:{},TranslationPipeline:class{},InterruptableStoppingCriteria:class{}}));
vi.mock('@wllama/wllama/esm/index.js',()=>({Wllama:class{}}));
vi.mock('@/src/features/local-translation/offscreen/indexEngine',()=>({createIndexTranslator:fake.index}));
vi.mock('@/src/shared/onnx/wasmBinary',()=>({configureOnnxWasmBackend:vi.fn(),withCompressedWasmBinary:vi.fn()}));
import {LOCAL_TRANSLATION_MODEL_IDS as ids} from '@/src/core/config/localTranslation';
let listener:(event:any)=>void,post:ReturnType<typeof vi.fn>;
beforeEach(async()=>{
    vi.resetModules();vi.clearAllMocks();
    fake.index.mockReset().mockResolvedValue({translate:vi.fn().mockResolvedValue('Translated'),dispose:vi.fn()});
    post=vi.fn();
    vi.stubGlobal('self',{location:{href:'chrome-extension://test/localTranslationWorker.js'},setTimeout,clearTimeout,postMessage:post,addEventListener:(_type:string,handler:any)=>{listener=handler;}});
    const {startLocalTranslationWorker}=await import('@/src/features/local-translation/offscreen/translation.worker');
    startLocalTranslationWorker();
});
afterEach(()=>vi.unstubAllGlobals());
async function send(model:string,source='en',target='zh',requestId=1){
    listener({data:{requestId,type:'translate',model,text:'Hello.',sourceLanguage:source,targetLanguage:target}});
    await vi.waitFor(()=>expect(post).toHaveBeenCalledWith(expect.objectContaining({requestId})));
    return post.mock.calls.find(([data])=>data.requestId===requestId)![0];
}
describe('Index production Worker lifecycle',()=>{
    it('reuses and disposes Index translator and supplies empty default hints',async()=>{
        await send(ids.index);await send(ids.index,'en','zh',2);
        expect(fake.index).toHaveBeenCalledTimes(1);
        const instance=await fake.index.mock.results[0].value;
        expect(instance.translate).toHaveBeenCalledWith('Hello.','zh',{},expect.any(AbortSignal));
        listener({data:{requestId:3,type:'dispose'}});
        await vi.waitFor(()=>expect(post).toHaveBeenCalledWith({requestId:3,success:true}));
        expect(instance.dispose).toHaveBeenCalledTimes(1);
    });
    it('clears failed Index instance and supports a later request with hints',async()=>{
        fake.index.mockResolvedValueOnce({translate:vi.fn().mockRejectedValue(new Error('index failed'))});
        expect(await send(ids.index)).toMatchObject({success:false,error:'index failed'});
        listener({data:{requestId:2,type:'translate',model:ids.index,text:'Hello.',sourceLanguage:'en',targetLanguage:'zh',hints:{context:'test'}}});
        await vi.waitFor(()=>expect(post).toHaveBeenCalledWith(expect.objectContaining({requestId:2,success:true})));
        expect(fake.index).toHaveBeenCalledTimes(2);
    });
    it('passes an aborted deadline to Index and clears the timer',async()=>{
        self.setTimeout=((fn:any)=>{fn();return 1;}) as any;
        await send(ids.index);const instance=await fake.index.mock.results[0].value;
        expect(instance.translate.mock.calls[0][3].aborted).toBe(true);
    });
    it('clears an Index translator that throws before returning a Promise',async()=>{
        fake.index.mockResolvedValueOnce({translate:vi.fn(()=>{throw new Error('synchronous index failure');})});
        expect(await send(ids.index)).toMatchObject({success:false,error:'synchronous index failure'});
        expect(await send(ids.index,'en','zh',2)).toMatchObject({success:true});
        expect(fake.index).toHaveBeenCalledTimes(2);
    });
});
