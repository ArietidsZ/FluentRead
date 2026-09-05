<!--
 * @file src/features/reading-assistant/ui/ReadingPanel.vue
 * 文件职责：在原有划词卡内提供读懂、拆句、用法、练习和连续追问，保持阅读上下文与原生选区体验。
 * 主要内容：只在明确点击后发送 Harness 请求，以代次和取消消息保护回答归属；展示简短结果、错误重试、停止和复制，并把显式收藏交给现有单词本。
 * 模块边界：不持有模型密钥、不扫描页面、不直接请求供应商，也不另建持久会话；父划词组件负责选区与 Shadow UI 生命周期。
 -->
<template>
  <div class="fr-reading" data-reading-panel>
    <details v-if="!privateContext" class="fr-reading-sessions" :open="historyOnly">
      <summary>最近会话</summary>
      <div class="fr-reading-session-list">
        <button v-for="item in sessions" :key="item.id" type="button" class="fr-reading-session" @click="restoreSession(item.id)">{{ item.text }}<small>{{ item.turnCount }} 轮</small></button>
        <small v-if="!sessions.length" class="fr-reading-empty">暂无最近会话</small>
        <button v-if="hasMoreSessions" type="button" class="fr-reading-more" @click="loadMoreSessions">加载更多</button>
      </div>
    </details>
    <details v-if="selectedSession" class="fr-reading-session-detail"><summary>查看完整问答（{{ selectedSession.turns.length }} 轮）</summary><div v-for="turn in selectedSession.turns" :key="turn.id" class="fr-reading-turn"><small>{{ actionLabelFor(turn.intent) }} · {{ statusLabel(turn.status) }} · {{ formatDate(turn.createdAt) }}</small><p v-if="turn.question">{{ turn.question }}</p><p>{{ turn.answer }}</p></div></details>
    <div class="fr-reading-source">
      <p>{{ activeText }}</p>
      <button v-if="!historicalText && selection.sentence !== selection.text && !wholeSentence" type="button" @click="expandSentence">理解整句</button>
      <span v-else-if="wholeSentence">已展开到整句</span>
    </div>
    <div class="fr-reading-actions" role="group" aria-label="学习方式">
      <button v-for="action in actions" :key="action.id" type="button" :aria-pressed="intent === action.id" @click="startAction(action.id)">{{ action.label }}</button>
    </div>
    <div class="fr-reading-result" aria-live="polite" aria-atomic="false">
      <p v-if="busy" class="fr-reading-status" role="status"><span class="fr-reading-pulse" :class="{'fr-reading-static': !animations}" aria-hidden="true" />正在{{ actionLabel }}…<button type="button" @click="stop">停止</button></p>
      <div v-if="error" class="fr-reading-error" role="alert">
        <p>{{ error }}</p>
        <div><button type="button" @click="retry">重试</button><button type="button" @click="openSettings">设置模型</button></div>
      </div>
      <p v-if="stopped && !busy" class="fr-reading-status" role="status">已停止<button type="button" @click="retry">重新生成</button></p>
      <p v-if="currentQuestion && answer" class="fr-reading-question">{{ currentQuestion }}</p>
      <div v-if="answer" class="fr-reading-answer" :aria-busy="busy">
        <p v-for="(block, index) in blocks" :key="index" :class="`fr-reading-${block.kind}`">
          <template v-for="(span, spanIndex) in readingAnswerSpans(block.text)" :key="spanIndex"><strong v-if="span.strong">{{ span.text }}</strong><span v-else>{{ span.text }}</span></template>
        </p>
      </div>
      <p v-if="!busy && !answer && !error && !stopped" class="fr-reading-hint">选一种方式，理解这段表达。</p>
    </div>
    <footer v-if="answer && !busy" class="fr-reading-footer">
      <span :title="model">{{ model }}</span>
      <button type="button" @click="copyAnswer">{{ copied ? '已复制' : '复制' }}</button>
      <button v-if="canSaveWord" type="button" :disabled="saving || saved" @click="saveWord">{{ saved ? '已加入单词本' : '加入单词本' }}</button>
    </footer>
    <form class="fr-reading-followup" @submit.prevent="ask">
      <input v-model="question" :disabled="busy" maxlength="1000" aria-label="继续追问" placeholder="哪里还不明白？也可以写下你的练习答案" @keydown.stop @keyup.stop @input="feedback = ''" />
      <button type="submit" :disabled="busy || !question.trim()" aria-label="发送追问" title="发送追问">↑</button>
    </form>
    <p v-if="feedback" class="fr-reading-feedback" role="status">{{ feedback }}</p>
    <p v-if="sessionWarning" class="fr-reading-feedback" role="status">{{ sessionWarning }}</p>
    <div class="fr-reading-context"><span>{{ privateContext ? '隐私模式：不保存会话' : '会话保存在本机 30 天' }}</span><button type="button" aria-label="打开 DeepSeek Harness 设置" @click="openSettings">设置</button></div>
  </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import browser from 'webextension-polyfill';
