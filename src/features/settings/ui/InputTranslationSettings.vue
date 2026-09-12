<!--
 * @file src/features/settings/ui/InputTranslationSettings.vue
 * 文件职责：承载输入框翻译的一组独立设置，先说明触发与替换结果，再按需编辑翻译配置与连按速度。
 * 主要内容：编辑三击间隔、输入框翻译服务、AI 模型及独立提示词；机器翻译隐藏不适用的模型与提示词。
 * 模块边界：组件只编排设置页状态并写入父级配置副本，触发方式交由父级处理快捷键冲突，服务能力与持久化仍由外层设置链路负责。
 -->
<template>
  <section class="input-translation-settings" data-testid="input-translation-settings">
    <SettingsGroup :title="t('inputTranslation.title')" :description="workflowDescription">
      <SettingsItem :label="t('inputTranslation.trigger')">
        <template #copy>
          <strong>{{ t('inputTranslation.trigger') }}</strong>
          <el-popover v-if="inputConfig.inputBoxTranslationTrigger.startsWith('triple_')" trigger="click" placement="bottom-start" :width="280">
            <template #reference>
              <button type="button" class="input-translation-text-button input-translation-timing-link" data-testid="input-translation-timing-toggle">
                {{ t('inputTranslation.adjustTiming') }} · {{ interval }} {{ t('inputTranslation.intervalUnit') }}
              </button>
            </template>
            <div class="input-translation-timing-panel" data-testid="input-translation-timing-panel">
              <strong>{{ t('inputTranslation.interval') }}</strong>
              <p>{{ t('inputTranslation.intervalDescription') }}</p>
              <div class="input-translation-interval-control">
                <el-input-number
                  :model-value="interval"
                  data-testid="input-translation-interval"
                  :aria-label="t('inputTranslation.interval')"
                  :min="INPUT_BOX_TRANSLATION_INTERVAL_MIN"
                  :max="INPUT_BOX_TRANSLATION_INTERVAL_MAX"
                  :step="INPUT_BOX_TRANSLATION_INTERVAL_STEP"
                  controls-position="right"
                  @update:model-value="setIntervalValue"
                />
                <span>{{ t('inputTranslation.intervalUnit') }}</span>
              </div>
              <p>{{ t('inputTranslation.intervalHelp') }}</p>
              <button type="button" class="input-translation-text-button" data-testid="input-translation-interval-reset" :aria-label="t('inputTranslation.intervalResetAria')" :disabled="interval === DEFAULT_INPUT_BOX_TRANSLATION_INTERVAL" @click="resetInterval">{{ t('inputTranslation.intervalReset') }}</button>
            </div>
          </el-popover>
        </template>
        <el-select :model-value="props.config.inputBoxTranslationTrigger" data-testid="input-translation-trigger" :aria-label="t('inputTranslation.trigger')" @change="emit('trigger-change', $event)">
          <el-option v-for="item in triggerOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </SettingsItem>

      <SettingsItem :label="t('inputTranslation.target')">
        <el-select v-model="targetLanguage" data-testid="input-translation-target" :aria-label="t('inputTranslation.target')">
          <el-option v-for="item in targetOptions" :key="item.value" class="select-left" data-i18n-ignore :label="getMultilingualTargetLanguageLabel(item.value, item.label, language)" :value="item.value" />
        </el-select>
      </SettingsItem>

      <SettingsItem :label="t('inputTranslation.service')" :description="t('inputTranslation.serviceDescriptionShort')">
        <template #copy>
          <strong>{{ t('inputTranslation.service') }}</strong>
          <small>{{ t('inputTranslation.serviceDescriptionShort') }}</small>
          <button type="button" class="input-translation-text-button input-translation-connection-link" @click="configureService">
            {{ t('inputTranslation.connectionSettings') }}
          </button>
        </template>
        <div class="input-translation-service-control" data-testid="input-translation-profile-editor">
          <el-select id="input-translation-service-control" v-model="translationService" data-testid="input-translation-service" :aria-label="t('inputTranslation.service')" filterable>
            <el-option v-for="item in serviceOptions" :key="item.value" class="select-left" :label="item.label" :value="item.value" :disabled="item.disabled">
              <span class="input-translation-service-option">
                <ServiceIcon :service="item.value" :label="item.label" size="small" />
                <span>{{ item.label }}</span>
              </span>
            </el-option>
          </el-select>
          <div v-if="showModel" class="input-translation-model-control">
            <label for="input-translation-model-control">{{ t('inputTranslation.model') }}</label>
            <el-select id="input-translation-model-control" v-model="translationModel" data-testid="input-translation-model" :aria-label="t('inputTranslation.model')" filterable>
              <el-option value="" :label="t('inputTranslation.modelPlaceholder')" />
              <el-option v-for="model in modelOptions" :key="model" :label="model" :value="model" />
            </el-select>
            <small class="input-translation-field-help">{{ t('inputTranslation.modelDescription') }}</small>
          </div>
          <small v-if="credentialWarning" class="input-translation-credential-warning" role="status">{{ credentialWarning }}</small>
        </div>
      </SettingsItem>
      <p class="input-translation-scope">{{ t('inputTranslation.triggerDescription') }}</p>

      <div v-if="showPrompt" class="input-translation-prompt-options">
        <button type="button" class="input-translation-prompt-toggle" data-testid="input-translation-prompt-toggle" :aria-expanded="promptsExpanded" @click="promptsExpanded = !promptsExpanded">
          <strong>{{ t('inputTranslation.promptGroup') }}</strong>
          <span>{{ promptStateLabel }}</span>
          <el-icon aria-hidden="true"><ArrowDown /></el-icon>
        </button>
        <div v-if="promptsExpanded" class="input-translation-prompts" data-testid="input-translation-prompts">
          <div class="input-translation-prompt-section">
            <PromptTemplateEditor
              v-model="systemPrompt"
              role="system"
              :role-label="t('inputTranslation.systemRoleLabel')"
              :title="t('inputTranslation.systemPrompt')"
              :description="t('inputTranslation.systemPromptDescription')"
              :placeholder="defaultSystemPrompt"
              :aria-label="t('inputTranslation.systemPrompt')"
              :limit-label="t('inputTranslation.promptLimit', {count: 8192})"
              :tokens="[]"
            />
            <button v-if="!systemPrompt.trim()" type="button" class="input-translation-text-button" data-testid="input-translation-system-default" @click="systemPrompt = defaultSystemPrompt">{{ t('inputTranslation.editDefaultPrompt') }}</button>
            <button v-else type="button" class="input-translation-text-button" :aria-label="t('inputTranslation.promptResetAria')" @click="resetSystemPrompt">{{ t('inputTranslation.promptReset') }}</button>
          </div>
          <div class="input-translation-prompt-section">
            <PromptTemplateEditor
              v-model="userPrompt"
              role="user"
              :role-label="t('inputTranslation.userRoleLabel')"
              :title="t('inputTranslation.userPrompt')"
              :description="t('inputTranslation.userPromptDescription')"
              :placeholder="defaultUserPrompt"
              :aria-label="t('inputTranslation.userPrompt')"
              :limit-label="t('inputTranslation.promptLimit', {count: 8192})"
              :token-hint="t('inputTranslation.promptVariablesHelp')"
              :token-list-aria-label="t('inputTranslation.promptVariablesHelp')"
              :token-aria-label="promptTokenAriaLabel"
              :tokens="promptTokens"
            />
            <p v-if="promptWarnings.length" class="input-translation-prompt-warning" role="alert">
              <el-icon aria-hidden="true"><WarningFilled /></el-icon>
              <span>{{ promptWarnings.join(' ') }}</span>
            </p>
            <button v-if="!userPrompt.trim()" type="button" class="input-translation-text-button" data-testid="input-translation-user-default" @click="userPrompt = defaultUserPrompt">{{ t('inputTranslation.editDefaultPrompt') }}</button>
            <button v-else type="button" class="input-translation-text-button" :aria-label="t('inputTranslation.promptResetAria')" @click="resetUserPrompt">{{ t('inputTranslation.promptReset') }}</button>
          </div>
        </div>
      </div>
    </SettingsGroup>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElPopover } from 'element-plus'
