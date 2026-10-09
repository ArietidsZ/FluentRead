/**
 * @file src/features/document-translation/core/pdfLayoutAnalysis.ts
 * 文件职责：从 PDF 原始字形和绘图操作推导阅读顺序、段落与必须保留的公式、表格、插图区域。
 * 主要内容：在未旋转内容坐标中追踪绘图矩阵；按基线关联上下标，先识别图表和独立公式，再按列与段落边界组织正文；保留逐行字形几何供阅读和导出使用。
 * 模块边界：纯几何分析，不加载 PDF.js、不访问 Canvas、网络或 DOM，不修改来源文字或文件。
 */
import type {PdfDocumentBlock, PdfDocumentLine, PdfDocumentRun, PdfPreservedRegion} from './document';

type Rectangle = Pick<PdfDocumentRun, 'x' | 'y' | 'width' | 'height'>;
type Matrix = readonly number[];
export interface PdfLayoutAtom extends PdfDocumentRun {fontSize: number; baseline: number; fontFamily: string}
export interface PdfGraphicsShape extends Rectangle {kind: 'image' | 'form' | 'path'}
export interface PdfGraphicsOperators {fnArray: readonly number[]; argsArray: readonly unknown[]}
export interface PdfLayoutBlock extends Omit<PdfDocumentBlock, 'segmentIndex'> {source: string}
interface LayoutLine extends PdfDocumentLine {baseline: number; fontSize: number; fontFamily: string; runs: PdfDocumentRun[]}
const identity = [1, 0, 0, 1, 0, 0];
const median = (values: number[]) => {const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] || 10;};
const right = (box: Rectangle) => box.x + box.width;
const bottom = (box: Rectangle) => box.y + box.height;
const union = (a: Rectangle, b: Rectangle): Rectangle => {const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return {x, y, width: Math.max(right(a), right(b)) - x, height: Math.max(bottom(a), bottom(b)) - y};};
const overlaps = (a: Rectangle, b: Rectangle, padding = 0) => a.x <= right(b) + padding && right(a) + padding >= b.x && a.y <= bottom(b) + padding && bottom(a) + padding >= b.y;
const multiply = (a: Matrix, b: Matrix): number[] => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
function transformedBox(matrix: Matrix, bounds: Matrix): Rectangle {
    const points = [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[0], bounds[3]], [bounds[2], bounds[3]]]
        .map(([x, y]) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]);
    const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return {x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y};
}
function clipped(box: Rectangle, width: number, height: number): Rectangle | undefined {
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) return;
    const x = Math.max(0, box.x), y = Math.max(0, box.y);
    const result = {x, y, width: Math.min(width, right(box)) - x, height: Math.min(height, bottom(box)) - y};
    return result.width >= 0 && result.height >= 0 ? result : undefined;
}

/** PDF.js 的 constructPath 已附带控制点包围盒；clip/endPath 本身不是可见图形。 */
export function extractPdfGraphicsShapes(list: PdfGraphicsOperators, ops: Record<string, number>, viewport: {width: number; height: number; transform: Matrix}): PdfGraphicsShape[] {
    let matrix = [...identity];
    const stack: number[][] = [];
    let path: Rectangle | undefined;
    const shapes: PdfGraphicsShape[] = [];
    const add = (kind: PdfGraphicsShape['kind'], box: Rectangle) => {const valid = clipped(box, viewport.width, viewport.height); if (valid && (valid.width > 0 || valid.height > 0)) shapes.push({...valid, kind});};
    const boxFor = (bounds: Matrix) => transformedBox(multiply(viewport.transform, matrix), bounds);
    const paintsPath = new Set([ops.stroke, ops.closeStroke, ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);
    for (let index = 0; index < list.fnArray.length; index += 1) {
        const fn = list.fnArray[index], args = list.argsArray[index] as any[] | null;
        if (fn === ops.save || fn === ops.paintFormXObjectBegin) {
            stack.push([...matrix]);
            if (fn === ops.paintFormXObjectBegin && args) {
                if (args[0]) matrix = multiply(matrix, args[0]);
                if (args[1]) add('form', boxFor(args[1]));
            }
        } else if (fn === ops.restore || fn === ops.paintFormXObjectEnd) {
            matrix = stack.pop() || [...identity];
        } else if (fn === ops.transform && args) matrix = multiply(matrix, args);
        else if (fn === ops.paintImageXObject || fn === ops.paintInlineImageXObject || fn === ops.paintImageMaskXObject) add('image', boxFor([0, 0, 1, 1]));
        else if (fn === ops.constructPath && args?.[2]) {const next = boxFor(args[2]); path = path ? union(path, next) : next;}
        else if (paintsPath.has(fn)) {if (path) add('path', path); path = undefined;}
        else if (fn === ops.endPath) path = undefined;
    }
    return shapes;
}

function joinRuns(runs: readonly PdfLayoutAtom[]): string {
    let text = '', end = -Infinity;
    for (const run of runs) {
        const gap = run.x - end;
        if (text && gap > Math.max(1.1, run.fontSize * 0.1) && !/[\s\-–—/]$/u.test(text) && !/^[,.;:!?，。；：！？)\]}]/u.test(run.text)) text += ' ';
        text += run.text; end = Math.max(end, right(run));
    }
    return text.replace(/\s+/gu, ' ').trim();
}

