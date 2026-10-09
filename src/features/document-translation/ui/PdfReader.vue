<!--
 @file src/features/document-translation/ui/PdfReader.vue
 文件职责：显示可划词 PDF 原页和完整可复制的清晰译文，并保留原版面预览的可选入口。
 主要内容：清晰阅读按统一计划显示完整段落与公式图表原图，不压缩或裁剪译文；动态测量页面高度并保留阅读位置，只挂载附近五页；源 Canvas 与译文更新独立，页码跳转、缩放、重试和卸载释放页面资源；显式开启的信息高亮只评分真实可选文字，配置、页面和文档失效时取消旧绘制。
 模块边界：组件只组织阅读布局与页面调度，文档由组合根导入、翻译由既有服务提供，划词交互由页面组合根复用统一翻译卡。
-->
<template>
  <section class="pdf-layout-viewer" :aria-label="t('document.pdfReading.readerLabel')" data-document-reader="pdf" :data-pdf-presentation="presentation" :data-segment-count="document.segments.length" :data-fluentread-pdf-title="document.fileName" :data-fluentread-pdf-source-url="sourceUrl || undefined" :data-fluentread-pdf-document-id="documentIdentity">
    <div class="pdf-viewer-toolbar" data-fluentread-pdf-decoration>
      <div class="pdf-page-navigation">
        <button type="button" :aria-label="t('document.pdfReading.previousPage')" :disabled="currentPage <= 1" @click="jumpTo(currentPage - 1)">‹</button>
        <label><span class="pdf-control-label">{{ t('document.pdfReading.pageLabel') }}</span><input v-model="pageInput" type="number" inputmode="numeric" min="1" :max="pages.length" :aria-label="t('document.pdfReading.pageInput')" @input="editPageInput" @change="commitPageInput" @blur="commitPageInput" @keydown.enter.prevent="commitPageInput" /></label>
        <span class="pdf-page-total">/ {{ pages.length }}</span>
        <button type="button" :aria-label="t('document.pdfReading.nextPage')" :disabled="currentPage >= pages.length" @click="jumpTo(currentPage + 1)">›</button>
      </div>
      <span class="pdf-selection-hint">{{ t('document.pdfReading.selectionHint') }}</span>
      <button v-if="informationHighlight" class="pdf-information-highlight" type="button" :aria-pressed="informationState.enabled" :disabled="!informationHighlight.available" @click="informationController?.setEnabled(!informationState.enabled)">{{ t('informationHighlight.title') }}</button>
      <span v-if="informationState.enabled" class="pdf-information-status" role="status" :title="t('informationHighlight.progress', {paragraphs: informationState.processedParagraphs, spans: informationState.highlightedSpans})">{{ t(`informationHighlight.phase.${informationState.phase}`) }} <button v-if="informationState.phase === 'error'" type="button" @click="informationController?.retry()">{{ t('informationHighlight.retry') }}</button></span>
      <label class="pdf-presentation-control"><span>{{ t('document.pdfReading.presentationLabel') }}</span><select v-model="presentation" :aria-label="t('document.pdfReading.presentationLabel')" @change="emit('update:presentation', presentation)"><option value="readable">{{ t('document.pdfReading.readablePresentation') }}</option><option value="layout">{{ t('document.pdfReading.layoutPresentation') }}</option></select></label>
      <label class="pdf-zoom-control"><span>{{ t('document.pdfReading.zoom') }}</span><select v-model="zoom" :aria-label="t('document.pdfReading.zoomLabel')"><option value="fit">{{ t('document.pdfReading.fitWidth') }}</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option></select></label>
    </div>
    <div ref="viewport" class="pdf-page-scroll" data-pdf-scroll tabindex="0" :aria-label="t('document.pdfReading.continuousPages')" @scroll.passive="scheduleViewport" @keydown="handleViewportKey">
      <div class="pdf-page-list" :style="{ height: `${totalHeight}px` }">
        <article v-for="layout in residentLayouts" :key="layout.page.pageNumber" class="pdf-page-row" :data-page-number="layout.page.pageNumber" :data-render-state="states.get(layout.page.pageNumber)?.status ?? 'pending'" :style="{ top: `${layout.top}px`, height: `${layout.rowHeight}px` }">
          <div class="pdf-page-row-heading" data-fluentread-pdf-decoration><strong>{{ t('document.pdfReading.pageNumber', {page: layout.page.pageNumber}) }}</strong><span v-if="states.get(layout.page.pageNumber)?.status === 'ready'">{{ t(mode !== 'source' ? presentation === 'readable' ? 'document.pdfReading.completeReadableText' : 'document.pdfReading.layoutWithFullText' : 'document.pdfReading.selectableSource') }}</span></div>
          <div class="pdf-page-stage" :class="{single: mode !== 'bilingual' || (presentation === 'layout' && !layout.hasTranslation), stacked: stackedBilingual}" :style="{'--pdf-page-width': `${layout.width}px`, '--pdf-page-height': `${layout.height}px`}">
            <figure v-if="mode !== 'translated' || (presentation === 'layout' && !layout.hasTranslation)" class="pdf-page-column">
              <figcaption data-fluentread-pdf-decoration>{{ t('document.pdfReading.original') }}</figcaption>
              <div class="pdf-page-frame">
                <div :ref="element => setPageHost(layout.page.pageNumber, 'source', element)" class="pdf-canvas-host" />
                <span v-if="!states.has(layout.page.pageNumber) || states.get(layout.page.pageNumber)?.status === 'loading'" class="pdf-page-loading" data-fluentread-pdf-decoration role="status">{{ t('document.pdfReading.loadingSource') }}</span>
              </div>
            </figure>
            <figure v-if="mode !== 'source' && (presentation === 'readable' || layout.hasTranslation)" class="pdf-page-column translated">
              <figcaption data-fluentread-pdf-decoration>{{ t('document.pdfReading.translated') }} <span>{{ t(presentation === 'readable' ? 'document.pdfReading.completeReadableText' : 'document.pdfReading.layoutWithFullText') }}</span></figcaption>
              <article v-if="presentation === 'readable'" :ref="element => setReadingHost(layout.page.pageNumber, element)" class="pdf-reading-sheet" :data-pdf-reading-page="layout.page.pageNumber" :style="{'--pdf-reading-font-size': `${readingFontSize}px`}">
                <template v-for="entry in readingPlans.get(layout.page.pageNumber)?.entries" :key="entry.id">
                  <figure v-if="entry.kind === 'region'" class="pdf-reading-region" :data-pdf-region-id="entry.id" :data-pdf-region-kind="entry.role" :data-pdf-source-rect="JSON.stringify(entry.sourceRect)">
                    <div :ref="element => setRegionHost(layout.page.pageNumber, entry.id, element)" class="pdf-region-canvas" :style="{width: `${entry.sourceRect.width * (entry.role === 'figure' ? 2 : 1.5) * readingFontSize / 16}px`, aspectRatio: `${entry.sourceRect.width} / ${entry.sourceRect.height}`}" :aria-label="t('document.pdfReading.preservedRegion')" />
                    <figcaption data-fluentread-pdf-decoration>{{ t('document.pdfReading.preservedRegion') }}</figcaption>
                  </figure>
                  <p v-else class="pdf-reading-paragraph" :class="paragraphClasses(entry)" :data-pdf-segment-index="entry.segmentIndex" :data-pdf-source-text="entry.source" :data-pdf-source-id="entry.id" :data-pdf-role="entry.role" data-i18n-ignore>{{ entry.text }}</p>
                </template>
              </article>
              <div v-else class="pdf-page-frame"><div :ref="element => setPageHost(layout.page.pageNumber, 'translated', element)" class="pdf-canvas-host" /><span v-if="!states.has(layout.page.pageNumber) || states.get(layout.page.pageNumber)?.status === 'loading'" class="pdf-page-loading" data-fluentread-pdf-decoration role="status">{{ t('document.pdfReading.loadingTranslation') }}</span></div>
              <article v-if="presentation === 'layout'" :ref="element => setReadingHost(layout.page.pageNumber, element)" class="pdf-reading-sheet pdf-reading-continuation" :data-pdf-reading-page="layout.page.pageNumber" :style="{'--pdf-reading-font-size': `${readingFontSize}px`}">
                <p class="pdf-reading-continuation-label" data-fluentread-pdf-decoration>{{ t('document.pdfReading.completeReadableText') }}</p>
                <template v-for="entry in readingPlans.get(layout.page.pageNumber)?.entries" :key="entry.id"><p v-if="entry.kind === 'text'" class="pdf-reading-paragraph" :class="paragraphClasses(entry)" :data-pdf-segment-index="entry.segmentIndex" :data-pdf-source-text="entry.source" :data-pdf-source-id="entry.id" :data-pdf-role="entry.role" data-i18n-ignore>{{ entry.text }}</p></template>
              </article>
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
import {buildPdfReadingPlan, type PdfReadingPlan, type PdfReadingPresentation, type PdfReadingTextEntry} from '@/src/features/document-translation/core/pdfReadingPlan';
import {createPdfReaderRenderPort, pdfReaderPageHasTranslation, pdfReaderPageKey, pdfReaderPageWindow, PdfReaderScheduler, type PdfReaderMode, type PdfReaderPageState} from '@/src/features/document-translation/ui/pdfReader';
import {installInformationHighlight, type InformationHighlightController} from '@/src/features/information-highlight/public';
import {DEFAULT_INFORMATION_HIGHLIGHT_PREFERENCES, type InformationHighlightPreferences} from '@/src/core/config/informationHighlight';
import type {InformationHighlightResult, InformationHighlightState} from '@/src/features/information-highlight/protocol';

