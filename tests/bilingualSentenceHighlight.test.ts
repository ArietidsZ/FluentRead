import {parseHTML} from 'linkedom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {alignBilingualSentences, sentenceSpans} from '@/src/core/translation/sentenceAlignment';
import {BILINGUAL_HIGHLIGHT_NAME, installBilingualSentenceHighlight} from '@/src/features/full-page-translation/content/sentenceHighlight';
import {syncBilingualSentenceHighlight} from '@/src/app/content/bilingualSentenceHighlight';

const texts = (text: string) => sentenceSpans(text).map(span => text.slice(span.start, span.end));

describe('bilingual sentence coordinates and ordered alignment', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('keeps punctuation, decimals, abbreviations and quotes inside their sentence', () => {
        expect(texts('  Dr. Smith paid 3.14 dollars. “Is it ready?” Yes!  '))
            .toEqual(['Dr. Smith paid 3.14 dollars.', '“Is it ready?”', 'Yes!']);
        expect(texts('第一句。第二句！第三句？')).toEqual(['第一句。', '第二句！', '第三句？']);
        expect(texts('')).toEqual([]);
        expect(texts('  \n ')).toEqual([]);
    });
    it('falls back without Intl.Segmenter and preserves character offsets', () => {
        vi.stubGlobal('Intl', {...Intl, Segmenter: undefined});
        expect(texts('Dr. Smith paid 3.14 dollars. Next sentence.')).toEqual(['Dr. Smith paid 3.14 dollars.', 'Next sentence.']);
    });
    it('pairs equal counts and groups a split middle sentence in either direction', () => {
        const source = 'Start. This long sentence has two equally important parts. End.';
        const translated = '开始。这个很长的句子有两部分。两部分都同样重要。结束。';
        const pairs = alignBilingualSentences(source, translated);
        expect(pairs.map(pair => [source.slice(pair.source.start, pair.source.end), translated.slice(pair.translation.start, pair.translation.end)]))
            .toEqual([['Start.', '开始。'], ['This long sentence has two equally important parts.', '这个很长的句子有两部分。两部分都同样重要。'], ['End.', '结束。']]);
        expect(alignBilingualSentences(translated, source)).toEqual(pairs.map(pair => ({source: pair.translation, translation: pair.source})));
        expect(alignBilingualSentences('One. Two.', '一句。二句。')).toHaveLength(2);
        expect(alignBilingualSentences('One sentence.', '第一句。第二句。')).toHaveLength(1);
    });
    it('reserves nonempty groups when sentence lengths differ greatly and bounds pathological input', () => {
        for (const [source, target] of [['A. B. C.', '很长'.repeat(30) + '。短。短。短。'], ['A. B.', '甲。乙。丙。']]) {
            const pairs = alignBilingualSentences(source, target);
            expect(pairs).toHaveLength(sentenceSpans(source).length);
            expect(pairs.every(pair => pair.source.end > pair.source.start && pair.translation.end > pair.translation.start)).toBe(true);
            expect(pairs.at(-1)?.translation.end).toBe(target.length);
        }
        expect(alignBilingualSentences('', '译文。')).toEqual([]);
        expect(alignBilingualSentences('Source.', ' ')).toEqual([]);
        expect(alignBilingualSentences('Sentence. '.repeat(257), '译文。')).toEqual([]);
    });
});

