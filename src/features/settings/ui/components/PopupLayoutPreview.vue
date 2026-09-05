<!--
@file src/features/settings/ui/components/PopupLayoutPreview.vue
文件职责：在界面设置中用真实 DOM 呈现当前 Popup 模块与快捷功能布局，帮助用户在保存前直接理解排序和显隐结果。
主要内容：按皮肤预览色或当前氛围语义色、顶层模块顺序、相邻站点栏目规则及快捷功能顺序绘制缩放后的 Popup，提供整块拖动、键盘排序与当前编辑层级反馈，并即时移除被隐藏的区域。
模块边界：本组件只消费外部投影后的布局数据，通过排序事件编辑布局，不读写配置或浏览器状态，也不执行 Popup 的业务行为。
-->
<template>
  <section
    class="popup-layout-live-preview"
    :data-preview-skin="skin.value"
    :data-preview-kind="skin.kind"
    :style="previewStyle"
    role="group"
    :aria-label="previewAriaLabel"
  >
    <div class="layout-preview-popup">
      <InterfaceBackdrop :motif="skin.motif" />
      <header class="layout-preview-header" aria-hidden="true">
        <span class="layout-preview-logo">A中</span>
        <strong>{{ translateLegacy('流畅阅读') }}</strong>
        <span class="layout-preview-header-actions"><i>♡</i><i>⚙</i></span>
      </header>

      <div class="layout-preview-flow">
        <template v-for="module in visibleModules" :key="module.id">
          <PopupLayoutPreviewItem
            as="section"
            :item="module"
            :editable="editScope === 'popupModule'"
            :controller="moduleDrag"
            v-if="module.id === 'translation'"
            class="layout-preview-module preview-translation"
            data-preview-popup-module="translation"
          >
            <div class="layout-preview-hero" aria-hidden="true">
              <span><small>{{ t('popup.webTranslation') }}</small><strong>{{ t('popup.heroEnabled') }}</strong></span>
              <i><b /></i>
            </div>
            <div class="layout-preview-languages" aria-hidden="true">
              <span><small>{{ t('popup.sourceLanguage') }}</small><b>{{ translateLegacy('自动检测') }}</b></span>
              <em>→</em>
              <span><small>{{ t('popup.targetLanguage') }}</small><b>{{ translateLegacy('简体中文') }}</b></span>
            </div>
            <div class="layout-preview-service" aria-hidden="true">
              <i>译</i>
              <span><small>{{ t('popup.translationService') }}</small><b>{{ translateLegacy('免费翻译服务') }}</b></span>
              <em>⌄</em>
            </div>
            <div class="layout-preview-action" aria-hidden="true">{{ t('popup.translateCurrentPage') }}</div>
            <PopupLayoutPreviewItem
              v-if="siteModuleNestedInTranslation && siteModule"
              :item="siteModule"
              :editable="editScope === 'popupModule'"
              :controller="moduleDrag"
              class="layout-preview-site nested"
              data-preview-popup-module="siteRule"
            >
              <span aria-hidden="true"><small>{{ siteModule?.label }}</small><b>fluentread.app</b></span>
              <i aria-hidden="true" /><i aria-hidden="true" />
            </PopupLayoutPreviewItem>
          </PopupLayoutPreviewItem>

          <PopupLayoutPreviewItem
            :item="module"
            :editable="editScope === 'popupModule'"
            :controller="moduleDrag"
            v-else-if="module.id === 'siteRule' && !siteModuleNestedInTranslation"
            class="layout-preview-module layout-preview-site"
            data-preview-popup-module="siteRule"
          >
            <span aria-hidden="true"><small>{{ module.label }}</small><b>fluentread.app</b></span>
            <i aria-hidden="true" /><i aria-hidden="true" />
          </PopupLayoutPreviewItem>

          <PopupLayoutPreviewItem
            as="section"
            :item="module"
            :editable="editScope === 'popupModule'"
            :controller="moduleDrag"
            v-else-if="module.id === 'quickFeatures'"
            class="layout-preview-module preview-quick-features"
            data-preview-popup-module="quickFeatures"
          >
            <div class="layout-preview-section-heading">
              <strong class="layout-preview-section-title" aria-hidden="true">{{ module.label }}</strong>
              <button
                v-if="editScope === 'popupModule'"
                type="button"
                data-preview-action
                @click="emit('edit:scope', 'quickFeature')"
              >{{ t('settings.interface.popupLayout.editFeatures') }} →</button>
            </div>
            <div class="layout-preview-feature-grid">
              <PopupLayoutPreviewItem
                :item="feature"
                :editable="editScope === 'quickFeature'"
                :controller="featureDrag"
                axis="x"
                v-for="feature in visibleQuickFeatures"
                :key="feature.id"
                :data-preview-quick-feature="feature.id"
              >
                <i aria-hidden="true">{{ featureGlyph(feature.id) }}</i>
                <b aria-hidden="true">{{ feature.label }}</b>
              </PopupLayoutPreviewItem>
            </div>
          </PopupLayoutPreviewItem>

          <PopupLayoutPreviewItem
            as="footer"
            :item="module"
            :editable="editScope === 'popupModule'"
            :controller="moduleDrag"
            v-else-if="module.id === 'footer'"
            class="layout-preview-module layout-preview-footer"
            data-preview-popup-module="footer"
          >
            <span aria-hidden="true">0</span>
            <b aria-hidden="true">{{ t('popup.openSourceProject') }}</b>
            <strong aria-hidden="true">{{ t('popup.clearCache') }}</strong>
          </PopupLayoutPreviewItem>
        </template>
      </div>
    </div>
    <p class="layout-preview-announcement" aria-live="polite">{{ announcement }}</p>
  </section>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue'
