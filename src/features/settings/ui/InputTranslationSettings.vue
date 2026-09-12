<!--
 * @file src/features/settings/ui/InputTranslationSettings.vue
 * 文件职责：承载输入框翻译的一组独立设置，按触发方式、目标语言和翻译方式组织界面。
 * 主要内容：编辑三击间隔、输入框翻译服务、AI 模型及独立提示词；机器翻译隐藏不适用的模型与提示词。
 * 模块边界：组件只编排设置页状态并写入父级配置副本，触发方式交由父级处理快捷键冲突，服务能力与持久化仍由外层设置链路负责。
 -->
<template>
  <section class="input-translation-settings" data-testid="input-translation-settings">
    <SettingsGroup :title="t('inputTranslation.title')" :description="t('inputTranslation.description')">
      <SettingsItem
        :label="t('inputTranslation.trigger')"
        :description="t('inputTranslation.triggerDescriptionShort')"
      >
        <el-select
          :model-value="props.config.inputBoxTranslationTrigger"
          data-testid="input-translation-trigger"
          :aria-label="t('inputTranslation.trigger')"
          :placeholder="t('inputTranslation.trigger')"
          @change="emit('trigger-change', $event)"
        >
          <el-option
            v-for="item in triggerOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </SettingsItem>

      <SettingsItem
        v-if="inputConfig.inputBoxTranslationTrigger.startsWith('triple_')"
        :label="t('inputTranslation.interval')"
        :description="t('inputTranslation.intervalDescription')"
        :disabled="!isInputTranslationEnabled"
      >
        <div class="input-translation-interval-control">
          <el-input-number
            :model-value="interval"
            data-testid="input-translation-interval"
            :aria-label="t('inputTranslation.interval')"
            :disabled="!isInputTranslationEnabled"
            :min="INPUT_BOX_TRANSLATION_INTERVAL_MIN"
            :max="INPUT_BOX_TRANSLATION_INTERVAL_MAX"
            :step="INPUT_BOX_TRANSLATION_INTERVAL_STEP"
            controls-position="right"
            @update:model-value="setIntervalValue"
          />
          <span class="input-translation-unit">{{ t('inputTranslation.intervalUnit') }}</span>
          <button
            type="button"
            class="input-translation-reset"
            data-testid="input-translation-interval-reset"
            :aria-label="t('inputTranslation.intervalResetAria')"
            :title="t('inputTranslation.intervalResetAria')"
            :disabled="!isInputTranslationEnabled"
            @click="resetInterval"
          >
            <el-icon aria-hidden="true"><RefreshLeft /></el-icon>
            <span>{{ t('inputTranslation.intervalReset') }}</span>
          </button>
        </div>
        <small class="input-translation-control-help">{{ t('inputTranslation.intervalHelp') }}</small>
      </SettingsItem>

      <SettingsItem :label="t('inputTranslation.target')" :disabled="!isInputTranslationEnabled">
        <el-select
          v-model="targetLanguage"
          data-testid="input-translation-target"
          :aria-label="t('inputTranslation.target')"
          :placeholder="t('inputTranslation.target')"
          :disabled="!isInputTranslationEnabled"
        >
          <el-option
            v-for="item in targetOptions"
            :key="item.value"
            class="select-left"
            data-i18n-ignore
            :label="getMultilingualTargetLanguageLabel(item.value, item.label, language)"
            :value="item.value"
          />
        </el-select>
      </SettingsItem>

      <SettingsItem
        :label="t('inputTranslation.service')"
        :description="t('inputTranslation.serviceDescriptionShort')"
        :disabled="!isInputTranslationEnabled"
      >
        <el-select
          v-model="translationService"
          data-testid="input-translation-service"
          :aria-label="t('inputTranslation.service')"
          :placeholder="t('inputTranslation.service')"
          :disabled="!isInputTranslationEnabled"
        >
          <el-option
            v-for="item in serviceOptions"
            :key="item.value"
            class="select-left"
            :label="item.label"
            :value="item.value"
            :disabled="item.disabled"
          />
        </el-select>
      </SettingsItem>

      <div class="input-translation-connection">
        <span v-if="credentialWarning" role="status">{{ credentialWarning }}</span>
        <button type="button" class="input-translation-reset" @click="emit('configure-service', translationService)">{{ t('inputTranslation.connectionSettings') }}</button>
      </div>

      <SettingsItem
        v-if="showModel"
        :label="t('inputTranslation.model')"
        :description="t('inputTranslation.modelDescription')"
        :disabled="!isInputTranslationEnabled"
      >
        <el-select
          v-model="translationModel"
          filterable
          allow-create
          clearable
          default-first-option
          data-testid="input-translation-model"
          :aria-label="t('inputTranslation.model')"
          :placeholder="t('inputTranslation.modelPlaceholder')"
          :disabled="!isInputTranslationEnabled"
        >
          <el-option v-for="model in modelOptions" :key="model" :label="model" :value="model" />
        </el-select>
        <small v-if="!translationModel" class="input-translation-control-help">{{ t('inputTranslation.aiModelEmpty') }}</small>
      </SettingsItem>

      <div v-if="isMachineService" class="input-translation-machine-hint" role="status">
        <el-icon aria-hidden="true"><InfoFilled /></el-icon>
        <span>{{ t('inputTranslation.machinePromptHint') }}</span>
      </div>

      <template v-if="showPrompt">
        <SettingsItem :label="t('inputTranslation.promptGroup')" :description="t('inputTranslation.promptDescription')" :disabled="!isInputTranslationEnabled" stacked>
          <button
            type="button"
            class="input-translation-prompt-toggle"
            data-testid="input-translation-prompt-toggle"
            :aria-expanded="promptsExpanded"
            :aria-label="t('inputTranslation.promptToggleAria')"
            :disabled="!isInputTranslationEnabled"
            @click="promptsExpanded = !promptsExpanded"
          >
            <span>
              <strong>{{ t('inputTranslation.promptToggle') }}</strong>
              <small>{{ promptStateLabel }}</small>
            </span>
            <el-icon aria-hidden="true"><ArrowDown /></el-icon>
          </button>

          <div v-if="promptsExpanded" class="input-translation-prompts" data-testid="input-translation-prompts">
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
            <button
              v-if="!systemPrompt.trim()"
              type="button"
              class="input-translation-prompt-reset"
              data-testid="input-translation-system-default"
              @click="systemPrompt = defaultSystemPrompt"
            >{{ t('inputTranslation.editDefaultPrompt') }}</button>
            <button
              v-else
              type="button"
              class="input-translation-prompt-reset"
              :aria-label="t('inputTranslation.promptResetAria')"
              @click="resetSystemPrompt"
            >
              <el-icon aria-hidden="true"><RefreshLeft /></el-icon>
              <span>{{ t('inputTranslation.promptReset') }}</span>
            </button>

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
            <button
              v-if="!userPrompt.trim()"
              type="button"
              class="input-translation-prompt-reset"
              data-testid="input-translation-user-default"
              @click="userPrompt = defaultUserPrompt"
            >{{ t('inputTranslation.editDefaultPrompt') }}</button>
            <button
              v-else
              type="button"
              class="input-translation-prompt-reset"
              :aria-label="t('inputTranslation.promptResetAria')"
              @click="resetUserPrompt"
            >
              <el-icon aria-hidden="true"><RefreshLeft /></el-icon>
              <span>{{ t('inputTranslation.promptReset') }}</span>
            </button>
          </div>
        </SettingsItem>
      </template>
      <p class="input-translation-scope">{{ t('inputTranslation.triggerDescription') }}</p>
    </SettingsGroup>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowDown, InfoFilled, RefreshLeft, WarningFilled } from '@element-plus/icons-vue'
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