function fixture(html = '<p id="owner" data-row="10">First. Second.<span data-row="30" class="fluent-read-bilingual-content" data-fr-translation-owned="true">一句。二句。</span></p>') {
    const {document, window} = parseHTML(`<html><body>${html}<aside id="outside">Outside.</aside></body></html>`);
    const registry = new Map<string, Set<Range>>();
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    let collapsed = true;
    const callback: {value?: MutationCallback} = {};
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal('CSS', {highlights: registry});
    vi.stubGlobal('Highlight', Set);
    const Observer = class {constructor(cb: MutationCallback) {callback.value = cb;} observe = observe; disconnect = disconnect;};
    Object.defineProperty(document, 'defaultView', {value: new Proxy(window, {get: (target, name) => name === 'MutationObserver' ? Observer : Reflect.get(target, name)})});
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {frames.set(++frameId, cb); return frameId;});
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.stubGlobal('getComputedStyle', (element: HTMLElement) => ({display: element.style.display, visibility: element.style.visibility}));
    document.getSelection = () => ({isCollapsed: collapsed} as Selection);
    document.createRange = () => {
        let node: Text; let start: number; let end: number;
        return {
            setStart(n: Text, s: number) {node = n; start = s;},
            setEnd(_n: Text, e: number) {end = e;},
            toString: () => node.data.slice(start, end),
            getClientRects: () => {
                const top = Number(node.parentElement!.closest('[data-row]')?.getAttribute('data-row') || 50);
                return [{left: start * 10, right: end * 10, top, bottom: top + 10, width: (end - start) * 10, height: 10}];
            },
        } as unknown as Range;
    };
    const flush = () => {const work = [...frames.values()]; frames.clear(); work.forEach(cb => cb(0));};
    const move = (selector = '#owner', x = 20, y = 15, buttons = 0, immediate = true) => {
        const event = new window.Event('pointermove', {bubbles: true});
        Object.assign(event, {clientX: x, clientY: y, buttons});
        document.querySelector(selector)!.dispatchEvent(event);
        if (immediate) flush();
    };
    const highlighted = () => [...(registry.get(BILINGUAL_HIGHLIGHT_NAME) ?? [])].map(range => range.toString());
    const mutate = (target: Node = document.querySelector('#owner')!) => callback.value?.([{target} as MutationRecord], {} as MutationObserver);
    return {document, window, registry, move, flush, highlighted, mutate, disconnect, observe, frames, select: () => {collapsed = false;}};
}

