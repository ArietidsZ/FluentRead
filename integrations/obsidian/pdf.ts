/**
 * 在 Obsidian 内本地提取 PDF 文字，沿用 FluentRead 的行与段落重建规则。
 */
import type {DocumentSegment} from '../../src/features/document-translation/core/document';
import {
    pdfTextAtoms,
    pdfTextBlocks,
    pdfTextLines,
    type PdfTextItem,
    type PdfTextStyle,
} from '../../src/features/document-translation/services/binary';

let workerUrl: string | null = null;

async function ensureWorker(): Promise<void> {
    if (typeof window === 'undefined') return;
    const {GlobalWorkerOptions} = await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (!workerUrl) {
        const {default: source} = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?raw');
        workerUrl = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
    }
    GlobalWorkerOptions.workerSrc = workerUrl;
}

export function disposePdfWorker(): void {
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    workerUrl = null;
}

export async function extractPdfSegments(bytes: ArrayBuffer): Promise<DocumentSegment[]> {
    if (new TextDecoder('latin1').decode(bytes.slice(0, 5)) !== '%PDF-') {
        throw new Error('PDF 文件签名无效，文件可能已损坏');
    }
    await ensureWorker();
    const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = getDocument({
        data: new Uint8Array(bytes),
        disableFontFace: true,
        isEvalSupported: false,
        useWorkerFetch: false,
    });
    const segments: DocumentSegment[] = [];
    try {
        const pdf = await loadingTask.promise;
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const viewport = page.getViewport({scale: 1});
            const text = await page.getTextContent();
            const atoms = pdfTextAtoms(
                text.items.filter((item): item is PdfTextItem => 'str' in item),
                text.styles as Record<string, PdfTextStyle>,
                viewport,
            );
            const blocks = pdfTextBlocks(pdfTextLines(atoms, viewport.width), viewport.width);
            blocks.forEach((block, index) => segments.push({
                id: segments.length,
                source: block.source,
                contextLabel: index === 0 ? `第 ${pageNumber} 页` : undefined,
                role: block.fontWeight === 700 ? 'heading' : 'paragraph',
            }));
            page.cleanup();
        }
    } finally {
        await loadingTask.destroy();
    }
    if (segments.length === 0) throw new Error('PDF 中没有可提取文字；扫描版 PDF 暂不支持');
    return segments;
}
