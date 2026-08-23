import JSZip from 'jszip';
import {PDFDocument} from 'pdf-lib';
import {
    GlobalWorkerOptions,
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
    type PdfDocumentPage,
} from '@/entrypoints/utils/documentTranslation';

if (typeof window !== 'undefined') {
    GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

const BINARY_DOCUMENT_FORMATS = new Set<DocumentFormat>(['pdf', 'epub', 'docx']);
const DOCX_PARAGRAPH_PATTERN = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/gu;
const DOCX_TEXT_TOKEN_PATTERN = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/gu;
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

interface PdfTextLine {
    text: string;
    y: number;
    height: number;
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
    translations: string[];
}

export type PdfPageRasterizer = (input: PdfRasterPageInput) => Promise<Uint8Array[]>;

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

function pdfTextLines(items: PdfTextItem[]): PdfTextLine[] {
    const lines: PdfTextLine[] = [];
    let current = '';
    let currentY: number | undefined;
    let currentHeight = 0;
    let currentEndX: number | undefined;

    const flush = () => {
        const normalized = current.replace(/[\t\u00a0 ]+/gu, ' ').trim();
        if (normalized) lines.push({text: normalized, y: currentY || 0, height: currentHeight || 1});
        current = '';
        currentY = undefined;
        currentHeight = 0;
        currentEndX = undefined;
    };

    items.forEach((item) => {
        const text = item.str.replace(/\u0000/gu, '');
        if (!text && !item.hasEOL) return;
        const x = Number(item.transform?.[4] || 0);
        const y = Number(item.transform?.[5] || 0);
        const height = Math.max(1, Number(item.height || item.transform?.[3] || 1));
        const newLine = currentY !== undefined && Math.abs(y - currentY) > Math.max(2, currentHeight * 0.55, height * 0.55);
        if (newLine) flush();

        if (current) {
            const gap = currentEndX === undefined ? 0 : x - currentEndX;
            const needsSpace = gap > Math.max(1.2, height * 0.08)
                && !/[\s\-–—/]$/u.test(current)
                && !/^[,.;:!?，。；：！？)\]}]/u.test(text);
            if (needsSpace) current += ' ';
        }
        current += text;
        currentY = y;
        currentHeight = Math.max(currentHeight, height);
        currentEndX = x + Number(item.width || 0);
        if (item.hasEOL) flush();
    });
    flush();
    return lines;
}

