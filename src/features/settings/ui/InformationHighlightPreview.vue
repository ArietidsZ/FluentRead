<!--
@file src/features/settings/ui/InformationHighlightPreview.vue
文件职责：预览信息高亮密度、配色和绘制方式，让用户在示意文本上调整阅读外观。
主要内容：固定示例按密度展示不同数量的标记，使用真实偏好生成无排版变化的柔和底色或下划线；明确示例不是模型分析结果。
模块边界：纯展示组件，不访问网页正文、不调用评分模型、不写配置；示例分数和关键词不作为阅读效果证据。
-->
<template>
  <figure class="information-highlight-preview" :class="[`color-${preferences.color}`, `style-${preferences.style}`, {'is-compact': compact}]" data-testid="information-highlight-preview">
    <p class="highlight-preview-eyebrow">{{ t('informationHighlight.preview.label') }}</p>
    <p class="highlight-preview-text"><span>{{ t('informationHighlight.preview.before') }}</span><mark>{{ t('informationHighlight.preview.first') }}</mark><span>{{ t('informationHighlight.preview.middle') }}</span><mark :class="{'is-plain': preferences.density === 'low'}">{{ t('informationHighlight.preview.second') }}</mark><span>{{ t('informationHighlight.preview.after') }}</span><mark :class="{'is-plain': preferences.density !== 'high'}">{{ t('informationHighlight.preview.third') }}</mark><span>{{ t('informationHighlight.preview.end') }}</span></p>
    <figcaption>{{ t('informationHighlight.preview.caption') }}</figcaption>
  </figure>
</template>
<script setup lang="ts">
import type {InformationHighlightPreferences} from '@/src/core/config/informationHighlight'
import {useUiI18n} from '@/src/ui/i18n'
defineProps<{preferences: InformationHighlightPreferences; compact?: boolean}>()
const {t} = useUiI18n()
</script>
<style scoped>
.information-highlight-preview { --highlight-fill: rgba(245, 178, 45, .27); --highlight-line: rgba(245, 178, 45, .85); margin: 0; border: 1px solid var(--line, #dce3eb); border-radius: 12px; padding: 18px; color: var(--ink, #25354b); background: var(--surface-soft, #f6f8fb); }
.color-mint { --highlight-fill: rgba(39, 174, 132, .27); --highlight-line: rgba(39, 174, 132, .85); } .color-blue { --highlight-fill: rgba(65, 135, 225, .27); --highlight-line: rgba(65, 135, 225, .85); }
.highlight-preview-eyebrow { margin: 0 0 10px; color: var(--muted, #637184); font-size: 11px; letter-spacing: .04em; }
.highlight-preview-text { margin: 0; font-size: 14px; line-height: 1.95; overflow-wrap: anywhere; }
mark { padding: 0; color: inherit; background: var(--highlight-fill); box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.style-underline mark { background: transparent; text-decoration: underline; text-decoration-color: var(--highlight-line); text-decoration-thickness: 2px; text-underline-offset: 3px; }
mark.is-plain { background: transparent; text-decoration: none; }
figcaption { margin-top: 14px; color: var(--muted, #637184); font-size: 11px; line-height: 1.6; }
.is-compact { padding: 12px; } .is-compact .highlight-preview-text { font-size: 12px; } .is-compact figcaption { margin-top: 8px; }
</style>
