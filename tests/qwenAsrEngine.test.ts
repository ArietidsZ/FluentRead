import {beforeEach,describe,expect,it,vi} from 'vitest';
import {Tokenizer} from '@huggingface/tokenizers';
const mocks=vi.hoisted(()=>({create:vi.fn(),tensors:[] as any[],config:{embedding:{file:'emb',scales_file:'scales',shape:[8,2]},decoder:{hidden_size:2,vocab_size:8},prompt:{prefix_ids:[1],suffix_ids:[2],asr_text_id:4,eos_ids:[0],max_new_tokens:3},language_prefix_ids:{en:[3,4]},variants:{q4:{encoder:'encoder',decoder_init:'init',decoder_step:'step',weights:'weights'},q4f16:{encoder:'encoder',decoder_init:'init',decoder_step:'step',weights:'weights'}}}}));
vi.mock('@/src/features/video-subtitle/offscreen/qwen/model',()=>({QWEN_PROMPT:mocks.config}));
vi.mock('onnxruntime-web-qwen/webgpu',()=>({InferenceSession:{create:mocks.create},Tensor:class{type:string;data:any;dims:number[];dispose=vi.fn();constructor(type:string,data:any,dims:number[]){this.type=type;this.data=data;this.dims=dims;mocks.tensors.push(this);}}}));
import {createQwenAsrEngine} from '@/src/features/video-subtitle/offscreen/qwen/engine';
const tensor=(data:Float32Array,dims:number[])=>({data,dims,type:'float32',dispose:vi.fn()});
function logits(token:number){const data=new Float32Array(8).fill(-10);data[token]=10;return tensor(data,[1,1,8]);}
function outputs(token:number){return {logits:logits(token),present_keys:{location:'gpu-buffer',dispose:vi.fn()},present_values:{location:'gpu-buffer',dispose:vi.fn()}};}
function setup(fp16=false){
    const encoded={audio_features:tensor(new Float32Array([10,11,12,13]),[1,2,2])};
    const encoder={inputNames:['mel'],inputMetadata:[{type:'float32'}],run:vi.fn(async(_feeds:Record<string,any>)=>encoded),release:vi.fn(async()=>{})};
    const first=outputs(5),last=outputs(0);
    const init={inputNames:['input_embeds','position_ids'],inputMetadata:[{type:fp16?'float16':'float32'},{type:'int64'}],run:vi.fn(async(_feeds:Record<string,any>)=>first),release:vi.fn(async()=>{})};
    const step={...init,run:vi.fn(async(_feeds:Record<string,any>)=>last),release:vi.fn(async()=>{})};
    mocks.create.mockResolvedValueOnce(encoder).mockResolvedValueOnce(init).mockResolvedValueOnce(step);
    const read=vi.fn(async(path:string)=>path==='emb'?new Int8Array(16).fill(1).buffer:path==='scales'?new Float32Array(8).fill(.5).buffer:new ArrayBuffer(1));
    const frontend=vi.fn(async():Promise<{data:Float32Array;frames:number}>=>({data:new Float32Array(256),frames:2})),decode=vi.fn((ids:number[])=>ids.join(','));
    return {encoder,init,step,encoded,first,last,input:{variant:fp16?'q4f16' as const:'q4' as const,read,frontend,decode}};
}
function nativeTokenizer() {
    return new Tokenizer({
        version: '1.0', truncation: null, padding: null, normalizer: null,
        pre_tokenizer: null, post_processor: null, added_tokens: [], decoder: {type: 'Fuse'},
        model: {type: 'Unigram', unk_id: 7, byte_fallback: false,
            vocab: ['<eos>', '1', '2', '3', '<asr>', '5', '6', '<unk>'].map(token => [token, 0])},
    }, {tokenizer_class: 'PreTrainedTokenizer', eos_token: '<eos>', unk_token: '<unk>'});
}
beforeEach(()=>{vi.clearAllMocks();mocks.create.mockReset();mocks.tensors=[];});
describe('Qwen WebGPU engine contract',()=>{
    it('uses the installed tokenizer empty-array contract rather than an array-join substitute', () => {
        const tokenizer = nativeTokenizer();
        expect(() => tokenizer.decode([], {skip_special_tokens: true}))
            .toThrow('token_ids must be a non-empty array of integers.');
        expect(tokenizer.decode([5], {skip_special_tokens: true})).toBe('5');
    });
    it.each([
        {name: 'immediate EOS', first: 0, text: ''},
        {name: 'control marker followed by EOS', first: 4, text: ''},
        {name: 'ordinary text followed by EOS', first: 5, text: '5'},
    ])('handles $name with the native tokenizer and retains a reusable engine', async ({first, text}) => {
        const data = setup(), tokenizer = nativeTokenizer(), decode = vi.spyOn(tokenizer, 'decode');
        data.input.decode = vi.fn(ids => tokenizer.decode(ids, {skip_special_tokens: true}));
        data.init.run.mockResolvedValueOnce(outputs(first));
        if (first !== 0) data.step.run.mockResolvedValueOnce(outputs(0));
        const engine = await createQwenAsrEngine(data.input);
        try {
            expect(await engine.transcribe(new Float32Array(400), 'en')).toBe(text);
            if (text) expect(decode).toHaveBeenCalledWith([5], {skip_special_tokens: true});
            else expect(decode).not.toHaveBeenCalled();
            data.init.run.mockResolvedValueOnce(outputs(5));
            data.step.run.mockResolvedValueOnce(outputs(0));
            expect(await engine.transcribe(new Float32Array(400), 'en')).toBe('5');
            expect(mocks.create).toHaveBeenCalledTimes(3);
        } finally { await engine.dispose(); }
        for (const session of [data.encoder, data.init, data.step]) expect(session.release).toHaveBeenCalledOnce();
    });

    it.each([false,true])('uses actual decoder precision=%s and keeps KV on GPU between prefill and step',async fp16=>{
        const data=setup(fp16),engine=await createQwenAsrEngine(data.input);
        expect(await engine.transcribe(new Float32Array(400),'en-US')).toBe('5');
        expect(data.init.run.mock.calls[0][0].input_embeds.dims).toEqual([1,6,2]);
        expect(data.init.run.mock.calls[0][0].input_embeds.type).toBe(fp16?'float16':'float32');
        expect(data.step.run.mock.calls[0][0].past_keys).toBe(data.first.present_keys);
        expect(data.step.run.mock.calls[0][0].position_ids.data).toEqual(new BigInt64Array([6n]));
        for(const value of Object.values(data.first))expect(value.dispose).toHaveBeenCalledOnce();
        for(const value of Object.values(data.last))expect(value.dispose).toHaveBeenCalledOnce();
        expect(mocks.create.mock.calls.every(call=>call[1].executionProviders.join()==='webgpu')).toBe(true);
        expect(mocks.create.mock.calls[1][1].externalData).toBe(mocks.create.mock.calls[2][1].externalData);
        await engine.dispose();await engine.dispose();expect(data.encoder.release).toHaveBeenCalledOnce();expect(data.init.release).toHaveBeenCalledOnce();expect(data.step.release).toHaveBeenCalledOnce();
        await expect(engine.transcribe(new Float32Array(400),'en')).rejects.toThrow('已失效');
    });
    it('uses auto mode for unknown language and allows an immediate EOS without invented words',async()=>{
        const data=setup();data.init.run.mockResolvedValueOnce(outputs(0));const engine=await createQwenAsrEngine(data.input);
        expect(await engine.transcribe(new Float32Array(400),'unknown')).toBe('');
        expect(data.init.run.mock.calls[0][0].input_embeds.dims).toEqual([1,4,2]);expect(data.step.run).not.toHaveBeenCalled();await engine.dispose();
    });
    it('limits generation, rejects reuse after failure, and releases every output',async()=>{
        const data=setup();data.step.run.mockImplementation(async()=>outputs(5));const engine=await createQwenAsrEngine(data.input);
        await expect(engine.transcribe(new Float32Array(400),undefined)).rejects.toThrow('长度上限');
        await expect(engine.transcribe(new Float32Array(400),undefined)).rejects.toThrow('已失效');
        expect(data.step.run).toHaveBeenCalledTimes(2);await engine.dispose();
    });
    it('GPU device loss never creates a CPU session and releases partial results',async()=>{
        const data=setup();data.step.run.mockRejectedValueOnce(new Error('device lost'));const engine=await createQwenAsrEngine(data.input);
        await expect(engine.transcribe(new Float32Array(400),'en')).rejects.toThrow('device lost');
        expect(data.first.present_keys.dispose).toHaveBeenCalledOnce();expect(mocks.create).toHaveBeenCalledTimes(3);await engine.dispose();
    });
    it('cleans all initialized sessions on initialization errors without masking the original',async()=>{
        const data=setup();mocks.create.mockReset().mockResolvedValueOnce(data.encoder).mockRejectedValueOnce(new Error('GPU init'));
        data.encoder.release.mockRejectedValueOnce(new Error('release'));await expect(createQwenAsrEngine(data.input)).rejects.toThrow('GPU init');expect(data.encoder.release).toHaveBeenCalledOnce();
    });
    it('checks cancel before allocation and after awaited GPU work',async()=>{
        const data=setup(),abort=new AbortController();abort.abort();await expect(createQwenAsrEngine(data.input,abort.signal)).rejects.toMatchObject({name:'AbortError'});expect(mocks.create).not.toHaveBeenCalled();
        const engine=await createQwenAsrEngine(data.input),running=new AbortController();data.encoder.run.mockImplementationOnce(async()=>{running.abort();return data.encoded;});
        await expect(engine.transcribe(new Float32Array(400),'en',running.signal)).rejects.toMatchObject({name:'AbortError'});expect(data.encoded.audio_features.dispose).toHaveBeenCalledOnce();await engine.dispose();
    });
    it('rejects concurrent input without corrupting the active request',async()=>{
        const data=setup();let resume!:(value:{data:Float32Array;frames:number})=>void;data.input.frontend.mockImplementationOnce(()=>new Promise(resolve=>{resume=resolve;}));
        const engine=await createQwenAsrEngine(data.input),first=engine.transcribe(new Float32Array(400),'en');
        await expect(engine.transcribe(new Float32Array(400),'en')).rejects.toThrow('另一个窗口');resume({data:new Float32Array(256),frames:2});expect(await first).toBe('5');await engine.dispose();
    });
    it.each(['embedding','scale','encoder-type','missing-metadata','non-tensor-metadata','decoder-type'])('rejects a mismatched pinned model contract: %s',async failure=>{
        const data=setup();
        if(failure==='embedding'||failure==='scale')data.input.read.mockImplementation(async path=>path==='emb'?new Int8Array(failure==='embedding'?1:16).buffer:path==='scales'?new Float32Array(failure==='scale'?1:8).buffer:new ArrayBuffer(1));
        if(failure==='encoder-type')data.encoder.inputMetadata[0].type='float16';
        if(failure==='missing-metadata')data.encoder.inputMetadata=[];
        if(failure==='non-tensor-metadata')data.encoder.inputMetadata=[{} as any];
        if(failure==='decoder-type')data.init.inputMetadata[0].type='int64';
        await expect(createQwenAsrEngine(data.input)).rejects.toThrow(failure==='embedding'||failure==='scale'?'文件大小':'契约');
    });
    it.each(['type','batch','hidden','logits'])('rejects malformed inference output %s without returning text',async failure=>{
        const data=setup();
        if(failure==='type')data.encoded.audio_features.type='float16';
        if(failure==='batch')data.encoded.audio_features.dims[0]=2;
        if(failure==='hidden')data.encoded.audio_features.dims[2]=3;
        if(failure==='logits')data.first.logits.data=new Float32Array(1);
        const engine=await createQwenAsrEngine(data.input);
        await expect(engine.transcribe(new Float32Array(400),'en')).rejects.toThrow(failure==='logits'?'logits':'输出契约');await engine.dispose();
    });
    it('finishes cleanup when a released GPU tensor throws, without hiding device loss',async()=>{
        const data=setup();data.first.present_keys.dispose.mockImplementation(()=>{throw new Error('already lost');});data.step.run.mockRejectedValueOnce(new Error('device lost'));
        const engine=await createQwenAsrEngine(data.input);await expect(engine.transcribe(new Float32Array(400),'en')).rejects.toThrow('device lost');expect(data.first.present_values.dispose).toHaveBeenCalledOnce();await engine.dispose();
    });

});
