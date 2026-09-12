<!--
 * @file src/features/settings/ui/services/ApiKeyList.vue
 * 文件职责：集中管理同一服务的 API Key 输入、逐项连接结果及检查操作。
 * 主要内容：使用对齐列表展示密钥和检查状态，提供就近的批量检查/停止、单项重测、可展开失败原因及连续添加；支持窄屏和键盘操作。
 * 模块边界：仅管理局部展示状态，通过事件交给父组件保存配置和执行检查；不发起网络请求，不把一次检查结果解释为实时健康权重。
 -->
<template>
  <section ref="root" class="api-key-list" data-api-key-list :data-api-key-busy="busy">
    <header class="api-key-heading">
      <div class="api-key-heading-copy">
        <div class="api-key-heading-title">
          <strong>{{ props.label || 'API Key' }}</strong>
          <span v-if="eligible.length" class="api-key-count">{{ t('settings.services.keys.count', {count: eligible.length}) }}</span>
        </div>
        <p class="api-key-help">{{ t(props.allowMultiple ? 'settings.services.keys.help' : 'settings.services.keys.singleHelp') }}</p>
      </div>
      <button
        type="button" class="api-key-check-all" :class="{'api-key-stop': busy}" data-connection-test-button
        :disabled="!busy && !eligible.length && !allowAnonymous"
        @click="busy ? emit('stop') : emit('testAll')"
      >
        <svg v-if="busy" viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="5" width="10" height="10" rx="1" /></svg>
        <svg v-else viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>
        {{ t(busy ? 'settings.services.keys.stop' : eligible.length > 1 ? 'settings.services.keys.checkAll' : 'settings.services.keys.checkConnection') }}
      </button>
    </header>
    <div class="api-key-overview" aria-live="polite">
      <span v-if="busy" class="api-key-progress" role="status">
        <span class="api-key-spinner" />
        {{ checkingIndex >= 0 ? t('settings.services.keys.checkingRow', {number: checkingIndex + 1}) : t('settings.services.keys.checking') }}
        <span v-if="checkMode === 'all'" class="api-key-progress-count">{{ checked }} / {{ eligible.length }}</span>
      </span>
      <span v-else-if="summary" class="api-key-summary" :class="`is-${summary.kind}`" role="status" data-api-key-summary>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path v-if="summary.failed === 0" d="m4 10 4 4 8-8" /><template v-else><circle cx="10" cy="10" r="7" /><path d="M10 6v5m0 3h.01" /></template></svg>
        {{ t('settings.services.keys.summary', {passed: summary.passed, failed: summary.failed}) }}
      </span>
      <span v-else class="api-key-check-hint">{{ t('settings.services.keys.checkHint') }}</span>
    </div>
    <div class="api-key-columns" aria-hidden="true">
      <span>{{ t('settings.services.keys.credentialColumn') }}</span>
      <span>{{ t('settings.services.keys.statusColumn') }}</span>
    </div>
    <div class="api-key-rows">
      <div v-for="(key, index) in keys" :key="index" class="api-key-row" :data-api-key-index="index" :class="{'is-checking-row': states[index]?.status === 'checking'}">
        <label class="api-key-number" :for="`${id}-input-${index}`">Key {{ index + 1 }}</label>
        <div class="api-key-entry">
          <el-input
            :id="`${id}-input-${index}`" :model-value="key" type="password" show-password autocomplete="off" :spellcheck="false"
            :aria-label="t('settings.services.keys.rowLabel', {number: index + 1})"
            :placeholder="t('settings.services.keys.placeholder')"
            :aria-invalid="duplicateApiKeyIndex(keys, index) !== null"
            @update:model-value="emit('update', index, String($event))"
          />
        </div>
        <div class="api-key-row-status">
          <span v-if="duplicateApiKeyIndex(keys, index) !== null" class="api-key-state is-duplicate" role="status">
            {{ t('settings.services.keys.duplicate', {number: duplicateApiKeyIndex(keys, index)! + 1}) }}
          </span>
          <span v-else-if="states[index]?.status === 'checking'" class="api-key-state is-checking" role="status">
            <span class="api-key-spinner" />{{ t('settings.services.keys.checking') }}
          </span>
          <span v-else-if="states[index]?.status === 'success'" class="api-key-state is-success" role="status">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>
            {{ t('settings.services.keys.passed') }}
            <span v-if="states[index].durationMs !== undefined" class="api-key-duration">{{ states[index].durationMs }} ms</span>
          </span>
          <button v-else-if="states[index]?.status === 'error'" type="button" class="api-key-state is-error api-key-error-toggle"
            :aria-expanded="expandedErrors.has(index)" :aria-controls="`${id}-error-${index}`"
            :title="t('settings.services.keys.failureDetails')" @click="toggleError(index)">
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M10 6v5m0 3h.01" /></svg>
            {{ t('settings.services.keys.failed') }}
            <svg class="api-key-chevron" :class="{'is-expanded': expandedErrors.has(index)}" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
          </button>
          <span v-else-if="key.trim()" class="api-key-state is-idle">
            <span class="api-key-idle-dot" />{{ t(states[index]?.status === 'queued' ? 'settings.services.keys.queued' : 'settings.services.keys.unchecked') }}
          </span>
        </div>
        <div class="api-key-row-actions">
          <button v-if="key.trim() && duplicateApiKeyIndex(keys, index) === null" type="button" class="api-key-icon-button api-key-retest" :disabled="busy"
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
        <p v-if="states[index]?.status === 'error' && expandedErrors.has(index)" :id="`${id}-error-${index}`" class="api-key-error" role="status">{{ states[index].error || t('settings.services.keys.failed') }}</p>
      </div>
    </div>
    <footer class="api-key-list-footer">
      <button v-if="props.allowMultiple" type="button" class="api-key-add" data-api-key-add @click="addKey">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>{{ t('settings.services.keys.add') }}
      </button>
      <details v-if="props.allowMultiple && eligible.length > 1" class="api-key-explanation">
        <summary :title="t('settings.services.keys.rotationNote')"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h11l-3-3M16 14H5l3 3M4 6v3m12 5v-3" /></svg>{{ t('settings.services.keys.rotation') }}</summary>
        <p>{{ t('settings.services.keys.behavior') }}</p>
      </details>
    </footer>
  </section>