const props = withDefaults(defineProps<{document: ParsedDocument; translations?: readonly string[]; mode: PdfReaderMode; sourceUrl?: string; presentation?: PdfReadingPresentation; informationHighlight?: {preferences: InformationHighlightPreferences; scoreLocal(text: string, signal: AbortSignal): Promise<InformationHighlightResult>; available: boolean}}>(), {translations: () => [], sourceUrl: '', presentation: 'readable'});
const emit = defineEmits<{ 'update:presentation': [value: PdfReadingPresentation] }>();
function paragraphClasses(entry: PdfReadingTextEntry): Record<string, boolean> {
  return {'pdf-reading-heading': entry.role === 'heading', 'pdf-reading-caption': entry.role === 'caption', 'pdf-reading-metadata': entry.role === 'metadata', 'pdf-reading-footer': entry.role === 'footer', 'pdf-reading-untranslated': !entry.translated};
}
const presentation = ref<PdfReadingPresentation>(props.presentation);
watch(() => props.presentation, value => {presentation.value = value;});
const {t} = useUiI18n();
const viewport = ref<HTMLElement>();
let informationController: InformationHighlightController | undefined, informationWanted = false;
const informationState = shallowRef<InformationHighlightState>({enabled: false, phase: 'idle', sessionId: '0', processedParagraphs: 0, queuedParagraphs: 0, highlightedSpans: 0, mode: props.informationHighlight?.preferences.mode ?? DEFAULT_INFORMATION_HIGHLIGHT_PREFERENCES.mode});
function syncInformationHighlight(): void {
  const settings = props.informationHighlight;
  if (!settings || !viewport.value) {informationController?.dispose(); informationController = undefined; informationWanted = false; return;}
  informationController ??= installInformationHighlight(viewport.value.ownerDocument, settings.preferences, {
    scope: viewport.value, isCurrent: () => !closed && Boolean(props.informationHighlight?.available),
    scoreLocal: (text, signal) => props.informationHighlight!.scoreLocal(text, signal), changed: state => {informationState.value = state;},
  });
  informationController.updatePreferences(settings.preferences);
  // 设置中的开关决定文档打开时的初始状态；工具栏按钮只临时切换当前文档。
  const wanted = settings.available && settings.preferences.enabled;
  if (!settings.available) informationController.setEnabled(false);
  else if (wanted !== informationWanted) informationController.setEnabled(wanted);
  informationWanted = wanted;
}
watch(() => [props.informationHighlight?.available, props.informationHighlight?.preferences.enabled, props.informationHighlight?.preferences.mode, props.informationHighlight?.preferences.density, props.informationHighlight?.preferences.color, props.informationHighlight?.preferences.style, props.informationHighlight?.preferences.intensity], syncInformationHighlight, {flush: 'post'});
const zoom = ref('fit');
const pageInput = ref(1);
const currentPage = ref(1);
const viewportWidth = ref(920);
const states = shallowRef(new Map<number, PdfReaderPageState>());
const residentIndexes = ref<number[]>([]);
const documentIdentity = ref(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
const pages = computed(() => props.document.binary?.kind === 'pdf' ? props.document.binary.pages : []);
const readingFontSize = computed(() => 16 * (zoom.value === 'fit' ? 1 : Number(zoom.value)));
const readingHeights = shallowRef(new Map<number, number>());
const readingPlans = computed(() => new Map<number, PdfReadingPlan>(residentIndexes.value.flatMap(index => {
  const page = pages.value[index];
  return page ? [[page.pageNumber, buildPdfReadingPlan(props.document, page, props.translations)] as [number, PdfReadingPlan]] : [];
})));
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
    const readable = presentation.value === 'readable' && props.mode !== 'source';
    const rows = (readable || hasTranslation) && props.mode === 'bilingual' && stackedBilingual.value ? 2 : 1;
    const readingHeight = readingHeights.value.get(page.pageNumber) ?? (readable ? height : 0);
    const translatedHeight = readable ? readingHeight : height + (hasTranslation ? readingHeight + 16 : 0);
    const contentHeight = props.mode === 'translated' ? translatedHeight : Math.max(height, translatedHeight);
    const rowHeight = 32 + (rows === 2 ? height + translatedHeight + 56 + 20 : contentHeight + 28);
    const layout = {page, index, top, rowHeight, width, height, hasTranslation};
    top += rowHeight + 24;
    return layout;
  });
});
const totalHeight = computed(() => {const last = layouts.value.at(-1); return last ? last.top + last.rowHeight + 16 : 0;});
const residentLayouts = computed(() => residentIndexes.value.map(index => layouts.value[index]).filter(Boolean).sort((left, right) => left.index - right.index));
const sourceHosts = new Map<number, HTMLElement>();
const translatedHosts = new Map<number, HTMLElement>();
const readingHosts = new Map<number, HTMLElement>();
const regionHosts = new Map<string, HTMLElement>();
let scheduler: PdfReaderScheduler | undefined;
let observer: ResizeObserver | undefined;
let animationFrame: number | undefined;
let mounted = false;
let closed = false;
let nativePins: number[] = [];
let cardPins: number[] = [];
let pointerPin: number | undefined;
let pageInputEditing = false;
interface ReadingAnchor {id: string; pageNumber: number; offset: number}
let pendingReadingAnchor: ReadingAnchor | undefined;
let lastReadingAnchor: ReadingAnchor | undefined;
let readingUpdateGeneration = 0;
let layoutUpdateGeneration = 0;

