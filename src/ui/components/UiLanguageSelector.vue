<!--
 * @file src/ui/components/UiLanguageSelector.vue
 * 文件职责：提供一个在 popup、设置页和其他扩展页面都可发现的界面语言选择器。
 * 主要内容：展示受支持的语言、即时切换界面文案并通过共享配置 patch 持久化；失败时
 * 保留原语言并给出可访问的错误反馈。
 * 模块边界：组件不直接读取 storage，语言状态和持久化由 src/ui/i18n.ts 统一协调。
 -->
<template>
  <label class="ui-language-selector" :class="{ compact }">
    <span class="ui-language-label">{{ t('language.selectorLabel') }}</span>
    <select
      :value="language"
      data-testid="ui-language-select"
      :aria-label="t('language.selectorLabel')"
      :title="t('language.selectorLabel')"
      @change="handleChange"
    >
      <option v-for="option in UI_LANGUAGE_OPTIONS" :key="option.value" :value="option.value">
        {{ t(option.labelKey) }}
      </option>
    </select>
    <span v-if="errorMessage" class="ui-language-error" role="status" aria-live="polite">{{ errorMessage }}</span>
  </label>
</template>

<script setup lang="ts">
import {ref} from 'vue';
import {UI_LANGUAGE_OPTIONS, type UiLanguage} from '@/src/core/i18n';
import {useUiI18n} from '@/src/ui/i18n';

withDefaults(defineProps<{
  compact?: boolean;
}>(), {
  compact: false,
});

const {language, t, setLanguage} = useUiI18n();
const errorMessage = ref('');

async function handleChange(event: Event): Promise<void> {
  const target = event.currentTarget;
  if (!(target instanceof HTMLSelectElement)) return;
  errorMessage.value = '';
  try {
    await setLanguage(target.value as UiLanguage);
  } catch {
    errorMessage.value = t('language.saveFailed');
  }
}
</script>

<style scoped>
.ui-language-selector {
  display: inline-flex;
  min-width: 190px;
  align-items: center;
  gap: 8px;
  color: var(--muted, #687287);
  font-size: 11px;
}

.ui-language-selector.compact {
  min-width: 0;
}

.ui-language-label {
  flex: 0 0 auto;
  font-weight: 700;
  white-space: nowrap;
}

.ui-language-selector select {
  min-height: 32px;
  padding: 0 26px 0 9px;
  border: 1px solid var(--line, #dfe3eb);
  border-radius: 9px;
  color: var(--ink, #263044);
  background: var(--surface, #fff);
  font: inherit;
  cursor: pointer;
}

.ui-language-selector small {
  max-width: 310px;
  line-height: 1.4;
}

.ui-language-error {
  color: #c52f58;
  font-size: 10px;
}

.ui-language-selector.compact .ui-language-label {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 700px) {
  .ui-language-selector:not(.compact) {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .ui-language-selector:not(.compact) small {
    flex-basis: 100%;
  }
}
</style>