/** 基线而非字形顶边决定同一行，上下标仍保留自己的矩形和文字。 */
export function pdfLayoutLines(atoms: readonly PdfLayoutAtom[]): LayoutLine[] {
    const rows: Array<{runs: PdfLayoutAtom[]; font: number; baseline: number; samples: number}> = [];
    for (const atom of [...atoms].sort((a, b) => a.baseline - b.baseline || a.x - b.x)) {
        const row = rows.at(-1);
        if (!row || Math.abs(atom.baseline - row.baseline) > Math.max(2, Math.max(row.font, atom.fontSize) * 0.55)) rows.push({runs: [atom], font: atom.fontSize, baseline: atom.baseline, samples: 1});
        else {
            row.runs.push(atom);
            if (atom.fontSize > row.font * 1.15) {row.font = atom.fontSize; row.baseline = atom.baseline; row.samples = 1;}
            else if (atom.fontSize >= row.font * 0.85) {row.baseline = (row.baseline * row.samples + atom.baseline) / (row.samples + 1); row.samples += 1;}
        }
    }
    const result: LayoutLine[] = [];
    const ordered = rows.map(row => [...row.runs].sort((a, b) => a.x - b.x));
    const clearAt = (row: readonly PdfLayoutAtom[], x: number) => !row.some(run => run.x < x + 1.5 && right(run) > x - 1.5);
    const adjacent = (at: number, from: number, font: number) => Boolean(rows[at]) && Math.abs(rows[at].baseline - rows[from].baseline) <= font * 2.2;
    /**
     * 真实栏间距会被相邻行在同一竖带上共同让出：1 表示某一侧连续两行（或该侧仅有的一行）留白，0 表示上下邻行都占用，-1 表示至少一侧没有邻行可供比较。
     * 松散对齐的词间距即使偶尔与一行邻行对齐，也难以连续两行落在同一竖带。
     */
    const gutterSupport = (rowIndex: number, start: number, end: number, font: number): -1 | 0 | 1 => {
        for (let x = start + 1.5; x <= end - 1.5; x += 2) {
            for (const step of [-1, 1]) {
                if (!adjacent(rowIndex + step, rowIndex, font) || !clearAt(ordered[rowIndex + step], x)) continue;
                if (!adjacent(rowIndex + step * 2, rowIndex + step, font) || clearAt(ordered[rowIndex + step * 2], x)) return 1;
            }
        }
        return adjacent(rowIndex - 1, rowIndex, font) && adjacent(rowIndex + 1, rowIndex, font) ? 0 : -1;
    };
    for (const [rowIndex, row] of ordered.entries()) {
        const bodyFont = median(row.map(run => run.fontSize));
        const groups: PdfLayoutAtom[][] = [];
        // 两端对齐的松散行会把每个词间距都拉到接近一个字宽；只有明显大于本行词距、且被邻行让出的空白才是栏间距。
        const gaps: number[] = [];
        let end = -Infinity;
        for (const run of row) {
            if (run.x - end > bodyFont * 0.15 && end > -Infinity) gaps.push(run.x - end);
            end = Math.max(end, right(run));
        }
        end = -Infinity;
        for (const run of row) {
            const gap = run.x - end;
            let split = !groups.length;
            if (!split && gap > Math.max(6, bodyFont * 0.9)) {
                const others = [...gaps]; others.splice(others.indexOf(gap), 1);
                const support = gutterSupport(rowIndex, end, run.x, bodyFont);
                split = (support < 0 ? gap >= bodyFont * 2.5 : support === 1) && (!others.length || gap >= bodyFont * 2.5 || gap >= median(others) * 1.8);
            }
            if (split) groups.push([run]);
            else groups.at(-1)!.push(run);
            end = Math.max(end, right(run));
        }
        for (let index = 0; index < groups.length - 1; index += 1) {
            const previous = groups[index], next = groups[index + 1];
            if (/^\d+(?:\.\d+)*$/u.test(joinRuns(previous)) && /^[A-Z]/u.test(joinRuns(next)) && next[0].x - right(previous.at(-1)!) <= bodyFont * 2.5) {previous.push(...next); groups.splice(index + 1, 1);}
        }
        for (const runs of groups) {
            const bounds = runs.reduce<Rectangle>((box, run) => union(box, run), runs[0]);
            const dominant = [...runs].sort((a, b) => b.width - a.width)[0];
            const fontSize = median(runs.filter(run => run.fontSize >= dominant.fontSize * 0.85).map(run => run.fontSize));
            result.push({...bounds, text: joinRuns(runs), baseline: median(runs.filter(run => run.fontSize >= fontSize * 0.85).map(run => run.baseline)), fontSize, fontFamily: dominant.fontFamily, runs: runs.map(run => ({...run}))});
        }
    }
    return result.sort((a, b) => a.y - b.y || a.x - b.x);
}

