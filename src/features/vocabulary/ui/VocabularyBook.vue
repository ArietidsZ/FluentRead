<!--
 * @file src/features/vocabulary/ui/VocabularyBook.vue
 * 文件职责：实现学习中心本地单词与句子收藏及主动复习界面，覆盖原句学习、自主造句反馈、收藏开关、原文朗读、筛选分页、记忆卡、删除撤销和数据操作。
 * 主要内容：组件通过 runtime 消息读取和修改词条，使用字段级配置补丁保存收藏开关，协调稳定复习队列、页面生命周期、键盘评分、主题、时间刷新与跨页面变更通知，并在轻量“更多”菜单中提供隐私安全的 Anki 导出和清空操作。
 * 模块边界：UI 不直接访问 Dexie 或上传学习数据；完整备份与旧文件导入统一进入备份与恢复页，数据库操作集中在后台 repository/handler，导出的上下文和来源只有用户明确选择时才包含。
 -->
<template>
  <div class="vocabulary-book">
    <VocabularyStudy v-if="studyEntry" :key="studyEntry.id" :entry="studyEntry" :reference="entryTranslation(studyEntry)" @close="selectedEntryId = ''" @speak="toggleEntrySpeech(studyEntry)" @navigate="emit('navigate', $event)" />
    <template v-else>
    <section v-if="!reviewActive" class="beta-panel">
      <div class="beta-copy">
        <div>
          <h3>{{ betaEnabled ? '学习收藏入口已开启' : '先开启学习收藏' }}</h3>
          <p v-if="!betaEnabled">主动收藏单词、表达或句子；关闭入口不会删除已有收藏和复习记录。</p>
        </div>
      </div>
      <button
        class="beta-switch"
        type="button"
        role="switch"
        aria-label="启用或关闭本地单词本"
        :aria-checked="betaEnabled"
        :disabled="configBusy"
        @click="setBetaEnabled(!betaEnabled)"
      ><i /></button>
    </section>

    <div v-if="!reviewActive && betaEnabled && !selectionTranslatorEnabled" class="selection-reminder" role="note">
      <span>收藏入口位于网页学习卡中；当前划词翻译和阅读助手都未开启。</span>
      <button type="button" @click="emit('navigate', 'settings-translation')">前往开启</button>
    </div>


    <div v-if="loadError" class="error-state" role="alert">
      <span>{{ loadError }}</span><button type="button" @click="loadEntries">重试</button>
    </div>

    <template v-else>
      <section v-if="!reviewActive && entries.length" class="summary-grid" aria-label="单词本概览">
        <article><span>今日待复习</span><strong>{{ dueEntries.length }}</strong><small>{{ dueEntries.length ? '从最早到期开始' : '今天已经清空' }}</small></article>
        <article><span>新词</span><strong>{{ statusCounts.new }}</strong><small>还没有完成第一次复习</small></article>
        <article><span>学习中 / 熟悉</span><strong>{{ statusCounts.learning + statusCounts.familiar }}</strong><small>正在逐步拉长间隔</small></article>
        <article><span>已掌握</span><strong>{{ statusCounts.mastered }}</strong><small>仍会低频巩固</small></article>
      </section>

      <section v-if="reviewActive" class="review-shell" aria-live="polite">
        <header class="review-header">
          <div><span class="eyebrow">主动回忆</span><strong>{{ reviewPosition }} / {{ reviewTotal }}</strong></div>
          <button type="button" :disabled="actionBusy" @click="finishReview">退出本轮</button>
        </header>

        <div v-if="currentReview" class="review-card">
          <span class="status-pill" :class="`status-${currentReview.status}`">{{ statusLabel(currentReview.status) }}</span>
          <div class="review-prompt">
            <p v-if="currentClozeContext" class="cloze-context" data-i18n-ignore>{{ currentClozeContext }}</p>
            <h3 v-else data-i18n-ignore>{{ currentReview.term }}</h3>
            <small>{{ currentClozeContext ? '回忆空缺处的表达和含义' : '回忆它的含义，并想想可以怎样使用' }}</small>
          </div>

          <textarea v-if="!reviewAnswerVisible" v-model="recallDraft" class="recall-draft" rows="2" maxlength="400" aria-label="我的回忆" placeholder="试着写下答案或一个用法，再核对…" @keydown.stop />
          <button v-if="!reviewAnswerVisible" class="reveal-button" type="button" @click="reviewAnswerVisible = true">显示答案 <kbd>Space</kbd></button>

          <div v-else class="review-answer">
            <div class="answer-heading"><h3 data-i18n-ignore>{{ currentReview.term }}</h3><button class="vocabulary-speak" type="button" :aria-label="playingEntryId === currentReview.id ? '停止朗读' : '朗读原文'" :title="playingEntryId === currentReview.id ? '停止朗读' : '朗读原文'" @click="toggleEntrySpeech(currentReview)"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 7h4l4-3v12l-4-3H3z" /><path :d="playingEntryId === currentReview.id ? 'M14 7v6m3-6v6' : 'M14 7a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12'" /></svg></button><span v-if="currentReview.phonetic">{{ currentReview.phonetic }}</span></div>
            <p v-if="recallDraft" class="recall-attempt">你的回忆：<span data-i18n-ignore>{{ recallDraft }}</span></p>
            <span class="answer-reference-label">收藏时的参考内容</span>
            <ReadingAnswer v-if="entryTranslation(currentReview)" :text="entryTranslation(currentReview)" />
            <p v-else class="answer-translation">尚未保存参考内容。可以先进入学习页理解这个表达，再回来复习。</p>
            <button type="button" class="study-entry-button" @click="openStudy(currentReview)">结合原句学用法</button>
            <p v-if="latestContext(currentReview)?.text" class="answer-context" data-i18n-ignore>{{ latestContext(currentReview)?.text }}</p>
            <a v-if="latestContext(currentReview)?.sourceUrl" :href="latestContext(currentReview)?.sourceUrl" target="_blank" rel="noreferrer">查看收藏来源 ↗</a>
            <div class="review-actions">
              <button type="button" class="again" :disabled="actionBusy" @click="rateReview('again')"><span>1</span><strong>忘了</strong><small>约 10 分钟后</small></button>
              <button type="button" class="good" :disabled="actionBusy" @click="rateReview('good')"><span>2</span><strong>记得</strong><small>{{ goodIntervalLabel(currentReview) }}</small></button>
            </div>
          </div>
        </div>

        <div v-else class="review-complete">
          <span aria-hidden="true">✓</span>
          <h3>本轮复习完成</h3>
          <p>复习 {{ reviewStats.reviewed }} 个 · 记得 {{ reviewStats.good }} 个 · 忘了 {{ reviewStats.again }} 个</p>
          <button type="button" @click="finishReview">返回单词本</button>
        </div>
      </section>

      <template v-else>
        <section v-if="entries.length" class="primary-actions">
          <button class="start-learning" type="button" :disabled="loading || !latestSavedEntry" @click="latestSavedEntry && openStudy(latestSavedEntry)">
            <strong>学习最近收藏</strong>
          </button>
          <button class="start-review" type="button" :disabled="loading || actionBusy || reviewPlan.length === 0" @click="startReview">
            <span><strong>{{ reviewPlan.length ? `开始复习 ${reviewPlan.length} 个` : '今天没有到期单词' }}</strong></span>
          </button>
          <div class="secondary-actions">
            <button type="button" class="refresh-button" :disabled="loading" @click="loadEntries">{{ loading ? '读取中…' : '刷新' }}</button>
            <details ref="moreMenu" class="book-more">
              <summary aria-label="更多单词本操作">更多</summary>
              <div class="book-more-menu">
                <button type="button" :disabled="actionBusy" @click="exportAnki">导出到 Anki</button>
                <button type="button" class="danger" :disabled="actionBusy || entries.length === 0" @click="clearVocabulary">清空单词本</button>
              </div>
            </details>
          </div>
        </section>

        <section v-if="entries.length" class="toolbar" aria-label="筛选单词">
          <label class="search-field"><span aria-hidden="true"><UiIcon name="search" :size="16" /></span><input v-model.trim="query" type="search" placeholder="搜索单词、句子、释义或上下文" /></label>
          <UiSelect v-model="statusFilter" aria-label="掌握状态">
            <ElOption value="all" :label="translateControlLabel('全部状态')" />
            <ElOption value="due" :label="translateControlLabel('待复习')" />
            <ElOption value="new" :label="translateControlLabel('新词')" />
            <ElOption value="learning" :label="translateControlLabel('学习中')" />
            <ElOption value="familiar" :label="translateControlLabel('熟悉')" />
            <ElOption value="mastered" :label="translateControlLabel('已掌握')" />
          </UiSelect>
          <UiSelect v-model="sortOrder" aria-label="排序方式">
            <ElOption value="due" :label="translateControlLabel('按复习时间')" />
            <ElOption value="recent" :label="translateControlLabel('按最近收藏')" />
            <ElOption value="term" :label="translateControlLabel('按字母顺序')" />
          </UiSelect>
        </section>

        <section v-if="loading && entries.length === 0" class="empty-state"><span class="loading-ring" /><p>正在读取本地单词本…</p></section>
        <section v-else-if="entries.length === 0" class="empty-state">
          <span aria-hidden="true"><UiIcon name="book" :size="28" /></span><h3>还没有学习收藏</h3><p>开启后，在网页学习卡中收藏想记住的单词或句子。</p>
          <button type="button" @click="emit('navigate', 'settings-data')">从备份恢复</button>
        </section>
        <section v-else-if="filteredEntries.length === 0" class="empty-state"><span aria-hidden="true"><UiIcon name="search" :size="28" /></span><h3>没有匹配的词条</h3><p>试试清空搜索内容或切换掌握状态。</p></section>

        <section v-else class="word-list" aria-label="收藏的单词与句子">
          <article v-for="entry in pagedEntries" :key="entry.id" class="word-row">
            <div class="word-main">
              <div class="word-heading"><h3 data-i18n-ignore>{{ entry.term }}</h3><button class="vocabulary-speak" type="button" :aria-label="playingEntryId === entry.id ? '停止朗读' : '朗读原文'" :title="playingEntryId === entry.id ? '停止朗读' : '朗读原文'" @click="toggleEntrySpeech(entry)"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 7h4l4-3v12l-4-3H3z" /><path :d="playingEntryId === entry.id ? 'M14 7v6m3-6v6' : 'M14 7a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12'" /></svg></button><span v-if="entry.phonetic">{{ entry.phonetic }}</span></div>
              <p>{{ vocabularyReferencePreview(entryTranslation(entry)) || '从原句开始，理解这个表达的含义与用法' }}</p>
              <small v-if="contextPreview(entry)" class="context-preview" data-i18n-ignore>{{ contextPreview(entry) }}</small>
              <div class="word-meta">
                <span v-if="entry.partOfSpeech">{{ entry.partOfSpeech }}</span>
                <span>{{ entry.encounterCount }} 次收藏记录</span>
                <a v-if="latestContext(entry)?.sourceUrl" :href="latestContext(entry)?.sourceUrl" target="_blank" rel="noreferrer">{{ sourceHost(latestContext(entry)?.sourceUrl) }}</a>
              </div>
            </div>
            <div class="word-progress">
              <span class="status-pill" :class="`status-${entry.status}`">{{ statusLabel(entry.status) }}</span>
              <small>{{ nextReviewLabel(entry) }}</small>
              <div class="row-actions">
                <button type="button" class="study-entry-button" @click="openStudy(entry)">学习用法</button>
                <button v-if="entry.status !== 'mastered'" type="button" :disabled="actionBusy" @click="setMastered(entry)">标记掌握</button>
                <button v-else type="button" :disabled="actionBusy" @click="relearn(entry)">重新学习</button>
                <button type="button" class="danger" :disabled="actionBusy" @click="removeEntry(entry)">删除</button>
              </div>
            </div>
          </article>

          <nav v-if="pageCount > 1" class="pagination" aria-label="单词本分页">
            <button type="button" :disabled="page <= 1" @click="page -= 1">上一页</button>
            <span>第 {{ page }} / {{ pageCount }} 页 · 共 {{ filteredEntries.length }} 个</span>
            <button type="button" :disabled="page >= pageCount" @click="page += 1">下一页</button>
          </nav>
        </section>

      </template>
    </template>

    <section v-if="!reviewActive" class="privacy-note" aria-label="本地存储说明">
      <span aria-hidden="true"><UiIcon name="shield" /></span>
      <div><strong>学习数据仅保存在当前浏览器</strong><small>不建账号、不上传复习记录；无痕窗口不提供持久收藏。</small></div>
      <button type="button" @click="emit('navigate', 'settings-data')">备份与恢复</button>
    </section>

    </template>

    <div v-if="toastMessage" class="book-toast" role="status">
      <span>{{ toastMessage }}</span><button v-if="undoExport" type="button" @click="undoRemove">撤销</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import UiIcon from '@/src/ui/components/UiIcon.vue'
