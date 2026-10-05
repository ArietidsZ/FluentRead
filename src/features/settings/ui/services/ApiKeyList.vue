<!--
 * @file src/features/settings/ui/services/ApiKeyList.vue
 * 文件职责：集中管理同一服务的 API Key 输入、逐项连接结果及检查操作。
 * 主要内容：以密钥输入为主展示对齐列表与逐项结果，由服务标题栏检查或停止；输入下方直接添加密钥并容纳条件出现的使用方式与密钥要求，保留单项重测、失败详情、窄屏与键盘操作。
 * 模块边界：仅管理局部展示状态，通过事件交给父组件保存配置和执行检查；不发起网络请求，不把一次检查结果解释为实时健康权重。
 -->
<template>
  <section ref="root" class="api-key-list" :class="{ 'is-single': !props.allowMultiple }" data-api-key-list :data-api-key-busy="busy">
    <header class="api-key-heading">
      <strong>{{ props.label || 'API Key' }}</strong><slot name="help" />
    </header>
    <div v-if="props.allowMultiple && (busy || summary)" class="api-key-overview" aria-live="polite">
      <span v-if="busy" class="api-key-progress" role="status">
        <span class="api-key-spinner" />
        {{ checkingIndex >= 0 ? t('settings.services.keys.checkingRow', {number: checkingIndex + 1}) : t('settings.services.keys.checking') }}
        <span v-if="checkMode === 'all' && eligible.length" class="api-key-progress-count">{{ checked }} / {{ eligible.length }}</span>
      </span>
      <span v-else-if="summary" class="api-key-summary" :class="`is-${summary.kind}`" role="status" data-api-key-summary>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path v-if="summary.failed === 0" d="m4 10 4 4 8-8" /><template v-else><circle cx="10" cy="10" r="7" /><path d="M10 6v5m0 3h.01" /></template></svg>
        {{ t('settings.services.keys.summary', {passed: summary.passed, failed: summary.failed}) }}
      </span>
    </div>
    <div class="api-key-rows">
      <div v-for="(key, index) in keys" :key="index" class="api-key-row" :data-api-key-index="index" :class="{'is-checking-row': rowStates[index]?.status === 'checking', 'is-single-row': !props.allowMultiple}">
        <label class="api-key-number" :for="`${id}-input-${index}`">Key {{ index + 1 }}</label>
        <div class="api-key-entry">
          <el-input
            :id="`${id}-input-${index}`" :model-value="key" type="password" show-password autocomplete="off" :spellcheck="false"
            :aria-label="t('settings.services.keys.rowLabel', {number: index + 1})"
            :placeholder="props.placeholder || t('settings.services.keys.placeholder')"
            :aria-invalid="duplicateApiKeyIndex(keys, index) !== null"
            @update:model-value="emit('update', index, String($event))"
          ><template v-if="props.allowMultiple" #prefix><span class="api-key-prefix">{{ index + 1 }}</span></template></el-input>
        </div>
        <div class="api-key-row-status">
          <span v-if="duplicateApiKeyIndex(keys, index) !== null" class="api-key-state is-duplicate" role="status">
            {{ t('settings.services.keys.duplicate', {number: duplicateApiKeyIndex(keys, index)! + 1}) }}
          </span>
          <span v-else-if="rowStates[index]?.status === 'checking'" class="api-key-state is-checking" role="status">
            <span class="api-key-spinner" />{{ t('settings.services.keys.checking') }}
          </span>
          <span v-else-if="rowStates[index]?.status === 'success'" class="api-key-state is-success" role="status">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>
            {{ t('settings.services.keys.passed') }}
            <span v-if="rowStates[index].durationMs !== undefined" class="api-key-duration">{{ rowStates[index].durationMs }} ms</span>
          </span>
          <button v-else-if="rowStates[index]?.status === 'error'" type="button" class="api-key-state is-error api-key-error-toggle"
            :aria-expanded="expandedErrors.has(index)" :aria-controls="`${id}-error-${index}`"
            :title="t('settings.services.keys.failureDetails')" @click="toggleError(index)">
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M10 6v5m0 3h.01" /></svg>
            {{ t('settings.services.keys.failed') }}
            <svg class="api-key-chevron" :class="{'is-expanded': expandedErrors.has(index)}" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
          </button>
          <span v-else-if="key.trim()" class="api-key-state is-idle">
            <span class="api-key-idle-dot" />{{ t(rowStates[index]?.status === 'queued' ? 'settings.services.keys.queued' : 'settings.services.keys.unchecked') }}
          </span>
        </div>
        <div v-if="props.allowMultiple" class="api-key-row-actions">
          <button v-if="key.trim() && duplicateApiKeyIndex(keys, index) === null" type="button" class="api-key-icon-button api-key-retest" :class="{'is-retry': rowStates[index]?.status === 'error'}" :disabled="busy"
            data-api-key-retry
            :aria-label="t('settings.services.keys.checkRow', {number: index + 1})"
            :title="t('settings.services.keys.checkRow', {number: index + 1})" @click="emit('test', index)">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 7a6.5 6.5 0 1 0 .2 5M16 3v4h-4" /></svg>
          </button>
          <button type="button" class="api-key-icon-button api-key-remove" :disabled="keys.length <= 1 && !key"
            :aria-label="t('settings.services.keys.remove', {number: index + 1})"
            :title="t('settings.services.keys.remove', {number: index + 1})" @click="emit('remove', index)">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h12M8 5V3h4v2M6 5l.7 12h6.6L14 5M8.5 8v6m3-6v6" /></svg>
          </button>
        </div>
        <p v-if="rowStates[index]?.status === 'error' && expandedErrors.has(index)" :id="`${id}-error-${index}`" class="api-key-error" role="status">{{ rowStates[index].error || t('settings.services.keys.failed') }}</p>
      </div>
    </div>
    <footer class="api-key-list-footer">
      <button type="button" class="api-key-add" data-api-key-add @click="addKey">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>{{ t('settings.services.keys.addKey') }}
      </button>
      <div v-if="$slots.tools" class="api-key-tools"><slot name="tools" /></div>
    </footer>
  </section>
