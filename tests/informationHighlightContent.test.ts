/**
 * @file tests/informationHighlightContent.test.ts
 * 文件职责：验证信息高亮的文本算法、只读收集及页内会话的实际行为和所有权。
 * 主要内容：使用真实 DOM Text 身份与可控原生绘制端口，覆盖内联链接、保护区域、开放及闭合译文、分帧/稳定窗口、异步取消与同文本替换，断言原文和宿主节点不变。
 * 模块边界：模型端口为可控响应，测试不声称真实模型速度或用户理解收益；真实浏览器 CSS 绘制由独立回归验证。
 */
import {parseHTML} from 'linkedom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {scoreInformationKeywords, selectInformationSpans} from '@/src/features/information-highlight/domain/keywords';
import {informationGraphemeBoundaries, informationSliceEnd} from '@/src/features/information-highlight/domain/textBoundaries';
import {collectInformationParagraphs, informationRanges, isInformationParagraphCurrent} from '@/src/features/information-highlight/content/readingText';
import {installInformationHighlight, INFORMATION_HIGHLIGHT_NAME} from '@/src/features/information-highlight/public';
import {DEFAULT_INFORMATION_HIGHLIGHT_PREFERENCES as defaults} from '@/src/core/config/informationHighlight';
import {registerVisibleTranslationRoot, readVisibleTranslationRoot} from '@/src/features/full-page-translation/content/visibleTranslation';
import {createInformationHighlightContentRuntime, createInformationHighlightScorePort, createPageInformationHighlightRuntime, handleInformationHighlightMessage} from '@/src/app/content/informationHighlight';
import type {InformationHighlightResult} from '@/src/features/information-highlight/protocol';

function deferred<T>() {let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};}
function fixture(html = '<article><p id="paragraph">The extraordinary algorithm preserves original paragraphs and inline links.</p></article>', native = true) {
    const {document, window} = parseHTML(`<html><head></head><body>${html}</body></html>`);
    const registry = new Map<string, Set<Range>>(), frames = new Map<number, FrameRequestCallback>(); let frameId = 0, clock = 0, tick = 0;
    const observers: Array<{root?: Node; options?: MutationObserverInit; callback: MutationCallback; disconnect: ReturnType<typeof vi.fn>}> = [];
    const Observer = class {
        readonly entry;
        constructor(callback: MutationCallback) {this.entry = {callback, disconnect: vi.fn()}; observers.push(this.entry);}
        observe(root: Node, options: MutationObserverInit) {Object.assign(this.entry, {root, options});}
        disconnect() {this.entry.disconnect();}
    };
    const view = new Proxy(window, {get(target, key) {
        if (key === 'CSS') return native ? {highlights: registry} : undefined;
        if (key === 'Highlight') return native ? Set : undefined;
        if (key === 'MutationObserver') return Observer;
        if (key === 'innerHeight') return 600;
        if (key === 'performance') return {now: () => {clock += tick; return clock;}};
        if (key === 'requestAnimationFrame') return (callback: FrameRequestCallback) => {frames.set(++frameId, callback); return frameId;};
        if (key === 'cancelAnimationFrame') return (id: number) => frames.delete(id);
        if (key === 'setTimeout') return (callback: () => void, ms: number) => setTimeout(callback, ms);
        if (key === 'clearTimeout') return (id: number) => clearTimeout(id);
        if (key === 'getComputedStyle') return (element: HTMLElement) => ({display: element.style.display || 'inline', visibility: element.style.visibility || 'visible'});
        return Reflect.get(target, key);
    }});
    Object.defineProperty(document, 'defaultView', {value: view});
    Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {configurable: true, value() {
        const top = Number(this.getAttribute('data-top') || 20); return {top, bottom: top + 40};
    }});
    document.createRange = () => {let node: Text, start = 0, end = 0; return {
        setStart(n: Text, s: number) {node = n; start = s;}, setEnd(_n: Text, e: number) {end = e;},
        toString() {return node.data.slice(start, end);},
    } as unknown as Range;};
    const flush = async () => {const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); for (let i = 0; i < 6; i++) await Promise.resolve();};
    const settle = async () => {vi.advanceTimersByTime(180); for (let i = 0; i < 350; i++) await flush();};
    const mutate = (target: Node, type = 'characterData', addedNodes: Node[] = [], removedNodes: Node[] = []) => {
        for (const entry of observers) if (entry.root === target.getRootNode() && !entry.disconnect.mock.calls.length) entry.callback([{target, type, addedNodes, removedNodes} as unknown as MutationRecord], {} as MutationObserver);
    };
    return {document, window: view, registry, frames, observers, flush, settle, mutate, slow: () => {tick = 5;},
        painted: () => [...registry.get(INFORMATION_HIGHLIGHT_NAME) ?? []].map(range => range.toString())};
}
function collect(f: ReturnType<typeof fixture>, readRoot?: (host: Element) => ShadowRoot | undefined) {
    const work = collectInformationParagraphs(f.document, readRoot); const paragraphs = []; let result = work.next();
    while (!result.done) {if (result.value) paragraphs.push(result.value); result = work.next();}
    return {paragraphs, roots: result.value.roots};
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});

