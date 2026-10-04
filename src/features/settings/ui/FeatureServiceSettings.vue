<!--
 * @file src/features/settings/ui/FeatureServiceSettings.vue
 * 文件职责：在通用设置中集中分配各功能的翻译服务，沿用基础配置中的默认服务，显示继承关系和独立选择。
 * 主要内容：把翻译服务选择标题放进统一设置卡片，标题同行显示 AI 服务限制，下一行展示有效模型，使用相同的服务目录与图标展示各功能服务和缺失凭据提示；AI 功能仅提供兼容服务，配置连接定位到翻译服务页，默认选择保持独立。
 * 模块边界：仅修改父级传入的配置草稿，复用现有字段与自动保存；不保存第二份映射，不发起翻译或测试连接请求。
 -->
<template>
  <div class="feature-services" data-testid="feature-services" data-i18n-ignore>
    <SettingsGroup :title="t('featureServices.assignments')">
      <SettingsItem v-for="feature in featureServiceDefinitions" :key="feature.id" :label="t(`featureServices.${feature.id}`)">
        <template #copy>
          <div class="feature-service-heading">
            <strong>{{ t(`featureServices.${feature.id}`) }}</strong>
            <small v-if="feature.aiOnly" class="feature-service-ai-only">{{ t('featureServices.aiOnly') }}</small>
          </div>
          <small v-if="servicesType.isUseModel(effectiveService(feature)) && getFeatureModel(config, feature)" class="feature-service-model">{{ getFeatureModel(config, feature) }}</small>
        </template>
        <div class="feature-service-control" :data-feature-service="feature.id">
          <el-select :model-value="getFeatureService(config, feature)" :empty-values="[null, undefined]" :aria-label="t(`featureServices.${feature.id}`)" filterable :search-placeholder="t('select.searchService')" @update:model-value="setFeatureService(config, feature, $event)">
            <template #prefix><ServiceIcon :service="effectiveService(feature)" :label="serviceLabel(effectiveService(feature))" size="small" /></template>
            <el-option v-if="feature.inherit" value="" :label="t('featureServices.follow', {service: serviceLabel(config.service)})" />
            <el-option v-for="option in choices(getFeatureService(config, feature), feature.aiOnly)" :key="option.value" :value="option.value" :label="option.label" :disabled="option.disabled"><span class="feature-service-option"><ServiceIcon :service="option.value" :label="option.label" size="small" />{{ option.label }}</span></el-option>
          </el-select>
          <div class="feature-service-meta">
            <button class="feature-service-connection" type="button" :aria-label="`${t(`featureServices.${feature.id}`)} · ${t('featureServices.connection')}`" @click="emit('configure-service', effectiveService(feature))">{{ t('featureServices.connection') }}</button>
          </div>
          <small v-if="warning(feature)" class="feature-service-warning" role="status">{{ warning(feature) }}</small>
        </div>
      </SettingsItem>
    </SettingsGroup>
  </div>
</template>
<script setup lang="ts">
import {type Config} from '@/src/core/config/model';
import {featureServiceDefinitions, getFeatureService, setFeatureService, getFeatureModel, type FeatureServiceDefinition} from '@/src/core/config/featureServices';
import {isHarnessService} from '@/src/core/config/harness';
import {servicesType} from '@/src/core/config/catalog';
import {getMissingCredentialMessage} from '@/src/core/config/validation';
import {useUiI18n} from '@/src/ui/i18n';
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue';
import SettingsGroup from './components/SettingsGroup.vue';
import SettingsItem from './components/SettingsItem.vue';
type ServiceOption = {value: string; label: string; disabled?: boolean};
const props = defineProps<{config: Config; serviceOptions: readonly ServiceOption[]}>();
const emit = defineEmits<{'configure-service': [service: string]}>();
const {t, translateLegacy} = useUiI18n();
const serviceLabel = (service: string) => props.serviceOptions.find(option => option.value === service)?.label || service;
const effectiveService = (feature: FeatureServiceDefinition) => getFeatureService(props.config, feature) || props.config.service;
function choices(selected: string, aiOnly = false): ServiceOption[] {
  const visible = props.serviceOptions.filter(option => !option.disabled && (!aiOnly || isHarnessService(option.value, props.config.customOpenAIProviders)));
  return selected && !visible.some(option => option.value === selected)
    ? [{value: selected, label: serviceLabel(selected), disabled: true}, ...visible] : visible;
}
function warning(feature: FeatureServiceDefinition): string {
  const service = effectiveService(feature);
  if (feature.aiOnly && !isHarnessService(service, props.config.customOpenAIProviders)) return t('featureServices.needsAi');
  const model = getFeatureModel(props.config, feature);
  const message = getMissingCredentialMessage(service, {...props.config, model: {...props.config.model, [service]: model}});
  return message ? translateLegacy(message) : '';
}
</script>
<style scoped>
.feature-services { max-width: 1080px; margin: 0 auto; }
.feature-service-control { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; min-width: 0; }
.feature-service-control :deep(.el-select) { width: 100%; }
.feature-service-meta { display: contents; }
.feature-service-meta small { color: var(--muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.feature-service-connection { justify-self: end; margin-left: auto; border: 0; padding: 3px 0; color: var(--brand-strong); background: transparent; font: inherit; font-size: 11px; cursor: pointer; }
.feature-service-option { display: flex; align-items: center; gap: 9px; }
.feature-service-warning { grid-column: 1 / -1; color: var(--muted); font-size: 11px; line-height: 1.5; }
button:hover { color: var(--brand); }
button:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }
.feature-services :deep(.settings-item) { grid-template-columns: minmax(160px, 1fr) minmax(280px, 440px); min-height: 72px; padding: 14px 18px; }
.feature-service-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; }
.feature-service-ai-only { white-space: nowrap; }
.feature-service-model { overflow-wrap: anywhere; }
@media (max-width: 700px) { .feature-services :deep(.settings-item) { grid-template-columns: minmax(0, 1fr); gap: 10px; } }
</style>
