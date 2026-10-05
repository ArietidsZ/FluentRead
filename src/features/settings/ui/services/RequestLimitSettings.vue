<!--
 * @file src/features/settings/ui/services/RequestLimitSettings.vue
 * 文件职责：在翻译服务高级设置中编辑当前模型或整个服务的请求限制，并通过作用范围和限制方式选择器展示实际生效的一组数值。
 * 主要内容：上方并排展示作用范围与限制方式，下方在同一宽度内展示三项数值；用限制方式切换全局或服务默认与整组自定义，保留停用的自定义值，按实际模型隔离设置，窄容器按字段自然换行。
 * 模块边界：只更新传入 Config 的请求限制映射，持久化由设置页现有订阅与保存队列处理；调度计数及真实网络请求由 services 层负责。
 -->
<template>
  <div class="request-limit-settings" data-testid="request-limit-settings" :data-scope="scope" :data-model="model || ''">
    <div class="request-limit-options">
      <div v-if="model" class="connection-field request-limit-scope">
        <div class="connection-field-label"><strong>{{ t('settings.requestLimits.scope') }}</strong><FieldHelp :content="t('settings.requestLimits.serviceScope')" /></div>
        <div class="connection-field-control">
          <el-select v-model="scope" :aria-label="t('settings.requestLimits.scope')" data-request-limit-scope>
            <el-option value="model" :label="t('settings.requestLimits.currentModel')" />
            <el-option value="service" :label="t('settings.requestLimits.entireService')" />
          </el-select>
        </div>
      </div>
      <div class="connection-field request-limit-inheritance">
        <div class="connection-field-label"><strong>{{ t('settings.requestLimits.mode') }}</strong></div>
        <div class="connection-field-control">
          <el-select :model-value="preference?.enabled ? 'custom' : 'inherit'" :aria-label="t('settings.requestLimits.mode')" @update:model-value="setFollowing($event === 'inherit')">
            <el-option value="inherit" :label="followLabel" />
            <el-option value="custom" :label="t('settings.requestLimits.custom')" />
          </el-select>
        </div>
      </div>
    </div>
    <RequestLimitFields :model-value="preference?.enabled ? preference.limits : inherited" :disabled="!preference?.enabled" @update:model-value="setLimits" />
    <small v-if="scope === 'model' && servicePreference?.enabled" class="request-limit-cap">{{ t('settings.requestLimits.serviceCap') }}</small>
  </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import type {Config} from '@/src/core/config/model';
import {
  getModelRequestLimitPreference, getServiceRequestLimitPreference, normalizeTranslationRequestLimits,
  withModelRequestLimit, withServiceRequestLimit, type RequestLimitPreference, type TranslationRequestLimits,
} from '@/src/core/config/requestLimits';
import {useUiI18n} from '@/src/ui/i18n';
import FieldHelp from '../components/FieldHelp.vue';
import RequestLimitFields from './RequestLimitFields.vue';

const props = defineProps<{config: Config; service: string; model?: string}>();
const {t} = useUiI18n();
const scope = ref<'model' | 'service'>(props.model ? 'model' : 'service');
watch(() => [props.service, props.model], () => { scope.value = props.model ? 'model' : 'service'; });
const servicePreference = computed(() => getServiceRequestLimitPreference(props.config.serviceRequestLimits, props.service));
const preference = computed(() => scope.value === 'model'
  ? getModelRequestLimitPreference(props.config.modelRequestLimits, props.service, props.model || '')
  : servicePreference.value);
const inherited = computed(() => scope.value === 'model' && servicePreference.value?.enabled
  ? servicePreference.value.limits : normalizeTranslationRequestLimits(props.config));
const followLabel = computed(() => t(scope.value === 'model' && servicePreference.value?.enabled
  ? 'settings.requestLimits.followService' : 'settings.requestLimits.followGlobal'));

function save(next: RequestLimitPreference): void {
  if (scope.value === 'model' && props.model) {
    props.config.modelRequestLimits = withModelRequestLimit(props.config.modelRequestLimits, props.service, props.model, next);
  } else {
    props.config.serviceRequestLimits = withServiceRequestLimit(props.config.serviceRequestLimits, props.service, next);
  }
}
function setFollowing(following: boolean): void {
  save({enabled: !following, limits: {...(preference.value?.limits || inherited.value)}});
}
function setLimits(limits: TranslationRequestLimits): void {
  save({enabled: true, limits});
}
</script>

<style scoped>
.request-limit-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.connection-field { display: grid; grid-template-columns: minmax(0, 1fr); align-content: start; gap: 8px; min-width: 0; }
.connection-field-label { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; min-height: 24px; min-width: 0; }
.connection-field-label strong { color: var(--ink); font-size: 13px; font-weight: 550; }
.connection-field-control { width: 100%; min-width: 0; }
.connection-field-control :deep(.el-select) { width: 100%; }
.request-limit-settings { display: grid; gap: 20px; min-width: 0; padding: 12px 0; }
.request-limit-settings :deep(.request-limit-fields) { padding: 0; }
.request-limit-settings :deep(.settings-item-copy) { min-height: 24px; justify-content: flex-end; }
.request-limit-cap { display: block; margin: 0; color: var(--muted); font-size: 11px; line-height: 1.6; }
@container (max-width: 600px) {
  .request-limit-options { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .request-limit-settings { gap: 16px; }
}
@container (max-width: 380px) { .request-limit-settings :deep(.request-limit-fields) { grid-template-columns: minmax(0, 1fr); } }
</style>
