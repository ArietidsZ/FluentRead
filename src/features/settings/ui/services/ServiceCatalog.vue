<!--
 * @file src/features/settings/ui/services/ServiceCatalog.vue
 * 文件职责：呈现个人翻译服务与完整目录，按默认、常用和已保存配置组织紧凑列表，并保留独立的服务配置工作区。
 * 主要内容：组件接收当前服务、网站入口、云服务厂商开通指引和配置，支持个人服务去重、持久化常用标记、我的服务/自定义服务/全部服务三级入口、全目录分类筛选与关键词搜索、动态 OpenAI 兼容服务、分组计数、官网新标签页跳转、免费额度与控制台链接展示和紧凑模型选择。
 * 模块边界：目录区分“查看服务”“标记常用”和显式“设为默认”，不编辑凭据、不测试连接也不保存配置；详细表单归 ServiceConfiguration.vue，服务定义来自 core/config，外层 SettingsSections 处理持久化。
 -->
<template>
  <section
    class="service-catalog"
    aria-label="翻译服务配置"
    :data-default-service="defaultService"
    :data-editing-service="service"
  >
    <header class="catalog-toolbar">
      <div class="catalog-toolbar-inner">
        <div role="group" class="catalog-views" :aria-label="t('settings.services.library.views')">
          <button type="button" :aria-pressed="catalogView === 'mine'" data-service-view="mine" @click="switchView('mine')">
            <span>{{ t('settings.services.library.mine') }}</span>
          </button>
          <button type="button" :aria-pressed="catalogView === 'custom'" data-service-view="custom" @click="switchView('custom')">
            <span>{{ t('settings.services.library.custom') }}</span>
            <small>{{ customServices.length }}</small>
          </button>
          <button type="button" :aria-pressed="catalogView === 'all'" data-service-view="all" @click="switchView('all')">
            <span>{{ t('settings.services.library.all') }}</span>
            <small>{{ allServices.length }}</small>
          </button>
        </div>
        <div class="catalog-actions">
          <label class="catalog-search">
            <span aria-hidden="true">⌕</span>
            <input v-model="serviceQuery" type="search" :aria-label="t('settings.services.library.search')" :placeholder="t('settings.services.library.search')" @input="catalogView = 'all'; category = 'all'" />
          </label>
          <button type="button" class="custom-service-add" data-testid="custom-service-add"
            :disabled="customServiceLimitReached" :title="`${customServices.length} / ${maximumCustomServices}`" @click="$emit('add:service')">
            {{ t('settings.services.library.add') }}
          </button>
        </div>
      </div>
    </header>
    <div v-show="catalogView === 'mine'" class="catalog-layout">
      <aside class="service-rail" :aria-label="t('settings.services.library.mine')">
        <div class="service-groups">
          <section v-for="group in personalGroups" :key="group.id" class="service-group" :data-personal-group="group.id">
            <div class="group-heading"><strong>{{ t(`settings.services.library.${group.id}`) }}</strong><small>{{ group.items.length }}</small></div>
            <ServiceCatalogItem v-for="item in group.items" :key="item.value" :item="item" compact
              :selected="service === item.value" :is-default="defaultService === item.value" :favorite="favoriteServices.includes(item.value)"
              @select="selectService" @favorite="toggleFavorite" />
          </section>
        </div>
        <button type="button" class="catalog-browse" @click="switchView('all')">{{ t('settings.services.library.browse') }} →</button>
      </aside>

      <section class="service-detail" aria-label="当前翻译服务详情">
        <div class="detail-hero">
          <ServiceIcon :service="isCustomOpenAIProviderId(service) ? 'custom' : service" :label="selectedService?.label" size="large" />
          <div class="detail-heading">
            <div class="detail-title-row">
              <h4>{{ selectedService?.label || '尚未配置服务' }}</h4>
              <span class="active-badge">{{ service === defaultService ? '当前默认' : '正在配置' }}</span>
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
            <button v-if="service !== defaultService && selectedService" type="button" class="catalog-set-default" @click="$emit('set:default', service)">{{ t('settings.services.library.setDefault') }}</button>
            <p v-if="selectedService?.description">{{ selectedService.description }}</p>
          </div>
        </div>

        <aside
          v-if="credentialGuide"
          class="credential-guide"
          data-testid="service-credential-guide"
          aria-label="免费额度与开通步骤"
        >
          <div class="credential-guide-head">
            <span class="credential-guide-badge">免费额度</span>
            <strong>{{ credentialGuide.freeQuota }}</strong>
            <small>额度用尽后由厂商按量计费，请在控制台设置用量告警。</small>
          </div>
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
        </aside>

        <div v-if="showModel" class="model-section">
          <div class="model-heading">
            <strong>模型</strong>
            <small>选择已保存模型，或添加新的模型标识</small>
          </div>
          <ModelPicker
            :options="modelOptions"
            :selected-model="selectedModel"
            :maximum-models="maximumModels"
            :maximum-model-length="maximumModelLength"
            :custom-model-count="customModelCount"
            @select="$emit('update:model', $event)"
            @add="$emit('add:model', $event)"
            @remove="$emit('remove:model', $event)"
          />
        </div>

        <div v-else class="no-model-panel">
          <span aria-hidden="true">✓</span>
          <div><strong>此服务无需模型配置</strong><p>机器翻译直接使用自身引擎。</p></div>
        </div>

        <div class="service-configuration-slot" aria-label="当前服务配置">
          <slot name="configuration" />
        </div>

      </section>
    </div>
    <section v-show="catalogView !== 'mine'" class="service-directory" :aria-label="t(`settings.services.library.${catalogView === 'custom' ? 'custom' : 'all'}`)" :data-directory-view="catalogView">
      <div role="group" class="directory-filters" :aria-label="t('settings.services.library.categories')">
        <button type="button" :aria-pressed="category === 'all'" @click="category = 'all'">{{ t('settings.services.library.allCategories') }}</button>
        <button v-for="group in directoryGroups" :key="group.id" type="button" :aria-pressed="category === group.id" @click="category = group.id">{{ group.label }}</button>
      </div>
      <section v-for="group in visibleDirectoryGroups" :key="group.id" :data-service-section="group.id" class="directory-section">
        <h4>{{ group.label }} <small>{{ group.items.length }}</small></h4>
        <div class="directory-grid">
          <ServiceCatalogItem v-for="item in group.items" :key="item.value" :item="item"
            :selected="service === item.value" :is-default="defaultService === item.value" :favorite="favoriteServices.includes(item.value)"
            :status="configuredServices.includes(item.value) ? t('settings.services.library.saved') : ''"
            @select="selectService" @favorite="toggleFavorite" />
        </div>
      </section>
      <p v-if="!visibleDirectoryGroups.length" class="catalog-empty" role="status">{{ t('settings.services.library.empty') }}</p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
