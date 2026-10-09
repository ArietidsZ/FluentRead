/**
 * @file src/features/information-highlight/content/readingText.ts
 * 文件职责：以只读、有界工作迭代器收集页面可见正文和独立译文，并保存原生 Text 到 UTF-16 段落坐标的映射。
 * 主要内容：保留内联链接与强调文字，排除交互界面、编辑器、代码和公式；按块及翻译边界流式分段，限制单段字符与映射节点，不截去长段剩余正文，检查原节点身份与快照后才生成 Range。
 * 模块边界：不监听页面、不改写宿主属性或原文、不调用模型；闭合译文根由调用方通过只读端口提供，评分与生命周期由 content runtime 管理。
 */
import type {InformationHighlightSpan} from '../protocol';
import {informationSliceEnd} from '../domain/textBoundaries';
export interface InformationTextRun {node: Text; parent: Node; data: string; start: number; end: number; offset: number}
export interface InformationParagraph {text: string; runs: InformationTextRun[]; root: Document | ShadowRoot; distance: number; continuation?: boolean}
export interface InformationReadingScan {roots: Array<Document | ShadowRoot>}
export const INFORMATION_PARAGRAPH_CHARACTERS = 2400;
const nonReadingSubtrees = 'textarea,input,select,button,form,pre,code,kbd,samp,[role="button"],[role="textbox"],[role="menu"],[role="navigation"],[contenteditable]:not([contenteditable="false"])';
const excluded = 'script,style,noscript,template,' + nonReadingSubtrees + ',nav,header,footer,svg,math,mjx-container,.katex,.MathJax,.mwe-math-element,[hidden],[inert],[aria-hidden="true"],[data-fluent-read-ui],[data-fluentread-pdf-decoration],[id^="fluent-read-"]';
const blocks = /^(?:ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BODY|DD|DETAILS|DIV|DL|DT|FIGCAPTION|FIGURE|H[1-6]|HR|LI|MAIN|OL|P|SECTION|TABLE|TD|TH|TR|UL)$/u;
interface Frame {next: Node | null; endGroup: boolean; assigned?: Node[]; index: number; translation: boolean; shortTranslation: boolean}

/** 控件与编辑器内部更新不改变正文；资格属性变化仍须重扫，translate=no 不在此排除受控译文。 */
export function isInformationMutationExcluded(record: MutationRecord): boolean {
    if (record.type === 'attributes' && record.attributeName !== 'style') return false;
    const node = record.target;
    return Boolean((node.nodeType === 1 ? node as Element : node.parentElement)?.closest(nonReadingSubtrees));
}