function mergedFigures(shapes: readonly PdfGraphicsShape[], width: number, height: number): Rectangle[] {
    const figures: Rectangle[] = [];
    for (const shape of shapes.filter(shape => shape.width >= 24 && shape.height >= 24 && (shape.kind !== 'path' || shape.width * shape.height >= 900))) {
        if (shape.width * shape.height >= width * height * 0.94) continue;
        let merged: Rectangle = shape;
        for (let index = figures.length - 1; index >= 0; index -= 1) {
            if (overlaps(merged, figures[index], 2)) {merged = union(merged, figures[index]); figures.splice(index, 1);}
        }
        figures.push(merged);
    }
    return figures;
}
function tableRegions(shapes: readonly PdfGraphicsShape[], width: number, figures: readonly Rectangle[]): Rectangle[] {
    const rows = shapes.filter(shape => shape.kind === 'path' && shape.width >= width * 0.2 && shape.height <= 2 && !figures.some(figure => overlaps(shape, figure)))
        .sort((a, b) => a.y - b.y);
    const groups: Rectangle[][] = [];
    for (const row of rows) {
        const group = groups.find(group => {
            const last = group.at(-1)!;
            return row.y - last.y <= 150 && Math.min(right(row), right(last)) - Math.max(row.x, last.x) >= Math.min(row.width, last.width) * 0.7;
        });
        if (group) group.push(row); else groups.push([row]);
    }
    return groups.filter(group => group.length >= 2).map(group => {
        const box = group.reduce(union); return {...box, y: Math.max(0, box.y - 1), height: box.height + 2};
    });
}
/** 行高的六成以上落在区域内才算区域内文字；紧贴图形包围盒上沿的正文行只是相邻。 */
const coversLine = (region: Rectangle, line: LayoutLine) => overlaps(region, line) && line.x + line.width / 2 >= region.x && line.x + line.width / 2 <= right(region) && line.baseline >= region.y && line.baseline <= bottom(region) + 2
    && Math.min(bottom(line), bottom(region) + 2) - Math.max(line.y, region.y) >= line.height * 0.6;
