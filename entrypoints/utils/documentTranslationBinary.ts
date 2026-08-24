import JSZip from 'jszip';
import {PDFDocument} from 'pdf-lib';
import {
    GlobalWorkerOptions,
    Util,
    getDocument as getPdfDocument,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

import {
    createDocumentDownloadName,
    getDocumentFormat,
    getDocumentFormatLabel,
    getDocumentMimeType,
    parseDocument,
    renderDocument,
    type DocxDocumentPart,
    type DocumentFormat,
    type DocumentRenderMode,
    type DocumentSegment,
    type EpubDocumentChapter,
    type ParsedDocument,
    type PdfDocumentBlock,
    type PdfDocumentPage,
} from '@/entrypoints/utils/documentTranslation';

if (typeof window !== 'undefined') {
    GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

const BINARY_DOCUMENT_FORMATS = new Set<DocumentFormat>(['pdf', 'epub', 'docx']);
const DOCX_PARAGRAPH_PATTERN = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/gu;
const DOCX_TEXT_TOKEN_PATTERN = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>/gu;
const ARCHIVE_ENTRY_LIMIT = 4_000;
const ARCHIVE_ENTRY_BYTES_LIMIT = 24 * 1024 * 1024;
const ARCHIVE_TOTAL_BYTES_LIMIT = 96 * 1024 * 1024;

interface PdfTextItem {
    str: string;
    dir: string;
    transform: Array<unknown>;
    width: number;
    height: number;
    fontName: string;
    hasEOL: boolean;
}

interface PdfTextStyle {
    ascent?: number;
    descent?: number;
    fontFamily?: string;
    vertical?: boolean;
}

interface PdfTextAtom {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontFamily: string;
}

interface PdfTextLine {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontFamily: string;
}

export interface DocumentFileLike {
    name: string;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
}

export interface DocumentDownload {
    data: string | Uint8Array;
    fileName: string;
    mimeType: string;
}

export interface PdfRasterPageInput {
    pageNumber: number;
    width: number;
    height: number;
    sourceBytes: Uint8Array;
    blocks: PdfDocumentBlock[];
    translations: string[];
}

export type PdfPageRasterizer = (input: PdfRasterPageInput) => Promise<Uint8Array>;

export interface CreateDocumentDownloadOptions {
    pdfPageRasterizer?: PdfPageRasterizer;
}

function toUint8Array(value: ArrayBuffer | Uint8Array): Uint8Array {
    if (value instanceof Uint8Array) return new Uint8Array(value);
    return new Uint8Array(value.slice(0));
}

function assertArchiveSafety(zip: JSZip, label: 'ePub' | 'DOCX'): void {
    const entries = Object.values(zip.files);
    if (entries.length > ARCHIVE_ENTRY_LIMIT) {
        throw new Error(`${label} 文件包含过多压缩项，已停止解析`);
    }
    let totalBytes = 0;
    entries.forEach((entry) => {
        const size = Number((entry as typeof entry & {_data?: {uncompressedSize?: number}})._data?.uncompressedSize || 0);
        if (size > ARCHIVE_ENTRY_BYTES_LIMIT) {
            throw new Error(`${label} 文件中的单个内容项过大，已停止解析`);
        }
        totalBytes += size;
    });
    if (totalBytes > ARCHIVE_TOTAL_BYTES_LIMIT) {
        throw new Error(`${label} 文件解压后内容过大，已停止解析`);
    }
}

export function isBinaryDocumentFormat(format: DocumentFormat): boolean {
    return BINARY_DOCUMENT_FORMATS.has(format);
}

function xmlDecode(value: string): string {
    return value
        .replace(/&#x([0-9a-f]+);/giu, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#([0-9]+);/gu, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
        .replace(/&quot;/gu, '"')
        .replace(/&apos;/gu, "'")
        .replace(/&lt;/gu, '<')
        .replace(/&gt;/gu, '>')
        .replace(/&amp;/gu, '&');
}

function xmlEscape(value: string): string {
    return value
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
        .replace(/"/gu, '&quot;')
        .replace(/'/gu, '&apos;');
}

function parseXmlAttributes(source: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;
    let match = pattern.exec(source);
    while (match) {
        attributes[match[1]] = xmlDecode(match[2] ?? match[3] ?? '');
        match = pattern.exec(source);
    }
    return attributes;
}

function normalizeZipPath(value: string): string {
    const result: string[] = [];
    value.replace(/\\/gu, '/').split('/').forEach((part) => {
        if (!part || part === '.') return;
        if (part === '..') result.pop();
        else result.push(part);
    });
    return result.join('/');
}

function resolveZipPath(baseFile: string, href: string): string {
    const cleanHref = href.split(/[?#]/u)[0];
    const baseDirectory = baseFile.includes('/') ? baseFile.slice(0, baseFile.lastIndexOf('/') + 1) : '';
    const normalized = normalizeZipPath(`${baseDirectory}${cleanHref}`);
    try {
        return decodeURIComponent(normalized);
    } catch {
        return normalized;
    }
}

function median(values: number[]): number {
    if (values.length === 0) return 1;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function pdfTextAtoms(
    items: PdfTextItem[],
    styles: Record<string, PdfTextStyle>,
    viewport: {width: number; height: number; transform: number[]},
): PdfTextAtom[] {
    return items.flatMap((item) => {
        const text = item.str.replace(/\u0000/gu, '').replace(/[\t\u00a0 ]+/gu, ' ').trim();
        if (!text) return [];
        const transform = Util.transform(viewport.transform, item.transform as number[]);
        const angle = Math.atan2(transform[1], transform[0]);
        if (Math.abs(angle) > 0.12) return [];
        const style = styles[item.fontName] || {};
        const fontHeight = Math.max(1, Math.hypot(transform[2], transform[3]) || item.height || 1);
        const ascent = typeof style.ascent === 'number'
            ? style.ascent
            : typeof style.descent === 'number'
                ? 1 + style.descent
                : 0.8;
        const x = transform[4];
        const y = transform[5] - fontHeight * ascent;
        return [{
            text,
            x,
            y,
            width: Math.max(fontHeight * 0.2, Math.abs(item.width || 0)),
            height: fontHeight,
            fontFamily: style.fontFamily || 'sans-serif',
        }];
    }).filter((atom) => atom.x < viewport.width && atom.y < viewport.height && atom.x + atom.width > 0 && atom.y + atom.height > 0);
}

function pdfTextLines(atoms: PdfTextAtom[], pageWidth: number): PdfTextLine[] {
    const rows: PdfTextAtom[][] = [];
    [...atoms].sort((left, right) => left.y - right.y || left.x - right.x).forEach((atom) => {
        const row = rows.at(-1);
        const rowHeight = row ? Math.max(...row.map((entry) => entry.height)) : 0;
        const rowY = row ? median(row.map((entry) => entry.y)) : 0;
        if (!row || Math.abs(atom.y - rowY) > Math.max(2, rowHeight * 0.42, atom.height * 0.42)) rows.push([atom]);
        else row.push(atom);
    });

    const lines: PdfTextLine[] = [];
    const addLine = (entries: PdfTextAtom[]) => {
        if (entries.length === 0) return;
        const ordered = [...entries].sort((left, right) => left.x - right.x);
        let text = '';
        let endX: number | undefined;
        ordered.forEach((entry) => {
            const gap = endX === undefined ? 0 : entry.x - endX;
            if (text && gap > Math.max(1.2, entry.height * 0.08)
                && !/[\s\-–—/]$/u.test(text)
                && !/^[,.;:!?，。；：！？)\]}]/u.test(entry.text)) text += ' ';
            text += entry.text;
            endX = Math.max(endX ?? entry.x, entry.x + entry.width);
        });
        const x = Math.min(...ordered.map((entry) => entry.x));
        const y = Math.min(...ordered.map((entry) => entry.y));
        const right = Math.max(...ordered.map((entry) => entry.x + entry.width));
        const bottom = Math.max(...ordered.map((entry) => entry.y + entry.height));
        const dominant = [...ordered].sort((left, rightEntry) => rightEntry.width - left.width)[0];
        const normalized = text.replace(/[\t\u00a0 ]+/gu, ' ').trim();
        if (normalized) lines.push({
            text: normalized,
            x,
            y,
            width: Math.max(1, right - x),
            height: Math.max(1, bottom - y),
            fontFamily: dominant?.fontFamily || 'sans-serif',
        });
    };

    rows.forEach((row) => {
        const ordered = [...row].sort((left, right) => left.x - right.x);
        let group: PdfTextAtom[] = [];
        let endX: number | undefined;
        ordered.forEach((atom) => {
            const gap = endX === undefined ? 0 : atom.x - endX;
            const splitGap = Math.max(atom.height * 3.2, pageWidth * 0.055);
            if (group.length > 0 && gap > splitGap) {
                addLine(group);
                group = [];
            }
            group.push(atom);
            endX = Math.max(endX ?? atom.x, atom.x + atom.width);
        });
        addLine(group);
    });
    return lines.sort((left, right) => left.y - right.y || left.x - right.x);
}

interface PdfTextBlockDraft {
    lines: PdfTextLine[];
}

function pdfTextBlocks(lines: PdfTextLine[], pageWidth: number): Array<Omit<PdfDocumentBlock, 'segmentIndex'> & {source: string}> {
    if (lines.length === 0) return [];
    const bodyHeight = Math.max(1, median(lines.map((line) => line.height).filter((height) => height >= 4)));
    const drafts: PdfTextBlockDraft[] = [];
    const isHeading = (line: PdfTextLine) => line.height >= bodyHeight * 1.32;
    const bounds = (draft: PdfTextBlockDraft) => {
        const x = Math.min(...draft.lines.map((line) => line.x));
        const y = Math.min(...draft.lines.map((line) => line.y));
        const right = Math.max(...draft.lines.map((line) => line.x + line.width));
        const bottom = Math.max(...draft.lines.map((line) => line.y + line.height));
        return {x, y, right, bottom};
    };

    lines.forEach((line) => {
        let selected: PdfTextBlockDraft | undefined;
        let selectedGap = Number.POSITIVE_INFINITY;
        if (!isHeading(line)) {
            drafts.forEach((draft) => {
                const last = draft.lines.at(-1)!;
                if (isHeading(last)) return;
                const draftBounds = bounds(draft);
                const gap = line.y - draftBounds.bottom;
                if (gap < -Math.max(2, line.height * 0.2) || gap > Math.max(last.height, line.height) * 0.95) return;
                const overlap = Math.max(0, Math.min(draftBounds.right, line.x + line.width) - Math.max(draftBounds.x, line.x));
                const overlapRatio = overlap / Math.max(1, Math.min(draftBounds.right - draftBounds.x, line.width));
                const aligned = Math.abs(line.x - last.x) <= Math.max(bodyHeight * 1.5, Math.min(last.width, line.width) * 0.12);
                const fontRatio = Math.max(last.height, line.height) / Math.max(1, Math.min(last.height, line.height));
                const startsIndentedParagraph = /[.!?。！？]["')\]}]*$/u.test(last.text)
                    && line.x - last.x > bodyHeight * 0.9;
                if ((!aligned && overlapRatio < 0.48) || fontRatio > 1.28 || startsIndentedParagraph) return;
                const paragraphGap = /[.!?。！？]["')\]}]*$/u.test(last.text) && gap > last.height * 0.62;
                if (paragraphGap) return;
                if (gap < selectedGap) {
                    selected = draft;
                    selectedGap = gap;
                }
            });
        }
        if (selected) selected.lines.push(line);
        else drafts.push({lines: [line]});
    });

    return drafts.map((draft) => {
        const draftBounds = bounds(draft);
        const first = draft.lines[0];
        const source = draft.lines.reduce((value, line) => {
            if (!value) return line.text;
            if (/[-‐‑]$/u.test(value) && /^[a-z]/u.test(line.text)) return `${value.slice(0, -1)}${line.text}`;
            return `${value} ${line.text}`;
        }, '').replace(/\s+/gu, ' ').trim();
        const center = (draftBounds.x + draftBounds.right) / 2;
        const centered = Math.abs(center - pageWidth / 2) <= pageWidth * 0.045
            && draftBounds.right - draftBounds.x < pageWidth * 0.9;
        return {
            source,
            x: Math.max(0, draftBounds.x),
            y: Math.max(0, draftBounds.y),
            width: Math.max(1, Math.min(pageWidth, draftBounds.right) - Math.max(0, draftBounds.x)),
            height: Math.max(1, draftBounds.bottom - draftBounds.y),
            fontSize: Math.max(...draft.lines.map((line) => line.height)),
            lineHeight: Math.max(1, median(draft.lines.map((line) => line.height))),
            lineCount: draft.lines.length,
            fontFamily: first.fontFamily,
            fontWeight: (isHeading(first) ? 700 : source.length <= 80 ? 600 : 400) as 400 | 600 | 700,
            textAlign: centered ? 'center' as const : 'left' as const,
        };
    }).filter((block) => block.source.length > 0)
        .sort((left, right) => left.y - right.y || left.x - right.x);
}

async function parsePdf(fileName: string, bytes: Uint8Array): Promise<ParsedDocument> {
    if (new TextDecoder('latin1').decode(bytes.slice(0, 5)) !== '%PDF-') {
        throw new Error('PDF 文件签名无效，文件可能已损坏或扩展名不正确');
    }

    const segments: DocumentSegment[] = [];
    const pages: PdfDocumentPage[] = [];
    const pdfAssetRoot = typeof window !== 'undefined' ? `${window.location.origin}/pdfjs` : '';
    const loadingTask = getPdfDocument({
        data: new Uint8Array(bytes),
        disableFontFace: true,
        isEvalSupported: false,
        useWorkerFetch: false,
        ...(pdfAssetRoot ? {
            cMapPacked: true,
            cMapUrl: `${pdfAssetRoot}/cmaps/`,
            standardFontDataUrl: `${pdfAssetRoot}/standard_fonts/`,
        } : {}),
    });

    try {
        const pdf = await loadingTask.promise;
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const viewport = page.getViewport({scale: 1});
            const textContent = await page.getTextContent();
            const atoms = pdfTextAtoms(
                textContent.items.filter((item): item is PdfTextItem => 'str' in item),
                textContent.styles as Record<string, PdfTextStyle>,
                viewport,
            );
            const layoutBlocks = pdfTextBlocks(pdfTextLines(atoms, viewport.width), viewport.width);
            const segmentIndexes: number[] = [];
            const blocks: PdfDocumentBlock[] = [];
            layoutBlocks.forEach((block, blockIndex) => {
                const id = segments.length;
                segments.push({
                    id,
                    source: block.source,
                    contextLabel: blockIndex === 0 ? `第 ${pageNumber} 页` : undefined,
                    role: block.fontWeight === 700 ? 'heading' : 'paragraph',
                });
                segmentIndexes.push(id);
                blocks.push({...block, segmentIndex: id});
            });
            pages.push({
                pageNumber,
                width: viewport.width,
                height: viewport.height,
                segmentIndexes,
                blocks,
            });
            page.cleanup();
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`PDF 解析失败：${message}`);
    } finally {
        await loadingTask.destroy();
    }

    if (segments.length === 0) {
        throw new Error('PDF 中没有可提取的文字；扫描版 PDF 暂不支持 OCR，请上传包含文本层的 PDF');
    }

    return {
        fileName,
        format: 'pdf',
        label: getDocumentFormatLabel('pdf'),
        parts: [],
        segments,
        binary: {kind: 'pdf', bytes, pages},
    };
}

function chapterTitle(source: string, fallback: string): string {
    const rawTitle = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1];
    if (!rawTitle) return fallback;
    const title = xmlDecode(rawTitle.replace(/<[^>]+>/gu, '')).replace(/\s+/gu, ' ').trim();
    return title || fallback;
}

async function parseEpub(fileName: string, bytes: Uint8Array): Promise<ParsedDocument> {
    let zip: JSZip;
    try {
        zip = await JSZip.loadAsync(bytes);
    } catch (error) {
        throw new Error(`ePub 解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
    assertArchiveSafety(zip, 'ePub');

    const mimetypeEntry = zip.file('mimetype');
    const containerEntry = zip.file('META-INF/container.xml');
    if (!mimetypeEntry || !containerEntry) {
        throw new Error('ePub 文件结构无效：缺少 mimetype 或 META-INF/container.xml');
    }
    const mimetype = (await mimetypeEntry.async('string')).trim();
    if (mimetype !== 'application/epub+zip') {
        throw new Error('ePub 文件签名无效，文件可能已损坏或扩展名不正确');
    }

    const containerXml = await containerEntry.async('string');
    const rootfileMatch = containerXml.match(/<rootfile\b([^>]*)\/?\s*>/iu);
    const opfPath = rootfileMatch ? parseXmlAttributes(rootfileMatch[1])['full-path'] : '';
    if (!opfPath || !zip.file(opfPath)) {
        throw new Error('ePub 文件结构无效：找不到内容清单 OPF');
    }

    const opfXml = await zip.file(opfPath)!.async('string');
    const manifest = new Map<string, {path: string; mediaType: string}>();
    const itemPattern = /<item\b([^>]*)\/?\s*>/giu;
    let itemMatch = itemPattern.exec(opfXml);
    while (itemMatch) {
        const attributes = parseXmlAttributes(itemMatch[1]);
        if (attributes.id && attributes.href) {
            manifest.set(attributes.id, {
                path: resolveZipPath(opfPath, attributes.href),
                mediaType: attributes['media-type'] || '',
            });
        }
        itemMatch = itemPattern.exec(opfXml);
    }

    const orderedPaths: string[] = [];
    const itemrefPattern = /<itemref\b([^>]*)\/?\s*>/giu;
    let itemrefMatch = itemrefPattern.exec(opfXml);
    while (itemrefMatch) {
        const idref = parseXmlAttributes(itemrefMatch[1]).idref;
        const entry = idref ? manifest.get(idref) : undefined;
        if (entry && /^(?:application\/xhtml\+xml|text\/html)$/iu.test(entry.mediaType)) orderedPaths.push(entry.path);
        itemrefMatch = itemrefPattern.exec(opfXml);
    }
    if (orderedPaths.length === 0) {
        manifest.forEach((entry) => {
            if (/^(?:application\/xhtml\+xml|text\/html)$/iu.test(entry.mediaType)) orderedPaths.push(entry.path);
        });
    }

    const segments: DocumentSegment[] = [];
    const chapters: EpubDocumentChapter[] = [];
    for (const [chapterIndex, path] of orderedPaths.entries()) {
        const entry = zip.file(path);
        if (!entry) continue;
        const source = await entry.async('string');
        const parsed = parseDocument('chapter.html', source);
        if (parsed.segments.length === 0) continue;
        const title = chapterTitle(source, `第 ${chapterIndex + 1} 章`);
        const segmentOffset = segments.length;
        parsed.segments.forEach((segment, segmentIndex) => {
            segments.push({
                id: segments.length,
                source: segment.source,
                contextLabel: segmentIndex === 0 ? title : undefined,
            });
        });
        chapters.push({path, source, segmentOffset, segmentCount: parsed.segments.length, title});
    }

    if (segments.length === 0) throw new Error('ePub 中没有找到可翻译的章节文字');
    return {
        fileName,
        format: 'epub',
        label: getDocumentFormatLabel('epub'),
        parts: [],
        segments,
        binary: {kind: 'epub', bytes, chapters},
    };
}

function docxParagraphText(paragraph: string): string {
    const tokens: string[] = [];
    DOCX_TEXT_TOKEN_PATTERN.lastIndex = 0;
    let match = DOCX_TEXT_TOKEN_PATTERN.exec(paragraph);
    while (match) {
        if (match[1] !== undefined) tokens.push(xmlDecode(match[1]));
        else if (/w:tab/iu.test(match[0])) tokens.push('\t');
        else tokens.push('\n');
        match = DOCX_TEXT_TOKEN_PATTERN.exec(paragraph);
    }
    return tokens.join('').replace(/\u0000/gu, '').trim();
}

function docxPartTitle(path: string): string {
    if (path === 'word/document.xml') return '正文';
    if (/header/iu.test(path)) return '页眉';
    if (/footer/iu.test(path)) return '页脚';
    if (/footnotes/iu.test(path)) return '脚注';
    if (/endnotes/iu.test(path)) return '尾注';
    return '文档内容';
}

function docxParagraphRole(paragraph: string, path: string): NonNullable<DocumentSegment['role']> {
    if (/header/iu.test(path)) return 'header';
    if (/footer/iu.test(path)) return 'footer';
    if (/(?:footnotes|endnotes)/iu.test(path)) return 'note';
    const style = paragraph.match(/<w:pStyle\b[^>]*\bw:val="([^"]+)"/iu)?.[1] || '';
    if (/title/iu.test(style)) return 'title';
    if (/heading|标题/iu.test(style)) return 'heading';
    if (/<w:numPr\b/iu.test(paragraph)) return 'list-item';
    return 'paragraph';
}

async function parseDocx(fileName: string, bytes: Uint8Array): Promise<ParsedDocument> {
    let zip: JSZip;
    try {
        zip = await JSZip.loadAsync(bytes);
    } catch (error) {
        throw new Error(`DOCX 解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
    assertArchiveSafety(zip, 'DOCX');
    if (!zip.file('[Content_Types].xml') || !zip.file('word/document.xml')) {
        throw new Error('DOCX 文件结构无效，文件可能已损坏或扩展名不正确');
    }

    const partPaths = Object.keys(zip.files)
        .filter((path) => /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/u.test(path))
        .sort((left, right) => {
            const rank = (path: string) => path === 'word/document.xml'
                ? 0
                : /header/iu.test(path)
                    ? 1
                    : /footer/iu.test(path)
                        ? 2
                        : /footnotes/iu.test(path)
                            ? 3
                            : 4;
            if (rank(left) !== rank(right)) return rank(left) - rank(right);
            return left.localeCompare(right);
        });
    const segments: DocumentSegment[] = [];
    const parts: DocxDocumentPart[] = [];

    for (const path of partPaths) {
        const source = await zip.file(path)!.async('string');
        const paragraphSegments: Array<{paragraphIndex: number; segmentIndex: number}> = [];
        let paragraphIndex = 0;
        let partSegmentIndex = 0;
        DOCX_PARAGRAPH_PATTERN.lastIndex = 0;
        let paragraphMatch = DOCX_PARAGRAPH_PATTERN.exec(source);
        while (paragraphMatch) {
            const text = docxParagraphText(paragraphMatch[0]);
            if (text) {
                const segmentIndex = segments.length;
                segments.push({
                    id: segmentIndex,
                    source: text,
                    contextLabel: partSegmentIndex === 0 ? docxPartTitle(path) : undefined,
                    pathLabel: docxPartTitle(path),
                    role: docxParagraphRole(paragraphMatch[0], path),
                });
                paragraphSegments.push({paragraphIndex, segmentIndex});
                partSegmentIndex += 1;
            }
            paragraphIndex += 1;
            paragraphMatch = DOCX_PARAGRAPH_PATTERN.exec(source);
        }
        if (paragraphSegments.length > 0) parts.push({path, source, paragraphSegments});
    }

    if (segments.length === 0) throw new Error('DOCX 中没有找到可翻译的段落文字');
    return {
        fileName,
        format: 'docx',
        label: getDocumentFormatLabel('docx'),
        parts: [],
        segments,
        binary: {kind: 'docx', bytes, parts},
    };
}

export async function parseBinaryDocument(fileName: string, input: ArrayBuffer | Uint8Array): Promise<ParsedDocument> {
    const format = getDocumentFormat(fileName);
    if (!format || !isBinaryDocumentFormat(format)) {
        throw new Error('该文件不是 PDF、ePub 或 DOCX 二进制文档');
    }
    const bytes = toUint8Array(input);
    if (format === 'pdf') return parsePdf(fileName, bytes);
    if (format === 'epub') return parseEpub(fileName, bytes);
    return parseDocx(fileName, bytes);
}

export async function parseDocumentFile(file: DocumentFileLike): Promise<ParsedDocument> {
    const format = getDocumentFormat(file.name);
    if (!format) {
        throw new Error('暂不支持该文件格式，请选择 PDF、ePub、HTML、JSON、TXT、DOCX、Markdown 或字幕文件');
    }
    if (isBinaryDocumentFormat(format)) return parseBinaryDocument(file.name, await file.arrayBuffer());
    return parseDocument(file.name, await file.text());
}

function wrapCanvasText(context: CanvasRenderingContext2D, value: string, maxWidth: number): string[] {
    const lines: string[] = [];
    value.replace(/\r\n?/gu, '\n').split('\n').forEach((paragraph) => {
        if (!paragraph) {
            lines.push('');
            return;
        }
        let current = '';
        const flush = () => {
            if (current.trim()) lines.push(current.trimEnd());
            current = '';
        };
        const words = paragraph.match(/\S+/gu) || [];
        words.forEach((word) => {
            const candidate = current ? `${current} ${word}` : word;
            if (context.measureText(candidate).width <= maxWidth) {
                current = candidate;
                return;
            }
            flush();
            if (context.measureText(word).width <= maxWidth) {
                current = word;
                return;
            }
            Array.from(word).forEach((character) => {
                const characterCandidate = current + character;
                if (current && context.measureText(characterCandidate).width > maxWidth) flush();
                current += character;
            });
        });
        flush();
    });
    return lines.length > 0 ? lines : [''];
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('浏览器无法生成 PDF 译文页面'));
                return;
            }
            void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
        }, 'image/png');
    });
}

const browserPdfCache = new WeakMap<Uint8Array, Promise<any>>();

function browserPdfDocument(bytes: Uint8Array): Promise<any> {
    const cached = browserPdfCache.get(bytes);
    if (cached) return cached;
    const pdfAssetRoot = `${window.location.origin}/pdfjs`;
    const promise = getPdfDocument({
        data: new Uint8Array(bytes),
        disableFontFace: false,
        isEvalSupported: false,
        useWorkerFetch: false,
        cMapPacked: true,
        cMapUrl: `${pdfAssetRoot}/cmaps/`,
        standardFontDataUrl: `${pdfAssetRoot}/standard_fonts/`,
    }).promise;
    browserPdfCache.set(bytes, promise);
    return promise;
}

async function renderPdfSourceCanvas(bytes: Uint8Array, pageNumber: number, width: number): Promise<HTMLCanvasElement> {
    if (typeof globalThis.document === 'undefined' || typeof globalThis.window === 'undefined') {
        throw new Error('当前环境无法渲染 PDF 页面，请在浏览器扩展中打开');
    }
    const pdf = await browserPdfDocument(bytes);
    const page = await pdf.getPage(pageNumber);
    const scale = Math.min(2.4, Math.max(1.45, 1440 / Math.max(1, width)));
    const viewport = page.getViewport({scale});
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext('2d', {alpha: false});
    if (!context) throw new Error('浏览器 Canvas 初始化失败');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({canvas, canvasContext: context, viewport}).promise;
    page.cleanup();
    return canvas;
}

function sampledBackgroundRgb(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
): [number, number, number] {
    const points: Array<[number, number]> = [];
    const steps = 8;
    for (let index = 0; index <= steps; index += 1) {
        const ratio = index / steps;
        points.push([x + width * ratio, y - 2], [x + width * ratio, y + height + 2]);
        points.push([x - 2, y + height * ratio], [x + width + 2, y + height * ratio]);
    }
    const colors: Array<[number, number, number]> = [];
    points.forEach(([pointX, pointY]) => {
        const safeX = Math.max(0, Math.min(context.canvas.width - 1, Math.round(pointX)));
        const safeY = Math.max(0, Math.min(context.canvas.height - 1, Math.round(pointY)));
        const pixel = context.getImageData(safeX, safeY, 1, 1).data;
        if (pixel[3] > 0) colors.push([pixel[0], pixel[1], pixel[2]]);
    });
    if (colors.length === 0) return [255, 255, 255];
    const channelMedian = (channel: 0 | 1 | 2) => median(colors.map((color) => color[channel]));
    return [
        Math.round(channelMedian(0)),
        Math.round(channelMedian(1)),
        Math.round(channelMedian(2)),
    ];
}

function sampledForegroundColor(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    background: [number, number, number],
): string {
    const safeX = Math.max(0, Math.floor(x));
    const safeY = Math.max(0, Math.floor(y));
    const safeWidth = Math.max(1, Math.min(context.canvas.width - safeX, Math.ceil(width)));
    const safeHeight = Math.max(1, Math.min(context.canvas.height - safeY, Math.ceil(height)));
    const pixels = context.getImageData(safeX, safeY, safeWidth, safeHeight).data;
    const stride = Math.max(1, Math.ceil(Math.sqrt((safeWidth * safeHeight) / 3200)));
    const candidates: Array<{color: [number, number, number]; distance: number}> = [];
    for (let pointY = 0; pointY < safeHeight; pointY += stride) {
        for (let pointX = 0; pointX < safeWidth; pointX += stride) {
            const offset = (pointY * safeWidth + pointX) * 4;
            if (pixels[offset + 3] === 0) continue;
            const color: [number, number, number] = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
            const distance = Math.hypot(
                color[0] - background[0],
                color[1] - background[1],
                color[2] - background[2],
            );
            if (distance >= 48) candidates.push({color, distance});
        }
    }
    if (candidates.length === 0) return '#111827';
    candidates.sort((left, right) => right.distance - left.distance);
    const strongest = candidates.slice(0, Math.max(3, Math.ceil(candidates.length * 0.22)));
    const channel = (index: 0 | 1 | 2) => Math.round(median(strongest.map((entry) => entry.color[index])));
    return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

function paintPdfTranslation(
    sourceCanvas: HTMLCanvasElement,
    input: PdfRasterPageInput,
): HTMLCanvasElement {
    const canvas = globalThis.document.createElement('canvas');
    canvas.width = sourceCanvas.width;
    canvas.height = sourceCanvas.height;
    const context = canvas.getContext('2d', {alpha: false});
    if (!context) throw new Error('浏览器 Canvas 初始化失败');
    context.drawImage(sourceCanvas, 0, 0);
    const scaleX = canvas.width / input.width;
    const scaleY = canvas.height / input.height;

    const paintedBlocks = input.blocks.flatMap((block) => {
        const translation = input.translations[block.segmentIndex] || '';
        if (!translation.trim()) return [];
        const x = Math.max(0, block.x * scaleX);
        const y = Math.max(0, block.y * scaleY);
        const width = Math.max(8, Math.min(canvas.width - x, block.width * scaleX));
        const height = Math.max(8, Math.min(canvas.height - y, block.height * scaleY));
        // PDF.js and pdf-lib both use the source page's coordinate system. Keep
        // the mask tight enough to preserve figures and rules, but large enough
        // to remove glyph ascenders/descenders before drawing the new text.
        const padding = Math.max(2, Math.min(scaleX, scaleY) * 1.2);
        const background = sampledBackgroundRgb(context, x, y, width, height);
        const foreground = sampledForegroundColor(context, x, y, width, height, background);
        return [{block, translation, x, y, width, height, padding, background, foreground}];
    });

    const familyForBlock = (block: PdfDocumentBlock): string => /serif/iu.test(block.fontFamily)
        ? '"Noto Serif CJK SC", "Songti SC", Georgia, "Times New Roman", serif'
        : '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", "Arial Unicode MS", Arial, sans-serif';

    type MeasuredBlock = (typeof paintedBlocks)[number] & {
        fontSize: number;
        lines: string[];
        lineHeight: number;
    };

    const layout: MeasuredBlock[] = paintedBlocks.map((painted) => {
        const family = familyForBlock(painted.block);
        const maxWidth = Math.max(6, painted.width - painted.padding * 1.5);
        const maxHeight = Math.max(
            6,
            painted.height - painted.padding * 0.55,
            painted.block.lineHeight * scaleY * Math.max(1, painted.block.lineCount) - painted.padding * 0.4,
        );
        let fontSize = Math.max(5, painted.block.fontSize * Math.min(scaleX, scaleY));
        let lines: string[] = [];
        let lineHeight = Math.max(4, fontSize * 1.14);
        while (fontSize >= 3.5) {
            context.font = `${painted.block.fontWeight} ${fontSize}px ${family}`;
            lines = wrapCanvasText(context, painted.translation, maxWidth);
            lineHeight = Math.max(4, fontSize * 1.14);
            if (lines.length * lineHeight <= maxHeight * 1.02) break;
            fontSize -= Math.max(0.35, fontSize * 0.045);
        }
        return {...painted, fontSize, lines, lineHeight};
    });

    // Erase every source text region first. Drawing a mask and translated text
    // in the same loop makes overlapping PDF text chunks erase translations
    // that were already painted, which is especially visible in multi-column
    // papers and dense table captions.
    paintedBlocks.forEach(({x, y, width, height, padding, background}) => {
        context.fillStyle = `rgb(${background[0]}, ${background[1]}, ${background[2]})`;
        const left = Math.max(0, x - padding);
        const top = Math.max(0, y - padding);
        const right = Math.min(canvas.width, x + width + padding);
        const bottom = Math.min(canvas.height, y + height + padding);
        context.fillRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
    });

    layout.forEach(({block, x, y, width, height, padding, foreground, fontSize, lines, lineHeight}) => {
        const family = familyForBlock(block);
        const maxWidth = Math.max(6, width - padding * 1.5);
        context.save();
        context.beginPath();
        context.rect(x, y, width, height);
        context.clip();
        context.fillStyle = foreground;
        context.textBaseline = 'top';
        context.textAlign = block.textAlign;
        context.font = `${block.fontWeight} ${fontSize}px ${family}`;
        const textX = block.textAlign === 'center' ? x + width / 2 : block.textAlign === 'right' ? x + width : x;
        const contentHeight = lines.length * lineHeight;
        let textY = y + Math.max(padding * 0.2, (height - contentHeight) / 2);
        lines.forEach((line) => {
            context.fillText(line, textX, textY, maxWidth);
            textY += lineHeight;
        });
        context.restore();
    });
    return canvas;
}

export interface PdfPagePreview {
    original: Uint8Array;
    translated?: Uint8Array;
}

export async function createPdfPagePreview(
    document: ParsedDocument,
    pageNumber: number,
    translations?: readonly string[],
): Promise<PdfPagePreview> {
    if (document.binary?.kind !== 'pdf') throw new Error('PDF 文档状态无效，请重新打开文件');
    const page = document.binary.pages.find((entry) => entry.pageNumber === pageNumber);
    if (!page) throw new Error(`PDF 第 ${pageNumber} 页不存在`);
    const sourceCanvas = await renderPdfSourceCanvas(document.binary.bytes, pageNumber, page.width);
    const original = await canvasToPng(sourceCanvas);
    if (!translations) return {original};
    const translatedCanvas = paintPdfTranslation(sourceCanvas, {
        ...page,
        sourceBytes: document.binary.bytes,
        translations: [...translations],
    });
    return {original, translated: await canvasToPng(translatedCanvas)};
}

export async function rasterizePdfTranslationPage(input: PdfRasterPageInput): Promise<Uint8Array> {
    if (typeof globalThis.document === 'undefined') {
        throw new Error('当前环境无法生成 PDF 译文页面，请在浏览器扩展中下载');
    }
    const sourceCanvas = await renderPdfSourceCanvas(input.sourceBytes, input.pageNumber, input.width);
    return canvasToPng(paintPdfTranslation(sourceCanvas, input));
}

async function renderPdf(
    document: ParsedDocument,
    translations: readonly string[],
    mode: DocumentRenderMode,
    rasterizer: PdfPageRasterizer,
): Promise<Uint8Array> {
    if (document.binary?.kind !== 'pdf') throw new Error('PDF 文档状态无效，请重新打开文件');
    const sourcePdf = await PDFDocument.load(document.binary.bytes);
    const outputPdf = await PDFDocument.create();
    outputPdf.setTitle(`${document.fileName} - FluentRead`);
    outputPdf.setProducer('FluentRead document translation');

    for (const pageData of document.binary.pages) {
        const normalizedTranslations = document.segments.map((segment) => translations[segment.id] ?? segment.source);
        const png = await rasterizer({
            ...pageData,
            sourceBytes: document.binary.bytes,
            translations: normalizedTranslations,
        });
        const image = await outputPdf.embedPng(png);
        if (mode === 'bilingual') {
            const sourcePage = sourcePdf.getPage(pageData.pageNumber - 1);
            const embeddedSource = await outputPdf.embedPage(sourcePage);
            const gap = Math.max(8, Math.min(24, pageData.width * 0.025));
            const page = outputPdf.addPage([pageData.width * 2 + gap, pageData.height]);
            page.drawPage(embeddedSource, {x: 0, y: 0, width: pageData.width, height: pageData.height});
            page.drawImage(image, {
                x: pageData.width + gap,
                y: 0,
                width: pageData.width,
                height: pageData.height,
            });
        } else {
            const page = outputPdf.addPage([pageData.width, pageData.height]);
            page.drawImage(image, {x: 0, y: 0, width: pageData.width, height: pageData.height});
        }
    }
    return outputPdf.save({useObjectStreams: true});
}

async function renderEpub(document: ParsedDocument, translations: readonly string[], mode: DocumentRenderMode): Promise<Uint8Array> {
    if (document.binary?.kind !== 'epub') throw new Error('ePub 文档状态无效，请重新打开文件');
    const zip = await JSZip.loadAsync(document.binary.bytes);
    assertArchiveSafety(zip, 'ePub');
    for (const chapter of document.binary.chapters) {
        const parsedChapter = parseDocument('chapter.html', chapter.source);
        const chapterTranslations = translations.slice(chapter.segmentOffset, chapter.segmentOffset + chapter.segmentCount);
        zip.file(chapter.path, renderDocument(parsedChapter, chapterTranslations, mode));
    }
    zip.file('mimetype', 'application/epub+zip', {compression: 'STORE'});
    return zip.generateAsync({
        type: 'uint8array',
        mimeType: 'application/epub+zip',
        compression: 'DEFLATE',
        compressionOptions: {level: 6},
    });
}

function docxTextNodes(value: string): string {
    const tokens = value.replace(/\r\n?/gu, '\n').split(/(\n|\t)/u);
    const content = tokens.map((token) => {
        if (token === '\n') return '<w:br/>';
        if (token === '\t') return '<w:tab/>';
        return token ? `<w:t xml:space="preserve">${xmlEscape(token)}</w:t>` : '';
    }).join('');
    return content || '<w:t></w:t>';
}

function translatedDocxParagraph(value: string): string {
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="120"/></w:pPr><w:r><w:rPr><w:color w:val="E83B6B"/></w:rPr>${docxTextNodes(value)}</w:r></w:p>`;
}

function replaceDocxParagraphText(paragraph: string, value: string): string {
    let replaced = false;
    return paragraph.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>/gu, () => {
        if (replaced) return '';
        replaced = true;
        return docxTextNodes(value);
    });
}

function renderDocxPart(
    document: ParsedDocument,
    part: DocxDocumentPart,
    translations: readonly string[],
    mode: DocumentRenderMode,
): string {
    const segmentByParagraph = new Map(part.paragraphSegments.map((entry) => [entry.paragraphIndex, entry.segmentIndex]));
    let paragraphIndex = 0;
    DOCX_PARAGRAPH_PATTERN.lastIndex = 0;
    return part.source.replace(DOCX_PARAGRAPH_PATTERN, (paragraph) => {
        const segmentIndex = segmentByParagraph.get(paragraphIndex);
        paragraphIndex += 1;
        if (segmentIndex === undefined) return paragraph;
        const translation = translations[segmentIndex] ?? document.segments[segmentIndex]?.source ?? '';
        return mode === 'bilingual'
            ? `${paragraph}${translatedDocxParagraph(translation)}`
            : replaceDocxParagraphText(paragraph, translation);
    });
}

async function renderDocx(document: ParsedDocument, translations: readonly string[], mode: DocumentRenderMode): Promise<Uint8Array> {
    if (document.binary?.kind !== 'docx') throw new Error('DOCX 文档状态无效，请重新打开文件');
    const zip = await JSZip.loadAsync(document.binary.bytes);
    assertArchiveSafety(zip, 'DOCX');
    document.binary.parts.forEach((part) => {
        zip.file(part.path, renderDocxPart(document, part, translations, mode));
    });
    return zip.generateAsync({
        type: 'uint8array',
        mimeType: getDocumentMimeType('docx'),
        compression: 'DEFLATE',
        compressionOptions: {level: 6},
    });
}

export async function createDocumentDownload(
    document: ParsedDocument,
    translations: readonly string[],
    mode: DocumentRenderMode,
    options: CreateDocumentDownloadOptions = {},
): Promise<DocumentDownload> {
    let data: string | Uint8Array;
    if (document.format === 'pdf') {
        data = await renderPdf(document, translations, mode, options.pdfPageRasterizer || rasterizePdfTranslationPage);
    } else if (document.format === 'epub') {
        data = await renderEpub(document, translations, mode);
    } else if (document.format === 'docx') {
        data = await renderDocx(document, translations, mode);
    } else {
        data = renderDocument(document, translations, mode);
    }
    return {
        data,
        fileName: createDocumentDownloadName(document.fileName, mode),
        mimeType: getDocumentMimeType(document.format),
    };
}
