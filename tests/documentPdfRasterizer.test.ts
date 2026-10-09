import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createPdfPagePreview, paintPdfTranslation, rasterizePdfTranslationPage} from '@/src/features/document-translation/ui/pdfPreview';
import type {ParsedDocument} from '@/src/features/document-translation/core/document';

const pdf = vi.hoisted(() => ({width: 600, height: 800, render: vi.fn(), cleanup: vi.fn()}));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
    GlobalWorkerOptions: {},
    getDocument: () => ({promise: Promise.resolve({getPage: async () => ({
        getViewport: ({scale}: {scale: number}) => ({width: pdf.width * scale, height: pdf.height * scale}),
        render: pdf.render, cleanup: pdf.cleanup,
    })})}),
}));

let canvases: any[];
let sizes: Array<[number, number]>;
let paintedTextCountsAtEncoding: number[];
let failEncoding: boolean;
const input = () => ({sourceBytes: new Uint8Array([1]), pageNumber: 1, width: pdf.width, height: pdf.height, blocks: [], translations: []});
const previewDocument = (): ParsedDocument => ({
    fileName: 'sample.pdf', format: 'pdf', label: 'PDF 文件', parts: [],
    segments: [{id: 0, source: 'Original text', contextLabel: '第 1 页', role: 'paragraph'}],
    binary: {kind: 'pdf', bytes: new Uint8Array([1]), pages: [{
        pageNumber: 1, width: pdf.width, height: pdf.height, segmentIndexes: [0],
        blocks: [{segmentIndex: 0, x: 20, y: 30, width: 200, height: 12,
            fontSize: 12, lineHeight: 12, lineCount: 1, fontFamily: 'sans-serif', fontWeight: 600, textAlign: 'left'}],
    }]},
});

beforeEach(() => {
    canvases = [];
    sizes = [];
    paintedTextCountsAtEncoding = [];
    failEncoding = false;
    pdf.width = 600;
    pdf.height = 800;
    pdf.cleanup.mockReset();
    pdf.render.mockReset().mockReturnValue({promise: Promise.resolve(), cancel: vi.fn()});
    vi.stubGlobal('window', {location: {origin: 'chrome-extension://fixture'}});
    vi.stubGlobal('document', {createElement: () => {
        const canvas = {width: 0, height: 0,
            getContext: (): object => context,
            toBlob: (done: (value: Blob | null) => void) => {
                sizes.push([canvas.width, canvas.height]);
                paintedTextCountsAtEncoding.push(context.fillText.mock.calls.length);
                done(failEncoding ? null : new Blob([new Uint8Array([1])]));
            },
        };
        const context = {canvas, fillRect: vi.fn(), fillText: vi.fn(),
            measureText: vi.fn((value: string) => ({width: value.length * 8})),
            getImageData: vi.fn((_x: number, _y: number, width: number, height: number) =>
                ({data: new Uint8ClampedArray(width * height * 4).fill(255)})),
            save: vi.fn(), restore: vi.fn(), transform: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
        };
        canvases.push(canvas);
        return canvas;
    }});
});
afterEach(() => vi.unstubAllGlobals());

describe('PDF translation painter rotated geometry', () => {
    const block = {segmentIndex: 0, x: 10, y: 20, width: 30, height: 40, fontSize: 12, lineHeight: 12, lineCount: 1, fontFamily: 'sans-serif', fontWeight: 400 as const, textAlign: 'left' as const};
    it.each([
        {rotation: 90 as const, size: [200, 100], transform: [0, 1, -1, 0, 200, 0], sample: [140, 10, 40, 30]},
        {rotation: 180 as const, size: [100, 200], transform: [-1, 0, 0, -1, 100, 200], sample: [60, 140, 30, 40]},
        {rotation: 270 as const, size: [200, 100], transform: [0, -1, 1, 0, 0, 100], sample: [20, 60, 40, 30]},
    ])('samples actual pixel coordinates and paints virtual content at $rotation degrees without a second Canvas', ({rotation, size, transform, sample}) => {
        const canvas = document.createElement('canvas'); canvas.width = size[0]; canvas.height = size[1];
        const context = canvases[0].getContext(); const originalBlock = JSON.stringify(block);
        expect(paintPdfTranslation(canvas, {...input(), rotation, width: size[0], height: size[1], blocks: [block], translations: ['译文']})).toBe(canvas);
        expect(context.transform).toHaveBeenCalledWith(...transform);
        expect(context.getImageData).toHaveBeenLastCalledWith(...sample);
        expect(context.rect).toHaveBeenCalledWith(10, 20, 30, 40);
        expect(context.fillRect).toHaveBeenCalledWith(8, 18, 34, 44);
        expect(context.fillText).toHaveBeenCalledWith('译文', 10, expect.any(Number), 27);
        expect(context.save).toHaveBeenCalledTimes(2); expect(context.restore).toHaveBeenCalledTimes(2);
        expect(canvases).toHaveLength(1); expect(canvas.width).toBe(size[0]); expect(canvas.height).toBe(size[1]);
        expect(JSON.stringify(block)).toBe(originalBlock);
    });

    it.each(['sampling', 'transform', 'painting'] as const)('restores Canvas state when rotated %s fails', phase => {
        const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 100;
        const context = canvases[0].getContext();
        const fail = () => {throw new Error(`${phase} failed`);};
        if (phase === 'sampling') context.getImageData.mockImplementationOnce(fail);
        else if (phase === 'transform') context.transform.mockImplementationOnce(fail);
        else context.fillText.mockImplementationOnce(fail);
        expect(() => paintPdfTranslation(canvas, {...input(), rotation: 90, width: 200, height: 100, blocks: [block], translations: ['译文']})).toThrow(`${phase} failed`);
        expect(context.restore.mock.calls.length).toBe(context.save.mock.calls.length);
        expect(context.restore).toHaveBeenCalled(); expect(canvases).toHaveLength(1);
    });

    it('clamps rotated block sampling and erasure to the content dimensions at the page edge', () => {
        const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 100;
        const context = canvases[0].getContext();
        paintPdfTranslation(canvas, {...input(), rotation: 90, width: 200, height: 100, blocks: [{...block, x: 99, y: 199}], translations: ['译文']});
        expect(context.getImageData).toHaveBeenLastCalledWith(0, 99, 1, 1);
        expect(context.rect).toHaveBeenCalledWith(99, 199, 1, 1);
        expect(context.fillRect).toHaveBeenCalledWith(97, 197, 3, 3);
    });
});

