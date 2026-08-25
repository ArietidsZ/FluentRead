/**
 * @file src/features/image-translation/services/remoteImage.ts
 * 文件职责：定义远程图片抓取的纯安全规则，把候选 URL 限制为允许的 HTTP(S) 地址，并将受限字节响应编码为 OCR 可消费的 data URL。
 * 主要内容：包含 16 MiB 最大响应常量、normalizeRemoteImageUrl 对协议和凭据的校验，以及 imageBufferToDataUrl 对 image Content-Type 和 ArrayBuffer 的 Base64 转换。
 * 模块边界：本文件不发起网络请求、不跟随重定向也不读取页面 DOM；后台 remoteImageFetcher 负责受控 fetch 和响应上限，内容页只能通过扩展消息获得结果。
 */
export const MAX_REMOTE_IMAGE_BYTES = 16 * 1024 * 1024;

export function normalizeRemoteImageUrl(source: string): string {
    let url: URL;
    try {
        url = new URL(source);
    } catch {
        throw new Error('图片地址无效');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('只支持网页图片地址');
    }

    return url.href;
}

export function imageBufferToDataUrl(buffer: ArrayBuffer, contentType: string): string {
    if (buffer.byteLength > MAX_REMOTE_IMAGE_BYTES) {
        throw new Error('图片文件过大');
    }

    const mimeType = contentType.split(';', 1)[0]?.trim().toLowerCase();
    if (!mimeType?.startsWith('image/')) {
        throw new Error('远程地址不是图片');
    }

    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }

    return `data:${mimeType};base64,${btoa(binary)}`;
}
