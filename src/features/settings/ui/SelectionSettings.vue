<!--
 * @file src/features/settings/ui/SelectionSettings.vue
 * 文件职责：作为统一划词翻译的设置入口，说明统一卡片展示与按需学习，并提供即时预览。
 * 主要内容：管理统一开关和卡片展示说明，按使用顺序组织触发、显示、AI 学习与朗读设置；主要模块标记页内导航目标，朗读折叠区可由顶部导航展开；预览不发送请求。
 * 模块边界：仅编辑父级配置副本，沿用 SettingsSections 的保存和快捷键校验；不建立第二份存储或调用供应商。
 -->
<template>
  <div class="selection-settings">
    <SettingsGroup data-settings-anchor="presentation" data-settings-anchor-label="翻译卡片">
      <FeatureEnableCard v-model="enabled" title="启用划词翻译" description="选中文字后查看翻译卡片，查词或按需学习句子" />
      <div class="selection-setup">
        <div class="selection-choices">
          <h2>翻译卡片</h2>
          <p>先看译文，再按需读懂、分析句法、学用法或练习</p>
          <p class="selection-mode-note">{{ t('featureServices.selectionHint') }}</p>
        </div>
        <div class="selection-preview" aria-label="划词效果预览">
          <div class="selection-preview-caption"><span>效果预览</span><small>示例，不发送请求</small></div>
          <div class="selection-preview-tabs" role="group" aria-label="预览内容">
            <button type="button" :aria-pressed="!sentence" @click="sentence = false">单词</button>
            <button type="button" :aria-pressed="sentence" @click="sentence = true">句子</button>
          </div>
          <div class="selection-preview-source" data-i18n-ignore>{{ sentence ? sentenceSource : 'curious' }}</div>
          <div class="selection-preview-translation" data-i18n-ignore>{{ sentence ? sentenceTranslation : '好奇的；求知欲强的' }}</div>
          <template>
            <div v-if="!sentence" class="selection-preview-word" data-i18n-ignore><span class="selection-pos">形容词 · adj.</span><span data-i18n-ignore>/ˈkjʊəriəs/</span><p data-i18n-ignore>Eager to know or learn something.</p><small>想了解或学习某事；在这里描述读者的求知欲。</small></div>
            <ReadingAnswer v-else :text="sentenceAnalysis" :source-text="sentenceSource" />
          </template>
          <small class="selection-preview-footnote">卡片可继续读懂、拆句、学用法和练习</small>
        </div>
      </div>
    </SettingsGroup>
    <slot />
    <div data-settings-anchor="learning" data-settings-anchor-label="AI 深入讲解"><HarnessSettings :config="config" /></div>
    <details class="selection-advanced" data-settings-anchor="speech" data-settings-anchor-label="朗读与更多偏好">
      <summary>朗读与更多偏好</summary>
      <slot name="advanced" />
    </details>
  </div>
</template>
<script setup lang="ts">
import {computed, ref} from 'vue';
import {useUiI18n} from '@/src/ui/i18n';
const {t} = useUiI18n();
import type {Config} from '@/src/core/config/model';
import FeatureEnableCard from '@/src/ui/components/FeatureEnableCard.vue';
import SettingsGroup from './components/SettingsGroup.vue';
import HarnessSettings from './HarnessSettings.vue';
import {sentenceAnalysis, sentenceSource, sentenceTranslation} from '@/src/core/config/selectionPreview';
import {ReadingAnswer} from '@/src/features/reading-assistant/public';
const props = defineProps<{config: Config}>();
const sentence = ref(false);
const previousMode = ref(props.config.selectionTranslatorMode === 'translation-only' ? 'translation-only' : 'bilingual');
const enabled = computed({get: () => props.config.selectionTranslatorMode !== 'disabled', set: (value: boolean) => {
  if (!value && props.config.selectionTranslatorMode !== 'disabled') previousMode.value = props.config.selectionTranslatorMode;
  props.config.selectionTranslatorMode = value ? previousMode.value : 'disabled';
  props.config.disableSelectionTranslator = !value;
}});


</script>
<style scoped>
.selection-setup { display:grid; grid-template-columns:1fr 1fr; gap:24px; padding:20px; }
.selection-choices, .selection-preview { min-width:0; }
.selection-choices h2 { margin:0 0 6px; font-size:16px; color:var(--ink); }
.selection-choices p { margin:0 0 18px; color:var(--muted); font-size:12px; line-height:1.7; }
.selection-choices .selection-mode-note { margin:16px 0 0; font-size:11px; }
.selection-preview { padding:18px; border:1px solid var(--line); border-radius:14px; background:var(--surface-soft); color:var(--ink); }
.selection-preview-caption { display:flex; flex-wrap:wrap; gap:6px; justify-content:space-between; font-size:11px; color:var(--muted); }
.selection-preview-caption small { font-size:10px; }
.selection-preview-tabs { display:flex; gap:6px; margin:14px 0; }
.selection-preview-tabs button { font:inherit; font-size:11px; padding:4px 10px; border:1px solid var(--line); border-radius:6px; background:var(--surface); color:var(--muted); cursor:pointer; }
.selection-preview-tabs button[aria-pressed=true] { color:var(--brand); border-color:var(--brand); }
.selection-preview-source { font-size:16px; line-height:1.6; overflow-wrap:anywhere; }
.selection-preview-translation { margin:10px 0 16px; font-size:13px; line-height:1.7; }
.selection-preview-word { border-top:1px solid var(--line); padding-top:14px; font-size:12px; }
.selection-pos { display:inline-block; background:color-mix(in srgb, var(--brand) 10%, transparent); color:var(--brand); padding:3px 7px; border-radius:5px; margin-right:10px; }
.selection-preview-word p { line-height:1.7; }
.selection-preview-word small, .selection-preview-footnote { color:var(--muted); font-size:11px; line-height:1.7; }
.selection-preview-footnote { display:block; margin-top:18px; }
.selection-advanced { width:min(100%,1080px); margin:0 auto 12px; }
.selection-advanced > summary { padding:16px 18px; color:var(--ink); cursor:pointer; font-size:14px; font-weight:600; border:1px solid var(--line); border-radius:12px; margin-bottom:0; }
button:focus-visible, summary:focus-visible { outline:2px solid var(--brand); outline-offset:3px; }
@media(max-width:850px) { .selection-setup { grid-template-columns:1fr; padding:16px; gap:18px; } }
</style>
