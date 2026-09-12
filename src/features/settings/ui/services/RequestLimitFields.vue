<!--
 * @file src/features/settings/ui/services/RequestLimitFields.vue
 * 文件职责：在全局与服务设置中复用请求限制的并排表单，沿用 SettingsItem 和 Element Plus 的现有外观，紧凑展示一组相关参数。
 * 主要内容：显示并发、每秒和每分钟限制，只提交合法整数，保留输入过程中的空值而不覆盖已保存配置。
 * 模块边界：本组件只校验并发与频率的表单值并发出更新，不选择配置作用域、不持久化，也不执行请求。
 -->
<template>
  <div class="request-limit-fields">
    <SettingsItem v-for="field in fields" :key="field.key" :label="translateLegacy(field.label)">
      <template #copy>
        <el-tooltip :content="field.key === 'maxConcurrentTranslations' ? translateLegacy(field.help) : t('settings.requestLimits.rateHelp')" :show-after="500" placement="top-start">
          <strong>{{ translateLegacy(field.label) }}<el-icon class="request-limit-info"><InfoFilled /></el-icon></strong>
        </el-tooltip>
      </template>
      <div class="request-limit-number">
        <el-input-number
          :model-value="modelValue[field.key]" :min="field.min" :max="field.max" :step="1" :controls="false"
          :aria-label="translateLegacy(field.label)" @change="update(field.key, $event)"
        />
      </div>
    </SettingsItem>
  </div>
</template>

<script setup lang="ts">
import {InfoFilled} from '@element-plus/icons-vue';
import type {TranslationRequestLimits} from '@/src/core/config/requestLimits';
import {useUiI18n} from '@/src/ui/i18n';
import SettingsItem from '../components/SettingsItem.vue';

const props = defineProps<{modelValue: TranslationRequestLimits}>();
const emit = defineEmits<{'update:model-value': [value: TranslationRequestLimits]}>();
const {translateLegacy, t} = useUiI18n();
const fields = [
  {key: 'maxConcurrentTranslations', label: '翻译并发数', min: 1, max: 100, help: '控制同时进行的最大翻译任务数，数值越高翻译速度越快，但可能占用更多系统资源'},
  {key: 'translationRequestsPerSecond', label: '每秒最多请求数', min: 0, max: 1000, help: '设为 0 表示不限速。'},
  {key: 'translationRequestsPerMinute', label: '每分钟最多请求数', min: 0, max: 10000, help: '设为 0 表示不限速。'},
] as const;

function update(key: keyof TranslationRequestLimits, value: number | undefined): void {
  const field = fields.find(field => field.key === key)!;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < field.min || value > field.max) return;
  emit('update:model-value', {...props.modelValue, [key]: value});
}
</script>

<style scoped>
.request-limit-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  padding: 14px 16px;
}
.request-limit-fields :deep(.settings-item) {
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: 8px;
  min-height: 0;
  padding: 0;
  border-top: 0 !important;
}
.request-limit-fields :deep(.settings-item:hover) { background: transparent; }
.request-limit-number { width: 100%; min-width: 0; }
.request-limit-number :deep(.el-input-number) { width: 100%; }
.request-limit-info { margin-left: 5px; color: var(--muted); font-size: 12px; vertical-align: middle; }
@media (max-width: 520px) {
  .request-limit-fields { gap: 10px; padding: 12px 0; }
  .request-limit-fields :deep(.settings-item-copy) { min-height: 32px; justify-content: flex-end; }
  .request-limit-fields :deep(.settings-item-copy strong) { font-size: 11px; }
  .request-limit-info { margin-left: 3px; font-size: 10px; }
}
@media (max-width: 340px) {
  .request-limit-fields { grid-template-columns: minmax(0, 1fr); }
}
</style>
