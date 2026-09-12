<!--
 * @file src/features/writing-assistant/ui/WritingSurface.vue
 * 文件职责：在隔离层中为 Gmail 与 GitHub 回复编辑器定位写作入口，维护当前编辑器的写作会话。
 * 主要内容：不向网页按钮组插入节点；跟随编辑器与提交按钮重排，在空闲位置显示入口，隐藏或移除编辑器时清理会话入口。
 * 模块边界：只拥有网页 DOM 和编辑器快照，不注册写作快捷键或网站停用名单，不执行模型和自动发送操作。
 -->
<template>
  <div ref="entryLayer" data-fluent-read-ui="writing-entries" />
  <WritingPanel :active="opened" :anchor="anchor" :initial-draft="draft" :initial-context="context" :initial-intent="intent" :session-key="sessionKey" :plain-text-output="snapshot?.site === 'gmail'" :apply-draft="canInsert ? fillDraft : undefined" @close="close" />
</template>
<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, shallowRef, watch} from 'vue';
import browser from 'webextension-polyfill';
import {config as initialConfig, subscribeConfig} from '@/src/services/config/store';
import {isExtensionDisabledOnSite} from '@/src/core/site-rules/domain';
import {translateLegacyText, normalizeUiLanguage} from '@/src/core/i18n';
import {isWritingPage, type WritingIntent} from '@/src/core/config/writing';
import {applyWritingDraft, captureEditor, collectReplyContext, editorText, findReplyEditors, findReplyActionAnchor, isWritingEditor, writingSite, type EditorSnapshot} from '../editors';
import WritingPanel from './WritingPanel.vue';
import {writingEntryCandidates} from '../entryPlacement';
const config = shallowRef(initialConfig);
const unsubscribeConfig = subscribeConfig(value => { config.value = value; });
onBeforeUnmount(unsubscribeConfig);
const iconUrl = browser.runtime.getURL('/icon/128.png');
const opened = ref(false); const draft = ref(''); const context = ref(''); const intent = ref<WritingIntent>('reply'); const sessionKey = ref(0);
const anchor = shallowRef<HTMLElement>(); const snapshot = shallowRef<EditorSnapshot>();
const canInsert = computed(() => Boolean(snapshot.value && !snapshot.value.element.querySelector('a, img, video, audio, table, [contenteditable="false"]')));
const entryLayer = ref<HTMLElement>();
type Entry = {host: HTMLElement; button: HTMLButtonElement; action: HTMLElement; abort: AbortController};
const entries = new Map<HTMLElement, Entry>();
const abort = new AbortController(); let observer: MutationObserver; let timer: ReturnType<typeof setTimeout> | undefined;
let resizeObserver: ResizeObserver | undefined; let frame = 0;
const observed = new Set<Element>();
let currentUrl = location.href;
const dark = computed(() => config.value.theme === 'dark' || (config.value.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches));
const allowed = () => config.value.on && config.value.writing.enabled && isWritingPage(location.href) && !isExtensionDisabledOnSite(location.href, config.value.disabledExtensionDomains);
function close(restoreFocus = true) { const wasOpened = opened.value; opened.value = false; if (wasOpened && restoreFocus && snapshot.value?.element.isConnected) snapshot.value.element.focus({preventScroll: true}); }
function clearEntries() { for (const entry of entries.values()) { entry.abort.abort(); entry.host.remove(); } entries.clear(); }
function ownUi(node: Node): boolean {
  const element = node.nodeType === 1 ? node as Element : node.parentElement;
  return Boolean(element?.closest('[data-fluent-read-ui]'));
}
function visible(element: HTMLElement): boolean {
  if (!element.isConnected || !element.getClientRects().length || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const style = getComputedStyle(element);
  return style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.display !== 'none';
}
function pageElementAt(x: number, y: number): Element | undefined {
  return document.elementsFromPoint(x, y).find(element => !ownUi(element));
}
function actionExposed(action: HTMLElement): boolean {
  if (!visible(action)) return false;
  const box = action.getBoundingClientRect();
  const hit = pageElementAt(box.left + box.width / 2, box.top + box.height / 2);
  return Boolean(hit && (hit === action || action.contains(hit)));
}
function freeSpace(box: {left: number; top: number; width: number; height: number}, occupied: DOMRect[]): boolean {
  const intersects = (other: DOMRect) => box.left < other.right && box.left + box.width > other.left && box.top < other.bottom && box.top + box.height > other.top;
  if (occupied.some(intersects)) return false;
  // 只覆盖空白背景。命中按钮、输入区、标签或实际文字时换用另一侧/紧凑入口。
  const checked = new Set<Element>();
  for (const dx of [1, box.width / 2, box.width - 1]) for (const dy of [1, box.height / 2, box.height - 1]) {
    const hit = pageElementAt(box.left + dx, box.top + dy);
    if (!hit || checked.has(hit)) continue;
    checked.add(hit);
    if (hit.closest('button, a, input, textarea, select, label, [role="button"], [role="textbox"], [contenteditable="true"], img, video, canvas, svg')) return false;
    for (const node of hit.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      const range = document.createRange(); range.selectNodeContents(node);
      if ([...range.getClientRects()].some(intersects)) return false;
    }
  }
  return true;
}
function placeEntries() {
  frame = 0;
  const viewport = window.visualViewport;
  const bounds = {left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0, right: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth), bottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight)};
  // 几何检查补足采样点之间的小控件（如附件/下拉图标），避免小按钮被入口覆盖。
  const occupied = [...document.querySelectorAll<HTMLElement>('button, a, input, textarea, select, label, [role="button"], [role="textbox"], [contenteditable="true"], img, video, canvas, svg')]
    .filter(element => !ownUi(element) && visible(element))
    .map(element => element.getBoundingClientRect())
    .filter(rect => rect.width > 0 && rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom);
  for (const [editor, entry] of entries) {
    const {host, button, action} = entry;
    host.style.visibility = 'hidden'; host.removeAttribute('data-compact');
    if (!isWritingEditor(editor, writingSite(location.href)) || !visible(editor) || !actionExposed(action)) continue;
    const candidates = writingEntryCandidates(action.getBoundingClientRect(), bounds, button.getBoundingClientRect().width, writingSite(location.href)!);
    const placement = candidates.find(box => freeSpace(box, occupied));
    if (!placement) continue;
    if (placement.compact) host.setAttribute('data-compact', '');
    host.style.left = `${placement.left}px`; host.style.top = `${placement.top}px`; host.style.visibility = 'visible';
    occupied.push(host.getBoundingClientRect());
  }
  if (opened.value && anchor.value?.style.visibility !== 'visible') close(false);
}
function schedulePlacement() { if (!frame) frame = requestAnimationFrame(placeEntries); }
function trackSizes() {
  const next = new Set<Element>();
  for (const [editor, entry] of entries) for (const target of [editor, entry.action]) {
    for (let element: Element | null = target; element; element = element.parentElement) next.add(element);
  }
  for (const element of observed) if (!next.has(element)) { resizeObserver?.unobserve(element); observed.delete(element); }
  for (const element of next) if (!observed.has(element)) { resizeObserver?.observe(element); observed.add(element); }
}
function scan() {
  clearTimeout(timer); timer = undefined;
  if (!entryLayer.value) return;
  if (currentUrl !== location.href) { currentUrl = location.href; close(false); snapshot.value = undefined; sessionKey.value++; }
  if (!allowed()) { close(false); snapshot.value = undefined; clearEntries(); trackSizes(); return; }
  const site = writingSite(location.href);
  const editors = findReplyEditors(document, site).filter(element => {
    const rect = element.getBoundingClientRect();
    return visible(element) && rect.width >= 120 && rect.height >= 20 && Boolean(findReplyActionAnchor(element, site));
  });
  for (const [editor, entry] of entries) if (!editors.includes(editor) || !entry.host.isConnected) { entry.abort.abort(); entry.host.remove(); entries.delete(editor); }
  if (opened.value && (!snapshot.value?.element.isConnected || !entries.has(snapshot.value.element))) close(false);
  for (const editor of editors) {
    const action = findReplyActionAnchor(editor, site)!;
    let entry = entries.get(editor);
    if (!entry) {
      const host = document.createElement('span'); host.setAttribute('data-fluent-read-ui', 'writing-entry');
      host.style.cssText = 'position:fixed;display:inline-flex;visibility:hidden;left:0;top:0;z-index:2147483645;margin:0;padding:0;border:0;line-height:0;';
      const root = host.attachShadow({mode: 'open'}); const entryAbort = new AbortController();
      const style = document.createElement('style');
      style.textContent = ':host{color-scheme:light}button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;box-sizing:border-box;padding:5px 10px;border:1px solid #d8dee4;border-radius:6px;background:#f6f8fa;color:#38414d;font:500 12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;white-space:nowrap;margin:0}img{width:18px;height:18px;object-fit:contain}button:hover{background:#fff1f6;border-color:#ef9fb7}button:focus-visible{outline:2px solid #ef4776;outline-offset:2px}:host([data-compact]) button{width:32px;padding:6px}:host([data-compact]) span{display:none}:host([data-theme=dark]) button{background:#292c35;border-color:#454951;color:#e5e7ec}';
      const button = document.createElement('button'); button.type = 'button';
      const icon = document.createElement('img'); icon.alt = ''; icon.src = iconUrl; button.append(icon, document.createElement('span'));
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); open(editor); }, {signal: entryAbort.signal});
      root.append(style, button); entryLayer.value.append(host); entry = {host, button, action, abort: entryAbort}; entries.set(editor, entry);
    }
    entry.action = action;
    entry.host.dataset.theme = dark.value ? 'dark' : 'light';
    const label = translateLegacyText('写作助手', normalizeUiLanguage(config.value.uiLanguage));
    const node = entry.button.querySelector('span')!; if (node.textContent !== label) node.textContent = label;
    entry.button.setAttribute('aria-label', label);
    entry.button.title = translateLegacyText('起草回复或完善已有草稿', normalizeUiLanguage(config.value.uiLanguage));
    entry.button.setAttribute('aria-haspopup', 'dialog');
    entry.button.setAttribute('aria-expanded', String(opened.value && snapshot.value?.element === editor));
  }
  trackSizes(); schedulePlacement();
}
function schedule() { if (timer === undefined) timer = setTimeout(scan, 80); }
function open(element: HTMLElement) {
  if (!allowed() || !isWritingEditor(element, writingSite(location.href)) || !visible(element) || !entries.get(element) || !actionExposed(entries.get(element)!.action)) return;
  anchor.value = entries.get(element)?.host;
  const next = captureEditor(element, location.href);
  if (snapshot.value?.element !== element || snapshot.value.signature !== next.signature || snapshot.value.url !== next.url) {
    snapshot.value = next; draft.value = editorText(element).slice(0, 12000);
    context.value = collectReplyContext(document, writingSite(location.href), element, location.href);
    const hasReply = next.site === 'gmail' ? /(?:^|\n\n)当前邮件：/.test(context.value) : Boolean(context.value.trim());
    intent.value = draft.value.trim() ? 'polish' : hasReply ? 'reply' : 'draft'; sessionKey.value++;
  }
  opened.value = true;
}
function fillDraft(text: string): string | undefined {
  if (!allowed() || !snapshot.value) return '当前页面已禁用写作助手。';
  const failure = applyWritingDraft(snapshot.value, text, location.href);
  if (!failure) { snapshot.value = captureEditor(snapshot.value.element, location.href); close(); }
  return failure;
}
watch(() => JSON.stringify([config.value.on, config.value.writing.enabled, config.value.disabledExtensionDomains, config.value.uiLanguage, dark.value]), scan);
watch(opened, () => { for (const [editor, entry] of entries) entry.button.setAttribute('aria-expanded', String(opened.value && snapshot.value?.element === editor)); });
onMounted(() => {
  resizeObserver = new ResizeObserver(schedulePlacement);
  scan(); observer = new MutationObserver(records => { if (records.some(record => !ownUi(record.target) && (record.type !== 'childList' || [...record.addedNodes, ...record.removedNodes].some(node => !ownUi(node))))) { schedule(); schedulePlacement(); } });
  observer.observe(document.body, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'aria-disabled', 'disabled', 'readonly', 'contenteditable', 'inert']});
  document.addEventListener('scroll', event => { if (!event.composedPath().includes(entryLayer.value!.getRootNode())) schedulePlacement(); }, {capture: true, passive: true, signal: abort.signal});
  document.addEventListener('focusin', schedule, {signal: abort.signal});
  document.addEventListener('fluentread-route-change', scan, {signal: abort.signal});
  window.addEventListener('resize', schedulePlacement, {signal: abort.signal});
  window.visualViewport?.addEventListener('resize', schedulePlacement, {signal: abort.signal});
  window.visualViewport?.addEventListener('scroll', schedulePlacement, {signal: abort.signal});
  document.addEventListener('transitionend', schedule, {capture: true, signal: abort.signal});
  window.addEventListener('hashchange', scan, {signal: abort.signal});
  window.addEventListener('pagehide', () => close(false), {signal: abort.signal});
});
onBeforeUnmount(() => { abort.abort(); observer?.disconnect(); resizeObserver?.disconnect(); observed.clear(); cancelAnimationFrame(frame); clearTimeout(timer); clearEntries(); });
</script>
