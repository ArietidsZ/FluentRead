<!--
 @file src/features/document-translation/ui/PdfReader.vue
 文件职责：显示保留原版面的可划词 PDF 阅读器，统一原文、双语、译文模式与连续阅读导航。
 主要内容：只挂载当前视口附近五页；页码跳转、适合宽度和 100/125/150% 缩放保留阅读位置；原页使用 PDF.js TextLayer，页内失败可以重试；滚动按动画帧合并，窗口变化和卸载释放观察器、渲染和 Canvas。
 模块边界：组件只组织阅读布局与页面调度，文档由组合根导入、翻译由既有服务提供，划词交互由页面组合根复用统一翻译卡。
-->
<template>
  <section class="pdf-layout-viewer" :aria-label="t('document.pdfReading.readerLabel')" data-document-reader="pdf" :data-segment-count="document.segments.length" :data-fluentread-pdf-title="document.fileName" :data-fluentread-pdf-source-url="sourceUrl || undefined" :data-fluentread-pdf-document-id="documentIdentity">
    <div class="pdf-viewer-toolbar" data-fluentread-pdf-decoration>
      <div class="pdf-page-navigation">
        <button type="button" :aria-label="t('document.pdfReading.previousPage')" :disabled="currentPage <= 1" @click="jumpTo(currentPage - 1)">‹</button>
        <label><span class="pdf-control-label">{{ t('document.pdfReading.pageLabel') }}</span><input v-model="pageInput" type="number" inputmode="numeric" min="1" :max="pages.length" :aria-label="t('document.pdfReading.pageInput')" @input="editPageInput" @change="commitPageInput" @blur="commitPageInput" @keydown.enter.prevent="commitPageInput" /></label>
        <span class="pdf-page-total">/ {{ pages.length }}</span>
        <button type="button" :aria-label="t('document.pdfReading.nextPage')" :disabled="currentPage >= pages.length" @click="jumpTo(currentPage + 1)">›</button>
      </div>
      <span class="pdf-selection-hint">{{ t('document.pdfReading.selectionHint') }}</span>
      <label class="pdf-zoom-control"><span>{{ t('document.pdfReading.zoom') }}</span><select v-model="zoom" :aria-label="t('document.pdfReading.zoomLabel')"><option value="fit">{{ t('document.pdfReading.fitWidth') }}</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option></select></label>
    </div>
    <div ref="viewport" class="pdf-page-scroll" data-pdf-scroll tabindex="0" :aria-label="t('document.pdfReading.continuousPages')" @scroll.passive="scheduleViewport" @keydown="handleViewportKey">
      <div class="pdf-page-list" :style="{ height: `${totalHeight}px` }">
        <article v-for="layout in residentLayouts" :key="layout.page.pageNumber" class="pdf-page-row" :data-page-number="layout.page.pageNumber" :data-render-state="states.get(layout.page.pageNumber)?.status ?? 'pending'" :style="{ top: `${layout.top}px`, height: `${layout.rowHeight}px` }">
          <div class="pdf-page-row-heading" data-fluentread-pdf-decoration><strong>{{ t('document.pdfReading.pageNumber', {page: layout.page.pageNumber}) }}</strong><span v-if="states.get(layout.page.pageNumber)?.status === 'ready'">{{ t(layout.hasTranslation ? 'document.pdfReading.layoutPreserved' : 'document.pdfReading.selectableSource') }}</span></div>
          <div class="pdf-page-stage" :class="{single: !layout.hasTranslation || mode !== 'bilingual', stacked: stackedBilingual}" :style="{'--pdf-page-width': `${layout.width}px`, '--pdf-page-height': `${layout.height}px`}">
            <figure v-if="mode !== 'translated' || !layout.hasTranslation" class="pdf-page-column">
              <figcaption data-fluentread-pdf-decoration>{{ t('document.pdfReading.original') }}</figcaption>
              <div class="pdf-page-frame">
                <div :ref="element => setPageHost(layout.page.pageNumber, 'source', element)" class="pdf-canvas-host" />
                <span v-if="!states.has(layout.page.pageNumber) || states.get(layout.page.pageNumber)?.status === 'loading'" class="pdf-page-loading" data-fluentread-pdf-decoration role="status">{{ t('document.pdfReading.loadingSource') }}</span>
              </div>
            </figure>
            <figure v-if="mode !== 'source' && layout.hasTranslation" class="pdf-page-column translated">
              <figcaption data-fluentread-pdf-decoration>{{ t('document.pdfReading.translated') }} <span>{{ t('document.pdfReading.layoutPreserved') }}</span></figcaption>
              <div class="pdf-page-frame"><div :ref="element => setPageHost(layout.page.pageNumber, 'translated', element)" class="pdf-canvas-host" /><span v-if="!states.has(layout.page.pageNumber) || states.get(layout.page.pageNumber)?.status === 'loading'" class="pdf-page-loading" data-fluentread-pdf-decoration role="status">{{ t('document.pdfReading.loadingTranslation') }}</span></div>
            </figure>
          </div>
          <div v-if="states.get(layout.page.pageNumber)?.status === 'error'" class="pdf-page-error" role="alert"><span>{{ errorFor(layout.page.pageNumber) }}</span><button type="button" @click="scheduler?.retry(layout.index)">{{ t('document.pdfReading.retryPage') }}</button></div>
        </article>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type ComponentPublicInstance} from 'vue';
