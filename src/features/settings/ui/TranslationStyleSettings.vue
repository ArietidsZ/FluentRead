<!--
@file src/features/settings/ui/TranslationStyleSettings.vue
文件职责：作为“界面风格”页的第一个分组，集中设置网页双语译文的样式预设、外观微调和双语逐句高亮，并提供与网页一致的实时预览。
主要内容：左侧用真实译文样式表渲染迷你网页预览与逐句高亮开关，右侧按文字、线条、标记、卡片分类展示带实时缩略效果的样式卡片；
下方可自定义译文颜色、线条颜色、标记底色、字号、不透明度、字重和字体，并一键恢复默认；仅译文模式下提示并可切回双语对照。
模块边界：本组件只编辑父级传入的 Config 草稿（style、translationAppearance、bilingualSentenceHighlightEnabled、display），不持久化配置、
不向网页注入样式；预设元数据和外观声明来自 core/config/translationAppearance，网页应用由 content 层负责。
-->
<template>
  <SettingsGroup
    class="translation-style-group"
    :title="t('settings.translationStyle.title')"
    :description="t('settings.translationStyle.description')"
  >
    <div id="translation-style-settings" class="translation-style-settings" data-testid="translation-style-settings">
      <div v-if="config.display !== 1" class="translation-style-mode-note" role="status">
        <span>{{ t('settings.translationStyle.bilingualOnly') }}</span>
        <button type="button" @click="config.display = 1">{{ t('settings.translationStyle.switchToBilingual') }}</button>
      </div>

      <div class="translation-style-workbench">
        <div class="translation-style-stage">
          <TranslationStylePreview
            :style-class="selectedPreset.className"
            :appearance-style="appearanceStyle"
            :highlight-enabled="config.bilingualSentenceHighlightEnabled"
            :translation-before-original="config.translationBeforeOriginal"
            :page-theme="pageTheme"
            :caption="t('settings.translationStyle.currentPreset', { name: translateLegacy(selectedPreset.label) })"
            :customized="customized"
            :hint="selectedPreset.className === 'fluent-display-blur-reveal' ? t('settings.translationStyle.blurRevealHint') : ''"
            @update:page-theme="pageTheme = $event"
          />
          <div id="translation-sentence-highlight" class="translation-style-highlight-toggle">
            <span>
              <strong>{{ t('settings.general.bilingualSentenceHighlight') }}</strong>
              <small>{{ t('settings.general.bilingualSentenceHighlightDescription') }}</small>
            </span>
            <el-switch
              v-model="config.bilingualSentenceHighlightEnabled"
              class="settings-toggle"
              :aria-label="t('settings.general.bilingualSentenceHighlight')"
            />
          </div>
        </div>

        <section class="translation-style-gallery" aria-labelledby="translation-style-gallery-title">
          <header class="translation-style-gallery-heading">
            <strong id="translation-style-gallery-title">{{ t('settings.translationStyle.presetsTitle') }}</strong>
            <SegmentedControl
              class="translation-style-categories"
              :model-value="activeCategory"
              :options="categoryOptions"
              :label="t('settings.translationStyle.categoryLabel')"
              @update:model-value="selectCategory"
            />
          </header>
          <div class="translation-style-grid" role="radiogroup" aria-labelledby="translation-style-gallery-title">
            <button
              v-for="preset in visiblePresets"
              :key="preset.value"
              type="button"
              role="radio"
              class="translation-style-card"
              :class="{ selected: config.style === preset.value }"
              :aria-checked="config.style === preset.value"
              :aria-label="translateLegacy(preset.label)"
              :data-style-value="preset.value"
              @click="config.style = preset.value"
            >
              <span class="translation-style-card-sample" :data-page-theme="pageTheme" aria-hidden="true" data-i18n-ignore>
                <span class="fluent-read-bilingual-content" :class="preset.className" :style="appearanceStyle" lang="zh-CN">阅读轻松自然</span>
              </span>
              <span class="translation-style-card-name">{{ translateLegacy(preset.label) }}</span>
              <span class="translation-style-card-check" aria-hidden="true"><i /></span>
            </button>
          </div>
          <p class="translation-style-apply-hint">{{ t('settings.translationStyle.applyHint') }}</p>
        </section>
      </div>

      <section id="translation-appearance-panel" class="translation-appearance-panel" aria-labelledby="translation-appearance-title" data-testid="translation-appearance-panel">
        <header class="translation-appearance-heading">
          <span>
            <strong id="translation-appearance-title">{{ t('settings.translationStyle.customizeTitle') }}</strong>
            <small>{{ t('settings.translationStyle.customizeDescription') }}</small>
          </span>
          <button type="button" class="translation-appearance-reset" :disabled="!customized" @click="resetAppearance">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
            {{ t('settings.translationStyle.reset') }}
          </button>
        </header>
        <div class="translation-appearance-grid">
          <div class="translation-appearance-colors">
            <TranslationColorField
              v-model="appearance.textColor"
              field-id="translation-text-color"
              :label="t('settings.translationStyle.textColor')"
              :swatches="TRANSLATION_TEXT_COLOR_SWATCHES"
            />
            <TranslationColorField
              v-model="appearance.lineColor"
              field-id="translation-line-color"
              :label="t('settings.translationStyle.lineColor')"
              :swatches="TRANSLATION_LINE_COLOR_SWATCHES"
              :hint="selectedPreset.usesLine ? '' : t('settings.translationStyle.lineUnused')"
            />
            <TranslationColorField
              v-model="appearance.fillColor"
              field-id="translation-fill-color"
              :label="t('settings.translationStyle.fillColor')"
              :swatches="TRANSLATION_FILL_COLOR_SWATCHES"
              :hint="selectedPreset.usesFill ? '' : t('settings.translationStyle.fillUnused')"
            />
          </div>
          <div class="translation-appearance-typography">
            <label class="translation-appearance-range">
              <span>{{ t('settings.translationStyle.fontSize') }}<b>{{ appearance.fontScale }}%</b></span>
              <input
                v-model.number="appearance.fontScale"
                type="range"
                :min="TRANSLATION_FONT_SCALE_RANGE.min"
                :max="TRANSLATION_FONT_SCALE_RANGE.max"
                :step="TRANSLATION_FONT_SCALE_RANGE.step"
                :aria-label="t('settings.translationStyle.fontSize')"
              >
            </label>
            <label class="translation-appearance-range">
              <span>{{ t('settings.translationStyle.opacity') }}<b>{{ appearance.opacity }}%</b></span>
              <input
                v-model.number="appearance.opacity"
                type="range"
                :min="TRANSLATION_OPACITY_RANGE.min"
                :max="TRANSLATION_OPACITY_RANGE.max"
                :step="TRANSLATION_OPACITY_RANGE.step"
                :aria-label="t('settings.translationStyle.opacity')"
              >
            </label>
            <div class="translation-appearance-choice">
              <span>{{ t('settings.translationStyle.fontWeightLabel') }}</span>
              <SegmentedControl
                :model-value="appearance.fontWeight"
                :options="fontWeightOptions"
                :label="t('settings.translationStyle.fontWeightLabel')"
                @update:model-value="selectFontWeight"
              />
            </div>
            <div class="translation-appearance-choice">
              <span>{{ t('settings.translationStyle.fontFamilyLabel') }}</span>
              <SegmentedControl
                :model-value="appearance.fontFamily"
                :options="fontFamilyOptions"
                :label="t('settings.translationStyle.fontFamilyLabel')"
                @update:model-value="selectFontFamily"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  </SettingsGroup>
