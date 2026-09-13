<!--
 * @file src/features/settings/ui/services/FreeTranslationSettings.vue
 * 文件职责：编辑免费翻译服务的启停、选择策略、邮箱与等待时间。
 * 主要内容：普通态展示服务启停、选择模式、顺序和邮箱；高级态仅显示等待时间与恢复说明。
 * 模块边界：只修改传入的配置，由设置页统一持久化；不请求翻译、不读取服务密钥或运行时健康状态。
 -->
<template>
  <div class="free-translation-settings" :class="{'is-advanced': advanced}" data-free-translation-settings>
    <template v-if="!advanced">
      <div class="mode-picker" role="radiogroup" :aria-label="translateLegacy('免费翻译选择模式')">
      <label class="mode-option" :class="{ 'is-selected': mode === 'balanced' }"><input type="radio" name="free-translation-mode" value="balanced" :checked="mode === 'balanced'" :aria-label="translateLegacy('自动均衡')" @change="setMode('balanced')" /><span>{{ translateLegacy('自动均衡') }}</span></label>
      <label class="mode-option" :class="{ 'is-selected': mode === 'sequential' }"><input type="radio" name="free-translation-mode" value="sequential" :checked="mode === 'sequential'" :aria-label="translateLegacy('优先顺序')" @change="setMode('sequential')" /><span>{{ translateLegacy('优先顺序') }}</span></label>
      </div>
      <p class="mode-help">{{ mode === 'balanced' ? translateLegacy('后台会根据响应速度、成功表现和近期错误自动分配服务机会。') : translateLegacy('列表越靠前越先尝试；可使用上下按钮调整顺序。') }}</p>
    </template>
    <ol v-if="!advanced" class="fallback-list" :aria-label="translateLegacy(mode === 'balanced' ? '免费翻译服务' : '免费翻译优先顺序')">
      <li v-for="provider in providers" :key="provider.id" :data-fallback-provider="provider.id" :class="{'is-disabled': !isEnabled(provider.id)}">
        <div class="provider-row">
          <span v-if="mode === 'sequential'" class="provider-position" aria-hidden="true">{{ isEnabled(provider.id) ? order.indexOf(provider.id) + 1 : '—' }}</span>
          <ServiceIcon :service="provider.id" :label="translateLegacy(provider.label)" size="small" />
          <div class="provider-copy"><strong>{{ translateLegacy(provider.label) }}</strong><span>{{ provider.description.startsWith('实验性') ? translateLegacy('实验候选') : translateLegacy(provider.official ? '官方公开 API' : '公开网页服务') }}</span></div>
          <div class="provider-actions">
            <button v-if="mode === 'sequential'" type="button" :disabled="!isEnabled(provider.id) || order.indexOf(provider.id) === 0" :aria-label="`${translateLegacy('上移')} ${translateLegacy(provider.label)}`" @click="move(provider.id, -1)">↑</button>
            <button v-if="mode === 'sequential'" type="button" :disabled="!isEnabled(provider.id) || order.indexOf(provider.id) === order.length - 1" :aria-label="`${translateLegacy('下移')} ${translateLegacy(provider.label)}`" @click="move(provider.id, 1)">↓</button>
            <el-switch :model-value="isEnabled(provider.id)" :disabled="toggleDisabled(provider.id)" :aria-label="`${translateLegacy('启用')} ${translateLegacy(provider.label)}`" @update:model-value="toggle(provider.id, Boolean($event))" />
          </div>
        </div>
        <p class="provider-description">{{ translateLegacy(provider.description) }}</p>
      </li>
    </ol>
    <p v-if="!advanced" class="fallback-footnote">{{ t('settings.services.library.keepOne') }}</p>
    <template v-if="!advanced">
      <div class="my-memory-advanced">
        <label class="compact-field"><span>{{ t('settings.services.library.memoryEmail') }}</span><el-input v-model="myMemoryEmailDraft" type="email" :placeholder="translateLegacy('不填写也可以使用')" aria-label="MyMemory 联系邮箱" :aria-invalid="myMemoryEmailInvalid" @change="commitMyMemoryEmail" /></label>
        <p v-if="myMemoryEmailInvalid" class="provider-note" role="status">{{ translateLegacy('请输入有效邮箱，或留空。') }}</p>
        <p>{{ translateLegacy('匿名每天 5,000 字符；提供有效邮箱后每天 50,000 字符。邮箱会随请求发送给 MyMemory。') }} <a href="https://mymemory.translated.net/doc/usagelimits.php" target="_blank" rel="noreferrer">{{ translateLegacy('官方额度说明') }}</a></p>
      </div>
    </template>
    <template v-if="advanced">
      <label class="compact-field"><span>{{ translateLegacy('每个服务最多等待（秒）') }}</span><el-input-number :model-value="config.freeTranslationTimeoutMs / 1000" :min="1" :max="15" :step="1" :aria-label="translateLegacy('每个服务最多等待（秒）')" @update:model-value="setDuration($event)" /></label>
      <p class="recovery-copy">{{ translateLegacy('网络问题通常几分钟后重试；限流按服务提示恢复；拦截可能需要几小时；日额度通常隔天恢复。') }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import type { Config } from '@/src/core/config/model'
import { FREE_TRANSLATION_PROVIDERS, normalizeFreeTranslationMode, normalizeFreeTranslationOrder, normalizeMyMemoryEmail } from '@/src/core/config/freeTranslation'
import { useUiI18n } from '@/src/ui/i18n'
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue'

type FreeTranslationMode = 'balanced' | 'sequential'
type FreeTranslationConfig = Config & {freeTranslationMode: FreeTranslationMode}
const props = defineProps<{config: Config; advanced?: boolean}>()
const advanced = computed(() => props.advanced === true)
const config = toRef(props, 'config')
const freeConfig = computed(() => config.value as FreeTranslationConfig)
const { t, translateLegacy } = useUiI18n()
const myMemoryEmailDraft = ref(config.value.myMemoryEmail)
const myMemoryEmailInvalid = computed(() => Boolean(myMemoryEmailDraft.value.trim() && !normalizeMyMemoryEmail(myMemoryEmailDraft.value)))
watch(() => config.value.myMemoryEmail, value => { myMemoryEmailDraft.value = value })
function commitMyMemoryEmail(): void { if (!myMemoryEmailInvalid.value) config.value.myMemoryEmail = normalizeMyMemoryEmail(myMemoryEmailDraft.value) }
const mode = computed<FreeTranslationMode>(() => normalizeFreeTranslationMode(freeConfig.value.freeTranslationMode) as FreeTranslationMode)
const order = computed(() => normalizeFreeTranslationOrder(config.value.freeTranslationOrder))
const providers = computed(() => mode.value === 'sequential' ? [...order.value.flatMap(id => FREE_TRANSLATION_PROVIDERS.filter(provider => provider.id === id)), ...FREE_TRANSLATION_PROVIDERS.filter(provider => !order.value.includes(provider.id))] : [...FREE_TRANSLATION_PROVIDERS])
function setMode(value: FreeTranslationMode): void { freeConfig.value.freeTranslationMode = normalizeFreeTranslationMode(value) as FreeTranslationMode }
function isEnabled(id: string): boolean { return order.value.includes(id) }
function toggleDisabled(id: string): boolean { return isEnabled(id) && order.value.length === 1 }
function toggle(id: string, enabled: boolean): void {
  if (!FREE_TRANSLATION_PROVIDERS.some(provider => provider.id === id) || enabled === isEnabled(id) || toggleDisabled(id)) return
  config.value.freeTranslationOrder = enabled ? [...order.value, id] : order.value.filter(value => value !== id)
}
function move(id: string, direction: -1 | 1): void {
  const current = order.value.indexOf(id), next = current + direction
  if (current < 0 || next < 0 || next >= order.value.length) return
  const reordered = [...order.value]; [reordered[current], reordered[next]] = [reordered[next], reordered[current]]; config.value.freeTranslationOrder = reordered
}
function setDuration(seconds: number | undefined): void { if (typeof seconds === 'number' && Number.isFinite(seconds)) config.value.freeTranslationTimeoutMs = Math.round(Math.min(15, Math.max(1, seconds)) * 1000) }
</script>

<style scoped>
.free-translation-settings { color: var(--el-text-color-primary); font-size: 12px; }
.fallback-intro, .fallback-footnote, .mode-help { margin: 10px 0; color: var(--el-text-color-secondary); line-height: 1.55; }
.mode-picker { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 4px; }
.mode-option { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 11px; border: 1px solid var(--el-border-color); border-radius: 7px; cursor: pointer; }
.mode-option.is-selected { border-color: var(--el-color-primary); color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.mode-option input { margin: 0; accent-color: var(--el-color-primary); }
.fallback-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 18px; margin: 10px 0; padding: 0; list-style: none; }
.fallback-list > li { min-width: 0; padding: 8px 0; border-bottom: 1px solid var(--el-border-color-lighter); background: var(--el-fill-color-blank); }
.fallback-list > li.is-disabled { background: var(--surface-soft, var(--el-fill-color-extra-light)); }
.provider-row { display: flex; align-items: center; gap: 10px; }
.provider-position { width: 14px; flex: 0 0 auto; color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; }
.provider-copy { display: flex; min-width: 0; flex: 1; flex-wrap: wrap; align-items: baseline; gap: 4px 9px; }
.provider-copy strong { font-size: 12px; overflow-wrap: anywhere; }
.provider-copy > span { color: var(--el-text-color-secondary); font-size: 10px; }
.provider-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 5px; }
.provider-actions button { width: 27px; height: 27px; padding: 0; border: 1px solid var(--el-border-color); border-radius: 7px; color: var(--el-text-color-regular); background: var(--el-fill-color-blank); cursor: pointer; }
.provider-actions button:disabled { opacity: .35; cursor: default; }
.provider-actions :deep(.el-switch) { margin-left: 5px; }
.allocation-note { color: var(--el-text-color-secondary); font-size: 11px; white-space: nowrap; }
.provider-description, .provider-note { margin: 5px 0 0 24px; color: var(--el-text-color-secondary); font-size: 11px; line-height: 1.45; }
.provider-note { color: var(--el-color-warning-dark-2); }
.my-memory-advanced { margin: 12px 0; padding-bottom: 10px; border-bottom: 1px solid var(--el-border-color-lighter); }
.my-memory-advanced p { margin: 7px 0 0; line-height: 1.55; font-size: 11px; }
.my-memory-advanced a { color: var(--el-color-primary); }
.compact-field { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 12px; }
.compact-field :deep(.el-input) { max-width: 360px; }
.recovery-copy { margin: 8px 0 0; color: var(--el-text-color-secondary); line-height: 1.5; }
@media (max-width: 1200px) {
  .fallback-list { grid-template-columns: 1fr; }
}
@media (max-width: 700px) {
  .provider-row { gap: 6px; align-items: flex-start; }
  .provider-copy { flex-direction: column; gap: 2px; }
  .provider-actions { gap: 3px; flex-wrap: wrap; justify-content: flex-end; }
  .provider-actions button { width: 24px; }
  .provider-description, .provider-note, .my-memory-advanced { margin-left: 0; }
  .compact-field { flex-wrap: wrap; gap: 7px; }
  .compact-field :deep(.el-input) { max-width: none; }
}
</style>
