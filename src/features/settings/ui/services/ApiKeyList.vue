<!--
 * @file src/features/settings/ui/services/ApiKeyList.vue
 * 文件职责：编辑一个翻译服务的多 API Key 列表，并展示逐 Key 的连接检查状态。
 * 主要内容：每行一个密码输入、添加/移除、单行重测和全量检查摘要；组件只负责交互展示，通过事件把变更交给 ServiceConfiguration。
 * 模块边界：本组件不读写配置存储、不发起网络请求、不实现轮询或失败降权策略；配置同步与连接测试由父组件和后台负责。
 -->
<template>
  <section ref="root" class="api-key-list" data-api-key-list>
    <div class="api-key-heading">
      <div class="api-key-heading-title">
        <strong>{{ props.label || 'API Key' }}</strong>
        <span v-if="eligible.length > 1" class="api-key-mode">{{ t('settings.services.keys.rotation') }}</span>
      </div>
      <slot name="policy" />
    </div>
    <p class="api-key-help">{{ t('settings.services.keys.help') }}</p>
    <div class="api-key-rows">
      <div v-for="(key, index) in keys" :key="index" class="api-key-row" :data-api-key-index="index">
        <div class="api-key-entry">
          <span class="api-key-number" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
          <el-input
            :model-value="key" type="password" show-password autocomplete="off" :spellcheck="false"
            :aria-label="t('settings.services.keys.rowLabel', {number: index + 1})"
            :placeholder="t('settings.services.keys.placeholder')"
            :aria-invalid="duplicateApiKeyIndex(keys, index) !== null"
            @update:model-value="emit('update', index, String($event))"
          />
          <button
            type="button" class="api-key-remove" :disabled="keys.length <= 1 && !key"
            :aria-label="t('settings.services.keys.remove', {number: index + 1})"
            :title="t('settings.services.keys.remove', {number: index + 1})"
            @click="emit('remove', index)"
          ><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg></button>
        </div>
        <div class="api-key-row-footer">
          <span v-if="duplicateApiKeyIndex(keys, index) !== null" class="api-key-state is-duplicate" role="status">
            {{ t('settings.services.keys.duplicate', {number: duplicateApiKeyIndex(keys, index)! + 1}) }}
          </span>
          <span v-else-if="states[index]?.status === 'checking'" class="api-key-state is-checking" role="status">
            <span class="api-key-spinner" />{{ t('settings.services.keys.checking') }}
          </span>
          <span v-else-if="states[index]?.status === 'success'" class="api-key-state is-success" role="status">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>
            {{ t('settings.services.keys.passed') }}<span v-if="states[index].durationMs !== undefined" class="api-key-duration">{{ states[index].durationMs }} ms</span>
          </span>
          <span v-else-if="states[index]?.status === 'error'" class="api-key-state is-error" role="status">{{ t('settings.services.keys.failed') }}</span>
          <span v-else class="api-key-state is-idle">{{ !key.trim() ? t('settings.services.keys.empty') : states[index]?.status === 'queued' ? t('settings.services.keys.queued') : t('settings.services.keys.unchecked') }}</span>
          <button
            v-if="key.trim() && duplicateApiKeyIndex(keys, index) === null"
            type="button" class="api-key-retest" :disabled="busy"
            :aria-label="t('settings.services.keys.checkRow', {number: index + 1})"
            @click="emit('test', index)"
          >{{ t(states[index]?.status === 'success' || states[index]?.status === 'error' ? 'settings.services.keys.recheck' : 'settings.services.keys.check') }}</button>
        </div>
        <p v-if="states[index]?.status === 'error' && states[index]?.error" class="api-key-error">{{ states[index].error }}</p>
      </div>
    </div>
    <div class="api-key-list-footer">
      <button type="button" class="api-key-add" data-api-key-add @click="addKey">
        <span aria-hidden="true">+</span>{{ t('settings.services.keys.add') }}
      </button>
      <span v-if="busy" class="api-key-progress" role="status">{{ t('settings.services.keys.progress', {done: checked, total: eligible.length}) }}
        <button type="button" class="api-key-stop" @click="emit('stop')">{{ t('settings.services.keys.stop') }}</button>
      </span>
      <span v-else-if="summary" class="api-key-summary" :class="`is-${summary.kind}`" role="status" aria-live="polite" data-api-key-summary>
        {{ t('settings.services.keys.summary', {passed: summary.passed, failed: summary.failed}) }}
      </span>
    </div>
    <details v-if="eligible.length > 1" class="api-key-explanation">
      <summary>{{ t('settings.services.keys.how') }}</summary>
      <p>{{ t('settings.services.keys.behavior') }}</p>
    </details>
  </section>
</template>

