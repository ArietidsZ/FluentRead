<template>
  <div class="document-app" :class="{ dark: isDark }">
    <header class="document-header">
      <a class="document-brand" href="#" aria-label="流畅阅读文档翻译" @click.prevent="resetDocument">
        <img src="/icon/128.png" alt="" />
        <span>
          <strong>流畅阅读</strong>
          <small>FluentRead · 文档翻译 Beta</small>
        </span>
      </a>
      <span v-if="parsedDocument" class="document-status" :class="{ complete: hasTranslation }">
        <strong>{{ hasTranslation ? '已完成翻译' : '等待翻译' }}</strong>
        <span>{{ hasTranslation ? '✅' : 'Beta' }}</span>
      </span>
      <div class="header-actions">
        <span class="privacy-note"><i /> 文件只在当前浏览器中处理</span>
        <button class="ghost-button" type="button" @click="openSettings">翻译设置 ↗</button>
      </div>
    </header>

    <main class="document-main">
      <section v-if="!parsedDocument" class="landing-section">
        <div class="landing-copy">
          <span class="eyebrow">流畅阅读 · 文档翻译 Beta</span>
          <h1>把本地文件变成双语阅读体验</h1>
          <p>保留原有结构、时间轴和格式标记，在浏览器中完成翻译并下载结果。</p>
        </div>

        <div
          class="file-drop-zone"
          :class="{ dragging: isDragging }"
          role="button"
          tabindex="0"
          aria-label="打开文档文件"
          @click="openFilePicker"
          @keydown.enter.prevent="openFilePicker"
          @keydown.space.prevent="openFilePicker"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="handleDrop"
        >
          <input ref="fileInput" class="visually-hidden" type="file" :accept="accept" @change="handleFileInput" />
          <div class="format-list" aria-label="支持的文件格式">
            <div v-for="item in formatCards" :key="item.code" class="format-card">
              <span class="format-icon" :class="item.tone"><b>{{ item.code }}</b><i /></span>
              <span>{{ item.label }}</span>
            </div>
          </div>

          <button class="open-file-button" type="button" :disabled="openingFile" @click.stop="openFilePicker">
            {{ openingFile ? '正在解析文件…' : '打开文件' }}
          </button>
          <p>点击打开文件，或把本地文件拖到这里</p>
          <small>支持单个文件，最大 {{ maxFileSizeLabel }} · 文件不会上传到 FluentRead 服务器</small>
        </div>

        <p v-if="errorMessage" class="notice error" role="alert">{{ errorMessage }}</p>
      </section>

      <section v-else class="workspace-section">
        <div class="workspace-heading">
          <div class="file-heading">
            <span class="file-type-badge" :class="formatTone">{{ formatCode }}</span>
            <div>
              <h1>{{ parsedDocument.fileName }}</h1>
              <p>{{ parsedDocument.label }} · {{ parsedDocument.segments.length }} 个可翻译片段</p>
            </div>
          </div>
          <button class="ghost-button" type="button" :disabled="translating" @click="resetDocument">打开新文件</button>
        </div>

        <div class="control-panel">
          <label class="language-control">
            <span>源语言</span>
            <select v-model="config.from" aria-label="文档源语言">
              <option v-for="item in sourceLanguageOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </label>
          <span class="language-arrow" aria-hidden="true">→</span>
          <label class="language-control">
            <span>目标语言</span>
            <select v-model="config.to" aria-label="文档目标语言">
              <option v-for="item in options.to" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </label>
          <label class="service-control">
            <span>翻译服务</span>
            <select v-model="config.documentService" aria-label="文档翻译服务">
              <option v-for="item in serviceOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </label>
          <label v-if="documentUsesModel" class="model-control">
            <span>模型</span>
            <select v-model="selectedDocumentModel" aria-label="文档翻译模型">
              <option v-for="model in documentModelOptions" :key="model" :value="model">{{ model }}</option>
            </select>
            <input
              v-if="selectedDocumentModel === customModelString"
              v-model="selectedDocumentCustomModel"
              type="text"
              placeholder="输入自定义模型名称"
              aria-label="文档自定义模型名称"
            />
          </label>
          <div v-else class="model-summary">
            <span>模型</span>
            <strong>当前服务无需模型</strong>
          </div>
          <div class="mode-control" role="group" aria-label="导出模式">
            <span>译文显示</span>
            <div class="mode-buttons">
              <button type="button" :class="{ selected: outputMode === 'bilingual' }" @click="outputMode = 'bilingual'">双语对照</button>
              <button type="button" :class="{ selected: outputMode === 'translated' }" @click="outputMode = 'translated'">仅译文</button>
            </div>
          </div>
          <button class="translate-document-button" type="button" :disabled="translating || !parsedDocument.segments.length" @click="startTranslation">
            <span v-if="translating" class="spinner" />
            <span>{{ translating ? `翻译中 ${progress}%` : hasTranslation ? '重新翻译' : '开始翻译' }}</span>
          </button>
          <button v-if="hasTranslation" class="download-button" type="button" :disabled="preparingDownload" @click="downloadDocument">
            {{ preparingDownload ? '正在生成文件…' : `下载${outputMode === 'bilingual' ? '双语' : '译文'}文件` }}
          </button>
        </div>

        <p v-if="credentialWarning" class="notice warning" role="alert">{{ credentialWarning }} <button type="button" @click="openSettings">去配置</button></p>
        <p v-if="errorMessage" class="notice error" role="alert">{{ errorMessage }}</p>

        <div v-if="translating || hasTranslation" class="progress-panel" :class="{ complete: hasTranslation && !translating }">
          <div class="progress-copy">
            <strong>{{ translating ? `正在翻译 ${parsedDocument.fileName}` : '翻译完成，可以编辑译文后下载' }}</strong>
            <span>{{ completedSegments }} / {{ parsedDocument.segments.length }} 个片段</span>
          </div>
          <div class="progress-track"><i :style="{ width: `${progress}%` }" /></div>
        </div>

        <div class="preview-heading">
          <div>
            <span class="eyebrow">{{ previewMeta.eyebrow }}</span>
            <h2>{{ previewMeta.title }}</h2>
          </div>
          <span class="preview-hint">{{ previewMeta.hint }}</span>
        </div>

        <section
          v-if="isPdfDocument"
          class="pdf-layout-viewer"
          aria-label="PDF 版式翻译预览"
          data-document-reader="pdf"
          :data-segment-count="parsedDocument.segments.length"
        >
          <div class="pdf-viewer-toolbar">
            <div class="pdf-page-navigation" aria-label="PDF 页面导航">
              <button type="button" :disabled="pdfPageNumber <= 1" aria-label="上一页" @click="pdfPageNumber -= 1">‹</button>
              <strong>{{ pdfPageNumber }}</strong>
              <span>/ {{ pdfPageCount }}</span>
              <button type="button" :disabled="pdfPageNumber >= pdfPageCount" aria-label="下一页" @click="pdfPageNumber += 1">›</button>
            </div>
            <label class="pdf-zoom-control">
              <span>缩放</span>
              <select v-model.number="pdfZoom" aria-label="PDF 预览缩放">
                <option :value="0.75">75%</option>
                <option :value="1">100%</option>
                <option :value="1.25">125%</option>
                <option :value="1.5">150%</option>
              </select>
            </label>
          </div>

          <div
            class="pdf-page-stage"
            :class="{ single: outputMode === 'translated' }"
            :style="{ '--pdf-page-min-width': `${400 * pdfZoom}px`, '--pdf-page-max-width': `${720 * pdfZoom}px` }"
          >
            <figure v-if="outputMode === 'bilingual'" class="pdf-page-column">
              <figcaption><span>原文</span><strong>第 {{ pdfPageNumber }} 页</strong></figcaption>
              <div class="pdf-page-frame" :style="{ aspectRatio: pdfPageAspect }">
                <img v-if="pdfOriginalPreviewUrl" :src="pdfOriginalPreviewUrl" :alt="`PDF 原文第 ${pdfPageNumber} 页`" />
                <span v-else class="pdf-page-loading">正在渲染原页…</span>
              </div>
            </figure>
            <figure class="pdf-page-column translated">
              <figcaption><span>译文</span><strong>保留原版式</strong></figcaption>
              <div class="pdf-page-frame" :style="{ aspectRatio: pdfPageAspect }">
                <img v-if="pdfTranslatedPreviewUrl" :src="pdfTranslatedPreviewUrl" :alt="`PDF 译文第 ${pdfPageNumber} 页`" />
                <div v-else class="pdf-page-pending">
                  <span v-if="pdfPreviewLoading" class="spinner dark-spinner" />
                  <strong>{{ translating ? '正在翻译并重排本页' : '等待生成译页' }}</strong>
                  <small>译文会写回对应文本框，图表与页面布局保持原位</small>
                </div>
              </div>
            </figure>
          </div>

          <details v-if="currentPdfRows.length" class="pdf-proofreading">
            <summary>校对第 {{ pdfPageNumber }} 页译文 <span>{{ currentPdfRows.length }} 个版面文本块</span></summary>
            <article v-for="row in currentPdfRows" :key="row.index" class="pdf-proofreading-row">
              <p class="document-source">{{ row.source }}</p>
              <textarea
                class="pdf-proofreading-translation document-translation"
                :value="row.translation"
                :aria-label="`PDF 第 ${pdfPageNumber} 页第 ${row.index + 1} 个文本块译文`"
                :disabled="!hasTranslation || translating"
                @input="updateTranslation(row.index, $event)"
              />
            </article>
          </details>
        </section>

        <section
          v-else-if="isRichDocument"
          class="rich-document-reader"
          :class="`reader-${parsedDocument.format}`"
          data-document-reader="rich"
          :data-segment-count="parsedDocument.segments.length"
          aria-label="排版文档双语阅读预览"
        >
          <nav v-if="isEpubDocument" class="reader-native-toolbar" aria-label="ePub 章节导航">
            <button
              v-for="(chapter, index) in epubChapters"
              :key="chapter.path"
              type="button"
              :class="{ selected: epubChapterIndex === index }"
              @click="epubChapterIndex = index"
            >
              <span>{{ index + 1 }}</span>{{ chapter.title }}
            </button>
          </nav>
          <iframe
            class="rich-preview-frame"
            :srcdoc="richPreviewHtml"
            sandbox=""
            :title="`${parsedDocument.label}排版阅读预览`"
          />
          <details class="native-proofreading">
            <summary>校对当前{{ isEpubDocument ? '章节' : '文档' }}译文 <span>{{ currentRichRows.length }} 个文本片段</span></summary>
            <article v-for="row in currentRichRows" :key="row.index" class="native-proofreading-row">
              <p class="document-source">{{ readerText(row.source) }}</p>
              <textarea
                class="document-translation"
                :value="row.translation"
                :placeholder="translating ? '等待翻译…' : '开始翻译后显示译文'"
                :aria-label="`第 ${row.index + 1} 个文本片段译文`"
                :disabled="!hasTranslation || translating"
                @input="updateTranslation(row.index, $event)"
              />
            </article>
          </details>
        </section>

        <section
          v-else-if="isDocxDocument"
          class="docx-document-reader"
          data-document-reader="docx"
          :data-segment-count="parsedDocument.segments.length"
          aria-label="Word 文档页面预览"
        >
          <nav class="reader-native-toolbar" aria-label="Word 文档部分">
            <button
              v-for="(part, index) in docxParts"
              :key="part.path"
              type="button"
              :class="{ selected: docxPartIndex === index }"
              @click="docxPartIndex = index"
            >
              {{ docxPartLabel(part.path) }}
            </button>
          </nav>
          <div class="docx-page-stage">
            <article class="docx-page">
              <span class="docx-page-label">{{ docxPartLabel(currentDocxPart?.path || '') }}</span>
              <section
                v-for="row in currentDocxRows"
                :key="row.index"
                class="docx-paragraph"
                :class="`docx-role-${row.role || 'paragraph'}`"
              >
                <p v-if="outputMode === 'bilingual'" class="docx-source document-source">{{ row.source }}</p>
                <textarea
                  class="docx-translation document-translation"
                  :value="row.translation"
                  :placeholder="translating ? '等待翻译…' : '开始翻译后显示译文'"
                  :aria-label="`Word 第 ${row.index + 1} 段译文`"
                  :disabled="!hasTranslation || translating"
                  @input="updateTranslation(row.index, $event)"
                />
              </section>
            </article>
          </div>
        </section>

        <section
          v-else-if="isSubtitleDocument"
          class="subtitle-document-reader"
          data-document-reader="subtitle"
          :data-segment-count="parsedDocument.segments.length"
          aria-label="字幕时间轴翻译表格"
        >
          <div class="subtitle-table-scroll">
            <table>
              <thead><tr><th>#</th><th>开始时间</th><th>结束时间</th><th>原文</th><th>译文（可编辑）</th></tr></thead>
              <tbody>
                <tr v-for="row in subtitleRows" :key="row.index">
                  <td class="subtitle-index">{{ row.index + 1 }}</td>
                  <td><time>{{ row.timeStart || '—' }}</time></td>
                  <td><time>{{ row.timeEnd || '—' }}</time></td>
                  <td><p class="subtitle-source document-source">{{ readerText(row.source) }}</p></td>
                  <td>
                    <textarea
                      class="subtitle-translation document-translation"
                      :value="row.translation"
                      :placeholder="translating ? '等待翻译…' : '开始翻译后显示译文'"
                      :aria-label="`第 ${row.index + 1} 条字幕译文`"
                      :disabled="!hasTranslation || translating"
                      @input="updateTranslation(row.index, $event)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section
          v-else-if="isJsonDocument"
          class="json-document-reader"
          data-document-reader="json"
          :data-segment-count="parsedDocument.segments.length"
          aria-label="JSON 字符串路径翻译表格"
        >
          <div class="json-table-header"><span>JSONPath</span><span>原字符串</span><span>译文（可编辑）</span></div>
          <article v-for="row in jsonRows" :key="row.index" class="json-table-row">
            <code>{{ row.pathLabel || '$' }}</code>
            <p class="json-source document-source">{{ row.source }}</p>
            <textarea
              class="json-translation document-translation"
              :value="row.translation"
              :placeholder="translating ? '等待翻译…' : '开始翻译后显示译文'"
              :aria-label="`${row.pathLabel || '$'} 的译文`"
              :disabled="!hasTranslation || translating"
              @input="updateTranslation(row.index, $event)"
            />
          </article>
        </section>

        <div v-else class="document-reader" data-document-reader="generic" :data-segment-count="parsedDocument.segments.length" :class="`reader-${parsedDocument.format}`" aria-label="文档双语阅读预览">
          <article v-for="row in previewRows" :key="row.index" class="reader-block">
            <span v-if="row.contextLabel" class="reader-context">{{ row.contextLabel }}</span>
            <div v-if="outputMode === 'bilingual'" class="reader-source document-source" :class="readerSourceClass(row.source)">
              {{ readerText(row.source) }}
            </div>
            <textarea
              class="reader-translation document-translation"
              :value="row.translation"
              :placeholder="translating ? '等待翻译…' : '开始翻译后显示译文'"
              :aria-label="`第 ${row.index + 1} 段译文`"
              :disabled="!hasTranslation || translating"
              @input="updateTranslation(row.index, $event)"
            />
          </article>
        </div>
        <p v-if="!hasTranslation" class="reader-empty">
          {{ emptyReaderHint }}
        </p>
        <p v-if="showPreviewLimitNote" class="preview-more">当前展示前 {{ previewLimit }} 个片段，下载时会包含完整文件。</p>
      </section>
    </main>

    <footer class="document-footer">
      <span>流畅阅读文档翻译 Beta · PDF / ePub / HTML / JSON / TXT / DOCX / Markdown / 字幕</span>
      <a href="https://github.com/Bistutu/FluentRead" target="_blank" rel="noreferrer">开源项目 ↗</a>
    </footer>
  </div>
