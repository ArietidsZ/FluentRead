<!--
 * @file src/features/settings/ui/FeatureServiceSettings.vue
 * 文件职责：提供按功能分配翻译服务的统一入口，让默认服务、继承关系和独立选择在一页内可见。
 * 主要内容：使用相同的服务目录与图标展示网页默认、各功能服务、有效模型和缺失凭据提示；AI 功能仅提供兼容服务，配置连接就地打开编辑窗，服务目录按钮允许管理未使用的服务，默认选择保持独立。
 * 模块边界：仅修改父级传入的配置草稿，复用现有字段与自动保存；不保存第二份映射，不发起翻译或测试连接请求。
 -->
<template>
  <div class="feature-services" data-testid="feature-services" data-i18n-ignore>
    <div class="feature-services-toolbar"><p class="feature-services-intro">{{ t('featureServices.intro') }}</p><el-button id="service-connections" @click="emit('manage-services')">{{ t('settings.services.library.shortlist') }}</el-button></div>
    <SettingsGroup>
      <SettingsItem :label="t('featureServices.default')" :description="t('featureServices.defaultHelp')">
        <div class="feature-service-control" data-feature-service="default">
          <el-select v-model="config.service" :aria-label="t('featureServices.default')" filterable :search-placeholder="t('select.searchService')">
            <template #prefix><ServiceIcon :service="config.service" :label="serviceLabel(config.service)" size="small" /></template>
            <el-option v-for="option in choices(config.service)" :key="option.value" :value="option.value" :label="option.label" :disabled="option.disabled"><span class="feature-service-option"><ServiceIcon :service="option.value" :label="option.label" size="small" />{{ option.label }}</span></el-option>
          </el-select>
          <button class="feature-service-connection" type="button" @click="emit('configure-service', config.service)">{{ t('featureServices.connection') }}</button>
        </div>
      </SettingsItem>
    </SettingsGroup>
    <SettingsGroup>
      <SettingsItem v-for="feature in featureServiceDefinitions" :key="feature.id" :label="t(`featureServices.${feature.id}`)">
        <template #copy>
          <strong>{{ t(`featureServices.${feature.id}`) }}</strong>
          <small v-if="feature.aiOnly">{{ t('featureServices.aiOnly') }}</small>
          <small v-else-if="feature.id === 'image'">{{ t('featureServices.imageHelp') }}</small>
          <small v-else-if="feature.id === 'hover'">{{ t('featureServices.profileHelp') }}</small>
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
    <button class="feature-services-center" type="button" @click="emit('open-center')">{{ t('featureServices.center') }} <span aria-hidden="true">→</span></button>
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
const emit = defineEmits<{'configure-service': [service: string]; 'open-center': []; 'manage-services': []}>();
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
.feature-services-toolbar { display: flex; align-items: start; justify-content: space-between; gap: 20px; margin-bottom: 16px; }
.feature-services-intro { margin: 0 0 18px; color: var(--muted); font-size: 13px; line-height: 1.7; }
.feature-service-control { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; min-width: 0; }
.feature-service-control :deep(.el-select) { width: 100%; }
.feature-service-meta { display: contents; }
.feature-service-meta small { color: var(--muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.feature-service-connection { justify-self: end; margin-left: auto; border: 0; padding: 3px 0; color: var(--brand-strong); background: transparent; font: inherit; font-size: 11px; cursor: pointer; }
.feature-service-option { display: flex; align-items: center; gap: 9px; }
.feature-service-warning { grid-column: 1 / -1; color: var(--muted); font-size: 11px; line-height: 1.5; }
.feature-services-center { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; padding: 14px 18px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink); font: inherit; font-size: 13px; text-align: start; cursor: pointer; }
button:hover { color: var(--brand); }
button:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }
.feature-services :deep(.settings-item) { grid-template-columns: minmax(160px, 1fr) minmax(280px, 440px); min-height: 72px; padding: 14px 18px; }
.feature-service-model { overflow-wrap: anywhere; }
@media (max-width: 700px) { .feature-services :deep(.settings-item) { grid-template-columns: minmax(0, 1fr); gap: 10px; } }
</style>