import UiSelect from '@/src/ui/components/UiSelect.vue';
import {ElOption} from 'element-plus';
function translateControlLabel(value: string): string { return translateLegacyText(value, normalizeUiLanguage(runtimeConfig.uiLanguage)); }

import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import VocabularyStudy from './VocabularyStudy.vue';
import {ReadingAnswer} from '@/src/features/reading-assistant/public';
import {ElMessageBox} from 'element-plus';
import browser from 'webextension-polyfill';
import {normalizeUiLanguage, translate, translateLegacyText} from '@/src/core/i18n';
import {createSelectionTtsClientRequestId, createSelectionTtsContentController, normalizeSpeechLanguage} from '@/src/features/selection-translation/speech/public';
import {
  config as runtimeConfig,
  configReady,
  requestConfigPatch,
  subscribeConfig,
} from '@/src/services/config/store';
import {
  vocabularyReviewCloze,
  vocabularyReferencePreview,
  buildAnkiTsv,
  normalizeLearningSourceText,
  advanceVocabularyReviewSession,
  createVocabularyLifecycleGuard,
  createVocabularyReviewSession,
  reconcileVocabularyReviewSession,
  vocabularyReviewSessionProgress,
  VOCABULARY_BOOK_CHANGED_MESSAGE,
  VOCABULARY_BOOK_EXPORT_FORMAT,
  VOCABULARY_BOOK_EXPORT_VERSION,
  VOCABULARY_BOOK_MESSAGE,
  type VocabularyBookChangedMessage,
  type VocabularyBookExport,
  type VocabularyBookRequest,
  type VocabularyBookResponse,
  type VocabularyContext,
  type VocabularyEntry,
  type VocabularyImportResult,
  type VocabularyRemovalSnapshot,
  type VocabularyReviewResult,
  type VocabularyReviewSessionState,
  type VocabularyScheduledReviewRating,
  type VocabularyStatus,
} from '@/src/features/vocabulary/learningModel';

