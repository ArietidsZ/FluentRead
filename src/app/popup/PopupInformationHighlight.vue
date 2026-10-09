<!--
@file src/app/popup/PopupInformationHighlight.vue
文件职责：在 Popup 内为当前页面提供低干扰的信息高亮开关、真实进度和阅读偏好。
主要内容：当前页开关始终能关闭，按页面真值显示分析和错误状态；共享示意预览、偏好控件与显式模型下载卡，完整设置入口保持可发现。
模块边界：组件通过父级动作控制当前标签页，不持久化开启状态、不查询标签页或分析正文；长期偏好和资源状态由共享设置组件负责。
-->
<template>
  <div class="popup-information-highlight" data-testid="popup-information-highlight" data-information-highlight-drawer>
    <div class="highlight-page-control"><div><strong>{{ t('informationHighlight.currentPage') }}</strong><small>{{ statusLabel }}</small></div><button class="highlight-page-switch" type="button" role="switch" :aria-checked="state.snapshot?.enabled === true" :aria-label="t('informationHighlight.currentPage')" :disabled="!active || (!state.snapshot?.enabled && (Boolean(blockedReason) || state.loading || !state.snapshot))" :onClick="toggle" data-testid="information-highlight-enable" data-information-highlight-enabled><i /></button></div>
    <p v-if="blockedReason" class="highlight-page-notice" role="status">{{ blockedReason }}</p>
    <p v-else-if="state.errorCode || state.snapshot?.phase === 'error'" class="highlight-page-notice is-error" role="alert">{{ errorLabel }} <button type="button" :disabled="!active" :onClick="retry">{{ t('informationHighlight.retry') }}</button></p>
    <p v-if="state.snapshot?.enabled && state.snapshot.processedParagraphs > 0" class="highlight-page-progress" role="status" aria-live="polite">{{ t('informationHighlight.progress', {paragraphs: state.snapshot.processedParagraphs, spans: state.snapshot.highlightedSpans}) }}<span v-if="state.snapshot.queuedParagraphs > 0"> · {{ t('informationHighlight.queued', {count: state.snapshot.queuedParagraphs}) }}</span></p>
    <InformationHighlightPreview :preferences="config.informationHighlight" compact />
    <InformationHighlightPreferences :config="config" :active="active" compact />
    <InformationHighlightModelCard v-if="config.informationHighlight.mode === 'surprisal-local'" :active="active" @preparing="modelPreparing" @ready="modelReady" />
    <p class="highlight-page-privacy">{{ t('informationHighlight.privacy') }}</p>
    <button type="button" class="highlight-settings-link" :disabled="!active" :onClick="openSettings">{{ t('informationHighlight.settings.open') }} <span aria-hidden="true">↗</span></button>
  </div>
</template>
<script setup lang="ts">
import {computed} from 'vue'
import type {Config} from '@/src/core/config/model'
import type {PopupInformationHighlightState} from './informationHighlightActions'
import {useUiI18n} from '@/src/ui/i18n'
import InformationHighlightPreferences from '@/src/features/settings/ui/InformationHighlightPreferences.vue'
import InformationHighlightPreview from '@/src/features/settings/ui/InformationHighlightPreview.vue'
import InformationHighlightModelCard from '@/src/features/settings/ui/InformationHighlightModelCard.vue'
const props = defineProps<{config: Config; state: PopupInformationHighlightState; active: boolean; blockedReason: string; toggle: () => unknown; retry: () => unknown; openSettings: () => unknown}>()
const {t} = useUiI18n()
const statusLabel = computed(() => props.state.loading ? t('informationHighlight.stateReading')
  : props.state.snapshot ? t(`informationHighlight.phase.${props.state.snapshot.enabled ? props.state.snapshot.phase : 'idle'}`) : t('informationHighlight.unavailable'))
const errorLabel = computed(() => ['MODEL_NOT_READY', 'NOT_DOWNLOADED'].some(code => props.state.snapshot?.errorCode?.includes(code))
  ? t('informationHighlight.modelNotReady') : t('informationHighlight.error'))
let preparedRetry: (() => unknown) | undefined
function modelPreparing() {
  preparedRetry = props.active && props.state.snapshot?.enabled && props.config.informationHighlight.mode === 'surprisal-local' ? props.retry : undefined
}
function modelReady() {
  const retry = preparedRetry; preparedRetry = undefined
  if (props.active && props.state.snapshot?.enabled && props.config.informationHighlight.mode === 'surprisal-local') return retry?.()
}
</script>
<style scoped>
.popup-information-highlight { display: grid; gap: 15px; padding: 16px 18px; color: var(--ink, #25354b); }.highlight-page-control { display: flex; align-items: center; justify-content: space-between; gap: 14px; }.highlight-page-control div { display: grid; min-width: 0; gap: 4px; }.highlight-page-control strong { font-size: 13px; }.highlight-page-control small { font-size: 11px; color: var(--muted, #637184); line-height: 1.5; }
.highlight-page-switch { width: 38px; height: 23px; flex: none; padding: 3px; border: 0; border-radius: 15px; background: var(--line, #dce3eb); cursor: pointer; }.highlight-page-switch i { display: block; width: 17px; height: 17px; border-radius: 50%; background: var(--surface, #fff); transition: transform 120ms ease; }.highlight-page-switch[aria-checked="true"] { background: var(--brand, #3680dd); }.highlight-page-switch[aria-checked="true"] i { transform: translateX(15px); }.highlight-page-switch:disabled { opacity: .5; cursor: default; }.highlight-page-switch:focus-visible, .highlight-settings-link:focus-visible, .highlight-page-notice button:focus-visible { outline: 2px solid var(--brand, #3680dd); outline-offset: 3px; }
.highlight-page-notice, .highlight-page-progress, .highlight-page-privacy { margin: 0; font-size: 11px; line-height: 1.6; color: var(--muted, #637184); overflow-wrap: anywhere; }.highlight-page-notice.is-error { color: var(--danger, #c04b54); }.highlight-page-notice button { border: 0; padding: 2px 4px; color: inherit; background: transparent; text-decoration: underline; font: inherit; cursor: pointer; }.highlight-page-progress { color: var(--brand-strong, #2464b8); }
.highlight-settings-link { display: flex; justify-content: space-between; width: 100%; border: 0; border-top: 1px solid var(--line, #dce3eb); padding: 12px 0 0; background: transparent; color: var(--brand-strong, #2464b8); font: inherit; font-size: 12px; cursor: pointer; }.highlight-settings-link:disabled { opacity: .5; cursor: default; }
@media (prefers-reduced-motion: reduce) { .highlight-page-switch i { transition: none; } }
</style>
