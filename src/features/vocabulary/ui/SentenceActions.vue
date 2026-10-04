<!--
 * @file src/features/vocabulary/ui/SentenceActions.vue
 * 文件职责：为停留高亮的双语句子提供按需展开的播放、收藏、复制和收藏列表入口。
 * 主要内容：等待稳定停留后只显示小入口，点击才展开和查询收藏；按鼠标所在一侧朗读与复制，保持进入工具条时的句子身份，沿用朗读后台并隔离迟到响应。
 * 模块边界：不改动原句或网页布局，不自动生成解释或发送模型请求；存储与语言清洗由现有后台负责。
 -->
<template>
  <div v-if="sentence" ref="panel" class="sentence-actions" :class="{dark, compact: !expanded}" :style="position" :role="expanded ? 'toolbar' : undefined" :aria-label="expanded ? '句子听读与收藏' : undefined" @keydown.esc.stop="close">
    <button v-if="!expanded" type="button" class="sentence-entry" aria-label="句子操作" title="句子操作" :aria-expanded="false" @click="expand">⋯</button>
    <div v-else class="sentence-buttons">
      <button type="button" @click="play">{{ playing ? '停止' : sentence.side === 'translation' ? '播放译文' : '播放原文' }}</button>
      <button type="button" :disabled="saving || privateContext || Boolean(savedId)" @click="save">{{ saving ? '收藏中…' : savedId ? '已收藏' : '收藏句子' }}</button>
      <button type="button" @click="copy">复制</button>
      <button type="button" title="查看收藏的句子" @click="openBook">收藏列表 ↗</button>
    </div>
    <span v-if="expanded && (notice || privateContext)" class="sentence-notice" role="status">{{ privateContext ? '无痕窗口不保存收藏' : notice }}</span>
  </div>
</template>
<script setup lang="ts">
import {computed, onBeforeUnmount, ref, shallowRef} from 'vue';
import browser from 'webextension-polyfill';
import {config, requestConfigPatch, subscribeConfig} from '@/src/services/config/store';
import {detectlang} from '@/src/core/language/detect';
import {subscribeHighlightedSentence, type HighlightedSentence} from '@/src/features/full-page-translation/highlight/public';
import {createSelectionTtsClientRequestId, createSelectionTtsContentController, normalizeSpeechLanguage} from '@/src/features/selection-translation/speech/public';
import {VOCABULARY_BOOK_MESSAGE, normalizeLearningSourceText, type VocabularyEntry, type VocabularyBookResponse} from '../learningModel';