</template>

<script lang="ts" setup>
import {computed, onMounted, onUnmounted, reactive, ref, watch} from 'vue';
import browser from 'webextension-polyfill';
import {
  config as runtimeConfig,
  configReady,
  requestConfigSave,
  saveConfig,
} from '@/entrypoints/utils/config';
import {Config} from '@/entrypoints/utils/model';
import {getMissingCredentialMessage} from '@/entrypoints/utils/configValidation';
import {customModelString, models, options, resolveConfiguredModel, servicesType} from '@/entrypoints/utils/option';
import {
  DOCUMENT_MAX_BYTES,
  getDocumentAcceptAttribute,
  getDocumentFormat,
  parseDocument,
  type DocumentRenderMode,
  type ParsedDocument,
} from '@/entrypoints/utils/documentTranslation';
import {createDocumentPreviewHtml} from '@/entrypoints/utils/documentTranslationPreview';
import {
  createDocumentDownload,
  createPdfPagePreview,
  parseDocumentFile,
} from '@/entrypoints/utils/documentTranslationBinary';
import {translateDocumentSegments} from '@/entrypoints/utils/documentTranslationApi';

const PREVIEW_LIMIT = 80;
const config = reactive(new Config());
const fileInput = ref<HTMLInputElement | null>(null);
const parsedDocument = ref<ParsedDocument | null>(null);
const translatedSegments = ref<string[]>([]);
const outputMode = ref<DocumentRenderMode>('bilingual');
const isDragging = ref(false);
const translating = ref(false);
const progress = ref(0);
const errorMessage = ref('');
const openingFile = ref(false);
const preparingDownload = ref(false);
const pdfPageNumber = ref(1);
const pdfZoom = ref(1);
const pdfPreviewLoading = ref(false);
const pdfOriginalPreviewUrl = ref('');
const pdfTranslatedPreviewUrl = ref('');
const epubChapterIndex = ref(0);
const docxPartIndex = ref(0);
const hydrated = ref(false);
const isDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches);
let abortController: AbortController | null = null;
let lastSerialized = '';
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let pdfPreviewTimer: ReturnType<typeof setTimeout> | undefined;
let pdfPreviewRequest = 0;

