import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    config: {service: 'microsoft'},
    translateText: vi.fn(),
    translateTextBatch: vi.fn(),
}));

vi.mock('@/entrypoints/utils/config', () => ({
    config: mocks.config,
    configReady: Promise.resolve(),
}));

vi.mock('@/entrypoints/utils/option', () => ({
    services: {microsoft: 'microsoft', freeTranslation: 'freeTranslation'},
}));

vi.mock('@/entrypoints/utils/translateApi', () => ({
    translateText: mocks.translateText,
    translateTextBatch: mocks.translateTextBatch,
}));

import {translateDocumentSegments} from '@/entrypoints/utils/documentTranslationApi';

beforeEach(() => {
    mocks.config.service = 'microsoft';
    mocks.translateText.mockReset();
    mocks.translateTextBatch.mockReset();
});

describe('document translation API', () => {
    it('对机器翻译服务按大小分批，并报告完整进度', async () => {
        const segments = Array.from({length: 17}, (_, id) => ({id, source: `Source ${id}`}));
        const progress: number[] = [];
        mocks.translateTextBatch.mockImplementation(async (origins: string[]) => origins.map((origin) => `T:${origin}`));

        const result = await translateDocumentSegments(segments, {
            fileName: 'sample.txt',
            onProgress: ({completed}) => progress.push(completed),
        });

        expect(mocks.translateTextBatch).toHaveBeenCalledTimes(2);
        expect(result[0]).toBe('T:Source 0');
        expect(result[16]).toBe('T:Source 16');
        expect(progress.at(-1)).toBe(17);
        expect(mocks.translateText).not.toHaveBeenCalled();
    });

    it('对 AI 服务使用逐段翻译，避免把数组隐式拼成一个请求', async () => {
        mocks.config.service = 'openai';
        mocks.translateText.mockImplementation(async (origin: string) => `T:${origin}`);
        const segments = [
            {id: 0, source: 'First'},
            {id: 1, source: 'Second'},
            {id: 2, source: 'Third'},
        ];

        await expect(translateDocumentSegments(segments, {fileName: 'sample.md'})).resolves.toEqual([
            'T:First',
            'T:Second',
            'T:Third',
        ]);
        expect(mocks.translateText).toHaveBeenCalledTimes(3);
        expect(mocks.translateTextBatch).not.toHaveBeenCalled();
    });

    it('传递文档入口独立的服务和模型，不复用网页当前模型', async () => {
        mocks.config.service = 'microsoft';
        mocks.translateText.mockImplementation(async (origin: string) => `T:${origin}`);

        await translateDocumentSegments([{id: 0, source: 'Document source'}], {
            fileName: 'sample.md',
            serviceOverride: 'openai',
            modelOverride: 'gpt-document-model',
        });

        expect(mocks.translateText).toHaveBeenCalledWith('Document source', 'sample.md', expect.objectContaining({
            serviceOverride: 'openai',
            modelOverride: 'gpt-document-model',
        }));
    });

    it('在单段失败时报告可定位的片段序号', async () => {
        mocks.config.service = 'openai';
        mocks.translateText.mockRejectedValue(new Error('provider unavailable'));

        await expect(translateDocumentSegments([{id: 0, source: 'Broken'}], {fileName: 'sample.json'}))
            .rejects.toThrow('第 1 段文档翻译失败：provider unavailable');
    });

    it('AI 并行 worker 首次失败后不再派发余下段落或继续报告进度', async () => {
        mocks.config.service = 'openai';
        const releaseSlowRequests: Array<() => void> = [];
        const progress: number[] = [];
        mocks.translateText.mockImplementation((origin: string) => {
            if (origin === 'fail') return Promise.reject(new Error('provider unavailable'));
            return new Promise<string>((resolve) => {
                releaseSlowRequests.push(() => resolve(`T:${origin}`));
            });
        });
        const segments = Array.from({length: 8}, (_, id) => ({
            id,
            source: id === 0 ? 'fail' : `Source ${id}`,
        }));

        await expect(translateDocumentSegments(segments, {
            fileName: 'sample.md',
            onProgress: ({completed}) => progress.push(completed),
        })).rejects.toThrow('第 1 段文档翻译失败');
        expect(mocks.translateText).toHaveBeenCalledTimes(3);

        releaseSlowRequests.forEach((release) => release());
        await Promise.resolve();
        await Promise.resolve();

        expect(mocks.translateText).toHaveBeenCalledTimes(3);
        expect(progress).toEqual([0]);
    });
});