const sentence = shallowRef<HighlightedSentence | null>(null);
const expanded = ref(false);
const panel = ref<HTMLElement>();
const savedId = ref('');
const notice = ref('');
const saving = ref(false);
const playing = ref(false);
const privateContext = browser.extension?.inIncognitoContext === true;
const dark = ref(config.theme === 'dark' || (config.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches));
const position = computed(() => ({left: `${Math.max(8, Math.min(sentence.value?.rect.left ?? 8, window.innerWidth - (expanded.value ? 330 : 40)))}px`, top: `${Math.max(8, Math.min((sentence.value?.rect.bottom ?? 0) + 6, window.innerHeight - (expanded.value ? 90 : 40)))}px`}));
const sendMessage = browser.runtime.sendMessage.bind(browser.runtime);
const messagePort = browser.runtime.onMessage;
const speech = createSelectionTtsContentController({createClientRequestId: createSelectionTtsClientRequestId, stopRemote: clientRequestId => sendMessage({type:'selectionTtsStop', clientRequestId})});
let active = true;
let audio: HTMLAudioElement | undefined;
let audioUrl = '';
let utterance: SpeechSynthesisUtterance | undefined;
let revision = 0;
let hovered: HighlightedSentence | null = null;
let revealTimer: ReturnType<typeof setTimeout> | undefined;
let playback: {text: string; language: string} | undefined;
function language(text: string): string {return config.from && config.from !== 'auto' ? config.from : detectlang(text);}
function selectedText(current: HighlightedSentence): string {return current.side === 'translation' ? current.translationText : current.sourceText;}
function clearReveal(): void {if (revealTimer !== undefined) clearTimeout(revealTimer); revealTimer = undefined;}
function stop(notify = true): void {
  speech.stop(notify);
  audio?.pause(); audio?.removeAttribute('src'); audio = undefined;
  if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = '';
  if (utterance) window.speechSynthesis?.cancel(); utterance = undefined;
  playing.value = false;
  playback = undefined;
}
function close(): void {revision++; clearReveal(); stop(); sentence.value = null; hovered = null; expanded.value = false; savedId.value = ''; notice.value = '';}
function fallback(current: {text: string; language: string}): void {
  stop(false);
  if (!active || !sentence.value) return;
  if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {notice.value = '朗读暂时不可用，请重试。'; return;}
  const next = new SpeechSynthesisUtterance(current.text);
  next.lang = current.language;
  next.onend = () => {if (utterance === next) stop(false);};
  next.onerror = () => {if (utterance === next) {stop(false); notice.value = '朗读未完成，请重试。';}};
  utterance = next; playing.value = true;
  try {window.speechSynthesis.speak(next);} catch {stop(false); notice.value = '朗读暂时不可用，请重试。';}
}
async function play(): Promise<void> {
  const current = sentence.value;
  if (!current) return;
  const wasPlaying = playing.value; stop(); if (wasPlaying) return;
  notice.value = ''; playing.value = true;
  const selected = {text: selectedText(current), language: normalizeSpeechLanguage(current.side === 'translation' ? config.to : language(current.sourceText))};
  playback = selected;
  const request = speech.beginRemoteRequest();
  try {
    const response = await sendMessage({type:'selectionTts', ...selected, clientRequestId:request.clientRequestId}) as {success?: boolean; transport?: string; audioBase64?: string; contentType?: string};
    const result = speech.completeRemoteRequest(request, response);
    if (result === 'stale' || result === 'offscreen') return;
    if (result === 'failed' || !response.audioBase64) {fallback(selected); return;}
    audioUrl = URL.createObjectURL(new Blob([Uint8Array.from(atob(response.audioBase64), c => c.charCodeAt(0))], {type:response.contentType || 'audio/mpeg'}));
    const next = new Audio(audioUrl); audio = next;
    next.onended = () => {if (audio === next) stop(false);};
    next.onerror = () => {if (audio === next) fallback(selected);};
    await next.play();
  } catch {if (speech.rejectRemoteRequest(request)) fallback(selected);}
}
function playbackState(message: unknown): undefined {
  const state = speech.matchRemoteState(message);
  if (state === 'error' && playback) fallback(playback);
  else if (state) stop(false);
  return undefined;
}
async function save(): Promise<void> {
  const current = sentence.value;
  if (!current || privateContext || saving.value || savedId.value) return;
  const owner = revision; saving.value = true; notice.value = '';
  try {
    if (!config.vocabularyBookEnabled) await requestConfigPatch({vocabularyBookEnabled:true}, sendMessage);
    if (!active || revision !== owner) return;
    const response = await sendMessage({type:VOCABULARY_BOOK_MESSAGE, action:'upsert', input:{
      sourceLanguage:language(current.sourceText), targetLanguage:config.to, term:normalizeLearningSourceText(current.sourceText), translation:current.translationText, kind:'sentence',
      context:{text:current.context, sourceUrl:window.location.href, pageTitle:document.title},
    }}) as VocabularyBookResponse<VocabularyEntry>;
    if (!response.success) throw new Error(response.error.message);
    if (active && revision === owner) {savedId.value = response.data.id; notice.value = '已保存原句与译文，可在收藏列表补充解释。';}
  } catch (error) {if (active && revision === owner) notice.value = error instanceof Error ? error.message : '收藏失败，请重试。';}
  finally {saving.value = false;}
}
async function copy(): Promise<void> {
  const current = sentence.value; const owner = revision;
  if (!current) return;
  try {await navigator.clipboard.writeText(selectedText(current)); if (active && revision === owner) notice.value = current.side === 'translation' ? '已复制译文' : '已复制原句';}
  catch {if (active && revision === owner) notice.value = '复制失败，可选中文字后复制。';}
}
async function openBook(): Promise<void> {
  try {await sendMessage({type:'openOptionsPage', section:'settings-vocabulary'});}
  catch {notice.value = '列表暂时无法打开，请从设置进入学习中心。';}
}
function expand(): void {
    const current = sentence.value;
    if (!current || expanded.value) return;
    expanded.value = true;
    if (privateContext) return;
    const owner = revision;
    void sendMessage({type:VOCABULARY_BOOK_MESSAGE, action:'getByTerm', sourceLanguage:language(current.sourceText), term:current.sourceText})
      .then((response: unknown) => {const result = response as VocabularyBookResponse<VocabularyEntry | null>; if (active && owner === revision && result.success) savedId.value = result.data?.id || savedId.value;}).catch(() => undefined);
}
const unsubscribe = subscribeHighlightedSentence(document, {
  change(current) {
    const previous = hovered;
    const same = current && previous && current.side === previous.side && current.sourceText === previous.sourceText
      && current.translationText === previous.translationText && current.context === previous.context
      && current.rect.left === previous.rect.left && current.rect.top === previous.rect.top;
    if (!same) close();
    hovered = current;
    if (!current || sentence.value) return;
    clearReveal();
    revealTimer = setTimeout(() => {revealTimer = undefined; if (active) sentence.value = hovered;}, 800);
  },
  retainPointer(target, event) {
    const root = panel.value;
    if (!root) return false;
    if (target && root.contains(target)) return true;
    const rect = root.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top - 8 && event.clientY <= rect.bottom;
  },
});
const unsubscribeConfig = subscribeConfig(next => {dark.value = next.theme === 'dark' || (next.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches); if (!next.on || !next.bilingualSentenceHighlightEnabled) close();});
messagePort.addListener(playbackState);
onBeforeUnmount(() => {active = false; close(); unsubscribe(); unsubscribeConfig(); try {messagePort.removeListener(playbackState);} catch { /* 失效端口不妨碍其余清理。 */ }});
</script>
<style scoped>
.sentence-actions {position:fixed; z-index:2147483647; max-width:calc(100vw - 16px); padding:5px; border:1px solid #e6dce0; border-radius:11px; background:#fffafb; color:#3d2732; box-shadow:0 6px 24px #30212b25; font:13px/1.5 system-ui,sans-serif; pointer-events:auto;}
.sentence-actions.dark {background:#261e27; color:#f5e6ec; border-color:#54424d;}
.sentence-actions.compact {padding:0; border-radius:8px; box-shadow:0 2px 8px #30212b14;}
.sentence-actions .sentence-entry {width:30px; height:28px; padding:0; font-size:20px; line-height:1;}
.sentence-buttons {display:flex; gap:2px; flex-wrap:wrap;}
.sentence-actions button {border:0; border-radius:7px; padding:6px 8px; background:transparent; color:inherit; font:inherit; cursor:pointer; white-space:nowrap;}
.sentence-actions button:hover {background:#d8316420;}
.sentence-actions button:focus-visible {outline:2px solid #d83164; outline-offset:1px;}
.sentence-actions button:disabled {opacity:.55; cursor:default;}
.sentence-notice {display:block; max-width:290px; padding:3px 8px; font-size:11px; opacity:.8;}
</style>