</template>

<script setup lang="ts">
import {computed, nextTick, ref, useId, watch} from 'vue'
import {useUiI18n} from '@/src/ui/i18n'
import {duplicateApiKeyIndex, eligibleApiKeyIndexes, type ApiKeyCheckState, type ApiKeySummary} from './apiKeyTypes'
const props = defineProps<{keys: string[]; states: Record<number, ApiKeyCheckState>; summary: ApiKeySummary | null; busy: boolean; label?: string; placeholder?: string; connectionState?: ApiKeyCheckState; allowMultiple?: boolean; checkMode?: 'single' | 'all'}>()
const emit = defineEmits<{add: []; update: [index: number, value: string]; remove: [index: number]; test: [index: number]; }>()
const {t} = useUiI18n()
const rowStates = computed(() => Object.keys(props.states).length ? props.states : props.connectionState ? {0: props.connectionState} : {})
const id = useId()
const root = ref<HTMLElement>()
const expandedErrors = ref(new Set<number>())
const eligible = computed(() => eligibleApiKeyIndexes(props.keys))
const checked = computed(() => Object.values(props.states).filter(state => state.status === 'success' || state.status === 'error').length)
const checkingIndex = computed(() => props.keys.findIndex((_, index) => props.states[index]?.status === 'checking'))
watch(() => props.keys, () => { expandedErrors.value = new Set() })
function toggleError(index: number): void {
  const next = new Set(expandedErrors.value)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  expandedErrors.value = next
}
async function addKey(): Promise<void> {
  const empty = props.keys.findIndex(key => !key.trim())
  if (empty < 0) emit('add')
  await nextTick()
  const nextEmpty = props.keys.findIndex(key => !key.trim())
  const input = root.value?.querySelectorAll<HTMLInputElement>('.api-key-entry input')[nextEmpty < 0 ? props.keys.length - 1 : nextEmpty]
  input?.focus({preventScroll: true})
  input?.scrollIntoView({block: 'nearest', inline: 'nearest'})
}
</script>

