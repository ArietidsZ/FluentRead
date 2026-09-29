<!--
 * @file src/features/share-card/ui/ShareCardStudio.vue
 * 文件职责：提供双语卡片的轻量入口和所见即所得编辑预览，服务网页段落与划词结果。
 * 主要内容：原生模态对话框、四套风格、尺寸和字号选择、可编辑双语、来源与署名开关、PNG 保存复制与系统分享；外观写回共享配置，内容仅在本次打开期间存在。
 * 模块边界：组件位于封闭 Shadow UI，不读取网页正文、不调用翻译服务；渲染与导出委托独立适配器，关闭时释放 Blob URL 并使迟到渲染失效。
 -->
<template>
  <div class="fr-card-root" @pointerdown.stop @pointerup.stop @click.stop @wheel.stop.passive>
    <button v-if="anchor && !opened" class="fr-card-launcher" :style="{left: `${anchor.x}px`, top: `${anchor.y}px`}" type="button" @click="emit('activate')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.3"/><path d="m4 17 5-5 4 4 3-3 4 4"/></svg>{{ t('shareCard.create') }}
    </button>
    <dialog ref="dialog" :style="{'--fr-card-accent': CARD_THEMES[preferences.theme].uiAccent}" class="fr-card-dialog" aria-labelledby="fr-card-title" @cancel.prevent="close" @close="cleanup" @keydown.stop @pointerdown.stop @click.stop>
      <template v-if="opened">
        <header class="fr-card-header">
          <div><h2 id="fr-card-title">{{ t('shareCard.create') }}</h2></div>
          <button class="fr-card-close" type="button" :aria-label="t('shareCard.close')" autofocus @click="close">×</button>
        </header>
        <div class="fr-card-workspace">
          <section class="fr-card-preview" :aria-label="t('shareCard.preview')" :aria-busy="rendering">
            <div class="fr-card-preview-top"><span>{{ t('shareCard.preview') }}</span><span v-if="result">{{ Math.ceil(result.blob.size / 1024) }} KB · PNG</span></div>
            <div class="fr-card-image-wrap">
              <div v-show="result && !renderError" ref="canvasSlot" class="fr-card-canvas-slot" :class="{'is-rendering': rendering}" />
              <p v-if="!result || renderError" class="fr-card-placeholder" role="status">{{ renderError || t('shareCard.rendering') }}</p>
            </div>

          </section>
          <aside class="fr-card-controls" :aria-label="t('shareCard.customize')">
            <fieldset class="fr-card-fieldset"><legend class="fr-card-sr-only">{{ t('shareCard.style') }}</legend>
              <div class="fr-card-themes">
                <button v-for="theme in SHARE_CARD_THEMES" :key="theme" type="button" :data-theme="theme" :aria-pressed="preferences.theme === theme" @click="setPreference('theme', theme)">
                  <span class="fr-card-swatch" :class="`fr-card-swatch--${theme}`" aria-hidden="true"><i /><i /></span><span>{{ t(`shareCard.theme.${theme}`) }}</span>
                </button>
              </div>
            </fieldset>
            <details class="fr-card-more"><summary>{{ t('shareCard.more') }}</summary>
            <div class="fr-card-options-row">
              <label>{{ t('shareCard.format') }}<select :value="preferences.format" @change="setPreference('format', ($event.target as HTMLSelectElement).value)"><option value="auto">{{ t('shareCard.auto') }}</option><option value="square">{{ t('shareCard.square') }}</option></select></label>
              <label>{{ t('shareCard.fontSize') }}<select :value="preferences.fontSize" @change="setPreference('fontSize', ($event.target as HTMLSelectElement).value)"><option value="small">{{ t('shareCard.small') }}</option><option value="medium">{{ t('shareCard.medium') }}</option><option value="large">{{ t('shareCard.large') }}</option></select></label>
            </div>
            <div class="fr-card-checks">
              <label><input type="checkbox" :checked="preferences.translationFirst" @change="setPreference('translationFirst', ($event.target as HTMLInputElement).checked)" />{{ t('shareCard.translationFirst') }}</label>
              <label><input type="checkbox" :checked="preferences.showSource" @change="setPreference('showSource', ($event.target as HTMLInputElement).checked)" />{{ t('shareCard.showSource') }}</label>
              <label><input type="checkbox" :checked="preferences.showBrand" @change="setPreference('showBrand', ($event.target as HTMLInputElement).checked)" />{{ t('shareCard.showBrand') }}</label>
            </div>
            <label v-if="preferences.showSource" class="fr-card-source">{{ t('shareCard.source') }}<input v-model="excerpt.source" maxlength="160" :placeholder="t('shareCard.sourceHint')" /></label>
            </details>
            <details class="fr-card-edit" :open="editorOpen" @toggle="editorOpen = ($event.target as HTMLDetailsElement).open">
              <summary>{{ t('shareCard.edit') }}<span>{{ excerpt.original.length + excerpt.translation.length }} / {{ SHARE_CARD_MAX_CHARACTERS }}</span></summary>
              <p>{{ t('shareCard.editHint') }}</p>
              <label>{{ t('shareCard.original') }}<textarea v-model="excerpt.original" dir="auto" rows="4" spellcheck="false" /></label>
              <label>{{ t('shareCard.translation') }}<textarea v-model="excerpt.translation" dir="auto" rows="4" spellcheck="false" /></label>
            </details>

          </aside>
        </div>
        <footer class="fr-card-footer">
          <p v-if="status || renderError || rendering" class="fr-card-feedback" role="status" :class="{'is-error': statusError}">{{ status || renderError || t('shareCard.rendering') }}</p>
          <span class="fr-card-local-note">{{ t('shareCard.local') }}</span>
          <div class="fr-card-export-actions">
            <button v-if="shareAvailable" type="button" :disabled="!ready || busy" @click="exportImage('share')">{{ t('shareCard.share') }}</button>
            <button type="button" :disabled="!ready || busy || !copyAvailable" :title="copyAvailable ? t('shareCard.copy') : t('shareCard.copyUnavailable')" @click="exportImage('copy')">{{ t('shareCard.copy') }}</button>
            <button class="fr-card-primary" type="button" :disabled="!ready || busy" @click="saveImage">{{ t('shareCard.save') }}</button>
          </div>
          <p v-if="!copyAvailable" class="fr-card-fallback">{{ t('shareCard.copyUnavailable') }}</p>
        </footer>
      </template>
    </dialog>
  </div>
