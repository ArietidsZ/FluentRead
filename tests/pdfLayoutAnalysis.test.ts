/**
 * @file tests/pdfLayoutAnalysis.test.ts
 * 文件职责：验证 PDF 阅读分析不会把分栏、表格、公式、上下标或插图误当作一个可覆盖的正文框。
 * 主要内容：使用真实绘图操作语义和可复现字形几何验证矩阵、裁剪、行关联、语义边界与阅读顺序，并覆盖长文的几何读取上限。
 * 模块边界：测试纯分析模块；真实 PDF 提取和来源字节不变由 PDF 解析集成测试补充。
 */
import {describe, expect, it} from 'vitest';
import {analyzePdfPageLayout, extractPdfGraphicsShapes, pdfLayoutLines, type PdfLayoutAtom} from '@/src/features/document-translation/core/pdfLayoutAnalysis';

const atom = (text: string, x: number, baseline: number, width = text.length * 5, fontSize = 10): PdfLayoutAtom => ({text, x, y: baseline - fontSize * .8, width, height: fontSize, baseline, fontSize, fontFamily: 'sans-serif'});
const analyze = (atoms: PdfLayoutAtom[], graphics: Parameters<typeof analyzePdfPageLayout>[0]['graphics'] = [], width = 612, height = 792) => analyzePdfPageLayout({atoms, graphics, width, height});
const ops = Object.fromEntries(['save', 'restore', 'transform', 'paintFormXObjectBegin', 'paintFormXObjectEnd', 'paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 'constructPath', 'stroke', 'closeStroke', 'fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke', 'endPath'].map((name, index) => [name, index + 1]));

describe('PDF visible graphics geometry', () => {
    it('tracks saves, nested form matrices, image unit squares, visible paths and viewport orientation', () => {
        const functions = ['restore', 'save', 'transform', 'paintImageXObject', 'paintFormXObjectBegin', 'paintInlineImageXObject', 'paintFormXObjectEnd', 'paintImageMaskXObject', 'restore', 'constructPath', 'constructPath', 'stroke', 'constructPath', 'endPath', 'fill', 'paintFormXObjectBegin', 'paintFormXObjectEnd'];
        const args = [null, null, [100, 0, 0, 80, 10, 20], ['image', 200, 300], [[1, 0, 0, 1, .1, .1], [0, 0, .5, .5]], [{}], null, [{}], null, [[], [], [20, 30, 40, 50]], [[], [], [10, 20, 25, 35]], null, [[], [], [10, 10, 20, 20]], null, null, [null, null], null];
        const shapes = extractPdfGraphicsShapes({fnArray: functions.map(name => ops[name]), argsArray: args}, ops, {width: 300, height: 300, transform: [1, 0, 0, -1, 0, 300]});
        expect(shapes).toEqual([
            {kind: 'image', x: 10, y: 200, width: 100, height: 80},
            {kind: 'form', x: 20, y: 232, width: 50, height: 40},
            {kind: 'image', x: 20, y: 192, width: 100, height: 80},
            {kind: 'image', x: 10, y: 200, width: 100, height: 80},
            {kind: 'path', x: 10, y: 250, width: 30, height: 30},
        ]);
    });
    it('clips page edges, rejects invalid/outside/empty drawings, and handles absent operands', () => {
        const list = {fnArray: [ops.transform, ops.paintImageXObject, ops.restore, ops.transform, ops.paintImageXObject, ops.restore, ops.constructPath, ops.fill, ops.constructPath, ops.stroke, ops.transform, ops.paintFormXObjectBegin, 999], argsArray: [[20, 0, 0, 20, -10, -10], [], null, [1, 0, 0, 1, 400, 400], [], null, [[], [], [NaN, 0, 1, 1]], null, [[], [], [1, 1, 1, 1]], null, null, null, null]};
        expect(extractPdfGraphicsShapes(list, ops, {width: 100, height: 100, transform: [1, 0, 0, 1, 0, 0]})).toEqual([{kind: 'image', x: 0, y: 0, width: 10, height: 10}]);
    });
});

describe('PDF baseline and structural reading analysis', () => {
    it('keeps superscripts with their baseline and rejoins numbered section headings', () => {
        const lines = pdfLayoutLines([atom('h', 50, 50, 5), atom('t', 55, 53, 3, 7), atom('=', 62, 50, 5), atom('value', 70, 50, 25), atom('1', 50, 80, 5, 12), atom('Introduction', 69, 80, 90, 12)]);
        expect(lines).toHaveLength(2); expect(lines[0].text).toBe('ht = value'); expect(lines[0].fontSize).toBe(10); expect(lines[0].runs).toHaveLength(4);
        expect(lines[1].text).toBe('1 Introduction');
        const result = analyze([atom('1 Introduction', 50, 50, 120, 12), atom('Body sentence continues', 50, 75, 400), atom('on the next source line.', 50, 86, 400)]);
        expect(result.blocks.map(block => block.kind)).toEqual(['heading', 'text']);
        expect(result.blocks[1]).toMatchObject({textAlign: 'left', lineHeight: 11, fontSize: 10, lineCount: 2, preserveSource: false});
    });
    it('preserves display equations and their scripts/numbers while translating surrounding and inline prose', () => {
        const result = analyze([atom('We use Q = K and compare the values.', 108, 100, 396), atom('Attention(Q,K,V) = softmax(', 200, 140, 170), atom('QK', 340, 133, 15), atom('T', 355, 130, 4, 7), atom('dk', 353, 151, 8, 7), atom('(1)', 493, 140, 11), atom('The following paragraph is ordinary prose.', 108, 180, 396)]);
        expect(result.preservedRegions).toHaveLength(1); expect(result.preservedRegions[0]).toMatchObject({kind: 'formula'});
        expect(result.preservedRegions[0].source).toContain('Attention'); expect(result.preservedRegions[0].source).toContain('(1)');
        expect(result.blocks.filter(block => block.kind === 'text').map(block => block.source)).toEqual(['We use Q = K and compare the values.', 'The following paragraph is ordinary prose.']);
        expect(result.blocks.filter(block => block.kind === 'formula').every(block => block.preserveSource)).toBe(true);
    });
    it('preserves table cells and image/vector regions but keeps captions and adjacent prose editable', () => {
        const atoms = [atom('Table 1: measured results', 108, 80, 300), atom('Model', 110, 110, 45), atom('Score', 320, 110, 45), atom('Baseline', 110, 125, 60), atom('24.9', 320, 125, 25), atom('A paragraph after the table.', 108, 170, 396), atom('Image label', 180, 230, 80), atom('Figure 1: original graphic', 108, 290, 300)];
        const graphics = [{kind: 'path' as const, x: 108, y: 96, width: 396, height: 0}, {kind: 'path' as const, x: 108, y: 138, width: 396, height: 0}, {kind: 'image' as const, x: 170, y: 200, width: 150, height: 60}, {kind: 'form' as const, x: 180, y: 205, width: 160, height: 60}, {kind: 'path' as const, x: 170, y: 220, width: 100, height: 40}, {kind: 'image' as const, x: 0, y: 0, width: 612, height: 792}];
        const result = analyze(atoms, graphics);
        expect(result.preservedRegions.map(region => region.kind)).toEqual(['table', 'figure']);
        expect(result.preservedRegions[1]).toMatchObject({x: 170, y: 200, width: 170, height: 65});
        // 含词语的单元格各自成段并可翻译；纯数字单元格保留原样。
        expect(result.blocks.filter(block => block.kind === 'table').map(block => [block.source, block.preserveSource])).toEqual([['Model', false], ['Baseline', false], ['Score', false], ['24.9', true]]);
        expect(result.blocks.find(block => block.source === 'Image label')?.kind).toBe('figure-label');
        expect(result.blocks.filter(block => block.kind === 'caption').every(block => !block.preserveSource)).toBe(true);
        expect(result.blocks.find(block => block.source === 'A paragraph after the table.')?.textAlign).toBe('left');
    });
    it('keeps author/email columns independent and reads regular column bands left to right', () => {
        const authors = [atom('Alice', 60, 100, 40), atom('Bob', 230, 100, 30), atom('Carol', 400, 100, 40), atom('alice@example.org', 50, 112, 110), atom('bob@example.org', 210, 112, 100), atom('carol@example.org', 380, 112, 110)];
        const result = analyze(authors);
        expect(result.blocks).toHaveLength(3); expect(result.blocks.every(block => block.kind === 'metadata' && block.preserveSource)).toBe(true);
        expect(result.blocks.map(block => block.source)).toEqual(['Alice alice@example.org', 'Bob bob@example.org', 'Carol carol@example.org']);
        const columns = analyze([atom('1 Heading', 40, 50, 150, 14), atom('Left first line', 40, 100, 220), atom('Right first line', 330, 100, 220), atom('Left continuation.', 40, 111, 220), atom('Right continuation.', 330, 111, 220), atom('Left second paragraph.', 40, 145, 220), atom('Right second paragraph.', 330, 145, 220), atom('2', 300, 750, 5)]);
        expect(columns.blocks.map(block => block.source)).toEqual(['1 Heading', 'Left first line Left continuation.', 'Left second paragraph.', 'Right first line Right continuation.', 'Right second paragraph.', '2']);
        expect(columns.blocks.map(block => block.readingOrder)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(columns.blocks.at(-1)).toMatchObject({kind: 'footer', preserveSource: true});
    });
    it('retains explicit hyphens, paragraph boundaries, varied leading and empty pages', () => {
        expect(analyze([])).toEqual({blocks: [], preservedRegions: []});
        const result = analyze([atom('An unfinished trans-', 50, 50, 400), atom('lation line.', 50, 62, 400), atom('Indented paragraph starts.', 65, 78, 385), atom('Second continuation', 65, 90, 300), atom('not attached across columns', 400, 92, 150), atom('Prose ends before caption.', 50, 118, 350), atom('Figure 2: caption begins', 50, 130, 350), atom('and ends here.', 50, 141, 350), atom('Abstract', 280, 180, 50, 12)]);
        expect(result.blocks[0].source).toBe('An unfinished translation line.');
        expect(result.blocks.some(block => block.source === 'Indented paragraph starts. Second continuation')).toBe(true);
        expect(result.blocks.find(block => block.kind === 'caption')?.source).toBe('Figure 2: caption begins and ends here.');
        expect(result.blocks.find(block => block.source === 'Prose ends before caption.')?.kind).toBe('text');
        expect(result.blocks.find(block => block.source === 'Abstract')?.textAlign).toBe('center');
    });
    it('keeps narrow column headings within their column while a centered page title separates bands', () => {
        const result = analyze([atom('Page title', 260, 40, 92, 20), atom('2 Left section', 40, 80, 140, 14), atom('4 Right section', 330, 80, 150, 14), atom('Left ordinary paragraph.', 40, 110, 220), atom('Right ordinary paragraph.', 330, 110, 220), atom('3 Left next section', 40, 160, 160, 14), atom('Left final paragraph.', 40, 190, 220), atom('Right final paragraph.', 330, 150, 220)]);
        expect(result.blocks.map(block => block.source)).toEqual(['Page title', '2 Left section', 'Left ordinary paragraph.', '3 Left next section', 'Left final paragraph.', '4 Right section', 'Right ordinary paragraph.', 'Right final paragraph.']);
        expect(result.blocks.slice(1, 5).every(block => block.column === 0)).toBe(true);
        expect(result.blocks.slice(5).every(block => block.column === 1)).toBe(true);
    });
    it('processes a fragmented long row without repeated geometry scans or argument-list overflow', () => {
        let reads = 0;
        const count = 20000;
        const atoms = Array.from({length: count}, (_, index) => new Proxy(atom('a', index, 20, 1), {get(target, key, receiver) {if (key === 'baseline' || key === 'fontSize') reads += 1; return Reflect.get(target, key, receiver);}}));
        const lines = pdfLayoutLines(atoms);
        expect(lines).toHaveLength(1); expect(lines[0].text).toHaveLength(count); expect(reads).toBeLessThan(count * 30);
        let geometryReads = 0;
        const paragraphs = Array.from({length: 3000}, (_, index) => new Proxy(atom('Independent paragraph.', 50, 50 + index * 30, 400), {get(target, key, receiver) {if (key === 'x' || key === 'baseline') geometryReads += 1; return Reflect.get(target, key, receiver);}}));
        expect(analyze(paragraphs, [], 612, 100000).blocks).toHaveLength(paragraphs.length);
        expect(geometryReads).toBeLessThan(paragraphs.length * 40);
    });
    it('recognizes side equations and large headings, merges related equations, and orders separate drawings', () => {
        const result = analyze([atom('Large title', 240, 50, 130, 18), atom('A regular sentence is not an equation.', 50, 80, 400), atom('F(x) = 1', 10, 120, 50), atom('G(x) = 2', 10, 133, 50), atom('∑x', 10, 190, 30), atom('Figure 3: x = y', 250, 230, 100)], [{kind: 'image', x: 300, y: 300, width: 50, height: 50}, {kind: 'form', x: 100, y: 300, width: 50, height: 50}]);
        expect(result.blocks[0].kind).toBe('heading');
        expect(result.preservedRegions.filter(region => region.kind === 'formula')).toHaveLength(1);
        expect(result.blocks.find(block => block.source === '∑x')).toMatchObject({kind: 'formula', preserveSource: true});
        expect(result.blocks.find(block => block.source === 'Figure 3: x = y')?.kind).toBe('caption');
        expect(result.preservedRegions.filter(region => region.kind === 'figure').map(region => region.x)).toEqual([100, 300]);
    });
    it('chooses the most recent eligible baseline when small source labels visually overlap larger lines', () => {
        const result = analyze([atom('Earlier small label', 50, 100, 150, 5), atom('Current larger row.', 50, 112, 350, 21), atom('Next line continues', 60, 124, 350, 20), atom('Body reference', 50, 200, 400, 20), atom('Another body reference', 50, 225, 400, 20)]);
        const block = result.blocks.find(block => block.source.includes('Next line continues'))!;
        expect(block.source).toBe('Current larger row. Next line continues');
        expect(block.lines).toHaveLength(2);
    });
    it('reads offset side-by-side graphics left to right without combining distinct vertical figure bands', () => {
        const graphics = [
            {kind: 'image' as const, x: 300, y: 84, width: 120, height: 185},
            {kind: 'image' as const, x: 100, y: 96, width: 64, height: 127},
            {kind: 'image' as const, x: 300, y: 350, width: 60, height: 100},
            {kind: 'image' as const, x: 100, y: 410, width: 60, height: 100},
        ];
        const result = analyze([], graphics);
        expect(result.preservedRegions.map(region => [region.x, region.y])).toEqual([[100, 96], [300, 84], [300, 350], [100, 410]]);
    });
    it('keeps nearby centered diagram titles inside the source crop without absorbing captions or ordinary prose', () => {
        const result = analyze([atom('Diagram title', 110, 70, 80), atom('Figure 1: caption', 100, 60, 100), atom('Ordinary prose.', 300, 70, 100), atom('Full width body continues', 108, 242, 396)], [
            {kind: 'image', x: 100, y: 84, width: 100, height: 100},
            {kind: 'image', x: 300, y: 84, width: 100, height: 100},
            {kind: 'image', x: 108, y: 250, width: 396, height: 70},
        ]);
        const left = result.preservedRegions.find(region => region.kind === 'figure' && region.x === 100)!;
        expect(left).toMatchObject({y: 62, height: 122}); expect(left.source).toBe('Diagram title');
        expect(result.blocks.find(block => block.source === 'Diagram title')?.kind).toBe('figure-label');
        expect(result.blocks.find(block => block.source === 'Figure 1: caption')?.kind).toBe('caption');
        expect(result.blocks.find(block => block.source === 'Ordinary prose.')?.preserveSource).toBe(false);
        expect(result.blocks.find(block => block.source === 'Full width body continues')?.preserveSource).toBe(false);
        const math = analyze([atom('F(x) = QK', 310, 70, 80)], [{kind: 'image', x: 300, y: 84, width: 100, height: 100}]);
        expect(math.preservedRegions.find(region => region.kind === 'figure')?.y).toBe(84);
    });
});
