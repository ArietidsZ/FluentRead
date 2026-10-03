/**
 * @file src/features/image-translation/services/mangaOcr.ts
 * 文件职责：在扩展 Offscreen 文档中按需运行 PaddleOCR 漫画识别，并隔离排队、取消、失败和空闲释放。
 * 主要内容：延迟导入浏览器 OCR 和本地 ONNX WASM，读取已校验模型；气泡外旁白与放大的独立气泡识别后整段分组，避免重复推理；取消立即结束调用方等待，底层推理完成后丢弃迟到结果，空闲三分钟释放会话，统一清理 OCR 与修补会话。
 * 模块边界：不访问宿主 DOM、不翻译文本、不处理译图；普通图片和圈选继续由 Tesseract 负责，不给这些路径加载漫画模型。
 */
import {configureOnnxWasmBackend} from '@/src/shared/onnx/wasmBinary';
import {assertMangaOcrActive, loadMangaOcrAssets, removeMangaOcrAssets} from './mangaOcrAssets';
import type {MangaRegion} from './mangaRegions';
import {findMangaBubbles,collectMangaRegions,type MangaOcrPage} from './mangaBubbles';
import {mangaInpaintingRuntime} from './mangaInpainting';

interface MangaOcrPort {
    recognize(image: string, options: {flatten: true; noCache: true; strategy: 'per-box';signal?:AbortSignal}): Promise<MangaOcrPage>;
    destroy(): Promise<void>;
}
type Progress = (stage: 'preparing' | 'recognizing', percent?: number) => void;

/** 单队列持有模型会话，取消排队请求不能终止其他页正在使用的模型。 */
export function createMangaOcrRuntime(create: (signal?: AbortSignal, progress?: Progress) => Promise<MangaOcrPort>) {
    let service: MangaOcrPort | undefined;
    let tail: Promise<void> = Promise.resolve();
    let idle: ReturnType<typeof setTimeout> | undefined;
    function clearIdle() { clearTimeout(idle); idle = undefined; }
    async function release() {
        clearIdle(); const current = service; service = undefined;
        await current?.destroy();
    }
    function queue<T>(operation: () => Promise<T>): Promise<T> {
        const result = tail.then(operation);
        tail = result.then(() => undefined, () => undefined);
        return result;
    }
    return {
        recognize(image: string, language: string, width: number, height: number, signal?: AbortSignal, progress?: Progress): Promise<MangaRegion[]> {
            const result = queue(async () => {
                assertMangaOcrActive(signal); clearIdle();
                try {
                    if (!service) {
                        progress?.('preparing', 0);
                        service = await create(signal, progress);
                    }
                    assertMangaOcrActive(signal); progress?.('recognizing');
                    const response = await service.recognize(image, {flatten: true, noCache: true, strategy: 'per-box',signal});
                    assertMangaOcrActive(signal);
                    return collectMangaRegions(response, language, width, height);
                } finally {
                    // 不把输入图或结果缓存在库内；跨页结果缓存仍由 content 的像素预算管理。
                    idle = setTimeout(() => { void queue(release).catch(() => undefined); }, 180_000);
                }
            });
            if (!signal) return result;
            return new Promise((resolve, reject) => {
                const abort = () => reject(new DOMException('漫画识别已取消', 'AbortError'));
                signal.addEventListener('abort', abort, {once: true});
                if (signal.aborted) abort();
                void result.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
            });
        },
        dispose: () => queue(release),
        removeModels: () => queue(async () => { await release(); await removeMangaOcrAssets(); }),
    };
}