import {HARNESS_ACTIONS, type HarnessActionId, type HarnessPreferences} from '@/src/core/config/harness';
import {readingAnswerBlocks, readingAnswerSpans} from '../answerFormat';
import type {ReadingSelection, ReadingTurn} from '../types';
import {getHarnessSession, listHarnessSessions, streamReading} from '../client';
import type {HarnessSession, HarnessSessionSummary} from '@/src/services/harness/sessionTypes';
import {normalizeEnglishWord} from '@/src/features/selection-translation/core/public';
import {VOCABULARY_BOOK_MESSAGE, type VocabularyBookResponse} from '@/src/features/vocabulary/protocol';

const props = defineProps<{
  selection: ReadingSelection;
  preferences: HarnessPreferences;
  active: boolean;
  historyOnly?: boolean;
  targetLanguage: string;
  vocabularyEnabled: boolean;
  privateContext: boolean;
  animations: boolean;
}>();
const emit = defineEmits<{resize: []}>();
const intent = ref<HarnessActionId>(props.preferences.defaultAction);
const wholeSentence = ref(false);
const historicalText = ref('');
const historicalContext = ref('');
const sessionWarning = ref('');
const activeText = computed(() => historicalText.value || (wholeSentence.value ? props.selection.sentence : props.selection.text));
const actions = computed(() => HARNESS_ACTIONS.filter(action => props.preferences.actions.includes(action.id)));
const actionLabel = computed(() => HARNESS_ACTIONS.find(action => action.id === intent.value)?.label ?? '理解');
const question = ref('');
const currentQuestion = ref('');
const answer = ref('');
const busy = ref(false);
const stopped = ref(false);
const error = ref('');
const model = ref('');
const copied = ref(false);
const saved = ref(false);
const saving = ref(false);
const feedback = ref('');
const sessions = ref<HarnessSessionSummary[]>([]);
const selectedSession = ref<HarnessSession | null>(null);
const sessionOffset = ref(0);
const hasMoreSessions = ref(false);
const actionLabels: Record<string, string> = {meaning: '读懂', grammar: '拆句', usage: '用法', practice: '练习'};
const statusLabels: Record<string, string> = {streaming: '进行中', completed: '已完成', stopped: '已停止', error: '失败'};
const actionLabelFor = (value: string) => actionLabels[value] || '学习';
const statusLabel = (value: string) => statusLabels[value] || '未知状态';
const formatDate = (value: number) => new Intl.DateTimeFormat(undefined, {month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit'}).format(value);
const history: ReadingTurn[] = [];
const blocks = computed(() => readingAnswerBlocks(answer.value));
const canSaveWord = computed(() => props.vocabularyEnabled && !props.privateContext && Boolean(normalizeEnglishWord(activeText.value)));
let pendingId = '';
let generation = 0;
let lastQuestion = '';
let lastHistory: ReadingTurn[] = [];
let copyTimer: ReturnType<typeof setTimeout> | undefined;
let streamHandle: {cancel: () => void} | undefined;
let sessionId = '';

function cancelRequest(): void {
  generation += 1;
  streamHandle?.cancel();
  streamHandle = undefined;
  if (pendingId) void browser.runtime.sendMessage({type: 'fluentReadHarness', action: 'cancel', requestId: pendingId}).catch(() => undefined);
  pendingId = '';
  busy.value = false;
}
function stop(): void { cancelRequest(); stopped.value = true; }
async function run(prompt: string, turns: ReadingTurn[]): Promise<void> {
  cancelRequest();
  const token = generation;
  const requestId = `reading-${crypto.randomUUID()}`;
  pendingId = requestId;
  lastQuestion = prompt;
  lastHistory = turns.map(turn => ({...turn}));
  busy.value = true;
  error.value = '';
  stopped.value = false;
  copied.value = false;
  feedback.value = '';
  try {
    streamHandle = streamReading({
      type: 'fluentReadHarness', action: 'run', requestId,
      selection: {text: activeText.value, context: props.preferences.contextMode === 'paragraph' ? props.selection.context : '', sentence: ''},
      intent: intent.value, question: prompt, history: turns, ...(sessionId ? {sessionId} : {}),
    }, {
      progress: progress => {
        if (token !== generation) return;
        if (progress.kind === 'model') model.value = progress.model;
        if (progress.kind === 'text') answer.value = progress.text;
        if (progress.kind === 'session') { sessionId = progress.persistent ? (progress.sessionId || '') : ''; if (progress.warning) sessionWarning.value = progress.warning; }
      },
      result: response => {
        if (token !== generation) return;
        busy.value = false;
        pendingId = '';
        streamHandle = undefined;
        if (!response.success) { if (response.cancelled) stopped.value = true; else error.value = response.error; return; }
        currentQuestion.value = prompt;
        answer.value = response.text;
        model.value = response.model;
        if (response.sessionId) sessionId = response.sessionId;
        if (response.persistenceWarning) sessionWarning.value = response.persistenceWarning;
        history.splice(0, history.length, ...turns, {question: prompt || actionLabel.value, answer: response.text});
        if (history.length > 4) history.splice(0, history.length - 4);
      },
      error: failure => {
        if (token !== generation) return;
        busy.value = false;
        pendingId = '';
        streamHandle = undefined;
        if (!stopped.value) error.value = failure.message;
      },
    });
  } catch (failure) {
    if (token === generation) { busy.value = false; pendingId = ''; error.value = failure instanceof Error ? failure.message : '请求失败，请重试。'; }
  }
}
function startAction(action: HarnessActionId, preserveHistory = true): void {
  intent.value = action;
  answer.value = '';
  currentQuestion.value = '';
  if (!preserveHistory) history.splice(0);
  saved.value = false;
  void run('', []);
}
async function restoreSession(id: string): Promise<void> {
  const restoreGeneration = generation + 1;
  cancelRequest();
  let session: HarnessSession | null;
  try { session = await getHarnessSession(id); } catch { feedback.value = '读取会话失败，请重试。'; return; }
  if (restoreGeneration !== generation) return;
  if (!session) return;
  selectedSession.value = session;
  historicalText.value = session.text;
  historicalContext.value = session.context;
  sessionId = session.id;
  wholeSentence.value = false;
  currentQuestion.value = session.turns.at(-1)?.question || '';
  answer.value = session.turns.at(-1)?.answer || '';
  intent.value = session.turns.at(-1)?.intent || session.intent;
  model.value = session.turns.at(-1)?.model || '';
  history.splice(0, history.length, ...session.turns.filter(turn => turn.status === 'completed').map(turn => ({question: turn.question, answer: turn.answer})));
  lastQuestion = currentQuestion.value;
  lastHistory = history.map(turn => ({...turn}));
  error.value = ''; stopped.value = false; saved.value = false;
  feedback.value = '已恢复会话，可继续提问。';
}
function expandSentence(): void { wholeSentence.value = true; sessionId = ''; historicalText.value = ''; startAction(intent.value, false); }
function ask(): void {
  const prompt = question.value.trim();
  if (!prompt || busy.value) return;
  question.value = '';
  void run(prompt, history.map(turn => ({...turn})));
}
function retry(): void { void run(lastQuestion, lastHistory); }
function openSettings(): void { void browser.runtime.sendMessage({type: 'openOptionsPage', section: 'settings-harness'}).catch(() => { feedback.value = '请从扩展菜单打开 DeepSeek Harness 设置。'; }); }
async function copyAnswer(): Promise<void> {
  try {
    await navigator.clipboard.writeText(`${activeText.value}\n\n${answer.value}`);
    copied.value = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copied.value = false; }, 1800);
  } catch { feedback.value = '复制失败，可以选中回答后复制。'; }
}
async function saveWord(): Promise<void> {
  if (!canSaveWord.value || saving.value || !answer.value) return;
  saving.value = true;
  try {
    const response = await browser.runtime.sendMessage({type: VOCABULARY_BOOK_MESSAGE, action: 'upsert', input: {
      sourceLanguage: 'en', targetLanguage: props.targetLanguage, term: activeText.value,
      translation: answer.value, context: {text: historicalContext.value || props.selection.context || activeText.value},
    }}) as VocabularyBookResponse;
    if (!response.success) throw new Error(response.error.message);
    saved.value = true;
  } catch (failure) { feedback.value = failure instanceof Error ? failure.message : '收藏失败，请重试。'; }
  finally { saving.value = false; }
}
watch(() => JSON.stringify(props.preferences), () => { cancelRequest(); stopped.value = true; });
watch(() => props.selection.text, () => { historicalText.value = ''; historicalContext.value = ''; selectedSession.value = null; sessionId = ''; });
watch(() => props.active, active => { if (!active && busy.value) stop(); });
watch([busy, error, answer, stopped, feedback, wholeSentence], () => emit('resize'), {flush: 'post'});
async function loadMoreSessions(): Promise<void> {
  if (props.privateContext) return;
  const result = await listHarnessSessions(sessionOffset.value);
  sessions.value = [...sessions.value, ...result.sessions];
  sessionOffset.value += result.sessions.length;
  hasMoreSessions.value = result.hasMore;
}
onMounted(() => {
  if (!props.privateContext) void loadMoreSessions().catch(() => undefined);
  if (!props.historyOnly) startAction(intent.value);
});
onBeforeUnmount(() => { cancelRequest(); clearTimeout(copyTimer); history.splice(0); });
</script>

