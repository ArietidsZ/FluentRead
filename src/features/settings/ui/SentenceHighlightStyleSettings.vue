<!--
@file src/features/settings/ui/SentenceHighlightStyleSettings.vue
文件职责：在界面风格页独立选择双语逐句高亮外观，与译文整体样式分开设置。
主要内容：左侧提供浅色和深色网页交互预览，右侧用八张可视卡片选择预设；始终允许体验外观，是否启用仍由翻译设置中的阅读辅助决定。
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
          :initial-sentence="0"
          :translation-before-original="config.translationBeforeOriginal"
          :page-theme="pageTheme"
          :caption="t('sentenceHighlight.tryHint')"
          :customized="false"
          @update:page-theme="pageTheme = $event"
        />
        <div class="sentence-highlight-options" role="radiogroup" :aria-label="t('sentenceHighlight.title')">
          <button v-for="style in SENTENCE_HIGHLIGHT_STYLES" :key="style.value" type="button" role="radio" class="sentence-highlight-option" :class="{selected: config.bilingualSentenceHighlightStyle === style.value}" :aria-label="t(style.labelKey)" :aria-checked="config.bilingualSentenceHighlightStyle === style.value" :data-highlight-style="style.value" @click="config.bilingualSentenceHighlightStyle = style.value">
            <span class="bilingual-highlight-preview sentence-highlight-swatch" :data-fr-bilingual-sentence-highlight-style="style.value" :data-page-theme="pageTheme" aria-hidden="true"><span class="is-sentence-highlighted">{{ t('sentenceHighlight.sample') }}</span></span>
            <strong>{{ t(style.labelKey) }}</strong>
            <span class="sentence-highlight-check" aria-hidden="true">{{ config.bilingualSentenceHighlightStyle === style.value ? '●' : '○' }}</span>
          </button>
        </div>
      </div>
      <p class="sentence-highlight-note">{{ t('sentenceHighlight.enableHint') }}</p>
    </div>
  </SettingsGroup>
</template>
<script setup lang="ts">
import {ref} from 'vue'
import type {Config} from '@/src/core/config/model'
import {SENTENCE_HIGHLIGHT_STYLES} from '@/src/core/config/sentenceHighlight'
import {useUiI18n} from '@/src/ui/i18n'
import SettingsGroup from './components/SettingsGroup.vue'
import TranslationStylePreview from './components/TranslationStylePreview.vue'
defineProps<{config: Config}>()
const {t} = useUiI18n()
const pageTheme = ref<'light' | 'dark'>('light')
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
@container (min-width: 700px) { .sentence-highlight-workbench { grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); } }
@container (min-width: 1000px) { .sentence-highlight-options { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@container (max-width: 340px) { .sentence-highlight-options { grid-template-columns: minmax(0, 1fr); } }
</style>