const emit = defineEmits<{ navigate: [section: string] }>();
const betaEnabled = ref(false);
const selectionTranslatorEnabled = ref(false);
const targetLanguageKey = ref('');
const configBusy = ref(false);
const entries = ref<VocabularyEntry[]>([]);
const selectedEntryId = ref('');
const studyEntry = computed(() => entries.value.find(entry => entry.id === selectedEntryId.value));
const latestSavedEntry = computed(() => [...entries.value].sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.id.localeCompare(b.id))[0]);
const recallDraft = ref('');
const loading = ref(false);
const actionBusy = ref(false);
const loadError = ref('');
const query = ref('');
const statusFilter = ref<'all' | 'due' | VocabularyStatus>('all');
const sortOrder = ref<'due' | 'recent' | 'term'>('due');
const page = ref(1);
const pageSize = 50;
const reviewBatchSize = 20;
const reviewQueue = ref<VocabularyEntry[]>([]);
const reviewIndex = ref(0);
const reviewAnswerVisible = ref(false);
const reviewStarted = ref(false);
const reviewStats = ref({ reviewed: 0, good: 0, again: 0 });
const toastMessage = ref('');
// 保持可结构化克隆的快照为原始对象，避免 browser.runtime.sendMessage 收到 Vue Proxy。
const undoExport = shallowRef<VocabularyBookExport | null>(null);
const moreMenu = ref<HTMLDetailsElement | null>(null);
const currentTime = ref(Date.now());
const lifecycle = createVocabularyLifecycleGuard();
const playingEntryId = ref('');
const speechController = createSelectionTtsContentController({
  createClientRequestId: () => createSelectionTtsClientRequestId(),
  stopRemote: clientRequestId => browser.runtime.sendMessage({type: 'selectionTtsStop', clientRequestId}),
});
let entryAudio: HTMLAudioElement | null = null;
let entryAudioUrl = '';
let entryUtterance: SpeechSynthesisUtterance | null = null;
let toastTimer: number | null = null;
let timeRefreshTimer: number | null = null;
let darkMedia: MediaQueryList | null = null;
let loadRequestGeneration = 0;
let completedLoadGeneration = 0;
let loadLoopPromise: Promise<void> | null = null;

const reviewActive = computed(() => reviewStarted.value);
const reviewSessionProgress = computed(() => vocabularyReviewSessionProgress(reviewSessionState()));
const currentReview = computed(() => reviewSessionProgress.value.current);
const reviewTotal = computed(() => reviewSessionProgress.value.total);
const reviewPosition = computed(() => reviewSessionProgress.value.position);
const dueEntries = computed(() => entries.value
  .filter(entry => entry.nextReviewAt !== null && entry.nextReviewAt <= currentTime.value)
  .sort((left, right) => (left.nextReviewAt || 0) - (right.nextReviewAt || 0)));
