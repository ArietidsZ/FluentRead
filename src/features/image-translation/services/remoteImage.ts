/**
 * @file src/features/image-translation/services/remoteImage.ts
 * 文件职责：在 Offscreen 文档中受控读取 X/Twitter 媒体图片，把跨域响应转换为 OCR 可消费的 data URL。
 * 主要内容：限制 HTTPS 媒体域、拒绝重定向与异常 MIME、限制 16 MiB 响应和 15 秒总时限，并支持调用方取消。
 * 模块边界：本文件不监听 runtime 消息、不读取页面 DOM；消息路由和 Offscreen 生命周期由 app 层负责，内容脚本只能拿到最终 data URL。
 */

export const MAX_REMOTE_IMAGE_BYTES = 16 * 1024 * 1024;
export const REMOTE_IMAGE_TIMEOUT_MS = 15_000;

const SUPPORTED_X_MEDIA_HOST = 'twimg.com';

export interface RemoteImageResponse {
    readonly ok: boolean;
    readonly status: number;
    readonly url?: string;
    readonly headers: {
        get(name: string): string | null;
    };
    readonly body?: ReadableStream<Uint8Array> | null;
    arrayBuffer(): Promise<ArrayBuffer>;
}

export type RemoteImageRequest = (
    url: string,
    init: {credentials: 'omit'; redirect: 'error'; signal: AbortSignal},
) => Promise<RemoteImageResponse>;

function isSupportedXMediaHost(hostname: string): boolean {
    const host = hostname.replace(/\.$/u, '').toLowerCase();
    return host === SUPPORTED_X_MEDIA_HOST || host.endsWith(`.${SUPPORTED_X_MEDIA_HOST}`);
}

function createRemoteImageAbortError(): Error {
    const error = new Error('远程图片读取已取消');
    error.name = 'AbortError';
    return error;
}

/** 将页面提供的 URL 收窄为 X/Twitter HTTPS 媒体地址，避免建立任意 URL 代抓入口。 */
export function normalizeRemoteImageUrl(source: string): string {
    let url: URL;
    try {
        url = new URL(source);
    } catch {
        throw new Error('图片地址无效');
    }

    if (url.protocol !== 'https:') throw new Error('只支持 HTTPS 的 X/Twitter 媒体图片');
    if (url.username || url.password || url.port) throw new Error('图片地址不能包含凭据或自定义端口');
    if (!isSupportedXMediaHost(url.hostname)) throw new Error('暂不支持该跨域图片来源');
    return url.href;
}

/** 即使请求适配器返回了不同的最终地址，也再次执行媒体域和 HTTPS 校验。 */
export function validateRemoteImageResponseUrl(initialUrl: string, responseUrl?: string): string {
    const normalizedInitial = normalizeRemoteImageUrl(initialUrl);
    const normalizedFinal = normalizeRemoteImageUrl(responseUrl || normalizedInitial);
    if (normalizedInitial !== normalizedFinal) throw new Error('X/Twitter 图片不允许重定向');
    return normalizedFinal;
}

export function normalizeRemoteImageMimeType(contentType: string): string {
    const mimeType = contentType.split(';', 1)[0]?.trim().toLowerCase();
    if (!mimeType?.startsWith('image/')) throw new Error('远程地址不是图片');
    return mimeType;
}

export function imageBufferToDataUrl(buffer: ArrayBuffer, contentType: string): string {
    if (buffer.byteLength > MAX_REMOTE_IMAGE_BYTES) throw new Error('图片文件过大');

    const mimeType = normalizeRemoteImageMimeType(contentType);
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return `data:${mimeType};base64,${btoa(binary)}`;
}

function discardResponseBody(response: RemoteImageResponse, reason: unknown): void {
    if (response.body) void response.body.cancel(reason).catch(() => undefined);
}

async function readResponseBuffer(
    response: RemoteImageResponse,
    abortPromise: Promise<never>,
): Promise<ArrayBuffer> {
    if (!response.body) return Promise.race([response.arrayBuffer(), abortPromise]);

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    try {
        while (true) {
            const {done, value} = await Promise.race([reader.read(), abortPromise]);
            if (done) break;
            if (!value || value.byteLength === 0) continue;
            byteLength += value.byteLength;
            if (byteLength > MAX_REMOTE_IMAGE_BYTES) throw new Error('图片文件过大');
            chunks.push(value);
        }
    } catch (error) {
        void reader.cancel(error).catch(() => undefined);
        throw error;
    } finally {
        try {
            reader.releaseLock();
        } catch {
            // 取消中的 reader 可能仍有未完成 read；底层 fetch signal 已负责终止传输。
        }
    }

    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes.buffer;
}

/** 在 Offscreen 内读取 X/Twitter 图片；redirect:error 确保不会在校验前访问第二跳。 */
export async function fetchRemoteImageForOcr(
    source: string,
    request: RemoteImageRequest,
    callerSignal?: AbortSignal,
): Promise<string> {
    const url = normalizeRemoteImageUrl(source);
    if (callerSignal?.aborted) throw createRemoteImageAbortError();

    const controller = new AbortController();
    const timeoutError = new Error('远程图片读取超时');
    let abortReason: Error | null = null;
    let rejectAbort!: (reason: Error) => void;
    const abortPromise = new Promise<never>((_resolve, reject) => {
        rejectAbort = reject;
    });
    const abortWith = (reason: Error): void => {
        if (abortReason) return;
        abortReason = reason;
        controller.abort();
        rejectAbort(reason);
    };
    const onCallerAbort = () => abortWith(createRemoteImageAbortError());
    callerSignal?.addEventListener('abort', onCallerAbort, {once: true});
    const timer = setTimeout(() => abortWith(timeoutError), REMOTE_IMAGE_TIMEOUT_MS);

    try {
        const responseWork = request(url, {
            credentials: 'omit',
            // Fetch 的 manual 模式无法安全检查 Location；error 模式会在第二跳前失败。
            redirect: 'error',
            signal: controller.signal,
        });
        void responseWork.then((lateResponse) => {
            if (controller.signal.aborted) discardResponseBody(lateResponse, abortReason!);
        }, () => undefined);
        const response = await Promise.race([responseWork, abortPromise]);
        try {
            validateRemoteImageResponseUrl(url, response.url);
        } catch (error) {
            discardResponseBody(response, error);
            throw error;
        }
        if (!response.ok) {
            const error = new Error(`图片服务器返回 ${response.status}`);
            discardResponseBody(response, error);
            throw error;
        }

        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > MAX_REMOTE_IMAGE_BYTES) {
            const error = new Error('图片文件过大');
            discardResponseBody(response, error);
            throw error;
        }

        let mimeType: string;
        try {
            mimeType = normalizeRemoteImageMimeType(response.headers.get('content-type') || '');
        } catch (error) {
            discardResponseBody(response, error);
            throw error;
        }
        const buffer = await readResponseBuffer(response, abortPromise);
        return imageBufferToDataUrl(buffer, mimeType);
    } finally {
        clearTimeout(timer);
        callerSignal?.removeEventListener('abort', onCallerAbort);
    }
}

/** Offscreen 的真实网络端口；调用方只接收已校验的 data URL。 */
export function fetchImageInOffscreen(source: string, signal: AbortSignal): Promise<string> {
    return fetchRemoteImageForOcr(source, (url, init) => fetch(url, init), signal);
}
