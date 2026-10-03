import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({load:vi.fn(),background:vi.fn(),create:vi.fn(),run:vi.fn(),release:vi.fn(),tensor:vi.fn(),tensorDispose:vi.fn(),outputDispose:vi.fn(),wasm:{numThreads:0,wasmPaths:undefined as unknown,proxy:true}}));
vi.mock('@/src/features/image-translation/services/mangaOcrAssets',async original=>({...await original<any>(),loadMangaInpaintAsset:mocks.load}));
vi.mock('@/src/features/image-translation/services/mangaRendering',()=>({mangaRegionBackground:mocks.background}));
vi.mock('onnxruntime-web',()=>({env:{wasm:mocks.wasm},InferenceSession:{create:mocks.create},Tensor:class{constructor(...args:unknown[]){mocks.tensor(...args)}dispose=mocks.tensorDispose;}}));
import {applyMangaPatch,createBrowserMangaInpainter,createMangaInpaintingRuntime,createMangaPatch} from '@/src/features/image-translation/services/mangaInpainting';
const region={text:'Hello world',fontSize:20,bbox:{x0:30,y0:30,x1:90,y1:70}};
const pixels=()=>new Uint8ClampedArray(128*128*4).fill(255);
const zero=(patch:{width:number;height:number})=>new Float32Array(patch.width*patch.height*3);
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();mocks.load.mockResolvedValue(new ArrayBuffer(1));mocks.background.mockReturnValue({uniform:false,color:'rgb(255,255,255)'});mocks.release.mockResolvedValue(undefined);mocks.create.mockResolvedValue({run:mocks.run,release:mocks.release});mocks.run.mockResolvedValue({inpainted:{data:new Float32Array([0.25]),dispose:mocks.outputDispose}});vi.stubGlobal('chrome',{runtime:{getURL:(p:string)=>'chrome-extension://test'+p}});});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals()});
describe('漫画局部神经修补',()=>{
    it('有界补丁归一化像素和逐行蒙版，长页不将整张图送入模型',()=>{
        const mapping=createMangaPatch(pixels(),128,128,{...region,sourceBoxes:[{x0:30,y0:30,x1:60,y1:50},{x0:30,y0:60,x1:90,y1:70}]});
        expect(mapping.patch.width%64).toBe(0);expect(mapping.patch.image[0]).toBe(1);expect(mapping.patch.mask).toContain(1);expect(mapping.patch.mask).toContain(0);
        const giant=createMangaPatch(new Uint8ClampedArray(1000*1000*4),1000,1000,{...region,bbox:{x0:0,y0:0,x1:1000,y1:1000}});
        expect(giant.patch.width).toBe(512);expect(giant.patch.height).toBe(512);
        expect(createMangaPatch(pixels(),128,128,{...region,bbox:{x0:0,y0:0,x1:4,y1:4}}).patch.width).toBe(64);
        const edge={...region,fontSize:1,bbox:{x0:0,y0:0,x1:4,y1:4}},edgeMapping=createMangaPatch(pixels(),128,128,edge);
        applyMangaPatch(pixels(),128,edge,edgeMapping,zero(edgeMapping.patch));
    });
    it('只回写原始行的 RGB，图外和行间画面与 alpha 完全不变',()=>{
        const input=pixels(),result=new Uint8ClampedArray(input),r={...region,sourceBoxes:[{x0:30,y0:30,x1:60,y1:50}]},mapping=createMangaPatch(input,128,128,r);
        const output=zero(mapping.patch);output.fill(2,0,mapping.patch.width*mapping.patch.height);applyMangaPatch(result,128,r,mapping,output);
        expect(Array.from(result.slice((35*128+35)*4,(35*128+35)*4+4))).toEqual([255,0,0,255]);
        expect(result.slice(0,128*4)).toEqual(input.slice(0,128*4));expect(result[(55*128+35)*4+1]).toBe(255);expect(input.every(v=>v===255)).toBe(true);
        applyMangaPatch(result,128,region,mapping,zero(mapping.patch));
        expect(()=>applyMangaPatch(result,128,region,mapping,new Float32Array(1))).toThrow('无效');
        const bad=zero(mapping.patch);bad[0]=NaN;expect(()=>applyMangaPatch(result,128,region,mapping,bad)).toThrow('无效');
    });
    it('均匀气泡不下载模型，复杂区域才按需初始化并复用会话',async()=>{
        const port={run:vi.fn(async patch=>zero(patch)),release:vi.fn()},create=vi.fn(async()=>port),runtime=createMangaInpaintingRuntime(create),progress=vi.fn();
        mocks.background.mockReturnValueOnce({uniform:true});expect(await runtime.repair(pixels(),128,128,[region])).toEqual(pixels());expect(create).not.toHaveBeenCalled();
        const result=await runtime.repair(pixels(),128,128,[region],undefined,progress);expect(result[(35*128+35)*4]).toBe(0);expect(progress).toHaveBeenCalledOnce();
        await runtime.repair(pixels(),128,128,[region]);expect(create).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(30000);expect(port.release).toHaveBeenCalledOnce();
        await runtime.repair(pixels(),128,128,[region]);expect(create).toHaveBeenCalledTimes(2);await runtime.dispose();await runtime.dispose();
    });
    it('预取消、初始化取消和推理取消均不回写迟到结果',async()=>{
        const abort=new AbortController();abort.abort();const port={run:vi.fn(async patch=>zero(patch)),release:vi.fn()},create=vi.fn(async()=>port),runtime=createMangaInpaintingRuntime(create);
        await expect(runtime.repair(pixels(),128,128,[region],abort.signal)).rejects.toMatchObject({name:'AbortError'});expect(create).not.toHaveBeenCalled();
        const initAbort=new AbortController();create.mockImplementationOnce(async()=>{initAbort.abort();return port});await expect(runtime.repair(pixels(),128,128,[region],initAbort.signal)).rejects.toMatchObject({name:'AbortError'});
        const inferenceAbort=new AbortController();port.run.mockImplementationOnce(async patch=>{inferenceAbort.abort();return zero(patch)});
        await expect(runtime.repair(pixels(),128,128,[region],inferenceAbort.signal)).rejects.toMatchObject({name:'AbortError'});await runtime.dispose();
    });
    it('创建和推理失败后队列仍可用，空闲释放异常被吸收',async()=>{
        const port={run:vi.fn().mockRejectedValueOnce(new Error('inference')).mockImplementation(async patch=>zero(patch)),release:vi.fn().mockRejectedValue(new Error('released'))},create=vi.fn().mockRejectedValueOnce(new Error('download')).mockResolvedValue(port),runtime=createMangaInpaintingRuntime(create);
        await expect(runtime.repair(pixels(),128,128,[region])).rejects.toThrow('download');await vi.advanceTimersByTimeAsync(30000);
        await expect(runtime.repair(pixels(),128,128,[region])).rejects.toThrow('inference');expect(await runtime.repair(pixels(),128,128,[region])).toBeInstanceOf(Uint8ClampedArray);
        await vi.advanceTimersByTimeAsync(30000);expect(await runtime.repair(pixels(),128,128,[region])).toBeInstanceOf(Uint8ClampedArray);
    });
    it('浏览器模型使用本地 WASM，推理完成或失败都释放所有张量',async()=>{
        const progress=vi.fn();mocks.load.mockImplementationOnce(async(_signal,notify)=>{notify(1);notify(1);notify(100000000);return new ArrayBuffer(1);});
        await createBrowserMangaInpainter(undefined,progress);expect(progress.mock.calls.map(c=>c[0])).toEqual([0,48]);
        const port=await createBrowserMangaInpainter(),patch={image:new Float32Array(3),mask:new Float32Array(1),width:1,height:1};
        expect(await port.run(patch)).toEqual(new Float32Array([0.25]));expect(mocks.tensor.mock.calls.map(c=>c[2])).toEqual([[1,3,1,1],[1,1,1,1]]);
        expect(mocks.outputDispose).toHaveBeenCalledOnce();expect(mocks.tensorDispose).toHaveBeenCalledTimes(2);
        mocks.run.mockRejectedValueOnce(new Error('run'));await expect(port.run(patch)).rejects.toThrow('run');expect(mocks.tensorDispose).toHaveBeenCalledTimes(4);
        await port.release();expect(mocks.release).toHaveBeenCalledOnce();expect(mocks.wasm.numThreads).toBe(1);
    });
    it('创建模型后取消会释放会话，下载后预取消不创建 ONNX 会话',async()=>{
        const abort=new AbortController();mocks.create.mockImplementationOnce(async()=>{abort.abort();return {release:mocks.release}});
        await expect(createBrowserMangaInpainter(abort.signal)).rejects.toMatchObject({name:'AbortError'});expect(mocks.release).toHaveBeenCalledOnce();
        const cancelled=new AbortController();cancelled.abort();await expect(createBrowserMangaInpainter(cancelled.signal)).rejects.toMatchObject({name:'AbortError'});expect(mocks.create).toHaveBeenCalledOnce();
    });
});
