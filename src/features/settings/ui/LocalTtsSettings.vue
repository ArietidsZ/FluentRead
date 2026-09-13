<!--
 * @file src/features/settings/ui/LocalTtsSettings.vue
 * 文件职责：提供朗读来源策略、本地音色和 Kokoro 模型下载管理的设置分组。
 * 主要内容：在线优先、本地优先、仅在线与仅本地四种模式切换，本地音色选择，以及模型状态查询、下载进度和清除操作。
 * 模块边界：只修改传入的配置副本并调用后台模型管理消息，不执行 TTS 推理，也不直接访问 Offscreen 或缓存存储。
 -->
<template>
  <SettingsGroup :title="t('settings.localTts.title')" :description="t('settings.localTts.description')">
    <SettingsItem :label="t('settings.localTts.title')" :description="modeDescription">
      <SegmentedControl
        v-model="ttsMode"
        :options="modeOptions"
        :label="t('settings.localTts.title')"
      />
    </SettingsItem>

    <SettingsItem :label="t('settings.localTts.voice')" :description="t('settings.localTts.modelDescription', {size: LOCAL_TTS_MODEL.downloadSizeMb})">
      <el-select v-model="localVoice" aria-label="本地音色" filterable>
        <el-option
          v-for="option in voiceOptions"
          :key="option.value"
          :label="`${option.label} · ${option.locale}`"
          :value="option.value"
        />
      </el-select>
    </SettingsItem>

    <div class="local-tts-model-row" data-testid="local-tts-model-row">
      <div class="local-tts-model-copy">
        <div class="local-tts-model-heading">
          <span class="local-tts-model-icon" aria-hidden="true"><Cpu /></span>
          <div>
            <strong>{{ t('settings.localTts.model') }}</strong>
            <small>{{ t('settings.localTts.modelDescription', {size: LOCAL_TTS_MODEL.downloadSizeMb}) }}</small>
          </div>
          <span class="local-tts-badge"><Cpu aria-hidden="true" />{{ t('settings.localTts.localBadge') }}</span>
        </div>
        <p class="local-tts-model-status" role="status" aria-live="polite">
          {{ !statusLoaded
            ? t('settings.localTts.statusReading')
            : downloading
              ? t('settings.localTts.statusDownloading')
              : downloaded
                ? t('settings.localTts.statusReady')
                : t('settings.localTts.statusNotDownloaded') }}
        </p>
      </div>
      <button
        v-if="downloaded"
        type="button"
        class="local-tts-model-action"
        :disabled="removing || downloading || !browserCapabilities.extensionDom"
        data-testid="local-tts-remove"
        :aria-label="t('settings.localTts.remove')"
        @click="removeModel"
      >
        <component :is="removing ? Loading : Delete" :class="{'is-loading': removing}" aria-hidden="true" />
        {{ removing ? t('settings.localTts.statusDownloading') : t('settings.localTts.remove') }}
      </button>
      <button
        v-else
        type="button"
        class="local-tts-model-action"
        :disabled="!statusLoaded || downloading || !browserCapabilities.extensionDom"
        data-testid="local-tts-download"
        :aria-label="t('settings.localTts.download')"
        @click="downloadModel"
      >
        <component :is="downloading ? Loading : Download" :class="{'is-loading': downloading}" aria-hidden="true" />
        {{ downloading ? t('settings.localTts.statusDownloading') : t('settings.localTts.download') }}
      </button>
    </div>

    <p v-if="!browserCapabilities.extensionDom" class="local-tts-warning" role="status">{{ t('settings.localTts.unavailable') }}</p>
    <p class="local-tts-guidance">{{ t('settings.localTts.guidance') }}</p>
    <p v-if="errorMessage" class="local-tts-error" role="alert">{{ errorMessage }}</p>
  </SettingsGroup>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref, toRef} from 'vue'
import browser from 'webextension-polyfill'
import {Cpu, Delete, Download, Loading} from '@element-plus/icons-vue'
import type {Config} from '@/src/core/config/model'
import {
  LOCAL_TTS_MODE_OPTIONS,
  LOCAL_TTS_MODEL,
  LOCAL_TTS_VOICE_OPTIONS,
  LOCAL_TTS_MODEL_STATE_KEY,
  normalizeLocalTtsMode,
  normalizeLocalTtsVoice,
  type LocalTtsMode,
  type LocalTtsVoiceId,
} from '@/src/core/config/localTts'
import {browserCapabilities} from '@/src/platform/browser/capabilities'
import {useUiI18n} from '@/src/ui/i18n'
import SettingsGroup from './components/SettingsGroup.vue'
import SettingsItem from './components/SettingsItem.vue'
import SegmentedControl from './components/SegmentedControl.vue'

const props = defineProps<{config: Config}>()
const config = toRef(props, 'config')
const {t} = useUiI18n()

const ttsMode = computed<LocalTtsMode>({
  get: () => normalizeLocalTtsMode(config.value.selectionTtsMode),
  set: (value) => { config.value.selectionTtsMode = normalizeLocalTtsMode(value) },
})
const localVoice = computed<LocalTtsVoiceId>({
  get: () => normalizeLocalTtsVoice(config.value.selectionTtsLocalVoice),
  set: (value) => { config.value.selectionTtsLocalVoice = normalizeLocalTtsVoice(value) },
})
const modeOptions = computed(() => LOCAL_TTS_MODE_OPTIONS.map((option) => ({
  value: option.value,
  label: t(`settings.localTts.${option.value === 'online-first' ? 'onlineFirst' : option.value === 'local-first' ? 'localFirst' : option.value === 'online-only' ? 'onlineOnly' : 'localOnly'}`),
})))
const modeDescription = computed(() => t(`settings.localTts.mode.${ttsMode.value === 'online-first' ? 'onlineFirst' : ttsMode.value === 'local-first' ? 'localFirst' : ttsMode.value === 'online-only' ? 'onlineOnly' : 'localOnly'}Description`))
const voiceOptions = computed(() => LOCAL_TTS_VOICE_OPTIONS.filter((option) => option.value === 'auto' || LOCAL_TTS_MODEL.voices.includes(option.value as never)))
const downloaded = ref(false)
const statusLoaded = ref(false)
const downloading = ref(false)
const removing = ref(false)
const errorMessage = ref('')

