<!--
 @file src/app/popup/PopupServices.vue
 文件职责：在 Popup 的提供商抽屉中按功能选择翻译服务，保持首屏简洁且不离开当前菜单。
 主要内容：复用功能服务映射、模型解析、供应商能力与搜索，保留跟随默认和独立选择；关闭菜单不创建选项 DOM，连接参数由完整设置管理。
 模块边界：只修改父级配置草稿，保存由 PopupApp 负责；不创建第二份服务映射，不请求翻译，不修改密钥。
-->
<template>
  <div class="popup-provider-fields" data-i18n-ignore>
    <div v-for="field in fields" :key="field.id" class="popup-provider-field" :data-feature-service="field.id">
      <div class="popup-provider-label"><strong>{{ t(`featureServices.${field.id}`) }}</strong><small v-if="field.feature?.aiOnly">{{ t('featureServices.aiOnly') }}</small></div>
      <UiSelect :model-value="selected(field.feature)" :empty-values="[null, undefined]" :aria-label="t(`featureServices.${field.id}`)"
        filterable :persistent="false" :filter-method="search" :search-placeholder="t('select.searchService')"
        @visible-change="query = ''" @update:model-value="choose(field.feature, $event)">
        <template #prefix><ServiceIcon :service="effective(field.feature)" :label="label(effective(field.feature))" size="small" /></template>
        <template #label><span>{{ selectedLabel(field.feature) }}</span></template>
        <ElOption v-if="field.feature?.inherit" value="" :label="t('featureServices.follow', {service: label(config.service)})" />
        <ElOption v-for="option in choices(field.feature)" :key="option.value" :value="option.value" :label="option.label" :disabled="option.disabled">
          <span class="popup-provider-option"><ServiceIcon :service="option.value" :label="option.label" size="small" /><span>{{ option.label }}</span></span>
        </ElOption>
      </UiSelect>
      <small v-if="field.feature && servicesType.isUseModel(effective(field.feature))" class="popup-provider-model">{{ getFeatureModel(config, field.feature) }}</small>
      <small v-if="warning(field.feature)" class="popup-provider-warning" role="status">{{ warning(field.feature) }}</small>
    </div>
  </div>
</template>
<script setup lang="ts">
import {computed, ref} from 'vue';
import {ElOption} from 'element-plus';
import type {Config} from '@/src/core/config/model';
import {featureServiceDefinitions, getFeatureService, setFeatureService, getFeatureModel, type FeatureServiceDefinition} from '@/src/core/config/featureServices';
import {models, customModelString, servicesType} from '@/src/core/config/catalog';
import {isHarnessService} from '@/src/core/config/harness';
import {getMissingCredentialMessage} from '@/src/core/config/validation';
import {getTranslationServiceUnavailableMessage, isTranslationServiceAvailable} from '@/src/services/translation/capabilities';
import {searchServiceOptions} from '@/src/ui/view-model/serviceCatalog';
import {useUiI18n} from '@/src/ui/i18n';
import UiSelect from '@/src/ui/components/UiSelect.vue';
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue';
type ServiceOption = {value: string; label: string; disabled?: boolean; description?: string; searchTerms?: string[]};
const props = defineProps<{config: Config; serviceOptions: ServiceOption[]}>();
const {t, translateLegacy} = useUiI18n();
const query = ref('');
const fields: {id: string; feature?: FeatureServiceDefinition}[] = [{id: 'default'}, ...featureServiceDefinitions.map(feature => ({id: feature.id, feature}))];
const selected = (feature?: FeatureServiceDefinition) => feature ? getFeatureService(props.config, feature) : props.config.service;
const effective = (feature?: FeatureServiceDefinition) => selected(feature) || props.config.service;
const label = (service: string) => props.serviceOptions.find(option => option.value === service)?.label || service;
const selectedLabel = (feature?: FeatureServiceDefinition) => feature?.inherit && !selected(feature)
  ? t('featureServices.follow', {service: label(props.config.service)}) : label(effective(feature));
const searchableModels = computed(() => {
  const merged = new Map<string, readonly string[]>(models);
  Object.entries(props.config.customModels).forEach(([service, saved]) => merged.set(service, [...new Set([...(merged.get(service) || []).filter(model => model !== customModelString), ...saved])]));
  props.config.customOpenAIProviders.forEach(provider => merged.set(provider.id, provider.models));
  return merged;
});
const search = (value: string) => { query.value = value; };
function choices(feature?: FeatureServiceDefinition): ServiceOption[] {
  const available = props.serviceOptions.filter(option => !option.disabled && isTranslationServiceAvailable(option.value)
    && (!feature?.aiOnly || isHarnessService(option.value, props.config.customOpenAIProviders)));
  const matches = searchServiceOptions(available, query.value, searchableModels.value, props.config.model, props.config.customModel);
  const current = selected(feature);
  return current && !query.value && !available.some(option => option.value === current)
    ? [{value: current, label: label(current), disabled: true}, ...matches] : matches;
}
function choose(feature: FeatureServiceDefinition | undefined, service: string) {
  if (feature) setFeatureService(props.config, feature, service);
  else props.config.service = service;
}
function warning(feature?: FeatureServiceDefinition) {
  const service = effective(feature);
  if (feature?.aiOnly && !isHarnessService(service, props.config.customOpenAIProviders)) return t('featureServices.needsAi');
  const model = feature ? getFeatureModel(props.config, feature) : props.config.model[service];
  const message = getTranslationServiceUnavailableMessage(service)
    || getMissingCredentialMessage(service, {...props.config, model: {...props.config.model, [service]: model}});
  return message ? translateLegacy(message) : '';
}
</script>
<style scoped>
.popup-provider-fields { display: grid; gap: 16px; }
.popup-provider-field { display: grid; gap: 7px; min-width: 0; }
.popup-provider-label { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.popup-provider-label strong { color: var(--ink); font-size: 12px; font-weight: 600; }
.popup-provider-label small, .popup-provider-warning, .popup-provider-model { color: var(--muted); font-size: 10px; line-height: 1.5; overflow-wrap: anywhere; }
.popup-provider-option { display: flex; align-items: center; gap: 8px; }
.popup-provider-option > span { min-width: 0; }
.popup-provider-field :deep(.el-select__wrapper) { min-height: 38px; padding: 6px 9px; border-radius: 9px; background: var(--surface); }
.popup-provider-field :deep(.el-select__selected-item) { font-size: 11px; }
</style>
