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
      <p class="mode-help">{{ mode === 'balanced' ? translateLegacy('从下方启用的免费接口中自动分配请求，失败时切换。') : translateLegacy('依次调用启用的免费接口；可使用上下按钮调整顺序。') }}</p>
      <section class="provider-section" :aria-label="translateLegacy(mode === 'sequential' ? '免费翻译优先顺序' : '常用候选')">
        <div v-if="isSequential" class="section-heading"><h3>{{ translateLegacy('服务优先顺序') }}</h3></div>
        <ol class="fallback-list" :class="{ 'is-sequential': isSequential }" :aria-label="translateLegacy(mode === 'balanced' ? '免费翻译服务' : '免费翻译优先顺序')">
          <li v-for="provider in commonProviders" :key="provider.id" :data-fallback-provider="provider.id" :title="translateLegacy(provider.description)" :class="{'is-disabled': !isEnabled(provider.id)}">
            <div class="provider-row">
              <span v-if="isSequential" class="provider-position" aria-hidden="true">{{ isEnabled(provider.id) ? order.indexOf(provider.id) + 1 : '—' }}</span>
              <ServiceIcon :service="provider.id" :label="translateLegacy(provider.label)" size="small" />
              <div class="provider-copy"><strong>{{ translateLegacy(provider.label) }}</strong></div>
              <div class="provider-actions">
                <button v-if="isSequential" type="button" :disabled="!isEnabled(provider.id) || order.indexOf(provider.id) === 0" :aria-label="`${translateLegacy('上移')} ${translateLegacy(provider.label)}`" :title="translateLegacy('上移')" @click="move(provider.id, -1)"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 9 4-4 4 4" /></svg></button>
                <button v-if="isSequential" type="button" :disabled="!isEnabled(provider.id) || order.indexOf(provider.id) === order.length - 1" :aria-label="`${translateLegacy('下移')} ${translateLegacy(provider.label)}`" :title="translateLegacy('下移')" @click="move(provider.id, 1)"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 7 4 4 4-4" /></svg></button>
                <el-switch :model-value="isEnabled(provider.id)" :disabled="toggleDisabled(provider.id)" :aria-label="`${translateLegacy('启用')} ${translateLegacy(provider.label)}`" @update:model-value="toggle(provider.id, Boolean($event))" />
              </div>
            </div>
            <p v-if="provider.id === 'myMemory' || provider.id === 'apertiumFree'" class="provider-description">{{ translateLegacy(provider.description) }}</p>
            <details v-if="provider.id === 'myMemory'" class="provider-settings">
              <summary><span>{{ translateLegacy('连接设置') }}</span><small v-if="config.myMemoryEmail">{{ translateLegacy('邮箱已配置') }}</small><svg class="details-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" /></svg></summary>
              <label class="compact-field"><span>{{ t('settings.services.library.memoryEmail') }}</span><el-input v-model="myMemoryEmailDraft" type="email" :placeholder="translateLegacy('不填写也可以使用')" aria-label="MyMemory 联系邮箱" :aria-invalid="myMemoryEmailInvalid" @change="commitMyMemoryEmail" /></label>
              <p v-if="myMemoryEmailInvalid" class="provider-note" role="status">{{ translateLegacy('请输入有效邮箱，或留空。') }}</p>
              <p>{{ translateLegacy('提供邮箱后可提升额度；邮箱会随请求发送给 MyMemory。') }} <a href="https://mymemory.translated.net/doc/usagelimits.php" target="_blank" rel="noreferrer">{{ translateLegacy('官方额度说明') }}</a></p>
            </details>
          </li>
        </ol>
      </section>
      <details v-if="mode === 'balanced'" class="experimental-section">
        <summary><span>{{ translateLegacy('实验候选') }}</span><small>{{ experimentalSummary }}</small><svg class="details-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" /></svg></summary>
        <p class="section-help">{{ translateLegacy('可能受访问验证、公共实例稳定性或语言范围影响；启用后会参与当前策略。') }}</p>
        <ol class="fallback-list" :class="{ 'is-sequential': isSequential }" :aria-label="translateLegacy('实验候选服务')">
          <li v-for="provider in experimentalProviders" :key="provider.id" :data-fallback-provider="provider.id" :title="translateLegacy(provider.description)" :class="{'is-disabled': !isEnabled(provider.id)}">
            <div class="provider-row">
              <span v-if="isSequential" class="provider-position" aria-hidden="true">{{ isEnabled(provider.id) ? order.indexOf(provider.id) + 1 : '—' }}</span>
              <ServiceIcon :service="provider.id" :label="translateLegacy(provider.label)" size="small" />
              <div class="provider-copy"><strong>{{ translateLegacy(provider.label) }}</strong></div>
              <div class="provider-actions">
                <button v-if="isSequential" type="button" :disabled="!isEnabled(provider.id) || order.indexOf(provider.id) === 0" :aria-label="`${translateLegacy('上移')} ${translateLegacy(provider.label)}`" :title="translateLegacy('上移')" @click="move(provider.id, -1)"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 9 4-4 4 4" /></svg></button>
                <button v-if="isSequential" type="button" :disabled="!isEnabled(provider.id) || order.indexOf(provider.id) === order.length - 1" :aria-label="`${translateLegacy('下移')} ${translateLegacy(provider.label)}`" :title="translateLegacy('下移')" @click="move(provider.id, 1)"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="m4 7 4 4 4-4" /></svg></button>
                <el-switch :model-value="isEnabled(provider.id)" :disabled="toggleDisabled(provider.id)" :aria-label="`${translateLegacy('启用')} ${translateLegacy(provider.label)}`" @update:model-value="toggle(provider.id, Boolean($event))" />
              </div>
            </div>
          </li>
        </ol>
      </details>
      <p class="fallback-footnote">{{ t('settings.services.library.keepOne') }}</p>
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
const isSequential = computed(() => mode.value === 'sequential')
const order = computed(() => normalizeFreeTranslationOrder(config.value.freeTranslationOrder))
const providers = computed(() => mode.value === 'sequential' ? [...order.value.flatMap(id => FREE_TRANSLATION_PROVIDERS.filter(provider => provider.id === id)), ...FREE_TRANSLATION_PROVIDERS.filter(provider => !order.value.includes(provider.id))] : [...FREE_TRANSLATION_PROVIDERS])
const commonProviders = computed(() => mode.value === 'sequential' ? providers.value : providers.value.filter(provider => !provider.description.startsWith('实验性')))
const experimentalProviders = computed(() => providers.value.filter(provider => provider.description.startsWith('实验性')))
const experimentalSummary = computed(() => {
  const enabled = experimentalProviders.value.filter(provider => isEnabled(provider.id)).map(provider => translateLegacy(provider.label))
  return enabled.length ? `${enabled.length} ${translateLegacy('项已启用')}：${enabled.join('、')}` : translateLegacy('默认关闭')
})
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
.free-translation-settings { container-type: inline-size; color: var(--el-text-color-primary); font-size: 12px; }
.fallback-intro, .fallback-footnote, .mode-help { margin: 10px 0; color: var(--el-text-color-secondary); line-height: 1.55; }
.mode-picker { max-width: 320px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin: 10px 0 3px; }
.mode-option { display: flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 9px; border: 1px solid var(--el-border-color); border-radius: 8px; background: var(--el-fill-color-blank); cursor: pointer; }
.mode-option.is-selected { border-color: var(--el-color-primary); color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.mode-option input { margin: 0; accent-color: var(--el-color-primary); }
.mode-help { margin-top: 7px; }
.provider-section { margin-top: 14px; }
.section-heading { display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px; }
.section-heading h3 { margin: 0; font-size: 13px; font-weight: 600; }
.section-heading p, .section-help { margin: 0; color: var(--el-text-color-secondary); font-size: 11px; line-height: 1.45; }
.fallback-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 6px; margin: 0; padding: 0; list-style: none; }
.fallback-list.is-sequential { grid-template-columns: repeat(2, minmax(220px, 1fr)); }
.fallback-list > li { min-width: 0; padding: 7px 8px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: var(--el-fill-color-blank); }
.fallback-list > li.is-disabled { background: var(--el-fill-color-extra-light); }
.experimental-section { margin-top: 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: var(--el-fill-color-blank); }
.experimental-section summary { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 9px 10px; color: var(--el-text-color-primary); cursor: pointer; list-style-position: inside; }
.experimental-section summary::marker { color: var(--el-text-color-secondary); }
.experimental-section summary small { margin-left: auto; min-width: 0; overflow: hidden; color: var(--el-text-color-secondary); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.experimental-section[open] summary { border-bottom: 1px solid var(--el-border-color-lighter); }
.experimental-section .section-help { padding: 8px 10px 0; }
.experimental-section .fallback-list { padding: 8px 10px 10px; }
.provider-row { display: flex; align-items: center; gap: 7px; }
.provider-position { width: 14px; flex: 0 0 auto; color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; }
.provider-copy { display: flex; min-width: 0; flex: 1; flex-wrap: wrap; align-items: baseline; gap: 4px 9px; }
.provider-copy strong { font-size: 12px; overflow-wrap: anywhere; }
.provider-copy > span { color: var(--el-text-color-secondary); font-size: 10px; }
.provider-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 5px; }
.provider-actions button { width: 26px; height: 26px; padding: 0; border: 1px solid var(--el-border-color); border-radius: 7px; color: var(--el-text-color-regular); background: var(--el-fill-color-blank); cursor: pointer; }
.provider-actions button svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; vertical-align: middle; }
.provider-actions button:disabled { opacity: .35; cursor: default; }
.provider-actions :deep(.el-switch) { margin-left: 5px; }
.allocation-note { color: var(--el-text-color-secondary); font-size: 11px; white-space: nowrap; }
.provider-description, .provider-note { margin: 4px 0 0 25px; color: var(--el-text-color-secondary); font-size: 10px; line-height: 1.4; }
.provider-note { color: var(--el-color-warning-dark-2); }
.provider-settings { margin: 6px 0 0 25px; border-top: 1px solid var(--el-border-color-lighter); }
.provider-settings summary { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 5px 0 0; color: var(--el-text-color-secondary); cursor: pointer; }
.provider-settings summary small { margin-left: auto; color: var(--el-color-success); font-size: 10px; }
.provider-settings p { margin: 6px 0 0; line-height: 1.45; font-size: 10px; color: var(--el-text-color-secondary); }
.provider-settings a { color: var(--el-color-primary); }
.provider-settings .compact-field { flex-direction: column; align-items: stretch; gap: 6px; }
.provider-settings .compact-field :deep(.el-input) { width: 100%; max-width: none; }
.details-chevron { width: 14px; height: 14px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
details[open] > summary > .details-chevron { transform: rotate(180deg); }
.provider-settings summary:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.compact-field { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 12px; }
.compact-field :deep(.el-input), .compact-field :deep(.el-input-number) { width: min(100%, 220px); max-width: 220px; }
.recovery-copy { margin: 8px 0 0; color: var(--el-text-color-secondary); line-height: 1.5; }
@media (max-width: 1200px) {
  .section-heading { align-items: flex-start; flex-direction: column; gap: 2px; }
}
@media (max-width: 700px) {
  .mode-picker { grid-template-columns: 1fr; }
  .provider-row { gap: 6px; align-items: flex-start; }
  .provider-copy { flex-direction: column; gap: 2px; }
  .provider-actions { gap: 3px; flex-wrap: wrap; justify-content: flex-end; }
  .provider-actions button { width: 24px; }
  .provider-description, .provider-note, .provider-settings { margin-left: 0; }
  .compact-field { flex-wrap: wrap; gap: 7px; }
  .compact-field :deep(.el-input), .compact-field :deep(.el-input-number) { width: 100%; max-width: none; }
  .experimental-section summary small { max-width: 58%; }
}
.mode-option:focus-within, .provider-actions button:focus-visible, .experimental-section summary:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.experimental-section summary small { white-space: normal; overflow: visible; text-overflow: clip; line-height: 1.6; }
@container (min-width: 720px) { .fallback-list:not(.is-sequential) { grid-template-columns: repeat(3, minmax(220px, 1fr)); } }
@container (max-width: 500px) { .fallback-list.is-sequential { grid-template-columns: 1fr; } }
</style>
