import { config } from "@/entrypoints/utils/config";
import type { OcrLine } from "@/entrypoints/utils/imageTranslationCore";
import type { AreaTranslationSelection } from "@/entrypoints/utils/areaTranslationCore";
import type { ImageOcrLanguageCode } from "@/entrypoints/utils/imageOcrLanguages";
import type { OffscreenImageTranslationResult } from "@/entrypoints/offscreen/imageTranslation";

/**
 * Chrome 内置翻译 API 服务
 * 基于 Chrome 浏览器的 Translation API 实现快速、安全的翻译
 * 
 * 使用 Chrome Offscreen API 在独立的 DOM 环境中运行翻译功能
 */

// 在 background script 中使用 offscreen API 处理翻译
let offscreenCreationPromise: Promise<void> | null = null;

async function translateWithOffscreen(message: any): Promise<any> {
    try {
        // 确保 offscreen 文档存在
        await ensureOffscreenDocument();

        // 向 offscreen 文档发送翻译请求
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type: 'CHROME_TRANSLATE_OFFSCREEN',
                data: {
                    text: message.origin,
                    from: config.from,
                    to: config.to
                }
            }, (response: any) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });

        // 检查响应
        if (response && typeof response === 'object' && 'success' in response) {
            const typedResponse = response as { success: boolean; result?: string; error?: string };
            if (typedResponse.success) {
                return typedResponse.result;
            } else {
                throw new Error(typedResponse.error || '翻译失败');
            }
        }

        throw new Error('无效的响应格式');
    } catch (error) {
        console.error('Offscreen 翻译失败:', error);
        throw new Error(`Chrome Translation API 不可用：${error instanceof Error ? error.message : '未知错误'}`);
    }
}

// 确保 offscreen 文档存在
export async function ensureOffscreenDocument() {
    if (offscreenCreationPromise) return offscreenCreationPromise;
    offscreenCreationPromise = (async () => {
        // 检查是否已经有 offscreen 文档
        const existingContexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });

        if (existingContexts.length > 0) {
            return; // 已经存在
        }

        // 创建 offscreen 文档
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['DOM_SCRAPING'], // 使用 DOM_SCRAPING 原因来访问 Translation API
            justification: 'Chrome Translation API requires DOM context'
        });

        console.log('Offscreen 文档创建成功');
    })();
    try {
        await offscreenCreationPromise;
    } catch (error) {
        console.error('创建 offscreen 文档失败:', error);
        throw new Error('无法创建 offscreen 文档');
    } finally {
        offscreenCreationPromise = null;
    }
}

async function readOffscreenIdleState(): Promise<{ idle: boolean; generation: number }> {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'FLUENT_READ_OFFSCREEN_IDLE_CHECK' }, (response: any) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve({
                idle: response?.success === true && response?.idle === true,
                generation: typeof response?.generation === 'number' ? response.generation : -1,
            });
        });
    });
}

/**
 * 视频停止后释放承载 WASM heap 的整个 offscreen renderer。连续两次空闲
 * 快照必须一致；OCR、图片翻译或模型下载只要在期间启动，都会阻止关闭。
 */
export async function closeOffscreenDocumentIfIdle(shouldAbort?: () => boolean): Promise<boolean> {
    if (shouldAbort?.()) return false;
    const existingContexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (existingContexts.length === 0) return true;
    const first = await readOffscreenIdleState();
    if (!first.idle) return false;
    await new Promise(resolve => setTimeout(resolve, 120));
    if (shouldAbort?.()) return false;
    const second = await readOffscreenIdleState();
    if (!second.idle || second.generation !== first.generation) return false;
    if (shouldAbort?.()) return false;
    await chrome.offscreen.closeDocument();
    return true;
}

/** 在扩展自己的 offscreen 页面中运行浏览器内 Whisper，不把音频发送到云端。 */
// 必须高于 offscreen 专用 Worker 的 32 秒保护线。这里仅作为消息通道
// 失联兜底；正常停止后的文档释放由带任务计数的空闲检查单独完成。
const LOCAL_VIDEO_TRANSCRIPTION_TIMEOUT_MS = 40_000;