describe('local keyword and Unicode coordinates', () => {
    it('keeps original UTF-16 positions, excludes common words and scores repeated distinctive terms deterministically', () => {
        const text = 'The extraordinary algorithm and extraordinary metrics in 2026. 中文信息与阅读理解。';
        const result = scoreInformationKeywords(text);
        expect(result.engine).toBe('local-keyword-rules-v1');
        expect(result.spans.map(span => text.slice(span.start, span.end))).toContain('extraordinary');
        expect(result.spans.map(span => text.slice(span.start, span.end))).not.toContain('The');
        expect(scoreInformationKeywords(text)).toEqual(result);
        expect(scoreInformationKeywords('the and 的 是 a I')).toEqual({engine: 'local-keyword-rules-v1', spans: []});
    });
    it('fallback preserves composed accents and CJK units without Intl.Segmenter', () => {
        vi.stubGlobal('Intl', {...Intl, Segmenter: undefined});
        const text = 'cafe\u0301 中文阅读 学习测试 ab-cd';
        expect(scoreInformationKeywords(text).spans.map(span => text.slice(span.start, span.end))).toEqual(['cafe\u0301', '中文', '阅读', '学习', '测试', 'ab-cd']);
        expect([...informationGraphemeBoundaries('a\u0301👩‍💻x')]).toEqual(expect.arrayContaining([0, 2, 7, 8]));
        expect(informationSliceEnd('a\u0301👩‍💻x', 0, 1)).toBe(2);
        expect(informationSliceEnd('a👩‍💻x', 0, 3)).toBe(6);
        expect(informationSliceEnd('a😀b', 0, 2)).toBe(1);
        const join = 'ab‍cd'; expect(selectInformationSpans(join, [{start: 0, end: 5, score: 1}], 'high')).toEqual([]);
    });
    it('aggregates model pieces into whole words, rejects bad boundaries, and makes density a bounded paint budget', () => {
        const text = 'extraordinary algorithms preserve cafe\u0301 and emoji 👩‍💻 safely';
        const spans = [...scoreInformationKeywords(text).spans, {start: 0, end: 5, score: 5}, {start: 5, end: 13, score: 5},
            {start: -1, end: 3, score: 10}, {start: 0.5, end: 3, score: 10}, {start: 0, end: 0, score: 2},
            {start: 0, end: 999, score: 2}, {start: 0, end: 2, score: Infinity}, {start: 38, end: 39, score: 999}];
        const low = selectInformationSpans(text, spans, 'low');
        expect(text.slice(low[0].start, low[0].end)).toBe('extraordinary');
        expect(selectInformationSpans(text, spans, 'high').length).toBeGreaterThanOrEqual(low.length);
        expect(selectInformationSpans('!🙂', [{start: 0, end: 1, score: 1}], 'medium')).toEqual([]);
        expect(informationSliceEnd('abc', 0, 10)).toBe(3);
        expect(informationSliceEnd('a👩‍💻x', 0, 3)).toBe(1);
        const adjacent = '中文阅读 ' + 'a '.repeat(40);
        expect(selectInformationSpans(adjacent, [{start: 0, end: 2, score: 10}, {start: 2, end: 4, score: 10}], 'high')).toEqual([{start: 0, end: 4, score: 10}]);
        const many = 'ab '.repeat(200); expect(selectInformationSpans(many, scoreInformationKeywords(many).spans, 'high')).toHaveLength(48);
    });
});