<style scoped>
.fr-reading { color: #35333c; font: 13px/1.7 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.fr-reading-sessions { margin: 0 0 10px; border-bottom: 1px solid #eee8ec; }
.fr-reading-sessions summary { padding: 3px 0 7px; color: #8b7981; cursor: pointer; font-size: 11px; }
.fr-reading-session-list { display: grid; gap: 4px; padding-bottom: 8px; }
.fr-reading-session { display: flex; justify-content: space-between; gap: 8px; width: 100%; overflow: hidden; text-align: left; color: #766672; background: #faf7f9; font-size: 11px; }
.fr-reading-session small, .fr-reading-empty { color: #a0959d; font-size: 10px; }
.fr-reading-session-detail { max-height: 180px; margin: 0 0 10px; overflow: auto; border-bottom: 1px solid #eee8ec; }
.fr-reading-session-detail summary { padding: 4px 0 7px; color: #8b7981; cursor: pointer; font-size: 11px; }
.fr-reading-turn { padding: 7px 0; border-top: 1px solid #f0eaee; overflow-wrap: anywhere; }
.fr-reading-turn small { color: #a0959d; font-size: 10px; }
.fr-reading-turn p { margin: 3px 0; }
.fr-reading button, .fr-reading input { font: inherit; }
.fr-reading button { cursor: pointer; border: 0; background: none; color: #826573; padding: 3px 6px; border-radius: 6px; }
.fr-reading button:focus-visible, .fr-reading input:focus-visible { outline: 2px solid #cd527f; outline-offset: 2px; }
.fr-reading button:disabled { opacity: .5; cursor: default; }
.fr-reading-source { border-left: 2px solid #e6c3d0; padding: 0 0 0 10px; margin: 2px 0 14px; }
.fr-reading-source p { margin: 0; max-height: 90px; overflow: auto; font-size: 13px; color: #69616b; user-select: text; white-space: pre-wrap; overflow-wrap: anywhere; }
.fr-reading-source button, .fr-reading-source > span { font-size: 11px; padding: 4px 0 0; color: #a64b6e; }
.fr-reading-actions { display: flex; gap: 4px; padding-bottom: 12px; }
.fr-reading-actions button { flex: 1; color: #77707a; background: #f5f3f5; padding: 5px 2px; }
.fr-reading-actions button[aria-pressed='true'] { background: #f9e7ee; color: #9d3e61; font-weight: 600; }
.fr-reading-result { min-height: 50px; }
.fr-reading-status { display: flex; align-items: center; gap: 8px; color: #8b7981; font-size: 12px; }
.fr-reading-status button { margin-left: auto; }
.fr-reading-pulse { width: 6px; height: 6px; border-radius: 50%; background: #c76688; animation: fr-reading-breathe 1.4s ease-in-out infinite; }
.fr-reading-static { animation: none; }
.fr-reading-hint, .fr-reading-feedback { font-size: 12px; color: #8b7981; }
.fr-reading-error { font-size: 12px; color: #b44753; background: #fff4f4; padding: 8px 10px; border-radius: 9px; }
.fr-reading-error p { margin: 0 0 4px; }
.fr-reading-question { border-bottom: 1px solid #eee8ec; padding-bottom: 8px; color: #986077; user-select: text; overflow-wrap: anywhere; }
.fr-reading-answer { user-select: text; overflow-wrap: anywhere; }
.fr-reading-answer p { margin: 0 0 9px; }
.fr-reading-answer .fr-reading-heading { margin-top: 15px; font-weight: 650; }
.fr-reading-answer .fr-reading-item { padding-left: 12px; position: relative; }
.fr-reading-item::before { content: '·'; position: absolute; left: 0; color: #b2748b; }
.fr-reading-footer { display: flex; gap: 5px; align-items: center; margin: 8px 0; font-size: 11px; }
.fr-reading-footer > span { color: #9b9199; margin-right: auto; max-width: 48%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fr-reading-followup { display: flex; gap: 6px; margin-top: 12px; padding: 5px 5px 5px 10px; border: 1px solid #eae2e7; border-radius: 11px; }
.fr-reading-followup input { min-width: 0; flex: 1; width: 100%; border: 0; outline: none; color: inherit; background: transparent; font-size: 12px; user-select: text; }
.fr-reading-followup input::placeholder { color: #a79ba4; font-size: 11px; }
.fr-reading-followup button { background: #b85579; color: white; width: 27px; height: 27px; line-height: 20px; }
.fr-reading-context { display: flex; align-items: center; gap: 8px; margin-top: 7px; font-size: 10px; color: #a0959d; }
.fr-reading-context button { margin-left: auto; font-size: 10px; }
:global(.fr-dark-theme) .fr-reading { color: #e6e0e8; }
:global(.fr-dark-theme) .fr-reading-source p { color: #b5aab6; }
:global(.fr-dark-theme) .fr-reading-actions button { background: #38313c; color: #bdb0c1; }
:global(.fr-dark-theme) .fr-reading-actions button[aria-pressed='true'] { background: #50313f; color: #f1b6ce; }
:global(.fr-dark-theme) .fr-reading-followup { border-color: #554651; }
:global(.fr-dark-theme) .fr-reading-error { background: #482e35; color: #f5acb6; }
@keyframes fr-reading-breathe { 50% { opacity: .3; } }
@media (prefers-reduced-motion: reduce) { .fr-reading-pulse { animation: none; } }
</style>
