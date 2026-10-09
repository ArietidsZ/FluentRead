/**
 * @file src/features/document-translation/core/pdfBlockFit.ts
 * 文件职责：为“原版排版”阅读把一段译文放回原文段落所占的矩形，决定哪些段落可以原位替换、可用高度和最终字号与分行。
 * 主要内容：筛选可原位替换的正文块并排除公式、数字表格单元格、主体位于图形区域内的文字与页眉页脚，含词语的表格单元格可以替换；量出段落下方到相邻内容之间的空白；从原字号开始按面积比例收缩，直到译文按行距排入可用高度或达到最小可读字号，超出时如实标记溢出而不裁掉文字。
 * 模块边界：纯几何与文字分行，不创建 DOM 或 Canvas、不读取像素、不调用翻译；字宽测量由调用方注入，页面旋转由展示层处理。
 */
import type {PdfDocumentBlock, PdfDocumentPage} from './document';
import {wrapPdfReadingText} from './pdfTextLayout';

export interface PdfOverlayBlock {
    block: PdfDocumentBlock;
    /** 段落下方可以借用的空白（PDF 点），不含与相邻内容之间保留的一点间隙。 */
    spaceBelow: number;
    /** 单行标题右侧到相邻内容或对称页边距之间的空白（PDF 点）。 */
    spaceRight: number;
}
export interface PdfBlockFitInput {
    text: string;
    width: number;
    height: number;
    fontSize: number;
    /** 原文行距；单行块没有行距时传入字号即可。 */
    lineHeight: number;
    minFontSize: number;
    weight: 400 | 600 | 700;
}
export interface PdfBlockFit {fontSize: number; lineHeight: number; lines: string[]; overflow: boolean}
export type PdfBlockMeasure = (text: string, fontSize: number, weight: 400 | 600 | 700) => number;

const PROTECTED_KINDS = new Set(['formula', 'figure-label', 'metadata', 'footer']);
const right = (box: {x: number; width: number}) => box.x + box.width;
const bottom = (box: {y: number; height: number}) => box.y + box.height;

/** 与导出时的原位绘制使用同一取舍：受保护内容保留原页像素，其余正文块才会被译文替换。 */
export function pdfOverlayBlocks(page: PdfDocumentPage): PdfOverlayBlock[] {
    const regions = page.preservedRegions ?? [];
    const quarterTurn = page.rotation === 90 || page.rotation === 270;
    const contentHeight = quarterTurn ? page.width : page.height;
    const contentWidth = quarterTurn ? page.height : page.width;
    return page.blocks.flatMap(block => {
        if (block.preserveSource || PROTECTED_KINDS.has(block.kind ?? '') || !(block.width > 0) || !(block.height > 0)) return [];
        // 图形对象的包围盒常比可见图形大，会伸进相邻一栏；只有主体落在区域内的段落才算图内文字。
        if (regions.some(region => {
            // 可翻译的表格单元格位于自己的表格区域内，不算被保护。
            if (block.kind === 'table' && region.kind === 'table') return false;
            const overlapWidth = Math.min(right(block), right(region)) - Math.max(block.x, region.x);
            const overlapHeight = Math.min(bottom(block), bottom(region)) - Math.max(block.y, region.y);
            return overlapWidth > 0 && overlapHeight > 0 && overlapWidth * overlapHeight >= block.width * block.height * 0.5;
        })) return [];
        let limit = contentHeight, edge = Math.max(right(block), contentWidth - Math.max(0, block.x));
        for (const other of [...page.blocks, ...regions]) {
            if (other === block) continue;
            if (other.y >= bottom(block) - 1 && other.x < right(block) && right(other) > block.x) limit = Math.min(limit, other.y);
            if (other.x >= right(block) - 1 && other.y < bottom(block) && bottom(other) > block.y) edge = Math.min(edge, other.x);
        }
        return [{block, spaceBelow: Math.max(0, limit - bottom(block) - 1.5), spaceRight: Math.max(0, edge - right(block) - 6)}];
    });
}

/**
 * 字号只在放不下时收缩；每一步按“需要高度 / 可用高度”的平方根估计，通常两三步收敛。
 * 行距沿用原文的行距比例，并限制在适合中日韩文字阅读的范围内。
 */
export function fitPdfBlockText(input: PdfBlockFitInput, measure: PdfBlockMeasure): PdfBlockFit {
    const width = Math.max(1, input.width);
    const start = Math.max(1, input.fontSize);
    const floor = Math.min(start, Math.max(1, input.minFontSize));
    const ratio = Math.min(1.6, Math.max(1.25, input.lineHeight / start));
    let fontSize = start;
    for (let step = 0; ; step += 1) {
        const lineHeight = fontSize * ratio;
        const lines = wrapPdfReadingText(input.text, width, {size: fontSize, weight: input.weight, lineHeight}, (text, font) => measure(text, font.size, font.weight));
        const needed = lines.length * lineHeight;
        // 末行下方本就没有行间空白，允许超出四分之一行而不缩小字号。
        const fits = needed <= input.height + lineHeight * 0.25;
        if (fits || fontSize <= floor || step >= 12) return {fontSize, lineHeight, lines, overflow: !fits};
        fontSize = Math.max(floor, fontSize * Math.min(0.97, Math.max(0.8, Math.sqrt(input.height / needed))));
    }
}