const reviewPlan = computed(() => {
  const scheduled = dueEntries.value.filter(entry => entry.status !== 'new').slice(0, reviewBatchSize);
  const fresh = dueEntries.value
    .filter(entry => entry.status === 'new')
    .slice(0, Math.min(10, reviewBatchSize - scheduled.length));
  return [...scheduled, ...fresh];
});
const statusCounts = computed(() => entries.value.reduce((counts, entry) => {
  counts[entry.status] += 1;
  return counts;
}, { new: 0, learning: 0, familiar: 0, mastered: 0 }));
const filteredEntries = computed(() => {
  const keyword = query.value.toLocaleLowerCase();
  const filtered = entries.value.filter(entry => {
    if (statusFilter.value === 'due' && !(entry.nextReviewAt !== null && entry.nextReviewAt <= currentTime.value)) return false;
    if (statusFilter.value !== 'all' && statusFilter.value !== 'due' && entry.status !== statusFilter.value) return false;
    if (!keyword) return true;
    const searchable = [
      entry.term,
      entry.normalizedTerm,
      ...Object.values(entry.translations).map(item => item.text),
      ...entry.contexts.map(context => `${context.text} ${context.pageTitle || ''}`),
    ].join(' ').toLocaleLowerCase();
    return searchable.includes(keyword);
  });
  return filtered.sort((left, right) => {
    if (sortOrder.value === 'term') return left.normalizedTerm.localeCompare(right.normalizedTerm);
    if (sortOrder.value === 'recent') return right.lastSeenAt - left.lastSeenAt;
    return (left.nextReviewAt ?? Number.MAX_SAFE_INTEGER) - (right.nextReviewAt ?? Number.MAX_SAFE_INTEGER)
      || left.createdAt - right.createdAt;
  });
});
const pageCount = computed(() => Math.max(1, Math.ceil(filteredEntries.value.length / pageSize)));
const pagedEntries = computed(() => filteredEntries.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const currentClozeContext = computed(() => currentReview.value ? vocabularyReviewCloze(currentReview.value) : '');
watch(() => [currentReview.value?.id, currentReview.value?.updatedAt], () => { recallDraft.value = ''; });
watch(selectedEntryId, () => stopEntrySpeech());
function openStudy(entry: VocabularyEntry): void {
  finishReview();
  selectedEntryId.value = entry.id;
}


watch([query, statusFilter, sortOrder], () => { page.value = 1; });
watch(pageCount, count => { if (page.value > count) page.value = count; });
watch([query, statusFilter, sortOrder, page, reviewStarted], () => stopEntrySpeech());
watch(entries, items => { if (playingEntryId.value && !items.some(entry => entry.id === playingEntryId.value)) stopEntrySpeech(); });

function releaseEntryAudio(): void {
  if (entryAudio) { entryAudio.pause(); entryAudio.removeAttribute('src'); entryAudio = null; }
  if (entryAudioUrl) URL.revokeObjectURL(entryAudioUrl);
  entryAudioUrl = '';
}

function stopEntrySpeech(notifyRemote = true): void {
  speechController.stop(notifyRemote);
  releaseEntryAudio();
  if (entryUtterance && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  entryUtterance = null;
  playingEntryId.value = '';
}

function speakEntryWithBrowser(entry: VocabularyEntry): void {
  if (entryUtterance) return;
  // 远端失败后的结束消息或 page.play 的迟到拒绝不能再停止或重复当前浏览器回退。
  speechController.stop(false);
  releaseEntryAudio();
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    stopEntrySpeech(); showToast('当前环境无法朗读，请稍后重试。'); return;
  }
  try {
    const utterance = new SpeechSynthesisUtterance(entry.term);
    utterance.lang = normalizeSpeechLanguage(entry.sourceLanguage);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find(voice => voice.lang.toLowerCase() === utterance.lang.toLowerCase()) ?? null;
    utterance.onend = () => { if (entryUtterance === utterance) stopEntrySpeech(false); };
    utterance.onerror = () => { if (entryUtterance === utterance) { stopEntrySpeech(false); showToast('朗读未完成，请重试。'); } };
    entryUtterance = utterance;
    playingEntryId.value = entry.id;
    window.speechSynthesis.speak(utterance);
  } catch { stopEntrySpeech(); showToast('当前环境无法朗读，请稍后重试。'); }
}

async function toggleEntrySpeech(entry: VocabularyEntry): Promise<void> {
  const wasPlaying = playingEntryId.value === entry.id;
  stopEntrySpeech();
  if (wasPlaying) return;
  playingEntryId.value = entry.id;
  const remote = speechController.beginRemoteRequest();
  try {
    const response = await browser.runtime.sendMessage({type: 'selectionTts', text: entry.term, language: normalizeSpeechLanguage(entry.sourceLanguage), clientRequestId: remote.clientRequestId}) as {success?: boolean; transport?: 'offscreen' | 'page'; audioBase64?: string; contentType?: string};
    const result = speechController.completeRemoteRequest(remote, response);
    if (result === 'stale' || result === 'offscreen') return;
    if (result === 'failed' || !response.audioBase64) { speakEntryWithBrowser(entry); return; }
    const binary = atob(response.audioBase64);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    entryAudioUrl = URL.createObjectURL(new Blob([bytes], {type: response.contentType || 'audio/mpeg'}));
    const audio = new Audio(entryAudioUrl);
    entryAudio = audio;
    audio.onended = () => { if (entryAudio === audio) stopEntrySpeech(false); };
    audio.onerror = () => { if (entryAudio === audio) speakEntryWithBrowser(entry); };
    await audio.play();
  } catch {
    if (speechController.rejectRemoteRequest(remote)) speakEntryWithBrowser(entry);
  }
}

function handleEntrySpeechState(message: unknown): undefined {
  const state = speechController.matchRemoteState(message);
  if (state === 'error') {
    const entry = entries.value.find(item => item.id === playingEntryId.value);
    if (entry) speakEntryWithBrowser(entry);
    else stopEntrySpeech(false);
  } else if (state) stopEntrySpeech(false);
  return undefined;
}

async function requestVocabulary<T>(request: VocabularyBookRequest): Promise<T> {
  const response = await browser.runtime.sendMessage(request) as VocabularyBookResponse<T>;
  if (!response?.success) throw new Error(response?.error?.message || '单词本操作失败');
  return response.data;
}

function applyTheme(): void {
  const dark = runtimeConfig.theme === 'dark'
    || (runtimeConfig.theme === 'auto' && Boolean(darkMedia?.matches));
  document.documentElement.classList.toggle('dark', dark);
}

function scheduleTimeRefresh(): void {
  if (timeRefreshTimer !== null) window.clearTimeout(timeRefreshTimer);
  timeRefreshTimer = null;
  if (!lifecycle.isActive()) return;
  const timestamp = Date.now();
  currentTime.value = timestamp;
  if (document.visibilityState === 'hidden') return;

  const nearestDueAt = entries.value.reduce((nearest, entry) => {
    if (entry.nextReviewAt === null || entry.nextReviewAt <= timestamp) return nearest;
    return Math.min(nearest, entry.nextReviewAt);
  }, Number.POSITIVE_INFINITY);
  const untilNextMinute = 60_000 - (timestamp % 60_000);
  const untilNearestDue = nearestDueAt - timestamp;
  const delay = Math.max(100, Math.min(untilNextMinute, untilNearestDue));
  timeRefreshTimer = window.setTimeout(scheduleTimeRefresh, delay + 20);
}

function handleVisibilityChange(): void {
  if (!lifecycle.isActive()) return;
  if (document.visibilityState === 'hidden') stopEntrySpeech();
  scheduleTimeRefresh();
  if (document.visibilityState === 'visible') void loadEntries();
}

async function loadEntries(): Promise<void> {
  if (!lifecycle.isActive()) return;
  // 并发刷新合并为一个串行循环；若等待期间代次增长，旧响应不提交，循环会继续读取最新快照。
  loadRequestGeneration += 1;
  if (loadLoopPromise) return loadLoopPromise;
  loadLoopPromise = runLoadEntriesLoop().finally(() => { loadLoopPromise = null; });
  return loadLoopPromise;
}

async function runLoadEntriesLoop(): Promise<void> {
  if (!lifecycle.isActive()) return;
  loading.value = true;
  loadError.value = '';
  try {
    while (lifecycle.isActive() && completedLoadGeneration < loadRequestGeneration) {
      const generation = loadRequestGeneration;
      try {
        const nextEntries = await requestVocabulary<VocabularyEntry[]>({ type: VOCABULARY_BOOK_MESSAGE, action: 'list' });
        if (lifecycle.isActive() && generation === loadRequestGeneration) {
          entries.value = nextEntries;
          loadError.value = '';
          reconcileActiveReviewQueue();
        }
      } catch (cause) {
        if (lifecycle.isActive() && generation === loadRequestGeneration) {
          loadError.value = cause instanceof Error ? cause.message : '无法读取本地单词本';
        }
      } finally {
        completedLoadGeneration = generation;
      }
    }
  } finally {
    if (lifecycle.isActive()) {
      loading.value = false;
      scheduleTimeRefresh();
    }
  }
}

async function setBetaEnabled(enabled: boolean): Promise<void> {
  if (configBusy.value) return;
  configBusy.value = true;
  betaEnabled.value = enabled;
  try {
    await requestConfigPatch({vocabularyBookEnabled: enabled}, browser.runtime.sendMessage.bind(browser.runtime));
    showToast(enabled ? '单词本已开启' : '收藏入口已关闭，学习数据仍保留');
  } catch (cause) {
    betaEnabled.value = runtimeConfig.vocabularyBookEnabled === true;
    showToast(cause instanceof Error ? cause.message : '设置保存失败');
  } finally {
    configBusy.value = false;
  }
}

function replaceEntry(next: VocabularyEntry): void {
  const index = entries.value.findIndex(entry => entry.id === next.id);
  if (index < 0) entries.value = [next, ...entries.value];
  else entries.value.splice(index, 1, next);
  scheduleTimeRefresh();
}

function reviewSessionState(): VocabularyReviewSessionState {
  return {
    queue: reviewQueue.value,
    completed: reviewIndex.value,
    answerVisible: reviewAnswerVisible.value,
  };
}

function applyReviewSession(session: VocabularyReviewSessionState): void {
  reviewQueue.value = session.queue;
  reviewIndex.value = session.completed;
  reviewAnswerVisible.value = session.answerVisible;
}

function reconcileActiveReviewQueue(): void {
  if (!reviewActive.value || actionBusy.value) return;
  applyReviewSession(reconcileVocabularyReviewSession(
    reviewSessionState(),
    entries.value,
    Date.now(),
  ));
}

function startReview(): void {
  applyReviewSession(createVocabularyReviewSession(reviewPlan.value));
  reviewStats.value = { reviewed: 0, good: 0, again: 0 };
  reviewStarted.value = reviewQueue.value.length > 0;
}

function finishReview(): void {
  reviewStarted.value = false;
  applyReviewSession(createVocabularyReviewSession([]));
}

async function rateReview(rating: VocabularyScheduledReviewRating): Promise<void> {
  const entry = currentReview.value;
  if (!entry || actionBusy.value || !reviewAnswerVisible.value) return;
  actionBusy.value = true;
  try {
    const result = await requestVocabulary<VocabularyReviewResult>({
      type: VOCABULARY_BOOK_MESSAGE,
      action: 'review',
      entryId: entry.id,
      rating,
    });
    replaceEntry(result.entry);
    reviewStats.value.reviewed += 1;
    reviewStats.value[rating] += 1;
    applyReviewSession(advanceVocabularyReviewSession(reviewSessionState(), entry.id));
  } catch (cause) {
    showToast(cause instanceof Error ? cause.message : '复习记录保存失败');
  } finally {
    try {
      await loadEntries();
    } finally {
      actionBusy.value = false;
      reconcileActiveReviewQueue();
    }
  }
}

async function setMastered(entry: VocabularyEntry): Promise<void> {
  if (actionBusy.value) return;
  actionBusy.value = true;
  try {
    const result = await requestVocabulary<VocabularyReviewResult>({ type: VOCABULARY_BOOK_MESSAGE, action: 'setMastery', entryId: entry.id });
    replaceEntry(result.entry);
    showToast(`${entry.term} 已标记为掌握`);
  } catch (cause) { showToast(cause instanceof Error ? cause.message : '更新失败'); }
  finally { actionBusy.value = false; }
}

async function relearn(entry: VocabularyEntry): Promise<void> {
  if (actionBusy.value) return;
  actionBusy.value = true;
  try {
    const result = await requestVocabulary<VocabularyReviewResult>({ type: VOCABULARY_BOOK_MESSAGE, action: 'relearn', entryId: entry.id });
    replaceEntry(result.entry);
    showToast(`${entry.term} 已回到学习队列`);
  } catch (cause) { showToast(cause instanceof Error ? cause.message : '更新失败'); }
  finally { actionBusy.value = false; }
}

async function removeEntry(entry: VocabularyEntry): Promise<void> {
  if (actionBusy.value) return;
  try { await ElMessageBox.confirm(translateLegacyText(
    `确认删除“${entry.term}”及其复习记录吗？`, normalizeUiLanguage(runtimeConfig.uiLanguage)),
    translateControlLabel('删除'), {type: 'warning', confirmButtonText: translateControlLabel('删除'), cancelButtonText: translateControlLabel('取消')}); }
  catch { return; }
  if (actionBusy.value) return;
  actionBusy.value = true;
  try {
    const snapshot = await requestVocabulary<VocabularyRemovalSnapshot | null>({
      type: VOCABULARY_BOOK_MESSAGE,
      action: 'removeWithSnapshot',
      entryId: entry.id,
    });
    if (!snapshot) throw new Error('词条已不存在');
    entries.value = entries.value.filter(item => item.id !== entry.id);
    undoExport.value = {
      format: VOCABULARY_BOOK_EXPORT_FORMAT,
      version: VOCABULARY_BOOK_EXPORT_VERSION,
      exportedAt: Date.now(),
      includesPrivateContext: true,
      entries: [snapshot.entry],
      reviewLogs: snapshot.reviewLogs,
    };
    scheduleTimeRefresh();
    showToast(`已删除 ${entry.term}`, true);
  } catch (cause) { showToast(cause instanceof Error ? cause.message : '删除失败'); }
  finally { actionBusy.value = false; }
}

async function undoRemove(): Promise<void> {
  const data = undoExport.value;
  if (!data || actionBusy.value) return;
  actionBusy.value = true;
  try {
    await requestVocabulary<VocabularyImportResult>({ type: VOCABULARY_BOOK_MESSAGE, action: 'importData', data });
    undoExport.value = null;
    await loadEntries();
    showToast('已恢复刚才删除的词条');
  } catch (cause) { showToast(cause instanceof Error ? cause.message : '恢复失败'); }
  finally { actionBusy.value = false; }
}

async function chooseAnkiContext(): Promise<boolean | null> {
  try {
    await ElMessageBox.confirm(
      '默认不导出收藏时的网页片段和来源。这些内容可能包含浏览隐私。',
      '导出到 Anki',
      {
        confirmButtonText: '不包含',
        cancelButtonText: '包含上下文',
        distinguishCancelAndClose: true,
        type: 'warning',
      },
    );
    return false;
  } catch (action) {
    return action === 'cancel' ? true : null;
  }
}

async function exportAnki(): Promise<void> {
  if (actionBusy.value) return;
  const includePrivateContext = await chooseAnkiContext();
  if (includePrivateContext === null) return;
  await closeMoreMenuAndFocus();
  actionBusy.value = true;
  try {
    const data = await requestVocabulary<VocabularyBookExport>({
      type: VOCABULARY_BOOK_MESSAGE,
      action: 'exportData',
      options: {includePrivateContext},
    });
    const rows = data.entries.map(entry => {
      const context = includePrivateContext ? entry.contexts.at(-1) : undefined;
      return [
        entry.term,
        entryTranslation(entry),
        context?.text || '',
        context?.sourceUrl || '',
        `fluentread ${entry.status}`,
      ];
    });
    const body = buildAnkiTsv(['Term', 'Meaning', 'Context', 'Source', 'Tags'], rows);
    downloadFile(
      `fluentread-anki-${new Date().toISOString().slice(0, 10)}.tsv`,
      `\uFEFF${body}`,
      'text/tab-separated-values;charset=utf-8',
    );
    showToast(`已导出 ${rows.length} 个 Anki 词条`);
  } catch (cause) {
    showToast(cause instanceof Error ? cause.message : 'Anki 导出失败');
  } finally {
    actionBusy.value = false;
  }
}

async function clearVocabulary(): Promise<void> {
  if (actionBusy.value || entries.value.length === 0) return;
  try {
    await ElMessageBox.confirm(
      '将删除全部单词、上下文和复习记录。设置和模型用量不受影响，此操作无法撤销。',
      '清空单词本？',
      {confirmButtonText: '确认清空', cancelButtonText: '取消', type: 'warning'},
    );
  } catch {
    return;
  }
  await closeMoreMenuAndFocus();
  actionBusy.value = true;
  try {
    await requestVocabulary<boolean>({type: VOCABULARY_BOOK_MESSAGE, action: 'clear'});
    entries.value = [];
    finishReview();
    scheduleTimeRefresh();
    showToast('单词本已清空');
  } catch (cause) {
    showToast(cause instanceof Error ? cause.message : '清空失败');
  } finally {
    actionBusy.value = false;
  }
}

async function closeMoreMenuAndFocus(): Promise<void> {
  const details = moreMenu.value;
  if (!details) return;
  details.open = false;
  await nextTick();
  details.querySelector<HTMLElement>('summary')?.focus();
}

function downloadFile(name: string, body: string, type: string): void {
  const url = URL.createObjectURL(new Blob([body], {type}));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function entryTranslation(entry: Pick<VocabularyEntry, 'translations'>): string {
  const preferred = entry.translations[targetLanguageKey.value];
  if (preferred?.text) return preferred.text;
  return Object.values(entry.translations).sort((left, right) => right.updatedAt - left.updatedAt)[0]?.text || '';
}
function latestContext(entry: VocabularyEntry): VocabularyContext | undefined { return entry.contexts[entry.contexts.length - 1]; }
function contextPreview(entry: VocabularyEntry): string {
  const text = latestContext(entry)?.text || '';
  return normalizeLearningSourceText(text) === normalizeLearningSourceText(entry.term) ? '' : text;
}
function sourceHost(value?: string): string {
  if (!value) return '';
  try { return new URL(value).hostname; } catch { return '收藏来源'; }
}
function statusLabel(status: VocabularyStatus): string { return ({ new: '新词', learning: '学习中', familiar: '熟悉', mastered: '已掌握' })[status]; }
function nextReviewLabel(entry: VocabularyEntry): string {
  if (entry.nextReviewAt === null) return '未安排复习';
  const delta = entry.nextReviewAt - currentTime.value;
  if (delta <= 0) return '现在可以复习';
  if (delta < 60 * 60 * 1000) return `${Math.max(1, Math.ceil(delta / 60000))} 分钟后`;
  if (delta < 24 * 60 * 60 * 1000) return `${Math.ceil(delta / 3600000)} 小时后`;
  return translate("learning.dueDays", normalizeUiLanguage(runtimeConfig.uiLanguage), {count: Math.ceil(delta / 86400000)});
}
function normalizeLanguageKey(value: unknown): string {
  const normalized = String(value ?? '').trim().replaceAll('_', '-').toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) ? normalized : '';
}
function goodIntervalLabel(entry: VocabularyEntry): string {
  return ['1 天后', '1 天后', '3 天后', '7 天后', '14 天后', '30 天后'][Math.min(5, entry.masteryLevel + 1)] || '30 天后';
}
function showToast(message: string, keepUndo = false): void {
  if (!lifecycle.isActive()) return;
  toastMessage.value = message;
  if (!keepUndo) undoExport.value = null;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastMessage.value = ''; undoExport.value = null; }, keepUndo ? 5000 : 2600);
}

