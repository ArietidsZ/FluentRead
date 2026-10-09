<!--
@file src/features/settings/ui/InformationHighlightSettings.vue
文件职责：将智能高亮的阅读预览、持久偏好与本地模型管理组织到独立设置分组。
主要内容：标题旁以可悬停、聚焦和点击的标签解释关键词、预测意外度与阅读提示；并排展示示意文本与阅读偏好，模型卡紧跟模式选择，说明启用范围与本机隐私；只有选择意外度模式才读取资源状态。
模块边界：组件不全局启用网页、不分析正文或自动下载；偏好写入由共享控件处理，资源状态由独立模型卡读取。
-->
<template>
  <SettingsGroup id="information-highlight-settings" :title="t('informationHighlight.title')" :description="t('informationHighlight.description')">
    <template #heading-extra>
      <span class="information-highlight-tags">
        <ElTooltip v-for="tag in tags" :key="tag" ref="tagTooltips" :content="t(`informationHighlight.tags.${tag}.help`)" :trigger="['hover', 'focus', 'click']" :disabled="!context.active.value" :show-after="150" :hide-after="100" :persistent="false" :teleported="false" placement="bottom" effect="light" popper-class="fluentread-information-highlight-tag-popper">
          <button type="button" :disabled="!context.active.value" :aria-label="t(`informationHighlight.tags.${tag}`)" :data-information-highlight-tag="tag" @keydown.esc.stop="tagTooltips.forEach(tooltip => {tooltip.onClose(); tooltip.hide()})">{{ t(`informationHighlight.tags.${tag}`) }}</button>
        </ElTooltip>
      </span>
    </template>
    <div class="information-highlight-workspace">
      <div class="information-highlight-example"><InformationHighlightPreview :preferences="config.informationHighlight" /><p>{{ t('informationHighlight.settings.pageHint') }}</p><p>{{ t('informationHighlight.privacy') }}</p></div>
      <InformationHighlightPreferences :config="config" :active="active"><template #after-mode><InformationHighlightModelCard v-if="config.informationHighlight.mode === 'surprisal-local'" :active="active" :fallback="useKeywords" /></template></InformationHighlightPreferences>
    </div>
  </SettingsGroup>
</template>
<script setup lang="ts">
import {computed, ref, watch} from 'vue'
import {ElTooltip, type TooltipInstance} from 'element-plus'
import type {Config} from '@/src/core/config/model'
import {useUiI18n} from '@/src/ui/i18n'
import SettingsGroup from './components/SettingsGroup.vue'
import InformationHighlightPreferences from './InformationHighlightPreferences.vue'
import InformationHighlightPreview from './InformationHighlightPreview.vue'
import InformationHighlightModelCard from './InformationHighlightModelCard.vue'
import {useSettingsActionContext} from '../model/useSettingsActionContext'
const props = withDefaults(defineProps<{config: Config; active?: boolean}>(), {active: true})
const {t} = useUiI18n()
const tags = ['keywords', 'surprisal', 'reading'] as const
const tagTooltips = ref<TooltipInstance[]>([])
const context = useSettingsActionContext(() => props.active, () => [props.config, props.config.informationHighlight])
watch(context.active, active => {
  if (!active) tagTooltips.value.forEach(tooltip => {tooltip.onClose(); tooltip.hide()})
}, {flush: 'sync'})
const useKeywords = computed(() => {const current = context.capture(); return () => {
  if (current()) props.config.informationHighlight = {...props.config.informationHighlight, mode: 'keywords'}
}})
</script>
<style scoped>
.information-highlight-tags { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }.information-highlight-tags button { min-height: 28px; padding: 4px 9px; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); background: var(--surface); font: inherit; font-size: 11px; line-height: 1.5; cursor: help; }.information-highlight-tags button:hover, .information-highlight-tags button:focus-visible { color: var(--brand-strong); border-color: var(--brand); background: var(--brand-soft); }.information-highlight-tags button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }.information-highlight-tags button:disabled { cursor: default; opacity: .55; }
:global(.fluentread-information-highlight-tag-popper) { max-width: min(320px, calc(100vw - 32px)); font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
.information-highlight-workspace { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; padding: 20px; align-items: start; }.information-highlight-example { min-width: 0; }.information-highlight-example p { margin: 12px 0 0; color: var(--muted); font-size: 12px; line-height: 1.65; }
@media (max-width: 850px) { .information-highlight-workspace { grid-template-columns: minmax(0, 1fr); gap: 20px; padding: 16px; } }
@media (max-width: 480px) { .information-highlight-workspace { padding: 12px; } }
</style>