<style scoped>
.api-key-list { --key-success: #247454; --key-error: #b33d51; display: grid; grid-template-columns: 140px minmax(0, 640px); gap: 8px 16px; min-width: 0; margin: 0; padding: 14px 0; border-top: 1px solid var(--line); color: var(--ink); }
.api-key-list svg { width: 16px; height: 16px; flex-shrink: 0; fill: none; stroke: currentColor; stroke-width: 1.65; stroke-linecap: round; stroke-linejoin: round; }
.api-key-heading { grid-column: 1; grid-row: 1; display: flex; align-items: center; align-self: start; gap: 3px; flex-wrap: wrap; min-height: 38px; min-width: 0; }
.api-key-heading strong { font-size: 13px; font-weight: 550; }
.api-key-overview { grid-column: 2; grid-row: 2; font-size: 11px; color: var(--muted); line-height: 1.6; }
.api-key-summary, .api-key-progress { display: inline-flex; align-items: center; gap: 7px; }
.api-key-summary.is-success { color: var(--key-success); }
.api-key-summary.is-partial, .api-key-summary.is-error { color: var(--key-error); }
.api-key-progress { color: var(--brand-strong); }
.api-key-progress-count { margin-left: 4px; color: var(--muted); font-variant-numeric: tabular-nums; }
.api-key-rows { grid-column: 2; grid-row: 1; min-width: 0; }
.api-key-row { display: grid; grid-template-columns: minmax(0, 1fr) 112px 68px; align-items: center; gap: 6px 10px; min-width: 0; padding: 0; }
.api-key-row + .api-key-row { padding-top: 10px; margin-top: 10px; }
.api-key-number { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.api-key-prefix { color: var(--muted); font-size: 11px; padding-right: 6px; border-right: 1px solid var(--line); font-variant-numeric: tabular-nums; }
.api-key-row.is-checking-row { background: transparent; }
.api-key-entry { width: 100%; max-width: 640px; min-width: 0; }
.api-key-entry :deep(.el-input) { width: 100% !important; max-width: none !important; min-width: 0; }
.api-key-entry :deep(.el-input__wrapper) { min-height: 38px; padding-inline: 11px; border-radius: 10px; background: var(--surface, #fff); box-shadow: inset 0 0 0 1px var(--line); }
.api-key-entry :deep(.el-input__wrapper:hover) { box-shadow: inset 0 0 0 1px var(--line, #e3e7ee); }
.api-key-entry :deep(.el-input__wrapper.is-focus) { background: var(--surface, #fff); box-shadow: inset 0 0 0 1px var(--brand, #ef4776); }
.api-key-entry :deep(.el-input__inner) { font-size: 13px; letter-spacing: .05em; }
.api-key-entry :deep(.el-input__inner::placeholder) { letter-spacing: 0; }
.api-key-row-status { min-width: 0; }
.api-key-state { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 5px; font-size: 11px; line-height: 1.6; color: var(--muted, #737d90); }
.api-key-state.is-success { color: var(--key-success); }
.api-key-state.is-error, .api-key-state.is-duplicate { color: var(--key-error); }
.api-key-state.is-checking { color: var(--brand-strong, #bd3159); }
.api-key-duration { margin-left: 1px; color: var(--muted, #737d90); font-size: 10px; font-variant-numeric: tabular-nums; }
.api-key-idle-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; opacity: .5; }
.api-key-error-toggle { border: 0; padding: 3px 0; background: transparent; text-align: left; cursor: pointer; }
.api-key-error-toggle:hover { text-decoration: underline; text-underline-offset: 3px; }
.api-key-list .api-key-chevron { width: 12px; height: 12px; transition: transform .15s; }
.api-key-chevron.is-expanded { transform: rotate(180deg); }
.api-key-row-actions { display: flex; justify-content: flex-end; gap: 4px; }
.api-key-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex: 0 0 32px; border: 1px solid transparent; border-radius: 8px; padding: 7px; background: transparent; color: var(--muted, #737d90); cursor: pointer; transition: background .15s, border-color .15s, color .15s; }
.api-key-icon-button:hover:not(:disabled) { background: var(--surface-soft, #f7f8fb); color: var(--ink, #263044); }
.api-key-icon-button:focus-visible, .api-key-add:focus-visible, .api-key-error-toggle:focus-visible { outline: 2px solid var(--brand, #ef4776); outline-offset: 2px; }
.api-key-icon-button.is-retry { color: var(--key-error); }
.api-key-remove:hover:not(:disabled) { color: var(--key-error); }
.api-key-icon-button:disabled { opacity: .3; cursor: default; }
.api-key-error { grid-column: 1 / -1; margin: -2px 0 0; padding: 9px 12px; border-radius: 6px; color: var(--key-error); background: color-mix(in srgb, var(--key-error) 6%, transparent); font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; }
.api-key-list-footer { grid-column: 2; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 12px; min-width: 0; }
.api-key-tools { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 6px 12px; min-width: 0; }
.api-key-add { display: inline-flex; align-items: center; flex: 0 0 auto; gap: 5px; min-height: 30px; border: 0; border-radius: 6px; padding: 4px 5px; background: transparent; color: var(--brand-strong, #bd3159); font-size: 12px; font-weight: 550; cursor: pointer; }
.api-key-add:hover { background: var(--brand-soft, #fff1f5); }
.api-key-spinner { flex: 0 0 12px; width: 12px; height: 12px; border: 1.5px solid var(--line, #e3e7ee); border-top-color: currentColor; border-radius: 50%; animation: api-key-spin .9s linear infinite; }
:global(:root.dark .api-key-list) { --key-success: #84d4ae; --key-error: #f3a0ad; }
@keyframes api-key-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .api-key-spinner { animation: none; } }
.is-single .api-key-row { display: flex; flex-direction: column; align-items: stretch; gap: 4px; }
.is-single .api-key-row-status:empty, .is-single .api-key-row-status:has(.api-key-state.is-idle) { display: none; }
@container (max-width: 760px) {
  .api-key-row { grid-template-columns: minmax(0, 1fr) 68px; }
  .api-key-entry { grid-column: 1; grid-row: 1; }
  .api-key-row-status { grid-column: 1; grid-row: 2; }
  .api-key-row-actions { grid-column: 2; grid-row: 1; }
}
@container (max-width: 600px) {
  .api-key-list { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .api-key-heading { grid-column: 1; grid-row: 1; min-height: 24px; }
  .api-key-rows { grid-column: 1; grid-row: 2; }
  .api-key-overview { grid-column: 1; grid-row: 3; }
  .api-key-list-footer { grid-column: 1; }
  .api-key-tools { justify-content: flex-start; }
}
</style>