import { ArrowDown, WarningFilled } from '@element-plus/icons-vue'
import { customModelString, getMultilingualTargetLanguageLabel, models, options, resolveConfiguredModel, servicesType } from '@/src/core/config/catalog'
import { getMissingCredentialMessage } from '@/src/core/config/validation'
import type { Config } from '@/src/core/config/model'
import { getCustomOpenAIProviderModels, isCustomOpenAIProviderId } from '@/src/core/config/customOpenAI'
import {
  DEFAULT_INPUT_BOX_TRANSLATION_INTERVAL,
  DEFAULT_INPUT_BOX_TRANSLATION_PROMPT,
  DEFAULT_INPUT_BOX_TRANSLATION_SYSTEM_PROMPT,
  INPUT_BOX_TRANSLATION_INTERVAL_MAX,
  INPUT_BOX_TRANSLATION_INTERVAL_MIN,
  INPUT_BOX_TRANSLATION_INTERVAL_STEP,
  normalizeInputBoxTranslationInterval,
  supportsInputBoxTranslationPrompt,
} from '@/src/core/config/inputTranslation'
import { useUiI18n } from '@/src/ui/i18n'
import SettingsGroup from './components/SettingsGroup.vue'
import SettingsItem from './components/SettingsItem.vue'
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue'
import PromptTemplateEditor from './services/PromptTemplateEditor.vue'

