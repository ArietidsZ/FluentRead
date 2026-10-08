<!--
 @file src/features/settings/ui/services/ModelVisionSettings.vue
 文件职责：展示当前模型的手动识图设置、规则或测试缓存结论，并提供真实图片检测与取消操作；检测说明由父级放在字段标签旁的提示里。
 主要内容：先保存配置再测试明确选择的目标；原生私密提示要求选择与专用 pair 一致，并复用所属文档 Port；显示后台确认的真实目标，配置、模型切换或卸载时取消旧任务并忽略过期响应，订阅来源隔离的本地能力缓存。
 模块边界：UI 不发送模型 HTTP、不提供凭据或图片、不修改自动探测结论；请求由共享服务与后台实际适配器执行，手动选择保留用户优先级。
-->
<template>
  <div class="connection-field-control model-vision-setting">
    <div class="model-vision-controls">
      <SegmentedControl
        v-model="override" compact data-testid="model-vision-capability"
        :label="t('settings.services.visionCapability')" :options="capabilityOptions" :disabled="!transportSupported"
      />
      <el-button
        data-testid="model-vision-probe" :disabled="!transportSupported"
        :title="busy ? undefined : t('settings.services.visionProbeAction')" :aria-label="busy ? undefined : t('settings.services.visionProbeAction')"
        @click="busy ? cancel() : probe()"
      >
        {{ t(busy ? 'settings.services.visionProbeCancel' : 'settings.services.visionProbeShort') }}
      </el-button>
    </div>
    <small v-if="showCapabilityMessage" class="model-vision-status" :class="`is-${capabilityTone}`" data-testid="model-vision-status" role="status">{{ t(capabilityMessage) }}</small>
    <small v-if="distinctFeedback" role="status" data-testid="model-vision-probe-feedback">{{ distinctFeedback }}</small>
  </div>
</template>
<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue'
import browser from 'webextension-polyfill'
import type {Config} from '@/src/core/config/model'
import {supportsVisionTransport} from '@/src/core/config/vision'
import {assertVisionProbeTarget, createVisionProbeIdentity, type VisionProbeResult} from '@/src/core/config/visionProbe'
import {VISION_PROBE_MESSAGE, VISION_PROBE_CANCEL_MESSAGE, visionProbeConfigKey} from '@/src/services/translation/visionProbe'
import {NATIVE_PRIVATE_ROUTE_SUPPORTED} from '@/src/core/config/incognitoRoute'
import {resolvePageTranslationRouteHint} from '@/src/services/translation/requestPrivacy'
import {translationDocumentClient} from '@/src/services/translation/documentClient'
import {useVisionProbeStatus} from './useVisionProbeStatus'
import {requestConfigSave, waitForConfigPersistenceQueue} from '@/src/services/config/store'
import {useUiI18n} from '@/src/ui/i18n'
import SegmentedControl from '../components/SegmentedControl.vue'

const props = defineProps<{config: Config; service: string; model: string}>()
const {t} = useUiI18n()
const {result: capabilityStatus, refresh} = useVisionProbeStatus(() => props.config, () => props.service, () => props.model)
const busy = ref(false)
const feedback = ref('')
const identity = computed(() => createVisionProbeIdentity(props.config, props.service, props.model))
const transportSupported = computed(() => supportsVisionTransport(props.service, props.model))
const capabilityOptions = computed(() => [
  {value: 'auto', label: t('settings.services.visionAuto')},
  {value: 'supported', label: t('settings.services.visionSupported')},
  {value: 'unsupported', label: t('settings.services.visionTextOnly')},
])
const override = computed({
  get: () => typeof props.config.modelVision[props.service]?.[props.model] === 'boolean'
    ? props.config.modelVision[props.service][props.model] ? 'supported' : 'unsupported' : 'auto',
  set: (value: string | number) => {
    if (!props.model) return
    const next = {...props.config.modelVision[props.service]}
    if (value === 'auto') delete next[props.model]
    else next[props.model] = value === 'supported'
    if (Object.keys(next).length) props.config.modelVision[props.service] = next
    else delete props.config.modelVision[props.service]
  },
})
const capabilityMessage = computed(() => {
  if (!transportSupported.value) return 'settings.services.visionTransportUnsupported'
  if (capabilityStatus.value.source === 'probe') return capabilityStatus.value.capability === 'supported' ? 'settings.services.visionProbeSupported' : 'settings.services.visionProbeUnsupported'
  const capability = capabilityStatus.value.capability
  return capability === 'supported' ? 'settings.services.visionConfirmed' : capability === 'unsupported'
    ? 'settings.services.visionTextOnlyMessage' : 'settings.services.visionUnknown'
})
// “尚未确认”是默认状态，说明收在标签旁的提示里；只有得出结论或服务不支持时才占一行。
const showCapabilityMessage = computed(() => capabilityMessage.value !== 'settings.services.visionUnknown')
const capabilityTone = computed(() => !transportSupported.value ? 'muted'
  : capabilityStatus.value.capability === 'supported' ? 'success'
    : capabilityStatus.value.source === 'probe' ? 'warning' : 'muted')