function handleBookChanged(message: unknown): undefined {
  if (lifecycle.isActive() && (message as VocabularyBookChangedMessage)?.type === VOCABULARY_BOOK_CHANGED_MESSAGE) void loadEntries();
  return undefined;
}
function handleReviewKeyboard(event: KeyboardEvent): void {
  if (!lifecycle.isActive() || !reviewActive.value || actionBusy.value) return;
  const target = event.target as HTMLElement | null;
  if (target?.matches('input, textarea, select, button, a')) return;
  if (event.key === 'Escape') { event.preventDefault(); finishReview(); return; }
  if (event.code === 'Space' && currentReview.value && !reviewAnswerVisible.value) {
    event.preventDefault(); reviewAnswerVisible.value = true; return;
  }
  if (!reviewAnswerVisible.value) return;
  if (event.key === '1') { event.preventDefault(); void rateReview('again'); }
  if (event.key === '2') { event.preventDefault(); void rateReview('good'); }
}

let unsubscribeConfig: (() => void) | null = null;
onMounted(async () => {
  darkMedia = window.matchMedia('(prefers-color-scheme: dark)');
  darkMedia.addEventListener('change', applyTheme);
  await lifecycle.runAfterReady(configReady, async () => {
    betaEnabled.value = runtimeConfig.vocabularyBookEnabled;
    selectionTranslatorEnabled.value = runtimeConfig.selectionTranslatorMode !== 'disabled' || runtimeConfig.harness?.enabled === true;
    targetLanguageKey.value = normalizeLanguageKey(runtimeConfig.to);
    applyTheme();
    unsubscribeConfig = subscribeConfig(next => {
      betaEnabled.value = next.vocabularyBookEnabled;
      selectionTranslatorEnabled.value = next.selectionTranslatorMode !== 'disabled' || next.harness?.enabled === true;
      targetLanguageKey.value = normalizeLanguageKey(next.to);
      applyTheme();
    });
    browser.runtime.onMessage.addListener(handleBookChanged);
    browser.runtime.onMessage.addListener(handleEntrySpeechState);
    window.addEventListener('keydown', handleReviewKeyboard);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    await loadEntries();
  });
});