const accept = getDocumentAcceptAttribute();
const maxFileSizeLabel = `${Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024)} MB`;
const sourceLanguageOptions = [{value: 'auto', label: '自动检测'}, ...options.to];
const formatCards = [
  {code: 'PDF', label: 'pdf 文件', tone: 'coral'},
  {code: 'EPUB', label: 'ePub 电子书', tone: 'teal'},
  {code: 'HTML', label: 'html 文件', tone: 'coral'},
  {code: 'JSON', label: 'json 文件', tone: 'teal'},
  {code: 'TXT', label: 'txt 文件', tone: 'slate'},
  {code: 'DOCX', label: 'Word 文档', tone: 'slate'},
  {code: 'MD', label: 'markdown 文件', tone: 'sand'},
  {code: 'SUB', label: '各种字幕文件', tone: 'violet'},
];

const serviceOptions = computed(() => options.services.filter((item: any) => !item.disabled));
const documentUsesModel = computed(() => servicesType.isUseModel(config.documentService));
const documentModelOptions = computed(() => models.get(config.documentService) || []);
const selectedDocumentModel = computed({
  get: () => config.documentModel[config.documentService] || documentModelOptions.value[0] || '',
  set: (value: string) => { config.documentModel[config.documentService] = value; },
});
const selectedDocumentCustomModel = computed({
  get: () => config.documentCustomModel[config.documentService] || '',
  set: (value: string) => { config.documentCustomModel[config.documentService] = value; },
});
const documentModelValue = computed(() => resolveConfiguredModel(selectedDocumentModel.value, selectedDocumentCustomModel.value));
const credentialWarning = computed(() => {
  if (documentUsesModel.value && !documentModelValue.value.trim()) {
    return '文档翻译模型尚未配置，请先选择模型或填写自定义模型名称。';
  }

  const credentialConfig = {
    ...config,
    model: {...config.model, [config.documentService]: selectedDocumentModel.value},
    customModel: {...config.customModel, [config.documentService]: selectedDocumentCustomModel.value},
  };
  return getMissingCredentialMessage(config.documentService, credentialConfig);
});
const previewRows = computed(() => (parsedDocument.value?.segments || []).slice(0, PREVIEW_LIMIT).map((segment) => ({
  index: segment.id,
  source: segment.source,
  contextLabel: segment.contextLabel,
  timeStart: segment.timeStart,
  timeEnd: segment.timeEnd,
  pathLabel: segment.pathLabel,
  role: segment.role,
  translation: translatedSegments.value[segment.id] || '',
})));
const previewLimit = PREVIEW_LIMIT;
const hasMorePreviewRows = computed(() => Boolean(parsedDocument.value && parsedDocument.value.segments.length > PREVIEW_LIMIT));
const hasTranslation = computed(() => translatedSegments.value.some((item) => item.trim().length > 0));
const completedSegments = computed(() => translatedSegments.value.filter((item) => item !== undefined && item !== '').length);
const isPdfDocument = computed(() => parsedDocument.value?.binary?.kind === 'pdf');
const isEpubDocument = computed(() => parsedDocument.value?.binary?.kind === 'epub');
const isDocxDocument = computed(() => parsedDocument.value?.binary?.kind === 'docx');
const isSubtitleDocument = computed(() => ['srt', 'vtt', 'ass', 'lrc'].includes(parsedDocument.value?.format || ''));
const isJsonDocument = computed(() => parsedDocument.value?.format === 'json');
const isRichDocument = computed(() => isEpubDocument.value || ['html', 'markdown', 'txt'].includes(parsedDocument.value?.format || ''));
const pdfPageCount = computed(() => parsedDocument.value?.binary?.kind === 'pdf' ? parsedDocument.value.binary.pages.length : 0);
const currentPdfPage = computed(() => parsedDocument.value?.binary?.kind === 'pdf'
  ? parsedDocument.value.binary.pages.find((page) => page.pageNumber === pdfPageNumber.value)
  : undefined);
