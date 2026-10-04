<!--
 * @file src/features/vocabulary/ui/SentenceActions.vue
 * 文件职责：为当前高亮的双语句子提供直接播放、收藏、复制和打开收藏列表的轻量操作。
 * 主要内容：订阅只读句子定位，保持鼠标进入工具条时的句子身份；沿用收藏与朗读后台，隔离迟到响应，支持失败重试和无痕提示。
 * 模块边界：不改动原句或网页布局，不自动生成解释或发送模型请求；存储与语言清洗由现有后台负责。
 -->
<template>
  <div v-if="sentence" ref="panel" class="sentence-actions" :class="{dark}" :style="position" role="toolbar" aria-label="句子听读与收藏" @keydown.esc.stop="close">
    <div class="sentence-buttons">
      <button type="button" @click="play">{{ playing ? '停止' : '播放' }}</button>
      <button type="button" :disabled="saving || privateContext || Boolean(savedId)" @click="save">{{ saving ? '收藏中…' : savedId ? '已收藏' : '收藏句子' }}</button>
      <button type="button" @click="copy">复制</button>
      <button type="button" title="查看收藏的句子" @click="openBook">收藏列表 ↗</button>
    </div>
    <span v-if="notice || privateContext" class="sentence-notice" role="status">{{ privateContext ? '无痕窗口不保存收藏' : notice }}</span>
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
const panel = ref<HTMLElement>();
const savedId = ref('');
const notice = ref('');
const saving = ref(false);
const playing = ref(false);
const privateContext = browser.extension?.inIncognitoContext === true;
const dark = ref(config.theme === 'dark' || (config.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches));
const position = computed(() => ({left: `${Math.max(8, Math.min(sentence.value?.rect.left ?? 8, window.innerWidth - 310))}px`, top: `${Math.max(8, Math.min((sentence.value?.rect.bottom ?? 0) + 6, window.innerHeight - 70))}px`}));
const sendMessage = browser.runtime.sendMessage.bind(browser.runtime);
const messagePort = browser.runtime.onMessage;
const speech = createSelectionTtsContentController({createClientRequestId: createSelectionTtsClientRequestId, stopRemote: clientRequestId => sendMessage({type:'selectionTtsStop', clientRequestId})});
let active = true;
let audio: HTMLAudioElement | undefined;
let audioUrl = '';
let utterance: SpeechSynthesisUtterance | undefined;
let revision = 0;
function language(text: string): string {return config.from && config.from !== 'auto' ? config.from : detectlang(text);}
function stop(notify = true): void {
  speech.stop(notify);
  audio?.pause(); audio?.removeAttribute('src'); audio = undefined;
  if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = '';
  if (utterance) window.speechSynthesis?.cancel(); utterance = undefined;
  playing.value = false;
}
function close(): void {revision++; stop(); sentence.value = null;}
function fallback(text: string): void {
  stop(false);
  if (!active || !sentence.value) return;
  if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {notice.value = '朗读暂时不可用，请重试。'; return;}
  const next = new SpeechSynthesisUtterance(text);
  next.lang = normalizeSpeechLanguage(language(text));
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
  const request = speech.beginRemoteRequest();
  try {
    const response = await sendMessage({type:'selectionTts', text:current.sourceText, language:normalizeSpeechLanguage(language(current.sourceText)), clientRequestId:request.clientRequestId}) as {success?: boolean; transport?: string; audioBase64?: string; contentType?: string};
    const result = speech.completeRemoteRequest(request, response);
    if (result === 'stale' || result === 'offscreen') return;
    if (result === 'failed' || !response.audioBase64) {fallback(current.sourceText); return;}
    audioUrl = URL.createObjectURL(new Blob([Uint8Array.from(atob(response.audioBase64), c => c.charCodeAt(0))], {type:response.contentType || 'audio/mpeg'}));
    const next = new Audio(audioUrl); audio = next;
    next.onended = () => {if (audio === next) stop(false);};
    next.onerror = () => {if (audio === next) fallback(current.sourceText);};
    await next.play();
  } catch {if (speech.rejectRemoteRequest(request)) fallback(current.sourceText);}
}
function playbackState(message: unknown): undefined {
  const state = speech.matchRemoteState(message);
  if (state === 'error' && sentence.value) fallback(sentence.value.sourceText);
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
  try {await navigator.clipboard.writeText(current.sourceText); if (active && revision === owner) notice.value = '已复制原句';}
  catch {if (active && revision === owner) notice.value = '复制失败，可选中原句后复制。';}
}
async function openBook(): Promise<void> {
  try {await sendMessage({type:'openOptionsPage', section:'settings-vocabulary'});}
  catch {notice.value = '列表暂时无法打开，请从设置进入学习中心。';}
}
const unsubscribe = subscribeHighlightedSentence(document, {
  change(current) {
    revision++; stop(); sentence.value = current; savedId.value = ''; notice.value = '';
    if (!current || privateContext) return;
    const owner = revision;
    void sendMessage({type:VOCABULARY_BOOK_MESSAGE, action:'getByTerm', sourceLanguage:language(current.sourceText), term:current.sourceText})
      .then((response: unknown) => {const result = response as VocabularyBookResponse<VocabularyEntry | null>; if (active && owner === revision && result.success) savedId.value = result.data?.id || savedId.value;}).catch(() => undefined);
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
.sentence-buttons {display:flex; gap:2px; flex-wrap:wrap;}
.sentence-actions button {border:0; border-radius:7px; padding:6px 8px; background:transparent; color:inherit; font:inherit; cursor:pointer; white-space:nowrap;}
.sentence-actions button:hover {background:#d8316420;}
.sentence-actions button:focus-visible {outline:2px solid #d83164; outline-offset:1px;}
.sentence-actions button:disabled {opacity:.55; cursor:default;}
.sentence-notice {display:block; max-width:290px; padding:3px 8px; font-size:11px; opacity:.8;}
</style>
