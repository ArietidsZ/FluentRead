<!--
 * @file src/features/settings/ui/services/ServiceCatalog.vue
 * 文件职责：直接呈现完整服务目录，通过紧凑分组和搜索定位服务，保持配置与默认使用分离。
 * 主要内容：侧栏展示全部内置及自定义服务；搜索过滤目录，自定义按钮直接打开创建表单；右侧集中展示服务、模型、官网帮助和连接配置。
 * 模块边界：目录区分“配置服务”“自定义服务”和显式“设为默认”，不编辑凭据、不测试连接也不保存配置；详细表单归 ServiceConfiguration.vue，服务定义来自 core/config，外层 SettingsSections 处理持久化。
 -->
<template>
  <section
    class="service-catalog"
    aria-label="翻译服务配置"
    :data-default-service="defaultService"
    :data-editing-service="service"
  >
    <div class="catalog-layout">
      <aside class="service-rail" :aria-label="t('settings.services.library.shortlist')">
        <div class="rail-heading">
          <strong>{{ t('settings.services.library.shortlist') }} <span class="service-count">{{ allServices.length }}</span></strong>
          <button ref="addButton" type="button" class="service-add-button" data-testid="custom-service-add" @click="$emit('add:service')">
            {{ t('settings.services.library.add') }}
          </button>
        </div>
        <label class="catalog-search">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
          <input v-model="serviceQuery" type="search" :aria-label="t('settings.services.library.search')" :placeholder="t('settings.services.library.search')" />
        </label>
        <div class="service-groups">
          <section v-for="group in visibleDirectoryGroups" :key="group.id" :data-service-section="group.id" class="directory-section">
            <h4>{{ group.label }}</h4>
            <div class="directory-items">
              <ServiceCatalogItem v-for="item in group.items" :key="item.value" :item="item" compact
                :selected="service === item.value" :is-default="defaultService === item.value"
                @select="selectService" />
            </div>
          </section>
          <p v-if="!visibleDirectoryGroups.length" class="catalog-empty" role="status">{{ t('settings.services.library.empty') }}</p>
        </div>
      </aside>

      <section class="service-detail" aria-label="当前翻译服务详情">
        <div class="detail-hero">
          <ServiceIcon :service="isCustomOpenAIProviderId(service) ? 'custom' : service" :label="selectedService?.label" size="small" />
          <div class="detail-heading">
            <div class="detail-title-row">
              <h4>{{ selectedService?.label || '尚未配置服务' }}</h4>
              <span v-if="service === defaultService" class="active-badge">{{ t('settings.services.library.default') }}</span>
              <a
                v-if="website"
                class="service-website-link"
                data-testid="service-website-link"
                :href="website.url"
                target="_blank"
                rel="noopener noreferrer"
                :title="website.url"
                :aria-label="t('settings.services.openExternal', { service: selectedService?.label || service, action: t(`settings.services.${website.kind}`) })"
              >
                {{ t(`settings.services.${website.kind}`) }}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M14 3h7v7M21 3 10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
                </svg>
              </a>
            </div>
          </div>
          <button v-if="service !== defaultService && selectedService" type="button" class="catalog-set-default" @click="$emit('set:default', service)">{{ t('settings.services.library.setDefault') }}</button>
        </div>

        <details
          v-if="credentialGuide"
          class="credential-guide"
          data-testid="service-credential-guide"
          aria-label="免费额度与开通步骤"
        >
          <summary class="credential-guide-summary">
            <span class="credential-guide-summary-copy">
              <span class="credential-guide-badge">免费额度</span>
              <strong>{{ credentialGuide.freeQuota }}</strong>
            </span>
            <span class="credential-guide-summary-action">{{ t('settings.services.library.guideToggle') }}</span>
            <svg class="credential-guide-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </summary>
          <div class="credential-guide-body">
            <small>额度用尽后由厂商按量计费，请在控制台设置用量告警。</small>
            <ol class="credential-guide-steps">
              <li v-for="(step, index) in credentialGuide.steps" :key="index">{{ step }}</li>
            </ol>
            <div class="credential-guide-links">
              <a
                class="credential-guide-link is-primary"
                data-testid="service-credential-console"
                :href="credentialGuide.consoleUrl"
                target="_blank"
                rel="noopener noreferrer"
                :title="credentialGuide.consoleUrl"
              >
                {{ credentialGuide.consoleLabel }}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M14 3h7v7M21 3 10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
                </svg>
              </a>
              <a
                class="credential-guide-link"
                data-testid="service-credential-docs"
                :href="credentialGuide.docsUrl"
                target="_blank"
                rel="noopener noreferrer"
                :title="credentialGuide.docsUrl"
              >{{ credentialGuide.docsLabel }}</a>
            </div>
          </div>
        </details>

        <div v-if="showModel && service !== 'localTranslation'" class="model-section">
          <div class="model-heading">
            <strong>模型</strong>
          </div>
          <ModelPicker
            :options="modelOptions"
            :selected-model="selectedModel"
            :maximum-models="maximumModels"
            :maximum-model-length="maximumModelLength"
            :custom-model-count="customModelCount"
            :allow-custom-models="allowCustomModels"
            @select="$emit('update:model', $event)"
            @add="$emit('add:model', $event)"
            @remove="$emit('remove:model', $event)"
          />
        </div>

        <div class="service-configuration-slot" :class="{'local-model-configuration': service === 'localTranslation'}" aria-label="当前服务配置">
          <slot name="configuration" />
        </div>

      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue'
