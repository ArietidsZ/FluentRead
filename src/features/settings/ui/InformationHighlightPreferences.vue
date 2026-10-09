<!--
@file src/features/settings/ui/InformationHighlightPreferences.vue
文件职责：提供 Popup 与阅读设置共用的信息高亮偏好控件。
主要内容：以简短模式说明、三档密度、可读配色和绘制方式控制阅读外观；所有写入绑定活跃配置归属，关闭或切换页面后不接受旧控件回调。
模块边界：只修改已有 Config.informationHighlight，不控制标签页开启状态、不分析正文、不下载模型；设置持久化由父级现有配置服务负责。
-->
<template>
  <div class="information-highlight-preferences" :class="{'is-compact': compact}" data-testid="information-highlight-preferences">
    <label class="highlight-field">
      <span>{{ t('informationHighlight.mode') }}</span>
      <UiSelect :model-value="config.informationHighlight.mode" :disabled="!context.active.value" :aria-label="t('informationHighlight.mode')" :onUpdate:modelValue="actions.mode" data-information-highlight-mode-select>
        <ElOption v-for="mode in modes" :key="mode" :value="mode" :label="t(`informationHighlight.mode.${mode}`)" :data-information-highlight-mode="mode" />
      </UiSelect>
      <small>{{ t(`informationHighlight.mode.${config.informationHighlight.mode}.description`) }}</small>
    </label>
    <div class="highlight-field">
      <span id="information-highlight-density-label">{{ t('informationHighlight.density') }}</span>
      <div class="highlight-segments" role="group" :aria-label="t('informationHighlight.density')">
        <button v-for="item in densityChoices" :key="item.value" type="button" :disabled="!context.active.value" :aria-pressed="config.informationHighlight.density === item.value" :class="{selected: config.informationHighlight.density === item.value}" :onClick="item.choose" :data-information-highlight-density="item.value">{{ t(`informationHighlight.density.${item.value}`) }}</button>
      </div>
    </div>
    <div class="highlight-field">
      <span>{{ t('informationHighlight.color') }}</span>
      <div class="highlight-colors" role="group" :aria-label="t('informationHighlight.color')">
        <button v-for="item in colorChoices" :key="item.value" type="button" :disabled="!context.active.value" :aria-pressed="config.informationHighlight.color === item.value" :class="{selected: config.informationHighlight.color === item.value}" :onClick="item.choose" :data-information-highlight-color="item.value">
          <i :class="`highlight-swatch-${item.value}`" aria-hidden="true" />{{ t(`informationHighlight.color.${item.value}`) }}
        </button>
      </div>
    </div>
    <div class="highlight-field">
      <span>{{ t('informationHighlight.style') }}</span>
      <div class="highlight-segments" role="group" :aria-label="t('informationHighlight.style')">
        <button v-for="item in styleChoices" :key="item.value" type="button" :disabled="!context.active.value" :aria-pressed="config.informationHighlight.style === item.value" :class="{selected: config.informationHighlight.style === item.value}" :onClick="item.choose" :data-information-highlight-style="item.value">{{ t(`informationHighlight.style.${item.value}`) }}</button>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import {computed} from 'vue'
import {ElOption} from 'element-plus'
import UiSelect from '@/src/ui/components/UiSelect.vue'
import type {Config} from '@/src/core/config/model'
import type {InformationHighlightMode, InformationHighlightDensity, InformationHighlightColor, InformationHighlightStyle} from '@/src/core/config/informationHighlight'
import {useSettingsActionContext} from '../model/useSettingsActionContext'
import {useUiI18n} from '@/src/ui/i18n'
const props = withDefaults(defineProps<{config: Config; active?: boolean; compact?: boolean}>(), {active: true, compact: false})
const {t} = useUiI18n()
const context = useSettingsActionContext(() => props.active, () => [props.config, props.config.informationHighlight])
const modes: InformationHighlightMode[] = ['keywords', 'surprisal-local']
const densities: InformationHighlightDensity[] = ['low', 'medium', 'high']
const colors: InformationHighlightColor[] = ['amber', 'mint', 'blue']
const styles: InformationHighlightStyle[] = ['background', 'underline']
const actions = computed(() => {
  const current = context.capture()
  return {mode: (value: unknown) => {
    if (current() && modes.includes(value as InformationHighlightMode)) props.config.informationHighlight = {...props.config.informationHighlight, mode: value as InformationHighlightMode}
  }}
})
const densityChoices = computed(() => {const current = context.capture(); return densities.map(value => ({value, choose: () => {
  if (current()) props.config.informationHighlight = {...props.config.informationHighlight, density: value}
}}))})
const colorChoices = computed(() => {const current = context.capture(); return colors.map(value => ({value, choose: () => {
  if (current()) props.config.informationHighlight = {...props.config.informationHighlight, color: value}
}}))})
const styleChoices = computed(() => {const current = context.capture(); return styles.map(value => ({value, choose: () => {
  if (current()) props.config.informationHighlight = {...props.config.informationHighlight, style: value}
}}))})
</script>
<style scoped>
.information-highlight-preferences { display: grid; gap: 18px; min-width: 0; }
.highlight-field { display: grid; gap: 8px; min-width: 0; color: var(--ink, #25354b); font-size: 12px; font-weight: 600; }
.highlight-field small { color: var(--muted, #637184); font-weight: 400; line-height: 1.6; }
.highlight-field :deep(.el-select) { width: 100%; }
.highlight-segments, .highlight-colors { display: flex; gap: 6px; min-width: 0; }
.highlight-segments button, .highlight-colors button { flex: 1; min-width: 0; border: 1px solid var(--line, #dce3eb); border-radius: 8px; padding: 8px 6px; color: var(--muted, #637184); background: var(--surface, #fff); font: inherit; font-weight: 500; cursor: pointer; overflow-wrap: anywhere; }
.highlight-segments button.selected, .highlight-colors button.selected { border-color: var(--brand, #3680dd); color: var(--brand-strong, #2464b8); background: var(--brand-soft, #edf5ff); }
.highlight-segments button:focus-visible, .highlight-colors button:focus-visible { outline: 2px solid var(--brand, #3680dd); outline-offset: 2px; }
.highlight-segments button:disabled, .highlight-colors button:disabled { cursor: default; opacity: .55; }
.highlight-colors button { display: flex; align-items: center; justify-content: center; gap: 5px; }
.highlight-colors i { width: 10px; height: 10px; flex: none; border-radius: 50%; }
.highlight-swatch-amber { background: #d99522; } .highlight-swatch-mint { background: #28a985; } .highlight-swatch-blue { background: #4e88d4; }
.is-compact { gap: 14px; }
@media (max-width: 370px) { .highlight-colors { flex-wrap: wrap; } .highlight-colors button { flex-basis: 70px; } }
</style>
