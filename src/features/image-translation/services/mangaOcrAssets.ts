/**
 * @file src/features/image-translation/services/mangaOcrAssets.ts
 * 文件职责：按固定上游版本加载并缓存本地漫画识别模型，不上传漫画图片。
 * 主要内容：从独立资产清单读取固定版本、尺寸和 SHA-256，流式显示下载进度，断流或损坏时切换已登记的备用来源；缓存已完成文件，保留来源偏好，支持校验后导入离线模型、读取状态与清除。
 * 模块边界：只处理模型数据文件，不加载远程代码、不执行 OCR、不读取用户配置；仅下载 Apache-2.0 模型数据；镜像与离线文件必须通过相同完整性校验，来源偏好不包含用户凭据。
 */
import {modelDownloadSources} from '@/src/platform/http/modelDownloads';

import {MANGA_OCR_ROOT as ROOT, MANGA_OCR_CACHE, MANGA_OCR_ASSETS, MANGA_OCR_MODEL_BYTES, MANGA_INPAINT_ASSET} from './mangaOcrAssetManifest';
export {MANGA_OCR_CACHE, MANGA_OCR_ASSETS, MANGA_OCR_MODEL_BYTES, MANGA_INPAINT_ASSET} from './mangaOcrAssetManifest';

export function assertMangaOcrActive(signal?: AbortSignal): void {
    if (signal?.aborted) throw new DOMException('漫画识别已取消', 'AbortError');
}

export type MangaModelSource = 'auto' | 'official' | 'mirror';
export interface MangaDownloadState {phase:'downloading'|'verifying'|'error'|'paused';file:string;loaded:number;total:number;source:string}
const PREFERENCES_CACHE = 'fluent-read-manga-settings-v1';
const PREFERENCE_URL = 'https://fluent-read.invalid/manga-model-source';
let download: MangaDownloadState | undefined;
export async function getMangaModelSource():Promise<MangaModelSource> {
    const value=await (await (await caches.open(PREFERENCES_CACHE)).match(PREFERENCE_URL))?.text();
    return value==='official'||value==='mirror'?value:'auto';
}
export async function setMangaModelSource(source:MangaModelSource):Promise<void> {
    if(!['auto','official','mirror'].includes(source))throw new Error('漫画模型下载来源无效');
    await (await caches.open(PREFERENCES_CACHE)).put(PREFERENCE_URL,new Response(source));
}

async function downloadAsset(url:string,asset:{bytes:number;sha256:string},signal?:AbortSignal,onProgress?:(bytes:number)=>void):Promise<ArrayBuffer> {
    const preference=await getMangaModelSource();
    const sources=modelDownloadSources(url,preference);
    let failure:unknown;
    for(const source of sources){
        assertMangaOcrActive(signal);
        const controller=new AbortController();let timeout:ReturnType<typeof setTimeout>;
        const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
        const arm=()=>{clearTimeout(timeout);timeout=setTimeout(abort,20_000);};
        const state:MangaDownloadState={phase:'downloading',file:url.split('/').pop()!,loaded:0,total:asset.bytes,source:new URL(source).host};download=state;
        try {
            arm();const response=await fetch(source,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
            if(!response.ok)throw new Error(`漫画模型下载失败 (${response.status})`);
            let buffer:ArrayBuffer;
            const reader=response.body?.getReader();
            if(reader){
                const complete=new Uint8Array(asset.bytes);let received=0;
                try {
                    while(true){arm();const chunk=await reader.read();if(chunk.done)break;
                        received+=chunk.value.length;if(received>asset.bytes)throw new Error('漫画识别模型文件不完整，请重试');
                        complete.set(chunk.value,received-chunk.value.length);state.loaded=received;onProgress?.(received);
                    }
                    if(received!==asset.bytes)throw new Error('漫画识别模型文件不完整，请重试');buffer=complete.buffer;
                } finally {void reader.cancel().catch(()=>undefined);reader.releaseLock();}
            }else buffer=await response.arrayBuffer();
            clearTimeout(timeout!);assertMangaOcrActive(signal);state.phase='verifying';
            const verified=await verifiedArrayBuffer(buffer,asset);assertMangaOcrActive(signal);download=undefined;return verified;
        }catch(error){failure=error;if(signal?.aborted){state.phase='paused';assertMangaOcrActive(signal);}}
        finally{clearTimeout(timeout!);controller.abort();signal?.removeEventListener('abort',abort);}
    }
    download!.phase='error';
    throw new Error('漫画模型下载未完成，请切换下载来源或导入模型后重试',{cause:failure});
}

/** 文件名、尺寸、哈希都匹配后才写入，浏览器选择的文件从不上传。 */
export async function importMangaModel(file:File):Promise<void> {
    const asset=MANGA_OCR_ASSETS.find(asset=>asset.path.split('/').pop()===file.name);
    const metadata=asset??(file.name==='lama-manga-dynamic.onnx'?MANGA_INPAINT_ASSET:undefined);
    if(!metadata||file.size!==metadata.bytes)throw new Error('请选择配套的漫画模型文件');
    const buffer=await verifiedArrayBuffer(await file.arrayBuffer(),metadata);
    await (await caches.open(MANGA_OCR_CACHE)).put(asset?ROOT+asset.path:MANGA_INPAINT_ASSET.url,new Response(buffer));
    download=undefined;
}

async function verifiedBuffer(response: Response, asset: {bytes: number; sha256: string}): Promise<ArrayBuffer> {
    if (!response.ok) throw new Error(`漫画识别模型下载失败 (${response.status})`);
    return verifiedArrayBuffer(await response.arrayBuffer(),asset);
}

async function verifiedArrayBuffer(buffer:ArrayBuffer,asset:{bytes:number;sha256:string}):Promise<ArrayBuffer> {
    if (buffer.byteLength !== asset.bytes) throw new Error('漫画识别模型文件不完整，请重试');
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== asset.sha256) throw new Error('漫画识别模型校验失败，请重试');
    return buffer;
}