import PopupLayoutPreviewItem from './PopupLayoutPreviewItem.vue'
import {usePopupLayoutReorder} from '../usePopupLayoutReorder'
import InterfaceBackdrop from '@/src/ui/components/InterfaceBackdrop.vue'
import type {InterfaceSkinOption} from '@/src/core/config/interfaceAppearance'
import {useUiI18n} from '@/src/ui/i18n'

interface PreviewLayoutItem {
  id: string
  label: string
  visible: boolean
}

const props = defineProps<{
  skin: InterfaceSkinOption
  skinLabel: string
  moduleItems: readonly PreviewLayoutItem[]
  moduleOrder: readonly string[]
  quickFeatureItems: readonly PreviewLayoutItem[]
  quickFeatureOrder: readonly string[]
  editScope: 'popupModule' | 'quickFeature'
}>()
const {t, translateLegacy} = useUiI18n()
const emit = defineEmits<{
  'update:moduleOrder': [order: string[]]
  'update:quickFeatureOrder': [order: string[]]
  'edit:scope': [scope: 'popupModule' | 'quickFeature']
}>()
const announcement = ref('')

function orderItems(items: readonly PreviewLayoutItem[], order: readonly string[]): PreviewLayoutItem[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const ordered = order.map((id) => byId.get(id)).filter((item): item is PreviewLayoutItem => Boolean(item))
  const orderedIds = new Set(ordered.map((item) => item.id))
  return [...ordered, ...items.filter((item) => !orderedIds.has(item.id))]
}

const visibleQuickFeatures = computed(() => orderItems(props.quickFeatureItems, props.quickFeatureOrder)
  .filter((item) => item.visible))
const visibleModules = computed(() => orderItems(props.moduleItems, props.moduleOrder)
  .filter((item) => item.visible && (item.id !== 'quickFeatures' || visibleQuickFeatures.value.length > 0)))
const siteModule = computed(() => props.moduleItems.find((item) => item.id === 'siteRule'))
const siteModuleNestedInTranslation = computed(() => {
  const translationIndex = visibleModules.value.findIndex((item) => item.id === 'translation')
  return translationIndex >= 0 && visibleModules.value[translationIndex + 1]?.id === 'siteRule'
})
function announceMove(order: string[], id: string, items: readonly PreviewLayoutItem[]) {
  const item = items.find((entry) => entry.id === id)
  const visibleOrder = order.filter((entry) => items.some((candidate) => candidate.id === entry && candidate.visible))
  announcement.value = t('settings.interface.popupLayout.moved', {label: item?.label ?? id, position: visibleOrder.indexOf(id) + 1})
}
const moduleDrag = usePopupLayoutReorder({
  order: () => props.moduleOrder,
  visibleIds: () => visibleModules.value.map((item) => item.id),
  onUpdate: (order, id) => { emit('update:moduleOrder', order); announceMove(order, id, visibleModules.value) },
})
const featureDrag = usePopupLayoutReorder({
  order: () => props.quickFeatureOrder,
  visibleIds: () => visibleQuickFeatures.value.map((item) => item.id),
  onUpdate: (order, id) => { emit('update:quickFeatureOrder', order); announceMove(order, id, visibleQuickFeatures.value) },
})
watch(() => props.editScope, () => { moduleDrag.finish(); featureDrag.finish() })
const previewStyle = computed(() => {
  const preview = props.skin.preview
  if (props.skin.kind === 'palette') {
    return {
      '--layout-preview-canvas': `var(--skin-page, ${preview.canvas})`,
      '--layout-preview-surface': `var(--surface, ${preview.surface})`,
      '--layout-preview-accent': `var(--brand, ${preview.accent})`,
      '--layout-preview-ink': `var(--ink, ${preview.ink})`,
    }
  }
  return {
    '--layout-preview-canvas': preview.canvas,
    '--layout-preview-surface': preview.surface,
    '--layout-preview-accent': preview.accent,
    '--layout-preview-ink': preview.ink,
  }
})
const previewAriaLabel = computed(() => `${t('settings.interface.popupLayout.previewTitle')}: ${props.skinLabel}`)