export async function createBrowserMangaOcr(signal?: AbortSignal, progress?: Progress): Promise<MangaOcrPort> {
    const model = await loadMangaOcrAssets(signal, percent => progress?.('preparing', percent));
    assertMangaOcrActive(signal);
    // 两个包共享同一 ONNX 实例；在导入 SDK 前覆盖其 CDN 默认路径，符合扩展 CSP。
    const ort = await import('onnxruntime-web');
    ort.env.wasm.numThreads = 1;
    configureOnnxWasmBackend(ort.env.wasm, {
        mjs: chrome.runtime.getURL('/fluent-read-manga/ort-wasm-simd-threaded.mjs'),
        wasm: chrome.runtime.getURL('/fluent-read-manga/ort-wasm-simd-threaded.wasm'),
    });
    const {PaddleOcrService} = await import('ppu-paddle-ocr/web');
    const service = new PaddleOcrService({model, detection: {maxSideLength:1536,paddingVertical:0.1,paddingHorizontal:0.2},
        recognition: {charactersDictionary: [], minimumConfidence:0.65,strategy:'per-box',spaceRecovery:true,mainThreadYieldMs:1},
        session: {executionProviders: ['wasm'], graphOptimizationLevel: 'basic'}});
    try {
        await service.initialize(); assertMangaOcrActive(signal);
        return {
            recognize: async (image, options) => {
                assertMangaOcrActive(options.signal);
                const bitmap=await createImageBitmap(new Blob([await (await fetch(image)).arrayBuffer()]));
                const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
                try {
                    assertMangaOcrActive(options.signal);
                    const context=canvas.getContext('2d');if(!context)throw new Error('浏览器不支持图片处理');
                    context.drawImage(bitmap,0,0);
                    const boxes=findMangaBubbles(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);
                    const sdkOptions={flatten:true as const,noCache:true as const,strategy:'per-box' as const};
                    // 气泡会以原分辨率单独识别。整页只识别气泡外文字，避免每行对白推理两次。
                    let pageCanvas = canvas;
                    if (boxes.length) {
                        pageCanvas = document.createElement('canvas');pageCanvas.width = canvas.width;pageCanvas.height = canvas.height;
                        const pageContext = pageCanvas.getContext('2d');
                        if (!pageContext) {pageCanvas.width = 0;pageCanvas.height = 0;throw new Error('浏览器不支持图片处理');}
                        pageContext.drawImage(canvas, 0, 0);pageContext.fillStyle = '#fff';
                        for (const box of boxes) pageContext.fillRect(box.x0,box.y0,box.x1-box.x0,box.y1-box.y0);
                    }
                    let page: MangaOcrPage;
                    try {page = await service.recognize(pageCanvas,sdkOptions);}
                    finally {if (pageCanvas !== canvas) {pageCanvas.width = 0;pageCanvas.height = 0;}}
                    const bubbles:NonNullable<MangaOcrPage['bubbles']>=[];
                    for(const bbox of boxes){
                        assertMangaOcrActive(options.signal);
                        const width=bbox.x1-bbox.x0,height=bbox.y1-bbox.y0;
                        const scale=Math.min(3,1536/Math.max(width,height));
                        const crop=document.createElement('canvas');crop.width=Math.round(width*scale);crop.height=Math.round(height*scale);
                        try {
                            const ctx=crop.getContext('2d');if(!ctx)throw new Error('浏览器不支持图片处理');
                            ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
                            ctx.drawImage(canvas,bbox.x0,bbox.y0,width,height,0,0,crop.width,crop.height);
                            const result=await service.recognize(crop,sdkOptions);
                            const sx=crop.width/width,sy=crop.height/height;
                            bubbles.push({bbox,results:result.results.map(item=>({...item,box:{x:bbox.x0+item.box.x/sx,y:bbox.y0+item.box.y/sy,width:item.box.width/sx,height:item.box.height/sy}}))});
                        }finally{crop.width=0;crop.height=0;}
                    }
                    assertMangaOcrActive(options.signal);return {results:page.results,bubbles};
                }finally{canvas.width=0;canvas.height=0;bitmap.close();}
            },
            destroy: () => service.destroy(),
        };
    } catch (error) { await service.destroy(); throw error; }
}

export const mangaOcrRuntime = createMangaOcrRuntime(createBrowserMangaOcr);

/** 设置清理和页面销毁共用模型会话生命周期。 */
export async function removeMangaModels():Promise<void>{await mangaInpaintingRuntime.dispose();await mangaOcrRuntime.removeModels();}
export function disposeMangaModels():void{void mangaOcrRuntime.dispose().catch(()=>undefined);void mangaInpaintingRuntime.dispose().catch(()=>undefined);}