export async function transcribeVideoAudioWithOffscreen(message: {
    streamId: string;
    audioBase64?: string;
    audioPcm16Base64?: string;
    model?: string;
    sourceLanguage?: string;
}): Promise<{
    text: string;
    segments?: Array<{ startMs: number; endMs: number; text: string }>;
    model?: string;
    backend?: 'webgpu' | 'wasm';
    gpuInfo?: string;
    skipped?: boolean;
    decodeMs?: number;
    inferenceMs?: number;
    audioDurationMs?: number;
    threads?: number;
    dtype?: 'q4' | 'q8';
}> {
    await ensureOffscreenDocument();

    const response = await new Promise<any>((resolve, reject) => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let settled = false;
        const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            if (timeout !== undefined) clearTimeout(timeout);
            callback();
        };
        chrome.runtime.sendMessage({
            type: 'FLUENT_READ_LOCAL_VIDEO_TRANSCRIBE_OFFSCREEN',
            streamId: message.streamId,
            audioBase64: message.audioBase64,
            audioPcm16Base64: message.audioPcm16Base64,
            model: message.model,
            sourceLanguage: message.sourceLanguage,
        }, (result: any) => {
            if (chrome.runtime.lastError) {
                finish(() => reject(new Error(chrome.runtime.lastError!.message)));
            } else {
                finish(() => resolve(result));
            }
        });
        timeout = setTimeout(() => {
            // 只终止这条视频流的专用 Whisper Worker；共享 offscreen 页面还
            // 承载图片 OCR/翻译，不能因一次 Base 冷启动超时被整体关闭。
            void cancelVideoTranscriptionWithOffscreen(message.streamId).catch(() => undefined);
            finish(() => reject(new Error(`本地视频 AI 推理超过 ${LOCAL_VIDEO_TRANSCRIPTION_TIMEOUT_MS / 1000} 秒，已停止以保护浏览器性能`)));
        }, LOCAL_VIDEO_TRANSCRIPTION_TIMEOUT_MS);
    });

    if (response?.success) {
        return {
            text: typeof response.text === 'string' ? response.text : '',
            segments: Array.isArray(response.segments) ? response.segments : [],
            model: response.model,
            backend: response.backend === 'webgpu' || response.backend === 'wasm' ? response.backend : undefined,
            gpuInfo: typeof response.gpuInfo === 'string' ? response.gpuInfo : undefined,
            skipped: response.skipped === true,
            decodeMs: typeof response.decodeMs === 'number' ? response.decodeMs : undefined,
            inferenceMs: typeof response.inferenceMs === 'number' ? response.inferenceMs : undefined,
            audioDurationMs: typeof response.audioDurationMs === 'number' ? response.audioDurationMs : undefined,
            threads: typeof response.threads === 'number' ? response.threads : undefined,
            dtype: response.dtype === 'q4' || response.dtype === 'q8' ? response.dtype : undefined,
        };
    }
    throw new Error(response?.error || '本地视频 AI 字幕失败');
}

/** 立即终止指定视频流正在运行的 Whisper Worker；不会关闭共享 offscreen 页面。 */
export async function cancelVideoTranscriptionWithOffscreen(streamId: string): Promise<void> {
    if (!streamId) return;
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    if (existingContexts.length === 0) return;
    await new Promise<void>((resolve, reject) => {
        let settled = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            if (timeout !== undefined) clearTimeout(timeout);
            if (error) reject(error);
            else resolve();
        };
        chrome.runtime.sendMessage({
            type: 'FLUENT_READ_LOCAL_VIDEO_CANCEL_OFFSCREEN',
            streamId,
        }, (response: any) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
                finish(new Error(lastError.message));
                return;
            }
            if (response?.success !== true) {
                finish(new Error(response?.error || '本地视频 AI Worker 取消失败'));
                return;
            }
            finish();
        });
        timeout = setTimeout(() => finish(new Error('本地视频 AI Worker 取消超时')), 3_000);
    });
}