</template>

<script setup lang="ts">
import {computed, nextTick, ref, useId, watch} from 'vue'
import {useUiI18n} from '@/src/ui/i18n'
import {duplicateApiKeyIndex, eligibleApiKeyIndexes, type ApiKeyCheckState, type ApiKeySummary} from './apiKeyTypes'
const props = defineProps<{keys: string[]; states: Record<number, ApiKeyCheckState>; summary: ApiKeySummary | null; busy: boolean; label?: string; allowAnonymous?: boolean; allowMultiple?: boolean; checkMode?: 'single' | 'all'}>()
const emit = defineEmits<{add: []; update: [index: number, value: string]; remove: [index: number]; test: [index: number]; testAll: []; stop: []}>()
const {t} = useUiI18n()
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
  const input = root.value?.querySelectorAll('input')[empty < 0 ? props.keys.length - 1 : empty]
  input?.focus({preventScroll: true})
  input?.scrollIntoView({block: 'nearest', inline: 'nearest'})
}
</script>

<style scoped>
.api-key-list { --key-success: #247454; --key-error: #b33d51; container-type: inline-size; min-width: 0; margin: 24px 0 8px; border: 1px solid var(--line, #e3e7ee); border-radius: 12px; background: var(--surface, #fff); color: var(--ink, #263044); }
.api-key-list svg { width: 16px; height: 16px; flex-shrink: 0; fill: none; stroke: currentColor; stroke-width: 1.65; stroke-linecap: round; stroke-linejoin: round; }
.api-key-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 18px 20px 12px; }
.api-key-heading-copy { min-width: 0; }
.api-key-heading-title { display: flex; align-items: center; gap: 10px; }
.api-key-heading-title strong { font-size: 15px; font-weight: 650; letter-spacing: -.01em; }
.api-key-count { padding: 2px 7px; border-radius: 5px; background: var(--surface-soft, #f5f6fa); color: var(--muted, #737d90); font-size: 11px; }
.api-key-help { margin: 7px 0 0; color: var(--muted, #737d90); font-size: 12px; line-height: 1.6; }
.api-key-check-all { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 7px 12px; border: 1px solid transparent; border-radius: 7px; background: var(--brand, #ef4776); color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; transition: background .15s; }
.api-key-check-all:hover:not(:disabled) { background: #cf315e; }
.api-key-check-all:disabled { background: var(--surface-soft, #f5f6fa); color: var(--muted, #737d90); border-color: var(--line, #e3e7ee); cursor: default; opacity: .7; }
.api-key-check-all.api-key-stop { border-color: var(--line, #e3e7ee); background: var(--surface, #fff); color: var(--ink, #263044); }
.api-key-check-all.api-key-stop:hover { background: var(--surface-soft, #f5f6fa); }
.api-key-overview { display: flex; align-items: center; min-height: 28px; padding: 0 20px 12px; font-size: 11px; color: var(--muted, #737d90); line-height: 1.6; }
.api-key-summary, .api-key-progress { display: inline-flex; align-items: center; gap: 7px; }
.api-key-summary.is-success { color: var(--key-success); }
.api-key-summary.is-partial, .api-key-summary.is-error { color: var(--key-error); }
.api-key-progress { color: var(--brand-strong, #bd3159); }
.api-key-progress-count { margin-left: 4px; color: var(--muted, #737d90); font-variant-numeric: tabular-nums; }
.api-key-columns { display: grid; grid-template-columns: minmax(0, 1fr) 126px 68px; gap: 12px; padding: 8px 20px; border-block: 1px solid var(--line, #e3e7ee); background: var(--surface-soft, #f7f8fb); color: var(--muted, #737d90); font-size: 10px; }
.api-key-rows { min-width: 0; }
.api-key-row { display: grid; grid-template-columns: 44px minmax(0, 1fr) 126px 68px; align-items: center; gap: 10px 12px; min-width: 0; padding: 12px 20px; transition: background .15s; }
.api-key-row + .api-key-row { border-top: 1px solid var(--line, #e3e7ee); }
.api-key-row.is-checking-row { background: var(--brand-soft, #fff1f5); }
.api-key-number { color: var(--muted, #737d90); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.api-key-entry { min-width: 0; }
.api-key-entry :deep(.el-input) { width: 100% !important; max-width: none !important; min-width: 0; }
.api-key-entry :deep(.el-input__wrapper) { min-height: 34px; padding-inline: 10px; border-radius: 6px; background: var(--surface-soft, #f7f8fb); box-shadow: inset 0 0 0 1px transparent; }
.api-key-entry :deep(.el-input__wrapper:hover) { box-shadow: inset 0 0 0 1px var(--line, #e3e7ee); }
.api-key-entry :deep(.el-input__wrapper.is-focus) { background: var(--surface, #fff); box-shadow: inset 0 0 0 1px var(--brand, #ef4776); }
.api-key-entry :deep(.el-input__inner) { font-size: 12px; letter-spacing: .05em; }
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
.api-key-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; flex: 0 0 30px; border: 0; border-radius: 6px; padding: 6px; background: transparent; color: var(--muted, #737d90); cursor: pointer; }
.api-key-icon-button:hover:not(:disabled) { background: var(--surface-soft, #f7f8fb); color: var(--ink, #263044); }
.api-key-remove:hover:not(:disabled) { color: var(--key-error); }
.api-key-icon-button:disabled { opacity: .3; cursor: default; }
.api-key-error { grid-column: 2 / -1; margin: -2px 0 0; padding: 9px 12px; border-radius: 6px; color: var(--key-error); background: color-mix(in srgb, var(--key-error) 6%, transparent); font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; }
.api-key-list-footer { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--line, #e3e7ee); border-radius: 0 0 12px 12px; background: var(--surface, #fff); }
.api-key-add { display: inline-flex; align-items: center; flex: 0 0 auto; gap: 6px; min-height: 32px; border: 0; border-radius: 6px; padding: 6px 8px; background: transparent; color: var(--brand-strong, #bd3159); font-size: 12px; font-weight: 550; cursor: pointer; }
.api-key-add:hover { background: var(--brand-soft, #fff1f5); }
.api-key-explanation { min-width: 0; max-width: 68%; color: var(--muted, #737d90); font-size: 11px; line-height: 1.7; }
.api-key-explanation summary { display: flex; align-items: center; justify-content: flex-end; gap: 5px; min-height: 32px; cursor: pointer; list-style: none; }
.api-key-explanation summary::-webkit-details-marker { display: none; }
.api-key-explanation summary:hover { color: var(--ink, #263044); }
.api-key-explanation p { margin: 5px 0; max-width: 64ch; }
.api-key-spinner { flex: 0 0 12px; width: 12px; height: 12px; border: 1.5px solid var(--line, #e3e7ee); border-top-color: currentColor; border-radius: 50%; animation: api-key-spin .9s linear infinite; }
:global(:root.dark .api-key-list) { --key-success: #84d4ae; --key-error: #f3a0ad; }
@keyframes api-key-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .api-key-spinner { animation: none; } }
@container (max-width: 720px) and (min-width: 561px) { .api-key-row { grid-template-columns: 38px minmax(0, 1fr) 100px 60px; gap: 8px; padding-inline: 14px; } .api-key-columns { grid-template-columns: minmax(0, 1fr) 100px 60px; gap: 8px; padding-inline: 14px; } .api-key-duration { flex-basis: 100%; margin-left: 21px; } }
@container (max-width: 560px) {
  .api-key-heading { align-items: flex-start; flex-wrap: wrap; padding: 16px 12px 10px; gap: 12px; }
  .api-key-heading-title { flex-wrap: wrap; gap: 7px; }
  .api-key-help { font-size: 11px; }
  .api-key-overview { padding-inline: 12px; }
  .api-key-columns { display: none; }
  .api-key-row { grid-template-columns: 38px minmax(0, 1fr) 28px; gap: 6px 8px; padding: 12px; }
  .api-key-number { grid-column: 1; grid-row: 1; }
  .api-key-entry { grid-column: 2; grid-row: 1; }
  .api-key-row-status { grid-column: 2; grid-row: 2; }
  .api-key-row-actions { grid-column: 3; grid-row: 1 / 3; flex-direction: column; gap: 3px; }
  .api-key-icon-button { width: 28px; height: 28px; flex-basis: 28px; }
  .api-key-remove { order: -1; }
  .api-key-error { grid-column: 1 / -1; margin-top: 2px; }
  .api-key-list-footer { padding-inline: 8px; }
}
</style>
