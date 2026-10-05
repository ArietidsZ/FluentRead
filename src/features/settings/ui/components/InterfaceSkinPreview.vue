<!--
@file src/features/settings/ui/components/InterfaceSkinPreview.vue
文件职责：以真实 DOM 绘制完整的弹窗外观范例，让用户直接比较所选皮肤的配色、层次和密度。
主要内容：按正式弹窗的信息层次展示本地品牌标识和版本、赞赏与设置、语言与服务、网页及局部翻译、站点开关、四张功能卡和底部信息栏，复用服务图标、背景图案和语义色。
模块边界：本组件仅展示无交互的外观范例，不读取用户配置、不连接浏览器状态，也不执行弹窗业务；风格选择和持久化仍由设置页负责。
-->
<template>
  <section
    class="interface-skin-live-preview"
    :data-preview-skin="skin.value"
    :data-preview-kind="skin.kind"
    :style="previewStyle"
    role="img"
    :aria-label="previewLabel"
  >
    <div class="preview-popup" aria-hidden="true">
      <InterfaceBackdrop :motif="skin.motif" />
      <header class="preview-header">
        <span class="preview-brand">
          <img class="preview-logo" :src="'/icon/128.png'" alt="" width="32" height="32" />
          <span><strong>{{ translateLegacy('流畅阅读') }}</strong><small>v{{ version }}</small></span>
        </span>
        <span class="preview-header-actions">
          <span><Coffee />{{ t('popup.donationButton') }}</span>
          <span><Setting />{{ translateLegacy('设置') }}</span>
        </span>
      </header>

      <section class="preview-hero">
        <div class="preview-language-pair">
          <span class="preview-language">
            <small>{{ t('popup.sourceLanguage') }}</small>
            <span class="preview-language-select"><strong>{{ translateLegacy('自动检测') }}</strong><i /></span>
          </span>
          <b>→</b>
          <span class="preview-language">
            <small>{{ t('popup.targetLanguage') }}</small>
            <span class="preview-language-select"><strong>{{ translateLegacy('简体中文') }}</strong><i /></span>
          </span>
        </div>

        <div class="preview-service">
          <strong>{{ t('popup.providers.title') }}</strong>
          <span class="preview-provider-icons">
            <ServiceIcon v-for="service in previewProviders" :key="service" :service="service" size="small" />
            <b>›</b>
          </span>
        </div>

        <div class="preview-action-row">
          <span class="preview-action"><b>A↔译</b><strong>{{ t('popup.translateCurrentPage') }}</strong><kbd>Option+T</kbd></span>
          <span class="preview-section-action">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15M10 10l7 2.6-3 1.1-1.1 3z" /></svg>
            {{ t('popup.sectionTranslation') }}
          </span>
        </div>

        <div class="preview-site-rules">
          <span>{{ translateLegacy('始终翻译此网站') }}<i /></span>
          <span>{{ translateLegacy('在此网站禁用扩展') }}<i /></span>
        </div>
      </section>

      <div class="preview-features">
        <span v-for="feature in previewFeatures" :key="feature.id" class="preview-feature" :data-preview-feature="feature.id">
          <span class="preview-feature-icon">
            <template v-if="skin.value === 'emoji'">{{ feature.emoji }}</template>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path :d="feature.path" /></svg>
          </span>
          <span class="preview-feature-copy"><strong>{{ translateLegacy(feature.label) }}</strong><small>{{ translateLegacy(feature.summary) }}</small></span>
          <b v-if="feature.id === 'document'">↗</b>
          <span v-else class="preview-feature-status" :class="{active: feature.active}" />
        </span>
      </div>

      <footer class="preview-footer">
        <span>{{ t('popup.translationCount', {count: 0}) }}</span>
        <span class="preview-open-source">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.26c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.77.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.62-2.81 5.65-5.49 5.95.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .3" /></svg>
          {{ t('popup.openSourceProject') }} ↗
        </span>
        <span>{{ t('popup.clearCache') }}</span>
      </footer>
    </div>
  </section>
</template>

<script setup lang="ts">
import {computed} from 'vue'
import {Coffee, Setting} from '@element-plus/icons-vue'
import {version} from '@/package.json'
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue'
import InterfaceBackdrop from '@/src/ui/components/InterfaceBackdrop.vue'
import type {InterfaceSkinOption} from '@/src/core/config/interfaceAppearance'
import {useUiI18n} from '@/src/ui/i18n'

