<!--
 * @file src/features/image-translation/ui/MangaEntry.vue
 * 文件职责：在漫画阅读页提供独立于悬浮球的阅读入口、首次资源说明与可收起的清晰状态。
 * 主要内容：进入时提示支持的网站，先解释下载用途与容量再开始；区分本次关闭和永久关闭，保留原图暂停、失败反馈、翻译选项与设置入口；阅读时收为文字状态条，焦点、首次准备和错误期间不自动收起。
 * 模块边界：使用注入的动作和配置快照，不识别图片、不直接下载资源、不访问宿主业务数据；所有交互留在所属 closed Shadow UI。
 -->
<template>
  <aside v-if="visible" ref="panel" class="fr-manga-entry" :class="{compact}" :data-animated="settings.animations" :aria-label="t('漫画翻译')" @mouseenter="expand" @mouseleave="scheduleCollapse" @focusin="expand" @focusout="scheduleCollapse" @keydown.esc.stop="close">
    <button v-if="compact" type="button" class="fr-manga-compact" :aria-expanded="false" @click="expand">
      <svg class="fr-manga-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2.5" stroke="currentColor" stroke-width="1.7" /><path d="M3 14h18m-9 0v7M7 6h10v4h-6l-3 2v-2H7V6Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg><span>{{ t(status.pending ? status.prefetching ? '正在准备后续页面' : '正在翻译' : status.errors ? '部分页面未完成' : status.active ? '连续翻译已开启' : '漫画翻译') }}</span>
      <span v-if="status.pending" class="fr-manga-spinner" aria-hidden="true" /><span v-else-if="status.active && !status.errors && (status.completed ?? 0) > 0" class="fr-manga-done" aria-hidden="true">✓</span>
    </button>
    <template v-else>
      <header><div><strong>{{ t('漫画翻译') }}</strong><span data-i18n-ignore>{{ page.site }}</span></div><button type="button" class="fr-manga-close" :aria-label="t(status.active ? '收起漫画面板' : '本次关闭漫画提示')" @click="close">×</button></header>
      <template v-if="consent">
        <h3>{{ t('首次使用，先准备阅读资源') }}</h3>
        <p>{{ t('需要下载约 30 MB 的文字识别资源，复杂画面另需约 197 MB 的文字清除资源。下载一次后可重复使用。') }}</p>
        <p class="fr-manga-hint">{{ t('首次等待可能较长。图片在本地处理，识别出的文字交给你选择的翻译服务。') }}</p>
        <button type="button" class="fr-manga-primary" :disabled="busy" @click="confirm">{{ t('准备资源并开始') }}</button>
        <button type="button" class="fr-manga-later" @click="consent = false">{{ t('稍后') }}</button>
      </template>
      <template v-else>
        <p v-if="!status.active">{{ t('开启后，滚动阅读时自动翻译新页面。随时切回原图。') }}</p>
        <div v-else class="fr-manga-state" role="status" aria-live="polite"><span v-if="status.pending" class="fr-manga-spinner" aria-hidden="true" />
          <span>{{ t(status.prefetching && status.stage !== 'preparing' ? '正在提前翻译后续页面' : status.message || (status.pending ? '正在处理当前漫画页' : status.errors ? '部分页面未完成，可在图片上重试' : (status.completed ?? 0) === 0 ? '等待漫画图片加载' : '当前页面已翻译，滚动后继续')) }}<template v-if="status.pending && status.progress !== undefined"> {{ status.progress }}%</template></span>
        </div>
        <p v-if="status.active && (status.ahead ?? 0) > 0">{{ t('后续已准备') }}: {{ status.ahead }} {{ t('张图片') }}</p>
        <button type="button" class="fr-manga-primary" :disabled="busy || !status.available" @click="start">{{ t(busy ? '正在检查阅读资源' : status.active ? status.pending ? '暂停并显示原图' : '显示原图并暂停' : '开启连续翻译') }}</button>
        <details class="fr-manga-options" @toggle="optionsOpen = ($event.target as HTMLDetailsElement).open">
          <summary>{{ t('翻译选项') }}<span data-i18n-ignore>{{ targetLabel }}</span></summary>
          <label>{{ t('提前翻译后续页面') }}<select :aria-label="t('提前翻译后续页面')" :value="settings.prefetchPages" :disabled="busy" @change="save({imageTranslationMangaPrefetchPages: Number(($event.target as HTMLSelectElement).value)})"><option :value="0">{{ t('只翻译当前页面') }}</option><option v-for="count in 5" :key="count" :value="count">{{ count }} {{ t('张图片') }}</option></select></label>
          <label>{{ t('翻译成') }}<select :aria-label="t('漫画目标语言')" :value="settings.to" :disabled="busy || status.pending" @change="save({to: ($event.target as HTMLSelectElement).value})"><option v-for="item in targetLanguages" :key="item.value" :value="item.value" data-i18n-ignore>{{ t(item.label) }}</option></select></label>
          <label>{{ t('翻译服务') }}<select :aria-label="t('漫画翻译服务')" :value="settings.service" :disabled="busy || status.pending" @change="save({imageTranslationService: ($event.target as HTMLSelectElement).value})"><option value="">{{ t('跟随网页翻译服务') }}</option><option v-for="item in availableServices" :key="item.value" :value="item.value" data-i18n-ignore>{{ t(item.label) }}</option></select></label>
        </details>
      </template>
      <p v-if="error" class="fr-manga-error" role="alert" data-i18n-ignore>{{ error }}</p>
      <footer><button type="button" @click="openSettings">{{ t('漫画设置') }}</button><button v-if="!status.active" type="button" :disabled="busy" @click="never">{{ t('以后不再提示') }}</button></footer>
    </template>
  </aside>
