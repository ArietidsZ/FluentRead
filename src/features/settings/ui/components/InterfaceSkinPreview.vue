<!--
@file src/features/settings/ui/components/InterfaceSkinPreview.vue
文件职责：以真实 DOM 绘制当前所选界面皮肤的迷你 Popup 范例，让用户不依赖截图即可预判配色、层次和密度。
主要内容：以注册表色值展示布局型皮肤，以当前语义色展示氛围配色及其深浅模式，渲染品牌栏、语言选择、翻译服务、主操作和快捷入口。
模块边界：本组件只展示装饰性范例，不提供可交互控件、不读取或保存配置，也不模拟网页翻译结果；皮肤选择仍由 InterfaceSettings 拥有。
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
      <header class="preview-header">
        <span class="preview-logo">A中</span>
        <span class="preview-brand">
          <strong>{{ translateLegacy('流畅阅读') }}</strong>
          <small>{{ skinLabel }}</small>
        </span>
        <i class="preview-switch"><b /></i>
      </header>

      <div class="preview-language-pair">
        <span>{{ translateLegacy('自动检测') }}</span>
        <b>→</b>
        <span>{{ translateLegacy('简体中文') }}</span>
      </div>

      <div class="preview-service">
        <i>译</i>
        <span><small>{{ translateLegacy('翻译服务') }}</small><strong>{{ translateLegacy('免费翻译服务') }}</strong></span>
        <b>⌄</b>
      </div>

      <div class="preview-action">{{ translateLegacy('翻译当前网页') }}</div>

      <div class="preview-features">
        <span><i>文</i>{{ translateLegacy('文档翻译') }}</span>
        <span><i>T</i>{{ translateLegacy('划词翻译') }}</span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import {computed} from 'vue'
import type {InterfaceSkinOption} from '@/src/core/config/interfaceAppearance'
import {useUiI18n} from '@/src/ui/i18n'

const props = defineProps<{
  skin: InterfaceSkinOption
  skinLabel: string
  previewLabel: string
}>()
const {translateLegacy} = useUiI18n()

const previewStyle = computed(() => {
  const preview = props.skin.preview
  if (props.skin.kind === 'palette') {
    return {
      '--preview-canvas': `var(--skin-page, ${preview.canvas})`,
      '--preview-surface': `var(--surface, ${preview.surface})`,
      '--preview-accent': `var(--brand, ${preview.accent})`,
      '--preview-ink': `var(--ink, ${preview.ink})`,
    }
  }
  return {
    '--preview-canvas': preview.canvas,
    '--preview-surface': preview.surface,
    '--preview-accent': preview.accent,
    '--preview-ink': preview.ink,
  }
})
</script>

<style scoped>
.interface-skin-live-preview {
  width: min(100%, 318px);
  color: var(--preview-ink);
}

.preview-popup {
  display: grid;
  gap: 7px;
  padding: 10px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--preview-ink) 16%, transparent);
  border-radius: 15px;
  background:
    radial-gradient(circle at 94% 0, color-mix(in srgb, var(--preview-accent) 15%, transparent), transparent 32%),
    var(--preview-canvas);
  box-shadow: 0 10px 24px color-mix(in srgb, var(--preview-ink) 10%, transparent);
  transition: background 160ms ease, border-radius 160ms ease, box-shadow 160ms ease;
}

.preview-header {
  display: grid;
  grid-template-columns: 27px minmax(0, 1fr) 26px;
  align-items: center;
  gap: 7px;
}

.preview-logo {
  display: grid;
  width: 27px;
  height: 27px;
  place-items: center;
  border-radius: 9px;
  color: var(--preview-surface);
  background: var(--preview-accent);
  font-size: 7px;
  font-weight: 850;
}

.preview-brand {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.preview-brand strong {
  font-size: 9px;
  line-height: 1.2;
}

.preview-brand small {
  overflow: hidden;
  color: color-mix(in srgb, var(--preview-ink) 66%, transparent);
  font-size: 6.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-switch {
  display: flex;
  width: 26px;
  height: 15px;
  align-items: center;
  justify-content: flex-end;
  padding: 2px;
  border-radius: 999px;
  background: var(--preview-accent);
}

.preview-switch b {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--preview-surface);
}

.preview-language-pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 14px minmax(0, 1fr);
  align-items: center;
  gap: 4px;
}

.preview-language-pair span {
  min-width: 0;
  padding: 7px 6px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--preview-ink) 10%, transparent);
  border-radius: 8px;
  background: var(--preview-surface);
  font-size: 7px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-language-pair > b {
  color: color-mix(in srgb, var(--preview-ink) 58%, transparent);
  font-size: 8px;
  text-align: center;
}

.preview-service {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 10px;
  align-items: center;
  gap: 7px;
  min-height: 37px;
  padding: 5px 7px;
  border: 1px solid color-mix(in srgb, var(--preview-ink) 10%, transparent);
  border-radius: 9px;
  background: var(--preview-surface);
}