function readDownloaded(response: unknown): boolean {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return false
  const record = response as {downloaded?: unknown; models?: unknown}
  if (record.downloaded === true) return true
  return Array.isArray(record.models)
    && Boolean(record.models[0] && typeof record.models[0] === 'object' && (record.models[0] as {downloaded?: unknown}).downloaded === true)
}

async function refresh(): Promise<void> {
  if (!browserCapabilities.extensionDom) {
    statusLoaded.value = true
    return
  }
  const response = await browser.runtime.sendMessage({type: 'fluentReadGetLocalTtsModelState'}) as unknown
  if (!response || typeof response !== 'object' || (response as {success?: unknown}).success !== true) {
    throw new Error(t('settings.localTts.statusReadFailed'))
  }
  downloaded.value = readDownloaded(response)
  statusLoaded.value = true
}

async function downloadModel(): Promise<void> {
  if (downloading.value || !browserCapabilities.extensionDom) return
  errorMessage.value = ''
  downloading.value = true
  try {
    const response = await browser.runtime.sendMessage({type: 'fluentReadPrepareLocalTtsModel'}) as unknown
    if (!response || typeof response !== 'object' || (response as {success?: unknown}).success !== true) {
      throw new Error(response && typeof response === 'object' && typeof (response as {error?: unknown}).error === 'string'
        ? (response as {error: string}).error
        : t('settings.localTts.downloadFailed'))
    }
    downloaded.value = true
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('settings.localTts.downloadFailed')
  } finally {
    downloading.value = false
  }
}

async function removeModel(): Promise<void> {
  if (removing.value || !browserCapabilities.extensionDom) return
  errorMessage.value = ''
  removing.value = true
  try {
    const response = await browser.runtime.sendMessage({type: 'fluentReadRemoveLocalTtsModel'}) as unknown
    if (!response || typeof response !== 'object' || (response as {success?: unknown}).success !== true) {
      throw new Error(response && typeof response === 'object' && typeof (response as {error?: unknown}).error === 'string'
        ? (response as {error: string}).error
        : t('modelCache.removeFailed'))
    }
    downloaded.value = false
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('modelCache.removeFailed')
  } finally {
    removing.value = false
  }
}

function handleStorageChange(changes: Record<string, browser.Storage.StorageChange>, areaName: string): void {
  if (areaName === 'local' && changes[LOCAL_TTS_MODEL_STATE_KEY]) {
    void refresh().catch(() => { errorMessage.value = t('settings.localTts.statusReadFailed') })
  }
}

onMounted(() => {
  void refresh().catch(() => {
    statusLoaded.value = true
    errorMessage.value = t('settings.localTts.statusReadFailed')
  })
  browser.storage.onChanged.addListener(handleStorageChange)
})

onUnmounted(() => {
  browser.storage.onChanged.removeListener(handleStorageChange)
})
</script>

<style scoped>
.local-tts-model-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; min-width: 0; padding: 16px; border-top: 1px solid var(--line); }
.local-tts-model-copy { min-width: 0; }
.local-tts-model-heading { display: flex; align-items: center; gap: 10px; min-width: 0; }
.local-tts-model-heading > div { display: grid; gap: 3px; min-width: 0; }
.local-tts-model-heading strong { color: var(--ink); font-size: 12.5px; line-height: 1.45; }
.local-tts-model-heading small, .local-tts-model-status, .local-tts-guidance, .local-tts-warning, .local-tts-error { color: var(--muted); font-size: 10.5px; line-height: 1.6; }
.local-tts-model-heading small { overflow-wrap: anywhere; }
.local-tts-model-icon { display: grid; place-items: center; width: 32px; height: 32px; flex: none; border-radius: 8px; color: var(--brand-strong); background: var(--brand-soft); }
.local-tts-model-icon svg, .local-tts-badge svg, .local-tts-model-action svg { width: 15px; height: 15px; flex: none; }
.local-tts-badge { display: inline-flex; align-items: center; gap: 5px; flex: none; padding: 4px 7px; border-radius: 5px; color: var(--brand-strong); background: var(--brand-soft); font-size: 10px; white-space: nowrap; }
.local-tts-model-status { margin: 8px 0 0 42px; }
.local-tts-model-action { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 112px; min-height: 34px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); background: var(--surface); font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
.local-tts-model-action:hover:not(:disabled) { border-color: var(--brand); color: var(--brand-strong); background: var(--brand-soft); }
.local-tts-model-action:disabled { color: var(--muted); background: var(--surface-soft); opacity: .65; cursor: default; }
.local-tts-guidance, .local-tts-warning, .local-tts-error { margin: 0; padding: 0 16px 16px; }
.local-tts-warning, .local-tts-error { color: var(--el-color-danger); }
.is-loading { animation: local-tts-spin 1s linear infinite; }
@keyframes local-tts-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .is-loading { animation: none; } }
@media (max-width: 700px) { .local-tts-model-row { align-items: flex-start; flex-direction: column; padding: 14px 12px; } .local-tts-model-action { width: 100%; } .local-tts-guidance, .local-tts-warning, .local-tts-error { padding-right: 12px; padding-left: 12px; } }
</style>
