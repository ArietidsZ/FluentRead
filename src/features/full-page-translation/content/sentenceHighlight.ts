/**
 * @file src/features/full-page-translation/content/sentenceHighlight.ts
 * 文件职责：在双语段落中定位鼠标下的句子，并同步绘制原文和译文的文字范围。
 * 主要内容：只读收集文字、按句对齐、逐帧合并指针事件，使用原生 Highlight 绘制；离开、选择、滚动、节点变化和卸载时释放范围与监听器。
 * 模块边界：仅消费 renderer 已有的双语容器，不拆分宿主文本、不更改排版、不调用 provider；旧浏览器缺少绘制能力时安全停用。
 */
import {alignBilingualSentences, type SentenceSpan} from '@/src/core/translation/sentenceAlignment';

export const BILINGUAL_HIGHLIGHT_NAME = 'fluentread-bilingual-sentence';
const wrapperSelector = '.fluent-read-bilingual-content[data-fr-translation-owned="true"]';
const excludedSelector = 'script, style, textarea, input, select, button, svg, math, mjx-container, .katex, [hidden], [aria-hidden="true"], [translate="no"], [contenteditable]:not([contenteditable="false"]), [data-fr-translation-owned="true"]';
interface TextRun {node: Text; start: number; end: number}
interface TextMap {text: string; runs: TextRun[]}
interface Pair {source: Range[]; translation: Range[]}
type HighlightView = Window & typeof globalThis & {
    Highlight?: new (...ranges: Range[]) => Set<Range>;
    CSS?: {highlights?: Map<string, Set<Range>>};
};

function collectText(root: Element): TextMap {
    const map: TextMap = {text: '', runs: []};
    const visit = (node: Node): void => {
        if (node.nodeType === 3) {
            const start = map.text.length;
            map.text += (node as Text).data;
            map.runs.push({node: node as Text, start, end: map.text.length});
        } else if (node.nodeType === 1) {
            const element = node as Element;
            if (element !== root && element.matches(excludedSelector)) return;
            const style = root.ownerDocument.defaultView!.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return;
            if (element.tagName === 'BR') map.text += '\n';
            else for (const child of Array.from(element.childNodes)) visit(child);
        }
    };
    visit(root);
    return map;
}

function rangesFor(map: TextMap, span: SentenceSpan): Range[] {
    const ranges: Range[] = [];
    for (const run of map.runs) {
        const start = Math.max(span.start, run.start);
        const end = Math.min(span.end, run.end);
        if (start >= end) continue;
        const range = run.node.ownerDocument.createRange();
        range.setStart(run.node, start - run.start);
        range.setEnd(run.node, end - run.start);
        ranges.push(range);
    }
    return ranges;
}

function ownerFor(target: Element): Element | null {
    const translation = target.closest(wrapperSelector);
    if (translation) return translation.parentElement;
    if (target.closest(excludedSelector)) return null;
    for (let owner: Element | null = target; owner; owner = owner.parentElement) {
        if (Array.from(owner.children).some(child => child.matches(wrapperSelector))) return owner;
    }
    return null;
}

export function installBilingualSentenceHighlight(document: Document): () => void {
    const view = document.defaultView as HighlightView | null;
    const registry = view?.CSS?.highlights;
    if (!view?.Highlight || !registry) return () => undefined;
    const paint = new view.Highlight();
    let owner: Element | null = null;
    let pairs: Pair[] = [];
    let active: Pair | undefined;
    let pending: {event: PointerEvent; target: Element | null} | null = null;
    let frame: number | null = null;
    const observer = new view.MutationObserver(records => {
        if (owner && (!owner.isConnected || records.some(record => owner!.contains(record.target)
            || record.target.contains(owner)))) clear();
    });

    function clear(): void {
        paint.clear();
        active = undefined;
        owner = null;
        pairs = [];
        pending = null;
        if (frame !== null) view!.cancelAnimationFrame(frame);
        frame = null;
        observer.disconnect();
    }
    const flush = (): void => {
        frame = null;
        const point = pending;
        pending = null;
        if (!point || point.event.buttons || document.getSelection()?.isCollapsed === false) return clear();
        const {event, target: hit} = point;
        const nextOwner = hit && ownerFor(hit);
        if (!nextOwner?.isConnected) return clear();
        if (nextOwner !== owner) {
            clear();
            owner = nextOwner;
            const wrappers = Array.from(owner.children).filter(child => child.matches(wrapperSelector));
            if (wrappers.length !== 1) return clear();
            const source = collectText(owner);
            const translation = collectText(wrappers[0]);
            if (source.text.length + translation.text.length > 100_000) return clear();
            pairs = alignBilingualSentences(source.text, translation.text).map(pair => ({
                source: rangesFor(source, pair.source), translation: rangesFor(translation, pair.translation),
            }));
            // 只在鼠标所在段落有缓存时观察，包含祖先移除整个段落的情况。
            observer.observe(document, {subtree: true, childList: true, characterData: true, attributes: true});
        }
        const pair = pairs.find(pair => [...pair.source, ...pair.translation].some(range =>
            Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0
                && event.clientX >= rect.left && event.clientX <= rect.right
                && event.clientY >= rect.top && event.clientY <= rect.bottom)));
        if (pair === active) return;
        paint.clear();
        active = pair;
        if (pair) {
            for (const range of [...pair.source, ...pair.translation]) paint.add(range);
            registry.set(BILINGUAL_HIGHLIGHT_NAME, paint);
        }
    };
    const move = (event: PointerEvent): void => {
        // composedPath 在事件派发后会清空，必须在当前事件内保留真实目标。
        const target = event.composedPath().find(node => node instanceof view.Element) as Element | undefined;
        pending = {event, target: target ?? null};
        if (frame === null) frame = view.requestAnimationFrame(flush);
    };
    const leave = (event: PointerEvent): void => {if (!event.relatedTarget) clear();};
    document.addEventListener('pointermove', move, {passive: true, capture: true});
    document.addEventListener('pointerout', leave, true);
    document.addEventListener('scroll', clear, true);
    document.addEventListener('selectionchange', clear);
    view.addEventListener('blur', clear);
    view.addEventListener('resize', clear);
    view.addEventListener('pagehide', clear);
    return () => {
        clear();
        document.removeEventListener('pointermove', move, true);
        document.removeEventListener('pointerout', leave, true);
        document.removeEventListener('scroll', clear, true);
        document.removeEventListener('selectionchange', clear);
        view.removeEventListener('blur', clear);
        view.removeEventListener('resize', clear);
        view.removeEventListener('pagehide', clear);
        if (registry.get(BILINGUAL_HIGHLIGHT_NAME) === paint) registry.delete(BILINGUAL_HIGHLIGHT_NAME);
    };
}
