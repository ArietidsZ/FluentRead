/**
 * @file src/features/image-translation/core.ts
 * 文件职责：提供图片翻译可复用的纯数据算法，用于选择真正发生变化的译文、确定 OCR 语言组合、缩放文本框并清理 OCR 行数据。
 * 主要内容：从 shared/image 复用 OcrLine 类型，筛选有效译文、规划有界 OCR 尺寸并映回原图坐标，规范化词组、标点和置信度，避免噪声进入翻译与绘制。
 * 模块边界：该模块不接触 Canvas、Tesseract、网络或浏览器消息；OCR 执行归 ocrRuntime，像素修补与文本绘制归 services，页面展示归 content/runtime。
 */
import { getRequiredImageOcrLanguages, type ImageOcrLanguageCode } from './ocrLanguages';
import type { OcrLine } from '@/src/shared/image/types';

export type { OcrLine } from '@/src/shared/image/types';

function normalizeTranslationComparison(text: string): string {
    return text
        .toLocaleLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, '');
}

/**
 * 只保留实际发生变化的 OCR 行。
 * 这样中文原文、品牌名或微软原样返回的内容不会被重新绘制成一张
 * 看似“已翻译”但实际没有变化的覆盖层。
 */
export function selectChangedTranslations(lines: OcrLine[], translations: string[]): OcrLine[] {
    return lines.flatMap((line, index) => {
        const text = translations[index]?.trim() || line.text;
        return normalizeTranslationComparison(text) === normalizeTranslationComparison(line.text)
            ? []
            : [{ ...line, text }];
    });
}

/** 限制识别内存和耗时；只缩小超大图片，不插值放大小字或更改最终图片分辨率。 */
export function getOcrImageSize(width: number, height: number): {width: number; height: number} {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error('图片尺寸无效');
    }
    const ratio = Math.min(1, 4096 / Math.max(width, height), Math.sqrt(6_000_000 / width / height));
    return {width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio))};
}

/** 将降采样后的识别框映回原始像素，夹紧边界，避免擦除与文字替换偏移。 */
export function restoreOcrLineCoordinates(
    lines: OcrLine[],
    sourceWidth: number,
    sourceHeight: number,
    ocrWidth: number,
    ocrHeight: number,
): OcrLine[] {
    return lines.flatMap(line => {
        const bbox = {
            x0: Math.max(0, Math.floor(line.bbox.x0 * sourceWidth / ocrWidth)),
            y0: Math.max(0, Math.floor(line.bbox.y0 * sourceHeight / ocrHeight)),
            x1: Math.min(sourceWidth, Math.ceil(line.bbox.x1 * sourceWidth / ocrWidth)),
            y1: Math.min(sourceHeight, Math.ceil(line.bbox.y1 * sourceHeight / ocrHeight)),
        };
        return isValidOcrBox(bbox) ? [{...line, bbox}] : [];
    });
}

function isValidOcrBox(bbox: OcrLine['bbox']): boolean {
    return [bbox.x0, bbox.y0, bbox.x1, bbox.y1].every(Number.isFinite)
        && bbox.x1 > bbox.x0 && bbox.y1 > bbox.y0;
}

function joinOcrWords(previous: string, next: string): string {
    if (!previous) return next;
    const joinsCjk = /[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]$/u.test(previous)
        || /^[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(next);
    const joinsPunctuation = /^[,.;:!?%\u3001\u3002\uff0c\uff01\uff1f\uff1a\uff1b)\]}’”]/u.test(next)
        || /[([{\u2018\u201c]$/u.test(previous);
    return joinsCjk || joinsPunctuation ? `${previous}${next}` : `${previous} ${next}`;
}

export function getOcrLanguages(sourceLanguage: string): ImageOcrLanguageCode[] {
    return getRequiredImageOcrLanguages(sourceLanguage);
}

export function scaleOcrBox(
    bbox: OcrLine['bbox'],
    imageWidth: number,
    imageHeight: number,
    renderedWidth: number,
    renderedHeight: number,
) {
    return {
        left: Math.max(0, (bbox.x0 / imageWidth) * renderedWidth),
        top: Math.max(0, (bbox.y0 / imageHeight) * renderedHeight),
        width: Math.max(1, ((bbox.x1 - bbox.x0) / imageWidth) * renderedWidth),
        height: Math.max(1, ((bbox.y1 - bbox.y0) / imageHeight) * renderedHeight),
    };
}

export function normalizeOcrLines(
    blocks: Array<{
        paragraphs?: Array<{
            lines?: Array<{
                text: string;
                confidence?: number;
                bbox: OcrLine['bbox'];
                words?: Array<{ text: string; confidence?: number; bbox: OcrLine['bbox'] }>;
            }>;
        }>;
    }> | null | undefined,
): OcrLine[] {
    if (!blocks) return [];

    const normalized: OcrLine[] = [];
    blocks.flatMap(block => block.paragraphs || []).flatMap(paragraph => paragraph.lines || []).forEach(line => {
        const words = (line.words || [])
            .map(word => ({
                text: word.text.replace(/[\s\u3000]+/g, ' ').trim(),
                confidence: word.confidence ?? 100,
                bbox: word.bbox,
            }))
            .filter(word => word.text.length > 0 && Number.isFinite(word.confidence) && word.confidence >= 25
                && isValidOcrBox(word.bbox))
            .sort((left, right) => left.bbox.x0 - right.bbox.x0);

        if (words.length === 0) {
            // 有 word 数据却全部被过滤时，整行文本来自同一批噪声，不能再次回退复活。
            if (line.words?.length) return;
            const text = line.text.replace(/[\s\u3000]+/g, ' ').trim();
            const confidence = line.confidence ?? 100;
            if (text && Number.isFinite(confidence) && confidence >= 25 && isValidOcrBox(line.bbox)) {
                normalized.push({ text, bbox: line.bbox });
            }
            return;
        }

        let current = [words[0]];
        const flush = () => {
            const bbox = current.reduce((result, word) => ({
                x0: Math.min(result.x0, word.bbox.x0),
                y0: Math.min(result.y0, word.bbox.y0),
                x1: Math.max(result.x1, word.bbox.x1),
                y1: Math.max(result.y1, word.bbox.y1),
            }), {...current[0].bbox});
            const text = current.map(word => word.text).reduce(joinOcrWords, '');
            if (text) normalized.push({ text, bbox });
        };

        for (let index = 1; index < words.length; index += 1) {
            const previous = current[current.length - 1];
            const next = words[index];
            const previousHeight = previous.bbox.y1 - previous.bbox.y0;
            const verticalOverlap = Math.min(previous.bbox.y1, next.bbox.y1) - Math.max(previous.bbox.y0, next.bbox.y0);
            const gap = next.bbox.x0 - previous.bbox.x1;
            const sameRow = verticalOverlap >= Math.min(previousHeight, next.bbox.y1 - next.bbox.y0) * 0.35;
            // 英文单词间距可能接近一个字高；同一 OCR 行内合并，跨控件的大间距仍保持分开。
            if (sameRow && gap <= Math.max(6, previousHeight * 4)) {
                current.push(next);
            } else {
                flush();
                current = [next];
            }
        }
        flush();
    });
    return normalized;
}