const triggerOptions = computed(() => options.inputBoxTranslationTrigger)
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
  if (inputConfig.value.inputBoxTranslationPrompt && !inputConfig.value.inputBoxTranslationPrompt.includes('{{origin}}')) {
    warnings.push(t('inputTranslation.promptMissingOrigin'))
  }
  if (inputConfig.value.inputBoxTranslationPrompt && !inputConfig.value.inputBoxTranslationPrompt.includes('{{to}}')) {
    warnings.push(t('inputTranslation.promptMissingTarget'))
  }
  return warnings
})
const promptStateLabel = computed(() => (
  inputConfig.value.inputBoxTranslationPrompt || inputConfig.value.inputBoxTranslationSystemPrompt
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
</script>

<style scoped>
.input-translation-settings {
  min-width: 0;
}

.input-translation-settings :deep(.settings-item-control) {
  flex-wrap: wrap;
  gap: 6px;
}

.input-translation-scope {
  margin: 0;
  padding: 12px 16px;
  color: var(--muted);
  font-size: 11px;
}

.input-translation-connection {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 0 16px 12px;
  color: var(--muted);
  font-size: 11px;
}

.input-translation-interval-control {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}

.input-translation-interval-control :deep(.el-input-number) {
  width: 132px;
}

.input-translation-unit {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 11px;
}

.input-translation-reset,
.input-translation-prompt-reset,
.input-translation-prompt-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  color: var(--brand-strong);
  background: transparent;
  cursor: pointer;
  font: inherit;
}

.input-translation-reset {
  min-height: 32px;
  padding: 5px 7px;
  border: 1px solid var(--line);
  border-radius: 8px;
  font-size: 11px;
}

.input-translation-reset:hover,
.input-translation-prompt-reset:hover,
.input-translation-prompt-toggle:hover {
  color: var(--brand);
}

.input-translation-reset:focus-visible,
.input-translation-prompt-reset:focus-visible,
.input-translation-prompt-toggle:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 3px;
}