const pdfPageAspect = computed(() => currentPdfPage.value
  ? `${currentPdfPage.value.width} / ${currentPdfPage.value.height}`
  : '612 / 792');
const currentPdfRows = computed(() => {
  const document = parsedDocument.value;
  const page = currentPdfPage.value;
  if (!document || !page) return [];
  return page.segmentIndexes.map((index) => ({
    index,
    source: document.segments[index]?.source || '',
    translation: translatedSegments.value[index] || '',
  }));
});
const epubChapters = computed(() => parsedDocument.value?.binary?.kind === 'epub'
  ? parsedDocument.value.binary.chapters
  : []);
const currentEpubChapter = computed(() => epubChapters.value[epubChapterIndex.value]);
const richPreviewDocument = computed<ParsedDocument | null>(() => {
  const document = parsedDocument.value;
  if (!document) return null;
  if (document.binary?.kind === 'epub') {
    const chapter = currentEpubChapter.value;
    return chapter ? parseDocument('chapter.html', chapter.source) : null;
  }
  return ['html', 'markdown', 'txt'].includes(document.format) ? document : null;
});
const richPreviewTranslations = computed(() => {
  const chapter = currentEpubChapter.value;
  return chapter
    ? translatedSegments.value.slice(chapter.segmentOffset, chapter.segmentOffset + chapter.segmentCount)
    : translatedSegments.value;
});
const richPreviewHtml = computed(() => {
  const document = richPreviewDocument.value;
  if (!document) return '';
  return createDocumentPreviewHtml(
    document,
    richPreviewTranslations.value,
    hasTranslation.value ? outputMode.value : 'source',
  );
});
const currentRichRows = computed(() => {
  const document = parsedDocument.value;
  const chapter = currentEpubChapter.value;
  if (!document) return [];
  if (!chapter) return previewRows.value;
  return document.segments
    .slice(chapter.segmentOffset, chapter.segmentOffset + Math.min(chapter.segmentCount, PREVIEW_LIMIT))
    .map((segment) => ({
      index: segment.id,
      source: segment.source,
      translation: translatedSegments.value[segment.id] || '',
    }));
});
const docxParts = computed(() => parsedDocument.value?.binary?.kind === 'docx'
  ? parsedDocument.value.binary.parts
  : []);