describe('PDF rasterizer resource lifecycle', () => {
    it('uses one canvas and releases its pixels after successful export', async () => {
        await rasterizePdfTranslationPage(input());
        expect(canvases).toHaveLength(1);
        expect(sizes).toEqual([[1440, 1920]]);
        expect(canvases[0]).toMatchObject({width: 0, height: 0});
        expect(pdf.cleanup).toHaveBeenCalledOnce();
    });

    it.each([[20_000, 30_000], [600, 100_000]])('bounds oversized %s x %s pages', async (width, height) => {
        pdf.width = width;
        pdf.height = height;
        await rasterizePdfTranslationPage(input());
        expect(sizes[0][0] * sizes[0][1]).toBeLessThanOrEqual(4_000_000);
        expect(Math.max(...sizes[0])).toBeLessThanOrEqual(8192);
        expect(canvases[0]).toMatchObject({width: 0, height: 0});
    });

    it('releases the canvas when encoding fails', async () => {
        failEncoding = true;
        await expect(rasterizePdfTranslationPage(input())).rejects.toThrow('无法生成');
        expect(canvases[0]).toMatchObject({width: 0, height: 0});
    });

    it('cancels an active PDF.js render and releases the canvas on rejection', async () => {
        const controller = new AbortController();
        let reject!: (reason: Error) => void;
        const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
        const cancel = vi.fn(() => reject(new Error('Rendering cancelled')));
        pdf.render.mockReturnValue({promise: pending, cancel});
        const work = rasterizePdfTranslationPage({...input(), signal: controller.signal});
        await vi.waitFor(() => expect(pdf.render).toHaveBeenCalledOnce());
        controller.abort();
        await expect(work).rejects.toThrow('Rendering cancelled');
        expect(cancel).toHaveBeenCalledOnce();
        expect(pdf.cleanup).toHaveBeenCalledOnce();
        expect(canvases[0]).toMatchObject({width: 0, height: 0});
        expect(sizes).toHaveLength(0);
    });

    it('encodes the original preview before painting translation and releases the shared canvas', async () => {
        const preview = await createPdfPagePreview(previewDocument(), 1, ['Translated text']);
        expect(preview.original).toEqual(new Uint8Array([1]));
        expect(preview.translated).toEqual(new Uint8Array([1]));
        expect(sizes).toHaveLength(2);
        expect(paintedTextCountsAtEncoding).toEqual([0, 1]);
        expect(canvases).toHaveLength(1);
        expect(canvases[0].getContext().fillText).toHaveBeenCalledWith('Translated text', expect.any(Number), expect.any(Number), expect.any(Number));
        expect(canvases[0]).toMatchObject({width: 0, height: 0});
        expect(pdf.cleanup).toHaveBeenCalledOnce();
    });

    it.each(['Original text', ' \nOriginal   text\t '])('keeps only the original preview without repainting an equivalent translation %j', async translation => {
        const preview = await createPdfPagePreview(previewDocument(), 1, [translation]);
        expect(preview).toEqual({original: new Uint8Array([1])});
        expect(sizes).toEqual([[1440, 1920]]);
        expect(paintedTextCountsAtEncoding).toEqual([0]);
        expect(canvases).toHaveLength(1);
        expect(canvases[0].getContext().fillText).not.toHaveBeenCalled();
        expect(canvases[0].getContext().fillRect).toHaveBeenCalledOnce();
        expect(canvases[0]).toMatchObject({width: 0, height: 0});
        expect(pdf.cleanup).toHaveBeenCalledOnce();
    });
});