/** 预下载并校验扩展内 Whisper 模型，模型文件会留在浏览器本地缓存。 */
export async function prepareVideoTranscriptionModelWithOffscreen(model?: string, options?: {
    keepWarm?: boolean;
    streamId?: string;
}): Promise<{
    model: string;
    backend?: 'webgpu' | 'wasm';
    gpuInfo?: string;
    dtype?: 'q4' | 'q8';
}> {
    await ensureOffscreenDocument();

    const response = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: 'FLUENT_READ_LOCAL_VIDEO_PREPARE_OFFSCREEN',
            model,
            keepWarm: options?.keepWarm === true,
            streamId: options?.streamId,
        }, (result: any) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(result);
            }
        });
    });

    if (response?.success && typeof response.model === 'string') {
        return {
            model: response.model,
            backend: response.backend === 'webgpu' || response.backend === 'wasm' ? response.backend : undefined,
            gpuInfo: typeof response.gpuInfo === 'string' ? response.gpuInfo : undefined,
            dtype: response.dtype === 'q4' || response.dtype === 'q8' ? response.dtype : undefined,
        };
    }
    throw new Error(response?.error || '本地视频 AI 字幕模型下载失败');
}

// 在 offscreen 页面中运行本地 OCR，避免内容脚本从网页源启动扩展 worker 时被浏览器拦截。
export async function recognizeImageWithOffscreen(image: string, sourceLanguage: string): Promise<OcrLine[]> {
    await ensureOffscreenDocument();

    const response = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: 'FLUENT_READ_IMAGE_OCR_OFFSCREEN',
            image,
            sourceLanguage,
        }, (result: any) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(result);
            }
        });
    });

    if (response?.success) return response.lines || [];
    throw new Error(response?.error || '图片 OCR 失败');
}

export async function translateImageWithOffscreen(
    image: string,
    sourceLanguage: string,
    title: string,
): Promise<OffscreenImageTranslationResult> {
    await ensureOffscreenDocument();

    const response = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: 'FLUENT_READ_IMAGE_TRANSLATE_OFFSCREEN',
            image,
            sourceLanguage,
            title,
        }, (result: any) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(result);
            }
        });
    });

    if (response?.success) return response;
    throw new Error(response?.error || '图片翻译失败');
}

export async function translateAreaWithOffscreen(
    image: string,
    sourceLanguage: string,
    title: string,
    selection: AreaTranslationSelection,
): Promise<OffscreenImageTranslationResult> {
    await ensureOffscreenDocument();

    const response = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: 'FLUENT_READ_AREA_TRANSLATE_OFFSCREEN',
            image,
            sourceLanguage,
            title,
            selection,
        }, (result: any) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(result);
            }
        });
    });

    if (response?.success) return response;
    throw new Error(response?.error || '圈选翻译失败');
}

export async function downloadImageOcrLanguagesWithOffscreen(languages: ImageOcrLanguageCode[]): Promise<void> {
    await ensureOffscreenDocument();

    const response = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: 'FLUENT_READ_IMAGE_OCR_DOWNLOAD_OFFSCREEN',
            languages,
        }, (result: any) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(result);
            }
        });
    });

    if (!response?.success) throw new Error(response?.error || '图片 OCR 语言包下载失败');
}

// 主翻译函数
export default async function chromeTranslator(message: any): Promise<any> {
    // console.log('Chrome Translator 收到消息:', message);

    const text = message.origin;
    
    if (!text || typeof text !== 'string' || text.trim() === '') {
        // console.error('翻译文本为空或无效:', { text, type: typeof text, message });
        throw new Error('翻译文本不能为空');
    }

    // 检查是否在 background script 环境中
    if (typeof window === 'undefined') {
        // console.log('在 background script 中，使用 offscreen API');
        // 在 background script 中，使用 offscreen API
        return await translateWithOffscreen(message);
    }

    // 如果在其他环境中，抛出错误
    throw new Error('Chrome Translation API 只能在 Google Chrome 浏览器 v138 stable 版本以上使用');
}
