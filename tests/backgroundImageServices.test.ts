import {describe, expect, it, vi} from 'vitest';

import {createImageOcrLanguageRepository} from '@/src/features/image-translation/background/ocrLanguageRepository';
import {IMAGE_OCR_LANGUAGE_STATE_KEY} from '@/src/features/image-translation/ocrLanguages';

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

    it('OCR 语言仓库串行合并并发下载结果，避免后写覆盖先写', async () => {
        let downloaded: unknown = [];
        let releaseFirstWrite!: () => void;
        const firstWriteStarted = new Promise<void>((resolve) => {
            releaseFirstWrite = resolve;
        });
        let allowFirstWrite!: () => void;
        const firstWriteGate = new Promise<void>((resolve) => {
            allowFirstWrite = resolve;
        });
        let writeCount = 0;
        const storage = {
            get: vi.fn(async (): Promise<Record<string, unknown>> => ({
                [IMAGE_OCR_LANGUAGE_STATE_KEY]: downloaded,
            })),
            set: vi.fn(async (values: Record<string, unknown>) => {
                writeCount += 1;
                if (writeCount === 1) {
                    releaseFirstWrite();
                    await firstWriteGate;
                }
                downloaded = values[IMAGE_OCR_LANGUAGE_STATE_KEY];
            }),
        };
        const repository = createImageOcrLanguageRepository(storage);

        const english = repository.markDownloaded(['eng']);
        await firstWriteStarted;
        const chinese = repository.markDownloaded(['chi_sim']);
        await Promise.resolve();
        expect(storage.get).toHaveBeenCalledOnce();

        allowFirstWrite();
        await expect(english).resolves.toEqual(['eng']);
        await expect(chinese).resolves.toEqual(['eng', 'chi_sim']);
        expect(downloaded).toEqual(['eng', 'chi_sim']);
        expect(storage.get).toHaveBeenCalledTimes(2);
    });

    it('OCR 语言仓库在一次持久化失败后仍会继续后续合并', async () => {
        let downloaded: unknown = ['eng'];
        const storage = {
            get: vi.fn(async (): Promise<Record<string, unknown>> => ({
                [IMAGE_OCR_LANGUAGE_STATE_KEY]: downloaded,
            })),
            set: vi.fn()
                .mockRejectedValueOnce(new Error('write failed'))
                .mockImplementationOnce(async (values: Record<string, unknown>) => {
                    downloaded = values[IMAGE_OCR_LANGUAGE_STATE_KEY];
                }),
        };
        const repository = createImageOcrLanguageRepository(storage);

        await expect(repository.markDownloaded(['chi_sim'])).rejects.toThrow('write failed');
        await expect(repository.markDownloaded(['jpn'])).resolves.toEqual(['eng', 'jpn']);
        expect(downloaded).toEqual(['eng', 'jpn']);
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
});
