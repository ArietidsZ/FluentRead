<!--
 * @file src/features/settings/ui/services/FreeTranslationSettings.vue
 * 文件职责：编辑免费翻译的启用服务、尝试顺序与等待时间，并提供官方免费额度的连接设置。
 * 主要内容：呈现已启用与候选服务、排序和最少一路约束，仅显示无需密钥的接口，折叠可选邮箱与超时设置。
 * 模块边界：只修改传入的配置，由设置页统一持久化；不选择默认服务，不请求翻译、不读取服务密钥或代理地址。
 -->
<template>
  <div class="free-translation-settings" data-free-translation-settings>
    <p class="fallback-intro">按顺序尝试；遇到限流、超时或不可用时自动切换，失败的服务会暂时跳过。</p>
    <ol class="fallback-list" aria-label="免费翻译尝试顺序">
      <li v-for="provider in providers" :key="provider.id" :data-fallback-provider="provider.id" :class="{'is-disabled': !isEnabled(provider.id)}">
        <div class="provider-row">
          <span class="provider-position" aria-hidden="true">{{ isEnabled(provider.id) ? order.indexOf(provider.id) + 1 : '—' }}</span>
          <ServiceIcon :service="provider.id" :label="translateLegacy(provider.label)" size="small" />
          <div class="provider-copy">
            <strong>{{ translateLegacy(provider.label) }}</strong>
            <span>{{ provider.official ? '官方公开 API' : '非官方公开 API' }}</span>
          </div>
          <div class="provider-actions">
            <button type="button" :disabled="!isEnabled(provider.id) || order.indexOf(provider.id) === 0" :aria-label="`${translateLegacy('上移')} ${translateLegacy(provider.label)}`" @click="move(provider.id, -1)">↑</button>
            <button type="button" :disabled="!isEnabled(provider.id) || order.indexOf(provider.id) === order.length - 1" :aria-label="`${translateLegacy('下移')} ${translateLegacy(provider.label)}`" @click="move(provider.id, 1)">↓</button>
            <el-switch :model-value="isEnabled(provider.id)" :disabled="toggleDisabled(provider.id)" :aria-label="`${translateLegacy('启用')} ${translateLegacy(provider.label)}`" @update:model-value="toggle(provider.id, Boolean($event))" />
          </div>
        </div>
        <p class="provider-description">{{ translateLegacy(provider.description) }}</p>

        <details v-if="provider.id === services.myMemory" class="provider-configuration">
          <summary>连接设置</summary>
          <label class="compact-field"><span>联系邮箱（可选）</span><el-input v-model="myMemoryEmailDraft" type="email" placeholder="不填写也可以使用" aria-label="MyMemory 联系邮箱" :aria-invalid="myMemoryEmailInvalid" @change="commitMyMemoryEmail" /></label>
          <p v-if="myMemoryEmailInvalid" class="provider-note" role="status">请输入有效邮箱，或留空。</p>
          <p>匿名每天 5,000 字符；提供有效邮箱后每天 50,000 字符。邮箱会随请求发送给 MyMemory。</p>
          <p>自动识别来源语言时使用本地检测；无法可靠识别时，请手动选择来源语言。</p>
          <a href="https://mymemory.translated.net/doc/usagelimits.php" target="_blank" rel="noreferrer">官方额度说明</a>
        </details>
      </li>
    </ol>
    <p class="fallback-footnote">至少保留一个服务。微软网页翻译、Google 网页翻译和 DeepLX 不是官方公开翻译 API，可按需关闭。</p>
    <details class="fallback-advanced" data-fallback-advanced>
      <summary>高级设置</summary>
      <label class="compact-field"><span>每个服务最多等待（秒）</span><el-input-number :model-value="config.freeTranslationTimeoutMs / 1000" :min="1" :max="15" :step="1" aria-label="每个服务最多等待（秒）" @update:model-value="setDuration('freeTranslationTimeoutMs', $event)" /></label>
      <label class="compact-field"><span>失败后暂停使用（秒）</span><el-input-number :model-value="config.freeTranslationCooldownMs / 1000" :min="1" :max="300" :step="1" aria-label="失败后暂停使用（秒）" @update:model-value="setDuration('freeTranslationCooldownMs', $event)" /></label>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import type { Config } from '@/src/core/config/model'
import { services } from '@/src/core/config/catalog'
import { FREE_TRANSLATION_PROVIDERS, normalizeFreeTranslationOrder, normalizeMyMemoryEmail } from '@/src/core/config/freeTranslation'
import { useUiI18n } from '@/src/ui/i18n'
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue'