onBeforeUnmount(() => {
  lifecycle.dispose();
  stopEntrySpeech();
  unsubscribeConfig?.();
  browser.runtime.onMessage.removeListener(handleBookChanged);
  browser.runtime.onMessage.removeListener(handleEntrySpeechState);
  window.removeEventListener('keydown', handleReviewKeyboard);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  darkMedia?.removeEventListener('change', applyTheme);
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  if (timeRefreshTimer !== null) window.clearTimeout(timeRefreshTimer);
});
</script>

<style scoped>
.recall-draft { display:block; width:100%; box-sizing:border-box; padding:12px; margin:16px 0; border:1px solid var(--line); border-radius:10px; color:var(--ink); background:var(--surface-soft); font:inherit; resize:vertical; }
.recall-attempt { border-left:2px solid var(--brand); padding-left:12px; white-space:pre-wrap; }
.answer-reference-label { color:var(--muted); font-size:12px; }
.review-answer .study-entry-button { min-height: 32px; margin-top: 10px; padding: 0 11px; border: 1px solid var(--line); border-radius: 8px; color: var(--brand-strong); background: var(--surface-soft); cursor: pointer; font: inherit; font-size: 11px; }
.row-actions .study-entry-button { color:var(--brand); border-color:var(--brand); font-weight:600; }

.vocabulary-book { position: relative; display: grid; gap: 14px; color: var(--ink); }
.beta-panel, .privacy-note, .selection-reminder, .primary-actions, .toolbar, .review-shell { border: 0; background: transparent; }
.beta-panel { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0; }

