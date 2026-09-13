<!--
 * @file src/features/settings/ui/services/RequestLimitSettings.vue
 * 文件职责：在翻译服务高级设置中编辑当前模型或整个服务的请求限制，并沿用既有设置行、开关与输入组件。
 * 主要内容：用一个继承开关切换全局或服务默认与整组自定义，保留停用的自定义值，按实际模型隔离设置，支持低频的服务限额编辑入口。
 * 模块边界：只更新传入 Config 的请求限制映射，持久化由设置页现有订阅与保存队列处理；调度计数及真实网络请求由 services 层负责。
 -->
<template>
  <div class="request-limit-settings" data-testid="request-limit-settings" :data-scope="scope" :data-model="model || ''">
    <SettingsItem :label="t(scope === 'service' ? 'settings.requestLimits.serviceTitle' : 'settings.requestLimits.title')">
      <div class="request-limit-inheritance">
        <span>{{ followLabel }}</span>
        <el-switch :model-value="!preference?.enabled" :aria-label="followLabel" @update:model-value="setFollowing(Boolean($event))" />
      </div>
    </SettingsItem>
    <RequestLimitFields v-if="preference?.enabled" :model-value="preference.limits" @update:model-value="setLimits" />
    <p v-else class="request-limit-summary" aria-live="polite">{{ inheritedSummary }}</p>
    <p v-if="scope === 'model' && servicePreference?.enabled" class="request-limit-summary">{{ t('settings.requestLimits.serviceCap') }}</p>
    <div v-if="model" class="request-limit-scope">
      <el-button link type="primary" size="small" :data-request-limit-scope="scope === 'model' ? 'service' : 'model'" @click="scope = scope === 'model' ? 'service' : 'model'">
        {{ t(scope === 'model' ? 'settings.requestLimits.serviceLink' : 'settings.requestLimits.modelLink') }}
      </el-button>
      <span v-if="scope === 'service'">{{ t('settings.requestLimits.serviceScope') }}</span>
    </div>
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
import SettingsItem from '../components/SettingsItem.vue';
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
const inheritedSummary = computed(() => t('settings.requestLimits.inheritSummary', {
  concurrency: inherited.value.maxConcurrentTranslations,
  second: inherited.value.translationRequestsPerSecond || '∞',
  minute: inherited.value.translationRequestsPerMinute || '∞',
}));

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
.request-limit-settings :deep(.request-limit-fields) { padding-right: 0; padding-left: 0; }
.request-limit-settings { padding-bottom: 10px; border-bottom: 1px solid var(--line); }
.request-limit-settings > :deep(.settings-item) { grid-template-columns: minmax(0, 1fr) auto; min-height: 44px; padding: 8px 0; }
.request-limit-settings :deep(.settings-item-control) { justify-content: flex-end; }
.request-limit-inheritance { display: flex; align-items: center; gap: 10px; }
.request-limit-inheritance > span, .request-limit-scope > span { color: var(--muted); font-size: 11px; }
.request-limit-summary { margin: 0 0 8px; color: var(--muted); font-size: 11px; line-height: 1.6; }
.request-limit-scope { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
@media (max-width: 520px) {
  .request-limit-settings > :deep(.settings-item) { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .request-limit-settings :deep(.settings-item-control) { justify-content: flex-end; }
}
</style>
