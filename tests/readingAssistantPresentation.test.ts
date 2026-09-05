import {describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {readingAnswerBlocks, readingAnswerSpans} from '@/src/features/reading-assistant/answerFormat';
import {captureReadingSelection, sentenceAroundSelection} from '@/src/features/reading-assistant/selectionContext';

function fixture(html: string, selector = '#selected', offset = 0) {
    const {document, window} = parseHTML(`<html><body>${html}</body></html>`);
    const node = document.querySelector(selector)!.firstChild!;
    const range = {startContainer: node, endContainer: node, startOffset: offset} as unknown as Range;
    return {document, window, node, range};
}

describe('reading context respects the selected prose boundary', () => {
    it('keeps surrounding words, removes controls, and never captures an adjacent paragraph', () => {
        const {range} = fixture('<p>Before <span id="selected">practice</span> makes progress.<button>BUTTON SECRET</button><input value="INPUT SECRET"><span hidden>HIDDEN SECRET</span><span class="fluent-read-bilingual-content">TRANSLATION SECRET</span></p><p>OTHER PARAGRAPH SECRET</p>');
        expect(captureReadingSelection(range, 'practice', 1500)).toEqual({
            text: 'practice', context: 'Before practice makes progress.', sentence: 'Before practice makes progress.',
        });
    });
    it('returns only the selection when context is disabled, the range detached, or spans two blocks', () => {
        const {document, range, node} = fixture('<p id="selected">Hello there.</p><p id="other">Another paragraph.</p>');
        const only = {text: 'Hello', context: '', sentence: 'Hello'};
        expect(captureReadingSelection(range, 'Hello', 0)).toEqual(only);
        expect(captureReadingSelection({...range, endContainer: document.querySelector('#other')!.firstChild!} as Range, 'Hello', 1500)).toEqual(only);
        node.parentElement!.remove();
        expect(captureReadingSelection(range, 'Hello', 1500)).toEqual(only);
    });
    it('does not read application shells, editable content, hidden prose, or mismatched snapshots', () => {
        for (const html of ['<main id="selected">Hello</main>', '<p contenteditable="true" id="selected">Hello</p>', '<p style="display:none" id="selected">Hello</p>', '<p style="visibility:hidden" id="selected">Hello</p>']) {
            expect(captureReadingSelection(fixture(html).range, 'Hello', 1500).context).toBe('');
        }
        expect(captureReadingSelection(fixture('<p id="selected">Changed</p>').range, 'Hello', 1500)).toEqual({text: 'Hello', context: '', sentence: 'Hello'});
    });
    it('uses computed visibility and ignores comments without including their text', () => {
        const {range, window} = fixture('<p><!-- SECRET -->The <span class="hidden">CSS SECRET</span><span id="selected">word</span> matters.</p>');
        Object.defineProperty(window, 'getComputedStyle', {configurable: true, value: vi.fn(element => ({display: element.classList.contains('hidden') ? 'none' : 'block', visibility: 'visible'}))});
        expect(captureReadingSelection(range, 'word', 1500).context).toBe('The word matters.');
        delete (window as unknown as {getComputedStyle?: unknown}).getComputedStyle;
    });
    it('selects the later identical word sentence and clips long paragraphs around it', () => {
        const prefix = `Practice helps. ${'Earlier material. '.repeat(250)}`;
        const {range} = fixture(`<p>${prefix}The <span id="selected">practice</span> here means rehearsal. ${'Later material. '.repeat(200)}</p>`);
        const result = captureReadingSelection(range, 'practice', 500);
        expect(result.sentence).toBe('The practice here means rehearsal.');
        expect(result.context.length).toBeLessThanOrEqual(500);
        expect(result.context).toContain('The practice here means rehearsal.');
        expect(result.context).not.toContain('Practice helps.');
    });
    it('bounds selection/sentence sizes and declines excessive subtree traversal', () => {
        const longText = 'a'.repeat(5000);
        const long = fixture(`<p id="selected">${longText}</p>`);
        expect(captureReadingSelection(long.range, longText, 4000).text).toHaveLength(4096);
        expect(captureReadingSelection(long.range, 'a', 4000).sentence).toBe('a');
        const crowded = fixture(`<p><span id="selected">word</span>${'<i>x</i>'.repeat(1200)}</p>`);
        expect(captureReadingSelection(crowded.range, 'word', 1500).context).toBe('');
    });
    it('handles element ranges and missing parent conservatively', () => {
        const {document, node, range} = fixture('<p id="selected">word</p>');
        expect(captureReadingSelection({...range, startContainer: node.parentElement!} as Range, 'word', 1500).context).toBe('');
        expect(captureReadingSelection({...range, startContainer: document, endContainer: document} as unknown as Range, 'word', 1500).context).toBe('');
    });
});

describe('reading answer presentation', () => {
    it('preserves HTML as inert text while keeping semantic headings, list ordering and emphasis', () => {
        expect(readingAnswerBlocks('# Structure\r\n\n- A **noun**\n1. A verb\n---\n<script>alert(1)</script>')).toEqual([
            {kind: 'heading', text: 'Structure', level: 1}, {kind: 'list', ordered: false, start: 1, items: ['A **noun**']},
            {kind: 'list', ordered: true, start: 1, items: ['A verb']}, {kind: 'paragraph', text: '<script>alert(1)</script>'},
        ]);
        expect(readingAnswerSpans('The **noun** here.')).toEqual([{text: 'The ', kind: 'text'}, {text: 'noun', kind: 'strong'}, {text: ' here.', kind: 'text'}]);
        expect(readingAnswerSpans('**unfinished')).toEqual([{text: '**unfinished', kind: 'text'}]);
        expect(readingAnswerBlocks('')).toEqual([]);
    });
    it('separates meaning sections while retaining soft breaks and grouped list numbering', () => {
        expect(readingAnswerBlocks('### 主干 ###\nA sentence\ncontinues here.\n\n### 成分\n3. Subject\n4) Verb\n- Modifier\n+ Clause\n\n### 关键点\nLast explanation.')).toEqual([
            {kind: 'heading', level: 3, text: '主干'},
            {kind: 'paragraph', text: 'A sentence\ncontinues here.'},
            {kind: 'heading', level: 3, text: '成分'},
            {kind: 'list', ordered: true, start: 3, items: ['Subject', 'Verb']},
            {kind: 'list', ordered: false, start: 1, items: ['Modifier', 'Clause']},
            {kind: 'heading', level: 3, text: '关键点'},
            {kind: 'paragraph', text: 'Last explanation.'},
        ]);
        expect(readingAnswerBlocks('Plain sentence\n- first\n- second')).toEqual([{kind: 'paragraph', text: 'Plain sentence'}, {kind: 'list', ordered: false, start: 1, items: ['first', 'second']}]);
        expect(readingAnswerBlocks('First\n___\nSecond\n***\nThird')).toEqual(['First', 'Second', 'Third'].map(text => ({kind: 'paragraph', text})));
    });
    it('preserves quoted evidence and complete or streaming code without interpreting HTML inside it', () => {
        expect(readingAnswerBlocks('Intro\n> First line\n> **Second**\n\n```html\n  <img src="https://example.test/private">\n# Not a heading\n```\nAfter')).toEqual([
            {kind: 'paragraph', text: 'Intro'}, {kind: 'quote', text: 'First line\n**Second**'},
            {kind: 'code', text: '  <img src="https://example.test/private">\n# Not a heading'}, {kind: 'paragraph', text: 'After'},
        ]);
        expect(readingAnswerBlocks('Intro\n~~~text\nunfinished\n  code')).toEqual([{kind: 'paragraph', text: 'Intro'}, {kind: 'code', text: 'unfinished\n  code'}]);
        expect(readingAnswerBlocks('> quoted')).toEqual([{kind: 'quote', text: 'quoted'}]);
        expect(readingAnswerBlocks('```\n```')).toEqual([{kind: 'code', text: ''}]);
    });
    it('renders old tabular answers as cells, preserving escaped pipes and partial rows during streaming', () => {
        expect(readingAnswerBlocks('Intro\n| 片段 | 作用 |\n| :--- | ---: |\n| `a\\|b` | 主语 |\n| Verb |\n\nNext')).toEqual([
            {kind: 'paragraph', text: 'Intro'},
            {kind: 'table', headers: ['片段', '作用'], rows: [['`a|b`', '主语'], ['Verb']]},
            {kind: 'paragraph', text: 'Next'},
        ]);
        expect(readingAnswerBlocks('Term | Meaning\n--- | ---')).toEqual([{kind: 'table', headers: ['Term', 'Meaning'], rows: []}]);
        expect(readingAnswerBlocks('A | B\nnot | a divider\nFinal | text')).toEqual([{kind: 'paragraph', text: 'A | B\nnot | a divider\nFinal | text'}]);
        expect(readingAnswerBlocks('a | b\n---')).toEqual([{kind: 'paragraph', text: 'a | b'}]);
    });
    it('keeps raw tags and resource syntax inert and formats only complete inline delimiters', () => {
        expect(readingAnswerSpans('**bold** __also__ *em* _italics_ `**code**`')).toEqual([
            {kind: 'strong', text: 'bold'}, {kind: 'text', text: ' '}, {kind: 'strong', text: 'also'}, {kind: 'text', text: ' '},
            {kind: 'emphasis', text: 'em'}, {kind: 'text', text: ' '}, {kind: 'emphasis', text: 'italics'}, {kind: 'text', text: ' '}, {kind: 'code', text: '**code**'},
        ]);
        const unsafe = '<script>alert(1)</script> ![remote](https://example.test/pixel) [run](javascript:alert(1))';
        expect(readingAnswerSpans(unsafe)).toEqual([{kind: 'text', text: unsafe}]);
        for (const partial of ['**', '*', '_', '__', '`', '**unfinished*', 'snake_case_value']) expect(readingAnswerSpans(partial)).toEqual([{kind: 'text', text: partial}]);
        expect(readingAnswerSpans('')).toEqual([]);
        expect(readingAnswerSpans('**ready**')).toEqual([{kind: 'strong', text: 'ready'}]);
    });
    it('does not guess a different sentence for missing or punctuation-only selections', () => {
        expect(sentenceAroundSelection('First sentence. 第二句话！', '第二句', 16)).toBe('第二句话！');
        expect(sentenceAroundSelection('abc', 'missing')).toBe('missing');
        expect(sentenceAroundSelection('!!!', '!')).toBe('!');
        expect(sentenceAroundSelection('First. Second.', 'First. Second.')).toBe('First. Second.');
    });
});
