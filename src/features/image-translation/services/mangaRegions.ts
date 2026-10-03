/**
 * @file src/features/image-translation/services/mangaRegions.ts
 * 文件职责：把漫画神经 OCR 的坐标、置信度和文字转换成可整段翻译的气泡或旁白区域。
 * 主要内容：校验并夹紧原图坐标，过滤低置信度、纯符号和源语言不符的碎片；按书写方向、字号、重叠与间距合并相邻行，保持不同气泡分离和正确阅读顺序。
 * 模块边界：纯数据算法，不运行模型、不读取 DOM 或配置，也不修补图片；只输出可核对的识别原文和区域，不推测缺失文字。
 */
import type {OcrLine} from '@/src/shared/image/types';

export interface MangaOcrItem {
    text: string;
    confidence: number;
    box: {x: number; y: number; width: number; height: number};
}
export interface MangaRegion extends OcrLine {fontSize: number; sourceBoxes?: OcrLine['bbox'][]}

function union(left: OcrLine['bbox'], right: OcrLine['bbox']): OcrLine['bbox'] {
    return {x0: Math.min(left.x0, right.x0), y0: Math.min(left.y0, right.y0),
        x1: Math.max(left.x1, right.x1), y1: Math.max(left.y1, right.y1)};
}

function adjacent(left: MangaRegion, right: MangaRegion): boolean {
    if (left.vertical !== right.vertical) return false;
    const a = left.bbox, b = right.bbox;
    const [start, end, crossStart, crossEnd] = left.vertical
        ? ['x0', 'x1', 'y0', 'y1'] as const : ['y0', 'y1', 'x0', 'x1'] as const;
    const thickness = Math.min(left.fontSize, right.fontSize);
    if (Math.max(left.fontSize, right.fontSize) > thickness * 1.8) return false;
    const gap = Math.max(a[start], b[start]) - Math.min(a[end], b[end]);
    const overlap = Math.min(a[crossEnd], b[crossEnd]) - Math.max(a[crossStart], b[crossStart]);
    // 同一基线的分词先由 OCR 合并；这里仅跨行/列合段，避免旁边的气泡被连成一句。
    const centers = Math.abs((a[start] + a[end]) - (b[start] + b[end])) / 2;
    if (centers < thickness * 0.45) {
        return gap <= 0 && -overlap <= thickness * 0.8;
    }
    return gap <= thickness * 0.8
        && overlap >= Math.min(a[crossEnd] - a[crossStart], b[crossEnd] - b[crossStart]) * 0.5;
}

/** 源语言只用于排除明确不符的绘画噪声；自动检测保留两种书写系统。 */
export function groupMangaText(items: MangaOcrItem[], sourceLanguage: string, width: number, height: number): MangaRegion[] {
    if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) return [];
    const english = /^en(?:-|$)/i.test(sourceLanguage);
    const japanese = /^(?:ja|jpn)(?:-|$)/i.test(sourceLanguage);
    const lines: MangaRegion[] = items.flatMap(item => {
        const text = item.text.replace(/\s+/gu, ' ').trim();
        const box = item.box;
        if (!Number.isFinite(item.confidence) || item.confidence < 0.65 || !text || !/\p{L}/u.test(text)
            || (english && (!/[a-z]/iu.test(text) || /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(text)))
            || (japanese && !/[\u3040-\u30ff\u3400-\u9fff]/u.test(text) && text.replace(/[^a-z]/giu,'').length < 4)
            || ![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) return [];
        const bbox = {x0: Math.max(0, box.x), y0: Math.max(0, box.y),
            x1: Math.min(width, box.x + box.width), y1: Math.min(height, box.y + box.height)};
        if (bbox.x1 <= bbox.x0 || bbox.y1 <= bbox.y0) return [];
        const vertical = !english && box.height > box.width * 1.8;
        const fontSize = vertical ? box.width : box.height;
        // 巨大拟声字和纹理中的孤字不作为对白；保留 I/A 等合法英语短句。
        if (Array.from(text.replace(/[^\p{L}\p{N}]/gu, '')).length < 2
            && (english ? !/^[IA][.!?]?$/u.test(text) : item.confidence < 0.9 || Math.max(box.width, box.height) > width * 0.12)) return [];
        return [{text, bbox, fontSize, ...(vertical ? {vertical: true as const} : {})}];
    });
    const groups: MangaRegion[][] = [];
    const remaining = new Set(lines);
    for (const first of lines) {
        if (!remaining.delete(first)) continue;
        const members = [first];
        for (let cursor = 0; cursor < members.length; cursor += 1) {
            for (const next of remaining) if (adjacent(members[cursor], next)) {
                remaining.delete(next); members.push(next);
            }
        }
        groups.push(members);
    }
    return groups.map(members => {
        members.sort((a, b) => {
            const near = Math.min(a.fontSize, b.fontSize) * 0.45;
            return a.vertical
                ? Math.abs(a.bbox.x0 - b.bbox.x0) < near ? a.bbox.y0 - b.bbox.y0 : b.bbox.x0 - a.bbox.x0
                : Math.abs(a.bbox.y0 - b.bbox.y0) < near ? a.bbox.x0 - b.bbox.x0 : a.bbox.y0 - b.bbox.y0;
        });
        const sizes = members.map(member => member.fontSize).sort((a, b) => a - b);
        const text=members.map(member => member.text).join(members[0].vertical ? '' : ' ')
            .replace(/(\p{L}{2,})-\s+(\p{L})/gu,'$1$2');
        return {text,
            bbox: members.map(member => member.bbox).reduce(union), fontSize: sizes[Math.floor(sizes.length / 2)],
            sourceBoxes: members.map(member => ({...member.bbox})),
            ...(members[0].vertical ? {vertical: true as const} : {})};
    }).sort((a, b) => a.bbox.y0 - b.bbox.y0 || b.bbox.x0 - a.bbox.x0);
}
