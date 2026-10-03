import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({assets:vi.fn(),remove:vi.fn(),initialize:vi.fn(),recognize:vi.fn(),destroy:vi.fn(),options:vi.fn(),
    inpaintDispose:vi.fn(),bitmapClose:vi.fn(),contexts:[] as any[],canvases:[] as any[],
    wasm:{numThreads:0,wasmPaths:undefined as unknown,proxy:true}}));
vi.mock('@/src/features/image-translation/services/mangaOcrAssets', async importOriginal => ({...await importOriginal<any>(),loadMangaOcrAssets:mocks.assets,removeMangaOcrAssets:mocks.remove}));
vi.mock('onnxruntime-web',()=>({env:{wasm:mocks.wasm}}));
vi.mock('ppu-paddle-ocr/web',()=>({PaddleOcrService:class{constructor(options:unknown){mocks.options(options)}initialize=mocks.initialize;recognize=mocks.recognize;destroy=mocks.destroy;}}));
vi.mock('@/src/features/image-translation/services/mangaInpainting',()=>({mangaInpaintingRuntime:{dispose:mocks.inpaintDispose}}));
import {createBrowserMangaOcr, createMangaOcrRuntime, mangaOcrRuntime, removeMangaModels, disposeMangaModels} from '@/src/features/image-translation/services/mangaOcr';
const response = {results:[{text:'Hello world',confidence:0.99,box:{x:10,y:10,width:100,height:20}}]};
const deferred = <T,>() => {let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const tick = async () => {for(let i=0;i<6;i++)await Promise.resolve()};
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();mocks.contexts=[];mocks.canvases=[];mocks.assets.mockResolvedValue({charactersDictionary:new ArrayBuffer(4)});mocks.initialize.mockResolvedValue(undefined);mocks.destroy.mockResolvedValue(undefined);mocks.remove.mockResolvedValue(undefined);mocks.inpaintDispose.mockResolvedValue(undefined);mocks.recognize.mockResolvedValue(response);vi.stubGlobal('chrome',{runtime:{getURL:(p:string)=>'chrome-extension://test'+p}});vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1,2,3]))));
    vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:200,height:200,close:mocks.bitmapClose})));
    vi.stubGlobal('document',{createElement:vi.fn(()=>{const ctx={drawImage:vi.fn(),fillRect:vi.fn(),getImageData:vi.fn(()=>({data:new Uint8ClampedArray(200*200*4)}))};const canvas={width:0,height:0,getContext:vi.fn(()=>ctx)};mocks.contexts.push(ctx);mocks.canvases.push(canvas);return canvas;})});
});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks()});

