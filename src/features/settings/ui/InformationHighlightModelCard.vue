<!--
@file src/features/settings/ui/InformationHighlightModelCard.vue
文件职责：展示本地意外度模型的真实可用性、资源状态和显式下载操作。
主要内容：从既有 runtime 消息读取固定模型的状态与字节进度，以活跃视图和请求代次拒绝迟到回复；下载、暂停和删除按钮分别发送明确命令，下载中仍能暂停。
模块边界：不直接访问网络、不分析正文、不推断模型已就绪，不自动下载或切换云端；模型校验、资源缓存和 WebGPU 检查由 feature runtime 负责。
-->
<template>
  <section class="information-highlight-model" data-testid="information-highlight-model-card" :aria-busy="reading && !status">
    <div class="highlight-model-heading"><span class="highlight-model-chip" aria-hidden="true">↓</span><div><strong>{{ status?.modelName || t('informationHighlight.model.title') }}</strong><small>{{ t('informationHighlight.model.description') }}</small></div></div>
    <DownloadProgress v-if="downloading" :progress="downloadProgress" :label="t(`informationHighlight.model.phase.${status?.phase === 'verifying' ? 'verifying' : 'downloading'}`)" data-testid="information-highlight-model-progress" />
    <p v-else class="highlight-model-status" role="status" aria-live="polite">{{ !status ? t('informationHighlight.model.reading') : t(`informationHighlight.model.phase.${status.phase}`) }}<span v-if="status?.downloadSizeBytes"> · {{ formatDownloadBytes(status.downloadSizeBytes) }}</span></p>
    <p v-if="status && !status.supported" class="highlight-model-notice" role="status">{{ t('informationHighlight.model.webgpuRequired') }}</p>
    <p class="highlight-model-privacy">{{ t('informationHighlight.model.privacy') }}</p>
    <div class="highlight-model-actions">
      <button v-if="downloading" type="button" :disabled="!context.active.value || operation === 'pause'" :onClick="actions.pause" data-testid="information-highlight-model-pause" data-information-highlight-pause>{{ t('informationHighlight.model.pause') }}</button>
      <button v-else-if="status && !status.downloaded" type="button" class="highlight-model-primary" :disabled="!context.active.value || !status.supported || operation !== null" :onClick="actions.prepare" data-testid="information-highlight-model-download" data-information-highlight-download>{{ t(status.phase === 'paused' ? 'informationHighlight.model.resume' : 'informationHighlight.model.download') }}</button>
      <span v-else-if="status?.downloaded" class="highlight-model-ready">{{ t('informationHighlight.model.offlineReady') }}</span>
      <button v-if="status && (status.downloaded || status.downloadedBytes > 0) && !downloading" type="button" :disabled="!context.active.value || operation !== null" :onClick="actions.remove" data-testid="information-highlight-model-remove" data-information-highlight-remove>{{ t('informationHighlight.model.remove') }}</button>
      <button v-if="error" type="button" :disabled="!context.active.value || reading" :onClick="actions.refresh">{{ t('informationHighlight.retry') }}</button>
    </div>
    <p v-if="error" class="highlight-model-error" role="alert">{{ t('informationHighlight.model.error') }}</p>
  </section>
