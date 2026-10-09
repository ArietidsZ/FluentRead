<!--
@file src/features/settings/ui/InformationHighlightSettings.vue
文件职责：将信息高亮的阅读预览、持久偏好与本地模型管理组织到现有阅读辅助设置。
主要内容：并排展示示意文本与阅读偏好，模型卡紧跟模式选择，说明启用范围与本机隐私；只有选择意外度模式才读取资源状态。
模块边界：组件不全局启用网页、不分析正文或自动下载；偏好写入由共享控件处理，资源状态由独立模型卡读取。
-->
<template>
  <SettingsGroup id="information-highlight-settings" :title="t('informationHighlight.title')" :description="t('informationHighlight.description')">
    <div class="information-highlight-workspace">
      <div class="information-highlight-example"><InformationHighlightPreview :preferences="config.informationHighlight" /><p>{{ t('informationHighlight.settings.pageHint') }}</p><p>{{ t('informationHighlight.privacy') }}</p></div>
      <InformationHighlightPreferences :config="config" :active="active"><template #after-mode><InformationHighlightModelCard v-if="config.informationHighlight.mode === 'surprisal-local'" :active="active" :fallback="useKeywords" /></template></InformationHighlightPreferences>
    </div>
  </SettingsGroup>
</template>
<script setup lang="ts">
import {computed} from 'vue'
import type {Config} from '@/src/core/config/model'
import {useUiI18n} from '@/src/ui/i18n'
import SettingsGroup from './components/SettingsGroup.vue'
import InformationHighlightPreferences from './InformationHighlightPreferences.vue'
import InformationHighlightPreview from './InformationHighlightPreview.vue'
import InformationHighlightModelCard from './InformationHighlightModelCard.vue'
import {useSettingsActionContext} from '../model/useSettingsActionContext'
const props = withDefaults(defineProps<{config: Config; active?: boolean}>(), {active: true})
const {t} = useUiI18n()
const context = useSettingsActionContext(() => props.active, () => [props.config, props.config.informationHighlight])
const useKeywords = computed(() => {const current = context.capture(); return () => {
  if (current()) props.config.informationHighlight = {...props.config.informationHighlight, mode: 'keywords'}
}})
</script>
<style scoped>
.information-highlight-workspace { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; padding: 20px; align-items: start; }.information-highlight-example { min-width: 0; }.information-highlight-example p { margin: 12px 0 0; color: var(--muted); font-size: 12px; line-height: 1.65; }
@media (max-width: 850px) { .information-highlight-workspace { grid-template-columns: minmax(0, 1fr); gap: 20px; padding: 16px; } }
@media (max-width: 480px) { .information-highlight-workspace { padding: 12px; } }
</style>
