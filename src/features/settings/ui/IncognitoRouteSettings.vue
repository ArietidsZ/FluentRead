<!--
 * @file src/features/settings/ui/IncognitoRouteSettings.vue
 * 文件职责：编辑独立的私密翻译服务和模型，解释实际生效范围及失效配置。
 * 主要内容：复用服务目录、图标、已有模型列表与配置草稿，保留失效选择，显式清空两个字段，展示领域校验和凭据提示。
 * 模块边界：仅更新父级自动保存的配置，不默认选择模型、不增删自定义模型或凭据、不测试连接，也不推断浏览器来源。
 -->
<template>
  <SettingsGroup :title="copy.title" data-testid="incognito-route-settings" data-i18n-ignore>
    <SettingsItem :label="copy.service">
      <el-select :model-value="config.incognitoService" :empty-values="[null, undefined]" :aria-label="copy.service" filterable @update:model-value="config.incognitoService = $event">
        <template #prefix><ServiceIcon :service="config.incognitoService" :label="serviceLabel(config.incognitoService)" size="small" /></template>
        <el-option value="" :label="copy.emptyService" />
        <el-option v-for="option in serviceChoices" :key="option.value" :value="option.value" :label="option.label" :disabled="option.disabled" />
      </el-select>
    </SettingsItem>
    <SettingsItem :label="copy.model">
      <el-select :model-value="config.incognitoModel" :empty-values="[null, undefined]" :aria-label="copy.model" filterable @update:model-value="config.incognitoModel = $event">
        <el-option value="" :label="copy.emptyModel" />
        <el-option v-for="option in modelChoices" :key="option.value" :value="option.value" :label="option.label || option.value" :disabled="option.disabled" />
      </el-select>
    </SettingsItem>
    <div class="incognito-route-details">
      <p role="status" data-testid="incognito-route-status" :data-invalid="!!status.error">{{ status.error || status.description }}</p>
      <p v-if="credentialWarning" role="status">{{ translateLegacy(credentialWarning) }}</p>
      <p>{{ copy.rules }}</p>
      <p>{{ copy.scope }}</p>
      <p>{{ copy.containment }}</p>
      <p>{{ copy.source }}</p>
      <p>{{ copy.spanning }}</p>
      <div class="incognito-route-actions">
        <button type="button" :aria-label="copy.clear" @click="clearRoute">{{ copy.clear }}</button>
        <button v-if="config.incognitoService" type="button" @click="emit('configure-service', config.incognitoService)">{{ copy.connection }}</button>
      </div>
    </div>
  </SettingsGroup>
</template>
<script setup lang="ts">
import {computed, toRef} from 'vue';
import {useUiI18n} from '@/src/ui/i18n';
import {getIncognitoRouteCopy} from './incognitoRouteCopy';
import type {Config} from '@/src/core/config/model';
import {models, services, servicesType} from '@/src/core/config/catalog';
import {resolveIncognitoRoute} from '@/src/core/config/incognitoRoute';
import {getMissingCredentialMessage} from '@/src/core/config/validation';
import {useServiceModelOptions, type ConfigurationModelOption} from './services/modelOptions';
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue';
import SettingsGroup from './components/SettingsGroup.vue';
import SettingsItem from './components/SettingsItem.vue';
type ServiceOption = {value: string; label: string; disabled?: boolean};
type ModelOption = ConfigurationModelOption & {disabled?: boolean};
const props = defineProps<{config: Config; serviceOptions: readonly ServiceOption[]}>();
const emit = defineEmits<{'configure-service': [service: string]}>();
const {language, translateLegacy} = useUiI18n();
const copy = computed(() => getIncognitoRouteCopy(language.value));
const service = computed(() => props.config.incognitoService);
const {modelOptions} = useServiceModelOptions(toRef(props, 'config'), service);
const serviceLabel = (value: string) => props.serviceOptions.find(option => option.value === value)?.label || value;
const serviceChoices = computed(() => {
  const visible = props.serviceOptions.filter(option => !option.disabled);
  return service.value && !visible.some(option => option.value === service.value)
    ? [{value: service.value, label: `${copy.value.unavailable}: ${serviceLabel(service.value)}`, disabled: true}, ...visible] : visible;
});
const modelChoices = computed<ModelOption[]>(() => {
  const visible = servicesType.isUseModel(service.value) ? modelOptions.value.filter(option => (
    service.value !== services.localTranslation || models.get(service.value)?.includes(option.value)
  )) : [];
  const selected = props.config.incognitoModel;
  return selected && !visible.some(option => option.value === selected)
    ? [{value: selected, label: `${copy.value.unavailable}: ${selected}`, disabled: true}, ...visible] : visible;
});
const status = computed(() => {
  try {
    const route = resolveIncognitoRoute(props.config);
    return {route, error: '', description: route
      ? `${copy.value.selected}: ${serviceLabel(route.service)} / ${route.model || copy.value.noModel}`
      : copy.value.disabled};
  } catch {
    return {route: undefined, error: copy.value.invalid, description: ''};
  }
});
const credentialWarning = computed(() => {
  const route = status.value.route;
  return route ? getMissingCredentialMessage(route.service, {
    ...props.config, model: {...props.config.model, [route.service]: route.model},
    customModel: {...props.config.customModel, [route.service]: route.model},
  }) || '' : '';
});
function clearRoute(): void {
  props.config.incognitoService = '';
  props.config.incognitoModel = '';
}
</script>
<style scoped>
.incognito-route-details { padding: 0 20px 18px; color: var(--muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
[data-invalid="true"] { color: var(--warning, #b26a00); }
.incognito-route-actions { display: flex; gap: 12px; flex-wrap: wrap; }
button { border: 0; background: transparent; color: var(--brand-strong); font: inherit; cursor: pointer; padding: 4px 0; }
button:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }
</style>
