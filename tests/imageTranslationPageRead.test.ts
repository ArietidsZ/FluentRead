import {afterEach, describe, expect, it, vi} from 'vitest';

const remote = vi.hoisted(() => vi.fn());
vi.mock('@/src/services/config/store', () => ({config: {on: true, from: 'auto'}}));
vi.mock('@/src/features/image-translation/services/client', () => ({fetchImageInExtension: remote}));
import {getImageData, readPageImageInCors} from '@/src/features/image-translation/content/runtime';
import {MAX_REMOTE_IMAGE_BYTES} from '@/src/features/image-translation/services/remoteImage';

function canvasFixture(width = 400, height = 200, readable = true) {
    const context = {drawImage: vi.fn(), getImageData: vi.fn(() => {
        if (!readable) throw new DOMException('Tainted canvas', 'SecurityError');
        return {};
    })};
    const canvas = {width: 0, height: 0, getContext: vi.fn(() => context), toDataURL: vi.fn(() => 'data:image/png;base64,local')};
    const image = {naturalWidth: width, naturalHeight: height, currentSrc: 'https://images.example.test/photo.png', src: 'https://images.example.test/photo.png'} as HTMLImageElement;
    vi.stubGlobal('document', {createElement: vi.fn(() => canvas)});
    return {canvas, context, image};
}

afterEach(() => {remote.mockReset(); vi.unstubAllGlobals();});

describe('图片像素读取与网页 CORS 权限', () => {
    it('大图先按 16MP / 8192 边长缩放再分配读取区域，处理后释放 Canvas', async () => {
        const env = canvasFixture(20_000, 10_000);
        await expect(getImageData(env.image)).resolves.toBe('data:image/png;base64,local');
        expect(env.context.drawImage).toHaveBeenCalledWith(env.image, 0, 0, 5656, 2828);
        expect(env.canvas.width).toBe(0); expect(env.canvas.height).toBe(0);
        const wide = canvasFixture(40_000, 100);
        await getImageData(wide.image);
        expect(wide.context.drawImage).toHaveBeenCalledWith(wide.image, 0, 0, 8192, 20);
    });

    it('可读图片不联网，已取消或未加载的图片不创建 Canvas', async () => {
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        const env = canvasFixture(); await getImageData(env.image);
        expect(fetch).not.toHaveBeenCalled(); expect(remote).not.toHaveBeenCalled();
        const controller = new AbortController(); controller.abort();
        await expect(getImageData(env.image, {signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
        await expect(getImageData({...env.image, naturalWidth: 0} as HTMLImageElement)).rejects.toThrow('尚未加载');
        expect(document.createElement).toHaveBeenCalledOnce();
    });

    it('无 crossOrigin 导致的污染先用网页 CORS 重读，成功后无需调用扩展权限', async () => {
        const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2]), {headers: {'content-type': 'image/png'}}));
        vi.stubGlobal('fetch', fetch);
        const env = canvasFixture(400, 200, false); const controller = new AbortController();
        await expect(getImageData(env.image, {signal: controller.signal})).resolves.toBe('data:image/png;base64,AQI=');
        expect(fetch).toHaveBeenCalledWith(env.image.src, {mode: 'cors', credentials: 'omit', signal: controller.signal});
        expect(remote).not.toHaveBeenCalled();
    });

    it('页面 CORS 被拒绝才交给现有后台白名单，取消后不能触发该回退', async () => {
        const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')); vi.stubGlobal('fetch', fetch);
        remote.mockResolvedValue('data:image/png;base64,remote');
        const env = canvasFixture(400, 200, false);
        await expect(getImageData(env.image)).resolves.toBe('data:image/png;base64,remote');
        expect(remote).toHaveBeenCalledWith(env.image.src, {});
        remote.mockClear(); const controller = new AbortController();
        fetch.mockImplementationOnce(async () => {controller.abort(); throw new Error('aborted');});
        await expect(getImageData(env.image, {signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
        expect(remote).not.toHaveBeenCalled();
    });

    it('拒绝错误状态、非图片 MIME 和超限 Content-Length，并取消响应体', async () => {
        for (const [status, headers, message] of [
            [403, {'content-type': 'image/png'}, '403'],
            [200, {'content-type': 'text/html'}, '不是图片'],
            [200, {'content-type': 'image/png', 'content-length': String(MAX_REMOTE_IMAGE_BYTES + 1)}, '过大'],
        ] as const) {
            const cancel = vi.fn().mockResolvedValue(undefined);
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: status === 200, status, headers: new Headers(headers), body: {cancel}}));
            await expect(readPageImageInCors('https://images.example.test/photo.png')).rejects.toThrow(message);
            expect(cancel).toHaveBeenCalledOnce();
        }
    });

    it('无 Content-Length 的流按累计字节限额中断，读取错误清理 reader', async () => {
        const cancel = vi.fn().mockResolvedValue(undefined); const releaseLock = vi.fn();
        const read = vi.fn().mockResolvedValueOnce({done: false, value: new Uint8Array(MAX_REMOTE_IMAGE_BYTES)})
            .mockResolvedValueOnce({done: false, value: new Uint8Array([1])});
        const response = {ok: true, headers: new Headers({'content-type': 'image/png'}), body: {getReader: () => ({read, cancel, releaseLock})}};
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
        await expect(readPageImageInCors('https://images.example.test/photo.png')).rejects.toThrow('过大');
        expect(cancel).toHaveBeenCalledOnce(); expect(releaseLock).toHaveBeenCalledOnce();
        read.mockReset().mockRejectedValue(new Error('network failed'));
        await expect(readPageImageInCors('https://images.example.test/photo.png')).rejects.toThrow('network failed');
        expect(cancel).toHaveBeenCalledTimes(2); expect(releaseLock).toHaveBeenCalledTimes(2);
    });

    it('兼容无流响应并检查文件大小，预先取消时不发请求', async () => {
        const fetch = vi.fn().mockResolvedValue({ok: true, headers: new Headers({'content-type': 'IMAGE/PNG; charset=utf8'}), body: null, arrayBuffer: async () => new Uint8Array([3]).buffer});
        vi.stubGlobal('fetch', fetch);
        await expect(readPageImageInCors('https://images.example.test/photo.png')).resolves.toBe('data:image/png;base64,Aw==');
        const controller = new AbortController(); controller.abort();
        await expect(readPageImageInCors('https://images.example.test/photo.png', controller.signal)).rejects.toMatchObject({name: 'AbortError'});
        expect(fetch).toHaveBeenCalledOnce();
    });
});
