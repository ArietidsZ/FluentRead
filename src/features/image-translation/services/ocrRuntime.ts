/**
 * @file src/features/image-translation/services/ocrRuntime.ts
 * 文件职责：将 Tesseract.js Worker 适配为图片翻译可调用的 OCR 服务，配置扩展内 worker/core 资源并按源语言串行执行识别或语言包预下载。
 * 主要内容：创建具体 OcrWorkerPort，设置 PSM 和语言资源路径，在识别前按像素预算降采样，映回原图坐标；有界缓存已完成结果，重复翻译复用 OCR，取消与失败不写缓存。
 * 模块边界：该文件是 Tesseract 基础设施边界，不保存下载状态、不翻译识别文本也不绘制图片；并发所有权由 ocrWorkerRuntime 管理，持久化由后台 repository 负责。
 */
import { createWorker, PSM, type Worker } from 'tesseract.js';
import {
    getOcrImageSize,
    getOcrLanguages,
    normalizeOcrLines,
    restoreOcrLineCoordinates,
    type OcrLine,
} from '@/src/features/image-translation/core';
import type { ImageOcrLanguageCode } from '@/src/features/image-translation/ocrLanguages';
import { createOcrWorkerRuntime, type OcrWorkerPort } from './ocrWorkerRuntime';

function extensionAsset(path: string): string {
    const getRuntimeUrl = chrome.runtime.getURL as (assetPath: string) => string;
    return getRuntimeUrl(`/fluent-read-ocr/${path}`);
}

type TesseractRecognitionResult = Awaited<ReturnType<Worker['recognize']>>;

const ocrWorkerRuntime = createOcrWorkerRuntime<TesseractRecognitionResult>({
    sparseTextMode: PSM.SPARSE_TEXT,
    createWorker: async languages => createWorker(languages, 1, {
        workerPath: extensionAsset('worker/worker.min.js'),
        corePath: extensionAsset('core'),
        cachePath: 'fluent-read-image-ocr',
        // 不再把 traineddata 打进扩展；Tesseract.js 会从 jsDelivr 按需下载，
        // 并将解压后的语言包缓存到 Offscreen Document 的 IndexedDB。
        // Offscreen 页面拥有扩展源，直接加载本地 worker 可避免 Blob Worker 的 CSP/源限制。
        workerBlobURL: false,
    }) as unknown as Promise<OcrWorkerPort<TesseractRecognitionResult>>,
});

const MAX_CACHED_OCR_IMAGES = 3;
const MAX_CACHED_OCR_BYTES = 12 * 1024 * 1024;
const completedRecognitionCache = new Map<string, {lines: OcrLine[]; bytes: number}>();
let cachedRecognitionBytes = 0;

function abortRecognition(): Error {
    const error = new Error('图片 OCR 请求已取消');
    error.name = 'AbortError';
    return error;
}

function copyOcrLines(lines: OcrLine[]): OcrLine[] {
    return lines.map(line => ({...line, bbox: {...line.bbox}}));
}

function cacheRecognition(key: string, lines: OcrLine[]): void {
    const bytes = key.length * 2 + lines.reduce((total, line) => total + line.text.length * 2 + 64, 0);
    if (bytes > MAX_CACHED_OCR_BYTES) return;
    const previous = completedRecognitionCache.get(key);
    if (previous) cachedRecognitionBytes -= previous.bytes;
    completedRecognitionCache.delete(key);
    completedRecognitionCache.set(key, {lines: copyOcrLines(lines), bytes});
    cachedRecognitionBytes += bytes;
    while (completedRecognitionCache.size > MAX_CACHED_OCR_IMAGES || cachedRecognitionBytes > MAX_CACHED_OCR_BYTES) {
        const oldestKey = completedRecognitionCache.keys().next().value!;
        cachedRecognitionBytes -= completedRecognitionCache.get(oldestKey)!.bytes;
        completedRecognitionCache.delete(oldestKey);
    }
}

function loadOcrImage(image: string, signal?: AbortSignal): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const source = new Image();
        const cleanup = () => {
            source.onload = null;
            source.onerror = null;
            signal?.removeEventListener('abort', handleAbort);
        };
        const handleAbort = () => {
            cleanup();
            source.src = '';
            reject(abortRecognition());
        };
        source.onload = () => {
            cleanup();
            resolve(source);
        };
        source.onerror = () => {
            cleanup();
            reject(new Error('图片数据无法解码'));
        };
        if (signal?.aborted) {
            handleAbort();
            return;
        }
        signal?.addEventListener('abort', handleAbort, {once: true});
        source.src = image;
    });
}

export async function recognizeImage(
    image: string,
    sourceLanguage: string,
    signal?: AbortSignal,
): Promise<OcrLine[]> {
    if (signal?.aborted) throw abortRecognition();
    const languages = getOcrLanguages(sourceLanguage).join('+');
    const cacheKey = `${languages}\0${image}`;
    const cached = completedRecognitionCache.get(cacheKey);
    if (cached) {
        completedRecognitionCache.delete(cacheKey);
        completedRecognitionCache.set(cacheKey, cached);
        return copyOcrLines(cached.lines);
    }

    const source = await loadOcrImage(image, signal);
    if (signal?.aborted) throw abortRecognition();
    const sourceWidth = source.naturalWidth || source.width;
    const sourceHeight = source.naturalHeight || source.height;
    const size = getOcrImageSize(sourceWidth, sourceHeight);
    let recognitionImage = image;
    if (size.width !== sourceWidth || size.height !== sourceHeight) {
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('浏览器不支持图片处理');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(source, 0, 0, size.width, size.height);
        recognitionImage = canvas.toDataURL('image/png');
        // 编码后立即释放临时画布像素，避免 OCR WebAssembly 与降采样画布同时长期占用内存。
        canvas.width = 0;
        canvas.height = 0;
    }
    const result = await ocrWorkerRuntime.recognize(recognitionImage, languages, signal);
    if (signal?.aborted) throw abortRecognition();
    const lines = restoreOcrLineCoordinates(
        normalizeOcrLines(result.data.blocks), sourceWidth, sourceHeight, size.width, size.height,
    );
    cacheRecognition(cacheKey, lines);
    return lines;
}

export async function downloadImageOcrLanguages(
    languages: ImageOcrLanguageCode[],
    signal?: AbortSignal,
): Promise<void> {
    await ocrWorkerRuntime.ensureLanguages(languages, signal);
}