function captureReadingAnchor(): ReadingAnchor | undefined {
  const scroll = viewport.value;
  if (!scroll || typeof scroll.getBoundingClientRect !== 'function') return;
  const top = scroll.getBoundingClientRect().top, bottom = top + scroll.clientHeight;
  let partial: ReadingAnchor | undefined;
  for (const element of scroll.querySelectorAll<HTMLElement>('[data-pdf-source-id]')) {
    if (typeof element.getBoundingClientRect !== 'function') continue;
    const rect = element.getBoundingClientRect();
    if (rect.bottom <= top || rect.top >= bottom) continue;
    const anchor = {id: element.getAttribute('data-pdf-source-id')!, pageNumber: Number(element.closest('[data-pdf-reading-page]')!.getAttribute('data-pdf-reading-page')), offset: rect.top - top};
    if (rect.top >= top) return anchor;
    partial ??= anchor;
  }
  return partial;
}
function restoreReadingAnchor(anchor: ReadingAnchor): boolean {
  const scroll = viewport.value, host = readingHosts.get(anchor.pageNumber);
  if (!scroll || !host || typeof scroll.getBoundingClientRect !== 'function') return false;
  const element = Array.from(host.querySelectorAll<HTMLElement>('[data-pdf-source-id]')).find(entry => entry.getAttribute('data-pdf-source-id') === anchor.id);
  if (!element || typeof element.getBoundingClientRect !== 'function') return false;
  scroll.scrollTop += element.getBoundingClientRect().top - scroll.getBoundingClientRect().top - anchor.offset;
  return true;
}
function measureReadingHeights(targets: Iterable<Element> = readingHosts.values()): boolean {
  const next = new Map(readingHeights.value);
  let changed = false;
  for (const target of targets) {
    const page = Number(target.getAttribute('data-pdf-reading-page'));
    if (!readingHosts.has(page) || typeof target.getBoundingClientRect !== 'function') continue;
    const height = target.getBoundingClientRect().height;
    if (height > 0 && Math.abs((next.get(page) ?? 0) - height) > 1) {next.set(page, height); changed = true;}
  }
  if (changed) {
    if (!pendingReadingAnchor && props.mode !== 'source') pendingReadingAnchor = lastReadingAnchor;
    readingHeights.value = next;
  }
  return changed;
}