function formulaLine(line: LayoutLine, pageWidth: number, lines: readonly LayoutLine[], font: number): boolean {
    // 与上下行同栏等宽、行距正常的行是两端对齐的正文，即使含有等号也不是独立公式。
    if (lines.some(near => near !== line && near.text.split(/\s+/u).length >= 5 && Math.abs(near.x - line.x) <= 1 && Math.abs(near.width - line.width) <= 2 && Math.abs(near.baseline - line.baseline) <= font * 1.6)) return false;
    return line.text.length < 150 && line.width < pageWidth * 0.75 && /[=∑∫√∈¼]|ð[^Þ]*Þ|(?:softmax|Concat|FFN|MultiHead)\s*\(/u.test(line.text)
        && (Math.abs(line.x + line.width / 2 - pageWidth / 2) < pageWidth * 0.23 || /^[A-Za-z][\w (){},.]*\s*=/u.test(line.text) || /¼|ð[^Þ]*Þ/u.test(line.text))
        && !/^(?:Figure|Table)\s+\d/iu.test(line.text)
        && !/\b(?:the|we|our|of|to|and|is|in|this|with|for|that|use|each|are|from|used)\b/iu.test(line.text);
}

export function analyzePdfPageLayout(input: {atoms: readonly PdfLayoutAtom[]; graphics: readonly PdfGraphicsShape[]; width: number; height: number}): {blocks: PdfLayoutBlock[]; preservedRegions: PdfPreservedRegion[]} {
    const lines = pdfLayoutLines(input.atoms);
    // 正文字号按字符数加权取中位数：标题、脚注和页眉的行数再多，也不会改变一页的基准字号。
    const sized = input.atoms.filter(atom => atom.fontSize >= 6).sort((a, b) => a.fontSize - b.fontSize);
    let remaining = sized.reduce((sum, atom) => sum + atom.text.length, 0) / 2;
    const font = sized.find(atom => (remaining -= atom.text.length) <= 0)?.fontSize ?? 10;
    const captionStart = /^(?:Figure|Table|Fig\.)\s+\d+[.:]/iu;
    const figures = mergedFigures(input.graphics, input.width, input.height);
    // 图形对象的包围盒常把下方题注一并圈入；题注是需要翻译的正文，图形区域止于题注之上。
    for (const figure of figures) {
        const caption = lines.find(line => captionStart.test(line.text) && line.y > figure.y + figure.height / 2 && bottom(line) <= bottom(figure) + 2
            && line.x >= figure.x - 2 && right(line) <= right(figure) + 2 && line.width >= figure.width * 0.5);
        if (caption) figure.height = Math.max(1, caption.y - 2 - figure.y);
    }
    // 插图上方的短居中标签属于图形本身；保留它们能让左右子图在裁剪后仍有完整标题。
    for (let index = 0; index < figures.length; index += 1) {
        const figure = figures[index];
        const labels = lines.filter(line => bottom(line) <= figure.y && figure.y - line.baseline <= font * 2.5
            && Math.abs(line.x + line.width / 2 - figure.x - figure.width / 2) <= font * 2
            && line.height <= font * 1.7 && line.width < input.width * .45 && line.text.length <= 80
            && !/^(?:Figure|Table)\s+\d/iu.test(line.text) && !/[.!?。！？]$/u.test(line.text) && !/[=∑∫√∈]/u.test(line.text));
        labels.sort((a, b) => b.baseline - a.baseline);
        if (labels.length) figures[index] = union(figure, labels[0]);
    }
    const tables = tableRegions(input.graphics, input.width, figures);
    const regions: PdfPreservedRegion[] = [...figures.map((box, index) => ({...box, id: `figure-${index + 1}`, kind: 'figure' as const})), ...tables.map((box, index) => ({...box, id: `table-${index + 1}`, kind: 'table' as const}))];
    const ordinary = lines.filter(line => !regions.some(region => coversLine(region, line)));
    const formulas = ordinary.filter(line => formulaLine(line, input.width, ordinary, font));
    for (const line of formulas) {
        let bounds: Rectangle = line;
        // 独立公式的小上下标、分式和式号与公式一起保留；不能把下一行正文并入遮盖区域。
        for (const near of ordinary) {
            if (near === line || near.text.length > 45 || near.width > input.width * 0.5) continue;
            if (Math.abs(near.baseline - line.baseline) <= font * 1.65 && (overlaps({...line, x: line.x - font, width: line.width + font * 2, y: line.y - font, height: line.height + font * 2}, near) || /^\(\d+\)$/u.test(near.text))) bounds = union(bounds, near);
        }
        const existing = regions.find(region => region.kind === 'formula' && overlaps(region, bounds));
        if (existing) Object.assign(existing, union(existing, bounds));
        else regions.push({...bounds, id: `formula-${regions.filter(region => region.kind === 'formula').length + 1}`, kind: 'formula'});
    }
    // 记录原区域字形，阅读排版仍使用原页像素，不根据扁平字符串重建公式或表格。
    regions.forEach(region => {region.source = lines.filter(line => coversLine(region, line)).map(line => line.text).join(' ');});
    const authorRows = ordinary.filter(line => line.y < input.height * 0.45 && line.width < input.width * 0.35);
    const authorBuckets = new Map<number, LayoutLine[]>();
    for (const line of authorRows) {const key = Math.round(line.baseline / 2); const bucket = authorBuckets.get(key) || []; bucket.push(line); authorBuckets.set(key, bucket);}
    const authorGrid = ordinary.some(line => line.text.includes('@')) ? [...authorBuckets.values()].filter(bucket => bucket.length >= 3).flat() : [];
    const authorStart = authorGrid.reduce((start, line) => Math.min(start, line.y), Infinity);
    const authorEnd = authorGrid.reduce((end, line) => Math.max(end, bottom(line)), -Infinity) + font * 4.5;
    type Draft = {lines: LayoutLine[]; kind: NonNullable<PdfDocumentBlock['kind']>; region?: PdfPreservedRegion; bounds: Rectangle};
    const drafts: Draft[] = [];
    let active: Draft[] = [];
    const classify = (line: LayoutLine): Draft['kind'] => {
        if (line.y > input.height * 0.92 && /^\d{1,4}$/u.test(line.text.trim())) return 'footer';
        // 页眉页脚位于版心之外、不大于正文字号，并与版心隔开至少一行；它们逐页重复，保留原样而不打断正文阅读顺序。
        const header = bottom(line) < input.height * 0.065, trailer = line.y > input.height * 0.945;
        if ((header || trailer) && line.fontSize <= font * 1.05 && line.text.length < 120
            && !lines.some(near => header ? near.y >= bottom(line) - 1 && near.y - bottom(line) < font * 1.2 : bottom(near) <= line.y + 1 && line.y - bottom(near) < font * 1.2)) return 'footer';
        if (captionStart.test(line.text)) return 'caption';
        // 没有可读词语的短行（求和号、上下标、极限记号）是公式的碎片，翻译只会破坏它。
        if (!/\p{L}{3,}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(line.text.replace(/\b(?:lim|min|max|log|exp|sin|cos|tan|arg|sup|inf)\b/giu, ''))) return 'formula';
        const numbered = line.fontSize >= font * 0.95 && line.text.length < 120;
        // “1. 标题”与编号列表同形：列表项的续行缩进或占满栏宽，标题下方则是空行或更短的折行。
        const listItem = () => lines.some(near => near.baseline > line.baseline && near.baseline - line.baseline <= line.fontSize * 1.45
            && (near.x > line.x + 2 ? near.x - line.x <= font * 4 : Math.abs(near.x - line.x) <= 1 && near.width >= line.width * 0.9));
        if ((numbered && (/^\d+(?:\.\d+)*\s+[A-Z]/u.test(line.text) || (/^\d+(?:\.\d+)*\.\s+[A-Z]/u.test(line.text) && line.text.split(/\s+/u).length <= 9 && !/[.,;:]$/u.test(line.text) && !listItem())))
            || (line.text.length < 80 && /^(?:Abstract|References|Acknowledge?ments?|Appendix(?:\s+[A-Z])?(?:\.\s.*)?)$/iu.test(line.text)) || (line.fontSize >= font * 1.32 && line.text.length < 100)) return 'heading';
        if (line.text.includes('@') || (line.y >= authorStart && line.y <= authorEnd && line.width < input.width * 0.35 && line.text.length < 100)) return 'metadata';
        return 'text';
    };
    for (const line of lines) {
        active = active.filter(draft => line.baseline - draft.lines.at(-1)!.baseline <= Math.max(font, draft.lines.at(-1)!.fontSize) * 1.7);
        const region = regions.find(region => coversLine(region, line));
        const kind = region ? region.kind === 'figure' ? 'figure-label' : region.kind : classify(line);
        let selected: Draft | undefined;
        if (kind !== 'footer' && !/^\(\d+\)\s/u.test(line.text)) {
            for (const draft of active) {
                const last = draft.lines.at(-1)!;
                const gap = line.baseline - last.baseline;
                // 折行的标题与首行同字号、左对齐且更短；紧随其后的正文首行通常占满栏宽，不能并入标题。
                const wrappedHeading = draft.kind === 'heading' && (kind === 'text' || kind === 'heading') && draft.lines.length < 3 && gap <= last.fontSize * 1.45
                    && Math.abs(line.x - last.x) <= 1 && line.width < last.width * 0.9 && !/[.!?。！？]$/u.test(last.text) && !/^\d+(?:\.\d+)*\.?\s/u.test(line.text);
                if (draft.region !== region || (kind === 'heading' ? !wrappedHeading : draft.kind !== kind && !(draft.kind === 'caption' && kind === 'text') && !wrappedHeading)) continue;
                // 悬挂缩进的条目（参考文献、编号列表）以回到左边界的新行开头。
                if (draft.lines.length >= 2 && line.x < last.x - font * 0.8) continue;
                // 作者与单位、正文与脚注字号不同，即使左对齐也属于不同段落。
                if (Math.abs(line.fontSize - last.fontSize) > Math.max(0.6, last.fontSize * 0.18)) continue;
                const overlap = Math.min(right(line), right(last)) - Math.max(line.x, last.x);
                const sameColumn = Math.abs(line.x - last.x) <= font * 2.2 || (overlap >= Math.min(line.width, last.width) * 0.72 && Math.abs(line.x + line.width / 2 - last.x - last.width / 2) <= font * 2);
                if (gap <= 0 || !sameColumn) continue;
                // 悬挂缩进条目的首行占满栏宽，其后缩进的续行仍属于同一条目。
                const hangingContinuation = draft.lines.length === 1 && right(last) >= right(line) - 2 && line.x - last.x <= font * 3 && gap <= font * 1.32;
                if (/[.!?。！？]["')\]}]*$/u.test(last.text) && !hangingContinuation && (line.x - last.x > font * 0.8 || gap > font * 1.32)) continue;
                if (!selected || selected.lines.at(-1)!.baseline < last.baseline) selected = draft;
            }
        }
        if (selected) {selected.lines.push(line); selected.bounds = union(selected.bounds, line);}
        else {const draft = {lines: [line], kind, region, bounds: line}; drafts.push(draft); active.push(draft);}
    }
    const blocks: PdfLayoutBlock[] = drafts.map(draft => {
        const first = draft.lines[0];
        const source = draft.lines.reduce((text, line) => text ? /[-‐‑]$/u.test(text) && /^[a-z]/u.test(line.text) ? text.slice(0, -1) + line.text : `${text} ${line.text}` : line.text, '');
        const leading = draft.lines.slice(1).map((line, index) => line.baseline - draft.lines[index].baseline);
        const center = draft.bounds.x + draft.bounds.width / 2;
        const centered = (draft.kind === 'heading' || draft.kind === 'metadata' || draft.kind === 'footer') && Math.abs(center - input.width / 2) <= input.width * 0.045;
        return {...draft.bounds, source, fontSize: median(draft.lines.map(line => line.fontSize)), lineHeight: leading.length ? median(leading) : first.fontSize, lineCount: draft.lines.length, fontFamily: first.fontFamily, fontWeight: draft.kind === 'heading' ? 700 : 400, textAlign: centered ? 'center' : 'left', kind: draft.kind, preserveSource: Boolean(draft.region) || draft.kind === 'metadata' || draft.kind === 'footer' || draft.kind === 'formula', lines: draft.lines};
    });
    // 每个连续排版带先读左列再读右列；通栏标题/正文充当列带之间的分隔。
    let readingOrder = 0;
    const ordered: PdfLayoutBlock[] = [];
    let band: PdfLayoutBlock[] = [];
    const flush = () => {
        const columns: number[] = [];
        for (const block of [...band].sort((a, b) => a.x - b.x || a.y - b.y)) {let column = columns.findIndex(x => Math.abs(x - block.x) <= font * 2); if (column < 0) {column = columns.length; columns.push(block.x);} block.column = column;}
        ordered.push(...band.sort((a, b) => a.kind === 'metadata' && b.kind === 'metadata' ? a.y - b.y || a.x - b.x : a.column! - b.column! || a.y - b.y)); band = [];
    };
    for (const block of blocks.sort((a, b) => a.y - b.y || a.x - b.x)) {
        if (block.width > input.width * 0.58 || (block.kind === 'heading' && block.textAlign === 'center') || block.kind === 'footer') {flush(); block.column = 0; ordered.push(block);}
        else band.push(block);
    }
    flush();
    ordered.forEach(block => {block.readingOrder = readingOrder++;});
    // 同一图带中的左右子图可能顶边不齐，按重叠高度识别同带后从左向右阅读。
    const regionBands: PdfPreservedRegion[][] = [];
    for (const region of regions.sort((a, b) => a.y - b.y || a.x - b.x)) {
        const band = regionBands.at(-1);
        if (region.kind === 'figure' && band?.every(previous => previous.kind === 'figure') && band.some(previous => Math.min(bottom(region), bottom(previous)) - Math.max(region.y, previous.y) > Math.min(region.height, previous.height) * .5)) band.push(region);
        else regionBands.push([region]);
    }
    return {blocks: ordered, preservedRegions: regionBands.flatMap(band => band.sort((a, b) => a.x - b.x))};
}