const props = defineProps<{config: Config}>()
const config = toRef(props, 'config')
const { translateLegacy } = useUiI18n()
const myMemoryEmailDraft = ref(config.value.myMemoryEmail)
const myMemoryEmailInvalid = computed(() => Boolean(myMemoryEmailDraft.value.trim() && !normalizeMyMemoryEmail(myMemoryEmailDraft.value)))
watch(() => config.value.myMemoryEmail, value => { myMemoryEmailDraft.value = value })

function commitMyMemoryEmail(): void {
  if (myMemoryEmailInvalid.value) return
  config.value.myMemoryEmail = normalizeMyMemoryEmail(myMemoryEmailDraft.value)
}

const order = computed(() => normalizeFreeTranslationOrder(config.value.freeTranslationOrder))
const providers = computed(() => [
  ...order.value.flatMap(id => FREE_TRANSLATION_PROVIDERS.filter(provider => provider.id === id)),
  ...FREE_TRANSLATION_PROVIDERS.filter(provider => !order.value.includes(provider.id)),
])

function isEnabled(id: string): boolean { return order.value.includes(id) }

function toggleDisabled(id: string): boolean {
  return isEnabled(id) && order.value.length === 1
}

function toggle(id: string, enabled: boolean): void {
  if (!FREE_TRANSLATION_PROVIDERS.some(provider => provider.id === id)) return
  if (enabled === isEnabled(id) || toggleDisabled(id)) return
  config.value.freeTranslationOrder = enabled ? [...order.value, id] : order.value.filter(value => value !== id)
}

function move(id: string, direction: -1 | 1): void {
  const current = order.value.indexOf(id)
  const next = current + direction
  if (current < 0 || next < 0 || next >= order.value.length) return
  const reordered = [...order.value]
  ;[reordered[current], reordered[next]] = [reordered[next], reordered[current]]
  config.value.freeTranslationOrder = reordered
}

function setDuration(field: 'freeTranslationTimeoutMs' | 'freeTranslationCooldownMs', seconds: number | undefined): void {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return
  const maximum = field === 'freeTranslationTimeoutMs' ? 15 : 300
  config.value[field] = Math.round(Math.min(maximum, Math.max(1, seconds)) * 1000)
}
</script>

<style scoped>
.free-translation-settings { color: var(--el-text-color-primary); font-size: 12px; }
.fallback-intro, .fallback-footnote { margin: 12px 0; color: var(--el-text-color-secondary); line-height: 1.65; }
.fallback-list { display: grid; gap: 8px; margin: 14px 0; padding: 0; list-style: none; }
.fallback-list > li { padding: 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; background: var(--el-fill-color-blank); }
.fallback-list > li.is-disabled { background: var(--surface-soft, var(--el-fill-color-extra-light)); }
.provider-row { display: flex; align-items: center; gap: 10px; }
.provider-position { width: 14px; flex: 0 0 auto; color: var(--el-text-color-secondary); font-variant-numeric: tabular-nums; }
.provider-copy { display: flex; min-width: 0; flex: 1; flex-wrap: wrap; align-items: baseline; gap: 4px 9px; }
.provider-copy strong { font-size: 12px; overflow-wrap: anywhere; }
.provider-copy > span { color: var(--el-text-color-secondary); font-size: 10px; }
.provider-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 5px; }
.provider-actions button { width: 27px; height: 27px; padding: 0; border: 1px solid var(--el-border-color); border-radius: 7px; color: var(--el-text-color-regular); background: var(--el-fill-color-blank); cursor: pointer; }
.provider-actions button:disabled { opacity: .35; cursor: default; }
.provider-actions button:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.provider-actions :deep(.el-switch) { margin-left: 5px; }
.provider-description, .provider-note { margin: 7px 0 0 24px; color: var(--el-text-color-secondary); font-size: 11px; line-height: 1.55; }
.provider-note { color: var(--el-color-warning-dark-2); }
.provider-configuration { margin: 8px 0 0 24px; color: var(--el-text-color-secondary); }
.provider-configuration summary, .fallback-advanced summary { cursor: pointer; color: var(--el-text-color-regular); }
.provider-configuration p { margin: 7px 0; line-height: 1.6; font-size: 11px; }
.provider-configuration a { color: var(--el-color-primary); font-size: 11px; }
.compact-field { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 12px; }
.compact-field > span { flex: 0 0 auto; }
.compact-field :deep(.el-input) { max-width: 360px; }
.fallback-advanced { margin-top: 14px; padding: 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; }
@media (max-width: 700px) {
  .provider-row { gap: 6px; }
  .provider-copy { flex-direction: column; gap: 2px; }
  .provider-actions { gap: 3px; }
  .provider-actions button { width: 24px; }
  .provider-description, .provider-note, .provider-configuration { margin-left: 0; }
  .compact-field { flex-wrap: wrap; gap: 7px; }
  .compact-field :deep(.el-input) { max-width: none; }
}
</style>