import {useUiI18n} from '@/src/ui/i18n';
import type {ParsedDocument, PdfDocumentPage} from '@/src/features/document-translation/core/document';
import {createPdfReaderRenderPort, pdfReaderPageHasTranslation, pdfReaderPageKey, pdfReaderPageWindow, PdfReaderScheduler, type PdfReaderMode, type PdfReaderPageState} from '@/src/features/document-translation/ui/pdfReader';

const props = withDefaults(defineProps<{document: ParsedDocument; translations?: readonly string[]; mode: PdfReaderMode; sourceUrl?: string}>(), {translations: () => [], sourceUrl: ''});
const {t} = useUiI18n();
const viewport = ref<HTMLElement>();
const zoom = ref('fit');
const pageInput = ref(1);
const currentPage = ref(1);
const viewportWidth = ref(920);
const states = shallowRef(new Map<number, PdfReaderPageState>());
const residentIndexes = ref<number[]>([]);
const documentIdentity = ref(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
const pages = computed(() => props.document.binary?.kind === 'pdf' ? props.document.binary.pages : []);
const stackedBilingual = computed(() => props.mode === 'bilingual' && viewportWidth.value < 1100);
const scale = computed(() => {
  if (zoom.value !== 'fit') return Number(zoom.value);
  const maxPageWidth = pages.value.reduce((width, page) => Math.max(width, page.width), 1);
  const columns = props.mode === 'bilingual' && !stackedBilingual.value ? 2 : 1;
  return Math.max(1 / maxPageWidth, Math.min(2, (viewportWidth.value - 40 - (columns - 1) * 20) / columns / maxPageWidth));
});
interface PageLayout {page: PdfDocumentPage; index: number; top: number; rowHeight: number; width: number; height: number; hasTranslation: boolean}
const layouts = computed<PageLayout[]>(() => {
  let top = 16;
  return pages.value.map((page, index) => {
    const hasTranslation = props.mode !== 'source' && pdfReaderPageHasTranslation(props.document, page, props.translations);
    const width = Math.max(1, page.width * scale.value);
    const height = Math.max(1, page.height * scale.value);
    const rows = hasTranslation && props.mode === 'bilingual' && stackedBilingual.value ? 2 : 1;
    const rowHeight = 32 + (height + 28) * rows + (rows - 1) * 20;
    const layout = {page, index, top, rowHeight, width, height, hasTranslation};
    top += rowHeight + 24;
    return layout;
  });
});
const totalHeight = computed(() => {const last = layouts.value.at(-1); return last ? last.top + last.rowHeight + 16 : 0;});
const residentLayouts = computed(() => residentIndexes.value.map(index => layouts.value[index]).filter(Boolean).sort((left, right) => left.index - right.index));
const sourceHosts = new Map<number, HTMLElement>();
const translatedHosts = new Map<number, HTMLElement>();
let scheduler: PdfReaderScheduler | undefined;
let observer: ResizeObserver | undefined;
let animationFrame: number | undefined;
let mounted = false;
let closed = false;
let nativePins: number[] = [];
let cardPins: number[] = [];
let pointerPin: number | undefined;
let pageInputEditing = false;

function indexesForRange(range?: Range | null): number[] {
  if (!range || !viewport.value?.contains(range.startContainer) || !viewport.value.contains(range.endContainer)) return [];
  const pageNumber = (node: Node) => Number((node.nodeType === 1 ? node as Element : node.parentElement)?.closest('[data-fluentread-pdf-text]')?.getAttribute('data-pdf-page-number'));
  const first = pages.value.findIndex(page => page.pageNumber === pageNumber(range.startContainer));
  const last = pages.value.findIndex(page => page.pageNumber === pageNumber(range.endContainer));
  if (first < 0 || last < 0) return [];
  const low = Math.min(first, last); const high = Math.max(first, last);
  return Array.from({length: Math.min(5, high - low + 1)}, (_, index) => low + index);
}
function handleSelectionChange(): void {
  const selection = window.getSelection();
  nativePins = indexesForRange(selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0) : undefined);
  scheduleViewport();
}
function handleCardRange(event: Event): void {cardPins = indexesForRange((event as CustomEvent<{range?: Range}>).detail?.range); scheduleViewport();}
function handlePointerDown(event: PointerEvent): void {
  const target = event.target as Element;
  if (!viewport.value?.contains(target)) return;
  const page = Number(target.closest('[data-fluentread-pdf-text]')?.getAttribute('data-pdf-page-number'));
  const index = pages.value.findIndex(entry => entry.pageNumber === page);
  pointerPin = index >= 0 ? index : undefined;
}
function handlePointerUp(): void {pointerPin = undefined; handleSelectionChange();}