const MAX_PROMPT_LENGTH = 8192

interface InputTranslationConfig extends Config {
  inputBoxTranslationInterval: number
  inputBoxTranslationService: string
  inputBoxTranslationModel: string
  inputBoxTranslationPrompt: string
  inputBoxTranslationSystemPrompt: string
}

interface ServiceOption {
  value: string
  label: string
  disabled?: boolean
}

const props = defineProps<{
  config: Config
  serviceOptions: readonly ServiceOption[]
}>()

const emit = defineEmits<{
  'trigger-change': [value: string]
  'configure-service': [value: string]
}>()

const { language, t, translateLegacy } = useUiI18n()
const inputConfig = computed(() => props.config as InputTranslationConfig)
const promptsExpanded = ref(false)

const triggerOptions = computed(() => inputConfig.value.inputBoxTranslationTrigger === 'ctrl_enter'
  ? [...options.inputBoxTranslationTrigger, {value: 'ctrl_enter', label: 'Ctrl+Enter'}]
  : options.inputBoxTranslationTrigger)
const targetOptions = computed(() => options.inputBoxTranslationTarget)
const serviceOptions = computed(() => {
  const visible = props.serviceOptions.filter((item) => !item.disabled)
  const selected = inputConfig.value.inputBoxTranslationService
  if (!selected || visible.some((item) => item.value === selected)) return visible
  return [{value: selected, label: selected, disabled: true}, ...visible]
})

const interval = computed({
  get: () => clampInterval(inputConfig.value.inputBoxTranslationInterval),
  set: (value: number) => {
    inputConfig.value.inputBoxTranslationInterval = clampInterval(value)
  },
})

const targetLanguage = computed({
  get: () => inputConfig.value.inputBoxTranslationTarget,
  set: (value: string) => { inputConfig.value.inputBoxTranslationTarget = value },
})

const translationService = computed({
  get: () => inputConfig.value.inputBoxTranslationService || 'microsoft',
  set: (value: string) => {
    if (value !== inputConfig.value.inputBoxTranslationService) inputConfig.value.inputBoxTranslationModel = ''
    inputConfig.value.inputBoxTranslationService = value
  },
})

const translationModel = computed({
  get: () => inputConfig.value.inputBoxTranslationModel || '',
  set: (value: string | undefined) => { inputConfig.value.inputBoxTranslationModel = value?.trim() || '' },
})

const credentialWarning = computed(() => {
  const service = translationService.value
  const message = getMissingCredentialMessage(service, {
    ...props.config,
    model: {...props.config.model, [service]: translationModel.value || props.config.model[service]},
  })
  return message ? translateLegacy(message) : ''
})

