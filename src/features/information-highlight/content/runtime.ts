/**
 * @file src/features/information-highlight/content/runtime.ts
 * 文件职责：拥有单个阅读页面的信息高亮会话，协调只读分帧扫描、评分取消、文本缓存和原生 CSS Highlight 绘制。
 * 主要内容：滚动与动态内容经过 180ms 稳定窗口后扫描，每帧工作预算约 4ms；评分与密度选择按纯文本缓存，轻量段落在有界批次内共享帧预算，迟到结果复验代次和 Text 身份，退出时清理所有绘制、观察器、计时器和请求。
 * 模块边界：不访问配置存储或扩展消息、不改变宿主原文、class 和布局；本地模型评分、翻译根及状态通知由应用组合根注入，无原生绘制支持时诚实返回 unsupported。
 */
import type {InformationHighlightPreferences} from '@/src/core/config/informationHighlight';
import type {InformationHighlightResult, InformationHighlightSpan, InformationHighlightState} from '../protocol';
import {scoreInformationKeywords, selectInformationSpans} from '../domain/keywords';
import {informationSliceEnd} from '../domain/textBoundaries';
import {collectInformationParagraphs, informationRanges, isInformationParagraphCurrent, isInformationMutationExcluded, type InformationReadingScan, type InformationParagraph} from './readingText';
export const INFORMATION_HIGHLIGHT_NAME = 'fluentread-information-highlight';
type PaintWindow = Window & typeof globalThis & {Highlight?: new (...ranges: Range[]) => Set<Range>; CSS?: {highlights?: Map<string, Set<Range>>}};
interface CachedParagraph {
    result: InformationHighlightResult;
    selections: Map<InformationHighlightPreferences['density'], InformationHighlightSpan[]>;
}
export interface InformationHighlightController {
    getState(): InformationHighlightState;
    setEnabled(enabled: boolean): InformationHighlightState;
    retry(): InformationHighlightState;
    updatePreferences(preferences: InformationHighlightPreferences): void;
    refresh(): void;
    dispose(): void;
}
export interface InformationHighlightPorts {
    scoreLocal(text: string, signal: AbortSignal): Promise<InformationHighlightResult>;
    isCurrent?(): boolean;
    readTranslationRoot?(host: Element): ShadowRoot | undefined;
    changed?(state: InformationHighlightState): void;
    scope?: HTMLElement;
}

