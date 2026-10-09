import {degrees, PDFDocument} from 'pdf-lib';
import {describe, expect, it, vi} from 'vitest';

import {
    createDocumentDownload,
    parseBinaryDocument,
    type PdfRasterPageInput,
} from '@/src/features/document-translation/services/binary';

const rotations = [0, 90, 180, 270] as const;
const heading = 'Rotated source heading';
const firstParagraph = 'First source paragraph has useful words.';
const secondParagraph = 'Second paragraph is still readable.';
const onePixelPng = Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlY4AAAAASUVORK5CYII=',
    'base64',
));

async function rotatedPdf(): Promise<Uint8Array> {
    const pdf = await PDFDocument.create();
    for (const rotation of rotations) {
        const page = pdf.addPage([420, 640]);
        page.drawText(heading, {x: 48, y: 540, size: 18});
        page.drawText(firstParagraph, {x: 48, y: 476, size: 12});
        page.drawText(secondParagraph, {x: 48, y: 452, size: 12});
        page.setRotation(degrees(rotation));
    }
    return pdf.save();
}

async function outputText(bytes: Uint8Array): Promise<Array<Array<{str: string; transform: number[]}>>> {
    const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({data: bytes.slice(), disableFontFace: true, isEvalSupported: false, useWorkerFetch: false});
    try {
        const pdf = await task.promise;
        const pages: Array<Array<{str: string; transform: number[]}>> = [];
        for (let number = 1; number <= pdf.numPages; number += 1) {
            const page = await pdf.getPage(number);
            try {
                const text = await page.getTextContent();
                pages.push(text.items.flatMap(item => 'str' in item && item.str.trim()
                    ? [{str: item.str, transform: item.transform}]
                    : []));
            } finally {
                page.cleanup();
            }
        }
        return pages;
    } finally {
        await task.destroy();
    }
}

function expectRotatedSources(pages: Awaited<ReturnType<typeof outputText>>): void {
    const headingTransforms = [
        [18, 0, 0, 18, 48, 540],
        [0, -18, 18, 0, 540, 372],
        [-18, 0, 0, -18, 372, 100],
        [0, 18, -18, 0, 100, 48],
    ];
    expect(pages).toHaveLength(4);
    for (const [index, items] of pages.entries()) {
        expect(items.map(item => item.str)).toEqual([heading, firstParagraph, secondParagraph]);
        const sourceHeading = items.find(item => item.str === heading)!;
        for (const [coordinate, expected] of headingTransforms[index].entries()) {
            expect(sourceHeading.transform[coordinate]).toBeCloseTo(expected, 6);
        }
    }
}

describe('real rotated PDF import and download', () => {
    it('extracts every page rotation with unchanged content coordinates and rotated display dimensions', async () => {
        const bytes = await rotatedPdf();
        const originalBytes = bytes.slice();
        const parsed = await parseBinaryDocument('rotated.pdf', bytes);
        expect(parsed.binary?.kind).toBe('pdf');
        if (parsed.binary?.kind !== 'pdf') throw new Error('Expected parsed PDF');
        const baseline = parsed.binary.pages[0];
        expect(baseline.blocks.length).toBeGreaterThan(1);
        const baselineGeometry = baseline.blocks.map(({segmentIndex: _segmentIndex, ...block}) => block);
        const baselineText = baseline.segmentIndexes.map(index => parsed.segments[index].source);
        expect(baselineText.join(' ')).toContain(heading);
        expect(baselineText.join(' ')).toContain(firstParagraph);
        expect(baselineText.join(' ')).toContain(secondParagraph);
        expect(parsed.binary.pages).toHaveLength(4);
        for (const [index, page] of parsed.binary.pages.entries()) {
            const quarterTurn = index === 1 || index === 3;
            expect(page).toMatchObject({pageNumber: index + 1, width: quarterTurn ? 640 : 420, height: quarterTurn ? 420 : 640});
            expect(page.rotation ?? 0).toBe(rotations[index]);
            expect(page.blocks.map(({segmentIndex: _segmentIndex, ...block}) => block)).toEqual(baselineGeometry);
            expect(page.segmentIndexes.map(segmentIndex => parsed.segments[segmentIndex].source)).toEqual(baselineText);
            expect(parsed.segments[page.segmentIndexes[0]].contextLabel).toBe(`第 ${index + 1} 页`);
        }
        expect(bytes).toEqual(originalBytes);
        expect(parsed.binary.bytes).toEqual(originalBytes);
        expect(parsed.binary.bytes).not.toBe(bytes);
    });

    it.each(['bilingual', 'translated'] as const)('passes native rotation to the rasterizer and preserves the displayed page shape in %s downloads', async mode => {
        const bytes = await rotatedPdf();
        const originalBytes = bytes.slice();
        const parsed = await parseBinaryDocument('rotated.pdf', bytes);
        if (parsed.binary?.kind !== 'pdf') throw new Error('Expected parsed PDF');
        const translations = parsed.segments.map(segment => `Translated: ${segment.source}`);
        const captured: PdfRasterPageInput[] = [];
        const rasterizer = vi.fn(async (input: PdfRasterPageInput) => {
            captured.push(input);
            return onePixelPng;
        });
        const download = await createDocumentDownload(parsed, translations, mode, {pdfPageRasterizer: rasterizer});
        const output = await PDFDocument.load(download.data as Uint8Array);
        expect(output.getPageCount()).toBe(4);
        expect(captured).toHaveLength(4);
        for (const [index, input] of captured.entries()) {
            const quarterTurn = index === 1 || index === 3;
            expect(input).toMatchObject({pageNumber: index + 1, width: quarterTurn ? 640 : 420, height: quarterTurn ? 420 : 640});
            expect(input.rotation ?? 0).toBe(rotations[index]);
            expect(input.blocks).toEqual(parsed.binary.pages[index].blocks);
            expect(input.translations).toEqual(translations);
            expect(input.sourceBytes).toEqual(originalBytes);
            expect(output.getPage(index).getSize()).toEqual({
                width: mode === 'bilingual' ? (quarterTurn ? 1296 : 850.5) : (quarterTurn ? 640 : 420),
                height: quarterTurn ? 420 : 640,
            });
        }
        const text = await outputText(download.data as Uint8Array);
        if (mode === 'bilingual') expectRotatedSources(text);
        else expect(text).toEqual([[], [], [], []]);
        expect(bytes).toEqual(originalBytes);
        expect(parsed.binary.bytes).toEqual(originalBytes);
    });

    it('keeps unchanged rotated bilingual pages as correctly oriented originals without rasterizing', async () => {
        const bytes = await rotatedPdf();
        const originalBytes = bytes.slice();
        const parsed = await parseBinaryDocument('rotated.pdf', bytes);
        const rasterizer = vi.fn(async () => onePixelPng);
        const download = await createDocumentDownload(parsed, parsed.segments.map(segment => segment.source), 'bilingual', {pdfPageRasterizer: rasterizer});
        expect(rasterizer).not.toHaveBeenCalled();
        const output = await PDFDocument.load(download.data as Uint8Array);
        expect(output.getPages().map(page => page.getSize())).toEqual([
            {width: 420, height: 640}, {width: 640, height: 420},
            {width: 420, height: 640}, {width: 640, height: 420},
        ]);
        expectRotatedSources(await outputText(download.data as Uint8Array));
        expect(bytes).toEqual(originalBytes);
        expect(parsed.binary?.bytes).toEqual(originalBytes);
    });
});
