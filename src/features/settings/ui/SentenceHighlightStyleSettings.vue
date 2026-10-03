<!--
@file src/features/settings/ui/SentenceHighlightStyleSettings.vue
文件职责：在界面风格页独立选择双语逐句高亮外观，与译文整体样式分开设置。
主要内容：提供浅色和深色网页交互预览、八张预设卡片和独立的底色、线条颜色、透明度、线型与粗细控件；支持恢复预设，开关仍由阅读辅助管理。
模块边界：只编辑父级 Config 草稿；与网页共用命名和绘制声明，不请求翻译、不修改宿主 DOM。
-->
<template>
  <SettingsGroup id="translation-sentence-highlight-style" :title="t('sentenceHighlight.title')" :description="t('sentenceHighlight.description')">
    <div class="sentence-highlight-settings">
      <div class="sentence-highlight-workbench">
        <TranslationStylePreview
          style-class=""
          :appearance-style="{}"
          :highlight-enabled="true"
          :highlight-style="config.bilingualSentenceHighlightStyle"
          :highlight-appearance="config.bilingualSentenceHighlightAppearance"
          :initial-sentence="0"
          :translation-before-original="config.translationBeforeOriginal"
          :page-theme="pageTheme"
          :caption="t('sentenceHighlight.tryHint')"
          :customized="customized"
          @update:page-theme="pageTheme = $event"
        />
        <div class="sentence-highlight-options" role="radiogroup" :aria-label="t('sentenceHighlight.title')">
          <button v-for="style in SENTENCE_HIGHLIGHT_STYLES" :key="style.value" type="button" role="radio" class="sentence-highlight-option" :class="{selected: config.bilingualSentenceHighlightStyle === style.value}" :aria-label="t(style.labelKey)" :aria-checked="config.bilingualSentenceHighlightStyle === style.value" :data-highlight-style="style.value" @click="selectPreset(style.value)">
            <span class="bilingual-highlight-preview sentence-highlight-swatch" :data-fr-bilingual-sentence-highlight-style="style.value" :data-page-theme="pageTheme" aria-hidden="true"><span class="is-sentence-highlighted">{{ t('sentenceHighlight.sample') }}</span></span>
            <strong>{{ t(style.labelKey) }}</strong>
            <span class="sentence-highlight-check" aria-hidden="true">{{ config.bilingualSentenceHighlightStyle === style.value ? '●' : '○' }}</span>
          </button>
        </div>
      </div>
      <section class="sentence-highlight-custom" aria-labelledby="sentence-highlight-custom-title" data-testid="sentence-highlight-custom">
        <header class="sentence-highlight-custom-heading">
          <div><strong id="sentence-highlight-custom-title">{{ t('sentenceHighlight.customTitle') }}</strong><p>{{ t('sentenceHighlight.customHint') }}</p></div>
          <button type="button" :disabled="!customized" @click="resetAppearance">{{ t('sentenceHighlight.reset') }}</button>
        </header>
        <div class="sentence-highlight-custom-grid">
          <div class="sentence-highlight-custom-column">
            <TranslationColorField v-model="appearance.backgroundColor" field-id="sentence-highlight-background" :label="t('sentenceHighlight.backgroundColor')" :swatches="TRANSLATION_FILL_COLOR_SWATCHES" />
            <label class="sentence-highlight-range">
              <span>{{ t('sentenceHighlight.backgroundOpacity') }}<b>{{ resolved.backgroundOpacity }}%</b></span>
              <input type="range" min="0" max="100" step="1" :value="resolved.backgroundOpacity" :aria-label="t('sentenceHighlight.backgroundOpacity')" @input="updateNumber('backgroundOpacity', $event)">
            </label>
          </div>
          <div class="sentence-highlight-custom-column">
            <TranslationColorField v-model="appearance.lineColor" field-id="sentence-highlight-line" :label="t('sentenceHighlight.lineColor')" :swatches="TRANSLATION_LINE_COLOR_SWATCHES" />
            <label class="sentence-highlight-range">
              <span>{{ t('sentenceHighlight.lineOpacity') }}<b>{{ resolved.lineOpacity }}%</b></span>
              <input type="range" min="0" max="100" step="1" :value="resolved.lineOpacity" :aria-label="t('sentenceHighlight.lineOpacity')" @input="updateNumber('lineOpacity', $event)">
            </label>
          </div>
          <label class="sentence-highlight-line-style">
            <span>{{ t('sentenceHighlight.lineStyle') }}</span>
            <select v-model="appearance.lineStyle" :aria-label="t('sentenceHighlight.lineStyle')">
              <option v-for="style in SENTENCE_HIGHLIGHT_LINE_STYLES" :key="style" :value="style">{{ t(`sentenceHighlight.line.${style}`) }}</option>
            </select>
          </label>
          <label class="sentence-highlight-range">
            <span>{{ t('sentenceHighlight.lineThickness') }}<b>{{ resolved.lineThickness }}px</b></span>
            <input type="range" min="1" max="4" step="1" :value="resolved.lineThickness" :aria-label="t('sentenceHighlight.lineThickness')" @input="updateNumber('lineThickness', $event)">
          </label>
        </div>
      </section>
      <p class="sentence-highlight-note">{{ t('sentenceHighlight.enableHint') }}</p>
    </div>
  </SettingsGroup>
