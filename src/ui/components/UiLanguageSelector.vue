<!--
 * @file src/ui/components/UiLanguageSelector.vue
 * 文件职责：提供一个在设置页和其他扩展页面保持统一外观的界面语言选择器。
 * 主要内容：用 FluentRead 风格的 Element Plus 控件展示受支持语言、即时切换界面文案并通过共享配置 patch 持久化；失败时保留原语言并给出可访问的错误反馈。
 * 模块边界：组件不直接读取 storage，语言状态和持久化由 src/ui/i18n.ts 统一协调；语言显示规则仍由 core/i18n 提供。
 -->
<template>
  <div class="ui-language-selector" :class="{ compact }">
    <span v-if="!compact" class="ui-language-label">{{ t('language.selectorLabel') }}</span>
    <ElSelect
      class="ui-language-select"
      :model-value="language"
      data-testid="ui-language-select"
      :aria-label="t('language.selectorLabel')"
      :title="t('language.selectorLabel')"
      :placeholder="t('language.selectorLabel')"
      popper-class="ui-language-select-popper"
      fit-input-width
      @change="handleChange"
    >
      <ElOption
        v-for="option in UI_LANGUAGE_OPTIONS"
        :key="option.value"
        :value="option.value"
        :label="getUiLanguageDisplayLabel(option.value, language)"
      >
        <span class="ui-language-option">
          <span>{{ getUiLanguageDisplayLabel(option.value, language) }}</span>
        </span>
      </ElOption>
    </ElSelect>
    <span v-if="errorMessage" class="ui-language-error" role="status" aria-live="polite">{{ errorMessage }}</span>
  </div>
</template>

<script setup lang="ts">
import {ElOption} from 'element-plus';
import ElSelect from './UiSelect.vue';
import {ref} from 'vue';
import {getUiLanguageDisplayLabel, UI_LANGUAGE_OPTIONS, type UiLanguage} from '@/src/core/i18n';
import {useUiI18n} from '@/src/ui/i18n';

withDefaults(defineProps<{
  compact?: boolean;
}>(), {
  compact: false,
});

const {language, t, setLanguage} = useUiI18n();
const errorMessage = ref('');

async function handleChange(value: UiLanguage): Promise<void> {
  errorMessage.value = '';
  try {
    await setLanguage(value);
  } catch {
    errorMessage.value = t('language.saveFailed');
  }
}
</script>

<style scoped>
.ui-language-selector {
  display: flex;
  width: 100%;
  max-width: 360px;
  min-width: 0;
  align-items: center;
  gap: 8px;
  color: var(--muted, #687287);
  font-size: 11px;
}

.ui-language-selector.compact {
  min-width: 0;
}

.ui-language-select {
  width: 100%;
  min-width: 0;
}

.ui-language-label {
  flex: 0 0 auto;
  font-weight: 700;
  white-space: nowrap;
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

.ui-language-option {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.ui-language-option > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 700px) {
  .ui-language-selector:not(.compact) {
    align-items: flex-start;
    flex-wrap: wrap;
  }
}
</style>
