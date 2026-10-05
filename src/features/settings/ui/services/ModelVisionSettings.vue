<!--
 @file src/features/settings/ui/services/ModelVisionSettings.vue
 文件职责：展示当前模型的手动识图设置、规则或测试缓存结论，并提供真实图片检测与取消操作。
 主要内容：先持久保存当前配置再发送带身份指纹的测试消息；切换模型、凭据、服务或卸载时取消旧任务，忽略过期响应，订阅独立本地测试缓存。
 模块边界：UI 不发送模型 HTTP、不提供凭据或图片、不修改自动探测结论；请求由共享服务与后台实际适配器执行，手动选择保留用户优先级。
-->
<template>
  <div class="connection-field-control model-vision-setting">
    <div class="model-vision-controls">
    <el-select v-model="override" data-testid="model-vision-capability" :aria-label="t('settings.services.visionCapability')" :disabled="!transportSupported">
      <el-option value="auto" :label="t('settings.services.visionAuto')" />
      <el-option value="supported" :label="t('settings.services.visionSupported')" />
      <el-option value="unsupported" :label="t('settings.services.visionTextOnly')" />
    </el-select>
    <el-button data-testid="model-vision-probe" :disabled="!transportSupported" @click="busy ? cancel() : probe()">
      {{ t(busy ? 'settings.services.visionProbeCancel' : 'settings.services.visionProbeAction') }}
    </el-button>
    <FieldHelp :content="t('settings.services.visionProbeHelp')" />
    </div>
    <small data-testid="model-vision-status" role="status">{{ t(capabilityMessage) }}</small>
    <small v-if="feedback" role="status" data-testid="model-vision-probe-feedback">{{ feedback }}</small>
  </div>
</template>
<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue'
import browser from 'webextension-polyfill'
import type {Config} from '@/src/core/config/model'
import {supportsVisionTransport} from '@/src/core/config/vision'
import {createVisionProbeIdentity, type VisionProbeResult} from '@/src/core/config/visionProbe'
import {VISION_PROBE_MESSAGE, VISION_PROBE_CANCEL_MESSAGE} from '@/src/services/translation/visionProbe'
import {useVisionProbeStatus} from './useVisionProbeStatus'
import {requestConfigSave, waitForConfigPersistenceQueue} from '@/src/services/config/store'
import {useUiI18n} from '@/src/ui/i18n'
import FieldHelp from '../components/FieldHelp.vue'

const props = defineProps<{config: Config; service: string; model: string}>()
const {t} = useUiI18n()
const {result: capabilityStatus, refresh} = useVisionProbeStatus(() => props.config, () => props.service, () => props.model)
const busy = ref(false)
const feedback = ref('')
const identity = computed(() => createVisionProbeIdentity(props.config, props.service, props.model))
const transportSupported = computed(() => supportsVisionTransport(props.service, props.model))
const override = computed({
  get: () => typeof props.config.modelVision[props.service]?.[props.model] === 'boolean'
    ? props.config.modelVision[props.service][props.model] ? 'supported' : 'unsupported' : 'auto',
  set: (value: string) => {
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
let generation = 0
let requestId = ''
function cancel(): void {
  generation++
  busy.value = false
  if (requestId) void browser.runtime.sendMessage({type: VISION_PROBE_CANCEL_MESSAGE, requestId}).catch(() => undefined)
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
    await waitForConfigPersistenceQueue()
    if (current !== generation) return
    await requestConfigSave(props.config, browser.runtime.sendMessage.bind(browser.runtime))
    if (current !== generation) return
    const result = await browser.runtime.sendMessage({type: VISION_PROBE_MESSAGE, service: testedService, model: testedModel,
      identity: testedIdentity, requestId: id}) as VisionProbeResult & {success?: boolean; error?: string}
    if (current !== generation) return
    if (!result?.success) throw new Error(result?.error || t('settings.services.visionProbeFailed'))
    feedback.value = t(result.capability === 'supported' ? 'settings.services.visionProbeSupported'
      : result.capability === 'unsupported' ? 'settings.services.visionProbeUnsupported' : 'settings.services.visionProbeUnknown')
    await refresh()
  } catch (error) {
    if (current === generation) feedback.value = t('settings.services.visionProbeFailed') + (error instanceof Error ? ` ${error.message}` : '')
  } finally {
    if (current === generation) { busy.value = false; requestId = '' }
  }
}
watch(identity, () => { cancel(); feedback.value = '' })
onBeforeUnmount(cancel)
</script>
<style scoped>
.model-vision-controls { display: flex; align-items: center; gap: 8px; width: 100%; }
.model-vision-controls :deep(.el-select) { flex: 1; min-width: 0; max-width: 360px; }
.model-vision-controls :deep(.el-button) { flex: none; margin: 0; height: 38px; border-radius: 10px; }
.model-vision-setting { gap: 6px; }
@container (max-width: 400px) { .model-vision-controls { flex-wrap: wrap; } .model-vision-controls :deep(.el-select) { flex-basis: 100%; } }
.model-vision-setting small {color: var(--muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere;}
</style>
