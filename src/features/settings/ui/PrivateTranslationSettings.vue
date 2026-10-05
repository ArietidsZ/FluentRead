<!--
 * @file src/features/settings/ui/PrivateTranslationSettings.vue
 * 文件职责：配置浏览器无痕窗口专用翻译服务与模型，明确启用条件和网络边界。
 * 主要内容：复用已有服务与模型目录，仅修改专用配置；停用时保留选择，删除服务后显示错误而不自动回退。
 * 模块边界：仅编辑父级配置草稿，不申请无痕权限、不测试连接、不调用模型或保存第二份配置。
 -->
<template>
  <SettingsGroup :title="t('privateTranslation.title')">
    <SettingsItem :label="t('privateTranslation.enabled')" :description="t('privateTranslation.activation')">
      <el-switch v-model="config.privateTranslation.enabled" :aria-label="t('privateTranslation.enabled')" />
    </SettingsItem>
    <template v-if="config.privateTranslation.enabled">
      <SettingsItem :label="t('privateTranslation.service')" :description="t('privateTranslation.scope')">
        <el-select :model-value="config.privateTranslation.service" :aria-label="t('privateTranslation.service')" filterable @update:model-value="selectService">
          <el-option v-for="option in choices" :key="option.value" :value="option.value" :label="option.label" :disabled="option.disabled" />
        </el-select>
      </SettingsItem>
      <SettingsItem v-if="servicesType.isUseModel(config.privateTranslation.service)" :label="t('privateTranslation.model')" :description="t('privateTranslation.failure')">
        <el-select v-model="config.privateTranslation.model" :aria-label="t('privateTranslation.model')" filterable :allow-create="config.privateTranslation.service !== services.localTranslation" default-first-option>
          <el-option v-for="option in privateModelOptions" :key="option.value" :value="option.value" :label="option.value" />
        </el-select>
      </SettingsItem>
      <p v-if="warning" class="private-translation-note" role="status">{{ translateLegacy(warning) }}</p>
      <p class="private-translation-note">{{ t('privateTranslation.network') }} {{ t('privateTranslation.excluded') }}</p>
    </template>
  </SettingsGroup>
</template>
<script setup lang="ts">
import {computed, toRef} from 'vue';
import {useUiI18n} from '@/src/ui/i18n';
import type {Config} from '@/src/core/config/model';
import {resolveConfiguredModel, services, servicesType} from '@/src/core/config/catalog';
import {isLocalTranslationModel} from '@/src/core/config/localTranslation';
import {privateTranslationError} from '@/src/core/config/privateTranslation';
import {getMissingCredentialMessage} from '@/src/core/config/validation';
import {useServiceModelOptions} from './services/modelOptions';
import SettingsGroup from './components/SettingsGroup.vue';
import SettingsItem from './components/SettingsItem.vue';
const props = defineProps<{config: Config; serviceOptions: readonly {value: string; label: string; disabled?: boolean}[]}>();
const {t, translateLegacy} = useUiI18n();
const service = computed(() => props.config.privateTranslation.service);
const {modelOptions} = useServiceModelOptions(toRef(props, 'config'), service);
const privateModelOptions = computed(() => service.value === services.localTranslation
  ? modelOptions.value.filter(option => isLocalTranslationModel(option.value)) : modelOptions.value);
const choices = computed(() => {
  const available = props.serviceOptions.filter(option => option.value !== services.freeTranslation && !option.disabled);
  return service.value && !available.some(option => option.value === service.value)
    ? [{value: service.value, label: `${service.value} (${t('privateTranslation.unavailable')})`, disabled: true}, ...available] : available;
});
const warning = computed(() => privateTranslationError(props.config) || getMissingCredentialMessage(service.value, {
  ...props.config, model: {...props.config.model, [service.value]: props.config.privateTranslation.model},
}) || '');
function selectService(value: string) {
  props.config.privateTranslation.service = value;
  props.config.privateTranslation.model = resolveConfiguredModel(props.config.model[value], props.config.customModel[value]);
}
</script>
<style scoped>
.private-translation-note { margin: 12px 18px; font-size: 12px; line-height: 1.6; color: var(--muted); overflow-wrap: anywhere; }
.el-select { width: 100%; }
</style>