const currentDocxPart = computed(() => docxParts.value[docxPartIndex.value]);
const currentDocxRows = computed(() => {
  const document = parsedDocument.value;
  const part = currentDocxPart.value;
  if (!document || !part) return [];
  return part.paragraphSegments.slice(0, PREVIEW_LIMIT).map(({segmentIndex}) => {
    const segment = document.segments[segmentIndex];
    return {
      index: segmentIndex,
      source: segment?.source || '',
      role: segment?.role,
      translation: translatedSegments.value[segmentIndex] || '',
    };
  });
});
const subtitleRows = computed(() => previewRows.value);
const jsonRows = computed(() => previewRows.value);
const previewMeta = computed(() => {
  if (isPdfDocument.value) return {
    eyebrow: '版式阅读',
    title: 'PDF 原页与译页',
    hint: '保留分页、图表、分栏和文字坐标；双语模式并排显示原页与译页',
  };
  if (isEpubDocument.value) return {
    eyebrow: '电子书阅读',
    title: 'ePub 章节双语阅读',
    hint: '按目录切换章节，保留正文层级并导出可继续阅读的双语 ePub',
  };
  if (isDocxDocument.value) return {
    eyebrow: '页面阅读',
    title: 'Word 文档原文与译文',
    hint: '按正文、页眉、页脚和注释分区校对，下载结果仍为原生 DOCX',
  };
  if (isSubtitleDocument.value) return {
    eyebrow: '时间轴校对',
    title: '字幕原文与可编辑译文',
    hint: '开始时间、结束时间和字幕标签保持不变，逐条校对后按原格式下载',
  };
  if (isJsonDocument.value) return {
    eyebrow: '结构化翻译',
    title: 'JSON 路径与字符串译文',
    hint: '只翻译字符串值，键名、数组、数字、布尔值和嵌套结构保持不变',
  };
  if (parsedDocument.value?.format === 'markdown') return {
    eyebrow: '排版阅读',
    title: 'Markdown 双语文章',
    hint: '标题、段落、列表、引用和代码块按文章样式呈现，而不是文本片段表格',
  };
  if (parsedDocument.value?.format === 'html') return {
    eyebrow: '网页文档阅读',
    title: 'HTML 双语排版预览',
    hint: '在隔离阅读器中保留标题、段落、列表与表格，脚本和外部请求不会运行',
  };
  return {
    eyebrow: '流畅阅读',
    title: '原文与译文',
    hint: '按自然段连续阅读和校对，下载时保留原文件换行结构',
  };
});
const emptyReaderHint = computed(() => {
  if (isPdfDocument.value) return '点击“开始翻译”，译文会按原页面坐标写回并生成可下载 PDF。';
  if (isSubtitleDocument.value) return '点击“开始翻译”，译文会出现在对应时间轴行中。';
  if (isJsonDocument.value) return '点击“开始翻译”，只会填充每个 JSON 路径对应的字符串译文。';
  return '点击“开始翻译”，译文会按当前文档的阅读结构显示。';
});
const showPreviewLimitNote = computed(() => hasMorePreviewRows.value
  && (isSubtitleDocument.value || isJsonDocument.value || isDocxDocument.value));
