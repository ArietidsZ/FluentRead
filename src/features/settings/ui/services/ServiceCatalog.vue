<!--
 * @file src/features/settings/ui/services/ServiceCatalog.vue
 * 文件职责：实现翻译服务目录与筛选选择界面，把机器翻译、模型服务商、聚合平台和动态自定义服务按分层目录呈现为可切换的卡片列表。
 * 主要内容：组件接收当前服务、网站入口和配置，支持目录分组与折叠、关键词搜索、动态 OpenAI 兼容服务、分组计数、官网新标签页跳转和紧凑模型选择。
 * 模块边界：目录只决定“选择哪个服务”，不编辑凭据、不测试连接也不保存配置；详细表单归 ServiceConfiguration.vue，服务定义来自 core/config，外层 SettingsSections 处理持久化。
 -->
<template>
  <section
    class="service-catalog"
    aria-label="翻译服务配置"
    :data-default-service="defaultService"
    :data-editing-service="service"
  >
    <div class="catalog-layout">
      <aside class="service-rail" aria-label="翻译服务列表">
        <label class="catalog-search">
          <span aria-hidden="true">⌕</span>
          <input v-model.trim="serviceQuery" type="search" aria-label="搜索翻译服务" placeholder="搜索翻译服务" />
        </label>

        <div v-if="hasVisibleServices" class="service-groups">
          <section v-if="showCustomServiceGroup" class="service-group custom-service-group">
            <div class="group-heading custom-group-heading">
              <span>
                <strong>我的服务</strong>
                <small data-testid="custom-service-count">{{ customServices.length }} / {{ maximumCustomServices }}</small>
              </span>
              <button
                type="button"
                class="custom-service-add"
                data-testid="custom-service-add"
                :disabled="customServiceLimitReached"
                :aria-label="customServiceLimitReached ? `自定义服务已达到 ${maximumCustomServices} 个上限` : '添加 OpenAI 兼容服务'"
                @click="$emit('add:service')"
              >
                + 添加
              </button>
            </div>
            <p v-if="!filteredCustomServices.length" class="custom-service-empty">
              {{ serviceQuery ? '没有匹配的自定义服务' : '还没有自定义服务' }}
            </p>
            <button
              v-for="item in filteredCustomServices"
              :key="item.value"
              type="button"
              class="service-item"
              :data-service-value="item.value"
              :data-custom-service-id="item.value"
              :class="{ active: service === item.value }"
              :aria-pressed="service === item.value"
              @click="$emit('update:service', item.value)"
            >
              <ServiceIcon service="custom" :label="item.label" />
              <span class="service-copy">
                <strong>{{ item.label }}</strong>
                <small :title="item.description">{{ item.description || 'OpenAI 兼容服务' }}</small>
              </span>
              <span v-if="defaultService === item.value" class="current-dot" title="默认翻译服务"></span>
            </button>
          </section>

          <section
            v-for="section in filteredSections"
            :key="section.id"
            class="service-group"
            :data-service-section="section.id"
          >
            <button
              v-if="section.collapsible"
              type="button"
              class="group-heading group-heading-toggle"
              :data-service-section-toggle="section.id"
              :aria-expanded="!isSectionCollapsed(section)"
              :aria-controls="`service-section-${section.id}`"
              :disabled="Boolean(serviceQuery)"
              @click="toggleSection(section.id)"
            >
              <span class="group-heading-copy">
                <strong>{{ section.label }}</strong>
                <small>{{ sectionItemCount(section) }} 项</small>
              </span>
              <span class="group-toggle-copy">
                {{ serviceQuery ? '搜索中' : isSectionCollapsed(section) ? '展开' : '收起' }}
                <i aria-hidden="true">⌄</i>
              </span>
            </button>
            <div v-else class="group-heading">
              <strong>{{ section.label }}</strong>
              <span>{{ sectionItemCount(section) }} 项</span>
            </div>

            <div
              v-show="!isSectionCollapsed(section)"
              :id="`service-section-${section.id}`"
              class="service-section-body"
            >
              <section
                v-for="group in section.groups"
                :key="group.id"
                class="service-subgroup"
                :data-service-subgroup="group.id"
              >
                <div v-if="group.label" class="subgroup-heading">
                  <strong>{{ group.label }}</strong>
                  <span>{{ group.items.length }} 项</span>
                </div>
                <button
                  v-for="item in group.items"
                  :key="item.value"
                  type="button"
                  class="service-item"
                  :data-service-value="item.value"
                  :class="{ active: service === item.value }"
                  :aria-pressed="service === item.value"
                  @click="$emit('update:service', item.value)"
                >
                  <ServiceIcon :service="item.value" :label="item.label" />
                  <span class="service-copy">
                    <strong>{{ item.label }}</strong>
                    <small>{{ group.itemKind }}</small>
                  </span>
                  <span
                    v-if="defaultService === item.value"
                    class="current-dot"
                    title="默认翻译服务"
                  ></span>
                </button>
              </section>
            </div>
          </section>
        </div>
        <p v-else class="catalog-empty">没有匹配的翻译服务</p>
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
            <p v-if="selectedService?.description">{{ selectedService.description }}</p>
          </div>
        </div>

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
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue'
import { useUiI18n } from '@/src/ui/i18n'
import { isCustomOpenAIProviderId } from '@/src/core/config/customOpenAI'
import {
  buildServiceSections,
  filterServiceSections,
  type ServiceOption,
  type ServiceSection,
  type ServiceWebsite,
} from '@/src/ui/view-model/serviceCatalog'
import ModelPicker from './ModelPicker.vue'

