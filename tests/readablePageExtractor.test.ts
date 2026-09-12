import {afterEach, describe, expect, it, vi} from 'vitest';

type ExtractorModule = typeof import('@/src/platform/page-context/readableExtractor');

const registryKey = Symbol.for('fluentread.readablePageExtractor.v1');

async function loadModule(): Promise<ExtractorModule> {
    vi.resetModules();
    return import('@/src/platform/page-context/readableExtractor');
}

afterEach(() => {
    Reflect.deleteProperty(globalThis, registryKey);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.doUnmock('defuddle/full');
});

describe('网页正文提取器按需加载', () => {
    it('已登记时直接复用；未登记时只加载一次独立脚本并读取其登记结果', async () => {
        const module = await loadModule();
        const extractor = {Defuddle: class {} as never};
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const importModule = vi.fn(async () => {
            await gate;
            module.registerReadablePageExtractor(extractor);
        });
        const resolveUrl = vi.fn((path: string) => `chrome-extension://id/${path}`);
        const load = module.createReadablePageExtractorLoader({resolveUrl, importModule});

        const first = load();
        const second = load();
        expect(second).toBe(first);
        release();
        await expect(first).resolves.toBe(extractor);
        expect(resolveUrl).toHaveBeenCalledWith(module.READABLE_PAGE_EXTRACTOR_SCRIPT);
        expect(importModule).toHaveBeenCalledWith('chrome-extension://id/pageContextExtractor.js');

        await expect(load()).resolves.toBe(extractor);
        expect(importModule).toHaveBeenCalledOnce();
    });

    it('脚本加载失败或未登记时拒绝本次请求，并允许下一次重新加载', async () => {
        const module = await loadModule();
        const importModule = vi.fn()
            .mockRejectedValueOnce(new Error('blocked by browser'))
            .mockResolvedValueOnce(undefined)
            .mockImplementationOnce(async () => module.registerReadablePageExtractor({Defuddle: class {} as never}));
        const load = module.createReadablePageExtractorLoader({resolveUrl: (path) => path, importModule});

        await expect(load()).rejects.toThrow('blocked by browser');
        await expect(load()).rejects.toThrow('网页正文提取器未完成注册');
        await expect(load()).resolves.toMatchObject({Defuddle: expect.any(Function)});
        expect(importModule).toHaveBeenCalledTimes(3);
    });

    it('默认加载器通过 browser 或 chrome runtime 解析扩展地址，运行时缺失时拒绝', async () => {
        vi.stubGlobal('browser', {runtime: {getURL: (path: string) => `moz-extension://id/${path}`}});
        let module = await loadModule();
        // 真实动态导入扩展地址在 Node 中不可用，失败原因应来自导入而不是地址解析。
        await expect(module.loadReadablePageExtractor()).rejects.not.toThrow('扩展运行时不可用');

        vi.stubGlobal('browser', undefined);
        vi.stubGlobal('chrome', {runtime: {getURL: (path: string) => `chrome-extension://id/${path}`}});
        module = await loadModule();
        await expect(module.loadReadablePageExtractor()).rejects.not.toThrow('扩展运行时不可用');

        vi.stubGlobal('chrome', {runtime: {}});
        module = await loadModule();
        await expect(module.loadReadablePageExtractor()).rejects.toThrow('扩展运行时不可用，无法加载网页正文提取器');
    });

    it('独立提取脚本把 Defuddle 与 Markdown 转换登记到共享注册表', async () => {
        const Defuddle = class MockDefuddle {};
        const createMarkdownContent = vi.fn();
        vi.doMock('defuddle/full', () => ({default: Defuddle, createMarkdownContent}));
        vi.resetModules();
        const {startPageContextExtractorApp} = await import('@/src/app/content/pageContextExtractor');
        const platform = await import('@/src/platform/page-context/readableExtractor');
        startPageContextExtractorApp();
        const load = platform.createReadablePageExtractorLoader({resolveUrl: vi.fn(), importModule: vi.fn()});
        await expect(load()).resolves.toEqual({Defuddle, createMarkdownContent});
    });
});