import { buildPersonalServiceGroups } from '@/src/ui/view-model/serviceLibrary'

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
  maximumCustomServices: number
  maximumModels: number
  maximumModelLength: number
  customModelCount: number
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
const catalogView = ref<'mine' | 'custom' | 'all'>('mine')
const category = ref('all')
const customServices = computed(() => props.services.filter((item) => isCustomOpenAIProviderId(item.value)))
const builtInServices = computed(() => props.services.filter((item) => !isCustomOpenAIProviderId(item.value)))
const sections = computed(() => buildServiceSections(builtInServices.value))
const directoryGroups = computed(() => [
  ...sections.value.flatMap(section => section.groups.map(group => ({ ...group, label: group.label || section.label }))),
  ...(customServices.value.length ? [{ id: 'custom', label: t('settings.services.library.custom'), items: customServices.value }] : []),
])
const allServices = computed(() => directoryGroups.value.flatMap(group => group.items))
const personalGroups = computed(() => buildPersonalServiceGroups(allServices.value, props.defaultService, props.service, props.favoriteServices, props.configuredServices))
const visibleDirectoryGroups = computed(() => {
  const keyword = serviceQuery.value.trim().normalize('NFKC').toLocaleLowerCase()
  return directoryGroups.value.filter(group => category.value === 'all' || category.value === group.id)
    .map(group => ({ ...group, items: group.items.filter(item =>
      [item.label, item.value, item.description, ...(item.searchTerms || [])].join(' ').normalize('NFKC').toLocaleLowerCase().includes(keyword),
    ) })).filter(group => group.items.length)
})
const customServiceLimitReached = computed(() => customServices.value.length >= props.maximumCustomServices)
const selectedService = computed(() => allServices.value.find(item => item.value === props.service))

function switchView(view: 'mine' | 'custom' | 'all') {
  catalogView.value = view
  serviceQuery.value = ''
  category.value = view === 'custom' ? 'custom' : 'all'
}
function selectService(service: string) {
  emit('update:service', service)
  switchView('mine')
}
function toggleFavorite(service: string) {
  emit('update:favorites', props.favoriteServices.includes(service)
    ? props.favoriteServices.filter(value => value !== service)
    : [...props.favoriteServices, service])
}
// 新建服务、跨页跳转和配置恢复都应直接呈现当前编辑目标。
watch(() => props.service, () => switchView('mine'))