interface ModelPickerOption {
  value: string
  label?: string
  removable?: boolean
}

const props = defineProps<{
  service: string
  defaultService: string
  website?: ServiceWebsite
  selectedModel?: string
  services: ServiceOption[]
  modelOptions: ModelPickerOption[]
  showModel: boolean
  maximumCustomServices: number
  maximumModels: number
  maximumModelLength: number
  customModelCount: number
}>()

defineEmits<{
  'update:service': [value: string]
  'update:model': [value: string]
  'add:service': []
  'add:model': [value: string]
  'remove:model': [value: string]
}>()

const { t } = useUiI18n()
const serviceQuery = ref('')
const customServices = computed(() => props.services.filter((item) => isCustomOpenAIProviderId(item.value)))
const builtInServices = computed(() => props.services.filter((item) => !isCustomOpenAIProviderId(item.value)))
const sections = computed(() => buildServiceSections(builtInServices.value))
const filteredSections = computed(() => filterServiceSections(sections.value, serviceQuery.value))
const collapsedSectionIds = ref(new Set(['machine']))
const manuallyCollapsedSectionIds = ref(new Set<string>())
const filteredCustomServices = computed(() => {
  const keyword = serviceQuery.value.trim().toLocaleLowerCase()
  if (!keyword) return customServices.value
  return customServices.value.filter((item) => (
    `${item.label}${item.value}${item.description || ''}${item.searchTerms?.join('') || ''}`
      .toLocaleLowerCase()
      .includes(keyword)
  ))
})
const showCustomServiceGroup = computed(() => !serviceQuery.value || filteredCustomServices.value.length > 0)
const hasVisibleServices = computed(() => showCustomServiceGroup.value || filteredSections.value.length > 0)
const customServiceLimitReached = computed(() => customServices.value.length >= props.maximumCustomServices)
const selectedService = computed(() => [
  ...customServices.value,
  ...sections.value.flatMap((section) => section.groups).flatMap((group) => group.items),
].find((item) => item.value === props.service))

function sectionItemCount(section: ServiceSection) {
  return section.groups.reduce((count, group) => count + group.items.length, 0)
}

function sectionContainsService(section: ServiceSection, service: string) {
  return section.groups.some((group) => group.items.some((item) => item.value === service))
}

function isSectionCollapsed(section: ServiceSection) {
  return section.collapsible
    && !serviceQuery.value
    && collapsedSectionIds.value.has(section.id)
}