</template>
<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import browser from 'webextension-polyfill'
import type {InformationHighlightModelStatus} from '@/src/features/information-highlight/protocol'
import {formatDownloadBytes} from '@/src/core/download/progress'
import DownloadProgress from '@/src/ui/components/DownloadProgress.vue'
import {useSettingsActionContext} from '../model/useSettingsActionContext'
import {useUiI18n} from '@/src/ui/i18n'
const props = withDefaults(defineProps<{active?: boolean}>(), {active: true})
const emit = defineEmits<{preparing: []; ready: []}>()
const {t} = useUiI18n()
const context = useSettingsActionContext(() => props.active, () => [])
const status = ref<InformationHighlightModelStatus | null>(null)
const reading = ref(false), error = ref(false)
const operation = ref<'prepare' | 'pause' | 'remove' | null>(null)
let readSequence = 0, commandSequence = 0
let prepared: {current: () => boolean; command: number} | null = null
let timer: ReturnType<typeof setInterval> | undefined
const downloading = computed(() => operation.value === 'prepare' || Boolean(status.value && ['queued', 'downloading', 'verifying'].includes(status.value.phase)))
const downloadProgress = computed(() => ({loaded: status.value?.downloadedBytes || 0, total: status.value?.totalBytes || 0}))
function accept(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false
  const envelope = response as {success?: unknown; status?: InformationHighlightModelStatus}
  const candidate = envelope.status
  if (envelope.success !== true || !candidate || typeof candidate.downloaded !== 'boolean' || typeof candidate.supported !== 'boolean'
    || !['absent', 'queued', 'downloading', 'verifying', 'paused', 'ready', 'error', 'removing'].includes(candidate.phase)
    || !Number.isFinite(candidate.downloadedBytes) || candidate.downloadedBytes < 0
    || !Number.isFinite(candidate.totalBytes) || candidate.totalBytes < 0
    || typeof candidate.initialized !== 'boolean' || typeof candidate.modelName !== 'string'
    || !Number.isFinite(candidate.downloadSizeBytes) || candidate.downloadSizeBytes < 0) return false
  status.value = candidate
  if (prepared && prepared.current() && prepared.command === commandSequence && candidate.phase === 'ready' && candidate.downloaded && candidate.supported) {
    prepared = null; emit('ready')
  }
  if (['error', 'paused', 'removing'].includes(candidate.phase)) prepared = null
  return true
}
async function refresh() {
  if (!context.active.value || reading.value) return
  const current = context.capture(), sequence = ++readSequence, commandVersion = commandSequence
  reading.value = true
  try {
    const response = await browser.runtime.sendMessage({type: 'GET_INFORMATION_HIGHLIGHT_MODEL_STATUS'})
    if (current() && sequence === readSequence && commandVersion === commandSequence) error.value = !accept(response)
  } catch {if (current() && sequence === readSequence && commandVersion === commandSequence) error.value = true}
  finally {if (sequence === readSequence) reading.value = false}
}
async function run(action: 'prepare' | 'pause' | 'remove') {
  if (!context.active.value || (action === 'prepare' && (!status.value?.supported || downloading.value))) return
  if (action !== 'pause' && operation.value !== null) return
  const current = context.capture(), sequence = ++commandSequence
  readSequence++; reading.value = false; operation.value = action; error.value = false
  prepared = action === 'prepare' ? {current, command: sequence} : null
  if (action === 'prepare') emit('preparing')
  const type = {prepare: 'PREPARE_INFORMATION_HIGHLIGHT_MODEL', pause: 'PAUSE_INFORMATION_HIGHLIGHT_MODEL', remove: 'REMOVE_INFORMATION_HIGHLIGHT_MODEL'}[action]
  try {
    const response = await browser.runtime.sendMessage({type})
    if (current() && sequence === commandSequence) {
      error.value = !accept(response)
      if (error.value) prepared = null
    }
  } catch {if (current() && sequence === commandSequence) {error.value = true; prepared = null}}
  finally {if (current() && sequence === commandSequence) {operation.value = null; void refresh()}}
}
const actions = computed(() => {
  const current = context.capture()
  return {prepare: () => {if (current()) return run('prepare')}, pause: () => {if (current()) return run('pause')},
    remove: () => {if (current()) return run('remove')}, refresh: () => {if (current()) return refresh()}}
})
watch(context.active, active => {
  readSequence++; commandSequence++; prepared = null; reading.value = false; operation.value = null
  if (active) void refresh()
}, {flush: 'sync'})
onMounted(() => {void refresh(); timer = setInterval(() => {if (context.active.value) void refresh()}, 1000)})
onUnmounted(() => {readSequence++; commandSequence++; prepared = null; if (timer) clearInterval(timer)})
</script>
<style scoped>
.information-highlight-model { padding: 15px; border: 1px solid var(--line, #dce3eb); border-radius: 10px; color: var(--ink, #25354b); background: var(--surface-soft, #f6f8fb); }
.highlight-model-heading { display: flex; align-items: flex-start; gap: 10px; }
.highlight-model-heading div { min-width: 0; display: grid; gap: 4px; }.highlight-model-heading strong { font-size: 13px; }.highlight-model-heading small { color: var(--muted, #637184); font-size: 11px; line-height: 1.6; }
.highlight-model-chip { display: grid; place-items: center; width: 28px; height: 28px; flex: none; border-radius: 8px; color: var(--brand-strong, #2464b8); background: var(--brand-soft, #edf5ff); font-size: 18px; }
.highlight-model-status, .highlight-model-notice, .highlight-model-privacy, .highlight-model-error { margin: 10px 0 0; font-size: 11px; line-height: 1.65; overflow-wrap: anywhere; }
.highlight-model-status, .highlight-model-privacy { color: var(--muted, #637184); }.highlight-model-notice { color: var(--ink, #25354b); }.highlight-model-error { color: var(--danger, #c04b54); }
.highlight-model-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; }.highlight-model-actions button { border: 1px solid var(--line, #dce3eb); border-radius: 7px; padding: 7px 10px; background: var(--surface, #fff); color: var(--ink, #25354b); font: inherit; font-size: 11px; cursor: pointer; }.highlight-model-actions button.highlight-model-primary { background: var(--brand-soft, #edf5ff); color: var(--brand-strong, #2464b8); border-color: var(--brand, #3680dd); }.highlight-model-actions button:disabled { opacity: .55; cursor: default; }.highlight-model-actions button:focus-visible { outline: 2px solid var(--brand, #3680dd); outline-offset: 2px; }.highlight-model-ready { font-size: 11px; color: var(--brand-strong, #2464b8); }
.information-highlight-model :deep(.download-progress) { margin-top: 12px; }
</style>
