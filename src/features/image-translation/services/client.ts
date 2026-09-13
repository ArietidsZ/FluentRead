/**
 * @file src/features/image-translation/services/client.ts
 * 文件职责：封装网页与扩展页面调用图片翻译后台的 runtime 消息，统一支持跨域图片读取与整图翻译两种可取消客户端操作。
 * 主要内容：提供 fetchImageInExtension 与 translateImageInExtension，生成跨页面安全请求标识，传播取消和超时信号，订阅当前任务的真实阶段和识别百分比、清理监听，并在图片翻译消息断线时按共享截止时间恢复一次。
 * 模块边界：客户端不读取图片像素、不直接访问网络或 Offscreen；跨域 URL 只作为受控消息交给 background，再由 Offscreen 校验和读取，页面 UI 由 content/runtime 决定。
 */
import {getRequiredImageOcrLanguages} from '../ocrLanguages';
import {IMAGE_PROGRESS_MESSAGE_TYPE, isImageTranslationStage, normalizeImageProgress, type ImageTranslationStage} from '../progress';
import type { OcrLine } from '@/src/features/image-translation/core';

interface ImageTranslationLine extends OcrLine {
    backgroundColor: string;
}

interface ImageTranslationResponse {
    success: boolean;
    image?: string;
    lines?: ImageTranslationLine[];
    error?: string;
}

interface ImageFetchResponse {
    success: boolean;
    image?: string;
    error?: string;
}

export interface ImageExtensionOperationOptions {
    readonly requestId?: string;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
    readonly onProgress?: (stage: ImageTranslationStage, progress?: number) => void;
}

const DEFAULT_IMAGE_OPERATION_TIMEOUT_MS = 180_000;
let imageRequestSequence = 0;
const imageRequestContextNonce = (() => {
    try {
        const random = new Uint32Array(4);
        globalThis.crypto.getRandomValues(random);
        return Array.from(random, value => value.toString(36)).join('-');
    } catch {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }
})();

function createImageRequestId(): string {
    const randomUuid = globalThis.crypto?.randomUUID?.();
    if (randomUuid) return `image-${randomUuid}`;
    imageRequestSequence += 1;
    return `image-${imageRequestContextNonce}-${imageRequestSequence}`;
}

function createImageClientError(message: string, name: 'AbortError' | 'TimeoutError'): Error {
    const error = new Error(message);
    error.name = name;
    return error;
}

const IMAGE_TRANSLATION_CONNECTION_ERROR = '图片翻译连接中断，请重试；如果仍然失败，请刷新页面后再试';
const IMAGE_TRANSLATION_CONTEXT_ERROR = '扩展上下文已失效，请刷新页面后再试';

function isContextInvalidatedError(error: unknown): boolean {
    return error instanceof Error && /extension context invalidated|扩展上下文已失效/iu.test(error.message);
}

function isDisconnectedMessage(message: unknown): boolean {
    return typeof message === 'string'
        && /channel closed|message port closed|receiving end does not exist|could not establish connection/iu.test(message);
}

function isDisconnectedError(error: unknown): boolean {
    return !isContextInvalidatedError(error)
        && error instanceof Error
        && error.name !== 'AbortError'
        && error.name !== 'TimeoutError'
        && isDisconnectedMessage(error.message);
}

function normalizeImageTimeout(value: number | undefined): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(1, Math.min(300_000, Math.floor(value)))
        : DEFAULT_IMAGE_OPERATION_TIMEOUT_MS;
}

function remainingTimeout(deadlineAt: number): number {
    return Math.max(0, deadlineAt - Date.now());
}

function normalizeTranslationTransportError(error: unknown): Error {
    if (isContextInvalidatedError(error)) return new Error(IMAGE_TRANSLATION_CONTEXT_ERROR);
    return new Error(IMAGE_TRANSLATION_CONNECTION_ERROR);
}