function pageIndexAt(offset: number, list = layouts.value): number {
  let low = 0;
  let high = list.length - 1;
  while (low < high) {const middle = Math.floor((low + high + 1) / 2); if (list[middle].top <= offset) low = middle; else high = middle - 1;}
  return low;
}
function readAnchor(list = layouts.value): {index: number; fraction: number} {
  const offset = viewport.value?.scrollTop ?? 0;
  const index = pageIndexAt(offset, list);
  const layout = list[index];
  return {index, fraction: layout ? Math.max(0, Math.min(1, (offset - layout.top) / layout.rowHeight)) : 0};
}
function mountPage(pageNumber: number): void {
  const state = states.value.get(pageNumber);
  if (state?.status !== 'ready') return;
  const source = sourceHosts.get(pageNumber);
  const translated = translatedHosts.get(pageNumber);
  if (source && state.output.sourceCanvas && source.firstChild !== state.output.sourceCanvas) source.replaceChildren(state.output.sourceCanvas, ...(state.output.sourceText ? [state.output.sourceText] : []));
  if (translated && state.output.translatedCanvas && translated.firstChild !== state.output.translatedCanvas) translated.replaceChildren(state.output.translatedCanvas);
}
function setPageHost(pageNumber: number, kind: 'source' | 'translated', element: Element | ComponentPublicInstance | null): void {
  const hosts = kind === 'source' ? sourceHosts : translatedHosts;
  if (!element) {hosts.delete(pageNumber); return;}
  hosts.set(pageNumber, element as HTMLElement);
  mountPage(pageNumber);
}
function updateViewport(): void {
  animationFrame = undefined;
  if (!mounted || closed || pages.value.length === 0) return;
  const scroll = viewport.value;
  const top = scroll?.scrollTop ?? 0;
  const bottom = top + (scroll?.clientHeight || 720);
  const index = pageIndexAt(top + Math.min(80, (scroll?.clientHeight || 720) / 4));
  const lastIndex = pageIndexAt(bottom);
  const visible = Array.from({length: Math.min(5, Math.max(1, lastIndex - index + 1))}, (_, at) => index + at);
  residentIndexes.value = [...new Set([...visible, ...(pointerPin === undefined ? [] : [pointerPin]), ...cardPins, ...nativePins, ...pdfReaderPageWindow(pages.value.length, index, visible)])].slice(0, 5);
  currentPage.value = index + 1;
  if (!pageInputEditing) pageInput.value = currentPage.value;
  scheduler?.update(residentIndexes.value, pageIndex => ({
    scale: scale.value, mode: props.mode, translations: props.translations,
    key: pdfReaderPageKey(pages.value[pageIndex], scale.value, props.mode, props.translations),
  }));
}
function scheduleViewport(): void {
  if (animationFrame !== undefined || closed) return;
  animationFrame = window.requestAnimationFrame(updateViewport);
}
function jumpTo(page: number): void {
  const number = Math.max(1, Math.min(pages.value.length, Math.round(Number.isFinite(page) ? page : currentPage.value)));
  pageInputEditing = false;
  if (viewport.value) viewport.value.scrollTop = layouts.value[number - 1]?.top ?? 0;
  updateViewport();
  pageInput.value = currentPage.value;
}
function editPageInput(): void {pageInputEditing = true;}
function commitPageInput(): void {jumpTo(Number(pageInput.value));}
function handleViewportKey(event: KeyboardEvent): void {
  if (event.target !== viewport.value || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'PageDown') {event.preventDefault(); jumpTo(currentPage.value + 1);}
  else if (event.key === 'PageUp') {event.preventDefault(); jumpTo(currentPage.value - 1);}
  else if (event.key === 'Home') {event.preventDefault(); jumpTo(1);}
  else if (event.key === 'End') {event.preventDefault(); jumpTo(pages.value.length);}
}
function errorFor(pageNumber: number): string {const state = states.value.get(pageNumber); return state?.status === 'error' ? state.message : '';}
function createScheduler(): void {
  scheduler?.dispose();
  states.value = new Map();
  sourceHosts.clear();
  translatedHosts.clear();
  nativePins = []; cardPins = []; pointerPin = undefined; pageInputEditing = false;
  documentIdentity.value = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  scheduler = new PdfReaderScheduler(pages.value, createPdfReaderRenderPort(props.document), (pageNumber, state) => {
    if (closed) return;
    const next = new Map(states.value);
    if (state) next.set(pageNumber, state); else next.delete(pageNumber);
    states.value = next;
    if (state?.status === 'ready') {mountPage(pageNumber); void nextTick(() => {if (!closed) mountPage(pageNumber);});}
  });
  if (viewport.value) viewport.value.scrollTop = 0;
  currentPage.value = pageInput.value = 1;
  updateViewport();
}
watch(() => props.document, () => {if (mounted) createScheduler();}, {flush: 'post'});
// 使用旧布局读取页内位置；缩放和流式译文改变页面高度时，仍停留在同一段原页。
watch(layouts, async (_next, previous) => {
  if (!mounted || closed) return;
  const anchor = readAnchor(previous);
  await nextTick();
  if (closed) return;
  if (anchor && viewport.value) {const layout = layouts.value[anchor.index]; if (layout) viewport.value.scrollTop = layout.top + layout.rowHeight * anchor.fraction;}
  updateViewport();
}, {flush: 'post'});
onMounted(() => {
  mounted = true;
  viewportWidth.value = viewport.value?.clientWidth || 920;
  createScheduler();
  globalThis.document.addEventListener('selectionchange', handleSelectionChange);
  globalThis.document.addEventListener('pointerdown', handlePointerDown, true);
  globalThis.document.addEventListener('pointerup', handlePointerUp, true);
  globalThis.document.body.addEventListener('fluentread-pdf-selection-range-change', handleCardRange);
  if (typeof ResizeObserver !== 'undefined' && viewport.value) {observer = new ResizeObserver(() => {viewportWidth.value = viewport.value?.clientWidth || 920;}); observer.observe(viewport.value);}
});
onBeforeUnmount(() => {
  closed = true;
  observer?.disconnect();
  globalThis.document.removeEventListener('selectionchange', handleSelectionChange);
  globalThis.document.removeEventListener('pointerdown', handlePointerDown, true);
  globalThis.document.removeEventListener('pointerup', handlePointerUp, true);
  globalThis.document.body.removeEventListener('fluentread-pdf-selection-range-change', handleCardRange);
  if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
  scheduler?.dispose();
  sourceHosts.clear();
  translatedHosts.clear();
});
</script>