</template>

<script setup lang="ts">
import browser from 'webextension-polyfill';
import {computed, nextTick, onBeforeUnmount, reactive, ref, shallowRef, watch} from 'vue';
import {config, requestConfigPatch} from '@/src/services/config/store';
import {normalizeShareCardPreferences, SHARE_CARD_THEMES, type ShareCardPreferences} from '@/src/core/config/shareCard';
import {useUiI18n} from '@/src/ui/i18n';
import {SHARE_CARD_MAX_CHARACTERS, type ShareCardExcerpt} from '../core';
import {CARD_THEMES} from '../themes';
import {renderShareCard, ShareCardRenderError, type RenderedShareCard} from '../render';
import {canCopyCardImage, canShareCardImage, copyCardImage, shareCardFilename, shareCardImage} from '../export';

const anchor = ref<{x: number; y: number} | null>(null);
const emit = defineEmits<{activate: []; closed: []}>();
const {t, language} = useUiI18n();
const dialog = ref<HTMLDialogElement>();
const canvasSlot = ref<HTMLElement>();
const opened = ref(false);
const editorOpen = ref(false);
const preferences = ref(normalizeShareCardPreferences());
const excerpt = reactive<ShareCardExcerpt>({original: '', translation: '', source: ''});
const result = shallowRef<RenderedShareCard | null>(null);
const imageUrl = ref('');
const renderError = ref('');
const rendering = ref(false);
const busy = ref(false);
const status = ref('');
const statusError = ref(false);
const copyAvailable = canCopyCardImage();
const shareAvailable = computed(() => Boolean(result.value && canShareCardImage(result.value.blob)));
const ready = computed(() => Boolean(result.value && !renderError.value && !rendering.value));
let generation = 0;
let openGeneration = 0;
let renderTimer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let saveQueue = Promise.resolve();