function featureGlyph(id: string): string {
  if (props.skin.value === 'emoji') return ({hover: '🖱️', selection: '✍️', appearance: '🎨', image: '🖼️', video: '🎬', document: '📖'} as Record<string, string>)[id] || '✨'
  return ({
    hover: '↖',
    selection: 'I',
    appearance: 'Aa',
    image: '▧',
    video: 'CC',
    document: '文',
  } as Record<string, string>)[id] ?? '·'
}
</script>

<style scoped>
.popup-layout-live-preview {
  width: min(100%, 360px);
  margin: 0 auto;
  color: var(--layout-preview-ink);
}

.layout-preview-popup {
  position: relative;
  isolation: isolate;
  display: grid;
  gap: 8px;
  padding: 16px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--layout-preview-ink) 14%, transparent);
  border-radius: 18px;
  background:
    radial-gradient(circle at 94% 0, color-mix(in srgb, var(--layout-preview-accent) 14%, transparent), transparent 28%),
    var(--layout-preview-canvas);
  box-shadow: 0 14px 32px color-mix(in srgb, var(--layout-preview-ink) 9%, transparent);
  transition: background 160ms ease, border-radius 160ms ease, box-shadow 160ms ease;
}

.layout-preview-header {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.layout-preview-logo {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 10px;
  color: var(--layout-preview-surface);
  background: var(--layout-preview-accent);
  font-size: 10px;
  font-weight: 850;
}

.layout-preview-header > strong {
  overflow: hidden;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layout-preview-header-actions {
  display: flex;
  gap: 4px;
}

.layout-preview-header-actions i {
  display: grid;
  width: 21px;
  height: 21px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--layout-preview-ink) 12%, transparent);
  border-radius: 7px;
  color: color-mix(in srgb, var(--layout-preview-ink) 66%, transparent);
  background: var(--layout-preview-surface);
  font-size: 8px;
  font-style: normal;
}

.layout-preview-flow {
  display: grid;
  gap: 10px;
}

.layout-preview-module {
  min-width: 0;
}

.preview-translation {
  display: grid;
  gap: 6px;
  padding: 9px;
  border: 1px solid color-mix(in srgb, var(--layout-preview-ink) 11%, transparent);
  border-radius: 13px;
  background: var(--layout-preview-surface);
}

.layout-preview-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.layout-preview-hero > span,
.layout-preview-languages span,
.layout-preview-service > span,
.layout-preview-site > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.layout-preview-hero small,
.layout-preview-languages small,
.layout-preview-service small,
.layout-preview-site small {
  color: color-mix(in srgb, var(--layout-preview-ink) 57%, transparent);
  font-size: 8px;
  line-height: 1.2;
}

.layout-preview-hero strong {
  overflow: hidden;
  font-size: 10px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layout-preview-hero > i {
  display: flex;
  width: 25px;
  height: 14px;
  flex: none;
  align-items: center;
  justify-content: flex-end;
  padding: 2px;
  border-radius: 999px;
  background: var(--layout-preview-accent);
}

.layout-preview-hero > i b {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--layout-preview-surface);
}

.layout-preview-languages {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 12px minmax(0, 1fr);
  align-items: end;
  gap: 4px;
}

.layout-preview-languages span {
  padding: 5px 6px;
  border-radius: 7px;
  background: var(--layout-preview-canvas);
}