const formatCode = computed(() => parsedDocument.value?.format.toUpperCase() || 'FILE');
const formatTone = computed(() => {
  const format = parsedDocument.value?.format;
  return ['pdf', 'html'].includes(format || '')
    ? 'coral'
    : ['epub', 'json'].includes(format || '')
      ? 'teal'
      : ['srt', 'vtt', 'ass', 'lrc'].includes(format || '')
        ? 'violet'
        : format === 'markdown'
          ? 'sand'
          : 'slate';
});

function docxPartLabel(path: string): string {
  if (path === 'word/document.xml') return '正文';
  if (/header/iu.test(path)) return '页眉';
  if (/footer/iu.test(path)) return '页脚';
  if (/footnotes/iu.test(path)) return '脚注';
  if (/endnotes/iu.test(path)) return '尾注';
  return '文档内容';
}

function pngObjectUrl(bytes: Uint8Array): string {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return URL.createObjectURL(new Blob([buffer], {type: 'image/png'}));
}

function clearPdfPreviewUrls(): void {
  if (pdfOriginalPreviewUrl.value) URL.revokeObjectURL(pdfOriginalPreviewUrl.value);
  if (pdfTranslatedPreviewUrl.value) URL.revokeObjectURL(pdfTranslatedPreviewUrl.value);
  pdfOriginalPreviewUrl.value = '';
  pdfTranslatedPreviewUrl.value = '';
}

