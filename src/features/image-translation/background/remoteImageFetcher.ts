/**
 * @file src/features/image-translation/background/remoteImageFetcher.ts
 * 文件职责：在后台网络权限边界中安全读取网页图片，为受 CORS 限制的内容脚本把允许的远程图片转换成可供 OCR 使用的 data URL。
 * 主要内容：定义 RemoteImageResponse 与可注入请求函数，先规范化 URL，再执行带响应体大小限制的请求，校验 image/* Content-Type 并调用 imageBufferToDataUrl。
 * 模块边界：该文件不接受任意协议、不解析图片像素也不显示结果；URL 与字节转换规则归 services/remoteImage，HTTP 实现由调用方注入，内容页仅经消息客户端访问。
 */
import {
    imageBufferToDataUrl,
    MAX_REMOTE_IMAGE_BYTES,
    normalizeRemoteImageUrl,
} from '@/src/features/image-translation/services/remoteImage';

export interface RemoteImageResponse {
    readonly ok: boolean;
    readonly status: number;
    readonly headers: {
        get(name: string): string | null;
    };
    arrayBuffer(): Promise<ArrayBuffer>;
}

export type RemoteImageRequest = (
    url: string,
    init: {credentials: 'omit'; redirect: 'follow'},
) => Promise<RemoteImageResponse>;

/** 读取远程图片；URL、响应状态、声明大小和实际 MIME/大小逐层验证。 */
export async function fetchRemoteImageForOcr(
    source: string,
    request: RemoteImageRequest,
): Promise<string> {
    const url = normalizeRemoteImageUrl(source);
    const response = await request(url, {credentials: 'omit', redirect: 'follow'});
    if (!response.ok) throw new Error(`图片服务器返回 ${response.status}`);

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_REMOTE_IMAGE_BYTES) throw new Error('图片文件过大');

    const contentType = response.headers.get('content-type') || '';
    const buffer = await response.arrayBuffer();
    return imageBufferToDataUrl(buffer, contentType);
}