</template>
<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import {useUiI18n} from '@/src/ui/i18n';
import {filterAvailableTranslationServices} from '@/src/services/translation/capabilities';
import {withCustomOpenAIServiceOptions} from '@/src/core/config/customOpenAI';
import {config} from '@/src/services/config/store';
import type {MangaTranslationStatus} from '../content/mangaSession';
const props = defineProps<{
  status: MangaTranslationStatus; page: {site: string; route: string};
  settings: {promptEnabled: boolean; to: string; service: string; downloadConfirmed: boolean; animations: boolean; prefetchPages: number};
  targetLanguages: {label: string; value: string}[]; services: {label: string; value: string}[];
  toggle: () => void; inspectResources: () => Promise<boolean>; persist: (patch: Record<string, unknown>) => Promise<unknown>; openSettings: () => void;
}>();
const {translateLegacy: t} = useUiI18n();
const panel = ref<HTMLElement>();
const dismissed = ref(false), manual = ref(false), compact = ref(false), consent = ref(false), busy = ref(false), error = ref(''), optionsOpen = ref(false);
const visible = computed(() => props.status.available && (manual.value || props.status.active || (props.settings.promptEnabled && !dismissed.value)));
const availableServices = computed(() => filterAvailableTranslationServices(withCustomOpenAIServiceOptions(props.services, config.customOpenAIProviders)));
const targetLabel = computed(() => t(props.targetLanguages.find(item => item.value === props.settings.to)?.label || props.settings.to));
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false, request = 0;
function expand() {clearTimeout(timer);if (compact.value) optionsOpen.value = false;compact.value = false;}
function scheduleCollapse() {clearTimeout(timer);timer = setTimeout(() => {
  if (props.status.active && props.status.stage !== 'preparing' && !props.status.errors && !error.value && !consent.value && !optionsOpen.value && !busy.value && !panel.value?.matches(':focus-within')) compact.value = true;
}, 900);}
function close() {request++;busy.value = false;optionsOpen.value = false;expand(); if (props.status.active) compact.value = true; else {dismissed.value = true; manual.value = false; consent.value = false;}}
async function save(patch: Record<string, unknown>) {
  const owner = ++request;busy.value = true; error.value = '';
  try {await props.persist(patch);return !disposed && owner === request;}
  catch (cause) {if (!disposed && owner === request) error.value = t(cause instanceof Error ? cause.message : String(cause));return false;}
  finally {if (!disposed && owner === request) busy.value = false;}
}
async function never() {if (await save({imageTranslationMangaPromptEnabled: false})) close();}
async function start() {
  if (busy.value || !props.status.available) return;
  if (props.status.active) {props.toggle();return;}
  const owner = ++request; busy.value = true; error.value = '';
  try {
    const ready = await props.inspectResources();
    if (disposed || owner !== request) return;
    if (!ready && !props.settings.downloadConfirmed) consent.value = true;
    else props.toggle();
  } catch (cause) {if (!disposed && owner === request) error.value = t(cause instanceof Error ? cause.message : String(cause));}
  finally {if (!disposed && owner === request) busy.value = false;}
}
async function confirm() {if (await save({imageTranslationMangaDownloadConfirmed: true})) {consent.value = false;props.toggle();}}
watch(() => props.page.route, () => {request++;busy.value = false;dismissed.value = false;manual.value = false;compact.value = false;consent.value = false;optionsOpen.value = false;error.value = '';clearTimeout(timer);});
watch(() => props.status.pending, (pending, before) => {if (before && !pending && props.status.active && !props.status.errors) scheduleCollapse();});
watch(() => props.status.errors, errors => {if (errors) expand();});
onBeforeUnmount(() => {disposed = true;request++;clearTimeout(timer);});
defineExpose({open() {manual.value = true;expand();void start();}});
</script>
<style scoped>
.fr-manga-entry{box-sizing:border-box;position:fixed;right:76px;bottom:24px;width:320px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow-y:auto;font:13px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#263244;background:#fff;border:1px solid #e5e8ee;border-radius:16px;box-shadow:0 8px 32px #10182729;pointer-events:auto;padding:16px;z-index:2147483647;color-scheme:light}
.fr-manga-entry *{box-sizing:border-box}.fr-manga-entry header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.fr-manga-entry header>div{display:flex;align-items:center;gap:8px}.fr-manga-entry strong{font-size:15px}.fr-manga-entry header span{font-size:11px;color:#697589;background:#f2f4f8;border-radius:5px;padding:2px 5px}.fr-manga-entry p{margin:8px 0 12px}.fr-manga-entry h3{font-size:14px;margin:8px 0}.fr-manga-hint{font-size:12px;color:#667085}.fr-manga-entry button{font:inherit;cursor:pointer;border:0;background:transparent;color:inherit;border-radius:8px}.fr-manga-entry button:focus-visible,.fr-manga-entry select:focus-visible,.fr-manga-entry summary:focus-visible{outline:2px solid #dc315f;outline-offset:3px}.fr-manga-entry button:disabled{opacity:.55;cursor:default}.fr-manga-close{width:28px;height:28px;font-size:22px!important;color:#697589!important}.fr-manga-entry .fr-manga-primary{width:100%;min-height:38px;padding:8px 12px;background:#dc315f;color:#fff;font-weight:650}.fr-manga-later{display:block;margin:6px auto 0;padding:5px 12px}.fr-manga-options{margin-top:12px}.fr-manga-options summary{display:flex;justify-content:space-between;gap:10px;cursor:pointer;color:#697589;font-size:12px}.fr-manga-options label{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px}.fr-manga-options select{max-width:180px;min-width:145px;min-height:32px;border:1px solid #d8dee7;border-radius:7px;background:#fff;color:#263244;font:inherit;padding:4px 6px}.fr-manga-entry footer{border-top:1px solid #eef0f4;margin-top:12px;padding-top:8px;display:flex;justify-content:space-between}.fr-manga-entry footer button{font-size:12px;color:#697589;padding:3px 0}.fr-manga-state{display:flex;gap:8px;align-items:center;min-height:48px;padding-bottom:10px}.fr-manga-error{color:#a64009;font-size:12px}.fr-manga-spinner{flex:0 0 auto;width:16px;height:16px;border:2px solid #f4c8d5;border-top-color:#dc315f;border-radius:50%;animation:fr-manga-entry-spin .8s linear infinite}.fr-manga-entry.compact{width:auto;padding:0;border-radius:12px}.fr-manga-compact{display:flex;align-items:center;gap:9px;min-height:40px;padding:8px 12px!important}.fr-manga-icon{flex:0 0 auto;width:22px;height:22px;color:#dc315f}.fr-manga-done{font-size:16px;color:#15803d;font-weight:700}@keyframes fr-manga-entry-spin{to{transform:rotate(360deg)}}
.fr-manga-entry[data-animated=false] .fr-manga-spinner{animation:none}
@media(prefers-color-scheme:dark){.fr-manga-entry{color:#f1f3f8;background:#222731;border-color:#404858;color-scheme:dark}.fr-manga-entry header span{color:#bcc4d2;background:#333b49}.fr-manga-hint,.fr-manga-options summary,.fr-manga-entry footer button{color:#b0bacb}.fr-manga-options select{background:#303744;color:#f1f3f8;border-color:#536075}.fr-manga-entry footer{border-color:#404858}.fr-manga-error{color:#ffca9e}}
@media(max-width:600px){.fr-manga-entry{right:16px;bottom:16px}}@media(prefers-reduced-motion:reduce){.fr-manga-spinner{animation:none}}
</style>