function toggleSection(sectionId: string) {
  const next = new Set(collapsedSectionIds.value)
  const nextManual = new Set(manuallyCollapsedSectionIds.value)
  if (next.has(sectionId)) {
    next.delete(sectionId)
    nextManual.delete(sectionId)
  } else {
    next.add(sectionId)
    nextManual.add(sectionId)
  }
  collapsedSectionIds.value = next
  manuallyCollapsedSectionIds.value = nextManual
}

watch(
  [sections, () => props.service, () => props.defaultService],
  ([currentSections, editingService, defaultService]) => {
    const next = new Set(collapsedSectionIds.value)
    const nextManual = new Set(manuallyCollapsedSectionIds.value)
    currentSections.filter((section) => section.collapsible).forEach((section) => {
      if (sectionContainsService(section, editingService)) {
        next.delete(section.id)
        nextManual.delete(section.id)
      } else if (
        sectionContainsService(section, defaultService)
        && !nextManual.has(section.id)
      ) {
        next.delete(section.id)
      }
    })
    collapsedSectionIds.value = next
    manuallyCollapsedSectionIds.value = nextManual
  },
  { immediate: true },
)

watch(() => props.service, () => {
  serviceQuery.value = ''
})

</script>

<style scoped>
.service-catalog { display: flex; height: clamp(520px, calc(100vh - 270px), 760px); min-height: 520px; margin: 2px 0 20px; border: 1px solid #e4e7ef; border-radius: 20px; overflow: hidden; background: #fff; flex-direction: column; }
.catalog-layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 0; flex: 1; overflow: hidden; }
.service-rail { min-height: 0; padding: 16px 12px 18px; border-right: 1px solid #eceef3; background: #fafbfc; overflow-y: auto; }
.catalog-search { display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 11px; border: 1px solid #dfe3eb; border-radius: 11px; background: #fff; }
.catalog-search span { color: #8991a2; font-size: 16px; }
.catalog-search input { width: 100%; min-width: 0; border: 0; outline: 0; color: #172033; background: transparent; font-size: 13px; }
.service-groups { display: grid; gap: 14px; margin-top: 17px; }
.group-heading { display: flex; align-items: center; justify-content: space-between; width: 100%; margin: 0 0 5px; padding: 8px 9px; border: 0; border-bottom: 1px solid #e5e8ef; color: #667187; background: #f3f5f9; text-align: left; }
.group-heading strong { color: #46526a; font-size: 12px; letter-spacing: .05em; }
.group-heading span { font-size: 10px; }
.custom-group-heading { align-items: center; }
.custom-group-heading > span { display: flex; align-items: center; gap: 7px; }
.custom-group-heading > span small { color: #9097a7; font-size: 10px; }
.custom-service-add { padding: 5px 7px; border: 1px solid #ef9ab1; border-radius: 8px; color: #c72a56; background: #fff7f9; font-size: 10px; font-weight: 750; cursor: pointer; }
.custom-service-add:disabled { border-color: #dfe3eb; color: #9aa2b1; background: #f5f6f8; cursor: not-allowed; }
.custom-service-empty { margin: 10px 8px; color: #9299a8; font-size: 10px; text-align: center; }
.service-group { min-width: 0; }
.group-heading-toggle { cursor: pointer; }
.group-heading-toggle:not(:disabled):hover { background: #eef1f6; }
.group-heading-toggle:disabled { cursor: default; }
.group-heading-copy { display: flex; align-items: baseline; gap: 7px; }
.group-heading-copy small { color: #8a93a5; font-size: 10px; }
.group-toggle-copy { display: flex; align-items: center; gap: 3px; color: #c72a56; font-weight: 750; }
.group-toggle-copy i { display: inline-block; font-style: normal; transition: transform 150ms ease; }
.group-heading-toggle[aria-expanded="true"] .group-toggle-copy i { transform: rotate(180deg); }
.service-section-body { display: grid; gap: 14px; }
.service-subgroup { min-width: 0; }
.subgroup-heading { display: flex; align-items: center; justify-content: space-between; margin: 2px 9px 4px; color: #8a93a5; }
.subgroup-heading strong { color: #657086; font-size: 10px; font-weight: 800; letter-spacing: .04em; }
.subgroup-heading span { font-size: 9px; }
.service-item { display: grid; grid-template-columns: 40px minmax(0, 1fr) 8px; align-items: center; gap: 10px; width: 100%; padding: 10px; border: 1px solid transparent; border-radius: 12px; color: #172033; background: transparent; text-align: left; cursor: pointer; transition: 150ms ease; }
.service-item:hover { border-color: #e2e5ec; background: #fff; transform: translateX(2px); }
.service-item.active { border-color: #f3c4d1; background: #fff0f4; box-shadow: 0 7px 18px rgba(214, 50, 96, .08); }
.service-copy { display: flex; min-width: 0; flex-direction: column; }
.service-copy strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.service-copy small {
  display: block;
  min-width: 0;
  margin-top: 3px;
  overflow: hidden;
  color: #9097a7;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.current-dot { width: 7px; height: 7px; border-radius: 50%; background: #ef4776; box-shadow: 0 0 0 4px rgba(239, 71, 118, .12); }
.service-detail { display: flex; min-width: 0; min-height: 0; margin: 14px; padding: 22px; border: 1px solid #e4e7ef; border-radius: 16px; background: #fff; flex-direction: column; overflow: hidden; }
.service-detail > .detail-hero,
.service-detail > .model-section,
.service-detail > .no-model-panel,
.service-detail > .service-configuration-slot { width: min(100%, 1080px); }
.detail-hero { display: flex; align-items: flex-start; gap: 13px; padding-bottom: 20px; border-bottom: 1px solid #eceef3; }
.detail-heading { flex: 1; min-width: 0; }
.detail-title-row { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; }
.detail-title-row h4 { margin: 1px 0 5px; color: #172033; font-size: 22px; overflow-wrap: anywhere; }
.service-website-link { display: inline-flex; align-items: center; gap: 5px; min-height: 28px; padding: 2px 4px; border-radius: 5px; color: var(--brand-strong, #bd2853); font-size: 12px; font-weight: 600; line-height: 1.5; text-decoration: none; }
.service-website-link svg { flex-shrink: 0; }
.service-website-link:hover { background: var(--brand-soft, #fff0f4); text-decoration: underline; text-underline-offset: 3px; }
.service-website-link:focus-visible { outline: 2px solid var(--brand-strong, #bd2853); outline-offset: 2px; }
.active-badge { padding: 4px 8px; border-radius: 999px; color: #bd2853; background: #ffe9ef; font-size: 10px; font-weight: 800; }
.detail-hero p { margin: 0; color: #737c8f; font-size: 13px; line-height: 1.6; }
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
.catalog-empty { margin: 20px 8px; color: #9299a8; font-size: 10px; text-align: center; }
:global(:root.dark .service-catalog),
:global(:root.dark .catalog-search),
:global(:root.dark .service-detail) { border-color: var(--line); background: var(--surface); }
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
:global(:root.dark .no-model-panel) { border-color: #31594d; background: #1c342d; }
:global(:root.dark .no-model-panel strong) { color: #a8e8d5; }
:global(:root.dark .no-model-panel p) { color: #8fc5b5; }
@media (max-width: 900px) {
  .catalog-layout { grid-template-columns: 220px minmax(0, 1fr); }
}
@media (max-width: 700px) {
  .service-catalog { height: auto; min-height: 0; }
  .catalog-layout { display: block; flex: 0 0 auto; }
  .service-rail { border-right: 0; border-bottom: 1px solid #eceef3; }
  .service-groups { grid-template-columns: 1fr; }
  .service-detail { padding: 18px; }
  .model-section { grid-template-columns: 1fr; gap: 7px; }
  .service-detail { min-height: 520px; margin: 0; padding: 18px; border: 0; border-radius: 0; overflow: visible; }
  .detail-hero { flex-wrap: wrap; }
  .service-configuration-slot { max-height: none; overflow: visible; }
}
</style>
