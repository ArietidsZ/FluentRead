<!--
 @file src/app/popup/PopupServices.vue
 文件职责：在 Popup 翻译服务抽屉中展示功能分配概览，以独立选择面板替代层叠下拉菜单，让窄弹窗里的服务选择更直观。
 主要内容：展示网页默认与各功能服务、本地图标、继承和配置提醒，并让多语言名称和说明自然换行；选择面板支持常用/更多、服务及模型搜索、键盘导航和返回，保留不可用的旧选择。
 模块边界：复用功能服务映射、模型解析及供应商能力，只修改父级配置草稿；保存由 PopupApp 负责，不请求翻译或处理连接密钥。
-->
<template>
  <div ref="panel" class="popup-service-panel" data-i18n-ignore @keydown.esc="returnFromPicker">
    <div v-if="!editing" class="popup-service-overview">
      <button v-for="field in fields" :key="field.id" type="button" class="service-assignment"
        :class="{'default-assignment': !field.feature}" :data-feature-service="field.id"
        :aria-label="`${t(`featureServices.${field.id}`)} · ${selectedLabel(field.feature)}`"
        @click="openPicker(field)">
        <span class="assignment-heading"><strong>{{ t(`featureServices.${field.id}`) }}</strong><span aria-hidden="true">›</span></span>
        <span class="assignment-value"><ServiceIcon :service="effective(field.feature)" :label="label(effective(field.feature))" size="small" /><span>{{ label(effective(field.feature)) }}</span></span>
        <small v-if="warning(field.feature)" class="assignment-warning" :title="warning(field.feature)">{{ t('featureServices.needsSetup') }}</small>
        <small v-else-if="field.feature?.inherit && !selected(field.feature)">{{ t('featureServices.followDefault') }}</small>
        <small v-else-if="field.feature && servicesType.isUseModel(effective(field.feature))" :title="getFeatureModel(config, field.feature)">{{ getFeatureModel(config, field.feature) }}</small>
        <small v-else-if="!field.feature">{{ t('featureServices.defaultHelp') }}</small>
      </button>
    </div>
    <section v-else class="popup-service-picker" :data-service-picker="editing.id">
      <header class="service-picker-heading">
        <button type="button" class="service-picker-back" :aria-label="t('featureServices.back')" @click="backToOverview">←</button>
        <strong>{{ t(`featureServices.${editing.id}`) }}</strong>
        <small v-if="editing.feature?.aiOnly">{{ t('featureServices.aiOnly') }}</small>
      </header>
      <label class="service-picker-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>
        <input ref="searchInput" v-model="query" type="search" :aria-label="t('popup.serviceSearchPlaceholder')" :placeholder="t('popup.serviceSearchPlaceholder')" @keydown.down.prevent="focusFirstOption" />
        <button v-if="query" type="button" :aria-label="t('popup.clearSearch')" @click="query = ''; searchInput?.focus()">×</button>
      </label>
      <div ref="results" class="service-picker-list" role="listbox" :aria-label="t(`featureServices.${editing.id}`)" @keydown="navigateOptions">
        <button v-if="editing.feature?.inherit && !query.trim()" type="button" role="option" class="service-choice follow-choice"
          data-service-choice="" :aria-selected="!selected(editing.feature)" @click="choose(editing.feature, '')">
          <ServiceIcon :service="config.service" :label="label(config.service)" size="small" />
          <span class="service-choice-copy"><strong>{{ t('featureServices.followDefault') }}</strong><small>{{ label(config.service) }}</small></span>
          <span v-if="!selected(editing.feature)" class="service-choice-check" aria-hidden="true">✓</span>
        </button>
        <template v-for="group in choiceGroups" :key="group.id">
          <button v-if="group.id === 'more' && !query.trim() && moreChoices.length" type="button" class="service-picker-more" :aria-expanded="moreOpen" @click="moreOpen = !moreOpen">
            <span>{{ t('popup.moreServices') }} <small>{{ moreChoices.length }}</small></span><span aria-hidden="true">{{ moreOpen ? '⌃' : '⌄' }}</span>
          </button>
          <div v-if="group.items.length" role="group" :aria-label="group.label" class="service-choice-group">
            <span class="service-choice-group-label">{{ group.label }}</span>
            <div class="service-choice-grid" :class="{common: group.id === 'common'}">
            <button v-for="option in group.items" :key="option.value" type="button" role="option" class="service-choice"
              :data-service-choice="option.value" :aria-selected="selected(editing.feature) === option.value"
              :disabled="option.disabled" @click="choose(editing.feature, option.value)">
              <ServiceIcon :service="option.value" :label="option.label" size="small" />
              <span class="service-choice-copy"><strong>{{ option.label }}</strong><small v-if="option.disabled">{{ translateLegacy(getTranslationServiceUnavailableMessage(option.value) || '') }}</small><small v-else-if="option.matchingModels.length">{{ option.matchingModels.join(' · ') }}</small></span>
              <span v-if="selected(editing.feature) === option.value" class="service-choice-check" aria-hidden="true">✓</span>
            </button>
            </div>
          </div>
        </template>
        <p v-if="!filteredChoices.length" class="service-picker-empty" role="status">{{ t('popup.noServiceFound') }}</p>
      </div>
      <p v-if="warning(editing.feature)" class="service-picker-warning" role="status">{{ warning(editing.feature) }}</p>
    </section>
  </div>