import { useUiI18n } from '@/src/ui/i18n'
import { isCustomOpenAIProviderId } from '@/src/core/config/customOpenAI'
import {
  buildServiceSections,
  type ServiceCredentialGuide,
  type ServiceOption,
  type ServiceWebsite,
} from '@/src/ui/view-model/serviceCatalog'
import ModelPicker from './ModelPicker.vue'
import ServiceCatalogItem from './ServiceCatalogItem.vue'

interface ModelPickerOption {
  value: string
  label?: string
  removable?: boolean
}

const props = defineProps<{
  service: string
  defaultService: string
  website?: ServiceWebsite
  credentialGuide?: ServiceCredentialGuide
  selectedModel?: string
  services: ServiceOption[]
  favoriteServices: string[]
  configuredServices: string[]
  modelOptions: ModelPickerOption[]
  showModel: boolean
  maximumModels: number
  maximumModelLength: number
  customModelCount: number
  allowCustomModels: boolean
}>()

const emit = defineEmits<{
  'update:service': [value: string]
  'update:favorites': [value: string[]]
  'set:default': [value: string]
  'update:model': [value: string]
  'add:service': []
  'add:model': [value: string]
  'remove:model': [value: string]
}>()

const { t } = useUiI18n()
const serviceQuery = ref('')
const addButton = ref<HTMLButtonElement | null>(null)
const customServices = computed(() => props.services.filter((item) => isCustomOpenAIProviderId(item.value)))
const builtInServices = computed(() => props.services.filter((item) => !isCustomOpenAIProviderId(item.value)))
const sections = computed(() => buildServiceSections(builtInServices.value))
const directoryGroups = computed(() => [
  ...sections.value.flatMap(section => section.groups.map(group => ({ ...group, label: group.label || section.label }))),
  ...(customServices.value.length ? [{ id: 'custom', label: t('settings.services.library.custom'), items: customServices.value }] : []),
])
const allServices = computed(() => directoryGroups.value.flatMap(group => group.items))
const visibleDirectoryGroups = computed(() => {
  const keyword = serviceQuery.value.trim().normalize('NFKC').toLocaleLowerCase()
  return directoryGroups.value
    .map(group => ({ ...group, items: group.items.filter(item =>
      [item.label, item.value, item.description, ...(item.searchTerms || [])].join(' ').normalize('NFKC').toLocaleLowerCase().includes(keyword),
    ) })).filter(group => group.items.length)
})
const selectedService = computed(() => allServices.value.find(item => item.value === props.service))

