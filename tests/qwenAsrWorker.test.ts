import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({gpu:vi.fn(),cache:vi.fn(),read:vi.fn(),frontend:vi.fn(),engine:vi.fn(),transcribe:vi.fn(),dispose:vi.fn(),wasm:{},config:vi.fn(),binary:vi.fn(async(_env:unknown,_url:unknown,create:()=>Promise<unknown>)=>create())}));
vi.mock('@huggingface/tokenizers',()=>({Tokenizer:class{decode(){return 'decoded';}}}));
vi.mock('onnxruntime-web-qwen/webgpu',()=>({env:{wasm:mocks.wasm}}));
vi.mock('@/src/shared/onnx/webgpu',()=>({probeWebGpu:mocks.gpu}));
vi.mock('@/src/shared/onnx/wasmBinary',()=>({configureOnnxWasmBackend:mocks.config,withCompressedWasmBinary:mocks.binary}));
vi.mock('@/src/features/video-subtitle/offscreen/qwen/cache',()=>({cacheQwenAsrFiles:mocks.cache,readQwenAsrFile:mocks.read}));
vi.mock('@/src/features/video-subtitle/offscreen/qwen/audio',()=>({createQwenAudioFrontend:mocks.frontend}));
vi.mock('@/src/features/video-subtitle/offscreen/qwen/engine',()=>({createQwenAsrEngine:mocks.engine}));
let target:EventTarget&{postMessage:ReturnType<typeof vi.fn>;location:{href:string}};
const tick=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
const send=async(data:unknown)=>{target.dispatchEvent(new MessageEvent('message',{data}));await tick();return target.postMessage.mock.calls.at(-1)?.[0];};
beforeEach(async()=>{
    vi.resetModules();vi.clearAllMocks();mocks.gpu.mockResolvedValue({available:true,info:'hardware',features:['shader-f16']});mocks.read.mockResolvedValue(new TextEncoder().encode('{}').buffer);mocks.cache.mockResolvedValue(undefined);mocks.dispose.mockResolvedValue(undefined);mocks.transcribe.mockResolvedValue('Hello world');mocks.engine.mockResolvedValue({transcribe:mocks.transcribe,dispose:mocks.dispose});
    target=Object.assign(new EventTarget(),{postMessage:vi.fn(),location:{href:'chrome-extension://test/qwenAsrWorker.js'}});vi.stubGlobal('self',target);
    const {startQwenAsrWorker}=await import('@/src/features/video-subtitle/offscreen/qwen/worker');startQwenAsrWorker();
});
afterEach(()=>vi.unstubAllGlobals());
describe('Qwen worker message contract',()=>{
    it('prepares once, selects shader-f16, reuses sessions and returns window-level timing',async()=>{
        expect(await send({requestId:1,type:'prepare'})).toMatchObject({success:true,dtype:'q4f16',backend:'webgpu'});
        const audio=new Float32Array(16000).fill(.1),response=await send({requestId:2,type:'transcribe',audio,sourceLanguage:'en'});
        expect(response).toMatchObject({success:true,text:'Hello world',timestampSource:'window',audioDurationMs:1000,segments:[{startMs:0,endMs:1000,text:'Hello world'}]});
        expect(mocks.cache).not.toHaveBeenCalled();expect(mocks.engine).toHaveBeenCalledOnce();expect(mocks.engine.mock.calls[0][0].decode([1])).toBe('decoded');
        await send({requestId:3,type:'dispose'});expect(mocks.dispose).toHaveBeenCalledOnce();
        await send({requestId:4,type:'dispose'});expect(mocks.dispose).toHaveBeenCalledOnce();
    });
    it('uses Q4 when shader-f16 is absent and no CPU fallback when GPU is unavailable',async()=>{
        mocks.gpu.mockResolvedValueOnce({available:false,info:''});expect(await send({requestId:1,type:'prepare'})).toMatchObject({success:false,error:expect.stringContaining('WebGPU')});expect(mocks.cache).not.toHaveBeenCalled();
        mocks.gpu.mockResolvedValueOnce({available:true,info:''});expect(await send({requestId:2,type:'prepare'})).toMatchObject({success:true,dtype:'q4'});
        expect(await send({requestId:3,type:'prepare',device:'wasm'})).toMatchObject({success:false,error:expect.stringContaining('CPU')});expect(mocks.engine).toHaveBeenCalledOnce();
    });
    it('skips short or digitally silent audio before model allocation; rejects invalid and oversized inputs',async()=>{
        for(const audio of [new Float32Array(),new Float32Array(100),new Float32Array(16000)])expect(await send({requestId:1,type:'transcribe',audio})).toMatchObject({success:true,skipped:true,text:'',segments:[]});
        expect(mocks.engine).not.toHaveBeenCalled();
        for(const audio of [undefined,[],new Float32Array([NaN]),new Float32Array(480001)])expect(await send({requestId:2,type:'transcribe',audio})).toMatchObject({success:false,error:expect.stringContaining('音频无效')});
    });
    it('does not invent segments for EOS; tears down a failed GPU engine and supports an explicit retry',async()=>{
        const audio=new Float32Array(400).fill(.1);mocks.transcribe.mockResolvedValueOnce('');
        expect(await send({requestId:1,type:'transcribe',audio})).toMatchObject({success:true,text:'',segments:[]});
        mocks.transcribe.mockRejectedValueOnce('device lost');mocks.dispose.mockRejectedValueOnce(new Error('cleanup failed'));
        expect(await send({requestId:2,type:'transcribe',audio})).toMatchObject({success:false,error:'device lost'});
        expect(await send({requestId:3,type:'transcribe',audio})).toMatchObject({success:true,text:'Hello world'});expect(mocks.engine).toHaveBeenCalledTimes(2);
    });
    it('ignores unaddressable messages and reports unsupported operations',async()=>{
        await send(null);await send({requestId:'wrong',type:'prepare'});expect(target.postMessage).not.toHaveBeenCalled();
        expect(await send({requestId:1,type:'unknown'})).toMatchObject({success:false,error:expect.stringContaining('请求无效')});
    });
});