.preview-service > i {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 8px;
  color: var(--preview-accent);
  background: color-mix(in srgb, var(--preview-accent) 13%, var(--preview-surface));
  font-size: 8px;
  font-style: normal;
  font-weight: 850;
}

.preview-service > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.preview-service small {
  color: color-mix(in srgb, var(--preview-ink) 58%, transparent);
  font-size: 6px;
}

.preview-service strong {
  overflow: hidden;
  font-size: 7px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-service > b {
  color: color-mix(in srgb, var(--preview-ink) 55%, transparent);
  font-size: 7px;
}

.preview-action {
  display: grid;
  min-height: 30px;
  place-items: center;
  border-radius: 9px;
  color: var(--preview-surface);
  background: var(--preview-accent);
  font-size: 8px;
  font-weight: 850;
}

.preview-features {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
}

.preview-features span {
  display: flex;
  min-width: 0;
  min-height: 25px;
  align-items: center;
  gap: 5px;
  padding: 4px 6px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--preview-ink) 11%, transparent);
  border-radius: 8px;
  background: var(--preview-surface);
  font-size: 6.5px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-features i {
  color: var(--preview-accent);
  font-size: 7px;
  font-style: normal;
  font-weight: 850;
}

.interface-skin-live-preview[data-preview-kind="minimal"] .preview-popup {
  gap: 8px;
  padding: 11px;
  border-color: transparent;
  background: var(--preview-surface);
  box-shadow: none;
}

.interface-skin-live-preview[data-preview-kind="minimal"] :is(.preview-language-pair span, .preview-service) {
  border-color: transparent;
  background: var(--preview-canvas);
}

.interface-skin-live-preview[data-preview-kind="minimal"] .preview-switch {
  background: color-mix(in srgb, var(--preview-accent) 16%, var(--preview-canvas));
}

.interface-skin-live-preview[data-preview-kind="minimal"] .preview-switch b {
  background: color-mix(in srgb, var(--preview-accent) 58%, var(--preview-surface));
}

.interface-skin-live-preview[data-preview-kind="minimal"] .preview-logo {
  background: color-mix(in srgb, var(--preview-accent) 78%, var(--preview-surface));
}

.interface-skin-live-preview[data-preview-kind="minimal"] .preview-action {
  border: 1px solid color-mix(in srgb, var(--preview-accent) 18%, transparent);
  color: var(--preview-ink);
  background: color-mix(in srgb, var(--preview-accent) 6%, var(--preview-canvas));
  font-weight: 750;
}

.interface-skin-live-preview[data-preview-kind="compact"] .preview-popup {
  gap: 4px;
  padding: 7px;
  border-radius: 10px;
  box-shadow: none;
}

.interface-skin-live-preview[data-preview-kind="compact"] :is(.preview-language-pair span, .preview-service, .preview-action) {
  min-height: 24px;
  padding-top: 4px;
  padding-bottom: 4px;
  border-radius: 6px;
}

.interface-skin-live-preview[data-preview-kind="contrast"] .preview-popup,
.interface-skin-live-preview[data-preview-kind="contrast"] :is(.preview-language-pair span, .preview-service, .preview-features span) {
  border: 2px solid var(--preview-ink);
  border-radius: 4px;
  box-shadow: none;
}

.interface-skin-live-preview[data-preview-kind="contrast"] .preview-action {
  border: 2px solid var(--preview-ink);
  border-radius: 4px;
  color: var(--preview-surface);
  background: var(--preview-ink);
}

.interface-skin-live-preview[data-preview-kind="palette"] .preview-popup {
  border-color: var(--line);
  border-radius: 14px;
  background: var(--preview-canvas);
  box-shadow: none;
}

.interface-skin-live-preview[data-preview-kind="palette"] :is(.preview-language-pair span, .preview-service, .preview-features span) {
  border-color: var(--line);
  border-radius: 10px;
  background: var(--preview-surface);
}

.interface-skin-live-preview[data-preview-kind="palette"] :is(.preview-language-pair span, .preview-service) {
  background: var(--surface-soft);
}

.interface-skin-live-preview[data-preview-kind="palette"] :is(.preview-brand small, .preview-language-pair > b, .preview-service small, .preview-service > b) {
  color: var(--muted);
}

.interface-skin-live-preview[data-preview-kind="palette"] .preview-logo,
.interface-skin-live-preview[data-preview-kind="palette"] .preview-action {
  color: var(--skin-action-text);
  background: var(--preview-accent);
}

.interface-skin-live-preview[data-preview-kind="palette"] .preview-action {
  border-radius: 10px;
}

.interface-skin-live-preview[data-preview-kind="palette"] .preview-switch b {
  background: #fff;
}

.interface-skin-live-preview[data-preview-kind="palette"] .preview-service > i {
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.interface-skin-live-preview[data-preview-kind="palette"] .preview-features i {
  color: var(--brand-strong);
}

@media (max-width: 480px) {
  .interface-skin-live-preview { width: 100%; }
}
</style>