function releaseImage(): void {
    if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
    imageUrl.value = ''; result.value = null; canvasSlot.value?.replaceChildren();
}
function cleanup(): void {
    if (!opened.value) return;
    opened.value = false; openGeneration++; generation++;
    clearTimeout(renderTimer); releaseImage();
    Object.assign(excerpt, {original: '', translation: '', source: ''});
    status.value = ''; renderError.value = ''; busy.value = false;
    emit('closed');
}
function close(): void { dialog.value?.close(); cleanup(); }
async function open(value: ShareCardExcerpt): Promise<void> {
    editorOpen.value = false;
    preferences.value = normalizeShareCardPreferences(config.shareCard);
    Object.assign(excerpt, value);
    opened.value = true;
    const current = ++openGeneration;
    await nextTick();
    if (disposed || !opened.value || current !== openGeneration) return;
    if (!dialog.value?.open) dialog.value?.showModal();
    scheduleRender();
}
function setPreference(key: keyof ShareCardPreferences, value: unknown): void {
    preferences.value = normalizeShareCardPreferences({...preferences.value, [key]: value});
    // 字段补丁在队列实际执行时与最新权威偏好合并，其他页面的无关偏好不会被旧快照覆盖。
    saveQueue = saveQueue.then(() => requestConfigPatch({shareCard: normalizeShareCardPreferences({...config.shareCard, [key]: value})}, browser.runtime.sendMessage.bind(browser.runtime))).catch(() => {
        if (disposed || !opened.value) return;
        statusError.value = true; status.value = t('shareCard.preferenceFailed');
    });
}
function scheduleRender(): void {
    if (!opened.value) return;
    const current = ++generation;
    rendering.value = true; status.value = ''; statusError.value = false; renderError.value = '';
    // 渲染期间保留上张画面避免布局闪动；ready 立即变为 false，不允许保存过期内容。
    clearTimeout(renderTimer);
    renderTimer = setTimeout(async () => {
        try {
            const rendered = await renderShareCard({...excerpt}, {...preferences.value});
            if (!opened.value || current !== generation || disposed) return;
            releaseImage();
            rendered.canvas.setAttribute('role', 'img');
            rendered.canvas.setAttribute('aria-label', t('shareCard.previewAlt'));
            canvasSlot.value?.replaceChildren(rendered.canvas);
            result.value = rendered; imageUrl.value = URL.createObjectURL(rendered.blob);
        } catch (error) {
            if (!opened.value || current !== generation || disposed) return;
            releaseImage(); editorOpen.value = true;
            renderError.value = t(`shareCard.error.${error instanceof ShareCardRenderError ? error.reason : 'canvas'}`);
        } finally { if (current === generation) rendering.value = false; }
    }, 100);
}
function saveImage(): void {
    if (!ready.value || !dialog.value) return;
    const link = document.createElement('a'); link.href = imageUrl.value; link.download = shareCardFilename();
    dialog.value.append(link); link.click(); link.remove();
    statusError.value = false; status.value = t('shareCard.saved');
}
async function exportImage(kind: 'copy' | 'share'): Promise<void> {
    if (!ready.value || !result.value || busy.value) return;
    const current = generation;
    busy.value = true; status.value = ''; statusError.value = false;
    try {
        // PNG 已在预览时生成；可信点击内立即调用，避免异步渲染耗掉瞬时用户激活。
        const outcome = kind === 'copy' ? await copyCardImage(result.value.blob) : await shareCardImage(result.value.blob);
        if (current !== generation || disposed) return;
        status.value = outcome === 'cancelled' ? '' : t(kind === 'copy' ? 'shareCard.copied' : 'shareCard.shared');
    } catch {
        if (current !== generation || disposed) return;
        statusError.value = true; status.value = t(kind === 'copy' ? 'shareCard.copyFailed' : 'shareCard.shareFailed');
    } finally { if (!disposed) busy.value = false; }
}
watch([preferences, excerpt, language], scheduleRender, {deep: true, flush: 'sync'});
onBeforeUnmount(() => { disposed = true; dialog.value?.close(); cleanup(); clearTimeout(renderTimer); releaseImage(); });
defineExpose({open, close, setAnchor: (value: {x: number; y: number} | null) => { anchor.value = value; }});
</script>