function selectService(service: string) {
  emit('update:service', service)
}
// 外部跳转和新建服务沿用同一编辑工作区，并从表单顶部开始。
watch(() => props.service, async () => {
  await nextTick()
  addButton.value?.closest('.catalog-layout')?.querySelector('.service-detail')?.scrollTo({ top: 0 })
})

</script>

<style scoped>
.service-catalog { display: flex; height: max(420px, calc(100dvh - 92px)); min-height: 0; color: var(--ink, #172033); background: var(--surface, #fff); }
.catalog-layout { display: grid; grid-template-columns: 272px minmax(0, 1fr); min-height: 0; flex: 1; overflow: hidden; }
.service-rail { display: flex; flex-direction: column; min-height: 0; padding: 14px 10px; border-right: 1px solid var(--line, #e4e7ef); }
.rail-heading { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 6px 10px; }
.rail-heading strong { color: var(--muted, #737c8f); font-size: 12px; font-weight: 500; }
.service-add-button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-height: 34px; padding: 7px 11px; border: 1px solid transparent; border-radius: 8px; color: #fff; background: var(--brand, #ef4776); font-size: 12px; font-weight: 600; white-space: nowrap; cursor: pointer; }
.service-add-button:hover { filter: brightness(.94); }
:global(:root.dark .service-add-button) { color: #21131a; background: var(--brand-strong); }
.service-count { margin-left: 4px; font-variant-numeric: tabular-nums; }
.service-groups { overflow-y: auto; min-height: 0; flex: 1; margin-top: 12px; overscroll-behavior: contain; }
.directory-items { display: grid; gap: 1px; }
.service-detail { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 20px 24px; overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable; }
.detail-hero { display: flex; align-items: flex-start; gap: 10px; padding-bottom: 18px; flex-shrink: 0; }
.detail-hero > :deep(.service-icon) { margin-top: 2px; }
.detail-heading { flex: 1; min-width: 0; }
.detail-title-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.detail-title-row h4 { margin: 0; font-size: 18px; line-height: 1.5; overflow-wrap: anywhere; }
.detail-hero p { margin: 5px 0 0; color: var(--muted, #737c8f); font-size: 12px; line-height: 1.6; }
.active-badge { color: var(--brand-strong, #bd2853); font-size: 11px; white-space: nowrap; }
.service-website-link { display: inline-flex; align-items: center; gap: 4px; color: var(--muted, #737c8f); font-size: 11px; text-decoration: none; }
.service-website-link:hover { color: var(--brand-strong, #bd2853); text-decoration: underline; }
.catalog-set-default, .custom-service-add { flex-shrink: 0; padding: 7px 11px; border: 1px solid var(--line, #e4e7ef); border-radius: 7px; color: var(--brand-strong, #bd2853); background: var(--surface, #fff); font-size: 12px; cursor: pointer; }
.catalog-set-default:hover, .custom-service-add:hover { border-color: var(--brand-strong, #bd2853); background: var(--brand-soft, #fff0f4); }
.model-section { display: grid; grid-template-columns: 120px minmax(0, 1fr); align-items: center; gap: 16px; padding: 12px 0; border-top: 1px solid var(--line, #e4e7ef); flex-shrink: 0; }
.model-heading strong { font-size: 12px; font-weight: 600; }
.service-configuration-slot { flex-shrink: 0; padding-bottom: 12px; }
.catalog-search { flex-shrink: 0; display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 0 10px; border: 1px solid var(--line, #dfe3eb); border-radius: 8px; color: var(--muted, #737c8f); background: var(--surface, #fff); }
.catalog-search:focus-within { border-color: var(--brand-strong, #bd2853); }
.catalog-search input { width: 100%; min-width: 0; padding: 9px 0; border: 0; outline: none; color: var(--ink, #172033); background: transparent; font-size: 13px; }
.directory-section + .directory-section { margin-top: 14px; }
.directory-section h4 { margin: 0 8px 5px; color: var(--muted, #737c8f); font-size: 11px; font-weight: 500; }
.catalog-empty { padding: 32px 0; color: var(--muted, #737c8f); text-align: center; font-size: 13px; }
button:focus-visible, a:focus-visible { outline: 2px solid var(--brand-strong, #bd2853); outline-offset: 2px; }
.credential-guide { margin-top: 12px; border: 1px solid #f3d4de; border-radius: 12px; background: linear-gradient(180deg, #fff6f9 0%, #fff 100%); }
.credential-guide-summary { display: flex; align-items: center; gap: 9px; min-height: 42px; padding: 8px 12px; cursor: pointer; list-style: none; }
.credential-guide-summary::-webkit-details-marker { display: none; }
.credential-guide-summary-copy { display: flex; min-width: 0; align-items: center; gap: 8px; }
.credential-guide-summary-copy strong { min-width: 0; overflow-wrap: anywhere; color: #172033; font-size: 13px; }
.credential-guide-summary-action { margin-left: auto; color: var(--brand-strong, #bd2853); font-size: 11px; white-space: nowrap; }
.credential-guide-chevron { width: 16px; height: 16px; flex: none; color: var(--muted, #8991a2); transition: transform 150ms ease; }
.credential-guide[open] .credential-guide-chevron { transform: rotate(180deg); }
.credential-guide-body { display: grid; gap: 10px; padding: 0 12px 12px; border-top: 1px solid #f3d4de; }
.credential-guide-body > small { color: #8a93a5; font-size: 10px; line-height: 1.5; }
.credential-guide-badge { flex-shrink: 0; padding: 3px 8px; border-radius: 999px; color: #fff; background: var(--brand-strong, #ef4776); font-size: 10px; font-weight: 800; letter-spacing: .04em; }
.credential-guide-steps { display: grid; gap: 6px; margin: 0; padding-left: 20px; color: #46526a; font-size: 12px; line-height: 1.6; }
.credential-guide-steps li::marker { color: #c72a56; font-weight: 800; }
.credential-guide-links { display: flex; flex-wrap: wrap; gap: 8px; }
.credential-guide-link { display: inline-flex; align-items: center; gap: 5px; min-height: 30px; padding: 4px 12px; border: 1px solid #e2e5ec; border-radius: 9px; color: #46526a; background: #fff; font-size: 12px; font-weight: 650; text-decoration: none; transition: 150ms ease; }
.credential-guide-link:hover { border-color: #f3c4d1; color: var(--brand-strong, #bd2853); background: var(--brand-soft, #fff0f4); }
.credential-guide-link.is-primary { border-color: transparent; color: #fff; background: var(--brand-strong, #d63260); }
.credential-guide-link.is-primary:hover { color: #fff; background: var(--brand-strong, #bd2853); filter: brightness(.92); box-shadow: 0 6px 16px rgba(214, 50, 96, .18); }
.credential-guide-link:focus-visible { outline: 2px solid var(--brand-strong, #bd2853); outline-offset: 2px; }

:global(:root.dark .credential-guide) { border-color: var(--line); background: var(--surface-soft); }
:global(:root.dark .credential-guide-summary-copy strong), :global(:root.dark .credential-guide-steps) { color: var(--ink); }
:global(:root.dark .credential-guide-body) { border-color: var(--line); }
:global(:root.dark .credential-guide-link) { border-color: var(--line); color: var(--ink); background: var(--surface); }
:global(:root.dark .credential-guide-link.is-primary) { color: var(--brand-strong); background: var(--brand-soft); }
@media (max-width: 1100px) {
  .catalog-layout { grid-template-columns: 240px minmax(0, 1fr); }
  .service-detail { padding: 18px; }
}
@media (max-width: 700px) {
  .service-catalog { height: auto; min-height: 0; }
  .catalog-layout { display: block; }
  .service-rail { border-right: 0; border-bottom: 1px solid var(--line, #e4e7ef); padding: 10px 12px; }
  .rail-heading { margin-bottom: 6px; }
  .service-groups { min-height: 80px; }
  .directory-items { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .service-detail { padding: 16px 12px; overflow: visible; }
  .detail-hero { flex-wrap: wrap; gap: 8px; }
  .detail-title-row h4 { font-size: 16px; }
  .model-section { grid-template-columns: 1fr; gap: 7px; }

}
</style>
