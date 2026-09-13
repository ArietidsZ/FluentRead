<!--
 * @file src/features/writing-assistant/ui/WritingSurface.vue
 * 文件职责：在隔离层中为 Gmail 与 GitHub 回复编辑器定位写作入口，维护当前编辑器的写作会话。
 * 主要内容：将入口内嵌到当前网页的原生操作行，同时用 Shadow DOM 隔离按钮内部样式；跟随编辑器与提交按钮重排，隐藏或移除编辑器时清理会话入口。
 * 模块边界：只拥有网页 DOM 和编辑器快照，不注册写作快捷键或网站停用名单，不执行模型和自动发送操作。
 -->
<template>
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
import {placeWritingEntry, prepareWritingEntryHost} from '../entryPlacement';
import WritingPanel from './WritingPanel.vue';
const config = shallowRef(initialConfig);
const unsubscribeConfig = subscribeConfig(value => { config.value = value; });
onBeforeUnmount(unsubscribeConfig);
const iconUrl = browser.runtime.getURL('/icon/128.png');
const opened = ref(false); const draft = ref(''); const context = ref(''); const intent = ref<WritingIntent>('reply'); const sessionKey = ref(0);
const anchor = shallowRef<HTMLElement>(); const snapshot = shallowRef<EditorSnapshot>();
const canInsert = computed(() => Boolean(snapshot.value && !snapshot.value.element.querySelector('a, img, video, audio, table, [contenteditable="false"]')));
type Entry = {host: HTMLElement; button: HTMLButtonElement; action: HTMLElement; abort: AbortController};
const entries = new Map<HTMLElement, Entry>();
const abort = new AbortController(); let observer: MutationObserver; let timer: ReturnType<typeof setTimeout> | undefined;
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
function scan() {
  clearTimeout(timer); timer = undefined;
  if (currentUrl !== location.href) { currentUrl = location.href; close(false); snapshot.value = undefined; sessionKey.value++; }
  if (!allowed()) { close(false); snapshot.value = undefined; clearEntries(); return; }
  const site = writingSite(location.href);
  if (!site) { clearEntries(); return; }
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
      prepareWritingEntryHost(host);
      const root = host.attachShadow({mode: 'open'}); const entryAbort = new AbortController();
      const style = document.createElement('style');
      style.textContent = ':host{color-scheme:light}button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;box-sizing:border-box;padding:5px 10px;border:1px solid #d8dee4;border-radius:6px;background:#f6f8fa;color:#38414d;font:500 12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;white-space:nowrap;margin:0}img{width:18px;height:18px;object-fit:contain}button:hover{background:#fff1f6;border-color:#ef9fb7}button:focus-visible{outline:2px solid #ef4776;outline-offset:2px}:host([data-compact]) button{width:32px;padding:6px}:host([data-compact]) span{display:none}:host([data-theme=dark]) button{background:#292c35;border-color:#454951;color:#e5e7ec}';
      const button = document.createElement('button'); button.type = 'button';
      const icon = document.createElement('img'); icon.alt = ''; icon.src = iconUrl; button.append(icon, document.createElement('span'));
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); open(editor); }, {signal: entryAbort.signal});
      root.append(style, button); entry = {host, button, action, abort: entryAbort}; entries.set(editor, entry);
    }
    entry.action = action;
    placeWritingEntry(entry.action, entry.host, site);
    entry.host.dataset.theme = dark.value ? 'dark' : 'light';
    const label = translateLegacyText('写作助手', normalizeUiLanguage(config.value.uiLanguage));
    const node = entry.button.querySelector('span')!; if (node.textContent !== label) node.textContent = label;
    entry.button.setAttribute('aria-label', label);
    entry.button.title = translateLegacyText('起草回复或完善已有草稿', normalizeUiLanguage(config.value.uiLanguage));
    entry.button.setAttribute('aria-haspopup', 'dialog');
    entry.button.setAttribute('aria-expanded', String(opened.value && snapshot.value?.element === editor));
  }
}
function schedule() { if (timer === undefined) timer = setTimeout(scan, 80); }
function open(element: HTMLElement) {
  const entry = entries.get(element);
  if (!allowed() || !isWritingEditor(element, writingSite(location.href)) || !visible(element) || !entry?.host.isConnected || !visible(entry.action)) return;
  anchor.value = entry.host;
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
  scan(); observer = new MutationObserver(records => { if (records.some(record => !ownUi(record.target) && (record.type !== 'childList' || [...record.addedNodes, ...record.removedNodes].some(node => !ownUi(node))))) schedule(); });
  observer.observe(document.body, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'aria-disabled', 'disabled', 'readonly', 'contenteditable', 'inert']});
  document.addEventListener('focusin', schedule, {signal: abort.signal});
  document.addEventListener('fluentread-route-change', scan, {signal: abort.signal});
  window.addEventListener('resize', schedule, {signal: abort.signal});
  window.visualViewport?.addEventListener('resize', schedule, {signal: abort.signal});
  document.addEventListener('transitionend', schedule, {capture: true, signal: abort.signal});
  window.addEventListener('hashchange', scan, {signal: abort.signal});
  window.addEventListener('pagehide', () => close(false), {signal: abort.signal});
});
onBeforeUnmount(() => { abort.abort(); observer?.disconnect(); clearTimeout(timer); clearEntries(); });
</script>
