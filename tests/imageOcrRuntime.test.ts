import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {recognize, ensureLanguages} = vi.hoisted(() => ({recognize: vi.fn(), ensureLanguages: vi.fn()}));
vi.mock('@/src/features/image-translation/services/ocrWorkerRuntime', () => ({
    createOcrWorkerRuntime: () => ({recognize, ensureLanguages}),
}));
vi.mock('tesseract.js', () => ({createWorker: vi.fn(), PSM: {SPARSE_TEXT: 11}}));

const blockResult = () => ({data: {blocks: [{paragraphs: [{lines: [{
    text: 'hello', bbox: {x0: 10, y0: 10, x1: 50, y1: 30},
}]}]}]}});

describe('图片 OCR 处理与结果缓存', () => {
    let recognizeImage: typeof import('@/src/features/image-translation/services/ocrRuntime')['recognizeImage'];
    let dimensions: {width: number; height: number};
    let sources: Array<{src: string; onload: (() => void) | null; onerror: (() => void) | null}>;
    let canvas: {width: number; height: number; getContext: ReturnType<typeof vi.fn>; toDataURL: ReturnType<typeof vi.fn>};
    let context: {drawImage: ReturnType<typeof vi.fn>; imageSmoothingEnabled: boolean; imageSmoothingQuality: string};

    beforeEach(async () => {
        vi.resetModules();
        recognize.mockReset().mockResolvedValue(blockResult());
        ensureLanguages.mockReset().mockResolvedValue(undefined);
        dimensions = {width: 100, height: 100};
        sources = [];
        context = {drawImage: vi.fn(), imageSmoothingEnabled: false, imageSmoothingQuality: 'low'};
        canvas = {width: 0, height: 0, getContext: vi.fn(() => context), toDataURL: vi.fn(() => 'scaled-image')};
        vi.stubGlobal('document', {createElement: vi.fn(() => canvas)});
        vi.stubGlobal('Image', class {
            naturalWidth = dimensions.width;
            naturalHeight = dimensions.height;
            width = dimensions.width;
            height = dimensions.height;
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            currentSrc = '';
            constructor() { sources.push(this); }
            get src() { return this.currentSrc; }
            set src(value: string) {
                this.currentSrc = value;
                if (value && value !== 'pending') {
                    queueMicrotask(() => value === 'broken' ? this.onerror?.() : this.onload?.());
                }
            }
        });
        ({recognizeImage} = await import('@/src/features/image-translation/services/ocrRuntime'));
    });

    afterEach(() => vi.unstubAllGlobals());

    it('同图同语言复用完成的 OCR，并隔离调用方修改', async () => {
        const first = await recognizeImage('same', 'en');
        first[0].text = 'mutated';
        first[0].bbox.x0 = 99;
        const cached = await recognizeImage('same', 'en');
        expect(cached).toEqual([{text: 'hello', bbox: {x0: 10, y0: 10, x1: 50, y1: 30}}]);
        cached[0].text = 'changed again';
        expect((await recognizeImage('same', 'en'))[0].text).toBe('hello');
        expect(recognize).toHaveBeenCalledOnce();
        expect(sources).toHaveLength(1);
        expect(document.createElement).not.toHaveBeenCalled();
    });

    it('不同 OCR 语言分别缓存，第四张图片淘汰最近最少使用的结果', async () => {
        await recognizeImage('one', 'en');
        await recognizeImage('one', 'ja');
        await recognizeImage('two', 'en');
        await recognizeImage('one', 'en');
        await recognizeImage('three', 'en');
        await recognizeImage('one', 'en');
        expect(recognize).toHaveBeenCalledTimes(4);
        await recognizeImage('one', 'ja');
        expect(recognize).toHaveBeenCalledTimes(5);
        expect(recognize).toHaveBeenLastCalledWith('one', 'jpn+eng', undefined);
    });

    it('单图和总输入字节预算限制缓存，不长期保留巨型 data URL', async () => {
        const huge = 'x'.repeat(6 * 1024 * 1024);
        await recognizeImage(huge, 'en');
        await recognizeImage(huge, 'en');
        expect(recognize).toHaveBeenCalledTimes(2);
        recognize.mockClear();
        const first = 'a'.repeat(4 * 1024 * 1024);
        const second = 'b'.repeat(4 * 1024 * 1024);
        await recognizeImage(first, 'en');
        await recognizeImage(second, 'en');
        await recognizeImage(first, 'en');
        expect(recognize).toHaveBeenCalledTimes(3);
    });

    it('大图只降采样识别并映回原始坐标，编码后释放临时画布', async () => {
        dimensions = {width: 8000, height: 1000};
        const lines = await recognizeImage('large', 'en');
        expect(context.drawImage).toHaveBeenCalledWith(sources[0], 0, 0, 4096, 512);
        expect(context.imageSmoothingEnabled).toBe(true);
        expect(context.imageSmoothingQuality).toBe('high');
        expect(recognize).toHaveBeenCalledWith('scaled-image', 'eng', undefined);
        expect(lines).toEqual([{text: 'hello', bbox: {x0: 19, y0: 19, x1: 98, y1: 59}}]);
        expect(canvas.width).toBe(0);
        expect(canvas.height).toBe(0);
    });

    it('预取消请求不读取缓存或解码，取消解码会移除图片监听器', async () => {
        await recognizeImage('cached', 'en');
        const controller = new AbortController();
        controller.abort();
        await expect(recognizeImage('cached', 'en', controller.signal)).rejects.toMatchObject({name: 'AbortError'});
        expect(sources).toHaveLength(1);
        const pendingController = new AbortController();
        const pending = recognizeImage('pending', 'en', pendingController.signal);
        pendingController.abort();
        await expect(pending).rejects.toMatchObject({name: 'AbortError'});
        expect(sources[1]).toMatchObject({src: '', onload: null, onerror: null});
        expect(recognize).toHaveBeenCalledOnce();
    });

    it('识别取消后即使底层迟到成功也不写缓存', async () => {
        const controller = new AbortController();
        recognize.mockImplementationOnce(async () => {
            controller.abort();
            return blockResult();
        });
        await expect(recognizeImage('cancelled', 'en', controller.signal)).rejects.toMatchObject({name: 'AbortError'});
        await recognizeImage('cancelled', 'en');
        expect(recognize).toHaveBeenCalledTimes(2);
    });

    it('解码失败、非法尺寸、Canvas 不可用和识别失败均可明确失败后重试', async () => {
        await expect(recognizeImage('broken', 'en')).rejects.toThrow('图片数据无法解码');
        dimensions = {width: 0, height: 0};
        await expect(recognizeImage('invalid', 'en')).rejects.toThrow('图片尺寸无效');
        dimensions = {width: 8000, height: 1000};
        canvas.getContext.mockReturnValueOnce(null);
        await expect(recognizeImage('no-canvas', 'en')).rejects.toThrow('浏览器不支持图片处理');
        dimensions = {width: 100, height: 100};
        recognize.mockRejectedValueOnce(new Error('engine failed'));
        await expect(recognizeImage('retry', 'en')).rejects.toThrow('engine failed');
        await expect(recognizeImage('retry', 'en')).resolves.toHaveLength(1);
        expect(recognize).toHaveBeenCalledTimes(2);
    });
});