const defaultSystemPrompt = DEFAULT_INPUT_BOX_TRANSLATION_SYSTEM_PROMPT
const defaultUserPrompt = DEFAULT_INPUT_BOX_TRANSLATION_PROMPT
const systemPrompt = computed({
  get: () => inputConfig.value.inputBoxTranslationSystemPrompt || '',
  set: (value: string) => { inputConfig.value.inputBoxTranslationSystemPrompt = value.slice(0, MAX_PROMPT_LENGTH) },
})
const userPrompt = computed({
  get: () => inputConfig.value.inputBoxTranslationPrompt || '',
  set: (value: string) => { inputConfig.value.inputBoxTranslationPrompt = value.slice(0, MAX_PROMPT_LENGTH) },
})

const isMachineService = computed(() => servicesType.isMachine(translationService.value))
const isInputTranslationEnabled = computed(() => inputConfig.value.inputBoxTranslationTrigger !== 'disabled')
const effectiveModel = computed(() => translationModel.value || resolveConfiguredModel(
  inputConfig.value.model[translationService.value],
  inputConfig.value.customModel[translationService.value],
))
const isAiService = computed(() => !isMachineService.value && (
  isCustomOpenAIProviderId(translationService.value) || servicesType.isAI(translationService.value)
))
const showModel = computed(() => isAiService.value && servicesType.isUseModel(translationService.value))
const showPrompt = computed(() => isAiService.value && supportsInputBoxTranslationPrompt(
  translationService.value,
  effectiveModel.value,
))
const modelOptions = computed(() => {
  const service = translationService.value
  const providerModels = isCustomOpenAIProviderId(service)
    ? getCustomOpenAIProviderModels(inputConfig.value.customOpenAIProviders, service)
    : models.get(service) || []
  const configuredModels = inputConfig.value.customModels[service] || []
  const selected = translationModel.value
  const defaultModel = resolveConfiguredModel(inputConfig.value.model[service], inputConfig.value.customModel[service])
  return Array.from(new Set([...providerModels, ...configuredModels, defaultModel, selected]
    .filter((model) => model && model !== customModelString)))
})

const promptTokens = computed(() => [
  {value: '{{to}}', label: t('inputTranslation.target')},
  {value: '{{origin}}', label: t('inputTranslation.sourceText')},
])
const promptTokenAriaLabel = (token: {value: string; label: string}) => t('inputTranslation.promptInsert', {token: token.value, label: token.label})
const promptWarnings = computed(() => {
  const warnings: string[] = []
  if (inputConfig.value.inputBoxTranslationPrompt?.trim() && !inputConfig.value.inputBoxTranslationPrompt.includes('{{origin}}')) {
    warnings.push(t('inputTranslation.promptMissingOrigin'))
  }
  if (inputConfig.value.inputBoxTranslationPrompt?.trim() && !inputConfig.value.inputBoxTranslationPrompt.includes('{{to}}')) {
    warnings.push(t('inputTranslation.promptMissingTarget'))
  }
  return warnings
})
const promptStateLabel = computed(() => (
  inputConfig.value.inputBoxTranslationPrompt?.trim() || inputConfig.value.inputBoxTranslationSystemPrompt?.trim()
    ? t('inputTranslation.promptEdited')
    : t('inputTranslation.promptDefault')
))

function clampInterval(value: number | undefined): number {
  return normalizeInputBoxTranslationInterval(value)
}

function setIntervalValue(value: number | undefined): void {
  interval.value = value ?? DEFAULT_INPUT_BOX_TRANSLATION_INTERVAL
}

function resetInterval(): void {
  interval.value = DEFAULT_INPUT_BOX_TRANSLATION_INTERVAL
}

function resetSystemPrompt(): void {
  inputConfig.value.inputBoxTranslationSystemPrompt = ''
}

function resetUserPrompt(): void {
  inputConfig.value.inputBoxTranslationPrompt = ''
}

const workflowDescription = computed(() => {
  if (!isInputTranslationEnabled.value) return t('inputTranslation.workflowDisabled')
  const trigger = triggerOptions.value.find(item => item.value === inputConfig.value.inputBoxTranslationTrigger)?.label || inputConfig.value.inputBoxTranslationTrigger
  let target = targetOptions.value.find(item => item.value === targetLanguage.value)?.label || targetLanguage.value
  try {
    target = new Intl.DisplayNames([language.value], {type: 'language'}).of(targetLanguage.value) || target
  } catch { /* 无法识别的语言标识继续显示目录名称。 */ }
  return t('inputTranslation.workflowEnabled', {trigger: translateLegacy(trigger), language: target})
})

