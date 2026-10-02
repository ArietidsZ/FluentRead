/**
 * @file src/features/image-translation/content/sourceAuthorization.ts
 * 文件职责：为单次图片读取建立页面私有的短期授权，只让后台复核当前已选中的图片。
 * 主要内容：使用随机 requestId 绑定 document、图片元素与 currentSrc；响应本扩展后台的精确核验，结束、取消、换图或移除后不再授权。
 * 模块边界：本文件不联网、不执行 OCR、不改变宿主 DOM；后台验证和 Offscreen 字节读取各自执行独立边界校验。
 */
export const IMAGE_SOURCE_VALIDATION_MESSAGE_TYPE = 'fluentReadImageValidateSource';

/** 监听器只存在于扩展抓图等待期间，页面脚本无法取得请求标识或封闭的图片引用。 */
export async function withImageSourceAuthorization<T>(
    image: HTMLImageElement,
    source: string,
    signal: AbortSignal | undefined,
    operation: (requestId: string) => Promise<T>,
): Promise<T> {
    const nonce = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(36)).join('-');
    const requestId = `image-source-${nonce}`;
    const documentUrl = document.URL;
    const identity = [image.getAttribute('src'), image.getAttribute('srcset'), image.getAttribute('sizes')];
    const listener = (message: unknown, sender: {id?: string; tab?: unknown}, respond: (value: unknown) => void): boolean => {
        if (!message || typeof message !== 'object') return false;
        const payload = message as Record<string, unknown>;
        if (payload.type !== IMAGE_SOURCE_VALIDATION_MESSAGE_TYPE || payload.requestId !== requestId
            || sender.id !== browser.runtime.id || sender.tab) return false;
        respond({valid: !signal?.aborted && image.isConnected
            && document.URL === documentUrl && payload.documentUrl === documentUrl
            && payload.url === source && (image.currentSrc || image.src) === source
            && [image.getAttribute('src'), image.getAttribute('srcset'), image.getAttribute('sizes')]
                .every((value, index) => value === identity[index])});
        return false;
    };
    const cleanup = () => browser.runtime.onMessage.removeListener(listener);
    if (signal?.aborted) throw Object.assign(new Error('图片翻译已取消'), {name: 'AbortError'});
    browser.runtime.onMessage.addListener(listener);
    signal?.addEventListener('abort', cleanup, {once: true});
    try { return await operation(requestId); }
    finally { cleanup(); signal?.removeEventListener('abort', cleanup); }
}