describe('paint-only bilingual hover lifecycle', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('moves both directions sentence by sentence without writing host DOM or disturbing other highlights', () => {
        const f = fixture(); const foreign = new Set<Range>(); f.registry.set('host-search', foreign);
        const before = f.document.body.innerHTML;
        const dispose = installBilingualSentenceHighlight(f.document);
        f.move(); expect(f.highlighted()).toEqual(['First.', '一句。']);
        const paint = f.registry.get(BILINGUAL_HIGHLIGHT_NAME);
        f.move('#owner', 25); expect(f.registry.get(BILINGUAL_HIGHLIGHT_NAME)).toBe(paint);
        f.move('.fluent-read-bilingual-content', 45, 35); expect(f.highlighted()).toEqual(['Second.', '二句。']);
        f.move('#owner', 95); expect(f.highlighted()).toEqual(['Second.', '二句。']);
        f.move('#owner', 300); expect(f.highlighted()).toEqual([]);
        f.move(); f.move('#outside'); expect(f.highlighted()).toEqual([]);
        expect(f.document.body.innerHTML).toBe(before);
        dispose(); expect(f.registry.get('host-search')).toBe(foreign);
        expect(f.registry.has(BILINGUAL_HIGHLIGHT_NAME)).toBe(false);
        f.move(); expect(f.highlighted()).toEqual([]);
    });
    it('maps rich text and translation-first order while excluding hidden and protected fragments', () => {
        const f = fixture('<p id="owner" data-row="10"><span class="fluent-read-bilingual-content" data-fr-translation-owned="true" data-row="30">第一句。<b>第二句。</b></span>First <a id="link">linked</a> sentence.<br>Second sentence.<i hidden>Hidden.</i><i style="display:none">Invisible.</i><i style="visibility:hidden">Invisible.</i><i style="visibility:collapse">Invisible.</i><span translate="no">Protected.</span><!--comment--></p>');
        const dispose = installBilingualSentenceHighlight(f.document);
        f.move('#link'); expect(f.highlighted()).toEqual(['First ', 'linked', ' sentence.', '第一句。']);
        f.move('[hidden]'); expect(f.highlighted()).toEqual([]);
        f.move('[translate="no"]'); expect(f.highlighted()).toEqual([]);
        dispose();
    });
    it('coalesces pointer input and cancels pending frames on all clear paths', () => {
        const f = fixture(); const dispose = installBilingualSentenceHighlight(f.document);
        f.move('#owner', 20, 15, 0, false); f.move('#owner', 95, 15, 0, false);
        expect(f.frames.size).toBe(1); f.flush(); expect(f.highlighted()).toEqual(['Second.', '二句。']);
        f.move('#owner', 20, 15, 1); expect(f.highlighted()).toEqual([]);
        for (const [surface, type] of [[f.document, 'scroll'], [f.document, 'selectionchange'], [f.window, 'blur'], [f.window, 'resize'], [f.window, 'pagehide']] as const) {
            f.move(); surface.dispatchEvent(new f.window.Event(type)); expect(f.highlighted()).toEqual([]);
        }
        f.move(); const out = new f.window.Event('pointerout'); Object.assign(out, {relatedTarget: f.document.body});
        f.document.dispatchEvent(out); expect(f.highlighted()).not.toEqual([]);
        f.document.dispatchEvent(new f.window.Event('pointerout')); expect(f.highlighted()).toEqual([]);
        f.document.dispatchEvent(new f.window.Event('pointermove')); f.flush(); expect(f.highlighted()).toEqual([]);
        f.select(); f.move(); expect(f.highlighted()).toEqual([]);
        f.move('#owner', 20, 15, 0, false); dispose(); expect(f.frames.size).toBe(0);
    });
    it('invalidates changed sentences and detached owners, but ignores unrelated mutations', () => {
        const f = fixture(); const dispose = installBilingualSentenceHighlight(f.document);
        f.mutate(); f.move(); f.mutate(f.document.querySelector('#outside')!); expect(f.highlighted()).not.toEqual([]);
        f.document.querySelector('#owner')!.firstChild!.textContent = 'Changed. Second.';
        f.mutate(); expect(f.highlighted()).toEqual([]);
        f.move(); expect(f.highlighted()).toEqual(['Changed.', '一句。']);
        f.mutate(f.document.body); expect(f.highlighted()).toEqual([]);
        f.move(); f.document.querySelector('#owner')!.remove(); f.mutate(f.document.body); expect(f.highlighted()).toEqual([]);
        dispose();
    });
    it('rejects duplicate wrappers, missing text, oversized owners and nontranslation content', () => {
        for (const html of [
            '<p id="owner">First.</p>',
            '<p id="owner"><span class="fluent-read-bilingual-content" data-fr-translation-owned="true">译文。</span></p>',
            '<p id="owner">' + 'x'.repeat(100_001) + '<span class="fluent-read-bilingual-content" data-fr-translation-owned="true">译文。</span></p>',
            '<p id="owner">First.<span class="fluent-read-bilingual-content" data-fr-translation-owned="true">译文。</span><span class="fluent-read-bilingual-content" data-fr-translation-owned="true">重复。</span></p>',
        ]) {
            const f = fixture(html); const dispose = installBilingualSentenceHighlight(f.document); f.move(); expect(f.highlighted()).toEqual([]); dispose();
        }
    });
    it('stays inert without native Highlight support or a view and sync is idempotent', () => {
        const f = fixture(); vi.stubGlobal('Highlight', undefined);
        installBilingualSentenceHighlight(f.document)(); f.move(); expect(f.highlighted()).toEqual([]);
        vi.stubGlobal('Highlight', Set); vi.stubGlobal('CSS', undefined); installBilingualSentenceHighlight(f.document)();
        installBilingualSentenceHighlight({defaultView: null} as Document)();
        vi.stubGlobal('CSS', {highlights: f.registry});
        syncBilingualSentenceHighlight({documentElement: null} as unknown as Document, true);
        syncBilingualSentenceHighlight(f.document, false);
        syncBilingualSentenceHighlight(f.document, true); syncBilingualSentenceHighlight(f.document, true);
        f.move(); expect(f.highlighted()).toEqual(['First.', '一句。']);
        syncBilingualSentenceHighlight(f.document, false); expect(f.highlighted()).toEqual([]);
        syncBilingualSentenceHighlight(f.document, true); f.move(); expect(f.highlighted()).toEqual(['First.', '一句。']);
        f.registry.set(BILINGUAL_HIGHLIGHT_NAME, new Set());
        syncBilingualSentenceHighlight(f.document, false); expect(f.registry.has(BILINGUAL_HIGHLIGHT_NAME)).toBe(true);
    });
});