/** 每个安装实例仅拥有自己的 registry 对象和样式节点，绝不删除同名的后来拥有者。 */
export function installInformationHighlight(document: Document, initial: InformationHighlightPreferences, ports: InformationHighlightPorts): InformationHighlightController {
    const view = document.defaultView as PaintWindow, registry = view.CSS?.highlights;
    const paint = view.Highlight && registry ? new view.Highlight() : undefined;
    let preferences = {...initial}, disposed = false, enabled = false, generation = 0, session = 0;
    let timer: number | undefined, frame: number | undefined, scoreAbort: AbortController | undefined;
    let work: Generator<InformationParagraph | undefined, InformationReadingScan> | undefined;
    let pending: InformationParagraph[] = [];
    const styles = new Map<Document | ShadowRoot, HTMLStyleElement>(), observers = new Map<Document | ShadowRoot, MutationObserver>();
    const cache = new Map<string, CachedParagraph>();
    let cachedCharacters = 0;
    let state: InformationHighlightState = {enabled: false, phase: 'idle', sessionId: '0', processedParagraphs: 0, queuedParagraphs: 0, highlightedSpans: 0, mode: preferences.mode};
    const current = () => !disposed && enabled && (ports.isCurrent?.() ?? true);
    const snapshot = () => ({...state});
    const notify = (patch: Partial<InformationHighlightState>) => {
        const next = {...state, ...patch, enabled, mode: preferences.mode};
        // Vue 的状态订阅会重绘模板；相同快照无需触发另一轮界面更新。
        if (Object.keys(next).every(key => next[key as keyof InformationHighlightState] === state[key as keyof InformationHighlightState])) return;
        state = next;
        try {ports.changed?.(snapshot());} catch { /* 界面订阅失败不影响资源归属与清理。 */ }
    };
    const clearPaint = () => {paint?.clear(); notify({highlightedSpans: 0});};
    const cancel = () => {
        generation++;
        if (timer !== undefined) view.clearTimeout(timer);
        if (frame !== undefined) view.cancelAnimationFrame(frame);
        timer = frame = undefined;
        work?.return({roots: [document]}); work = undefined; pending = [];
        scoreAbort?.abort(); scoreAbort = undefined;
    };
    const css = () => {
        const color = {amber: '245, 178, 45', mint: '39, 174, 132', blue: '65, 135, 225'}[preferences.color];
        return `::highlight(${INFORMATION_HIGHLIGHT_NAME}) { ${preferences.style === 'underline'
            ? `text-decoration-line: underline; text-decoration-color: rgba(${color}, .85); text-decoration-thickness: 2px;`
            : `background-color: rgba(${color}, .27);`} }`;
    };
    const ownStyle = (node: Node) => [...styles.values()].some(style => node === style || style.contains(node));
    const irrelevant = (node: Node) => ownStyle(node) || Boolean((node.nodeType === 1 ? node as Element : node.parentElement)?.closest('[data-fluent-read-ui],[data-fluentread-pdf-decoration],[id^="fluent-read-"]'));
    function observe(root: Document | ShadowRoot): void {
        if (observers.has(root)) return;
        const observer = new view.MutationObserver(records => {
            // Vue patchStyle 会重复写入相同 CSS 变量。排除实际值未变的属性记录，避免状态通知与观察器互相触发。
            if (records.every(record => (record.type === 'attributes' && record.oldValue === (record.target as Element).getAttribute(record.attributeName!)) || isInformationMutationExcluded(record) || irrelevant(record.target) || (record.type === 'childList'
                && [...record.addedNodes, ...record.removedNodes].every(irrelevant)))) return;
            schedule(true);
        });
        observer.observe(root === document && ports.scope ? ports.scope : root, {subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true,
            attributeFilter: ['hidden', 'aria-hidden', 'contenteditable', 'translate', 'class', 'style', 'inert']});
        observers.set(root, observer);
    }
    function styleRoot(root: Document | ShadowRoot): void {
        const owner = styles.get(root);
        if (owner?.isConnected) {if (owner.textContent !== css()) owner.textContent = css(); return;}
        owner?.remove();
        const style = document.createElement('style'); style.setAttribute('data-fr-information-highlight-style', 'true'); style.textContent = css();
        (root === document ? document.head ?? document.documentElement : root).appendChild(style); styles.set(root, style);
    }
    function reconcileRoots(roots: Array<Document | ShadowRoot>): void {
        const live = new Set(roots);
        for (const [root, observer] of observers) if (!live.has(root)) {observer.disconnect(); observers.delete(root);}
        for (const [root, style] of styles) if (!live.has(root)) {style.remove(); styles.delete(root);}
        for (const root of roots) {observe(root); styleRoot(root);}
    }
    function remember(key: string, result: InformationHighlightResult): CachedParagraph {
        // 缓存只保存纯数据；最多 96 段 / 160k 字符，每段最多三种密度选区，永久不持有网页节点和 Range。
        const paragraph: CachedParagraph = {result: {engine: result.engine, spans: result.spans.map(span => ({...span}))}, selections: new Map()};
        cache.set(key, paragraph); cachedCharacters += key.length;
        while (cache.size > 96 || cachedCharacters > 160_000) {
            const oldest = cache.keys().next().value!; cachedCharacters -= oldest.length; cache.delete(oldest);
        }
        return paragraph;
    }
    async function scoreComplete(text: string, signal: AbortSignal): Promise<InformationHighlightResult> {
        if (signal.aborted) throw new Error('INFORMATION_HIGHLIGHT_CANCELLED');
        try {return await ports.scoreLocal(text, signal);}
        catch (error) {
            // tokenizer 的真实 token 上限可能先于字符预算；完整重分字素安全的子段，绝不截去剩余正文。
            if (signal.aborted || !(error instanceof Error) || !['INFORMATION_HIGHLIGHT_TOKEN_LIMIT', 'INFORMATION_HIGHLIGHT_TEXT_LIMIT'].includes(error.message)) throw error;
            const middle = informationSliceEnd(text, 0, Math.max(1, Math.floor(text.length / 2)));
            if (middle >= text.length) throw error;
            const first = await scoreComplete(text.slice(0, middle), signal);
            const second = await scoreComplete(text.slice(middle), signal);
            return {engine: first.engine, spans: [...first.spans, ...second.spans.map(span => ({...span, start: span.start + middle, end: span.end + middle}))]};
        }
    }
    async function analyze(paragraphs: InformationParagraph[], version: number, started: number, completed?: InformationReadingScan): Promise<void> {
        let budgetStarted = started;
        for (const paragraph of paragraphs) {observe(paragraph.root); styleRoot(paragraph.root);}
        notify({phase: paragraphs.length ? (preferences.mode === 'surprisal-local' ? 'loading-model' : 'analyzing') : 'active',
            queuedParagraphs: paragraphs.length, errorCode: undefined});
        for (const paragraph of paragraphs.sort((a, b) => a.distance - b.distance)) {
            if (!current() || version !== generation) return;
            const mode = preferences.mode, key = `${mode}:${paragraph.text}`;
            scoreAbort = new AbortController(); const signal = scoreAbort.signal;
            try {
                let cached = cache.get(key);
                const result = cached?.result ?? (mode === 'keywords' ? scoreInformationKeywords(paragraph.text) : await scoreComplete(paragraph.text, signal));
                if (!current() || version !== generation || signal.aborted) return;
                if (!isInformationParagraphCurrent(paragraph)) {schedule(true); return;}
                cached ??= remember(key, result);
                let spans = cached.selections.get(preferences.density);
                if (!spans) {spans = selectInformationSpans(paragraph.text, result.spans, preferences.density); cached.selections.set(preferences.density, spans);}
                const ranges = informationRanges(document, paragraph, spans);
                if (paint!.size + ranges.length > 4096) {notify({phase: 'error', errorCode: 'INFORMATION_HIGHLIGHT_PAGE_LIMIT'}); return;}
                for (const range of ranges) paint!.add(range);
                // 原生 Highlight.add 已触发重绘；同一对象不必为每段重复注册。
                if (registry!.get(INFORMATION_HIGHLIGHT_NAME) !== paint) registry!.set(INFORMATION_HIGHLIGHT_NAME, paint!);
                notify({phase: 'analyzing', processedParagraphs: state.processedParagraphs + 1,
                    queuedParagraphs: state.queuedParagraphs - 1, highlightedSpans: state.highlightedSpans + spans.length});
                if (!current() || version !== generation) return;
                // 扫描与轻量选区共享 4ms 预算；已缓存段落无需无条件占用一整帧，单批仍最多 12 段。
                if (view.performance.now() - budgetStarted >= 4) {
                    await new Promise<void>(resolve => {frame = view.requestAnimationFrame(() => {frame = undefined; resolve();}); signal.addEventListener('abort', () => resolve(), {once: true});});
                    budgetStarted = view.performance.now();
                }
            } catch (error) {
                if (!current() || version !== generation || signal.aborted) return;
                const errorCode = error instanceof Error ? error.message : 'INFORMATION_HIGHLIGHT_SCORE_FAILED';
                notify({phase: 'error', errorCode: errorCode.slice(0, 120)}); return;
            }
        }
        if (current() && version === generation) {
            scoreAbort = undefined;
            if (completed) {reconcileRoots(completed.roots); notify({phase: 'active'});}
            else frame = view.requestAnimationFrame(() => step(version));
        }
    }
    function step(version: number): void {
        frame = undefined;
        if (!current() || version !== generation || !work) return;
        const started = view.performance.now(); let count = 0;
        while (count++ < 8192) {
            const result = work.next();
            if (result.done) {work = undefined; const batch = pending; pending = []; void analyze(batch, version, started, result.value); return;}
            if (result.value) pending.push(result.value);
            if (pending.length >= 12) {const batch = pending; pending = []; void analyze(batch, version, started); return;}
            if (view.performance.now() - started >= 4) break;
        }
        frame = view.requestAnimationFrame(() => step(version));
    }
    function schedule(invalidate = false): void {
        if (!current() || !paint) return;
        cancel(); if (invalidate) clearPaint();
        notify({phase: 'paused', queuedParagraphs: 0, errorCode: undefined});
        const version = generation;
        timer = view.setTimeout(() => {
            timer = undefined;
            if (!current() || version !== generation) return;
            clearPaint(); work = collectInformationParagraphs(document, ports.readTranslationRoot, ports.scope);
            notify({phase: 'analyzing', processedParagraphs: 0});
            frame = view.requestAnimationFrame(() => step(version));
        }, 180);
    }
    const scroll = () => schedule(), refresh = () => schedule(true);
    const teardown = () => {
        cancel(); clearPaint();
        for (const observer of observers.values()) observer.disconnect(); observers.clear();
        for (const style of styles.values()) style.remove(); styles.clear();
        if (registry && registry.get(INFORMATION_HIGHLIGHT_NAME) === paint) registry.delete(INFORMATION_HIGHLIGHT_NAME);
        document.removeEventListener('scroll', scroll, true); view.removeEventListener('resize', scroll);
        for (const event of ['fluentread-shadow-root-attached', 'fluentread-translation-started', 'fluentread-translation-ended']) document.removeEventListener(event, refresh);
    };
    return {
        getState: snapshot,
        setEnabled(value) {
            if (disposed || (value && !(ports.isCurrent?.() ?? true))) return snapshot();
            if (enabled === value) return snapshot();
            enabled = value; session++; notify({sessionId: String(session), processedParagraphs: 0, queuedParagraphs: 0, errorCode: undefined});
            if (!enabled) {teardown(); notify({phase: 'idle'}); return snapshot();}
            if (!paint) {notify({phase: 'unsupported', errorCode: 'INFORMATION_HIGHLIGHT_NATIVE_UNSUPPORTED'}); return snapshot();}
            observe(document);
            document.addEventListener('scroll', scroll, true); view.addEventListener('resize', scroll);
            for (const event of ['fluentread-shadow-root-attached', 'fluentread-translation-started', 'fluentread-translation-ended']) document.addEventListener(event, refresh);
            schedule(); return snapshot();
        },
        retry() {schedule(true); return snapshot();},
        updatePreferences(next) {
            const rescore = preferences.mode !== next.mode || preferences.density !== next.density;
            preferences = {...next}; notify({});
            for (const root of styles.keys()) styleRoot(root);
            if (rescore) schedule(true);
        },
        refresh,
        dispose() {if (disposed) return; enabled = false; disposed = true; teardown(); cache.clear(); cachedCharacters = 0; notify({phase: 'idle', queuedParagraphs: 0});},
    };
}