<script setup lang="ts">
import {computed, nextTick, ref} from 'vue'
import {useUiI18n} from '@/src/ui/i18n'
import {duplicateApiKeyIndex, eligibleApiKeyIndexes, type ApiKeyCheckState, type ApiKeySummary} from './apiKeyTypes'
const props = defineProps<{keys: string[]; states: Record<number, ApiKeyCheckState>; summary: ApiKeySummary | null; busy: boolean; label?: string}>()
const emit = defineEmits<{add: []; update: [index: number, value: string]; remove: [index: number]; test: [index: number]; stop: []}>()
const {t} = useUiI18n()
const root = ref<HTMLElement>()
const eligible = computed(() => eligibleApiKeyIndexes(props.keys))
const checked = computed(() => Object.values(props.states).filter(state => state.status === 'success' || state.status === 'error').length)
async function addKey(): Promise<void> {
  const empty = props.keys.findIndex(key => !key.trim())
  if (empty < 0) emit('add')
  await nextTick()
  root.value?.querySelectorAll('input')[empty < 0 ? props.keys.length - 1 : empty]?.focus()
}
</script>

<style scoped>
.api-key-list { min-width: 0; padding: 20px 0 8px; color: var(--ink, #263044); }
.api-key-heading, .api-key-heading-title, .api-key-entry, .api-key-row-footer, .api-key-list-footer { display: flex; align-items: center; gap: 12px; }
.api-key-heading, .api-key-row-footer { justify-content: space-between; }
.api-key-heading-title strong { font-size: 13px; font-weight: 650; }
.api-key-mode { padding: 3px 7px; border-radius: 5px; background: var(--brand-soft, #fff1f5); color: var(--brand-strong, #bd3159); font-size: 10px; }
.api-key-help { margin: 6px 0 14px; color: var(--muted, #747d8e); font-size: 11px; line-height: 1.6; }
.api-key-rows { display: grid; gap: 10px; }
.api-key-row { border: 1px solid var(--line, #e3e7ee); border-radius: 10px; background: var(--surface, #fff); padding: 10px 12px 8px; min-width: 0; }
.api-key-number { flex: 0 0 20px; color: var(--muted, #747d8e); font-size: 11px; font-variant-numeric: tabular-nums; }
.api-key-entry :deep(.el-input) { width: 100% !important; max-width: none !important; min-width: 0; flex: 1; }
.api-key-entry :deep(.el-input__wrapper) { min-height: 32px; border-radius: 6px; }
.api-key-remove { display: inline-flex; justify-content: center; align-items: center; flex: 0 0 26px; width: 26px; height: 28px; padding: 4px; border: 0; background: transparent; color: var(--muted, #747d8e); cursor: pointer; border-radius: 5px; }
.api-key-remove:hover:not(:disabled) { background: var(--brand-soft, #fff1f5); color: var(--brand-strong, #bd3159); }
.api-key-remove:disabled { opacity: .3; cursor: default; }
.api-key-remove svg, .api-key-state svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.api-key-row-footer { padding-left: 32px; margin-top: 6px; min-height: 22px; gap: 8px; }
.api-key-state { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; color: var(--muted, #747d8e); font-size: 10px; line-height: 1.5; }
.api-key-state.is-success { color: var(--el-color-success, #278464); }
.api-key-state.is-error, .api-key-state.is-duplicate { color: var(--el-color-danger, #cf4566); }
.api-key-duration { margin-left: 4px; color: var(--muted, #747d8e); font-variant-numeric: tabular-nums; }
.api-key-retest, .api-key-stop { flex: 0 0 auto; border: 0; padding: 2px 0; background: transparent; color: var(--brand-strong, #bd3159); font-size: 11px; cursor: pointer; }
.api-key-retest:disabled { opacity: .45; cursor: default; }
.api-key-error { margin: 5px 0 1px 32px; color: var(--el-color-danger, #cf4566); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.api-key-list-footer { justify-content: space-between; flex-wrap: wrap; margin-top: 12px; }
.api-key-add { display: inline-flex; align-items: center; gap: 6px; padding: 7px 10px; border: 1px solid var(--line, #e3e7ee); border-radius: 7px; background: var(--surface, #fff); color: var(--brand-strong, #bd3159); font-size: 11px; cursor: pointer; }
.api-key-add:hover { border-color: var(--brand-strong, #bd3159); }
.api-key-add span { font-size: 16px; line-height: 1; }
.api-key-summary, .api-key-progress { color: var(--muted, #747d8e); font-size: 11px; line-height: 1.6; }
.api-key-progress { display: inline-flex; align-items: center; gap: 10px; }
.api-key-explanation { margin-top: 12px; color: var(--muted, #747d8e); font-size: 10px; line-height: 1.7; }
.api-key-explanation summary { cursor: pointer; }
.api-key-explanation p { margin: 6px 0 0; max-width: 70ch; }
.api-key-spinner { width: 10px; height: 10px; border: 1.5px solid var(--line, #e3e7ee); border-top-color: currentColor; border-radius: 50%; animation: api-key-spin 1s linear infinite; }
@keyframes api-key-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .api-key-spinner { animation: none; } }
@media (max-width: 560px) { .api-key-heading { align-items: flex-start; flex-direction: column; gap: 8px; } .api-key-row { padding: 9px; } .api-key-entry { gap: 8px; } .api-key-row-footer { padding-left: 28px; } .api-key-error { margin-left: 28px; } }
</style>