</script>

<style scoped>
.service-catalog { display: flex; height: clamp(520px, calc(100vh - 270px), 760px); min-height: 520px; margin: 2px 0 20px; border: 1px solid var(--line, #e4e7ef); border-radius: 16px; overflow: hidden; background: var(--surface, #fff); flex-direction: column; }
.catalog-toolbar { padding: 12px 16px; border-bottom: 1px solid var(--line, #e4e7ef); flex-shrink: 0; }
.catalog-toolbar-inner { display: flex; align-items: center; gap: 16px; width: 100%; flex-wrap: wrap; }
.catalog-views { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; width: min(100%, 540px); min-width: min(100%, 420px); padding: 4px; border: 1px solid var(--line, #dfe3eb); border-radius: 13px; background: var(--surface-soft, #f7f8fb); }
.catalog-views button, .directory-filters button { border: 1px solid transparent; border-radius: 9px; padding: 9px 14px; background: transparent; color: var(--muted, #737c8f); cursor: pointer; font: inherit; font-size: 14px; font-weight: 650; }
.catalog-views button { display: flex; align-items: center; justify-content: center; gap: 7px; min-width: 0; min-height: 44px; white-space: nowrap; }
.catalog-views button[aria-pressed="true"] { border-color: color-mix(in srgb, var(--brand-strong, #bd2853) 48%, transparent); color: var(--brand-strong, #bd2853); background: var(--brand-soft, #fff0f4); box-shadow: 0 3px 10px color-mix(in srgb, var(--brand, #ef4776) 15%, transparent); }
.catalog-views button:not([aria-pressed="true"]):hover { color: var(--ink, #172033); background: var(--surface, #fff); }
.catalog-views small { display: inline-grid; place-items: center; min-width: 22px; height: 20px; padding: 0 5px; border-radius: 999px; color: currentColor; background: color-mix(in srgb, currentColor 10%, transparent); font-size: 11px; font-weight: 750; }
.catalog-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; min-width: 0; margin-left: auto; flex: 1 1 350px; }
.catalog-search { display: flex; align-items: center; gap: 8px; width: 240px; max-width: 100%; min-height: 38px; padding: 0 10px; border: 1px solid var(--line, #dfe3eb); border-radius: 9px; background: var(--surface, #fff); }
.catalog-search span { color: var(--muted, #8991a2); }
.catalog-search input { width: 100%; min-width: 0; border: 0; color: var(--ink, #172033); background: transparent; font-size: 13px; padding: 8px 0; }
.custom-service-add, .catalog-set-default { padding: 7px 10px; border: 1px solid var(--brand-strong, #bd2853); border-radius: 8px; color: var(--brand-strong, #bd2853); background: var(--brand-soft, #fff0f4); font-size: 12px; cursor: pointer; }
.custom-service-add:disabled { opacity: .5; cursor: not-allowed; }
.catalog-set-default { margin: 8px 0; }
.catalog-layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 0; flex: 1; overflow: hidden; }
.service-rail { display: flex; flex-direction: column; min-height: 0; padding: 12px 8px; border-right: 1px solid var(--line, #eceef3); background: var(--surface-soft, #fafbfc); }
.service-groups { overflow-y: auto; min-height: 0; flex: 1; }
.service-group + .service-group { margin-top: 16px; }
.group-heading { display: flex; justify-content: space-between; align-items: center; margin: 4px 8px 6px; color: var(--muted, #737c8f); }
.group-heading strong, .group-heading small { font-size: 12px; font-weight: 500; }
.catalog-browse { flex-shrink: 0; text-align: left; margin: 12px 6px 0; padding: 12px 4px 0; border: 0; border-top: 1px solid var(--line, #e4e7ef); color: var(--brand-strong, #bd2853); background: transparent; font-size: 13px; cursor: pointer; }
.service-directory { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 22px 24px; }
.directory-filters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 18px; }
.directory-filters button { border-color: var(--line, #e4e7ef); padding: 6px 10px; }
.directory-section + .directory-section { margin-top: 22px; }
.directory-section h4 { margin: 0 0 10px; color: var(--ink, #172033); font-size: 13px; font-weight: 600; }
.directory-section h4 small { color: var(--muted, #737c8f); margin-left: 6px; font-size: 11px; font-weight: 400; }
.directory-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.catalog-empty { text-align: center; color: var(--muted, #737c8f); padding: 24px; }
.catalog-toolbar button:focus-visible, .directory-filters button:focus-visible, .catalog-browse:focus-visible, .catalog-set-default:focus-visible { outline: 2px solid var(--brand-strong, #bd2853); outline-offset: 2px; }
.service-detail { display: flex; min-width: 0; min-height: 0; margin: 14px; padding: 22px; border: 1px solid #e4e7ef; border-radius: 16px; background: #fff; flex-direction: column; overflow: hidden; }
.service-detail > .detail-hero,
.service-detail > .credential-guide,
.service-detail > .model-section,
.service-detail > .no-model-panel,
.service-detail > .service-configuration-slot { width: min(100%, 1080px); }
.detail-hero { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 13px; padding-bottom: 20px; border-bottom: 1px solid #eceef3; }
.detail-heading { flex: 1 1 180px; min-width: 0; }
.detail-title-row { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; }
.detail-title-row h4 { min-width: 0; margin: 1px 0 5px; color: #172033; font-size: 22px; overflow-wrap: anywhere; }
.service-website-link { display: inline-flex; align-items: center; gap: 5px; min-height: 28px; padding: 2px 4px; border-radius: 5px; color: var(--brand-strong, #bd2853); font-size: 12px; font-weight: 600; line-height: 1.5; text-decoration: none; }
.service-website-link svg { flex-shrink: 0; }
.service-website-link:hover { background: var(--brand-soft, #fff0f4); text-decoration: underline; text-underline-offset: 3px; }
.service-website-link:focus-visible { outline: 2px solid var(--brand-strong, #bd2853); outline-offset: 2px; }
.active-badge { flex-shrink: 0; white-space: nowrap; padding: 4px 8px; border-radius: 999px; color: #bd2853; background: #ffe9ef; font-size: 10px; font-weight: 800; }
.detail-hero p { margin: 0; color: #737c8f; font-size: 13px; line-height: 1.6; }
.credential-guide { display: grid; gap: 12px; margin-top: 16px; padding: 16px 18px; border: 1px solid #f3d4de; border-radius: 14px; background: linear-gradient(180deg, #fff6f9 0%, #fff 100%); }
.credential-guide-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.credential-guide-badge { flex-shrink: 0; padding: 3px 8px; border-radius: 999px; color: #fff; background: var(--brand-strong, #ef4776); font-size: 10px; font-weight: 800; letter-spacing: .04em; }
.credential-guide-head strong { color: #172033; font-size: 14px; }
.credential-guide-head small { flex-basis: 100%; color: #8a93a5; font-size: 11px; }
.credential-guide-steps { display: grid; gap: 6px; margin: 0; padding-left: 20px; color: #46526a; font-size: 12px; line-height: 1.6; }
.credential-guide-steps li::marker { color: #c72a56; font-weight: 800; }
.credential-guide-links { display: flex; flex-wrap: wrap; gap: 8px; }
.credential-guide-link { display: inline-flex; align-items: center; gap: 5px; min-height: 30px; padding: 4px 12px; border: 1px solid #e2e5ec; border-radius: 9px; color: #46526a; background: #fff; font-size: 12px; font-weight: 650; text-decoration: none; transition: 150ms ease; }
.credential-guide-link:hover { border-color: #f3c4d1; color: var(--brand-strong, #bd2853); background: var(--brand-soft, #fff0f4); }
.credential-guide-link.is-primary { border-color: transparent; color: #fff; background: var(--brand-strong, #d63260); }
.credential-guide-link.is-primary:hover { color: #fff; background: var(--brand-strong, #bd2853); filter: brightness(.92); box-shadow: 0 6px 16px rgba(214, 50, 96, .18); }
.credential-guide-link:focus-visible { outline: 2px solid var(--brand-strong, #bd2853); outline-offset: 2px; }
.model-section {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  align-items: center;
  gap: 20px;
  min-height: 54px;
  margin-top: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #edf0f5;
  flex: 0 0 auto;
}
.model-heading { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.model-heading strong { color: #46526a; font-size: 12px; }
.model-heading small { color: #8b93a4; font-size: 10px; line-height: 1.4; }
.no-model-panel { display: flex; align-items: center; gap: 12px; margin-top: 20px; padding: 18px; border: 1px solid #d9eee5; border-radius: 14px; background: #f2faf6; }
.no-model-panel > span { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; color: #fff; background: #28aa79; font-size: 14px; }
.no-model-panel strong { color: #185d46; font-size: 15px; }
.no-model-panel p { margin: 4px 0 0; color: #628074; font-size: 12px; }
.service-configuration-slot { min-height: 0; margin-top: 16px; padding-top: 16px; border-top: 1px solid #eceef3; overflow-y: auto; flex: 1; }
:global(:root.dark .service-catalog),
:global(:root.dark .catalog-views),
:global(:root.dark .catalog-search),
:global(:root.dark .service-detail) { border-color: var(--line); background: var(--surface); }
:global(:root.dark .catalog-views) { background: var(--surface-soft); }
:global(:root.dark .service-rail),
:global(:root.dark .group-heading),
:global(:root.dark .custom-service-add) { border-color: var(--line); background: var(--surface-soft); }
:global(:root.dark .service-item),
:global(:root.dark .catalog-search input),
:global(:root.dark .group-heading strong),
:global(:root.dark .subgroup-heading strong),
:global(:root.dark .detail-title-row h4),
:global(:root.dark .model-heading strong),
:global(:root.dark .custom-service-add) { color: var(--ink); }
:global(:root.dark .service-copy small),
:global(:root.dark .detail-hero p),
:global(:root.dark .model-heading small),
:global(:root.dark .custom-service-empty) { color: var(--muted); }
:global(:root.dark .subgroup-heading) { color: var(--muted); }
:global(:root.dark .group-toggle-copy) { color: var(--brand-strong); }
:global(:root.dark .detail-hero),
:global(:root.dark .model-section),
:global(:root.dark .service-configuration-slot) { border-color: var(--line); }
:global(:root.dark .service-item:hover) { border-color: var(--line); background: var(--surface); }
:global(:root.dark .group-heading-toggle:not(:disabled):hover) { background: var(--brand-soft); }
:global(:root.dark .service-item.active) { border-color: rgba(255, 138, 171, .48); background: var(--brand-soft); }
:global(:root.dark .credential-guide) { border-color: rgba(255, 138, 171, .3); background: var(--surface-soft); }
:global(:root.dark .credential-guide-head strong),
:global(:root.dark .credential-guide-steps) { color: var(--ink); }
:global(:root.dark .credential-guide-head small) { color: var(--muted); }
:global(:root.dark .credential-guide-link) { border-color: var(--line); color: var(--ink); background: var(--surface); }
:global(:root.dark .credential-guide-link:hover) { border-color: rgba(255, 138, 171, .48); background: var(--brand-soft); }
/* 暗色下品牌色是浅粉，实心按钮会失去对比；改用与“检查连接”一致的描边强调样式。 */
:global(:root.dark .credential-guide-link.is-primary) { border-color: rgba(255, 138, 171, .48); color: var(--brand-strong); background: var(--brand-soft); }
:global(:root.dark .credential-guide-link.is-primary:hover) { border-color: var(--brand-strong); color: var(--brand-strong); background: var(--brand-soft); box-shadow: none; }
:global(:root.dark .no-model-panel) { border-color: #31594d; background: #1c342d; }
:global(:root.dark .no-model-panel strong) { color: #a8e8d5; }
:global(:root.dark .no-model-panel p) { color: #8fc5b5; }
@media (max-width: 900px) {
  .catalog-layout { grid-template-columns: 240px minmax(0, 1fr); }
  .directory-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 700px) {
  .service-catalog { height: auto; min-height: 0; }
  .catalog-toolbar-inner { align-items: stretch; }
  .catalog-views { width: 100%; min-width: 0; }
  .catalog-actions { width: 100%; flex-basis: 100%; margin-left: 0; }
  .catalog-search { width: auto; flex: 1 1 auto; }
  .catalog-layout { display: block; flex: 0 0 auto; }
  .directory-grid { grid-template-columns: 1fr; }
  .service-groups { max-height: 220px; }

  .service-rail { border-right: 0; border-bottom: 1px solid #eceef3; }
  .service-groups { grid-template-columns: 1fr; }
  .service-detail { padding: 18px; }
  .model-section { grid-template-columns: 1fr; gap: 7px; }
  .service-detail { min-height: 520px; margin: 0; padding: 18px; border: 0; border-radius: 0; overflow: visible; }
  .detail-hero { flex-wrap: wrap; }
  .service-configuration-slot { max-height: none; overflow: visible; }
}
</style>
