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
    it('preserves HTML as inert text while formatting only simple headings, lists and emphasis', () => {
        expect(readingAnswerBlocks('# Structure\r\n\n- A **noun**\n1. A verb\n---\n<script>alert(1)</script>')).toEqual([
            {kind: 'heading', text: 'Structure'}, {kind: 'item', text: 'A **noun**'},
            {kind: 'item', text: 'A verb'}, {kind: 'paragraph', text: '<script>alert(1)</script>'},
        ]);
        expect(readingAnswerSpans('The **noun** here.')).toEqual([{text: 'The ', strong: false}, {text: 'noun', strong: true}, {text: ' here.', strong: false}]);
        expect(readingAnswerSpans('**unfinished')).toEqual([{text: '**unfinished', strong: false}]);
        expect(readingAnswerBlocks('')).toEqual([]);
    });
    it('does not guess a different sentence for missing or punctuation-only selections', () => {
        expect(sentenceAroundSelection('First sentence. 第二句话！', '第二句', 16)).toBe('第二句话！');
        expect(sentenceAroundSelection('abc', 'missing')).toBe('missing');
        expect(sentenceAroundSelection('!!!', '!')).toBe('!');
        expect(sentenceAroundSelection('First. Second.', 'First. Second.')).toBe('First. Second.');
    });
});