async function refreshPdfPreview(): Promise<void> {
  const document = parsedDocument.value;
  if (document?.binary?.kind !== 'pdf') {
    clearPdfPreviewUrls();
    return;
  }
  const request = ++pdfPreviewRequest;
  pdfPreviewLoading.value = true;
  try {
    const preview = await createPdfPagePreview(
      document,
      pdfPageNumber.value,
      hasTranslation.value ? translatedSegments.value : undefined,
    );
    if (request !== pdfPreviewRequest) return;
    const originalUrl = pngObjectUrl(preview.original);
    const translatedUrl = preview.translated ? pngObjectUrl(preview.translated) : '';
    clearPdfPreviewUrls();
    pdfOriginalPreviewUrl.value = originalUrl;
    pdfTranslatedPreviewUrl.value = translatedUrl;
  } catch (error) {
    if (request === pdfPreviewRequest) showError(error instanceof Error ? error.message : String(error));
  } finally {
    if (request === pdfPreviewRequest) pdfPreviewLoading.value = false;
  }
}

function schedulePdfPreview(): void {
  if (pdfPreviewTimer) clearTimeout(pdfPreviewTimer);
  pdfPreviewTimer = setTimeout(() => { void refreshPdfPreview(); }, 180);
}

function readerText(value: string): string {
  const format = parsedDocument.value?.format;
  if (format === 'html') return value.replace(/<[^>]+>/gu, '').trim();
  if (format === 'markdown') {
    return value
      .replace(/^\s{0,3}#{1,6}\s+/u, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
      .replace(/`{1,3}([^`]+)`{1,3}/gu, '$1')
      .replace(/(\*\*|__)(.*?)\1/gu, '$2')
      .trim();
  }
  if (['srt', 'vtt', 'ass'].includes(format || '')) {
    return value.replace(/<[^>]+>/gu, '').replace(/\{\\[^}]+\}/gu, '').trim();
  }
  return value.trim();
}

function readerSourceClass(value: string): string {
  return parsedDocument.value?.format === 'markdown' && /^\s{0,3}#{1,6}\s+/u.test(value)
    ? 'reader-heading'
    : '';
}

function applyTheme(): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  isDark.value = media.matches;
}

async function hydrateConfig(): Promise<void> {
  await configReady;
  Object.assign(config, runtimeConfig);
  lastSerialized = JSON.stringify(config);
  hydrated.value = true;
}
void hydrateConfig();

watch(config, (value) => {
  if (!hydrated.value) return;
  const serialized = JSON.stringify(value);
  if (serialized === lastSerialized) return;
  lastSerialized = serialized;
  void requestConfigSave(value, browser.runtime.sendMessage.bind(browser.runtime)).catch((error) => {
    console.warn('[FluentRead] 保存文档翻译设置失败', error);
  });
}, {deep: true, flush: 'sync'});

watch([parsedDocument, pdfPageNumber], () => {
  if (isPdfDocument.value) void refreshPdfPreview();
}, {flush: 'post'});

watch(translatedSegments, () => {
  if (isPdfDocument.value) schedulePdfPreview();
}, {deep: true});

function openFilePicker(): void {
  fileInput.value?.click();
}

function showError(message: string): void {
  errorMessage.value = message;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { errorMessage.value = ''; }, 6000);
}

async function loadFile(file: File): Promise<void> {
  errorMessage.value = '';
  if (!getDocumentFormat(file.name)) {
    showError('暂不支持该文件格式，请选择 PDF、ePub、HTML、JSON、TXT、DOCX、Markdown 或字幕文件。');
    return;
  }
  if (file.size > DOCUMENT_MAX_BYTES) {
    showError(`文件大小超过 ${maxFileSizeLabel}，请先拆分文件后再翻译。`);
    return;
  }

  try {
    openingFile.value = true;
    const parsed = await parseDocumentFile(file);
    if (parsed.segments.length === 0) throw new Error('文件中没有找到可翻译的文本片段。');
    parsedDocument.value = parsed;
    translatedSegments.value = [];
    outputMode.value = 'bilingual';
    pdfPageNumber.value = 1;
    pdfZoom.value = 1;
    epubChapterIndex.value = 0;
    docxPartIndex.value = 0;
    progress.value = 0;
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    openingFile.value = false;
  }
}

function handleFileInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void loadFile(file);
  input.value = '';
}

function handleDrop(event: DragEvent): void {
  isDragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) void loadFile(file);
}

function resetDocument(): void {
  abortController?.abort();
  abortController = null;
  translating.value = false;
  parsedDocument.value = null;
  translatedSegments.value = [];
  progress.value = 0;
  errorMessage.value = '';
  openingFile.value = false;
  preparingDownload.value = false;
  pdfPageNumber.value = 1;
  pdfZoom.value = 1;
  epubChapterIndex.value = 0;
  docxPartIndex.value = 0;
  pdfPreviewLoading.value = false;
  pdfPreviewRequest += 1;
  if (pdfPreviewTimer) clearTimeout(pdfPreviewTimer);
  clearPdfPreviewUrls();
}

async function startTranslation(): Promise<void> {
  const document = parsedDocument.value;
  if (!document || translating.value) return;
  if (credentialWarning.value) {
    showError(credentialWarning.value);
    return;
  }

  translating.value = true;
  progress.value = 0;
  errorMessage.value = '';
  const controller = new AbortController();
  abortController = controller;
  try {
    const result = await translateDocumentSegments(document.segments, {
      fileName: document.fileName,
      serviceOverride: config.documentService,
      modelOverride: documentUsesModel.value ? documentModelValue.value : undefined,
      signal: controller.signal,
      onProgress: ({completed, total}) => {
        progress.value = total > 0 ? Math.round((completed / total) * 100) : 100;
        translatedSegments.value = translatedSegments.value.length === total
          ? translatedSegments.value
          : new Array<string>(total).fill('');
      },
    });
    translatedSegments.value = result;
    progress.value = 100;
  } catch (error) {
    if (controller.signal.aborted) {
      showError('文档翻译已取消。');
    } else {
      showError(error instanceof Error ? error.message : String(error));
    }
  } finally {
    translating.value = false;
    abortController = null;
  }
}

function updateTranslation(index: number, event: Event): void {
  translatedSegments.value[index] = (event.target as HTMLTextAreaElement).value;
}

async function downloadDocument(): Promise<void> {
  const document = parsedDocument.value;
  if (!document || !hasTranslation.value || preparingDownload.value) return;
  preparingDownload.value = true;
  errorMessage.value = '';
  try {
    const download = await createDocumentDownload(document, translatedSegments.value, outputMode.value);
    const blob = new Blob([download.data], {type: download.mimeType});
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = download.fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    preparingDownload.value = false;
  }
}

async function openSettings(): Promise<void> {
  await browser.tabs.create({url: `${browser.runtime.getURL('options.html')}#settings-services`});
}

onMounted(() => {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener?.('change', applyTheme);
  window.addEventListener('pagehide', resetDocument);
});

onUnmounted(() => {
  abortController?.abort();
  void saveConfig(config).catch(() => undefined);
  if (noticeTimer) clearTimeout(noticeTimer);
  if (pdfPreviewTimer) clearTimeout(pdfPreviewTimer);
  clearPdfPreviewUrls();
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.removeEventListener?.('change', applyTheme);
  window.removeEventListener('pagehide', resetDocument);
});
</script>