function configureService(): void {
  emit('configure-service', translationService.value)
}
</script>

<style scoped>
.input-translation-settings { min-width: 0; }
.input-translation-text-button { display: inline-flex; align-items: center; min-height: 22px; padding: 0; border: 0; color: var(--brand-strong); background: transparent; cursor: pointer; font: inherit; font-size: 11px; line-height: 1.5; text-align: left; }
.input-translation-text-button:hover:not(:disabled) { text-decoration: underline; text-underline-offset: 3px; }
.input-translation-text-button:disabled { color: var(--muted); cursor: default; }
.input-translation-timing-link { align-self: flex-start; color: var(--muted); }
.input-translation-text-button:focus-visible,
.input-translation-prompt-toggle:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }

.input-translation-connection-link { margin-top: 4px; }
.input-translation-service-control { display: grid; gap: 10px; width: 100%; max-width: 360px; min-width: 0; }
.input-translation-service-option { display: flex; align-items: center; gap: 9px; min-width: 0; }
.input-translation-service-option > span:last-child { min-width: 0; overflow-wrap: anywhere; }
.input-translation-service-option :deep(.service-brand-icon) { flex: none; box-shadow: none; }
.input-translation-model-control { display: grid; gap: 6px; min-width: 0; }
.input-translation-model-control label { color: var(--ink); font-size: 11px; font-weight: 650; }
.input-translation-scope { margin: 0; padding: 0 16px 14px; color: var(--muted); font-size: 10.5px; line-height: 1.6; }

.input-translation-timing-panel { color: var(--ink); font-size: 12px; }
.input-translation-timing-panel strong { font-weight: 600; }
.input-translation-timing-panel p { margin: 8px 0 12px; color: var(--muted); font-size: 11px; line-height: 1.6; }
.input-translation-interval-control { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 11px; }
.input-translation-interval-control :deep(.el-input-number) { width: 132px; }

.input-translation-field { display: flex; min-width: 0; flex-direction: column; gap: 8px; }
.input-translation-field label { color: var(--ink); font-size: 12.5px; font-weight: 600; }
.input-translation-label-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px 12px; }
.input-translation-field-help,
.input-translation-credential-warning { color: var(--muted); font-size: 11px; line-height: 1.5; }

.input-translation-prompt-options { border-top: 1px solid var(--line); }
.input-translation-prompt-toggle { display: flex; align-items: center; gap: 12px; width: 100%; padding: 16px 0 0; border: 0; color: var(--muted); background: transparent; cursor: pointer; font: inherit; text-align: left; }
.input-translation-prompt-toggle strong { color: var(--ink); font-size: 12.5px; font-weight: 600; }
.input-translation-prompt-toggle span { margin-left: auto; font-size: 11px; }
.input-translation-prompt-toggle .el-icon { flex: none; transition: transform 160ms ease; }
.input-translation-prompt-toggle[aria-expanded="true"] .el-icon { transform: rotate(180deg); }
.input-translation-prompts { display: grid; gap: 20px; padding-top: 20px; }
.input-translation-prompt-section { display: grid; min-width: 0; gap: 8px; }
.input-translation-prompt-section > .input-translation-text-button { justify-self: start; }
.input-translation-prompts :deep(.prompt-template-field) { padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.input-translation-prompts :deep(.prompt-role-badge) { display: none; }
.input-translation-prompts :deep(.prompt-template-textarea) { box-sizing: border-box; min-height: 100px; height: 116px; margin-top: 8px; border-color: var(--line); border-radius: 10px; font-size: 12px; }
.input-translation-prompts :deep(.prompt-template-footer) { flex-wrap: wrap; align-items: flex-start; }
.input-translation-prompts :deep(.prompt-token-list) { justify-content: flex-start; }
.input-translation-prompt-warning { display: flex; align-items: flex-start; gap: 6px; margin: 0; color: var(--ink); font-size: 11px; line-height: 1.5; }
.input-translation-prompt-warning .el-icon { flex: none; margin-top: 2px; color: var(--brand-strong); }
@media (max-width: 540px) {
  .input-translation-prompts :deep(.prompt-template-header) { flex-wrap: wrap; gap: 4px; }
}
</style>