function median(values: number[]): number {
    if (values.length === 0) return 1;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function pdfTextSegments(lines: PdfTextLine[]): string[] {
    if (lines.length === 0) return [];
    const bodyHeight = Math.max(1, median(lines.map((line) => line.height)));
    const segments: string[] = [];
    let paragraph = '';

    const flush = () => {
        const value = paragraph.trim();
        if (value) segments.push(value);
        paragraph = '';
    };
    const isHeading = (line: PdfTextLine) => line.height >= bodyHeight * 1.3;
    const isSentenceEnd = (value: string) => /[.!?。！？]["')\]}]*$/u.test(value);

    lines.forEach((line, index) => {
        const previous = lines[index - 1];
        const next = lines[index + 1];
        const gapFromPrevious = previous ? Math.abs(previous.y - line.y) : 0;
        const paragraphGap = previous
            ? gapFromPrevious > Math.max(previous.height, line.height) * 1.65
            : false;

        if (isHeading(line) || paragraphGap) flush();
        if (isHeading(line)) {
            segments.push(line.text);
            return;
        }

        if (!paragraph) paragraph = line.text;
        else if (/[-‐‑]$/u.test(paragraph) && /^[a-z]/u.test(line.text)) paragraph = `${paragraph.slice(0, -1)}${line.text}`;
        else paragraph += ` ${line.text}`;

        const gapToNext = next ? Math.abs(line.y - next.y) : 0;
        const nextStartsBlock = !next
            || isHeading(next)
            || gapToNext > Math.max(line.height, next.height) * 1.65;
        if (isSentenceEnd(line.text) || nextStartsBlock) flush();
    });
    flush();
    return segments;
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
            const lines = pdfTextSegments(pdfTextLines(textContent.items.filter((item): item is PdfTextItem => 'str' in item)));
            const segmentIndexes: number[] = [];
            lines.forEach((source, lineIndex) => {
                const id = segments.length;
                segments.push({
                    id,
                    source,
                    contextLabel: lineIndex === 0 ? `第 ${pageNumber} 页` : undefined,
                });
                segmentIndexes.push(id);
            });
            pages.push({
                pageNumber,
                width: viewport.width,
                height: viewport.height,
                segmentIndexes,
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
        Array.from(paragraph).forEach((character) => {
            const candidate = current + character;
            if (current && context.measureText(candidate).width > maxWidth) {
                const breakIndex = Math.max(current.lastIndexOf(' '), current.lastIndexOf('\t'));
                if (breakIndex > 0) {
                    lines.push(current.slice(0, breakIndex).trimEnd());
                    current = `${current.slice(breakIndex).trimStart()}${character}`;
                } else {
                    lines.push(current.trimEnd());
                    current = character.trimStart();
                }
            } else {
                current = candidate;
            }
        });
        if (current) lines.push(current.trimEnd());
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

export async function rasterizePdfTranslationPages(input: PdfRasterPageInput): Promise<Uint8Array[]> {
    if (typeof globalThis.document === 'undefined') {
        throw new Error('当前环境无法生成 PDF 译文页面，请在浏览器扩展中下载');
    }

    const scale = Math.min(2.2, Math.max(1.5, 1440 / Math.max(1, input.width)));
    const pixelWidth = Math.max(900, Math.round(input.width * scale));
    const pixelHeight = Math.max(1200, Math.round(input.height * scale));
    const margin = Math.round(pixelWidth * 0.065);
    const bodyFontSize = Math.max(24, Math.round(pixelWidth * 0.021));
    const labelFontSize = Math.max(16, Math.round(bodyFontSize * 0.62));
    const lineHeight = Math.round(bodyFontSize * 1.55);
    const bottom = pixelHeight - margin;
    const canvases: HTMLCanvasElement[] = [];
    let canvas!: HTMLCanvasElement;
    let context!: CanvasRenderingContext2D;
    let y = 0;
    let part = 0;

    const startPage = () => {
        part += 1;
        canvas = globalThis.document.createElement('canvas');
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        const nextContext = canvas.getContext('2d');
        if (!nextContext) throw new Error('浏览器 Canvas 初始化失败');
        context = nextContext;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, pixelWidth, pixelHeight);
        context.fillStyle = '#e83b6b';
        context.font = `700 ${Math.round(bodyFontSize * 1.08)}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        context.fillText(`FluentRead · 第 ${input.pageNumber} 页译文`, margin, margin + bodyFontSize);
        context.fillStyle = '#7a8294';
        context.font = `500 ${labelFontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        context.fillText(`双语阅读导出${part > 1 ? ` · 续页 ${part}` : ''}`, margin, margin + bodyFontSize + lineHeight * 0.8);
        y = margin + bodyFontSize + lineHeight * 1.6;
        canvases.push(canvas);
    };

    startPage();
    input.translations.forEach((translation, index) => {
        context.font = `600 ${bodyFontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", sans-serif`;
        const lines = wrapCanvasText(context, translation, pixelWidth - margin * 2);
        if (y + labelFontSize + lineHeight * 1.4 > bottom) startPage();
        context.fillStyle = '#9a6475';
        context.font = `700 ${labelFontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        context.fillText(`段落 ${index + 1}`, margin, y);
        y += Math.round(lineHeight * 0.72);
        context.fillStyle = '#202533';
        context.font = `600 ${bodyFontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", sans-serif`;
        lines.forEach((line) => {
            if (y + lineHeight > bottom) startPage();
            context.fillStyle = '#202533';
            context.font = `600 ${bodyFontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", sans-serif`;
            context.fillText(line, margin, y);
            y += lineHeight;
        });
        y += Math.round(lineHeight * 0.35);
        if (y < bottom) {
            context.strokeStyle = '#edf0f5';
            context.lineWidth = 2;
            context.beginPath();
            context.moveTo(margin, y);
            context.lineTo(pixelWidth - margin, y);
            context.stroke();
            y += Math.round(lineHeight * 0.48);
        }
    });

    return Promise.all(canvases.map(canvasToPng));
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
        if (mode === 'bilingual') {
            const [copiedPage] = await outputPdf.copyPages(sourcePdf, [pageData.pageNumber - 1]);
            outputPdf.addPage(copiedPage);
        }
        const pageTranslations = pageData.segmentIndexes.map((segmentIndex) =>
            translations[segmentIndex] ?? document.segments[segmentIndex]?.source ?? '');
        const rasterPages = await rasterizer({...pageData, translations: pageTranslations});
        for (const png of rasterPages) {
            const image = await outputPdf.embedPng(png);
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
    const lines = value.replace(/\r\n?/gu, '\n').split('\n');
    return lines.map((line, index) => `${index > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`).join('');
}

function translatedDocxParagraph(value: string): string {
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="120"/></w:pPr><w:r><w:rPr><w:color w:val="E83B6B"/></w:rPr>${docxTextNodes(value)}</w:r></w:p>`;
}

function replaceDocxParagraphText(paragraph: string, value: string): string {
    let replaced = false;
    return paragraph.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/gu, () => {
        if (replaced) return '<w:t></w:t>';
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
        data = await renderPdf(document, translations, mode, options.pdfPageRasterizer || rasterizePdfTranslationPages);
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