.layout-preview-languages b,
.layout-preview-service b,
.layout-preview-site b {
  overflow: hidden;
  font-size: 10px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layout-preview-languages em,
.layout-preview-service em {
  color: color-mix(in srgb, var(--layout-preview-ink) 58%, transparent);
  font-size: 10px;
  font-style: normal;
  text-align: center;
}

.layout-preview-service {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) 10px;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border-radius: 8px;
  background: var(--layout-preview-canvas);
}

.layout-preview-service > i {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 7px;
  color: var(--layout-preview-accent);
  background: color-mix(in srgb, var(--layout-preview-accent) 12%, var(--layout-preview-surface));
  font-size: 10px;
  font-style: normal;
  font-weight: 850;
}

.layout-preview-action {
  display: grid;
  min-height: 34px;
  place-items: center;
  border-radius: 8px;
  color: var(--layout-preview-surface);
  background: var(--layout-preview-accent);
  font-size: 10px;
  font-weight: 800;
}

.layout-preview-site {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px 24px;
  align-items: center;
  gap: 5px;
  padding: 7px 8px;
  border: 1px solid color-mix(in srgb, var(--layout-preview-ink) 10%, transparent);
  border-radius: 10px;
  background: var(--layout-preview-surface);
}

.layout-preview-site.nested {
  margin-top: 1px;
  border-color: transparent;
  background: var(--layout-preview-canvas);
}

.layout-preview-site > i {
  position: relative;
  display: block;
  width: 24px;
  height: 13px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--layout-preview-ink) 11%, var(--layout-preview-canvas));
}

.layout-preview-site > i:first-of-type {
  background: color-mix(in srgb, var(--layout-preview-accent) 20%, var(--layout-preview-canvas));
}

.layout-preview-site > i::after {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--layout-preview-surface);
  content: '';
}

.layout-preview-site > i:first-of-type::after {
  right: 2px;
  left: auto;
}

.preview-quick-features {
  display: grid;
  gap: 5px;
}

.layout-preview-section-title {
  color: color-mix(in srgb, var(--layout-preview-ink) 62%, transparent);
  font-size: 10px;
}

.layout-preview-feature-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
}

.layout-preview-feature-grid > .layout-preview-editable-item {
  display: flex;
  min-width: 0;
  min-height: 34px;
  align-items: center;
  gap: 5px;
  padding: 4px 6px;
  border: 1px solid color-mix(in srgb, var(--layout-preview-ink) 11%, transparent);
  border-radius: 8px;
  background: var(--layout-preview-surface);
}

.layout-preview-feature-grid i {
  display: grid;
  width: 18px;
  height: 18px;
  flex: none;
  place-items: center;
  border-radius: 6px;
  color: var(--layout-preview-accent);
  background: color-mix(in srgb, var(--layout-preview-accent) 9%, var(--layout-preview-surface));
  font-size: 8px;
  font-style: normal;
  font-weight: 850;
}

