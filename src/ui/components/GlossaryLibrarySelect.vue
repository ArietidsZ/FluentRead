<!--
 * @file src/ui/components/GlossaryLibrarySelect.vue
 * 文件职责：为快捷方案、文档和字幕提供一致的术语库选择控件。
 * 主要内容：在跟随全局、不使用和指定词库之间切换，展示可用词库及总开关状态，通过受控值向父级提交选择。
 * 模块边界：不读写配置、不执行翻译或联网；词库范围和服务支持由领域解析器及翻译服务负责。
 -->
<template>
  <div class="glossary-library-select" data-testid="glossary-library-select">
    <span class="glossary-select-label">{{ t('glossary.title') }}</span>
    <select
      :value="mode"
      :disabled="disabled"
      :aria-label="t('glossary.mode')"
      @change="changeMode(($event.target as HTMLSelectElement).value)"
    >
      <option value="inherit">{{ t('glossary.inherit') }}</option>
      <option value="none">{{ t('glossary.none') }}</option>
      <option value="selected" :disabled="!libraries.length">{{ t('glossary.choose') }}</option>
    </select>
    <fieldset
      v-if="mode === 'selected'"
      :disabled="disabled"
      :aria-label="t('glossary.selection')"
    >
      <label v-for="library in libraries" :key="library.id">
        <input type="checkbox" :checked="modelValue?.includes(library.id)" @change="toggleLibrary(library.id, ($event.target as HTMLInputElement).checked)" />
        <span>{{ library.name }}</span>
      </label>
    </fieldset>
    <small v-if="!enabled">{{ t('glossary.disabledHint') }}</small>
    <small v-else-if="unsupported">{{ t('glossary.unsupportedHint') }}</small>
    <small v-else>{{ t('glossary.scopeHint') }}</small>
  </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import type {GlossaryLibrary} from '@/src/core/glossary';
import {useUiI18n} from '@/src/ui/i18n';

const props = defineProps<{
  modelValue: string[] | null | undefined;
  libraries: readonly GlossaryLibrary[];
  enabled: boolean;
  unsupported?: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{'update:modelValue': [value: string[] | null]}>();
const {t} = useUiI18n();
const mode = computed(() => props.modelValue == null ? 'inherit' : props.modelValue.length ? 'selected' : 'none');
function changeMode(value: string): void {
  emit('update:modelValue', value === 'inherit' ? null : value === 'selected' && props.libraries.length
    ? [props.libraries[0].id] : []);
}
function toggleLibrary(id: string, checked: boolean): void {
  const ids = new Set(props.modelValue);
  if (checked) ids.add(id);
  else ids.delete(id);
  emit('update:modelValue', [...ids]);
}
</script>

<style scoped>
.glossary-library-select { display: flex; min-width: 0; flex-direction: column; gap: 8px; }
.glossary-select-label { font-size: 12px; color: var(--ink, var(--el-text-color-primary)); font-weight: 600; }
.glossary-library-select small { font-size: 11px; line-height: 1.5; color: var(--muted, var(--el-text-color-secondary)); }
.glossary-library-select select { width: 100%; min-width: 0; min-height: 34px; padding: 6px 10px; border: 1px solid var(--el-border-color, #d5d8e0); border-radius: 7px; background: var(--surface, var(--el-bg-color, #fff)); color: var(--ink, var(--el-text-color-primary, #303133)); font: inherit; font-size: 12px; }
.glossary-library-select fieldset { display: flex; flex-direction: column; gap: 8px; min-width: 0; max-height: 150px; overflow-y: auto; margin: 0; padding: 8px; border: 1px solid var(--el-border-color, #d5d8e0); border-radius: 7px; }
.glossary-library-select label { display: flex; align-items: start; gap: 7px; font-size: 12px; overflow-wrap: anywhere; }
.glossary-library-select input { flex-shrink: 0; accent-color: var(--el-color-primary, #5b65cb); }
.glossary-library-select select:focus-visible, .glossary-library-select input:focus-visible { outline: 2px solid var(--el-color-primary, #5b65cb); outline-offset: 2px; }
.glossary-library-select select:disabled, .glossary-library-select fieldset:disabled { opacity: .6; }
</style>
