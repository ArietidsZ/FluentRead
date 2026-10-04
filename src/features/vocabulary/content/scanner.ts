/**
 * @file src/features/vocabulary/content/scanner.ts
 * 文件职责：在阅读期间绘制收藏表达并协调动态网页、滚动、点击与失效清理。
 * 主要内容：复用只读文字扫描，合并后续扫描，按开放根注册观察器和绘制样式；只处理无选区的普通正文点击，保留宿主事件，并完整释放本功能拥有的 Highlight 与节点。
 * 模块边界：不访问数据库、配置或模型，不截获链接、输入或选区，不记录掌握状态；生命周期和卡片展示由内容挂载器注入。
 */
import {createExpressionIndex, type ReencounterEntry} from '../domain/reencounter';
import {scanReadingExpressions, type ReencounterOccurrence} from './readingText';

export const REENCOUNTER_HIGHLIGHT = 'fluentread-vocabulary-reencounter';
const css = `::highlight(${REENCOUNTER_HIGHLIGHT}) { text-decoration: underline dotted #c58a37; text-decoration-thickness: 1px; text-underline-offset: 3px; }
@media (prefers-color-scheme: dark) { ::highlight(${REENCOUNTER_HIGHLIGHT}) { text-decoration-color: #e9b766; } }`;
type PaintWindow = Window & typeof globalThis & {Highlight?: new (...ranges: Range[]) => Set<Range>; CSS?: {highlights?: Map<string, Set<Range>>}};
export interface ReencounterScanner {
  setEntries: (entries: readonly ReencounterEntry[]) => void;
  refresh: () => void;
  dispose: () => void;
}

export function installReencounterScanner(document: Document, callbacks: {
  changed: (occurrences: ReencounterOccurrence[]) => void;
  open: (occurrence: ReencounterOccurrence) => void;
}): ReencounterScanner {
  const view = document.defaultView as PaintWindow;
  const registry = view.CSS?.highlights;
  const paint = view.Highlight && registry ? new view.Highlight() : undefined;
  const styles = new Map<Document | ShadowRoot, HTMLStyleElement>();
  const observers = new Map<Document | ShadowRoot, MutationObserver>();
  let entries: readonly ReencounterEntry[] = [];
  let index = createExpressionIndex([]);
  let occurrences: ReencounterOccurrence[] = [];
  let timer: number | undefined;
  let disposed = false;
  const owned = (node: Node): boolean => {
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    return Boolean(element?.closest('[data-fr-reencounter-style],[data-fluent-read-ui],[id^="fluent-read-"]'));
  };
  const irrelevant = (node: Node): boolean => owned(node) || (node.nodeType === 1 && (node as Element).matches('script,style,link,meta'));
  function clear(): void { paint?.clear(); occurrences = []; callbacks.changed([]); }
  function schedule(): void {
    if (disposed || timer !== undefined) return;
    timer = view.setTimeout(scan, 180);
  }
  function observe(root: Document | ShadowRoot): void {
    if (observers.has(root)) return;
    const observer = new view.MutationObserver(records => {
      const relevant = records.filter(record => !irrelevant(record.target) && (record.type !== 'childList'
        || [...record.addedNodes, ...record.removedNodes].some(node => !irrelevant(node))));
      if (!relevant.length) return;
      if (relevant.some(record => record.type !== 'attributes')) {paint?.clear(); occurrences = [];}
      schedule();
    });
    observer.observe(root, {childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['hidden', 'aria-hidden', 'contenteditable', 'translate', 'class', 'style', 'inert']});
    observers.set(root, observer);
  }
  function scan(): void {
    timer = undefined;
    if (disposed) return;
    paint?.clear();
    const result = scanReadingExpressions(document, entries, index);
    occurrences = result.occurrences;
    const roots = new Set(result.roots);
    for (const [root, observer] of observers) if (!roots.has(root)) { observer.disconnect(); observers.delete(root); }
    for (const [root, style] of styles) if (!roots.has(root)) { style.remove(); styles.delete(root); }
    for (const root of roots) {
      if (paint && !styles.has(root)) {
        const style = document.createElement('style');
        style.setAttribute('data-fr-reencounter-style', 'true'); style.textContent = css;
        (root.nodeType === 9 ? document.documentElement : root).appendChild(style);
        styles.set(root, style);
      }
      observe(root);
    }
    if (paint) {
      for (const occurrence of occurrences) for (const range of occurrence.ranges) paint.add(range);
      registry!.set(REENCOUNTER_HIGHLIGHT, paint);
    }
    callbacks.changed(occurrences);
  }
  function click(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey
      || document.getSelection()?.isCollapsed === false) return;
    const target = event.composedPath().find(node => node instanceof view.Element) as Element | undefined;
    if (!target || owned(target) || target.closest('a,button,input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
    const root = target.getRootNode();
    const hit = occurrences.find(occurrence => occurrence.root === root && occurrence.ranges.some(range =>
      range.startContainer.isConnected && Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0
        && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom)));
    if (hit) callbacks.open(hit);
  }
  document.addEventListener('click', click);
  document.addEventListener('scroll', schedule, {capture: true, passive: true});
  document.addEventListener('fluentread-route-change', schedule);
  document.addEventListener('fluentread-open-shadow-root', schedule, true);
  view.addEventListener('resize', schedule, {passive: true});
  // 无条目时也观察正文，随后收藏变更通过 setEntries 更新同一实例。
  observe(document);
  return {
    setEntries(next) { entries = next; index = createExpressionIndex(entries); clear(); schedule(); },
    refresh: schedule,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== undefined) view.clearTimeout(timer);
      for (const observer of observers.values()) observer.disconnect();
      observers.clear(); clear();
      for (const style of styles.values()) style.remove();
      styles.clear();
      if (paint && registry?.get(REENCOUNTER_HIGHLIGHT) === paint) registry.delete(REENCOUNTER_HIGHLIGHT);
      document.removeEventListener('click', click);
      document.removeEventListener('scroll', schedule, true);
      document.removeEventListener('fluentread-route-change', schedule);
      document.removeEventListener('fluentread-open-shadow-root', schedule, true);
      view.removeEventListener('resize', schedule);
    },
  };
}