function indexesForRange(range?: Range | null): number[] {
  if (!range || !viewport.value?.contains(range.startContainer) || !viewport.value.contains(range.endContainer)) return [];
  const pageNumber = (node: Node) => {const layer = (node.nodeType === 1 ? node as Element : node.parentElement)?.closest('[data-fluentread-pdf-text], [data-pdf-reading-page]'); return Number(layer?.getAttribute('data-pdf-page-number') ?? layer?.getAttribute('data-pdf-reading-page'));};
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
  const layer = target.closest('[data-fluentread-pdf-text], [data-pdf-reading-page]');
  const page = Number(layer?.getAttribute('data-pdf-page-number') ?? layer?.getAttribute('data-pdf-reading-page'));
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
  // 与页码计数器使用同一可见点；末页不足一屏时，scrollTop 本身可能还位于前页尾部。
  const index = pageIndexAt(offset + Math.min(80, (viewport.value?.clientHeight || 720) / 4), list);
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
  for (const [id, canvas] of state.output.regions ?? []) {
    const host = regionHosts.get(id);
    if (host && host.firstChild !== canvas) {host.replaceChildren(canvas); canvas.setAttribute('aria-label', t('document.pdfReading.preservedRegion'));}
  }
}
function setReadingHost(pageNumber: number, element: Element | ComponentPublicInstance | null): void {
  const previous = readingHosts.get(pageNumber);
  if (previous && previous !== element) observer?.unobserve(previous);
  if (!element) {readingHosts.delete(pageNumber); return;}
  readingHosts.set(pageNumber, element as HTMLElement);
  observer?.observe(element as HTMLElement);
}
function setRegionHost(pageNumber: number, id: string, element: Element | ComponentPublicInstance | null): void {
  if (!element) {regionHosts.delete(id); return;}
  regionHosts.set(id, element as HTMLElement);
  mountPage(pageNumber);
}
function setPageHost(pageNumber: number, kind: 'source' | 'translated', element: Element | ComponentPublicInstance | null): void {
  const hosts = kind === 'source' ? sourceHosts : translatedHosts;
  if (!element) {hosts.delete(pageNumber); return;}
  hosts.set(pageNumber, element as HTMLElement);
  mountPage(pageNumber);
}
function updateViewport(): void {
  if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
  animationFrame = undefined;
  if (!mounted || closed || pages.value.length === 0) return;
  const scroll = viewport.value;
  const top = scroll?.scrollTop ?? 0;
  const bottom = top + (scroll?.clientHeight || 720);
  const index = pageIndexAt(top + Math.min(80, (scroll?.clientHeight || 720) / 4));
  const lastIndex = pageIndexAt(bottom);
  const visible = Array.from({length: Math.min(5, Math.max(1, lastIndex - index + 1))}, (_, at) => index + at);
  const nextIndexes = [...new Set([...visible, ...(pointerPin === undefined ? [] : [pointerPin]), ...cardPins, ...nativePins, ...pdfReaderPageWindow(pages.value.length, index, visible)])].slice(0, 5);
  if (nextIndexes.length !== residentIndexes.value.length || nextIndexes.some((entry, at) => entry !== residentIndexes.value[at])) residentIndexes.value = nextIndexes;
  currentPage.value = index + 1;
  if (!pageInputEditing) pageInput.value = currentPage.value;
  scheduler?.update(residentIndexes.value, pageIndex => ({
    scale: scale.value, mode: props.mode, translations: props.translations, presentation: presentation.value,
    key: pdfReaderPageKey(pages.value[pageIndex], scale.value, props.mode, props.translations, presentation.value),
  }));
  lastReadingAnchor = captureReadingAnchor();
}
function scheduleViewport(): void {
  if (animationFrame !== undefined || closed) return;
  animationFrame = window.requestAnimationFrame(updateViewport);
}
function jumpTo(page: number): void {
  pendingReadingAnchor = lastReadingAnchor = undefined;
  readingUpdateGeneration += 1;
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
  readingHosts.clear(); regionHosts.clear(); readingHeights.value = new Map();
  nativePins = []; cardPins = []; pointerPin = undefined; pageInputEditing = false;
  pendingReadingAnchor = lastReadingAnchor = undefined; readingUpdateGeneration += 1;
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
watch(() => props.document, () => {informationController?.setEnabled(false); informationWanted = false; if (mounted) {createScheduler(); syncInformationHighlight();}}, {flush: 'post'});
watch([zoom, presentation, () => props.mode], () => informationController?.refresh(), {flush: 'pre'});
watch([presentation, () => props.translations, () => props.mode], () => {if (mounted) scheduleViewport();}, {flush: 'post'});
// 在 DOM 更新前记录可见段落；新译文或换行只移动其前后的内容，不能把同页阅读点按比例移走。
watch([readingPlans, zoom, presentation, viewportWidth, () => props.mode], () => {
  if (!mounted || closed) return;
  pendingReadingAnchor = props.mode === 'source' ? undefined : captureReadingAnchor() ?? lastReadingAnchor;
  const generation = ++readingUpdateGeneration;
  void nextTick(() => {
    if (closed || generation !== readingUpdateGeneration) return;
    if (!measureReadingHeights()) {
      if (pendingReadingAnchor) restoreReadingAnchor(pendingReadingAnchor);
      pendingReadingAnchor = undefined;
      scheduleViewport();
    }
  });
}, {flush: 'pre'});
// 必须在 DOM 改变总高度前读取旧页；否则切到较短的阅读模式时，浏览器已把 scrollTop 限制到新底部。
watch(layouts, async (_next, previous) => {
  if (!mounted || closed) return;
  const generation = ++layoutUpdateGeneration, identity = documentIdentity.value;
  const anchor = readAnchor(previous);
  const readingAnchor = props.mode === 'source' ? undefined : pendingReadingAnchor ?? lastReadingAnchor;
  await nextTick();
  if (closed || generation !== layoutUpdateGeneration || identity !== documentIdentity.value) return;
  if (!(readingAnchor && restoreReadingAnchor(readingAnchor)) && viewport.value) {const layout = layouts.value[anchor.index]; if (layout) viewport.value.scrollTop = layout.top + layout.rowHeight * anchor.fraction;}
  if (pendingReadingAnchor === readingAnchor) pendingReadingAnchor = undefined;
  updateViewport();
}, {flush: 'pre'});
onMounted(() => {
  mounted = true;
  syncInformationHighlight();
  viewportWidth.value = viewport.value?.clientWidth || 920;
  createScheduler();
  globalThis.document.addEventListener('selectionchange', handleSelectionChange);
  globalThis.document.addEventListener('pointerdown', handlePointerDown, true);
  globalThis.document.addEventListener('pointerup', handlePointerUp, true);
  globalThis.document.body.addEventListener('fluentread-pdf-selection-range-change', handleCardRange);
  if (typeof ResizeObserver !== 'undefined' && viewport.value) {
    observer = new ResizeObserver(entries => {
      if (!pendingReadingAnchor && props.mode !== 'source') pendingReadingAnchor = lastReadingAnchor;
      viewportWidth.value = viewport.value?.clientWidth || 920;
      measureReadingHeights(entries.map(entry => entry.target));
    });
    observer.observe(viewport.value);
    readingHosts.forEach(host => observer!.observe(host));
  }
});
onBeforeUnmount(() => {
  closed = true;
  informationController?.dispose(); informationController = undefined;
  readingUpdateGeneration += 1;
  observer?.disconnect();
  globalThis.document.removeEventListener('selectionchange', handleSelectionChange);
  globalThis.document.removeEventListener('pointerdown', handlePointerDown, true);
  globalThis.document.removeEventListener('pointerup', handlePointerUp, true);
  globalThis.document.body.removeEventListener('fluentread-pdf-selection-range-change', handleCardRange);
  if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
  scheduler?.dispose();
  sourceHosts.clear();
  translatedHosts.clear();
  readingHosts.clear(); regionHosts.clear();
});
</script>

<style scoped>
.pdf-layout-viewer {width: 100%; height: 100%; min-height: 0; flex: 1; min-width: 0; display: flex; flex-direction: column; color: var(--ink);}
.pdf-viewer-toolbar {display: flex; align-items: center; gap: 16px; padding: 12px 16px; flex-wrap: wrap; background: var(--surface); border-bottom: 1px solid var(--line);}
.pdf-page-navigation, .pdf-page-navigation label, .pdf-zoom-control, .pdf-presentation-control {display: flex; align-items: center; gap: 8px;}
.pdf-page-navigation button {width: 30px; height: 30px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: inherit; font-size: 20px; cursor: pointer;}
.pdf-page-navigation button:disabled {opacity: .35; cursor: default;}
.pdf-page-navigation input {width: 56px; padding: 5px; border: 1px solid var(--line); border-radius: 6px; text-align: center; color: inherit; background: transparent;}
.pdf-control-label, .pdf-page-total, .pdf-zoom-control, .pdf-presentation-control {font-size: 12px;}
.pdf-selection-hint {flex: 1; color: var(--muted); font-size: 12px;}
.pdf-information-highlight, .pdf-information-status button {padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: inherit; font-size: 12px; cursor: pointer;}
.pdf-information-highlight[aria-pressed="true"] {border-color: var(--brand); color: var(--brand-strong); background: var(--brand-soft);}
.pdf-information-highlight:focus-visible, .pdf-information-status button:focus-visible {outline: 2px solid var(--brand); outline-offset: 2px;}
.pdf-information-highlight:disabled {opacity: .4; cursor: default;}
.pdf-information-status {font-size: 12px; color: var(--muted);}
.pdf-zoom-control select, .pdf-presentation-control select {max-width: 120px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: inherit;}
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
.pdf-reading-sheet {padding: 32px; box-sizing: border-box; width: 100%; background: var(--surface); color: var(--ink); box-shadow: 0 2px 10px #1d352a12; font-family: "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; font-size: var(--pdf-reading-font-size); line-height: 1.7; user-select: text; overflow-wrap: anywhere;}
.pdf-reading-paragraph {margin: 0 0 1.2em; white-space: pre-wrap; text-align: start; font-weight: 400;}
.pdf-reading-paragraph:last-child {margin-bottom: 0;}
.pdf-reading-heading {font-size: 1.35em; font-weight: 650; line-height: 1.45; margin-top: 1.25em;}
.pdf-reading-heading:first-child {margin-top: 0;}
.pdf-reading-caption {font-size: .9em; line-height: 1.65;}
.pdf-reading-metadata, .pdf-reading-footer {font-size: .8125em; line-height: 1.55; margin-bottom: .45em;}
.pdf-reading-untranslated {color: var(--muted);}
.pdf-reading-region {margin: 0 0 1.2em; width: 100%;}
.pdf-reading-region figcaption {height: auto; justify-content: center; margin-top: 6px; font-size: 11px; color: var(--muted);}
.pdf-region-canvas {max-width: 100%; margin-inline: auto; background: #fff;}
.pdf-region-canvas :deep(canvas) {display: block; width: 100%; height: auto;}
.pdf-reading-sheet ::selection {background: color-mix(in srgb, var(--brand), transparent 65%);}
.pdf-reading-continuation {margin-top: 16px;}
.pdf-reading-continuation-label {font-size: 12px; color: var(--muted); margin: 0 0 18px; user-select: none;}
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
@media (max-width: 600px) {.pdf-viewer-toolbar {gap: 10px; padding: 10px;} .pdf-selection-hint {order: 3; flex-basis: 100%;} .pdf-zoom-control {margin-left: auto;} .pdf-control-label, .pdf-presentation-control > span {display: none;} .pdf-reading-sheet {padding: 24px 20px;} }
</style>