.layout-preview-feature-grid b {
  min-width: 0;
  overflow: hidden;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layout-preview-footer {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 6px;
  color: color-mix(in srgb, var(--layout-preview-ink) 58%, transparent);
  font-size: 8px;
}

.layout-preview-footer b {
  color: color-mix(in srgb, var(--layout-preview-ink) 68%, transparent);
  font-weight: 700;
}

.layout-preview-footer strong {
  color: var(--layout-preview-accent);
  text-align: right;
}

.popup-layout-live-preview[data-preview-kind="minimal"] .layout-preview-popup {
  border-color: transparent;
  background: var(--layout-preview-surface);
  box-shadow: none;
}

.popup-layout-live-preview[data-preview-kind="minimal"] :is(.preview-translation, .layout-preview-feature-grid > .layout-preview-editable-item, .layout-preview-site) {
  border-color: color-mix(in srgb, var(--layout-preview-ink) 8%, transparent);
}

.popup-layout-live-preview[data-preview-kind="minimal"] .layout-preview-action {
  border: 1px solid color-mix(in srgb, var(--layout-preview-accent) 18%, transparent);
  color: var(--layout-preview-ink);
  background: color-mix(in srgb, var(--layout-preview-accent) 6%, var(--layout-preview-canvas));
}

.popup-layout-live-preview[data-preview-kind="minimal"] .layout-preview-logo {
  background: color-mix(in srgb, var(--layout-preview-accent) 78%, var(--layout-preview-surface));
}

.popup-layout-live-preview[data-preview-kind="compact"] .layout-preview-popup,
.popup-layout-live-preview[data-preview-kind="compact"] .layout-preview-flow {
  gap: 4px;
}

.popup-layout-live-preview[data-preview-kind="compact"] .layout-preview-popup {
  padding: 8px;
  border-radius: 11px;
  box-shadow: none;
}

.popup-layout-live-preview[data-preview-kind="compact"] .preview-translation {
  gap: 4px;
  padding: 6px;
  border-radius: 8px;
}

.popup-layout-live-preview[data-preview-kind="contrast"] :is(.layout-preview-popup, .preview-translation, .layout-preview-site, .layout-preview-feature-grid > .layout-preview-editable-item) {
  border: 2px solid var(--layout-preview-ink);
  border-radius: 4px;
  box-shadow: none;
}

.popup-layout-live-preview[data-preview-kind="contrast"] .layout-preview-action {
  border: 2px solid var(--layout-preview-ink);
  border-radius: 4px;
  color: var(--layout-preview-surface);
  background: var(--layout-preview-ink);
}

.popup-layout-live-preview[data-preview-kind="palette"] .layout-preview-popup {
  border-color: var(--line);
  border-radius: 14px;
  background: var(--skin-canvas-background, var(--layout-preview-canvas));
  box-shadow: var(--skin-panel-shadow, none);
}

.popup-layout-live-preview[data-preview-kind="palette"] .preview-translation {
  border-color: var(--line);
  border-radius: 14px;
}

.popup-layout-live-preview[data-preview-kind="palette"] :is(.layout-preview-header-actions i, .layout-preview-feature-grid > .layout-preview-editable-item, .layout-preview-site) {
  border-color: var(--line);
  border-radius: 10px;
}

.popup-layout-live-preview[data-preview-kind="palette"] :is(.layout-preview-languages span, .layout-preview-service, .layout-preview-site.nested) {
  border-radius: 10px;
  background: var(--surface-soft);
}

.popup-layout-live-preview[data-preview-kind="palette"] :is(.layout-preview-header-actions i, .layout-preview-hero small, .layout-preview-languages small, .layout-preview-service small, .layout-preview-site small, .layout-preview-languages em, .layout-preview-service em, .layout-preview-section-title, .layout-preview-footer, .layout-preview-footer b) {
  color: var(--muted);
}

.popup-layout-live-preview[data-preview-kind="palette"] .layout-preview-logo,
.popup-layout-live-preview[data-preview-kind="palette"] .layout-preview-action {
  color: var(--skin-action-text);
  background: var(--layout-preview-accent);
}

.popup-layout-live-preview[data-preview-kind="palette"] .layout-preview-action {
  border-radius: 10px;
}

.popup-layout-live-preview[data-preview-kind="palette"] .layout-preview-hero > i b,
.popup-layout-live-preview[data-preview-kind="palette"] .layout-preview-site > i::after {
  background: #fff;
}

.popup-layout-live-preview[data-preview-kind="palette"] :is(.layout-preview-service > i, .layout-preview-feature-grid i) {
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.popup-layout-live-preview[data-preview-kind="palette"] .layout-preview-feature-grid i {
  background: var(--surface-soft);
}

.popup-layout-live-preview[data-preview-kind="palette"] .layout-preview-footer strong {
  color: var(--brand-strong);
}

@media (max-width: 480px) {
  .popup-layout-live-preview {
    width: 100%;
  }
}

.popup-layout-live-preview[data-preview-kind="palette"] .preview-translation {
  border-radius: var(--skin-panel-radius, 14px);
  background: var(--skin-panel-background, var(--surface));
  box-shadow: var(--skin-panel-shadow, none);
}
.popup-layout-live-preview[data-preview-kind="palette"] .layout-preview-feature-grid > .layout-preview-editable-item {
  border-radius: var(--skin-feature-radius, 10px);
  box-shadow: var(--skin-feature-shadow, none);
}
.popup-layout-live-preview[data-preview-kind="palette"] :is(.layout-preview-languages span, .layout-preview-service, .layout-preview-action) {
  border-radius: var(--skin-control-radius, 10px);
}
.layout-preview-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.preview-quick-features.editable .layout-preview-section-heading { padding-left: 8px; }
.layout-preview-footer.editable > span { padding-left: 8px; }
.layout-preview-section-heading button { border: 0; padding: 3px; color: var(--layout-preview-accent); background: transparent; font: inherit; font-size: 9px; cursor: pointer; }
.layout-preview-section-heading button:focus-visible { outline: 2px solid var(--layout-preview-accent); }
.layout-preview-announcement { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