describe('read-only body collection and native mapping', () => {
    it('collects inline links and separates visible original and translated text, excluding protected and offscreen content', () => {
        const f = fixture('<nav>Navigation should stay protected.</nav><article><p id="paragraph">A long <a href="/next">inline linked</a> <b>paragraph</b> for reading.<br>Second readable paragraph fragment.<span class="fluent-read-bilingual-content" data-fr-translation-owned="true">这是独立分析的译文段落，保留原文结构。</span><i hidden>Hidden long paragraph.</i><i style="display:none">Invisible long paragraph.</i><i style="visibility:hidden">Invisible paragraph.</i><i style="visibility:collapse">Collapsed paragraph.</i><code>Protected long code text.</code><math>Protected mathematical text.</math><input value="editor"><span translate="no">Protected long translation.</span><button>Button protected text.</button><span contenteditable>Editor long text.</span><span data-fluent-read-ui>Extension interface text.</span><!-- comment --></p><p data-top="1500">A distant paragraph beyond the scanning band.</p><p data-top="-1000">A distant preceding paragraph.</p></article>');
        const before = f.document.body.innerHTML; const scan = collect(f);
        expect(scan.paragraphs.map(p => p.text)).toEqual(['A long inline linked paragraph for reading.', 'Second readable paragraph fragment.', '这是独立分析的译文段落，保留原文结构。']);
        const paragraph = scan.paragraphs[0];
        expect(informationRanges(f.document, paragraph, [{start: 7, end: 32, score: 1}]).map(r => r.toString()).join('')).toBe(paragraph.text.slice(7, 32));
        expect(f.document.body.innerHTML).toBe(before);
        expect(isInformationParagraphCurrent(paragraph)).toBe(true);
        paragraph.runs[0].node.replaceWith(paragraph.runs[0].node.cloneNode());
        expect(isInformationParagraphCurrent(paragraph)).toBe(false);
        expect(informationRanges(f.document, paragraph, [{start: 0, end: 4, score: 1}])).toEqual([]);
    });
    it('streams long blocks completely across grapheme-safe chunks with bounded run arrays', () => {
        const text = 'A'.repeat(2399) + '👩‍💻' + 'B'.repeat(5300);
        const f = fixture(`<p>${text}</p><p>${'<i>inline </i>'.repeat(150)}</p>`);
        const scan = collect(f); const chunks = scan.paragraphs.filter(p => p.text.includes('A') || p.text.includes('B'));
        expect(chunks.map(p => p.text).join('')).toBe(text);
        expect(chunks.every(p => p.text.length <= 2400)).toBe(true);
        expect(scan.paragraphs.every(p => p.runs.length <= 96)).toBe(true);
        const short = fixture(''); expect(collect(short).paragraphs).toEqual([]);
        Object.defineProperty(short.document, 'body', {value: null});
        expect(collect(short).paragraphs).toEqual([]);
        const inline = fixture('<span>A readable standalone inline scope.</span>');
        Object.defineProperty(inline.document, 'body', {value: inline.document.querySelector('span')});
        expect(collect(inline).paragraphs[0].text).toBe('A readable standalone inline scope.');
    });
    it('reads registered closed translation text only while attached, and discovers open roots and slot projection', () => {
        const f = fixture('<article><span id="closed" class="fluent-read-single-slot" data-fr-translation-owned="true" translate="no">Original preserved hidden text.</span><span id="open"></span><span id="projection"></span></article>');
        const closed = f.document.querySelector('#closed')!; const root = closed.attachShadow({mode: 'closed'});
        root.innerHTML = '<span data-fr-translation-owned="true" translate="no">Visible translated paragraph contents.</span>';
        registerVisibleTranslationRoot(closed, root);
        const open = f.document.querySelector('#open')!.attachShadow({mode: 'open'}); open.innerHTML = '<p>Open shadow readable paragraph contents.</p>';
        const projection = f.document.querySelector('#projection')!.attachShadow({mode: 'open'}); projection.innerHTML = '<slot></slot>';
        const projected = f.document.createTextNode('Projected slot readable paragraph contents.'); f.document.querySelector('#projection')!.appendChild(projected);
        Object.assign(projection.querySelector('slot')!, {assignedNodes: () => [projected]});
        expect(closed.shadowRoot).toBeNull();
        expect(readVisibleTranslationRoot(f.document.querySelector('#open')!)).toBeUndefined();
        const scan = collect(f, readVisibleTranslationRoot);
        expect(scan.paragraphs.map(p => p.text)).toEqual(['Visible translated paragraph contents.', 'Open shadow readable paragraph contents.', 'Projected slot readable paragraph contents.']);
        expect(scan.roots).toContain(root);
        closed.remove(); expect(readVisibleTranslationRoot(closed)).toBeUndefined();
        expect(isInformationParagraphCurrent(scan.paragraphs[0])).toBe(false);
    });
    it('permits short controlled translation slots without including short host UI, preserves source and paints zero stop words', async () => {
        const f = fixture('<p>Bright idea.</p><span class="fluent-read-bilingual-content" data-fr-translation-owned="true">Bright idea.</span><span id="closed-one" class="fluent-read-single-slot" data-fr-translation-owned="true" translate="no">Original source one.</span><span id="closed-two" class="fluent-read-single-slot" data-fr-translation-owned="true" translate="no">Original source two.</span>');
        for (const [id, text] of [['closed-one', 'Bright idea.'], ['closed-two', 'the and']]) {
            const host = f.document.getElementById(id)!; const root = host.attachShadow({mode: 'closed'}); root.innerHTML = `<span data-fr-translation-owned="true" translate="no">${text}</span>`; registerVisibleTranslationRoot(host, root);
        }
        const original = f.document.body.innerHTML;
        expect(collect(f, readVisibleTranslationRoot).paragraphs.map(p => p.text)).toEqual(['Bright idea.', 'the and']);
        const controller = installInformationHighlight(f.document, {...defaults}, {scoreLocal: vi.fn(), readTranslationRoot: readVisibleTranslationRoot});
        controller.setEnabled(true); await f.settle(); expect(controller.getState()).toMatchObject({phase: 'active', processedParagraphs: 2, highlightedSpans: 1});
        expect(f.painted()).toEqual(['Bright']); expect(f.document.body.innerHTML).toBe(original);
        const removed = f.document.getElementById('closed-one')!; removed.remove(); f.mutate(f.document.body, 'childList', [], [removed]); await f.settle();
        expect(controller.getState()).toMatchObject({processedParagraphs: 1, highlightedSpans: 0}); controller.dispose();
    });
    it('keeps PDF spaces virtual, permits positioned text-layer words and verifies changed parents, data and roots', () => {
        const f = fixture('<p data-top="700">A nearby following paragraph.</p><p data-top="-100">A nearby preceding paragraph.</p><p>short</p><p>    </p><div data-fluentread-pdf-text><span style="display:block">Original</span><span style="display:block">PDF</span><span style="display:block">words</span><span> ending</span><slot></slot></div>');
        const original = f.document.querySelector('[data-fluentread-pdf-text]')!.innerHTML;
        const scan = collect(f), paragraph = scan.paragraphs.at(-1)!;
        expect(paragraph.text).toBe('Original PDF words ending');
        expect(informationRanges(f.document, paragraph, [{start: 9, end: 18, score: 1}]).map(r => r.toString())).toEqual(['PDF', 'words']);
        expect(informationRanges(f.document, paragraph, [{start: 2, end: 3, score: 1}]).map(r => r.toString())).toEqual(['i']);
        expect(f.document.querySelector('[data-fluentread-pdf-text]')!.innerHTML).toBe(original);
        const run = paragraph.runs[0]; run.node.data += ' changed'; expect(isInformationParagraphCurrent(paragraph)).toBe(false); run.node.data = run.data;
        f.document.querySelector('p')!.append(run.node); expect(isInformationParagraphCurrent(paragraph)).toBe(false);
        run.parent.appendChild(run.node); expect(isInformationParagraphCurrent({...paragraph, root: f.document.querySelector('slot')!.attachShadow({mode: 'open'})})).toBe(false);
        expect(informationSliceEnd('abc\u0301x', 0, 3)).toBe(2);
    });
});

