import {describe, expect, it, vi} from 'vitest';

import {createImageOcrLanguageRepository} from '@/src/features/image-translation/background/ocrLanguageRepository';
import {fetchRemoteImageForOcr, type RemoteImageResponse} from '@/src/features/image-translation/background/remoteImageFetcher';
import {IMAGE_OCR_LANGUAGE_STATE_KEY} from '@/src/features/image-translation/ocrLanguages';
import {MAX_REMOTE_IMAGE_BYTES} from '@/src/features/image-translation/services/remoteImage';

function response(options: {
    ok?: boolean;
    status?: number;
    contentType?: string | null;
    contentLength?: string | null;
    bytes?: number[];
} = {}): RemoteImageResponse {
    const headers = new Map<string, string>();
    if (options.contentType !== null) headers.set('content-type', options.contentType ?? 'image/png');
    if (options.contentLength !== null) headers.set('content-length', options.contentLength ?? '2');
    return {
        ok: options.ok ?? true,
        status: options.status ?? 200,
        headers: {get: (name) => headers.get(name) ?? null},
        arrayBuffer: async () => new Uint8Array(options.bytes ?? [1, 2]).buffer,
    };
}

describe('图片后台服务', () => {
    it('OCR 语言仓库归一化读取并合并持久化下载状态', async () => {
        const get = vi.fn(async () => ({
            [IMAGE_OCR_LANGUAGE_STATE_KEY]: ['eng', 'bad', 'eng'],
        }));
        const set = vi.fn(async () => undefined);
        const repository = createImageOcrLanguageRepository({get, set});

        await expect(repository.getDownloaded()).resolves.toEqual(['eng']);
        await expect(repository.markDownloaded(['chi_sim', 'eng'])).resolves.toEqual(['eng', 'chi_sim']);
        expect(get).toHaveBeenCalledWith(IMAGE_OCR_LANGUAGE_STATE_KEY);
        expect(set).toHaveBeenCalledWith({
            [IMAGE_OCR_LANGUAGE_STATE_KEY]: ['eng', 'chi_sim'],
        });
    });

    it('OCR 语言仓库允许已安装组合并报告缺失语言包中文名', async () => {
        const storage = {
            get: vi.fn(async (): Promise<Record<string, unknown>> => ({
                [IMAGE_OCR_LANGUAGE_STATE_KEY]: ['eng'],
            })),
            set: vi.fn(async () => undefined),
        };
        const repository = createImageOcrLanguageRepository(storage);

        await expect(repository.assertDownloaded('en')).resolves.toBeUndefined();
        await expect(repository.assertDownloaded('zh-Hans')).rejects.toThrow(
            '图片文字识别需要先下载简体中文语言包，请前往设置 > 图片翻译下载',
        );
        storage.get.mockResolvedValueOnce({});
        await expect(repository.assertDownloaded('auto')).rejects.toThrow('简体中文、English');
    });

    it('远程图片读取固定隐私选项并转换为 data URL', async () => {
        const request = vi.fn(async () => response({contentLength: null, bytes: [0, 255]}));
        await expect(fetchRemoteImageForOcr('https://example.com/a.png', request))
            .resolves.toBe('data:image/png;base64,AP8=');
        expect(request).toHaveBeenCalledWith(
            'https://example.com/a.png',
            {credentials: 'omit', redirect: 'follow'},
        );
    });

    it('远程图片读取拒绝 HTTP 失败、声明过大和非图片响应', async () => {
        await expect(fetchRemoteImageForOcr(
            'https://example.com/a.png',
            async () => response({ok: false, status: 403}),
        )).rejects.toThrow('图片服务器返回 403');
        await expect(fetchRemoteImageForOcr(
            'https://example.com/a.png',
            async () => response({contentLength: String(MAX_REMOTE_IMAGE_BYTES + 1)}),
        )).rejects.toThrow('图片文件过大');
        await expect(fetchRemoteImageForOcr(
            'https://example.com/a.png',
            async () => response({contentType: null}),
        )).rejects.toThrow('远程地址不是图片');
    });
});
