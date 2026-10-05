<!--
 * @file src/features/settings/ui/components/FieldHelp.vue
 * 文件职责：在设置标签旁提供可悬停和键盘聚焦的辅助说明，避免说明占据表单主空间。
 * 主要内容：统一信息图标、提示延迟、焦点轮廓及富文本提示插槽，支持提示中的外部说明链接。
 * 模块边界：只负责展示调用方提供的已本地化说明，不保存配置、不执行表单动作或网络请求。
 -->
<template>
  <el-tooltip :content="content" :trigger="['hover', 'focus']" :show-after="200" :hide-after="150" placement="top" popper-class="fluentread-field-help-popper">
    <template v-if="$slots.content" #content><slot name="content" /></template>
    <button type="button" class="field-help" :class="buttonClass" :aria-label="label || content">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></svg>
    </button>
  </el-tooltip>
</template>
<script setup lang="ts">
import {ElTooltip} from 'element-plus'
defineProps<{content: string; label?: string; buttonClass?: string}>()
</script>
<style scoped>
.field-help { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; color: var(--muted); background: transparent; cursor: help; vertical-align: middle; }
.field-help:hover, .field-help:focus-visible { color: var(--brand-strong); background: var(--brand-soft); }
.field-help:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
:global(.fluentread-field-help-popper) { max-width: min(360px, calc(100vw - 32px)); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
</style>