.beta-copy { display: flex; min-width: 0; align-items: flex-start; gap: 12px; }
.beta-copy h3 { margin: 0; color: var(--muted); font-size: 12px; font-weight: 500; }
.beta-copy p { margin: 5px 0 0; max-width: 600px; color: var(--muted); font-size: 11px; line-height: 1.55; }
.beta-switch { position: relative; flex: none; width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px; background: var(--line); cursor: pointer; }
.beta-switch i { display: block; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 180ms ease; }
.beta-switch[aria-checked="true"] { background: var(--brand); }
.beta-switch[aria-checked="true"] i { transform: translateX(16px); }
.selection-reminder { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 0; color: var(--muted); font-size: 11px; line-height: 1.6; }
.selection-reminder button { flex: none; border: 0; padding: 0; color: var(--brand-strong); background: transparent; cursor: pointer; font: inherit; }
.privacy-note { display: flex; align-items: flex-start; gap: 8px; margin-top: 2px; padding: 12px 0 0; border-top: 1px solid var(--line); color: var(--muted); }
.privacy-note > span { display: flex; flex: none; padding-top: 1px; }
.privacy-note div { display: flex; flex-direction: column; }
.privacy-note strong { font-size: 11px; font-weight: 400; }
.privacy-note small { margin-top: 3px; color: var(--muted); font-size: 11px; line-height: 1.5; }
.privacy-note button { flex: none; margin-left: auto; padding: 0; border: 0; color: var(--muted); background: transparent; cursor: pointer; font-size: 11px; white-space: nowrap; }
.summary-grid { display: flex; flex-wrap: wrap; gap: 10px 24px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.summary-grid article { display: inline-flex; align-items: baseline; gap: 7px; padding: 0; }
.summary-grid span { color: var(--muted); font-size: 12px; font-weight: 400; }
.summary-grid strong { margin: 0; color: var(--ink); font-size: 15px; font-weight: 600; line-height: 1.4; }
.summary-grid small { display: none; }
.start-learning { display: inline-flex; align-items: center; min-height: 34px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); background: var(--surface); cursor: pointer; }
.start-learning strong { font-size: 12px; font-weight: 500; }
.start-learning small { font-size: 11px; color:var(--muted); }
.start-learning:disabled { opacity:.5; cursor:not-allowed; }
.primary-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 0; }
.start-review { display: inline-flex; align-items: center; min-height: 34px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; color: var(--brand-strong); background: var(--surface); cursor: pointer; }
.start-review:disabled { color: var(--muted); background: transparent; cursor: not-allowed; opacity: .6; }
.start-review > span:first-child { display: inline; }
.start-review > span:last-child { display: inline; }
.start-review strong { font-size: 12px; font-weight: 500; }
.start-review small { margin-top: 3px; font-size: 11px; opacity: .85; }
.secondary-actions { display: flex; align-items: stretch; gap: 8px; margin-left: auto; }
.refresh-button { min-width: 48px; min-height: 34px; padding: 0 10px; border: 0; border-radius: 8px; color: var(--muted); background: transparent; cursor: pointer; font-size: 11px; }
.book-more { position: relative; }
.book-more summary { display: grid; min-width: 48px; min-height: 34px; height: 100%; place-items: center; border: 0; border-radius: 8px; color: var(--muted); background: transparent; cursor: pointer; font-size: 11px; list-style: none; }
.book-more summary::-webkit-details-marker { display: none; }
.book-more[open] summary { border-color: color-mix(in srgb, var(--brand) 32%, var(--line)); color: var(--brand-strong); }
.book-more-menu { position: absolute; z-index: 5; top: calc(100% + 7px); right: 0; display: grid; min-width: 150px; padding: 6px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); box-shadow: 0 12px 30px rgba(31, 40, 61, .14); }
.book-more-menu button { min-height: 34px; padding: 0 9px; border: 0; border-radius: 8px; color: var(--ink); background: transparent; cursor: pointer; font-size: 11px; font-weight: 700; text-align: left; }
.book-more-menu button:hover { color: var(--brand-strong); background: var(--brand-soft); }
.book-more-menu button.danger { color: var(--fr-danger); }
.toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) 150px 150px; gap: 10px; padding: 0; border: 0; background: transparent; }
.search-field { display: flex; height: 42px; align-items: center; gap: 8px; padding: 0 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.search-field span { color: var(--muted); font-size: 17px; }
.search-field input { width: 100%; border: 0; outline: 0; color: var(--ink); background: transparent; font-size: 11px; }
.toolbar select { min-width: 0; padding: 0 10px; border: 1px solid var(--line); border-radius: 12px; color: var(--ink); background: var(--surface); font-size: 11px; }
.word-list { display: grid; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.word-row { display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 20px; padding: 16px; border: 0; border-bottom: 1px solid var(--line); background: transparent; }
.word-row:last-of-type { border-bottom: 0; }
.word-main { min-width: 0; }
.word-heading { display: flex; min-width: 0; align-items: baseline; gap: 9px; }
.word-heading h3 { min-width: 0; margin: 0; overflow-wrap: anywhere; color: var(--ink); font-size: 19px; }
.vocabulary-speak { flex: none; display: grid; place-items: center; width: 28px; height: 28px; padding: 5px; border: 0; border-radius: 7px; background: var(--brand-soft); color: var(--brand-strong); cursor: pointer; }
.vocabulary-speak svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.vocabulary-speak:hover, .vocabulary-speak:focus-visible { background: var(--brand-soft); outline: 2px solid color-mix(in srgb, var(--brand) 32%, var(--line)); outline-offset: 1px; }
.word-heading > span { color: var(--muted); font-family: Georgia, serif; font-size: 12px; }
.word-main > p { margin: 7px 0 0; overflow-wrap: anywhere; color: var(--ink); font-size: 12px; font-weight: 650; white-space: pre-wrap; }
.context-preview { display: -webkit-box; margin-top: 8px; overflow: hidden; overflow-wrap: anywhere; color: var(--muted); font-size: 11px; line-height: 1.5; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.word-meta { display: flex; flex-wrap: wrap; gap: 5px 10px; margin-top: 9px; color: var(--muted); font-size: 11px; }
.word-meta a { color: var(--brand-strong); text-decoration: none; }
.word-progress { display: flex; align-items: flex-end; flex-direction: column; }
.word-progress > small { margin-top: 7px; color: var(--muted); font-size: 11px; }
.status-pill { display: inline-flex; padding: 4px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.status-new { color: var(--muted); background: var(--surface-soft); }
.status-learning { color: var(--muted); background: var(--surface-soft); }
.status-familiar { color: var(--muted); background: var(--surface-soft); }
.status-mastered { color: var(--muted); background: var(--surface-soft); }
.row-actions { display: flex; gap: 6px; margin-top: auto; padding-top: 14px; }
.row-actions button, .pagination button { min-height: 30px; padding: 0 9px; border: 1px solid var(--line); border-radius: 9px; color: var(--ink); background: var(--surface); cursor: pointer; font-size: 11px; font-weight: 700; }
.row-actions button:hover, .pagination button:hover { border-color: color-mix(in srgb, var(--brand) 32%, var(--line)); color: var(--brand-strong); }
button.danger { color: var(--fr-danger); }
button:disabled { cursor: not-allowed; opacity: .55; }
.pagination { display: flex; align-items: center; justify-content: center; gap: 12px; padding-top: 7px; }
.pagination span { color: var(--muted); font-size: 11px; }
.eyebrow { display: block; margin-bottom: 5px; color: var(--brand-strong); font-size: 11px; font-weight: 600; letter-spacing: .1em; }
.empty-state { display: grid; min-height: 210px; place-items: center; align-content: center; gap: 7px; padding: 30px; border: 1px solid var(--line); border-radius: 14px; color: var(--muted); background: var(--surface-soft); text-align: center; }
.empty-state > span { font-size: 28px; }
.empty-state h3, .empty-state p { margin: 0; }
.empty-state h3 { color: var(--ink); font-size: 14px; }
.empty-state p { max-width: 420px; font-size: 11px; line-height: 1.55; }
.empty-state button { min-height: 32px; margin-top: 3px; padding: 0 11px; border: 1px solid color-mix(in srgb, var(--brand) 32%, var(--line)); border-radius: 9px; color: var(--brand-strong); background: var(--surface); cursor: pointer; font-size: 11px; font-weight: 600; }
.loading-ring { width: 24px; height: 24px; border: 2px solid color-mix(in srgb, var(--brand) 32%, var(--line)); border-top-color: var(--brand); border-radius: 50%; animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.error-state { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 14px; border: 1px solid color-mix(in srgb, var(--fr-danger) 32%, var(--line)); border-radius: 14px; color: var(--fr-danger); background: var(--fr-danger-soft); font-size: 11px; }
.error-state button { border: 0; color: inherit; background: transparent; cursor: pointer; font-weight: 600; }
.review-shell { padding: 0; background: transparent; }
.review-header { display: flex; align-items: center; justify-content: space-between; }
.review-header > div { display: flex; align-items: baseline; gap: 9px; }
.review-header .eyebrow { margin: 0; }
.review-header strong { font-size: 11px; }
.review-header button { border: 0; color: var(--muted); background: transparent; cursor: pointer; font-size: 11px; }
.review-card { position: relative; display: grid; min-height: 360px; margin-top: 14px; padding: 24px; border: 1px solid color-mix(in srgb, var(--brand) 32%, var(--line)); border-radius: 14px; background: var(--surface); place-items: center; align-content: center; text-align: center; box-shadow: none; }
.review-card > .status-pill { position: absolute; align-self: start; justify-self: start; }
.review-prompt { min-width: 0; max-width: 620px; }
.review-prompt h3 { margin: 0; overflow-wrap: anywhere; color: var(--ink); font-size: 34px; }
.review-prompt small { display: block; margin-top: 10px; color: var(--muted); font-size: 11px; }
.cloze-context { margin: 25px 0 0; overflow-wrap: anywhere; color: var(--ink); font-family: Georgia, serif; font-size: 20px; line-height: 1.65; }
.reveal-button { min-height: 43px; margin-top: 26px; padding: 0 18px; border: 0; border-radius: 12px; color: #fff; background: var(--brand); cursor: pointer; font-size: 11px; font-weight: 600; }
.reveal-button kbd { margin-left: 8px; padding: 2px 6px; border: 1px solid rgba(255,255,255,.35); border-radius: 5px; background: rgba(255,255,255,.12); font: inherit; font-size: 8px; }
.review-answer { width: min(100%, 620px); min-width: 0; margin-top: 20px; }
.answer-heading { display: flex; min-width: 0; align-items: baseline; justify-content: center; gap: 10px; }
.answer-heading h3 { min-width: 0; margin: 0; overflow-wrap: anywhere; color: var(--ink); font-size: 30px; }
.answer-heading span { color: var(--muted); font-family: Georgia, serif; font-size: 14px; }
.answer-translation { margin: 10px 0 0; overflow-wrap: anywhere; color: var(--brand-strong); font-size: 18px; font-weight: 600; white-space: pre-wrap; }
.answer-context { margin: 14px 0 0; padding: 10px 12px; overflow-wrap: anywhere; border-radius: 10px; color: var(--muted); background: var(--surface-soft); font-size: 11px; line-height: 1.55; text-align: left; }
.review-answer > a { display: inline-block; margin-top: 8px; color: var(--brand-strong); font-size: 11px; text-decoration: none; }
.review-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 22px; }
.review-actions button { display: grid; min-height: 60px; grid-template-columns: 22px 1fr; grid-template-rows: 1fr 1fr; padding: 9px 12px; border: 1px solid var(--line); border-radius: 13px; background: var(--surface); text-align: left; cursor: pointer; }
.review-actions button > span { grid-row: 1 / 3; align-self: center; color: var(--muted); font-size: 11px; }
.review-actions strong { font-size: 11px; }
.review-actions small { color: var(--muted); font-size: 8.5px; }
.review-actions .again:hover { border-color: color-mix(in srgb, var(--brand) 32%, var(--line)); background: var(--fr-danger-soft); }
.review-actions .good:hover { border-color: color-mix(in srgb, var(--fr-success) 32%, var(--line)); background: var(--fr-success-soft); }
.review-complete { display: grid; min-height: 340px; place-items: center; align-content: center; gap: 8px; }
.review-complete > span { display: grid; width: 54px; height: 54px; place-items: center; border-radius: 50%; color: #fff; background: var(--fr-success); font-size: 25px; }
.review-complete h3, .review-complete p { margin: 0; }
.review-complete p { color: var(--muted); font-size: 11px; }
.review-complete button { min-height: 38px; margin-top: 10px; padding: 0 15px; border: 0; border-radius: 11px; color: #fff; background: var(--brand); cursor: pointer; font-size: 11px; font-weight: 600; }
.book-toast { position: fixed; z-index: 30; right: 28px; bottom: 24px; display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-radius: 11px; color: #fff; background: #252a33; box-shadow: 0 12px 30px rgba(0,0,0,.2); font-size: 11px; }
.book-toast button { padding: 0; border: 0; color: #ffb8ce; background: transparent; cursor: pointer; font: inherit; font-weight: 600; }
@media (max-width: 900px) {
  .summary-grid { gap: 8px 20px; }
  .toolbar { grid-template-columns: 1fr 1fr; }
  .search-field { grid-column: 1 / -1; }
  .word-row { grid-template-columns: minmax(0, 1fr); }
  .word-progress { align-items: flex-start; }
}
@media (max-width: 560px) {
  .beta-panel { align-items: flex-start; }
  .word-heading, .answer-heading { flex-wrap: wrap; }
  .summary-grid { gap: 8px 20px; }
  .toolbar { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .search-field { grid-column: 1 / -1; }
  .primary-actions { gap: 8px; }
  .secondary-actions { min-height: 34px; }
  .refresh-button, .book-more { flex: none; }
  .book-more-menu { right: 0; left: auto; }
  .review-card { padding: 18px 13px; }
  .review-actions { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) { .beta-switch i, .loading-ring { transition: none; animation: none; } }
</style>
