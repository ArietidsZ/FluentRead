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

describe('PDF layout analysis on real paper typography', () => {
    const words = (text: string, x: number, baseline: number, gap: number, fontSize = 10) => {let at = x; return text.split(' ').map(word => {const item = atom(word, at, baseline, word.length * 5, fontSize); at += word.length * 5 + gap; return item;});};
    it('keeps a loosely justified line whole between dense neighbours while still splitting real column gutters', () => {
        const dense = (baseline: number) => atom('dense line of ordinary body text that fills the entire column', 50, baseline, 240);
        const lines = pdfLayoutLines([dense(100), ...words('only reading times but also neural responses', 50, 112, 11), dense(124)]);
        expect(lines.map(line => line.text)).toEqual(['dense line of ordinary body text that fills the entire column', 'only reading times but also neural responses', 'dense line of ordinary body text that fills the entire column']);
        // 左栏松散、右栏正常：只有被上下行共同让出的栏间距才断开。
        const columns = pdfLayoutLines([dense(100), atom('right column line one', 330, 100, 220), ...words('only reading times but also neural', 50, 112, 11), ...words('right column line two has many small gaps', 330, 112, 3), dense(124), atom('right column line three', 330, 124, 220)]);
        expect(columns.filter(line => line.baseline === 112).map(line => line.text)).toEqual(['only reading times but also neural', 'right column line two has many small gaps']);
    });
    it('does not split an isolated numbered example at a small gap but splits isolated rows at wide gaps', () => {
        const lines = pdfLayoutLines([atom('(2)', 45, 60, 11), atom('The children went outside to. . .', 65, 60, 120), atom('Running header', 200, 30, 140, 6), atom('303', 500, 30, 12, 6)]);
        expect(lines.map(line => line.text)).toEqual(['Running header', '303', '(2) The children went outside to. . .']);
        // 一侧被上方通栏内容占用、另一侧没有邻行：宽间距仍按栏间距处理，窄间距不拆。
        const band = pdfLayoutLines([atom('A full width paragraph line that crosses the gutter completely here', 50, 100, 500), atom('Left start', 50, 112, 200), atom('Right start', 330, 112, 200)]);
        expect(band.map(line => line.text)).toEqual(['A full width paragraph line that crosses the gutter completely here', 'Left start', 'Right start']);
        const narrow = pdfLayoutLines([atom('A full width paragraph line that crosses the gutter completely here', 50, 100, 500), atom('word', 50, 112, 20), atom('next', 82, 112, 20)]);
        expect(narrow.at(-1)!.text).toBe('word next');
    });
    it('classifies running headers and footers only when they are detached from the text block', () => {
        const page = analyze([atom('N.J. Smith / Cognition 128 (2013)', 200, 36, 150, 6.4), atom('303', 500, 36, 12, 6.4), atom('Body paragraph starts well below the running header.', 40, 70, 400), atom('It continues on the next line of the same paragraph.', 40, 82, 400), atom('Downloaded from example.org', 40, 780, 150, 6.4)]);
        expect(page.blocks.filter(block => block.kind === 'footer').map(block => block.source)).toEqual(['N.J. Smith / Cognition 128 (2013)', '303', 'Downloaded from example.org']);
        expect(page.blocks.find(block => block.source.startsWith('Body'))).toMatchObject({kind: 'text', readingOrder: 2});
        // 贴近页顶的正文首行、以及页顶的大号幻灯片标题都不是页眉。
        const attached = analyze([atom('First body line sits near the top edge', 40, 40, 300), atom('and continues right below it.', 40, 52, 300)]);
        expect(attached.blocks.map(block => block.kind)).toEqual(['text']);
        const slide = analyze([atom('Slide title', 40, 40, 200, 24), atom('Body copy of the slide is much smaller than its title text.', 40, 200, 400), atom('Second line of body copy keeps the body font dominant.', 40, 212, 400)]);
        expect(slide.blocks[0]).toMatchObject({kind: 'heading', source: 'Slide title'});
    });
    it('recognises dotted section numbers, appendix and acknowledgement headings, and rejects numbered list items and mid-paragraph numbers', () => {
        const body = (text: string, baseline: number, x = 40, width = 240) => atom(text, x, baseline, width);
        const result = analyze([atom('1. Introduction', 40, 100, 70), body('Making predictions about the future is a necessary part.', 121), body('It continues for another complete line of running text here', 133),
            atom('2. Theories relating word predictability and reading', 40, 170, 230), atom('time', 40, 182, 20), body('The simplest curve relates the two quantities directly today.', 203),
            atom('Acknowledgments', 40, 240, 80), body('This work was supported by a grant from a public agency.', 261),
            atom('Appendix A. Supplementary material', 40, 300, 160), body('Supplementary data are available online for this article now.', 321),
            atom('1. Omitting them could induce overconfidence in the', 44, 360, 236), atom('parametric form of the model.', 54, 372, 150),
            body('We retrieved the trace and compared the durations of the', 420), atom('4 PP stages within the same group of ranks across', 40, 432, 236), body('PP group, as shown in the figure. The timeline exhibits', 444),
            atom('1 Note that the term refers to something specific here', 40, 500, 200, 6.4), atom('10 MB to 2.7 KB per rank per step. Its progressive diagno-', 300, 100, 240), atom('sis framework isolates anomalous windows automatically.', 300, 112, 240)]);
        const headings = result.blocks.filter(block => block.kind === 'heading').map(block => block.source);
        expect(headings).toEqual(['1. Introduction', '2. Theories relating word predictability and reading time', 'Acknowledgments', 'Appendix A. Supplementary material']);
        expect(result.blocks.find(block => block.source.startsWith('1. Omitting'))).toMatchObject({kind: 'text', lineCount: 2});
        expect(result.blocks.find(block => block.source.includes('4 PP stages'))).toMatchObject({kind: 'text', lineCount: 3});
        expect(result.blocks.find(block => block.source.startsWith('1 Note'))?.kind).toBe('text');
        expect(result.blocks.find(block => block.source.startsWith('10 MB'))).toMatchObject({kind: 'text', lineCount: 2});
    });
    it('joins wrapped titles, including centred ones, without absorbing the next numbered heading or a full first body line', () => {
        const left = analyze([atom('The effect of word predictability on reading time', 40, 100, 300, 14), atom('is logarithmic', 40, 117, 90, 14), atom('Nathaniel Smith, Roger Levy', 40, 140, 170, 10.6), atom('Department of Cognitive Science, University of California', 40, 156, 250, 6.4), atom('Department of Linguistics, University of California too', 40, 164, 250, 6.4),
            ...Array.from({length: 6}, (_, index) => atom('Ordinary body text keeps the dominant font size of the page.', 40, 300 + index * 12, 300, 8))]);
        expect(left.blocks[0]).toMatchObject({kind: 'heading', source: 'The effect of word predictability on reading time is logarithmic', lineCount: 2});
        expect(left.blocks[1]).toMatchObject({source: 'Nathaniel Smith, Roger Levy', lineCount: 1});
        expect(left.blocks[2]).toMatchObject({kind: 'text', lineCount: 2, fontSize: 6.4});
        const centred = analyze([atom('ARGUS: Production-Scale Tracing and Performance', 150, 100, 312, 14), atom('Diagnosis for over 10,000-GPU Clusters', 186, 117, 240, 14), atom('2 Motivation and Design Space', 40, 200, 180, 12), atom('2.1 Motivation', 40, 216, 80, 12),
            ...Array.from({length: 6}, (_, index) => atom('Ordinary body text keeps the dominant font size of the page.', 40, 300 + index * 12, 300, 8))]);
        expect(centred.blocks.filter(block => block.kind === 'heading').map(block => block.source)).toEqual(['ARGUS: Production-Scale Tracing and Performance Diagnosis for over 10,000-GPU Clusters', '2 Motivation and Design Space', '2.1 Motivation']);
    });
    it('separates numbered examples and hanging-indent entries while keeping their continuation lines', () => {
        const result = analyze([atom('(3) After the show, a performer who had really', 45, 100, 200), atom('impressed the audience bowed.', 65, 112, 130), atom('(4) After the show, a performer bowed who had', 45, 124, 200), atom('really impressed the audience.', 65, 136, 130),
            atom('Frost, R. (1998). Toward a strong phonological theory of words.', 300, 100, 240), atom('Psychological Bulletin, 123(1), 71-99.', 312, 112, 160), atom('Genzel, D., and Charniak, E. (2002). Entropy rate constancy.', 300, 124, 240), atom('In Proceedings of the annual meeting of the association.', 312, 136, 228), atom('Hale, J. (2001). A probabilistic Earley parser as a model.', 300, 148, 240)]);
        expect(result.blocks.map(block => block.source)).toEqual(['(3) After the show, a performer who had really impressed the audience bowed.', '(4) After the show, a performer bowed who had really impressed the audience.',
            'Frost, R. (1998). Toward a strong phonological theory of words. Psychological Bulletin, 123(1), 71-99.', 'Genzel, D., and Charniak, E. (2002). Entropy rate constancy. In Proceedings of the annual meeting of the association.', 'Hale, J. (2001). A probabilistic Earley parser as a model.']);
    });
    it('preserves symbol-font equations and wordless fragments but keeps justified prose containing an equals sign', () => {
        const prose = (text: string, baseline: number) => atom(text, 40, baseline, 240);
        const result = analyze([prose('conditional probability then let us decompose the lexical', 100), atom('PðwhojCÞ ¼ Pðrel: clausejCÞ', 40, 124, 190), prose('The first term measures the syntactic predictability here', 148),
            prose('processed as /kan-/, /-di/ then k = 2; processing it as /k-/,', 160), prose('uously gives k = 1.) And, let f(x) be the function that gives', 172), atom('lim', 300, 200, 14), atom('k!1', 300, 208, 14, 6), atom('Xk', 330, 200, 12), atom('续文', 300, 260, 24)]);
        expect(result.preservedRegions.filter(region => region.kind === 'formula').map(region => region.source)).toEqual(['PðwhojCÞ ¼ Pðrel: clausejCÞ']);
        expect(result.blocks.find(block => block.source.includes('processed as'))).toMatchObject({kind: 'text', preserveSource: false});
        expect(result.blocks.filter(block => ['lim', 'k!1', 'Xk'].includes(block.source)).every(block => block.kind === 'formula' && block.preserveSource)).toBe(true);
        expect(result.blocks.find(block => block.source === '续文')).toMatchObject({kind: 'text', preserveSource: false});
    });
    it('cuts figures at their captions, keeps the picture below as its own figure and treats sentences inside a figure box as prose', () => {
        const atoms = [atom('axis label', 120, 140, 50, 6), atom('Figure 12. Case 2: trace of communication kernels. Rank 7', 100, 212, 300, 9), atom('shows longer operations in its own group.', 100, 223, 220, 9), atom('PP Stage 0', 110, 300, 50, 6),
            atom('Figure 13. Case 3: a short caption.', 100, 362, 180, 9), atom('We further verified this through the trace, as shown in the figure above and', 100, 390, 300), atom('It reveals a gap.', 100, 402, 80)];
        const result = analyze(atoms, [{kind: 'image', x: 100, y: 100, width: 300, height: 310}]);
        expect(result.preservedRegions.map(region => [region.kind, Math.round(region.y), Math.round(region.height)])).toEqual([['figure', 100, 103], ['figure', 227, 126], ['figure', 366, 44]]);
        expect(result.blocks.filter(block => block.kind === 'caption').map(block => block.source)).toEqual(['Figure 12. Case 2: trace of communication kernels. Rank 7 shows longer operations in its own group.', 'Figure 13. Case 3: a short caption.']);
        expect(result.blocks.filter(block => block.kind === 'figure-label').map(block => block.source).sort()).toEqual(['PP Stage 0', 'axis label']);
        expect(result.blocks.find(block => block.source.startsWith('We further verified'))).toMatchObject({kind: 'text', preserveSource: false, lineCount: 2});
        // 题注下方不足一行高的残余不是另一张图。
        const tail = analyze([atom('Figure 2. The caption sits at the very bottom of the box.', 100, 190, 280, 9)], [{kind: 'image', x: 100, y: 100, width: 300, height: 100}]);
        expect(tail.preservedRegions).toHaveLength(1);
    });
    it('turns worded table cells into separate translatable cells and joins only hyphenated or lower-case continuations', () => {
        const rules = [80, 100, 190].map(y => ({kind: 'path' as const, x: 40, y, width: 500, height: 0}));
        const result = analyze([atom('Category', 50, 94, 50), atom('Symptom', 300, 94, 50), atom('PCIe bandwidth degrada-', 50, 114, 120), atom('tion', 50, 126, 20), atom('Hidden size', 50, 138, 60), atom('Sequence length', 50, 150, 80),
            atom('Straggler rank identified', 300, 114, 130), atom('(via compute kernels)', 300, 126, 110), atom('2048', 300, 138, 20), atom('4096', 300, 150, 20)], rules);
        expect(result.blocks.filter(block => block.kind === 'table').map(block => [block.source, block.preserveSource])).toEqual([['Category', false], ['PCIe bandwidth degradation', false], ['Hidden size', false], ['Sequence length', false], ['Symptom', false], ['Straggler rank identified (via compute kernels)', false], ['2048', true], ['4096', true]]);
    });
    it('splits a narrow but consistent gutter, rejoins a section number with its title and tolerates zero-size glyphs', () => {
        // 栏间距只有 1.4 个字宽，但明显大于词距且上下行都让出这条竖带。
        const row = (baseline: number) => [...words('left column words here', 50, baseline, 3), ...words('right column words here', 168, baseline, 3)];
        const narrow = pdfLayoutLines([...row(100), ...row(112), ...row(124)]);
        expect(narrow.filter(line => line.baseline === 112).map(line => line.text)).toEqual(['left column words here', 'right column words here']);
        // 相邻两行的编号与标题之间都留白：先按竖带断开，再把编号并回标题。
        const numbered = pdfLayoutLines([atom('1', 50, 80, 5, 12), atom('Introduction', 69, 80, 90, 12), atom('2', 50, 100, 5, 12), atom('Methods', 69, 100, 60, 12)]);
        expect(numbered.map(line => line.text)).toEqual(['1 Introduction', '2 Methods']);
        expect(pdfLayoutLines([atom('x', 0, 0, 5, 0)])).toHaveLength(1);
    });
    it('attaches a line to the most recent of two eligible paragraphs and rejects a long numbered line that continues below', () => {
        const result = analyze([atom('First paragraph ends here.', 50, 100, 200), atom('indented note keeps going', 60, 106, 200), atom('and this line continues the note', 50, 112, 200)]);
        expect(result.blocks.map(block => block.source)).toEqual(['First paragraph ends here.', 'indented note keeps going and this line continues the note']);
        const footnote = analyze([atom('1 Note that the term frequency refers to something specific', 40, 100, 260), atom('and it continues on a second full line of the same footnote.', 40, 112, 260)]);
        expect(footnote.blocks).toHaveLength(1); expect(footnote.blocks[0]).toMatchObject({kind: 'text', lineCount: 2});
    });
    it('does not chain two lines of one column into a row through a line of the other column with a different leading', () => {
        // 右栏 6.4 号字、行距 8；左栏 8 号字的一行基线落在右栏两行之间。
        const lines = pdfLayoutLines([atom('Learning and Verbal Behavior, 12, 335-359.', 294, 370.2, 130, 6.4), atom('left column line in a larger size', 41, 374.4, 220, 8), atom('Dahan, D., and Tanenhaus, M. K. (2004). Continuous mapping', 282, 378.2, 221, 6.4)]);
        expect(lines.map(line => line.text)).toEqual(['Learning and Verbal Behavior, 12, 335-359.', 'left column line in a larger size', 'Dahan, D., and Tanenhaus, M. K. (2004). Continuous mapping']);
    });
    it('falls back to a default body size when a page only has tiny glyphs', () => {
        expect(analyze([atom('tiny', 40, 100, 20, 4)]).blocks).toHaveLength(1);
    });
});
