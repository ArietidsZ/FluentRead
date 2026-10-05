/**
 * @file tests/localTtsWorker.test.ts
 * 文件职责：验证本地 TTS Worker 的 WebGPU 优先、WASM 回退、流式失败恢复和生命周期锁定。
 * 主要内容：用假 Kokoro 模型驱动真实 Worker 消息队列，不加载模型文件或启动浏览器 Worker。
 * 模块边界：只覆盖 tts.worker.ts 的设备选择、模型释放、音频重试和错误边界。
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    probeWebGpu: vi.fn(),
    fromPretrained: vi.fn(),
}));

vi.mock('@uzen/kokoro-js', () => ({
    KokoroTTS: class {static from_pretrained=mocks.fromPretrained;constructor(model:any,tokenizer:any){model.fixtureOwner.tokenizer=tokenizer;return model.fixtureOwner;}},
    TextSplitterStream: class {text='';push(text:string){this.text+=text;}close(){}async *[Symbol.asyncIterator](){yield this.text;}},
    env: {wasmPaths: {}},
}));

vi.mock('@huggingface/transformers-kokoro', () => ({
    env: {
        allowLocalModels: false,
        allowRemoteModels: true,
        useBrowserCache: true,
        useWasmCache: false,
        fetch: globalThis.fetch,
        backends: {onnx: {wasm: {}}},
    },
}));

vi.mock('@/src/shared/onnx/wasmBinary', () => ({
    configureOnnxWasmBackend: vi.fn(),
    withCompressedWasmBinary: vi.fn(async (_backend: unknown, _url: string, initialize: () => Promise<unknown>) => initialize()),
}));

vi.mock('@/src/shared/onnx/webgpu', () => ({probeWebGpu: mocks.probeWebGpu}));

type FakeModel = {
    stream: ReturnType<typeof vi.fn>;
    model: {dispose: ReturnType<typeof vi.fn>;fixtureOwner?:FakeModel};
    tokenizer: any;
    generate: any;
};

type WorkerScope = {
    location: {href: string};
    onmessage?: (event: MessageEvent) => void;
    postMessage: ReturnType<typeof vi.fn>;
};

const originalFetch = globalThis.fetch;

function modelFrom(stream: () => AsyncGenerator<unknown>, dispose = vi.fn()): FakeModel {
    const model: FakeModel = {
        stream: vi.fn(stream),
        generate: undefined,
        tokenizer: vi.fn(()=>({input_ids:{dims:[1,4]}})),
        model: {dispose},
    };
    model.model.fixtureOwner=model;
    model.generate=vi.fn(async(text:string,options:any)=>{
        const chunks:Float32Array[]=[];let sampling_rate=24000;
        for await(const item of model.stream(text,options) as AsyncGenerator<any>){
            for(const chunk of item.audio.audio instanceof Float32Array?[item.audio.audio]:item.audio.audio)chunks.push(chunk.slice());
            sampling_rate=item.audio.sampling_rate;
        }
        return {audio:chunks,sampling_rate};
    });
    return model;
}

async function* audioChunks(samples: number[], samplingRate = 24_000): AsyncGenerator<unknown> {
    yield {audio: {audio: new Float32Array(samples), sampling_rate: samplingRate}};
}

async function* audioThenError(): AsyncGenerator<unknown> {
    yield {audio: {audio: new Float32Array([1]), sampling_rate: 24_000}};
    throw new Error('webgpu stream failed');
}

async function* errorStream(): AsyncGenerator<unknown> {
    throw new Error('cpu stream failed');
}

function scope(): WorkerScope {
    const value: WorkerScope = {
        location: {href: 'chrome-extension://test/offscreen.html'},
        postMessage: vi.fn(),
    };
    (globalThis as unknown as {self: WorkerScope}).self = value;
    return value;
}

async function start() {
    vi.resetModules();
    const workerScope = scope();
    const worker = await import('@/src/features/local-tts/offscreen/tts.worker');
    worker.startLocalTtsWorker();
    return workerScope;
}

async function send(workerScope: WorkerScope, request: Record<string, unknown>, messageCount: number) {
    workerScope.onmessage?.({data: {execution:'compatible',...request}} as MessageEvent);
    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(messageCount));
    return workerScope.postMessage.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

beforeEach(() => {
    mocks.probeWebGpu.mockReset();
    mocks.probeWebGpu.mockResolvedValue({available: true, info: 'test-gpu'});
    mocks.fromPretrained.mockReset();
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
    delete (globalThis as unknown as {self?: WorkerScope}).self;
});

describe('local TTS worker device fallback', () => {
    it('prefers WebGPU and reports initialization failure for a fresh CPU worker', async () => {
        mocks.fromPretrained.mockRejectedValueOnce(new Error('webgpu init failed'));
        const workerScope = await start();

        const response = await send(workerScope, {requestId: 1, type: 'prepare'}, 1);
        expect(response).toMatchObject({requestId: 1, success: false, retryWithCpu: true});
        expect(response.error).toBe('webgpu init failed');
        expect(mocks.fromPretrained.mock.calls.map(([_, options]) => options.device)).toEqual(['webgpu']);
        expect(mocks.probeWebGpu).toHaveBeenCalledOnce();
        expect(mocks.fromPretrained).toHaveBeenCalledOnce();
    });

    it('discards partial GPU audio, releases the GPU model, and reports a fresh CPU retry hint', async () => {
        const gpuDispose = vi.fn();
        const gpuModel = modelFrom(audioThenError, gpuDispose);
        mocks.fromPretrained.mockResolvedValueOnce(gpuModel);
        const workerScope = await start();

        const response = await send(workerScope, {
            requestId: 3,
            type: 'synthesize',
            text: 'first sentence. second sentence.',
            voice: 'zf_001',
            speed: 1,
        }, 1);

        expect(response).toMatchObject({requestId: 3, success: false, retryWithCpu: true});
        expect(gpuModel.stream).toHaveBeenCalledOnce();
        expect(gpuModel.stream.mock.calls[0][0]).toBe('first sentence. second sentence.');
        expect(gpuDispose).toHaveBeenCalledOnce();
        expect(mocks.fromPretrained).toHaveBeenCalledOnce();

        const wasmModel = modelFrom(() => audioChunks([0.5]));
        mocks.fromPretrained.mockReset().mockResolvedValue(wasmModel);
        const cpuWorkerScope = await start();
        const recovered = await send(cpuWorkerScope, {
            requestId: 4,
            type: 'synthesize',
            device: 'wasm',
            text: 'first sentence. second sentence.',
            voice: 'zf_001',
            speed: 1,
        }, 1);
        expect(recovered).toMatchObject({requestId: 4, success: true, backend: 'wasm'});
        expect(wasmModel.stream).toHaveBeenCalledOnce();
        expect(wasmModel.stream.mock.calls[0][0]).toBe('first sentence. second sentence.');
    });

    it('treats NaN GPU audio as an inference failure and reports a fresh CPU retry hint', async () => {
        const gpuDispose = vi.fn();
        const gpuModel = modelFrom(() => audioChunks([Number.NaN]), gpuDispose);
        mocks.fromPretrained.mockResolvedValueOnce(gpuModel);
        const workerScope = await start();

        const response = await send(workerScope, {requestId: 10, type: 'synthesize', text: 'NaN audio'}, 1);
        expect(response).toMatchObject({requestId: 10, success: false, retryWithCpu: true});
        expect(response.error).toContain('本地 TTS 生成了无效音频');
        expect(gpuDispose).toHaveBeenCalledOnce();
        expect(gpuModel.stream).toHaveBeenCalledOnce();
        expect(mocks.fromPretrained).toHaveBeenCalledOnce();
    });

    it('rejects silent CPU audio without retrying or emitting a WAV', async () => {
        mocks.probeWebGpu.mockResolvedValue({available: false, info: ''});
        const cpuModel = modelFrom(() => audioChunks([0, -0, 0]));
        mocks.fromPretrained.mockResolvedValue(cpuModel);
        const workerScope = await start();

        const response = await send(workerScope, {requestId: 11, type: 'synthesize', text: 'silent audio'}, 1);
        expect(response).toMatchObject({requestId: 11, success: false, error: '本地 TTS 生成了静音音频'});
        expect(cpuModel.stream).toHaveBeenCalledOnce();
        expect(mocks.fromPretrained).toHaveBeenCalledOnce();
    });

    it('rejects non-finite CPU audio without retrying', async () => {
        mocks.probeWebGpu.mockResolvedValue({available: false, info: ''});
        const cpuModel = modelFrom(() => audioChunks([Number.NaN, 0.2]));
        mocks.fromPretrained.mockResolvedValue(cpuModel);
        const workerScope = await start();

        const response = await send(workerScope, {requestId: 12, type: 'synthesize', text: 'invalid audio'}, 1);
        expect(response).toMatchObject({requestId: 12, success: false});
        expect(response.error).toContain('本地 TTS 生成了无效音频');
        expect(cpuModel.stream).toHaveBeenCalledOnce();
        expect(mocks.fromPretrained).toHaveBeenCalledOnce();
    });

    it('does not retry a pure CPU stream error or damage the serial queue', async () => {
        mocks.probeWebGpu.mockResolvedValue({available: false, info: ''});
        const cpuModel = modelFrom(errorStream);
        mocks.fromPretrained.mockResolvedValue(cpuModel);
        const workerScope = await start();

        const failed = await send(workerScope, {requestId: 5, type: 'synthesize', text: 'CPU only'}, 1);
        expect(failed).toMatchObject({requestId: 5, success: false, error: 'cpu stream failed'});
        expect(cpuModel.stream).toHaveBeenCalledOnce();
        expect(mocks.fromPretrained).toHaveBeenCalledOnce();

        const prepared = await send(workerScope, {requestId: 6, type: 'prepare'}, 2);
        expect(prepared).toMatchObject({requestId: 6, success: true, backend: 'wasm'});
    });

    it('honors an internal WASM request by releasing GPU and locking the worker to CPU', async () => {
        const gpuDispose = vi.fn();
        const gpuModel = modelFrom(() => audioChunks([0.1]), gpuDispose);
        const wasmModel = modelFrom(() => audioChunks([0.2]));
        mocks.fromPretrained
            .mockResolvedValueOnce(gpuModel)
            .mockResolvedValueOnce(wasmModel);
        const workerScope = await start();

        await send(workerScope, {requestId: 7, type: 'prepare'}, 1);
        const forced = await send(workerScope, {requestId: 8, type: 'prepare', device: 'wasm'}, 2);
        expect(forced).toMatchObject({requestId: 8, success: true, backend: 'wasm'});
        expect(gpuDispose).toHaveBeenCalledOnce();

        await send(workerScope, {requestId: 9, type: 'prepare'}, 3);
        expect(mocks.fromPretrained.mock.calls.map(([_, options]) => options.device)).toEqual(['webgpu', 'wasm']);
    });
});

describe('TTS chunk WAV assembly',()=>{
    it('matches baseline PCM bytes across seeded chunks, empty chunks and subarrays without a merged float buffer',async()=>{
        let seed=42;
        const samples=Float32Array.from({length:240_000},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed/0xffffffff)*3-1.5;});
        const parts=[samples.subarray(0,11),new Float32Array(),samples.subarray(11,901),samples.subarray(901)];
        mocks.fromPretrained.mockResolvedValue(modelFrom(async function*(){yield {audio:{audio:parts,sampling_rate:24000}};}));
        const workerScope=await start(),result=await send(workerScope,{requestId:80,type:'synthesize',text:'seeded test'},1);
        expect(result.success).toBe(true);
        const wav=new DataView(result.audio as ArrayBuffer);expect(wav.byteLength).toBe(44+samples.length*2);expect(wav.getUint32(40,true)).toBe(samples.length*2);
        const expected=new Uint8Array(samples.length*2),view=new DataView(expected.buffer);
        for(let i=0;i<samples.length;i++){const x=Math.max(-1,Math.min(1,samples[i]));view.setInt16(i*2,x<0?Math.round(x*32768):Math.round(x*32767),true);}
        expect(new Uint8Array(result.audio as ArrayBuffer,44)).toEqual(expected);
        expect(wav.getUint32(24,true)).toBe(24000);
    });
    it('snapshots reused model output before the next chunk mutates it',async()=>{
        const shared=new Float32Array([0.5,-0.5]);let calls=0;
        const model=modelFrom(()=>audioChunks([0.5]));
        model.model.fixtureOwner=model;
    model.generate=vi.fn(async()=>{if(calls++)shared.fill(1);return {audio:shared,sampling_rate:24000};});
        mocks.fromPretrained.mockResolvedValue(model);
        const result=await send(await start(),{requestId:81,type:'synthesize',text:'word '.repeat(40)},1),view=new DataView(result.audio as ArrayBuffer);
        expect(model.generate).toHaveBeenCalledTimes(2);
        expect([0,1,2,3].map(i=>view.getInt16(44+i*2,true))).toEqual([16384,-16384,32767,32767]);
    });
});

describe('explicit local speech GPU policy',()=>{
    it('defaults to GPU and rejects unavailable hardware before model initialization',async()=>{
        mocks.probeWebGpu.mockResolvedValue({available:false});
        const result=await send(await start(),{requestId:90,type:'synthesize',text:'hello',execution:undefined},1);
        expect(result).toMatchObject({success:false});expect(result.error).toContain('硬件 GPU');expect(result).not.toHaveProperty('retryWithCpu');expect(mocks.fromPretrained).not.toHaveBeenCalled();
    });
    it('does not request a CPU retry after GPU initialization or inference failure',async()=>{
        mocks.fromPretrained.mockRejectedValue(new Error('GPU init'));
        let result=await send(await start(),{requestId:91,type:'prepare',execution:'gpu'},1);
        expect(result).toMatchObject({success:false,error:'GPU init'});expect(result).not.toHaveProperty('retryWithCpu');
        mocks.fromPretrained.mockResolvedValue(modelFrom(audioThenError));
        result=await send(await start(),{requestId:92,type:'synthesize',text:'hello',execution:'gpu'},1);
        expect(result).toMatchObject({success:false,error:'webgpu stream failed'});expect(result).not.toHaveProperty('retryWithCpu');
        expect(mocks.fromPretrained.mock.calls.every(([,options])=>options.device==='webgpu')).toBe(true);
    });
    it('rejects an explicit CPU device and a cached compatibility CPU session in GPU mode',async()=>{
        mocks.probeWebGpu.mockResolvedValue({available:false});mocks.fromPretrained.mockResolvedValue(modelFrom(()=>audioChunks([0.5])));
        const workerScope=await start();
        expect(await send(workerScope,{requestId:93,type:'prepare',execution:'gpu',device:'wasm'},1)).toMatchObject({success:false});
        expect(await send(workerScope,{requestId:94,type:'prepare',execution:'compatible'},2)).toMatchObject({success:true,backend:'wasm'});
        expect(await send(workerScope,{requestId:95,type:'prepare',execution:'gpu'},3)).toMatchObject({success:false});
        expect(mocks.fromPretrained).toHaveBeenCalledOnce();
    });
});

describe('TTS offline runtime boundaries',()=>{
    it('serves model aliases and pinned voices only from cache, with native fetch reserved for runtime assets',async()=>{
        const nativeFetch=vi.fn(async()=>new Response('runtime'));vi.stubGlobal('fetch',nativeFetch);
        mocks.fromPretrained.mockResolvedValue(modelFrom(()=>audioChunks([0.5])));
        const workerScope=await start();await send(workerScope,{requestId:100,type:'prepare',execution:'gpu'},1);
        const {env}=await import('@huggingface/transformers-kokoro');
        const prefix='https://huggingface.co/onnx-community/Kokoro-82M-v1.1-zh-ONNX/resolve/',revision='6cc0f0d2ebe369a68b0df87c2b65c1af8c0ac3e3';
        vi.stubGlobal('caches',undefined);await expect(env.fetch(prefix+'main/config.json')).rejects.toThrow('缓存不可用');
        const match=vi.fn(async(url:string)=>url.includes('/'+revision+'/')?new Response('pinned',{headers:{'X-FluentRead-Model-Source':url}}):undefined),open=vi.fn(async()=>({match}));vi.stubGlobal('caches',{open});
        expect(await (await env.fetch(prefix+'main/config.json')).text()).toBe('pinned');
        expect(await (await env.fetch(new URL(prefix+revision+'/config.json'))).text()).toBe('pinned');
        expect(await (await globalThis.fetch(new Request(prefix+revision+'/voices/zf_001.bin'))).text()).toBe('pinned');expect(open).toHaveBeenCalledWith('kokoro-voices');
        match.mockResolvedValue(undefined);await expect(env.fetch(prefix+'other/config.json')).rejects.toThrow('缺少模型文件');await expect(env.fetch(prefix+'main/config.json')).rejects.toThrow('缺少模型文件');
        expect(await (await env.fetch('https://extension.test/runtime.wasm')).text()).toBe('runtime');expect(nativeFetch).toHaveBeenCalledOnce();
    });
    it('handles invalid messages, blank text, default voice/speed and disposal failures',async()=>{
        const dispose=vi.fn(()=>{throw new Error('release failed');});const model=modelFrom(()=>audioChunks([0.5]),dispose);mocks.fromPretrained.mockResolvedValue(model);
        vi.stubGlobal('chrome',{runtime:{getURL:(path:string)=>'https://extension.test/'+path}});
        const workerScope=await start();workerScope.onmessage?.({data:null} as any);workerScope.onmessage?.({data:{requestId:'x',type:'synthesize'}} as any);workerScope.onmessage?.({data:{requestId:2,type:'unknown'}} as any);expect(workerScope.postMessage).not.toHaveBeenCalled();
        expect(await send(workerScope,{requestId:101,type:'synthesize',text:' '},1)).toMatchObject({success:false});
        expect(await send(workerScope,{requestId:102,type:'synthesize',text:'hello',voice:'',speed:NaN},2)).toMatchObject({success:true});expect(model.stream.mock.calls[0][1]).toMatchObject({voice:'zf_001',speed:1});
        expect(await send(workerScope,{requestId:103,type:'dispose'},3)).toMatchObject({success:true});expect(dispose).toHaveBeenCalledOnce();
        expect(await send(workerScope,{requestId:104,type:'dispose'},4)).toMatchObject({success:true});
    });
    it('normalizes a non-Error backend rejection and can initialize without optional wasm configuration',async()=>{
        const {env}=await import('@huggingface/transformers-kokoro');const wasm=env.backends.onnx.wasm;Object.assign(env.backends.onnx, {wasm: undefined});
        mocks.fromPretrained.mockRejectedValue('native failure');
        try{expect(await send(await start(),{requestId:105,type:'prepare'},1)).toMatchObject({success:false,error:'native failure',retryWithCpu:true});}finally{Object.assign(env.backends.onnx, {wasm});}
    });
});

describe('complete long-text synthesis',()=>{
    it('subdivides phoneme overflow before inference and retains the ending of unspaced Chinese',async()=>{
        const completed:string[]=[];let model:FakeModel;
        model=modelFrom(async function*(text?:string){
            const ids=model.tokenizer(text,{truncation:true}).input_ids;
            completed.push(text!.slice(0,Math.floor((ids.dims[1]-2)/4)));
            yield {audio:{audio:new Float32Array([0.5]),sampling_rate:24000}};
        });
        model.tokenizer=vi.fn((text:string,options:any)=>({input_ids:{dims:[1,options.truncation?Math.min(512,text.length*4+2):text.length*4+2]}}));
        mocks.fromPretrained.mockResolvedValue(model);const text='中华人民共和国'.repeat(24)+'朗读结束请记住';
        const result=await send(await start(),{requestId:110,type:'synthesize',text,execution:'gpu'},1);
        expect(result.success).toBe(true);expect(completed.length).toBeGreaterThan(1);expect(completed.join('')).toBe(text);expect(completed.at(-1)).toContain('朗读结束请记住');
        expect(model.tokenizer.mock.calls.every(([,options]:any[])=>options.truncation===false)).toBe(true);
    });
    it('rejects an indivisible over-budget number without partial audio or CPU retry',async()=>{
        let model:FakeModel;model=modelFrom(async function*(text?:string){model.tokenizer(text,{truncation:true});yield {audio:{audio:new Float32Array([0.5]),sampling_rate:24000}};});
        model.tokenizer=vi.fn(()=>({input_ids:{dims:[1,800]}}));mocks.fromPretrained.mockResolvedValue(model);
        const result=await send(await start(),{requestId:111,type:'synthesize',text:'1234567890'.repeat(80),execution:'compatible'},1);
        expect(result).toMatchObject({success:false});expect(result.error).toContain('超过模型上下文');expect(result).not.toHaveProperty('audio');expect(result).not.toHaveProperty('retryWithCpu');
    });
});
