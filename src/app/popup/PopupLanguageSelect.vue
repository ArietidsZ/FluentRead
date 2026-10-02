<!--
 @file src/app/popup/PopupLanguageSelect.vue
 文件职责：隔离 Popup 语言选择器的渲染，使关闭的菜单不创建完整语言选项 DOM。
 主要内容：关闭时显示已保存语言在当前界面语言中的主名称，菜单和提示保留完整多语名称，不占用空间展示搜索图标；打开时保留 UiSelect 的搜索、键盘与定位，语言文案缓存只依赖界面语言。
 模块边界：不读写配置或浏览器状态，选择结果通过 v-model 交给 PopupApp 持久化。
-->
<template>
  <UiSelect
    :model-value="modelValue"
    :disabled="disabled"
    :title="selectedLabel"
    filterable
    :show-search-icon="false"
    :persistent="false"
    @update:model-value="$emit('update:modelValue', $event)"
    @visible-change="menuOpen = $event"
  >
    <template #label><span data-i18n-ignore>{{ menuOpen ? t('select.search') : selectedLabel.split(' / ')[0] }}</span></template>
    <ElOption v-for="item in languageOptions" :key="item.value" :value="item.value" :label="item.label" data-i18n-ignore />
  </UiSelect>
</template>
<script setup lang="ts">
import {computed, ref} from 'vue';
import {ElOption} from 'element-plus';
import UiSelect from '@/src/ui/components/UiSelect.vue';
import {getMultilingualTargetLanguageLabel, options} from '@/src/core/config/catalog';
import {useUiI18n} from '@/src/ui/i18n';

const props = defineProps<{modelValue: string; source?: boolean; disabled?: boolean}>();
defineEmits<{(event: 'update:modelValue', value: string): void}>();
const {language, t, translateLegacy} = useUiI18n();
const menuOpen = ref(false);
const choices = computed(() => props.source ? options.from : options.to);
const label = (item: {value: string; label: string}) => item.value === 'auto'
  ? translateLegacy(item.label)
  : getMultilingualTargetLanguageLabel(item.value, item.label, language.value);
const selectedLabel = computed(() => label(choices.value.find(item => item.value === props.modelValue)
  || {value: props.modelValue, label: props.modelValue}));
const languageOptions = computed(() => choices.value.map(item => ({value: item.value, label: label(item)})));
</script>
