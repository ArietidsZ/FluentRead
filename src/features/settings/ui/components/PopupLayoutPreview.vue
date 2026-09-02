<!--
@file src/features/settings/ui/components/PopupLayoutPreview.vue
文件职责：在界面设置中用真实 DOM 呈现当前 Popup 模块与快捷功能布局，帮助用户在保存前直接理解排序和显隐结果。
主要内容：按皮肤预览色、顶层模块顺序、相邻站点栏目规则及快捷功能顺序绘制缩放后的 Popup，并即时移除被隐藏的区域。
模块边界：本组件只消费外部投影后的布局数据，不提供编辑交互、不读写配置或浏览器状态，也不复刻 Popup 的业务行为。
-->
<template>
  <section
    class="popup-layout-live-preview"
    :data-preview-skin="skin.value"
    :data-preview-kind="skin.kind"
    :style="previewStyle"
    role="img"
    :aria-label="previewAriaLabel"
  >
    <div class="layout-preview-popup" aria-hidden="true">
      <header class="layout-preview-header">
        <span class="layout-preview-logo">A中</span>
        <strong>{{ translateLegacy('流畅阅读') }}</strong>
        <span class="layout-preview-header-actions"><i>♡</i><i>⚙</i></span>
      </header>

      <div class="layout-preview-flow">
        <template v-for="module in visibleModules" :key="module.id">
          <section
            v-if="module.id === 'translation'"
            class="layout-preview-module preview-translation"
            data-preview-popup-module="translation"
          >
            <div class="layout-preview-hero">
              <span><small>{{ t('popup.webTranslation') }}</small><strong>{{ t('popup.heroEnabled') }}</strong></span>
              <i><b /></i>
            </div>
            <div class="layout-preview-languages">
              <span><small>{{ t('popup.sourceLanguage') }}</small><b>{{ translateLegacy('自动检测') }}</b></span>
              <em>→</em>
              <span><small>{{ t('popup.targetLanguage') }}</small><b>{{ translateLegacy('简体中文') }}</b></span>
            </div>
            <div class="layout-preview-service">
              <i>译</i>
              <span><small>{{ t('popup.translationService') }}</small><b>{{ translateLegacy('免费翻译服务') }}</b></span>
              <em>⌄</em>
            </div>
            <div class="layout-preview-action">{{ t('popup.translateCurrentPage') }}</div>
            <div
              v-if="siteModuleNestedInTranslation"
              class="layout-preview-site nested"
              data-preview-popup-module="siteRule"
            >
              <span><small>{{ siteModule?.label }}</small><b>fluentread.app</b></span>
              <i /><i />
            </div>
          </section>

          <div
            v-else-if="module.id === 'siteRule' && !siteModuleNestedInTranslation"
            class="layout-preview-module layout-preview-site"
            data-preview-popup-module="siteRule"
          >
            <span><small>{{ module.label }}</small><b>fluentread.app</b></span>
            <i /><i />
          </div>

          <section
            v-else-if="module.id === 'quickFeatures'"
            class="layout-preview-module preview-quick-features"
            data-preview-popup-module="quickFeatures"
          >
            <strong class="layout-preview-section-title">{{ module.label }}</strong>
            <div class="layout-preview-feature-grid">
              <span
                v-for="feature in visibleQuickFeatures"
                :key="feature.id"
                :data-preview-quick-feature="feature.id"
              >
                <i>{{ featureGlyph(feature.id) }}</i>
                <b>{{ feature.label }}</b>
              </span>
            </div>
          </section>

          <footer
            v-else-if="module.id === 'footer'"
            class="layout-preview-module layout-preview-footer"
            data-preview-popup-module="footer"
          >
            <span>0</span>
            <b>{{ t('popup.openSourceProject') }}</b>
            <strong>{{ t('popup.clearCache') }}</strong>
          </footer>
        </template>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import {computed} from 'vue'
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
}>()
const {t, translateLegacy} = useUiI18n()

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
const previewStyle = computed(() => ({
  '--layout-preview-canvas': props.skin.preview.canvas,
  '--layout-preview-surface': props.skin.preview.surface,
  '--layout-preview-accent': props.skin.preview.accent,
  '--layout-preview-ink': props.skin.preview.ink,
}))
const previewAriaLabel = computed(() => `${t('settings.interface.popupLayout.previewTitle')}: ${props.skinLabel}`)

function featureGlyph(id: string): string {
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
  width: min(100%, 318px);
  margin: 0 auto;
  color: var(--layout-preview-ink);
}

.layout-preview-popup {
  display: grid;
  gap: 8px;
  padding: 12px;
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
  gap: 7px;
}

.layout-preview-logo {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 10px;
  color: var(--layout-preview-surface);
  background: var(--layout-preview-accent);
  font-size: 7px;
  font-weight: 850;
}

.layout-preview-header > strong {
  overflow: hidden;
  font-size: 9px;
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
  gap: 7px;
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
  font-size: 5.8px;
  line-height: 1.2;
}

.layout-preview-hero strong {
  overflow: hidden;
  font-size: 9px;
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
  font-size: 7px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layout-preview-languages em,
.layout-preview-service em {
  color: color-mix(in srgb, var(--layout-preview-ink) 58%, transparent);
  font-size: 7px;
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
  font-size: 7px;
  font-style: normal;
  font-weight: 850;
}

.layout-preview-action {
  display: grid;
  min-height: 27px;
  place-items: center;
  border-radius: 8px;
  color: var(--layout-preview-surface);
  background: var(--layout-preview-accent);
  font-size: 7px;
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
  font-size: 6.5px;
}

.layout-preview-feature-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
}

.layout-preview-feature-grid > span {
  display: flex;
  min-width: 0;
  min-height: 27px;
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
  font-size: 6px;
  font-style: normal;
  font-weight: 850;
}

.layout-preview-feature-grid b {
  min-width: 0;
  overflow: hidden;
  font-size: 6.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layout-preview-footer {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 6px;
  color: color-mix(in srgb, var(--layout-preview-ink) 58%, transparent);
  font-size: 6px;
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

.popup-layout-live-preview[data-preview-kind="minimal"] :is(.preview-translation, .layout-preview-feature-grid > span, .layout-preview-site) {
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

.popup-layout-live-preview[data-preview-kind="contrast"] :is(.layout-preview-popup, .preview-translation, .layout-preview-site, .layout-preview-feature-grid > span) {
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

.popup-layout-live-preview[data-preview-skin="paper"] .layout-preview-popup {
  border-radius: 11px;
  background:
    linear-gradient(color-mix(in srgb, var(--layout-preview-ink) 3%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--layout-preview-ink) 2%, transparent) 1px, transparent 1px),
    var(--layout-preview-canvas);
  background-size: 12px 12px, 12px 12px, auto;
}

.popup-layout-live-preview[data-preview-skin="sakura"] .layout-preview-popup {
  border-radius: 22px;
}

@media (max-width: 480px) {
  .popup-layout-live-preview {
    width: 100%;
  }
}
</style>