</template>

<script lang="ts" setup>
// 与内容脚本注入网页的是同一份样式表，预览与卡片缩略图因此与网页效果一致。
import '@/src/ui/styles/translation-display.css'
import {computed, ref, watch} from 'vue'
import type {Config} from '@/src/core/config/model'
import {
  DEFAULT_TRANSLATION_APPEARANCE,
  TRANSLATION_FILL_COLOR_SWATCHES,
  TRANSLATION_FONT_FAMILY_OPTIONS,
  TRANSLATION_FONT_SCALE_RANGE,
  TRANSLATION_FONT_WEIGHT_OPTIONS,
  TRANSLATION_LINE_COLOR_SWATCHES,
  TRANSLATION_OPACITY_RANGE,
  TRANSLATION_STYLE_CATEGORIES,
  TRANSLATION_STYLE_PRESETS,
  TRANSLATION_TEXT_COLOR_SWATCHES,
  getTranslationAppearanceStyle,
  getTranslationStylePreset,
  isDefaultTranslationAppearance,
  type TranslationStyleCategory,
} from '@/src/core/config/translationAppearance'
import {useUiI18n} from '@/src/ui/i18n'
import SettingsGroup from './components/SettingsGroup.vue'
import SegmentedControl from './components/SegmentedControl.vue'
import TranslationColorField from './components/TranslationColorField.vue'
import TranslationStylePreview from './components/TranslationStylePreview.vue'