const distinctFeedback = computed(() => feedback.value === t(capabilityMessage.value) ? '' : feedback.value)
let generation = 0
let requestId = ''
function cancel(): void {
  generation++
  busy.value = false
  if (requestId) {
    if (NATIVE_PRIVATE_ROUTE_SUPPORTED) void translationDocumentClient(browser.runtime).request({type: VISION_PROBE_CANCEL_MESSAGE, requestId, clientRequestId: requestId}).catch(() => undefined)
    else void browser.runtime.sendMessage({type: VISION_PROBE_CANCEL_MESSAGE, requestId}).catch(() => undefined)
  }
  requestId = ''
  feedback.value = t('settings.services.visionProbeCancelled')
}
async function probe(): Promise<void> {
  const current = ++generation
  const testedService = props.service, testedModel = props.model, testedIdentity = identity.value
  requestId = crypto.randomUUID()
  const id = requestId
  busy.value = true
  feedback.value = t('settings.services.visionProbeRunning')
  try {
    if (NATIVE_PRIVATE_ROUTE_SUPPORTED) {
      const route = resolvePageTranslationRouteHint(props.config, browser.extension?.inIncognitoContext)
      assertVisionProbeTarget(route, testedService, testedModel)
    }
    await waitForConfigPersistenceQueue()
    if (current !== generation) return
    await requestConfigSave(props.config, browser.runtime.sendMessage.bind(browser.runtime))
    if (current !== generation) return
    const result = (NATIVE_PRIVATE_ROUTE_SUPPORTED
      ? await translationDocumentClient(browser.runtime).request({type: VISION_PROBE_MESSAGE, service: testedService, model: testedModel, identity: testedIdentity, requestId: id, clientRequestId: id})
      : await browser.runtime.sendMessage({type: VISION_PROBE_MESSAGE, service: testedService, model: testedModel,
        identity: testedIdentity, requestId: id})) as VisionProbeResult & {success?: boolean; error?: string; service?: string; model?: string}
    if (current !== generation) return
    if (!result?.success) throw new Error(result?.error || t('settings.services.visionProbeFailed'))
    if (NATIVE_PRIVATE_ROUTE_SUPPORTED) assertVisionProbeTarget(result, testedService, testedModel)
    feedback.value = t(result.capability === 'supported' ? 'settings.services.visionProbeSupported'
      : result.capability === 'unsupported' ? 'settings.services.visionProbeUnsupported' : 'settings.services.visionProbeUnknown')
    if (NATIVE_PRIVATE_ROUTE_SUPPORTED) feedback.value += ` (${result.service} / ${result.model})`
    await refresh()
  } catch (error) {
    if (current === generation) feedback.value = t('settings.services.visionProbeFailed') + (error instanceof Error ? ` ${error.message}` : '')
  } finally {
    if (current === generation) { busy.value = false; requestId = '' }
  }
}
watch(NATIVE_PRIVATE_ROUTE_SUPPORTED ? () => visionProbeConfigKey(props.config, props.service, props.model) : identity, () => { cancel(); feedback.value = '' })
onBeforeUnmount(cancel)
</script>
<style scoped>
.model-vision-controls { display: flex; align-items: center; gap: 8px; width: 100%; }
.model-vision-controls :deep(.segmented-control) { flex: 1; min-width: 0; max-width: 360px; }
.model-vision-controls :deep(.el-button) { flex: none; margin: 0; height: 38px; padding: 0 14px; border-radius: 10px; font-size: 12px; }
.model-vision-setting { gap: 6px; }
@container (max-width: 480px) { .model-vision-controls { flex-wrap: wrap; } .model-vision-controls :deep(.segmented-control) { flex-basis: 100%; max-width: none; } }
.model-vision-setting small { color: var(--muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.model-vision-status { display: flex; align-items: center; gap: 6px; }
.model-vision-status::before { content: ''; flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .55; }
.model-vision-setting .model-vision-status.is-success { color: var(--el-color-success); }
.model-vision-setting .model-vision-status.is-warning { color: var(--el-color-danger); }
.model-vision-status.is-success::before, .model-vision-status.is-warning::before { opacity: 1; }
</style>