</template>
<script setup lang="ts">
import {computed, ref} from 'vue'
import type {Config} from '@/src/core/config/model'
import {DEFAULT_SENTENCE_HIGHLIGHT_APPEARANCE, SENTENCE_HIGHLIGHT_STYLES, SENTENCE_HIGHLIGHT_LINE_STYLES, isDefaultSentenceHighlightAppearance, resolveSentenceHighlightAppearance, type SentenceHighlightStyle} from '@/src/core/config/sentenceHighlight'
import {TRANSLATION_FILL_COLOR_SWATCHES, TRANSLATION_LINE_COLOR_SWATCHES} from '@/src/core/config/translationAppearance'
import {useUiI18n} from '@/src/ui/i18n'
import SettingsGroup from './components/SettingsGroup.vue'
import TranslationStylePreview from './components/TranslationStylePreview.vue'
import TranslationColorField from './components/TranslationColorField.vue'
const props = defineProps<{config: Config}>()
const {t} = useUiI18n()
const pageTheme = ref<'light' | 'dark'>('light')
const appearance = computed(() => props.config.bilingualSentenceHighlightAppearance)
const resolved = computed(() => resolveSentenceHighlightAppearance(props.config.bilingualSentenceHighlightStyle, appearance.value))
const customized = computed(() => !isDefaultSentenceHighlightAppearance(appearance.value))
function resetAppearance(): void {
  props.config.bilingualSentenceHighlightAppearance = {...DEFAULT_SENTENCE_HIGHLIGHT_APPEARANCE}
}
function selectPreset(style: SentenceHighlightStyle): void {
  props.config.bilingualSentenceHighlightStyle = style
  resetAppearance()
}
function updateNumber(field: 'backgroundOpacity' | 'lineOpacity' | 'lineThickness', event: Event): void {
  appearance.value[field] = Number((event.target as HTMLInputElement).value)
}
</script>
<style scoped>
.sentence-highlight-settings { container-type: inline-size; padding: 16px; }
.sentence-highlight-workbench { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; align-items: start; }
.sentence-highlight-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.sentence-highlight-option { position: relative; display: grid; gap: 7px; min-width: 0; padding: 12px; border: 1px solid var(--line); border-radius: 12px; color: var(--ink); background: var(--surface); cursor: pointer; text-align: start; font: inherit; }
.sentence-highlight-option:hover { border-color: var(--brand); }
.sentence-highlight-option.selected { border-color: var(--brand); box-shadow: inset 0 0 0 1px var(--brand); background: var(--brand-soft); }
.sentence-highlight-option:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }
.sentence-highlight-option strong { padding-right: 16px; font-size: 12px; }
.sentence-highlight-swatch { display: block; border-radius: 6px; padding: 10px 8px; background: #fff; color: #1f2328; font-size: 13px; line-height: 1.8; }
.sentence-highlight-swatch[data-page-theme="dark"] { background: #17191e; color: #e6e8ec; }
.sentence-highlight-check { position: absolute; right: 12px; bottom: 12px; color: var(--brand-strong); }
.sentence-highlight-note { margin: 12px 0 0; color: var(--muted); font-size: 12px; line-height: 1.7; }
.sentence-highlight-custom { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--line); }
.sentence-highlight-custom-heading { display: flex; flex-wrap: wrap; align-items: start; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
.sentence-highlight-custom-heading strong { color: var(--ink); font-size: 13px; }
.sentence-highlight-custom-heading p { margin: 5px 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; }
.sentence-highlight-custom-heading button { flex: none; border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; color: var(--brand-strong); background: var(--surface); cursor: pointer; font: inherit; font-size: 11px; }
.sentence-highlight-custom-heading button:disabled { opacity: .5; cursor: default; }
.sentence-highlight-custom-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; }
.sentence-highlight-custom-column { display: grid; gap: 14px; min-width: 0; }
.sentence-highlight-range, .sentence-highlight-line-style { display: grid; min-width: 0; align-content: start; gap: 8px; color: var(--ink); font-size: 11.5px; }
.sentence-highlight-range > span { display: flex; justify-content: space-between; gap: 8px; }
.sentence-highlight-range b { color: var(--brand-strong); font-weight: 600; }
.sentence-highlight-range input { width: 100%; min-width: 0; margin: 0; accent-color: var(--brand); cursor: pointer; }
.sentence-highlight-line-style select { width: 100%; min-width: 0; padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); background: var(--surface); font: inherit; }
.sentence-highlight-custom :is(button, input, select):focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }
@container (min-width: 550px) { .sentence-highlight-custom-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (min-width: 700px) { .sentence-highlight-workbench { grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); } }
@container (min-width: 1000px) { .sentence-highlight-options { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@container (max-width: 340px) { .sentence-highlight-options { grid-template-columns: minmax(0, 1fr); } }
</style>