const props = defineProps<{
  config: Config
}>()
const {t, translateLegacy} = useUiI18n()
// 设置页会整体替换草稿；始终读取最新 prop，避免继续编辑旧配置对象。
const config = computed(() => props.config)
// 未知编号在网页上不加任何样式类，等同朴素模式；预览同样按朴素模式展示。
const selectedPreset = computed(() => getTranslationStylePreset(config.value.style) ?? TRANSLATION_STYLE_PRESETS[0])
const appearance = computed(() => config.value.translationAppearance)
const appearanceStyle = computed(() => getTranslationAppearanceStyle(appearance.value))
const customized = computed(() => !isDefaultTranslationAppearance(appearance.value))
const pageTheme = ref<'light' | 'dark'>('light')
const activeCategory = ref<TranslationStyleCategory>(selectedPreset.value.category)
// 弹窗、历史恢复或导入改变样式时切到对应分类，保证当前样式卡片可见。
watch(() => selectedPreset.value.category, (category) => { activeCategory.value = category })
const visiblePresets = computed(() => TRANSLATION_STYLE_PRESETS.filter((preset) => preset.category === activeCategory.value))
const categoryOptions = computed(() => TRANSLATION_STYLE_CATEGORIES.map((category) => ({value: category.value, label: t(category.labelKey)})))
const fontWeightOptions = computed(() => TRANSLATION_FONT_WEIGHT_OPTIONS.map((option) => ({value: option.value, label: t(option.labelKey)})))
const fontFamilyOptions = computed(() => TRANSLATION_FONT_FAMILY_OPTIONS.map((option) => ({value: option.value, label: t(option.labelKey)})))

function selectCategory(value: string | number): void {
  activeCategory.value = TRANSLATION_STYLE_CATEGORIES.find((category) => category.value === value)?.value ?? activeCategory.value
}

function selectFontWeight(value: string | number): void {
  appearance.value.fontWeight = TRANSLATION_FONT_WEIGHT_OPTIONS.find((option) => option.value === value)?.value ?? 'default'
}

function selectFontFamily(value: string | number): void {
  appearance.value.fontFamily = TRANSLATION_FONT_FAMILY_OPTIONS.find((option) => option.value === value)?.value ?? 'default'
}

function resetAppearance(): void {
  config.value.translationAppearance = {...DEFAULT_TRANSLATION_APPEARANCE}
}
</script>

<style scoped>
.translation-style-settings {
  display: grid;
  min-width: 0;
  gap: 16px;
  padding: 16px;
  /* 分组宽度随侧栏变化，布局按分组自身宽度切换，而不是按窗口宽度。 */
  container-type: inline-size;
}

.translation-style-mode-note {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 14px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--brand) 26%, var(--line));
  border-radius: 12px;
  color: var(--ink);
  background: color-mix(in srgb, var(--brand) 7%, var(--surface));
  font-size: 11.5px;
  line-height: 1.55;
}

.translation-style-mode-note button {
  flex: none;
  padding: 5px 11px;
  border: 0;
  border-radius: 8px;
  color: var(--brand-strong);
  background: var(--brand-soft);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}

.translation-style-workbench {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: 16px;
}

.translation-style-stage {
  display: grid;
  min-width: 0;
  gap: 10px;
}

.translation-style-highlight-toggle {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 11px 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface);
}

.translation-style-highlight-toggle > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.translation-style-highlight-toggle strong {
  color: var(--ink);
  font-size: 12px;
  line-height: 1.45;
}

.translation-style-highlight-toggle small {
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.55;
}

.translation-style-gallery {
  display: grid;
  min-width: 0;
  align-content: start;
  gap: 12px;
}

.translation-style-gallery-heading {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
}

.translation-style-gallery-heading strong {
  color: var(--ink);
  font-size: 12.5px;
}