const props = defineProps<{
  skin: InterfaceSkinOption
  skinLabel: string
  previewLabel: string
}>()
const {t, translateLegacy} = useUiI18n()
// 固定范例用于比较外观，不表示这些服务、快捷键或开关已在用户配置中启用。
const previewProviders = ['localTranslation', 'freeTranslation', 'microsoft', 'deepseek']
const previewFeatures = [
  {id: 'hover', label: '鼠标悬停翻译', summary: 'Ctrl', active: true, emoji: '🖱️', path: 'M5 3l14 10-7 1-3 7-4-18z M12 14l5 6'},
  {id: 'selection', label: '划词翻译', summary: '已关闭', active: false, emoji: '✍️', path: 'M8 4h8 M12 4v16 M8 20h8 M5 8H3v8h2 M19 8h2v8h-2'},
  {id: 'image', label: '图片翻译', summary: 'Shift+Z', active: true, emoji: '🖼️', path: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M4 16l5-5 4 4 3-3 4 4 M16 8h.01'},
  {id: 'document', label: '文档翻译', summary: 'PDF / Word / …', active: false, emoji: '📖', path: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5z M14 3v5h5 M9 12h6 M9 16h6'},
]
const previewStyle = computed(() => {
  const preview = props.skin.preview
  return {
    '--preview-canvas': `var(--skin-page, var(--surface, ${preview.canvas}))`,
    '--preview-surface': `var(--surface, ${preview.surface})`,
    '--preview-accent': `var(--brand, ${preview.accent})`,
    '--preview-ink': `var(--ink, ${preview.ink})`,
  }
})
</script>

<style scoped>
.interface-skin-live-preview { width: min(100%, 360px); color: var(--preview-ink); }
.preview-popup {
  position: relative; isolation: isolate; display: grid; gap: 10px; padding: 14px 14px 6px; overflow: hidden;
  border: 1px solid var(--line); border-radius: 16px;
  background: var(--skin-canvas-background, var(--preview-canvas)); background-size: var(--skin-canvas-background-size, auto);
  box-shadow: var(--skin-panel-shadow, none); font-size: 11px; line-height: 1.4; transition: background 160ms ease;
}
.preview-popup *, .preview-popup *::before, .preview-popup *::after { box-sizing: border-box; }
.preview-popup strong { color: inherit; font-size: inherit; font-weight: 750; line-height: 1.35; }
.preview-popup small { color: var(--muted); font-size: 10px; line-height: 1.4; }
.preview-header, .preview-brand, .preview-header-actions, .preview-header-actions > span { display: flex; align-items: center; }
.preview-header { position: relative; flex-wrap: wrap; gap: 8px; justify-content: space-between; }
.preview-brand { min-width: 0; gap: 8px; }
.preview-logo { width: 32px; height: 32px; flex: none; }
.preview-brand > span { display: grid; min-width: 0; gap: 2px; }
.preview-popup .preview-brand strong { font-size: 12px; white-space: nowrap; }
.preview-popup .preview-brand small { font-size: 9px; }
.preview-header-actions { flex: none; gap: 6px; margin-left: auto; }
.preview-header-actions > span { justify-content: center; gap: 4px; padding: 7px 6px; border: 1px solid var(--line); border-radius: 11px; background: var(--preview-surface); font-size: 10px; font-weight: 700; }
.preview-header-actions > span:first-child { color: var(--muted); }
.preview-header-actions svg { width: 15px; height: 15px; flex: none; }
.preview-hero { position: relative; display: grid; min-width: 0; gap: 8px; padding: 11px; border: 1px solid var(--line); border-radius: 17px; background: var(--preview-surface); }
.preview-language-pair { display: grid; grid-template-columns: minmax(0, 1fr) 18px minmax(0, 1fr); align-items: end; gap: 6px; }
.preview-language { display: grid; min-width: 0; gap: 4px; }
.preview-popup .preview-language > small { padding-left: 3px; font-weight: 650; }
.preview-language-select { display: flex; min-height: 35px; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 9px; border: 1px solid var(--line); border-radius: 11px; background: var(--surface-soft); }
.preview-language-select strong { min-width: 0; overflow-wrap: anywhere; }
.preview-language-select i { width: 7px; height: 7px; margin-top: -3px; flex: none; border-right: 1px solid var(--muted); border-bottom: 1px solid var(--muted); transform: rotate(45deg); }
.preview-language-pair > b { display: grid; height: 35px; place-items: center; color: var(--muted); font-size: 16px; }
.preview-service { display: flex; min-width: 0; min-height: 43px; align-items: center; justify-content: space-between; gap: 5px; padding: 6px 9px; border: 1px solid var(--line); border-radius: 11px; background: var(--surface-soft); }
.preview-provider-icons { display: flex; flex: none; align-items: center; }
.preview-provider-icons :deep(.service-brand-icon) { width: 25px; height: 25px; margin-left: -3px; border: 1px solid var(--preview-surface); border-radius: 10px; }
.preview-provider-icons > b { margin-left: 6px; color: var(--muted); font-size: 19px; font-weight: 500; }
.preview-action-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(46px, max-content); gap: 7px; }
.preview-action { display: flex; min-width: 0; min-height: 41px; align-items: center; justify-content: center; flex-wrap: wrap; gap: 4px; padding: 7px; border-radius: 14px; color: var(--skin-action-text, #fff); background: var(--preview-accent); }
.preview-action > b { font-size: 9px; }
.preview-action > strong { min-width: 0; text-align: center; overflow-wrap: anywhere; }
.preview-action kbd { padding: 3px 5px; border: 1px solid currentColor; border-radius: 7px; background: #ffffff24; font: inherit; font-size: 9px; font-weight: 650; white-space: nowrap; }
.preview-section-action { display: grid; align-content: center; justify-items: center; gap: 2px; padding: 4px; border: 1px solid var(--line); border-radius: 14px; color: var(--preview-accent); background: var(--surface-soft); font-size: 10px; font-weight: 700; text-align: center; }
.preview-section-action svg { width: 17px; height: 17px; }
.preview-site-rules { display: flex; flex-wrap: wrap; gap: 5px; padding: 6px 7px; border: 1px solid var(--line); border-radius: 11px; background: var(--surface-soft); }
.preview-site-rules > span { display: inline-flex; min-width: 0; align-items: center; gap: 5px; padding: 4px 6px; border: 1px solid color-mix(in srgb, var(--preview-accent) 22%, var(--line)); border-radius: 8px; color: var(--preview-accent); background: var(--preview-surface); font-size: 9px; font-weight: 650; }
.preview-site-rules > span:last-child { border-color: var(--line); color: var(--muted); }
.preview-site-rules i { width: 5px; height: 5px; flex: none; border-radius: 50%; background: var(--muted); opacity: .45; }
.preview-features { position: relative; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.preview-feature { display: grid; grid-template-columns: 26px minmax(0, 1fr) 6px; min-width: 0; min-height: 50px; align-items: center; gap: 7px; padding: 8px; border: 1px solid var(--line); border-radius: var(--skin-feature-radius, 11px); background: var(--preview-surface); box-shadow: var(--skin-feature-shadow, none); }
.preview-feature-icon { display: grid; width: 26px; height: 28px; place-items: center; border-radius: 9px; color: var(--preview-accent); background: var(--brand-soft); font-size: 18px; }
.preview-feature-icon svg { width: 19px; height: 19px; }
.preview-feature-copy { display: grid; min-width: 0; gap: 3px; overflow-wrap: anywhere; }
.preview-popup .preview-feature-copy strong { font-size: 10.5px; }
.preview-popup .preview-feature-copy small { font-size: 9px; }
.preview-feature > b { color: var(--muted); font-size: 13px; }
.preview-feature-status { width: 5px; height: 5px; border-radius: 50%; background: var(--muted); opacity: .5; }
.preview-feature-status.active { background: #24b47e; box-shadow: 0 0 0 3px #24b47e20; opacity: 1; }
.preview-footer { position: relative; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 5px; margin: 0 -14px; padding: 8px 14px 0; border-top: 1px solid var(--line); color: var(--muted); font-size: 9px; }
.preview-open-source { display: inline-flex; align-items: center; gap: 4px; padding: 4px 6px; border-radius: 999px; background: var(--surface-soft); font-weight: 650; }
.preview-open-source svg { width: 12px; height: 12px; flex: none; }

.interface-skin-live-preview[data-preview-kind="minimal"] .preview-popup { gap: 11px; box-shadow: none; }
.interface-skin-live-preview[data-preview-kind="minimal"] :is(.preview-hero, .preview-header-actions > span, .preview-language-select, .preview-service, .preview-site-rules, .preview-feature) { border-color: transparent; }
.interface-skin-live-preview[data-preview-kind="minimal"] .preview-action { border: 1px solid var(--line); color: var(--preview-ink); background: var(--surface-soft); }
.interface-skin-live-preview[data-preview-kind="compact"] .preview-popup { gap: 6px; padding: 10px 10px 5px; border-radius: 12px; }
.interface-skin-live-preview[data-preview-kind="compact"] .preview-hero { gap: 6px; padding: 8px; border-radius: 12px; }
.interface-skin-live-preview[data-preview-kind="compact"] :is(.preview-language-select, .preview-service, .preview-action) { min-height: 30px; border-radius: 8px; }
.interface-skin-live-preview[data-preview-kind="compact"] .preview-feature { min-height: 42px; padding: 5px; gap: 5px; border-radius: 8px; }
.interface-skin-live-preview[data-preview-kind="compact"] .preview-features { gap: 5px; }
.interface-skin-live-preview[data-preview-kind="compact"] .preview-footer { margin: 0 -10px; padding: 6px 10px 0; }
.interface-skin-live-preview[data-preview-kind="contrast"] :is(.preview-popup, .preview-hero, .preview-header-actions > span, .preview-language-select, .preview-service, .preview-site-rules, .preview-feature, .preview-section-action) { border: 2px solid var(--line); border-radius: 7px; box-shadow: none; }
.interface-skin-live-preview[data-preview-kind="contrast"] .preview-action { border: 2px solid var(--line); border-radius: 7px; color: var(--preview-canvas); }
.interface-skin-live-preview[data-preview-kind="palette"] .preview-popup { border-radius: var(--skin-panel-radius, 16px); }
.interface-skin-live-preview[data-preview-kind="palette"] :is(.preview-language-select, .preview-service, .preview-action, .preview-section-action) { border-radius: var(--skin-control-radius, 11px); }
@media (prefers-reduced-motion: reduce) { .preview-popup { transition: none; } }
</style>