</template>
<script setup lang="ts">
import {computed, nextTick, ref} from 'vue';
import type {Config} from '@/src/core/config/model';
import {featureServiceDefinitions, getFeatureService, setFeatureService, getFeatureModel, type FeatureServiceDefinition} from '@/src/core/config/featureServices';
import {models, customModelString, servicesType} from '@/src/core/config/catalog';
import {isHarnessService} from '@/src/core/config/harness';
import {getMissingCredentialMessage} from '@/src/core/config/validation';
import {getTranslationServiceUnavailableMessage, isTranslationServiceAvailable} from '@/src/services/translation/capabilities';
import {searchServiceOptions, type ServiceOption} from '@/src/ui/view-model/serviceCatalog';
import {useUiI18n} from '@/src/ui/i18n';
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue';
type Field = {id: string; feature?: FeatureServiceDefinition};
const props = defineProps<{config: Config; serviceOptions: ServiceOption[]}>();
const {t, translateLegacy} = useUiI18n();
const query = ref('');
const editing = ref<Field | null>(null);
const moreOpen = ref(false);
const searchInput = ref<HTMLInputElement | null>(null);
const results = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
let triggerId = '';
const fields: Field[] = [{id: 'default'}, ...featureServiceDefinitions.map(feature => ({id: feature.id, feature}))];
const popularServices = new Set(['freeTranslation', 'microsoft', 'google', 'deepL', 'openai', 'deepseek', 'tongyi', 'gemini']);
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
const filteredChoices = computed(() => {
  const feature = editing.value?.feature;
  const available = props.serviceOptions.filter(option => !option.disabled && isTranslationServiceAvailable(option.value)
    && (!feature?.aiOnly || isHarnessService(option.value, props.config.customOpenAIProviders)));
  const matches = searchServiceOptions(available, query.value, searchableModels.value, props.config.model, props.config.customModel);
  const current = selected(feature);
  return current && !query.value.trim() && !available.some(option => option.value === current)
    ? [{value: current, label: label(current), disabled: true, matchingModels: []}, ...matches] : matches;
});
const moreChoices = computed(() => filteredChoices.value.filter(option => !popularServices.has(option.value)));
const choiceGroups = computed(() => query.value.trim()
  ? [{id: 'search', label: t('popup.providers.title'), items: filteredChoices.value}]
  : [
    {id: 'common', label: t('popup.commonServices'), items: filteredChoices.value.filter(option => popularServices.has(option.value))},
    {id: 'more', label: t('popup.moreServices'), items: moreOpen.value ? moreChoices.value : []},
  ]);