.translation-style-categories.segmented-control {
  width: auto;
  min-width: min(100%, 260px);
  flex: 1 1 260px;
  max-width: 340px;
}

.translation-style-categories :deep(button) {
  min-height: 30px;
}

.translation-style-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(146px, 1fr));
  gap: 8px;
}

.translation-style-card {
  position: relative;
  display: grid;
  min-width: 0;
  gap: 7px;
  padding: 6px 6px 9px;
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--ink);
  background: var(--surface);
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: border-color 150ms ease, box-shadow 150ms ease, background 150ms ease;
}

.translation-style-card:hover {
  border-color: color-mix(in srgb, var(--brand) 42%, var(--line));
  box-shadow: 0 8px 18px -14px rgba(15, 23, 42, .45);
}

.translation-style-card.selected {
  border-color: var(--brand);
  background: color-mix(in srgb, var(--brand) 5%, var(--surface));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 16%, transparent);
}

.translation-style-card:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--brand) 55%, transparent);
  outline-offset: 2px;
}

/* 缩略图模拟网页表面，不随扩展皮肤着色；网格布局让块级译文像网页中一样占满宽度。 */
.translation-style-card-sample {
  display: grid;
  min-width: 0;
  min-height: 58px;
  align-content: center;
  overflow: hidden;
  padding: 0 10px;
  border-radius: 8px;
  color: #1f2328;
  background: #fff;
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, .07);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  font-size: 13px;
  line-height: 1.6;
  white-space: nowrap;
}

.translation-style-card-sample[data-page-theme="dark"] {
  color: #e6e8ec;
  background: #17191e;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .08);
}

.translation-style-card-name {
  min-width: 0;
  padding: 0 20px 0 4px;
  font-size: 11.5px;
  font-weight: 650;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.translation-style-card-check {
  position: absolute;
  right: 9px;
  bottom: 9px;
  display: grid;
  width: 13px;
  height: 13px;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
}

.translation-style-card.selected .translation-style-card-check {
  border-color: var(--brand);
  background: var(--brand);
}

.translation-style-card-check > i {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: #fff;
  opacity: 0;
}

.translation-style-card.selected .translation-style-card-check > i { opacity: 1; }

.translation-style-apply-hint {
  margin: 0;
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.55;
}

.translation-appearance-panel {
  display: grid;
  min-width: 0;
  gap: 14px;
  padding: 14px 16px 16px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface-soft);
}

.translation-appearance-heading {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.translation-appearance-heading > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.translation-appearance-heading strong {
  color: var(--ink);
  font-size: 12.5px;
  line-height: 1.45;
}

.translation-appearance-heading small {
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.55;
}

.translation-appearance-reset {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--brand-strong);
  background: var(--surface);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  transition: border-color 140ms ease, background 140ms ease;
}

.translation-appearance-reset svg { width: 14px; height: 14px; }
.translation-appearance-reset:hover:not(:disabled) { border-color: var(--brand); background: var(--brand-soft); }
.translation-appearance-reset:disabled { color: var(--muted); cursor: default; opacity: .6; }

.translation-appearance-grid {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
  gap: 18px 28px;
}

.translation-appearance-colors,
.translation-appearance-typography {
  display: grid;
  min-width: 0;
  align-content: start;
  gap: 14px;
}

.translation-appearance-range,
.translation-appearance-choice {
  display: grid;
  min-width: 0;
  gap: 7px;
}

.translation-appearance-range > span,
.translation-appearance-choice > span {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: var(--ink);
  font-size: 11.5px;
  font-weight: 700;
  line-height: 1.45;
}

.translation-appearance-range b {
  color: var(--brand-strong);
  font-variant-numeric: tabular-nums;
}

.translation-appearance-range input {
  width: 100%;
  margin: 0;
  accent-color: var(--brand);
  cursor: pointer;
}

.translation-appearance-choice :deep(.segmented-control button) {
  min-height: 30px;
}

@container (min-width: 860px) {
  .translation-style-workbench { grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); }
  .translation-appearance-grid { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); }
}

@container (max-width: 480px) {
  .translation-style-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .translation-style-highlight-toggle { align-items: flex-start; }
}

@media (max-width: 520px) {
  .translation-style-settings { padding: 12px; }
  .translation-appearance-panel { padding: 12px; }
}
</style>