export function* collectInformationParagraphs(document: Document, readTranslationRoot?: (host: Element) => ShadowRoot | undefined,
    scope: HTMLElement = document.body): Generator<InformationParagraph | undefined, InformationReadingScan> {
    const pending: InformationParagraph[] = [], roots: Array<Document | ShadowRoot> = [document];
    const view = document.defaultView!;
    let current: InformationParagraph | undefined, distance = 0;
    const stack: Frame[] = scope ? [{next: scope, endGroup: false, index: 0, translation: false, shortTranslation: false}] : [];
    const end = () => {if (current && current.text.trim() && (current.text.trim().length >= 16 || current.continuation)) pending.push(current); current = undefined;};
    while (stack.length) {
        while (pending.length) yield pending.shift()!;
        yield undefined;
        const frame = stack[stack.length - 1], node = frame.next;
        if (!node) {stack.pop(); if (frame.endGroup) end(); continue;}
        frame.next = frame.assigned ? frame.assigned[++frame.index] ?? null : stack.length === 1 ? null : node.nextSibling;
        if (node.nodeType === 3) {
            const text = node as Text, data = text.data;
            const root = node.getRootNode() as Document | ShadowRoot;
            let offset = 0;
            while (offset < data.length) {
                yield undefined;
                if (!current || current.root !== root || current.text.length >= INFORMATION_PARAGRAPH_CHARACTERS || current.runs.length >= 96) {
                    end(); while (pending.length) yield pending.shift()!;
                    current = {text: '', runs: [], root, distance, continuation: offset > 0 || frame.shortTranslation};
                }
                // PDF.js 的定位 span 常省略词间空格：空格只存在于分析字符串，永不生成 Text 或写入 DOM。
                if (offset === 0 && current.runs.length && text.parentElement?.closest('[data-fluentread-pdf-text]')
                    && !/\s/u.test(current.text.at(-1)!) && !/\s/u.test(data[0])) current.text += ' ';
                const length = informationSliceEnd(data, offset, INFORMATION_PARAGRAPH_CHARACTERS - current.text.length) - offset;
                if (current.text.length && current.text.length + length > INFORMATION_PARAGRAPH_CHARACTERS) {
                    end(); while (pending.length) yield pending.shift()!; continue;
                }
                const start = current.text.length;
                current.text += data.slice(offset, offset + length);
                current.runs.push({node: text, parent: text.parentNode!, data, start, end: current.text.length, offset});
                offset += length;
            }
            continue;
        }
        if (node.nodeType !== 1) continue;
        const element = node as HTMLElement;
        if (element.matches(excluded)) {end(); continue;}
        const translationRoot = readTranslationRoot?.(element);
        const translated = element.matches('.fluent-read-bilingual-content[data-fr-translation-owned="true"]');
        if (!translationRoot && !translated && !frame.translation && element.matches('[translate="no"],[data-fr-translation-owned="true"]')) {end(); continue;}
        const blockTag = blocks.test(element.tagName);
        if (blockTag && element !== scope) {
            const rect = element.getBoundingClientRect(), height = view.innerHeight;
            if (rect.bottom < -height || rect.top > height * 2) {end(); continue;}
            distance = rect.top > height ? rect.top - height : rect.bottom < 0 ? -rect.bottom : 0;
        }
        const style = view.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {end(); continue;}
        const block = blockTag || Boolean(translated) || element.tagName === 'BR' || (!element.closest('[data-fluentread-pdf-text]') &&
            (Boolean(style.display) && !['inline', 'contents', 'inline-block', 'inline-flex', 'inline-grid'].includes(style.display)));
        if (block) end();
        const shadow = translationRoot ?? element.shadowRoot;
        let next: Node | null = element.firstChild, assigned: Node[] | undefined;
        if (shadow) {end(); if (!roots.includes(shadow)) roots.push(shadow); next = shadow.firstChild;}
        else if (element.tagName === 'SLOT' && (element as HTMLSlotElement).assignedNodes) {
            const projected = (element as HTMLSlotElement).assignedNodes({flatten: true});
            if (projected.length) {assigned = projected; next = assigned[0];}
        }
        stack.push({next, assigned, index: 0, endGroup: block || Boolean(shadow), translation: frame.translation || translated || Boolean(translationRoot), shortTranslation: frame.shortTranslation || Boolean(translationRoot)});
    }
    end(); while (pending.length) yield pending.shift()!;
    return {roots};
}

/** 同文本替换也必须拒绝；仅当当次收集的每个 Text 与父节点仍然存在时允许绘制。 */
export function isInformationParagraphCurrent(paragraph: InformationParagraph): boolean {
    return paragraph.runs.every(run => run.node.isConnected && run.node.parentNode === run.parent && run.node.data === run.data && run.node.getRootNode() === paragraph.root);
}

export function informationRanges(document: Document, paragraph: InformationParagraph, spans: readonly InformationHighlightSpan[]): Range[] {
    if (!isInformationParagraphCurrent(paragraph)) return [];
    const ranges: Range[] = [];
    for (const span of spans) {
        for (const run of paragraph.runs) {
            if (run.end <= span.start) continue;
            if (run.start >= span.end) break;
            const range = document.createRange();
            range.setStart(run.node, run.offset + Math.max(0, span.start - run.start));
            range.setEnd(run.node, run.offset + Math.min(run.end - run.start, span.end - run.start));
            ranges.push(range);
        }
    }
    return ranges;
}