<style scoped>
.pdf-layout-viewer {width: 100%; height: 100%; min-height: 0; flex: 1; min-width: 0; display: flex; flex-direction: column; color: var(--ink);}
.pdf-viewer-toolbar {display: flex; align-items: center; gap: 16px; padding: 12px 16px; flex-wrap: wrap; background: var(--surface); border-bottom: 1px solid var(--line);}
.pdf-page-navigation, .pdf-page-navigation label, .pdf-zoom-control {display: flex; align-items: center; gap: 8px;}
.pdf-page-navigation button {width: 30px; height: 30px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: inherit; font-size: 20px; cursor: pointer;}
.pdf-page-navigation button:disabled {opacity: .35; cursor: default;}
.pdf-page-navigation input {width: 56px; padding: 5px; border: 1px solid var(--line); border-radius: 6px; text-align: center; color: inherit; background: transparent;}
.pdf-control-label, .pdf-page-total, .pdf-zoom-control {font-size: 12px;}
.pdf-selection-hint {flex: 1; color: var(--muted); font-size: 12px;}
.pdf-zoom-control select {max-width: 110px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: inherit;}
.pdf-page-scroll {flex: 1; height: 0; min-height: 0; overflow: auto; background: var(--surface-soft); overscroll-behavior: contain; scrollbar-gutter: stable; overflow-anchor: none;}
.pdf-page-list {position: relative; min-width: 100%;}
.pdf-page-row {position: absolute; left: 0; width: 100%; padding: 0 20px; box-sizing: border-box;}
.pdf-page-row-heading {height: 32px; display: flex; justify-content: center; align-items: flex-start; gap: 12px; font-size: 12px; color: var(--muted); user-select: none;}
.pdf-page-row-heading strong {font-weight: 600;}
.pdf-page-stage {display: flex; gap: 20px; width: max-content; min-width: 100%; justify-content: center;}
.pdf-page-stage.stacked:not(.single) {flex-direction: column; align-items: center;}
.pdf-page-column {margin: 0; width: var(--pdf-page-width); flex: none;}
.pdf-page-column figcaption {height: 28px; display: flex; align-items: flex-start; justify-content: space-between; font-size: 11px; color: var(--muted); user-select: none;}
.pdf-page-column figcaption span {font-size: 10px;}
.pdf-page-frame {position: relative; width: var(--pdf-page-width); height: var(--pdf-page-height); background: #fff; box-shadow: 0 2px 10px #1d352a12;}
.pdf-canvas-host {position: absolute; inset: 0;}
.pdf-canvas-host :deep(canvas) {display: block; max-width: none;}
.pdf-page-loading {position: absolute; inset: 0; display: flex; justify-content: center; align-items: center; color: var(--muted); font-size: 12px; pointer-events: none;}
.pdf-page-error {position: absolute; inset: 50px 20px auto; max-width: 520px; margin: auto; padding: 16px; background: #fff7f5; border: 1px solid #efc9c1; border-radius: 8px; display: flex; flex-direction: column; gap: 12px; font-size: 12px;}
.pdf-page-error button {align-self: center; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer;}
/* 锁定 PDF.js 4.10.38 TextLayer 的必需几何规则，限定在阅读器内，避免导入整个 viewer 的全局样式。 */
.pdf-canvas-host :deep(.fluentread-pdf-text-layer) {position: absolute; text-align: initial; inset: 0; overflow: clip; line-height: 1; text-size-adjust: none; forced-color-adjust: none; transform-origin: 0 0; caret-color: transparent; z-index: 1; user-select: text;}
.pdf-canvas-host :deep(.fluentread-pdf-text-layer :is(span, br)) {color: transparent; position: absolute; white-space: pre; cursor: text; transform-origin: 0 0;}
.pdf-canvas-host :deep(.fluentread-pdf-text-layer > :not(.markedContent)), .pdf-canvas-host :deep(.fluentread-pdf-text-layer .markedContent span:not(.markedContent)) {z-index: 1;}
.pdf-canvas-host :deep(.fluentread-pdf-text-layer span.markedContent) {top: 0; height: 0;}
.pdf-canvas-host :deep(.fluentread-pdf-text-layer span[role='img']) {user-select: none; cursor: default;}
.pdf-canvas-host :deep(.fluentread-pdf-text-layer[data-main-rotation='90']) {transform: rotate(90deg) translateY(-100%);}
.pdf-canvas-host :deep(.fluentread-pdf-text-layer[data-main-rotation='180']) {transform: rotate(180deg) translate(-100%, -100%);}
.pdf-canvas-host :deep(.fluentread-pdf-text-layer[data-main-rotation='270']) {transform: rotate(270deg) translateX(-100%);}
.pdf-canvas-host :deep(.fluentread-pdf-text-layer ::selection) {background: color-mix(in srgb, var(--brand), transparent 65%);}
.pdf-canvas-host :deep(.fluentread-pdf-text-layer br::selection) {background: transparent;}
@media (max-width: 600px) {.pdf-viewer-toolbar {gap: 10px; padding: 10px;} .pdf-selection-hint {order: 3; flex-basis: 100%;} .pdf-zoom-control {margin-left: auto;} .pdf-control-label {display: none;} }
</style>