.input-translation-control-help {
  display: block;
  width: 100%;
  flex-basis: 100%;
  margin-top: 0;
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.5;
  text-align: right;
}

.input-translation-machine-hint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  background: var(--surface-soft);
  font-size: 11px;
  line-height: 1.55;
}

.input-translation-machine-hint .el-icon {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--brand);
}

.input-translation-prompt-toggle {
  justify-content: space-between;
  width: 100%;
  min-height: 42px;
  padding: 10px 0;
  text-align: left;
}

.input-translation-prompt-toggle > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.input-translation-prompt-toggle strong {
  color: var(--ink);
  font-size: 12px;
}

.input-translation-prompt-toggle small {
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.5;
}

.input-translation-prompt-toggle .el-icon {
  flex: 0 0 auto;
  transition: transform 160ms ease;
}

.input-translation-prompt-toggle[aria-expanded="true"] .el-icon {
  transform: rotate(180deg);
}

.input-translation-prompts {
  display: grid;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

.input-translation-prompts :deep(.prompt-template-field) {
  border-radius: 12px;
}

.input-translation-prompt-reset {
  justify-self: start;
  min-height: 28px;
  padding: 3px 0;
  font-size: 11px;
}

.input-translation-prompt-warning {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 0;
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, #d97706 35%, var(--line));
  border-radius: 8px;
  color: #9a5b04;
  background: color-mix(in srgb, #fff7ed 70%, var(--surface));
  font-size: 10.5px;
  line-height: 1.55;
}

.input-translation-prompt-warning .el-icon {
  flex: 0 0 auto;
  margin-top: 2px;
}

:global(:root.dark) .input-translation-prompt-warning {
  border-color: rgba(245, 158, 11, .38);
  color: #f4c36f;
  background: rgba(120, 74, 10, .18);
}

@media (max-width: 700px) {
  .input-translation-settings :deep(.settings-item-control) {
  flex-wrap: wrap;
  gap: 6px;
}

.input-translation-scope {
  margin: 0;
  padding: 12px 16px;
  color: var(--muted);
  font-size: 11px;
}

.input-translation-connection {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 0 16px 12px;
  color: var(--muted);
  font-size: 11px;
}

.input-translation-heading {
    margin-bottom: 14px;
    padding: 0;
  }

  .input-translation-interval-control {
    justify-content: flex-start;
  }

  .input-translation-control-help {
    text-align: left;
  }
}

@media (max-width: 480px) {
  .input-translation-interval-control :deep(.el-input-number) {
    width: min(100%, 180px);
  }

  .input-translation-reset {
    width: 100%;
    justify-content: center;
  }
}
</style>