describe('漫画本地神经 OCR 会话',()=>{
    it('复用会话串行识别，阅读期间保留会话，空闲三分钟释放，随后重新创建',async()=>{
        const port={recognize:vi.fn(async()=>response),destroy:vi.fn(async()=>{})},create=vi.fn(async()=>port),runtime=createMangaOcrRuntime(create),progress=vi.fn();
        expect(await runtime.recognize('image','en',200,200,undefined,progress)).toHaveLength(1);
        await runtime.recognize('second','en',200,200);expect(create).toHaveBeenCalledOnce();expect(progress.mock.calls).toEqual([['preparing',0],['recognizing']]);
        await vi.advanceTimersByTimeAsync(60000);expect(port.destroy).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(120000);expect(port.destroy).toHaveBeenCalledOnce();
        await runtime.recognize('third','en',200,200);expect(create).toHaveBeenCalledTimes(2);await runtime.dispose();expect(port.destroy).toHaveBeenCalledTimes(2);
        await runtime.dispose();
    });
    it('取消排队请求立即返回且不干扰正在识别的页，迟到结果丢弃',async()=>{
        const pending=deferred<typeof response>(),port={recognize:vi.fn(()=>pending.promise),destroy:vi.fn()},create=vi.fn(async()=>port),runtime=createMangaOcrRuntime(create);
        const firstAbort=new AbortController(),queuedAbort=new AbortController();
        const first=runtime.recognize('first','en',200,200,firstAbort.signal);await tick();
        const queued=runtime.recognize('queued','en',200,200,queuedAbort.signal);const stopped=expect(queued).rejects.toMatchObject({name:'AbortError'});queuedAbort.abort();await stopped;
        const firstStopped=expect(first).rejects.toMatchObject({name:'AbortError'});firstAbort.abort();await firstStopped;
        pending.resolve(response);await tick();await runtime.dispose();expect(port.recognize).toHaveBeenCalledOnce();
    });
    it('预取消、创建失败和识别失败后队列均可继续，移除模型先释放会话',async()=>{
        const create=vi.fn(),runtime=createMangaOcrRuntime(create),aborted=new AbortController();aborted.abort();
        await expect(runtime.recognize('cancel','en',200,200,aborted.signal)).rejects.toMatchObject({name:'AbortError'});expect(create).not.toHaveBeenCalled();
        create.mockRejectedValueOnce(new Error('download failed'));await expect(runtime.recognize('fail','en',200,200)).rejects.toThrow('download failed');
        await runtime.dispose();const port={recognize:vi.fn().mockRejectedValueOnce(new Error('ocr failed')).mockResolvedValue(response),destroy:vi.fn()};create.mockResolvedValue(port);
        await expect(runtime.recognize('bad','en',200,200)).rejects.toThrow('ocr failed');expect(await runtime.recognize('good','en',200,200)).toHaveLength(1);
        await runtime.removeModels();expect(port.destroy).toHaveBeenCalledOnce();expect(mocks.remove).toHaveBeenCalledOnce();
    });
    it('空闲销毁失败不会成为未处理异常，也不会阻止新任务',async()=>{
        const port={recognize:vi.fn(async()=>response),destroy:vi.fn().mockRejectedValue(new Error('closed'))},runtime=createMangaOcrRuntime(async()=>port);
        await runtime.recognize('image','en',200,200);await vi.advanceTimersByTimeAsync(180000);
        expect(await runtime.recognize('next','en',200,200)).toHaveLength(1);
    });
    it('浏览器适配只加载本地 WASM 和已校验模型，图片在本地解码',async()=>{
        const progress=vi.fn();mocks.assets.mockImplementationOnce(async(_signal,notify)=>{notify(32);return {charactersDictionary:new ArrayBuffer(4)}});
        const port=await createBrowserMangaOcr(undefined,progress);await port.recognize('data:image/png;base64,aQ==',{flatten:true,noCache:true,strategy:'per-box'});await port.destroy();
        expect(progress).toHaveBeenCalledWith('preparing',32);expect(mocks.wasm).toMatchObject({numThreads:1,proxy:false,wasmPaths:{mjs:'chrome-extension://test/fluent-read-manga/ort-wasm-simd-threaded.mjs',wasm:'chrome-extension://test/fluent-read-manga/ort-wasm-simd-threaded.wasm'}});
        expect(fetch).toHaveBeenCalledWith('data:image/png;base64,aQ==');expect(mocks.recognize.mock.calls[0][0]).toBe(mocks.canvases[0]);
        expect(mocks.canvases[0].width).toBe(0);expect(mocks.bitmapClose).toHaveBeenCalledOnce();
        expect(mocks.options.mock.calls[0][0]).toMatchObject({session:{executionProviders:['wasm']},recognition:{minimumConfidence:0.65}});
        await createBrowserMangaOcr();
    });
    it('放大气泡分别识别并映射回原图坐标，失败和取消时释放所有画布',async()=>{
        const pixels=new Uint8ClampedArray(200*200*4);for(let y=40;y<90;y++)for(let x=30;x<80;x++)pixels.fill(255,(y*200+x)*4,(y*200+x)*4+4);
        const original=vi.mocked(document.createElement).getMockImplementation()!;let main=true;
        vi.mocked(document.createElement).mockImplementation(()=>{const canvas=original('canvas');if(main){main=false;mocks.contexts.at(-1).getImageData.mockReturnValue({data:pixels});}return canvas;});
        mocks.recognize.mockResolvedValueOnce(response).mockResolvedValueOnce({results:[{text:'Clear dialogue',confidence:.99,box:{x:15,y:30,width:90,height:30}}]});
        const port=await createBrowserMangaOcr();const result=await port.recognize('image',{flatten:true,noCache:true,strategy:'per-box'});
        expect(result.results).toEqual(response.results);expect(mocks.contexts[0].fillRect).not.toHaveBeenCalled();
        expect(result.bubbles?.[0].results[0].box).toEqual({x:35,y:50,width:30,height:10});expect(mocks.contexts[1].fillRect).toHaveBeenCalledWith(30,40,50,50);expect(mocks.contexts[2].drawImage).toHaveBeenCalledWith(mocks.canvases[0],30,40,50,50,0,0,150,150);
        expect(mocks.canvases.every(c=>c.width===0&&c.height===0)).toBe(true);
        // 相同输入在推理之后取消，不能返回迟到的气泡结果。
        main=true;const abort=new AbortController();mocks.recognize.mockImplementationOnce(async()=>{abort.abort();return response;});
        await expect(port.recognize('image',{flatten:true,noCache:true,strategy:'per-box',signal:abort.signal})).rejects.toMatchObject({name:'AbortError'});
        expect(mocks.bitmapClose).toHaveBeenCalledTimes(2);
        main=true;mocks.recognize.mockResolvedValueOnce(response).mockRejectedValueOnce(new Error('crop inference failed'));
        await expect(port.recognize('image',{flatten:true,noCache:true,strategy:'per-box'})).rejects.toThrow('crop inference failed');
        expect(mocks.canvases.every(c=>c.width===0&&c.height===0)).toBe(true);
    });
    it('不支持 Canvas 和解码期间取消时释放位图，裁剪 Canvas 缺失也释放资源',async()=>{
        const port=await createBrowserMangaOcr();
        vi.mocked(document.createElement).mockReturnValueOnce({width:200,height:200,getContext:()=>null} as any);
        await expect(port.recognize('image',{flatten:true,noCache:true,strategy:'per-box'})).rejects.toThrow('浏览器不支持');
        const abort=new AbortController();vi.mocked(createImageBitmap).mockImplementationOnce(async()=>{abort.abort();return {width:200,height:200,close:mocks.bitmapClose} as any;});
        await expect(port.recognize('image',{flatten:true,noCache:true,strategy:'per-box',signal:abort.signal})).rejects.toMatchObject({name:'AbortError'});
        const pixels=new Uint8ClampedArray(200*200*4);for(let y=40;y<90;y++)for(let x=30;x<80;x++)pixels.fill(255,(y*200+x)*4,(y*200+x)*4+4);
        vi.mocked(document.createElement).mockReturnValueOnce({width:200,height:200,getContext:()=>({drawImage:vi.fn(),getImageData:()=>({data:pixels})})} as any).mockReturnValueOnce({width:0,height:0,getContext:()=>null} as any);
        await expect(port.recognize('image',{flatten:true,noCache:true,strategy:'per-box'})).rejects.toThrow('浏览器不支持');expect(mocks.bitmapClose).toHaveBeenCalledTimes(3);
        const canvasFactory=vi.mocked(document.createElement).getMockImplementation()!;
        vi.mocked(document.createElement).mockReturnValueOnce({width:200,height:200,getContext:()=>({drawImage:vi.fn(),getImageData:()=>({data:pixels})})} as any)
            .mockImplementationOnce(()=>canvasFactory('canvas')).mockReturnValueOnce({width:0,height:0,getContext:()=>null} as any);
        await expect(port.recognize('image',{flatten:true,noCache:true,strategy:'per-box'})).rejects.toThrow('浏览器不支持');
        const stopped=new AbortController();stopped.abort();await expect(port.recognize('image',{flatten:true,noCache:true,strategy:'per-box',signal:stopped.signal})).rejects.toMatchObject({name:'AbortError'});
    });
    it('设置清理先释放背景修补和 OCR 会话，卸载期间销毁失败不会变成未处理异常',async()=>{
        await removeMangaModels();expect(mocks.inpaintDispose).toHaveBeenCalledOnce();expect(mocks.remove).toHaveBeenCalledOnce();
        const dispose=vi.spyOn(mangaOcrRuntime,'dispose').mockRejectedValue(new Error('already closed'));mocks.inpaintDispose.mockRejectedValueOnce(new Error('already closed'));
        disposeMangaModels();await tick();expect(dispose).toHaveBeenCalledOnce();expect(mocks.inpaintDispose).toHaveBeenCalledTimes(2);
    });
    it('初始化异常或初始化期间取消均销毁模型，不返回半初始化会话',async()=>{
        mocks.initialize.mockRejectedValueOnce(new Error('init failed'));await expect(createBrowserMangaOcr()).rejects.toThrow('init failed');expect(mocks.destroy).toHaveBeenCalledOnce();
        const abort=new AbortController();mocks.initialize.mockImplementationOnce(async()=>abort.abort());await expect(createBrowserMangaOcr(abort.signal)).rejects.toMatchObject({name:'AbortError'});expect(mocks.destroy).toHaveBeenCalledTimes(2);
        const cancelled=new AbortController();cancelled.abort();await expect(createBrowserMangaOcr(cancelled.signal)).rejects.toMatchObject({name:'AbortError'});
    });
});