export async function sendCancellableImageOperation<TResponse>(
    message: Record<string, unknown>,
    options: ImageExtensionOperationOptions,
    timeoutMessage: string,
    cancelMessageType = 'fluentReadImageCancel',
): Promise<TResponse | undefined> {
    const requestId = options.requestId || createImageRequestId();
    const timeoutMs = normalizeImageTimeout(options.timeoutMs);
    if (options.signal?.aborted) throw createImageClientError('图片 OCR 请求已取消', 'AbortError');

    return new Promise<TResponse | undefined>((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cleanup = () => {
            if (timer !== undefined) clearTimeout(timer);
            options.signal?.removeEventListener('abort', handleAbort);
            if (options.onProgress) browser.runtime.onMessage.removeListener(handleProgress);
        };
        const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            cleanup();
            callback();
        };
        const notifyCancellation = () => {
            try {
                void Promise.resolve(browser.runtime.sendMessage({type: cancelMessageType, requestId})).catch(() => undefined);
            } catch {
                // 扩展销毁时消息可能同步失败，本地取消仍必须结束等待。
            }
        };
        const handleProgress = (value: unknown) => {
            if (settled || !value || typeof value !== 'object') return;
            const progress = value as Record<string, unknown>;
            if (progress.type === IMAGE_PROGRESS_MESSAGE_TYPE && progress.requestId === requestId
                && isImageTranslationStage(progress.stage)) {
                try { options.onProgress?.(progress.stage, normalizeImageProgress(progress.progress)); } catch { /* 展示旁路不能中断请求清理。 */ }
            }
        };
        if (options.onProgress) browser.runtime.onMessage.addListener(handleProgress);
        const handleAbort = () => finish(() => {
            notifyCancellation();
            reject(createImageClientError('图片 OCR 请求已取消', 'AbortError'));
        });
        options.signal?.addEventListener('abort', handleAbort, {once: true});
        timer = setTimeout(() => finish(() => {
            notifyCancellation();
            reject(createImageClientError(timeoutMessage, 'TimeoutError'));
        }), timeoutMs);
        try {
            void browser.runtime.sendMessage({...message, requestId, timeoutMs}).then(
                (response: unknown) => finish(() => resolve(response as TResponse | undefined)),
                (error: unknown) => finish(() => reject(error)),
            );
        } catch (error) {
            finish(() => reject(error));
        }
    });
}

export async function fetchImageInExtension(
    imageUrl: string,
    options: ImageExtensionOperationOptions = {},
): Promise<string> {
    const response = await sendCancellableImageOperation<ImageFetchResponse>({
        type: 'fluentReadImageFetch',
        url: imageUrl,
    }, options, '远程图片读取超时');

    if (!response?.success || typeof response.image !== 'string' || !response.image.startsWith('data:image/')) {
        throw new Error(response?.error || '远程图片读取失败');
    }
    return response.image;
}

export async function translateImageInExtension(
    image: string,
    sourceLanguage: string,
    title: string,
    options: ImageExtensionOperationOptions = {},
): Promise<{ image: string; lines: ImageTranslationLine[] }> {
    const message = {
        type: 'fluentReadImageTranslate',
        image,
        sourceLanguage,
        title,
    };
    const timeoutMs = normalizeImageTimeout(options.timeoutMs);
    if (options.signal?.aborted) throw createImageClientError('图片 OCR 请求已取消', 'AbortError');
    const deadlineAt = Date.now() + timeoutMs;
    let requestId = options.requestId || createImageRequestId();
    for (let attempt = 0; ; attempt += 1) {
        if (options.signal?.aborted) throw createImageClientError('图片 OCR 请求已取消', 'AbortError');
        const remainingMs = remainingTimeout(deadlineAt);
        if (remainingMs <= 0) throw createImageClientError('图片翻译超时', 'TimeoutError');
        try {
            const response = await sendCancellableImageOperation<ImageTranslationResponse>(
                message, {...options, requestId, timeoutMs: remainingMs}, '图片翻译超时',
            );
            if (!response?.success || !response.image || !Array.isArray(response.lines)) {
                throw new Error(response?.error || '图片翻译服务不可用');
            }
            return {image: response.image, lines: response.lines};
        } catch (error) {
            if (isContextInvalidatedError(error)) throw normalizeTranslationTransportError(error);
            if (!isDisconnectedError(error)) throw error;
            if (options.signal?.aborted) throw createImageClientError('图片 OCR 请求已取消', 'AbortError');
            if (remainingTimeout(deadlineAt) <= 0) throw createImageClientError('图片翻译超时', 'TimeoutError');
            if (attempt === 1) throw normalizeTranslationTransportError(error);
            // 通道可能只丢失了回复；先释放旧任务，再用新身份恢复，避免旧进度与新结果串线。
            try {
                void Promise.resolve(browser.runtime.sendMessage({type: 'fluentReadImageCancel', requestId})).catch(() => undefined);
            } catch { /* 扩展重载时清理消息可能同步失败，仍受原取消信号和截止时间约束。 */ }
            requestId = createImageRequestId();
        }
    }
}

/** 用户主动准备语言后继续原图片任务，复用设置页的下载与持久化路径。 */
export async function prepareImageOcrLanguages(sourceLanguage: string, signal?: AbortSignal): Promise<void> {
    const response = await sendCancellableImageOperation<{success?: boolean; error?: string}>({
        type: 'fluentReadImageOcrDownload', languages: getRequiredImageOcrLanguages(sourceLanguage),
    }, {signal, timeoutMs: 300_000}, '语言包准备超时，请检查网络后重试');
    if (!response?.success) throw new Error(response?.error || '语言包准备失败');
}