<style scoped>
.fr-card-root { font: 13px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif; color: #242731; text-align: left; color-scheme: light; }
button, input, textarea, select { font: inherit; } button, select, input[type=checkbox], summary { cursor: pointer; }
button { border: 1px solid #dfe1e8; border-radius: 8px; background: #fff; color: inherit; padding: 9px 13px; } button:hover { background: #f5f6fa; } button:disabled { cursor: default; opacity: .45; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid #2453ed; outline-offset: 3px; }
.fr-card-launcher { position: fixed; display: flex; align-items: center; gap: 6px; padding: 6px 10px; box-shadow: 0 3px 12px #172c2620; white-space: nowrap; font-size: 12px; z-index: 2147483647; }
.fr-card-launcher svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; }
.fr-card-dialog { position: fixed; inset: 0; margin: auto; width: min(520px, calc(100vw - 24px)); max-width: none; max-height: min(760px, calc(100dvh - 32px)); padding: 0; border: 1px solid #e6e7ec; border-radius: 16px; background: #ffffff; color: #242731; box-shadow: 0 24px 80px #14261f30; overflow: auto; overscroll-behavior: contain; }
.fr-card-dialog[open] { display: flex; flex-direction: column; } .fr-card-dialog::backdrop { background: #171b3066; }
.fr-card-header { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 16px 22px 12px; flex-shrink: 0; }
h2 { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.5; } .fr-card-close { font-size: 22px; line-height: 1; padding: 4px 7px; border-color: transparent; background: transparent; color: #747888; }
.fr-card-workspace { min-height: 0; overflow: auto; }
.fr-card-preview { padding: 0 22px 6px; min-width: 0; }
.fr-card-preview-top { display: flex; justify-content: space-between; gap: 12px; color: #858997; font-size: 10px; margin-bottom: 9px; }
.fr-card-image-wrap { min-height: 180px; display: flex; justify-content: center; align-items: flex-start; }
.fr-card-canvas-slot { width: 100%; } .fr-card-canvas-slot.is-rendering { opacity: .65; } .fr-card-image-wrap :deep(canvas) { display: block; width: 100%; height: auto; border-radius: 5px; box-shadow: 0 3px 14px #283c2212; }
.fr-card-placeholder { margin: auto; padding: 28px 16px; color: #806752; text-align: center; line-height: 1.8; }
.fr-card-controls { padding: 14px 22px 8px; min-width: 0; display: grid; grid-template-columns: 1fr 1fr; column-gap: 16px; }
.fr-card-fieldset { border: 0; padding: 0; margin: 0 0 15px; grid-column: 1/-1; }
.fr-card-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.fr-card-themes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; }
.fr-card-themes button { padding: 5px 5px 6px; display: grid; justify-items: center; gap: 5px; font-size: 11px; background: transparent; border: 2px solid transparent; border-radius: 9px; }
.fr-card-themes button:hover { background: #f3f4f8; }
.fr-card-themes button[aria-pressed=true] { border-color: var(--fr-card-accent); background: #f6f7fb; color: var(--fr-card-accent); }
.fr-card-swatch { position: relative; display: flex; flex-direction: column; justify-content: center; gap: 6px; overflow: hidden; width: 100%; height: 39px; padding: 9px 12px; border-radius: 4px; box-shadow: inset 0 0 0 1px #00000008; }
.fr-card-swatch i { position: relative; display: block; width: 90%; height: 2px; background: #ffffffd9; z-index: 1; }
.fr-card-swatch i + i { width: 65%; height: 1px; background: #e2eaff; }
.fr-card-swatch--coral { background: linear-gradient(#eb4635 54%, #fff3dd 54%); }
.fr-card-swatch--coral i + i { background: #573a30; margin-top: 5px; }
.fr-card-swatch--sky { background: linear-gradient(135deg, #f5faff, #a9d4f6); align-items: center; }
.fr-card-swatch--sky i { background: #153d65; width: 85%; } .fr-card-swatch--sky i + i { background: #47728f; width: 65%; }
.fr-card-swatch--prism { background: #12131a; }
.fr-card-swatch--prism i { background: linear-gradient(90deg, #77b7ff, #b09cff, #ef9dcd, #ffc3a3); }
.fr-card-swatch--prism i + i { background: #c4c5d0; }
.fr-card-swatch--pearl { background: #fff; border: 3px solid #e8eaf2; flex-direction: row; align-items: flex-start; gap: 5px; }
.fr-card-swatch--pearl i { width: 46%; height: 11px; background: repeating-linear-gradient(#575b69 0 1px, transparent 1px 4px); }
.fr-card-swatch--pearl i + i { width: 38%; height: 7px; background: repeating-linear-gradient(#9196a6 0 1px, transparent 1px 4px); }
.fr-card-more, .fr-card-edit { grid-column: 1/-1; border-top: 1px solid #eceef3; padding: 10px 0; }
summary { font-size: 12px; color: #656b7c; } summary span { float: right; color: #9095a2; font-size: 10px; }
.fr-card-options-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 15px; }
label { display: grid; gap: 5px; font-size: 12px; } select, input:not([type=checkbox]), textarea { width: 100%; min-width: 0; border: 1px solid #dfe1e8; background: #fff; color: #292e3d; border-radius: 7px; padding: 7px 9px; }
.fr-card-checks { display: flex; flex-wrap: wrap; gap: 10px 16px; margin: 16px 0; } .fr-card-checks label { display: flex; align-items: center; gap: 6px; } input[type=checkbox] { accent-color: var(--fr-card-accent, #2453ed); margin: 0; width: 14px; height: 14px; }
.fr-card-source { margin-bottom: 8px; } .fr-card-edit:not([open]) summary span { display: none; } .fr-card-edit p { color: #818796; font-size: 11px; margin: 10px 0; } .fr-card-edit label { margin-top: 10px; } textarea { resize: vertical; min-height: 65px; line-height: 1.6; }
.fr-card-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 14px 22px 18px; border-top: 1px solid #eceef3; flex-shrink: 0; }
.fr-card-feedback { margin: 0; width: 100%; color: #656b7c; font-size: 11px; } .fr-card-feedback.is-error { color: #a44632; } .fr-card-export-actions { display: flex; gap: 7px; margin-left: auto; } .fr-card-primary { background: var(--fr-card-accent); color: #fff; border-color: var(--fr-card-accent); } .fr-card-primary:hover { filter: brightness(.92); background: var(--fr-card-accent); } .fr-card-local-note { color: #858997; font-size: 10px; } .fr-card-fallback { flex-basis: 100%; margin: 0; font-size: 11px; color: #747b8b; }
@media (max-width: 460px) { .fr-card-dialog { width: calc(100vw - 16px); max-height: calc(100dvh - 16px); border-radius: 12px; } .fr-card-header { padding: 12px 16px; } .fr-card-preview { padding: 0 14px 4px; } .fr-card-controls { padding: 12px 14px 6px; } .fr-card-footer { padding: 12px 14px; } .fr-card-local-note { width: 100%; } .fr-card-export-actions { width: 100%; } .fr-card-export-actions button { flex: 1; white-space: nowrap; } }
</style>