export async function loadMangaInpaintAsset(signal?: AbortSignal,onProgress?:(bytes:number)=>void): Promise<ArrayBuffer> {
    assertMangaOcrActive(signal);
    const cache = await caches.open(MANGA_OCR_CACHE), asset = MANGA_INPAINT_ASSET;
    const cached = await cache.match(asset.url);
    if (cached) {
        try {const buffer = await verifiedBuffer(cached, asset); assertMangaOcrActive(signal); return buffer;}
        catch (error) {assertMangaOcrActive(signal); await cache.delete(asset.url);}
    }
    const buffer = await downloadAsset(asset.url,asset,signal,onProgress);
    assertMangaOcrActive(signal); await cache.put(asset.url, new Response(buffer));
    return buffer;
}

export async function loadMangaOcrAssets(signal?: AbortSignal, onProgress?: (percent: number) => void) {
    assertMangaOcrActive(signal);
    const cache = await caches.open(MANGA_OCR_CACHE);
    const model: Record<string, ArrayBuffer> = {};
    let completed = 0;
    let lastPercent = -1;
    const report = (percent:number) => {if(percent !== lastPercent){lastPercent=percent;onProgress?.(percent);}};
    for (const asset of MANGA_OCR_ASSETS) {
        assertMangaOcrActive(signal);
        const url = ROOT + asset.path;
        const cached = await cache.match(url);
        let buffer: ArrayBuffer | undefined;
        if (cached) {
            try { buffer = await verifiedBuffer(cached, asset); }
            catch { await cache.delete(url); }
        }
        assertMangaOcrActive(signal);
        if (!buffer) {
            buffer = await downloadAsset(url,asset,signal,bytes=>report(Math.min(99,Math.floor((completed+bytes)*100/MANGA_OCR_MODEL_BYTES))));
            assertMangaOcrActive(signal);
            await cache.put(url, new Response(buffer));
        }
        model[asset.key] = buffer;
        completed += asset.bytes;
        report(Math.floor(completed * 100 / MANGA_OCR_MODEL_BYTES));
    }
    return model;
}

export async function mangaOcrModelStatus(): Promise<{ready: boolean; bytes: number; inpaintingReady: boolean; source:MangaModelSource; download?:MangaDownloadState}> {
    const cache = await caches.open(MANGA_OCR_CACHE);
    const responses = await Promise.all(MANGA_OCR_ASSETS.map(asset => cache.match(ROOT + asset.path)));
    const bytes = responses.reduce((sum, response, index) => sum + (response ? MANGA_OCR_ASSETS[index].bytes : 0), 0);
    const inpaintingReady = !!await cache.match(MANGA_INPAINT_ASSET.url);
    // 设置页的离线导入与 Offscreen 属于不同模块实例，共享缓存后解除旧的暂停/失败提示。
    if (download && ['paused','error'].includes(download.phase)) {
        const index = MANGA_OCR_ASSETS.findIndex(asset => asset.path.endsWith('/' + download!.file));
        if (index >= 0 ? !!responses[index] : download.file === 'lama-manga-dynamic.onnx' && inpaintingReady) download = undefined;
    }
    return {ready: bytes === MANGA_OCR_MODEL_BYTES, bytes: bytes + (inpaintingReady ? MANGA_INPAINT_ASSET.bytes : 0), inpaintingReady,source:await getMangaModelSource(),...(download?{download:{...download}}:{})};
}

export async function removeMangaOcrAssets(): Promise<void> { await caches.delete(MANGA_OCR_CACHE);download=undefined; }