describe('page-owned scoring, paint and cancellation', () => {
    it('keeps screenshot caret and editor/code/form updates from interrupting reading, then rescans eligibility, body styles and controlled translation text', async () => {
        const f = fixture('<article><p>Scientific original paragraphs preserve readable vocabulary.</p><span class="fluent-read-single-slot" data-fr-translation-owned="true"></span></article>'
            + '<div id="editor" contenteditable="true"><p>Editable scientific paragraphs should initially be excluded.</p></div>'
            + '<pre><code id="code">const protectedScientificVocabulary = true;</code></pre>'
            + '<form><p id="form-label">Form interface vocabulary should never start analysis.</p><textarea>Protected control scientific vocabulary.</textarea></form>');
        const host = f.document.querySelector('span')!, root = host.attachShadow({mode: 'closed'});
        root.innerHTML = '<p translate="no">Translated scientific paragraphs remain independently readable.</p>'; registerVisibleTranslationRoot(host, root);
        const score = vi.fn(async (text: string) => scoreInformationKeywords(text));
        const controller = installInformationHighlight(f.document, {...defaults, mode: 'surprisal-local'}, {scoreLocal: score, readTranslationRoot: readVisibleTranslationRoot});
        const attribute = (target: Element, name: string, oldValue: string | null) => f.observers.find(entry => entry.root === target.getRootNode())!.callback([
            {target, type: 'attributes', attributeName: name, oldValue} as unknown as MutationRecord,
        ], {} as MutationObserver);
        controller.setEnabled(true); await f.settle(); expect(score).toHaveBeenCalledTimes(2);
        const painted = f.painted(), editor = f.document.getElementById('editor')!, editorText = editor.querySelector('p')!.firstChild as Text;
        // 与 Playwright 默认 screenshot preparation 相同：临时设置 caret-color 后恢复。
        editor.setAttribute('style', 'caret-color: transparent !important'); attribute(editor, 'style', null);
        editor.removeAttribute('style'); attribute(editor, 'style', 'caret-color: transparent !important');
        editorText.data = 'Former editable scientific vocabulary becomes readable after eligibility changes.'; f.mutate(editorText);
        const added = f.document.createElement('p'); added.textContent = 'Additional editor scientific vocabulary.'; editor.append(added); f.mutate(editor, 'childList', [added]);
        added.remove(); f.mutate(editor, 'childList', [], [added]);
        for (const selector of ['#code', '#form-label', 'textarea']) {
            const element = f.document.querySelector(selector)!; element.setAttribute('style', 'color: blue'); attribute(element, 'style', null);
            const text = element.firstChild as Text; text.data += ' Changed interface text.'; f.mutate(text);
            const child = f.document.createTextNode(' More interface text.'); element.append(child); f.mutate(element, 'childList', [child]);
        }
        await f.settle(); expect(score).toHaveBeenCalledTimes(2); expect(f.painted()).toEqual(painted);
        expect(controller.getState().phase).toBe('active'); expect(f.frames.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
        editor.removeAttribute('contenteditable'); attribute(editor, 'contenteditable', 'true');
        expect(controller.getState().phase).toBe('paused'); expect(f.painted()).toEqual([]);
        await f.settle(); expect(score).toHaveBeenCalledTimes(3); expect(score).toHaveBeenLastCalledWith(editorText.data, expect.any(AbortSignal));
        expect(controller.getState().processedParagraphs).toBe(3);
        editor.setAttribute('contenteditable', 'true'); attribute(editor, 'contenteditable', null); await f.settle(); expect(controller.getState().processedParagraphs).toBe(2);
        editor.setAttribute('contenteditable', 'false'); attribute(editor, 'contenteditable', 'true'); await f.settle(); expect(controller.getState().processedParagraphs).toBe(3);
        f.document.body.setAttribute('class', 'reader-theme'); attribute(f.document.body, 'class', null); expect(controller.getState().phase).toBe('paused'); await f.settle();
        f.document.body.setAttribute('style', 'font-size: 22px'); attribute(f.document.body, 'style', null); expect(controller.getState().phase).toBe('paused'); await f.settle();
        const translated = root.querySelector('p')!.firstChild as Text; translated.data += ' Meaningful updated translation.'; f.mutate(translated); await f.settle();
        expect(score).toHaveBeenCalledTimes(4); expect(score).toHaveBeenLastCalledWith(translated.data, expect.any(AbortSignal));
        f.mutate(f.document, 'childList', [f.document.createComment('document lifecycle marker')]); expect(controller.getState().phase).toBe('paused'); controller.dispose();
    });
    it('ignores redundant framework style writes and duplicate state notifications while invalidating real attribute changes', async () => {
        const f = fixture(), changed = vi.fn();
        const controller = installInformationHighlight(f.document, {...defaults}, {scoreLocal: vi.fn(), changed});
        controller.setEnabled(true); await f.settle();
        expect(f.observers[0].options?.attributeOldValue).toBe(true);
        const paragraph = f.document.querySelector('p')!;
        paragraph.setAttribute('style', '--pdf-page-width: 600px');
        const attribute = (oldValue: string) => f.observers[0].callback([{target: paragraph, type: 'attributes', attributeName: 'style', oldValue} as unknown as MutationRecord], {} as MutationObserver);
        const count = changed.mock.calls.length;
        attribute(paragraph.getAttribute('style')!); controller.updatePreferences({...defaults});
        expect(changed).toHaveBeenCalledTimes(count); expect(controller.getState().phase).toBe('active');
        const oldValue = paragraph.getAttribute('style')!; paragraph.setAttribute('style', '--pdf-page-width: 620px'); attribute(oldValue);
        expect(controller.getState().phase).toBe('paused'); expect(f.painted()).toEqual([]);
        const paused = changed.mock.calls.length;
        for (let i = 0; i < 20; i++) attribute(paragraph.getAttribute('style')!);
        expect(changed).toHaveBeenCalledTimes(paused);
        await f.settle(); expect(controller.getState().phase).toBe('active'); expect(f.painted().length).toBeGreaterThan(0); controller.dispose();
    });
    it('starts only on explicit enable, coalesces settling, updates paint styles without host mutation and releases all owned resources', async () => {
        const f = fixture(), score = vi.fn(), changed = vi.fn(); const before = f.document.body.innerHTML;
        const foreign = new Set<Range>(); f.registry.set('host-search', foreign);
        const controller = installInformationHighlight(f.document, {...defaults}, {scoreLocal: score, changed});
        expect(controller.getState().enabled).toBe(false); expect(f.observers).toHaveLength(0);
        controller.setEnabled(true); controller.setEnabled(true);
        vi.advanceTimersByTime(100); f.document.dispatchEvent(new f.window.Event('scroll'));
        vi.advanceTimersByTime(100); expect(f.frames.size).toBe(0);
        await f.settle(); expect(controller.getState()).toMatchObject({phase: 'active', processedParagraphs: 1, queuedParagraphs: 0});
        expect(f.painted().join('')).toContain('extraordinary'); expect(score).not.toHaveBeenCalled();
        const style = f.document.querySelector('[data-fr-information-highlight-style]')!;
        controller.updatePreferences({...defaults, color: 'mint', style: 'underline'});
        expect(f.document.querySelector('[data-fr-information-highlight-style]')).toBe(style); expect(style.textContent).toContain('underline');
        expect(style.textContent).not.toMatch(/(?:opacity:|font-size|position|padding)/u);
        expect(f.document.body.innerHTML).toBe(before);
        controller.updatePreferences({...defaults, density: 'high'}); await f.settle();
        controller.setEnabled(false); expect(f.painted()).toEqual([]); expect(style.isConnected).toBe(false);
        expect(f.registry.get('host-search')).toBe(foreign); expect(f.observers.every(o => o.disconnect.mock.calls.length)).toBe(true);
        controller.setEnabled(true); await f.settle(); controller.dispose(); controller.dispose(); controller.refresh(); controller.retry(); controller.setEnabled(true);
        expect(controller.getState()).toMatchObject({enabled: false, phase: 'idle'}); expect(f.frames.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
    });
    it('reports missing native paint and refuses invalid owners without observers, requests or DOM fallback', async () => {
        const f = fixture(undefined, false), before = f.document.body.innerHTML;
        const controller = installInformationHighlight(f.document, {...defaults}, {scoreLocal: vi.fn()});
        expect(controller.setEnabled(true)).toMatchObject({phase: 'unsupported', errorCode: 'INFORMATION_HIGHLIGHT_NATIVE_UNSUPPORTED'});
        controller.retry(); await f.settle(); expect(f.observers).toHaveLength(0); expect(f.document.body.innerHTML).toBe(before);
        controller.setEnabled(false); controller.dispose();
        const invalid = installInformationHighlight(f.document, {...defaults}, {scoreLocal: vi.fn(), isCurrent: () => false});
        expect(invalid.setEnabled(true).enabled).toBe(false); invalid.dispose();
    });
    it('aborts pending scores on scroll and rejects late same-text replacements even without an observer delivery', async () => {
        const f = fixture(), first = deferred<InformationHighlightResult>(), second = deferred<InformationHighlightResult>();
        const signals: AbortSignal[] = [];
        const score = vi.fn((_text, signal: AbortSignal) => {signals.push(signal); return signals.length === 1 ? first.promise : second.promise;});
        const controller = installInformationHighlight(f.document, {...defaults, mode: 'surprisal-local'}, {scoreLocal: score});
        controller.setEnabled(true); await f.settle(); expect(controller.getState().phase).toBe('loading-model');
        f.document.dispatchEvent(new f.window.Event('scroll')); expect(signals[0].aborted).toBe(true);
        first.resolve(scoreInformationKeywords(f.document.querySelector('p')!.textContent!)); await f.flush(); expect(f.painted()).toEqual([]);
        await f.settle(); const original = f.document.querySelector('p')!.firstChild!;
        original.replaceWith(original.cloneNode()); second.resolve(scoreInformationKeywords(f.document.querySelector('p')!.textContent!)); await f.flush();
        expect(f.painted()).toEqual([]); expect(controller.getState().phase).toBe('paused');
        controller.dispose();
    });
    it('uses text-only cache for new DOM owners, invalidates on real changes and exposes errors for explicit retry', async () => {
        const f = fixture(), score = vi.fn(async (text: string) => scoreInformationKeywords(text));
        const controller = installInformationHighlight(f.document, {...defaults, mode: 'surprisal-local'}, {scoreLocal: score, changed: () => {throw new Error('subscription');}});
        controller.setEnabled(true); await f.settle(); expect(score).toHaveBeenCalledOnce();
        const original = f.document.querySelector('p')!.firstChild!; original.replaceWith(original.cloneNode()); f.mutate(f.document.querySelector('p')!, 'childList', [f.document.querySelector('p')!.firstChild!], [original]);
        expect(f.painted()).toEqual([]); await f.settle(); expect(score).toHaveBeenCalledOnce(); expect(f.painted().length).toBeGreaterThan(0);
        const text = f.document.querySelector('p')!.firstChild as Text; text.data = 'Changed scientific vocabulary offers entirely different paragraphs.';
        score.mockRejectedValueOnce(new Error('MODEL_NOT_DOWNLOADED')); f.mutate(text); await f.settle();
        expect(controller.getState()).toMatchObject({phase: 'error', errorCode: 'MODEL_NOT_DOWNLOADED'});
        controller.retry(); await f.settle(); expect(controller.getState().phase).toBe('active');
        score.mockRejectedValueOnce('untyped'); text.data += ' More changed words.'; f.mutate(text); await f.settle();
        expect(controller.getState().errorCode).toBe('INFORMATION_HIGHLIGHT_SCORE_FAILED');
        controller.dispose();
    });
    it('streams batches, tracks and removes shadow ownership, ignores own mutations and preserves a later registry owner', async () => {
        const f = fixture('<article>' + '<p>Distinctive algorithm improves readable paragraph metrics.</p>'.repeat(20) + '<span id="shadow"></span></article>');
        const shadowHost = f.document.querySelector('#shadow')!; const shadow = shadowHost.attachShadow({mode: 'open'}); shadow.innerHTML = '<p>A separate shadow paragraph with vocabulary.</p>';
        const controller = installInformationHighlight(f.document, {...defaults}, {scoreLocal: vi.fn()}); controller.setEnabled(true); await f.settle();
        expect(controller.getState().processedParagraphs).toBe(21);
        const style = f.document.querySelector('[data-fr-information-highlight-style]')!; f.mutate(style, 'childList', [...style.childNodes]);
        expect(controller.getState().phase).toBe('active');
        style.remove(); f.window.dispatchEvent(new f.window.Event('resize')); await f.settle(); expect(f.document.querySelector('[data-fr-information-highlight-style]')).not.toBe(style);
        shadowHost.remove(); f.mutate(f.document.querySelector('article')!, 'childList', [], [shadowHost]); await f.settle();
        expect(shadow.querySelector('style')).toBeNull();
        const later = new Set<Range>(); f.registry.set(INFORMATION_HIGHLIGHT_NAME, later); controller.dispose(); expect(f.registry.get(INFORMATION_HIGHLIGHT_NAME)).toBe(later);
    });
    it('splits real tokenizer limits completely, retains original coordinates, and refuses an indivisible oversized grapheme', async () => {
        const f = fixture(), texts: string[] = [];
        const score = vi.fn(async (text: string) => {texts.push(text); if (text.length > 24) throw new Error('INFORMATION_HIGHLIGHT_TOKEN_LIMIT'); return scoreInformationKeywords(text);});
        const controller = installInformationHighlight(f.document, {...defaults, mode: 'surprisal-local'}, {scoreLocal: score});
        controller.setEnabled(true); await f.settle(); expect(controller.getState().phase).toBe('active'); expect(score.mock.calls.length).toBeGreaterThan(3);
        const original = f.document.querySelector('p')!.textContent!;
        const scored = texts.filter(text => text.length <= 24).join(''); expect(scored).toBe(original);
        expect(f.painted().every(text => original.includes(text))).toBe(true); controller.dispose();
        const indivisible = fixture('<p>a' + '\u0301'.repeat(20) + '</p>');
        const blocked = installInformationHighlight(indivisible.document, {...defaults, mode: 'surprisal-local'}, {scoreLocal: async () => {throw new Error('INFORMATION_HIGHLIGHT_TEXT_LIMIT');}});
        blocked.setEnabled(true); await indivisible.settle(); expect(blocked.getState().errorCode).toBe('INFORMATION_HIGHLIGHT_TEXT_LIMIT'); blocked.dispose();
    });
    it('yields at time and checkpoint budgets and cancels queued callbacks and next-paragraph work on disable', async () => {
        const f = fixture(); f.slow(); const controller = installInformationHighlight(f.document, {...defaults}, {scoreLocal: vi.fn()});
        controller.setEnabled(true); vi.advanceTimersByTime(180); await f.flush(); expect(f.frames.size).toBe(1);
        const queued = [...f.frames.values()][0]; controller.dispose(); queued(0); await f.flush(); expect(f.painted()).toEqual([]);
        const huge = fixture('<p>' + '<i>word </i>'.repeat(9000) + '</p>');
        const chunks = installInformationHighlight(huge.document, {...defaults}, {scoreLocal: vi.fn()}); chunks.setEnabled(true); vi.advanceTimersByTime(180); await huge.flush(); chunks.setEnabled(false); await huge.flush(); expect(huge.frames.size).toBe(0); chunks.dispose();
        const next = fixture(); const pending = installInformationHighlight(next.document, {...defaults}, {scoreLocal: vi.fn()}); pending.setEnabled(true); vi.advanceTimersByTime(180); await next.flush();
        expect(next.frames.size).toBe(1); pending.dispose(); await next.flush(); expect(next.frames.size).toBe(0);
    });
    it('evicts only text cache and reports the paint bound without silently claiming a complete scan', async () => {
        const f = fixture('<article>' + Array.from({length: 100}, (_, i) => `<p>Unique${i} scientific vocabulary paragraph for reading.</p>`).join('') + '</article>');
        const score = vi.fn(async (text: string) => scoreInformationKeywords(text)); const controller = installInformationHighlight(f.document, {...defaults, mode: 'surprisal-local'}, {scoreLocal: score});
        controller.setEnabled(true); await f.settle(); expect(controller.getState().processedParagraphs).toBe(100); controller.refresh(); await f.settle(); expect(score.mock.calls.length).toBeGreaterThan(100); controller.dispose();
        const long = fixture('<article>' + Array.from({length: 70}, (_, i) => `<p>Unique${i} ` + 'x'.repeat(2370) + '</p>').join('') + '</article>');
        const cache = installInformationHighlight(long.document, {...defaults}, {scoreLocal: vi.fn()}); cache.setEnabled(true); await long.settle(); expect(cache.getState().processedParagraphs).toBe(70); cache.dispose();
        const dense = fixture('<article>' + ('<p>' + '<i>xx</i>'.repeat(95) + '</p>').repeat(50) + '</article>');
        const limit = installInformationHighlight(dense.document, {...defaults}, {scoreLocal: vi.fn()}); limit.setEnabled(true); await dense.settle(); expect(limit.getState()).toMatchObject({phase: 'error', errorCode: 'INFORMATION_HIGHLIGHT_PAGE_LIMIT'}); expect(limit.getState().queuedParagraphs).toBeGreaterThan(0); limit.dispose();
    });
    it('handles an empty document, style fallback, externally invalidated owners and model cancellation during a split', async () => {
        const empty = fixture(''); Object.defineProperty(empty.document, 'body', {value: empty.document.body}); Object.defineProperty(empty.document, 'head', {value: null});
        const controller = installInformationHighlight(empty.document, {...defaults}, {scoreLocal: vi.fn()}); controller.setEnabled(true); await empty.settle(); expect(controller.getState().phase).toBe('active'); controller.dispose();
        const f = fixture(); let owned = true; const current = installInformationHighlight(f.document, {...defaults}, {scoreLocal: vi.fn(), isCurrent: () => owned});
        current.setEnabled(true); vi.advanceTimersByTime(180); owned = false; await f.flush(); expect(f.painted()).toEqual([]); current.dispose();
        const waiting = installInformationHighlight(f.document, {...defaults}, {scoreLocal: vi.fn(), isCurrent: () => owned}); owned = true; waiting.setEnabled(true); owned = false; await f.settle(); expect(f.painted()).toEqual([]); waiting.dispose();
        const split = fixture(), wait = deferred<InformationHighlightResult>(); let count = 0;
        const local = installInformationHighlight(split.document, {...defaults, mode: 'surprisal-local'}, {scoreLocal: async () => {if (++count === 1) throw new Error('INFORMATION_HIGHLIGHT_TOKEN_LIMIT'); return wait.promise;}});
        local.setEnabled(true); await split.settle(); local.dispose(); wait.resolve({spans: [], engine: 'fixture'}); await split.flush(); expect(count).toBe(2); expect(split.painted()).toEqual([]);
    });
    it('limits observers and reading scope and stops synchronously when a state subscriber disables the session', async () => {
        const f = fixture('<div id="reader"><p>A scoped paragraph preserves original readable text.</p></div><p>Outside reader content stays unchanged.</p>');
        let controller: ReturnType<typeof installInformationHighlight>;
        controller = installInformationHighlight(f.document, {...defaults}, {scoreLocal: vi.fn(), scope: f.document.querySelector('#reader') as HTMLElement,
            changed: state => {if (state.processedParagraphs === 1) controller.setEnabled(false);}});
        controller.setEnabled(true); await f.settle(); expect(f.observers[0].root).toBe(f.document.querySelector('#reader'));
        expect(controller.getState().enabled).toBe(false); expect(f.frames.size).toBe(0); controller.dispose();
    });
});

describe('content composition and runtime score messages', () => {
    it('routes feature messages without swallowing others and preserves read/disable access across every page gate', () => {
        let site = false, paused = false;
        const snapshot = {enabled: false, phase: 'idle', sessionId: '0', processedParagraphs: 0, queuedParagraphs: 0, highlightedSpans: 0, mode: 'keywords'} as const;
        const feature = {getState: vi.fn(() => snapshot), setEnabled: vi.fn((enabled: boolean) => ({...snapshot, enabled})), retry: vi.fn(() => snapshot)};
        const state = {informationHighlight: feature, isSiteDisabled: () => site, isPageSuspended: () => paused};
        const respond = vi.fn();
        expect(handleInformationHighlightMessage({type: 'OTHER'}, state, false, respond)).toBeUndefined(); expect(respond).not.toHaveBeenCalled();
        expect(handleInformationHighlightMessage({type: 'SET_INFORMATION_HIGHLIGHT_ENABLED', enabled: 'yes'}, state, false, respond)).toBe(false); expect(respond).not.toHaveBeenCalled();
        for (const restriction of ['context', 'site', 'suspend', 'none']) {
            site = restriction === 'site'; paused = restriction === 'suspend'; const disabled = restriction === 'context';
            expect(handleInformationHighlightMessage({type: 'GET_INFORMATION_HIGHLIGHT_STATE'}, state, disabled, respond)).toBe(true);
            expect(respond).toHaveBeenLastCalledWith({success: true, state: snapshot});
            handleInformationHighlightMessage({type: 'SET_INFORMATION_HIGHLIGHT_ENABLED', enabled: true}, state, disabled, respond);
            expect(respond).toHaveBeenLastCalledWith(restriction === 'none' ? {success: true, state: {...snapshot, enabled: true}} : {success: false, state: snapshot, error: 'INFORMATION_HIGHLIGHT_PAGE_DISABLED'});
            handleInformationHighlightMessage({type: 'RETRY_INFORMATION_HIGHLIGHT'}, state, disabled, respond);
            handleInformationHighlightMessage({type: 'SET_INFORMATION_HIGHLIGHT_ENABLED', enabled: false}, state, disabled, respond); expect(respond).toHaveBeenLastCalledWith({success: true, state: snapshot});
        }
        expect(feature.retry).toHaveBeenCalledOnce();
        handleInformationHighlightMessage({type: 'RETRY_INFORMATION_HIGHLIGHT'}, {informationHighlight: feature, isSiteDisabled: () => false}, false, respond); expect(feature.retry).toHaveBeenCalledTimes(2);
        expect(handleInformationHighlightMessage({type: 'GET_INFORMATION_HIGHLIGHT_STATE'}, {isSiteDisabled: () => false}, false, respond)).toBe(true);
        expect(respond).toHaveBeenLastCalledWith({success: false, error: 'INFORMATION_HIGHLIGHT_PAGE_UNAVAILABLE'});
    });
    it('assembles page registry ownership and the controlled closed translation text port without automatic enable', async () => {
        const f = fixture('<article><p>Original paragraphs preserve scientific vocabulary.</p><span class="fluent-read-single-slot" data-fr-translation-owned="true"></span></article>');
        const host = f.document.querySelector('span')!, root = host.attachShadow({mode: 'closed'}); root.innerHTML = '<p>Bright idea.</p>'; registerVisibleTranslationRoot(host, root);
        const config = {on: true, informationHighlight: {...defaults}};
        const runtime = createPageInformationHighlightRuntime({document: f.document, config, send: vi.fn()});
        const activation = new AbortController();
        expect(runtime.feature.isEnabled()).toBe(true); config.on = false; expect(runtime.feature.isEnabled()).toBe(false); config.on = true;
        runtime.feature.mount({ctx: {} as never, signal: activation.signal, isCurrent: () => true});
        expect(runtime.getState().enabled).toBe(false); runtime.setEnabled(true); await f.settle();
        expect(f.painted()).toContain('Bright'); runtime.feature.unmount!(); expect(runtime.getState().phase).toBe('idle'); activation.abort();
    });
    it('mounts only current activation, owns abort, maps score messages and returns idle after route change', async () => {
        const f = fixture(), activation = new AbortController();
        const send = vi.fn(async (message: {type: string; text?: string}) => ({success: true, result: scoreInformationKeywords(message.text || '')}));
        const runtime = createInformationHighlightContentRuntime({document: f.document, preferences: {...defaults, mode: 'surprisal-local'}, send});
        expect(runtime.setEnabled(true).enabled).toBe(false); expect(runtime.retry().phase).toBe('idle');
        const aborted = new AbortController(); aborted.abort(); runtime.mount(aborted.signal, () => true); runtime.mount(activation.signal, () => false);
        runtime.mount(activation.signal, () => true); runtime.mount(activation.signal, () => true);
        runtime.setEnabled(true); await f.settle(); expect(send).toHaveBeenCalledWith(expect.objectContaining({type: 'SCORE_INFORMATION_HIGHLIGHT', requestId: expect.any(String)}));
        runtime.updatePreferences({...defaults}); await f.settle(); expect(runtime.getState().mode).toBe('keywords');
        runtime.routeChanged(); expect(runtime.getState().enabled).toBe(false); expect(f.painted()).toEqual([]);
        runtime.setEnabled(true); await f.settle(); expect(runtime.getState().phase).toBe('active');
        runtime.unmount();
        runtime.mount(new AbortController().signal, () => true); activation.abort(); expect(runtime.getState().phase).toBe('idle'); runtime.unmount();
    });
    it('sends cancellation, never applies delayed replies and surfaces malformed/network responses', async () => {
        const f = fixture(), pending = deferred<unknown>(), activation = new AbortController();
        const send = vi.fn(message => message.type === 'SCORE_INFORMATION_HIGHLIGHT' ? pending.promise : Promise.reject(new Error('port gone')));
        const runtime = createInformationHighlightContentRuntime({document: f.document, preferences: {...defaults, mode: 'surprisal-local'}, send});
        runtime.mount(activation.signal, () => true); runtime.setEnabled(true); await f.settle(); runtime.setEnabled(false); await f.flush();
        expect(send).toHaveBeenCalledWith(expect.objectContaining({type: 'CANCEL_INFORMATION_HIGHLIGHT'}));
        pending.resolve({success: true, result: scoreInformationKeywords(f.document.querySelector('p')!.textContent!)}); await f.flush(); expect(f.painted()).toEqual([]);
        send.mockImplementation(async () => ({success: false, error: 'NO_MODEL'})); runtime.setEnabled(true); await f.settle(); expect(runtime.getState().errorCode).toBe('NO_MODEL');
        send.mockImplementation(async () => undefined); runtime.retry(); await f.settle(); expect(runtime.getState().errorCode).toBe('INFORMATION_HIGHLIGHT_SCORE_FAILED');
        send.mockImplementation(async () => {throw new Error('NETWORK');}); runtime.retry(); await f.settle(); expect(runtime.getState().errorCode).toBe('NETWORK');
        activation.abort(); expect(runtime.getState().phase).toBe('idle');
    });
    it('generates secure UUID identities on HTTP pages, refuses an already aborted request and cancels a same-turn response', async () => {
        const realCrypto = crypto; vi.stubGlobal('crypto', {getRandomValues: realCrypto.getRandomValues.bind(realCrypto)});
        const send = vi.fn(async (_message: {type: string; requestId: string; text?: string}) => ({success: true, result: {spans: [], engine: 'fixture'}})); const score = createInformationHighlightScorePort(send);
        await score('text', new AbortController().signal);
        expect(send.mock.calls[0][0].requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
        const aborted = new AbortController(); aborted.abort(); await expect(score('text', aborted.signal)).rejects.toThrow('INFORMATION_HIGHLIGHT_CANCELLED');
        const turn = new AbortController(); const raced = createInformationHighlightScorePort(async () => {turn.abort(); return {success: true, result: {spans: [], engine: 'fixture'}};});
        await expect(raced('text', turn.signal)).rejects.toThrow('INFORMATION_HIGHLIGHT_CANCELLED');
    });
});
