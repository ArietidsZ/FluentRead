/**
 * @file src/features/vocabulary/content/readingText.ts
 * 文件职责：只读收集网页与开放 Shadow DOM 的可读正文，将收藏命中转为原生文字范围。
 * 主要内容：跨内联标签连接文本，在块、换行与受保护区域处断开，排除交互控件、编辑器、代码、公式、译文与插件节点；仅对视口附近内容生成 Range。
 * 模块边界：不包裹或替换原文，不注册监听、不调用模型、不持久化遇见；调用方拥有范围、绘制样式与观察器生命周期。
 */
import {matchExpressions, reencounterSentence, type ExpressionIndex, type ReencounterEntry} from '../domain/reencounter';

interface TextRun {node: Text; start: number; end: number}
interface TextGroup {text: string; runs: TextRun[]; root: Document | ShadowRoot}
export interface ReencounterOccurrence {entry: ReencounterEntry; sentence: string; ranges: Range[]; root: Document | ShadowRoot}
export interface ReadingScan {occurrences: ReencounterOccurrence[]; roots: Array<Document | ShadowRoot>}
const excluded = 'script,style,noscript,template,textarea,input,select,button,a,[role="button"],[role="link"],[role="textbox"],pre,code,kbd,svg,math,mjx-container,.katex,[hidden],[inert],[aria-hidden="true"],[translate="no"],[contenteditable]:not([contenteditable="false"]),[data-fr-translation-owned="true"],[data-fluent-read-ui],[id^="fluent-read-"]';
const blocks = /^(?:ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BODY|DD|DETAILS|DIV|DL|DT|FIGCAPTION|FIGURE|FOOTER|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|SECTION|TABLE|TD|TH|TR|UL)$/u;

/** 保留原生 Text 身份，允许短语跨越 em/strong 等内联元素。 */
export function collectReadingGroups(document: Document): {groups: TextGroup[]; roots: Array<Document | ShadowRoot>} {
  const groups: TextGroup[] = [];
  const roots: Array<Document | ShadowRoot> = [document];
  const view = document.defaultView!;
  let current: TextGroup | undefined;
  function visit(node: Node, root: Document | ShadowRoot): void {
    if (node.nodeType === 3) {
      const text = (node as Text).data;
      if (!text) return;
      root = node.getRootNode() as Document | ShadowRoot;
      if (current?.root !== root) current = undefined;
      if (!current) { current = {text: '', runs: [], root}; groups.push(current); }
      const start = current.text.length;
      current.text += text;
      current.runs.push({node: node as Text, start, end: current.text.length});
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as HTMLElement;
    if (element.matches(excluded)) { current = undefined; return; }
    if (blocks.test(element.tagName) && element !== document.body) {
      const box = element.getBoundingClientRect(); const height = view.innerHeight;
      if (box.bottom < -height || box.top > height * 2) { current = undefined; return; }
    }
    const style = view.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') { current = undefined; return; }
    const block = blocks.test(element.tagName) || !['inline', 'contents', 'inline-block', 'inline-flex', 'inline-grid'].includes(style.display);
    if (block || element.tagName === 'BR') current = undefined;
    if (element.shadowRoot) {
      current = undefined; roots.push(element.shadowRoot);
      for (const child of Array.from(element.shadowRoot.childNodes)) visit(child, element.shadowRoot);
      current = undefined;
    } else if (element.tagName === 'SLOT' && (element as HTMLSlotElement).assignedNodes) {
      const assigned = (element as HTMLSlotElement).assignedNodes({flatten: true});
      for (const child of assigned.length ? assigned : Array.from(element.childNodes)) visit(child, root);
    } else {
      for (const child of Array.from(element.childNodes)) visit(child, root);
    }
    if (block) current = undefined;
  }
  if (document.body) visit(document.body, document);
  return {groups, roots};
}

/** 附近正文才做词匹配；滚动后重新扫描，避免长网页预先绘制大量离屏 Range。 */
export function scanReadingExpressions(document: Document, entries: readonly ReencounterEntry[], index: ExpressionIndex): ReadingScan {
  const {groups, roots} = collectReadingGroups(document);
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const occurrences: ReencounterOccurrence[] = [];
  const height = document.defaultView!.innerHeight;
  for (const group of groups) {
    for (const match of matchExpressions(group.text, index, Infinity)) {
      const ranges: Range[] = [];
      for (const run of group.runs) {
        const start = Math.max(match.start, run.start);
        const end = Math.min(match.end, run.end);
        if (start >= end) continue;
        const range = document.createRange();
        range.setStart(run.node, start - run.start); range.setEnd(run.node, end - run.start);
        ranges.push(range);
      }
      if (!ranges.some(range => Array.from(range.getClientRects()).some(rect => rect.height > 0 && rect.width > 0 && rect.bottom >= -height && rect.top <= height * 2))) continue;
      occurrences.push({entry: byId.get(match.entryId)!, sentence: reencounterSentence(group.text, match.start, match.end), ranges, root: group.root});
      if (occurrences.length >= 300) break;
    }
    if (occurrences.length >= 300) break;
  }
  return {occurrences, roots};
}