function openPicker(field: Field) {
  triggerId = field.id;
  editing.value = field;
  query.value = '';
  const current = selected(field.feature);
  moreOpen.value = Boolean(current && !popularServices.has(current));
  void nextTick(() => {
    searchInput.value?.focus();
    const currentOption = results.value?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    if (results.value && currentOption) results.value.scrollTop = Math.max(0, currentOption.offsetTop - (results.value.clientHeight - currentOption.offsetHeight) / 2);
  });
}
function backToOverview() {
  editing.value = null;
  query.value = '';
  // 概览在选择面板开启时销毁；返回后按同一功能重新定位，不聚焦已移除节点。
  void nextTick(() => panel.value?.querySelector<HTMLButtonElement>(`[data-feature-service="${triggerId}"]`)?.focus());
}
function returnFromPicker(event: KeyboardEvent) {
  if (!editing.value) return;
  event.stopPropagation();
  backToOverview();
}
function choose(feature: FeatureServiceDefinition | undefined, service: string) {
  if (service && !filteredChoices.value.some(option => option.value === service && !option.disabled)) return;
  if (!service && !feature?.inherit) return;
  if (feature) setFeatureService(props.config, feature, service);
  else props.config.service = service;
  backToOverview();
}
function focusFirstOption() { results.value?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)')?.focus(); }
function navigateOptions(event: KeyboardEvent) {
  const buttons = [...(results.value?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') || [])];
  const index = buttons.indexOf(event.target as HTMLButtonElement);
  if (index < 0 || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
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
.popup-service-overview { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.service-assignment { display: grid; align-content: start; gap: 7px; min-width: 0; padding: 10px; border: 1px solid var(--line); border-radius: 11px; background: var(--surface-soft); color: var(--ink); text-align: left; cursor: pointer; }
.service-assignment:hover { border-color: var(--brand); background: var(--brand-soft); }
.default-assignment { grid-column: 1 / -1; background: var(--surface); }
.assignment-heading { display: flex; align-items: center; justify-content: space-between; gap: 5px; font-size: 11px; }
.assignment-heading strong { font-weight: 650; }
.assignment-heading > span { color: var(--muted); font-size: 16px; line-height: 1; }
.assignment-value { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 11px; }
.assignment-value > span { min-width: 0; white-space: normal; overflow-wrap: anywhere; line-height: 1.5; }
.service-assignment > small { color: var(--muted); font-size: 9px; line-height: 1.5; white-space: normal; overflow-wrap: anywhere; }
.default-assignment > small { white-space: normal; }
.service-assignment > .assignment-warning { color: var(--brand-strong); }
.service-picker-heading { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.service-picker-heading > strong { min-width: 0; flex: 1; font-size: 12px; }
.service-picker-heading > small { max-width: 100px; color: var(--muted); font-size: 9px; }
.service-picker-back { flex: none; width: 28px; height: 28px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-soft); color: var(--ink); cursor: pointer; }
.service-picker-search { display: flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 8px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface-soft); }
.service-picker-search:focus-within { border-color: var(--brand); box-shadow: 0 0 0 2px var(--brand-soft); }
.service-picker-search > svg { width: 14px; height: 14px; flex: none; color: var(--muted); }
.service-picker-search input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--ink); font-size: 10px; }
.service-picker-search input::-webkit-search-cancel-button { display: none; }
.service-picker-search button { flex: none; border: 0; background: transparent; color: var(--muted); cursor: pointer; }
.service-picker-list { position: relative; max-height: clamp(140px, calc(100dvh - 300px), 230px); margin-top: 10px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.service-choice-grid.common { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
.service-choice-grid.common .service-choice { min-width: 0; padding: 6px 4px; gap: 6px; }
.service-choice-grid.common .service-choice-copy strong { font-size: 10px; overflow-wrap: anywhere; }
.service-choice-group-label { display: block; padding: 8px 4px 5px; color: var(--muted); font-size: 10px; }
.service-choice { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 38px; padding: 6px 8px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: var(--ink); text-align: left; cursor: pointer; }
.service-choice:hover:not(:disabled) { background: var(--surface-soft); }
.service-choice[aria-selected="true"] { border-color: color-mix(in srgb, var(--brand) 24%, transparent); background: var(--brand-soft); color: var(--brand-strong); }
.service-choice:disabled { opacity: .6; cursor: not-allowed; }
.service-choice-copy { display: grid; gap: 2px; min-width: 0; flex: 1; }
.service-choice-copy strong { font-size: 11px; font-weight: 550; }
.service-choice-copy small { color: var(--muted); font-size: 9px; line-height: 1.5; overflow-wrap: anywhere; }
.service-choice-check { font-size: 14px; color: var(--brand-strong); }
.follow-choice { margin-bottom: 3px; border-color: var(--line); }
.service-picker-more { display: flex; justify-content: space-between; align-items: center; width: 100%; min-height: 34px; margin-top: 8px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 9px; color: var(--ink); background: var(--surface-soft); font-size: 11px; cursor: pointer; }
.service-picker-more small { margin-left: 4px; color: var(--muted); font-size: 9px; }
.service-picker-empty { padding: 15px 4px; color: var(--muted); font-size: 11px; text-align: center; }
.service-picker-warning { margin: 10px 0 0; color: var(--muted); font-size: 10px; line-height: 1.6; overflow-wrap: anywhere; }
</style>
