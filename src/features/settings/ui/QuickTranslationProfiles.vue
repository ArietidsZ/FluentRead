<!--
 * @file src/features/settings/ui/QuickTranslationProfiles.vue
 * 文件职责：提供悬浮与全文翻译的多方案设置界面，让每个额外快捷键独立选择翻译服务、模型、目标语言和展示策略。
 * 主要内容：按动作筛选并编辑快捷翻译方案，复用快捷键录制与服务图标组件，聚合内置和自定义模型，并在新增、启停、删除及跨方案热键去重后发出完整配置快照。
 * 模块边界：组件只编辑父级传入的 QuickTranslationProfile 列表，不直接保存 Config、不注册网页快捷键或执行翻译；配置归一化与运行时路由仍由 core 和对应 feature 负责。
 -->
<template>
  <section
    ref="sectionRoot"
    class="quick-translation-profiles"
    :data-action="action"
    data-testid="quick-translation-profiles"
  >
    <header class="profiles-toolbar">
      <div class="profiles-copy">
        <h3>{{ heading }}</h3>
        <p>{{ t('quickTranslation.description') }}</p>
      </div>
      <div class="toolbar-actions">
        <span v-if="showCapacity" class="capacity-label">
          {{ isAtCapacity ? t('quickTranslation.capacityReached') : `${visibleProfiles.length} / ${MAX_QUICK_TRANSLATION_PROFILES}` }}
        </span>
        <button
          type="button"
          class="add-button"
          :disabled="isAtCapacity"
          :title="isAtCapacity ? t('quickTranslation.capacityLimit', {count: MAX_QUICK_TRANSLATION_PROFILES}) : ''"
          :data-testid="`quick-profile-add-${action}`"
          @click="addProfile($event)"
        >
          <span aria-hidden="true">＋</span>
          {{ translateLegacy('添加') }}
        </button>
      </div>
    </header>

    <div v-if="visibleProfiles.length" class="profile-list">
      <article
        v-for="profile in visibleProfiles"
        :key="profile.id"
        class="profile-card"
        :class="{ 'is-disabled': !profile.enabled || !profile.hotkey, 'is-expanded': isExpanded(profile.id), 'is-unavailable': !isProfileAvailable(profile) }"
        :data-profile-id="profile.id"
      >
        <div class="profile-summary-row">
          <button
            type="button"
            class="profile-summary"
            :aria-expanded="isExpanded(profile.id)"
            :aria-controls="editorId(profile.id)"
            @click="toggleExpanded(profile.id)"
          >
            <kbd :class="{ empty: !profile.hotkey }">{{ hotkeyLabel(profile.hotkey) }}</kbd>
            <ServiceIcon
              :service="effectiveService(profile)"
              :label="serviceLabel(effectiveService(profile))"
              size="small"
            />
            <span class="service-summary">
              <strong>{{ profileSummaryTitle(profile) }}</strong>
              <small :class="{ warning: !isProfileAvailable(profile) }">
                {{ profileSummaryDetail(profile) }}
              </small>
            </span>
            <span class="summary-chevron" aria-hidden="true">⌄</span>
          </button>

          <el-switch
            :model-value="profile.enabled && Boolean(profile.hotkey)"
            :disabled="!profile.hotkey"
            class="profile-switch"
            :aria-label="profileSwitchLabel(profile)"
            @update:model-value="setEnabled(profile.id, $event)"
          />
        </div>

        <div
          v-if="isExpanded(profile.id)"
          :id="editorId(profile.id)"
          class="profile-editor"
        >
          <label class="editor-field">
            <span>{{ translateLegacy('快捷键') }}</span>
            <button
              type="button"
              class="hotkey-button"
              :class="{ empty: !profile.hotkey }"
              :data-testid="`quick-profile-hotkey-${profile.id}`"
              @click="openHotkeyEditor(profile.id, $event)"
            >
              <kbd>{{ hotkeyLabel(profile.hotkey) }}</kbd>
              <small>{{ profile.hotkey ? t('quickTranslation.clickEdit') : t('quickTranslation.clickRecord') }}</small>
            </button>
            <small v-if="hotkeyConflictWarning(profile.hotkey)" class="field-hint field-warning">
              {{ t('quickTranslation.systemConflict', {warning: hotkeyConflictWarning(profile.hotkey)}) }}
            </small>
          </label>

          <label class="editor-field">
            <span>{{ translateLegacy('服务') }}</span>
            <el-select
              :model-value="profile.service"
              :placeholder="t('quickTranslation.followDefault', {value: serviceLabel(config.service)})"
              :aria-label="t('quickTranslation.translationServiceAria', {hotkey: hotkeyLabel(profile.hotkey)})"
              :data-testid="`quick-profile-service-${profile.id}`"
              @update:model-value="setService(profile.id, $event)"
            >
              <el-option :label="t('quickTranslation.followDefault', {value: serviceLabel(config.service)})" value="" />
              <el-option
                v-if="profile.service && !isProfileAvailable(profile)"
                :label="t('quickTranslation.serviceUnavailable', {service: serviceLabel(profile.service)})"
                :value="profile.service"
                disabled
              />
              <el-option
                v-for="option in serviceOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </label>

          <label v-if="usesModel(profile)" class="editor-field">
            <span>{{ translateLegacy('模型') }}</span>
            <el-select
              :model-value="profile.model"
              :placeholder="modelDefaultOptionLabel(profile)"
              :aria-label="t('quickTranslation.translationModelAria', {hotkey: hotkeyLabel(profile.hotkey)})"
              :data-testid="`quick-profile-model-${profile.id}`"
              @update:model-value="setModel(profile.id, $event)"
            >
              <el-option :label="modelDefaultOptionLabel(profile)" value="" />
              <el-option
                v-for="model in modelOptions(profile)"
                :key="model"
                :label="model"
                :value="model"
              />
            </el-select>
            <small v-if="!profile.service" class="field-hint">{{ t('quickTranslation.pinServiceHint') }}</small>
          </label>

          <label class="editor-field">
            <span>{{ translateLegacy('目标语言') }}</span>
            <el-select
              :model-value="profile.targetLanguage"
              :placeholder="t('quickTranslation.followDefault', {value: languageLabel(config.to)})"
              :aria-label="t('quickTranslation.targetLanguageAria', {hotkey: hotkeyLabel(profile.hotkey)})"
              :data-testid="`quick-profile-target-${profile.id}`"
              @update:model-value="setTargetLanguage(profile.id, $event)"
            >
              <el-option :label="t('quickTranslation.followDefault', {value: languageLabel(config.to)})" value="" />
              <el-option
                v-for="option in languageOptions(profile)"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </label>

          <label class="editor-field">
            <span>{{ translateLegacy('显示方式') }}</span>
            <el-select
              :model-value="displaySelectValue(profile)"
              :disabled="isGoogleProfile(profile)"
              :aria-label="t('quickTranslation.displayModeAria', {hotkey: hotkeyLabel(profile.hotkey)})"
              :data-testid="`quick-profile-display-${profile.id}`"
              @update:model-value="setDisplayMode(profile.id, $event)"
            >
              <el-option :label="t('quickTranslation.followDefault', {value: defaultDisplayModeLabel})" value="inherit" />
              <el-option :label="translateLegacy('双语对照')" value="bilingual" />
              <el-option :label="translateLegacy('仅译文')" value="translation-only" :disabled="isGoogleProfile(profile)" />
            </el-select>
          </label>

          <label v-if="action === 'full-page'" class="editor-field">
            <span>{{ t('quickTranslation.field.range') }}</span>
            <el-select
              :model-value="profile.fullPageMode"
              :aria-label="t('quickTranslation.fullPageRangeAria', {hotkey: hotkeyLabel(profile.hotkey)})"
              :data-testid="`quick-profile-range-${profile.id}`"
              @update:model-value="setFullPageMode(profile.id, $event)"
            >
              <el-option :label="t('quickTranslation.followDefault', {value: defaultFullPageModeLabel})" value="inherit" />
              <el-option :label="translateLegacy('按阅读进度')" value="viewport" />
              <el-option :label="translateLegacy('翻译到页底')" value="all" />
            </el-select>
          </label>

          <div class="editor-actions">
            <button
              type="button"
              class="delete-button"
              :aria-label="t('quickTranslation.deleteAria', {profile: profileAccessibleName(profile)})"
              @click="removeProfile(profile.id, $event)"
            >
              {{ t('quickTranslation.delete') }}
            </button>
          </div>
        </div>
      </article>
    </div>

    <CustomHotkeyInput
      v-model="hotkeyEditorOpen"
      :current-value="hotkeyEditorValue"
      :validate="validateProfileHotkey"
      @confirm="confirmHotkey"
      @cancel="closeHotkeyEditor"
    />
  </section>
</template>

<script setup lang="ts">
import {computed, nextTick, ref, watch} from 'vue'
import {ElMessage} from 'element-plus'
import {
  customModelString,
  getMultilingualTargetLanguageLabel,
  models,
  options,
  resolveConfiguredModel,
  services,
  servicesType,
} from '@/src/core/config/catalog'
import {
  getCustomOpenAIProvider,
  withCustomOpenAIServiceOptions,
} from '@/src/core/config/customOpenAI'
import type {Config} from '@/src/core/config/model'
import {
  createQuickTranslationProfile,
  inputBoxTranslationTriggerHotkey,
  MAX_QUICK_TRANSLATION_PROFILES,
  type QuickTranslationDisplayMode,
  type QuickTranslationFullPageMode,
  type QuickTranslationProfile,
} from '@/src/core/config/quickTranslation'
import {canonicalizeHotkey, parseHotkey, resolveConfiguredHotkey, validateHotkeyConflicts} from '@/src/core/hotkey'
import {filterAvailableTranslationServices, isTranslationServiceAvailable} from '@/src/services/translation/capabilities'
import CustomHotkeyInput from '@/src/ui/components/CustomHotkeyInput.vue'
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue'
import {useUiI18n} from '@/src/ui/i18n'

type SelectValue = string | number | boolean | undefined

interface ServiceOption {
  value: string
  label: string
}

interface LanguageOption {
  value: string
  label: string
}

const props = defineProps<{
  config: Config
  action: 'hover' | 'full-page'
  profiles: QuickTranslationProfile[]
}>()

const emit = defineEmits<{
  'update:profiles': [profiles: QuickTranslationProfile[]]
}>()

const {language, t, translateLegacy} = useUiI18n()

const expandedIds = ref(new Set<string>())
const sectionRoot = ref<HTMLElement | null>(null)
const hotkeyEditorOpen = ref(false)
const hotkeyEditorProfileId = ref('')
const hotkeyEditorTrigger = ref<HTMLElement | null>(null)
const creatingProfile = ref(false)

const heading = computed(() => t(`quickTranslation.heading.${props.action === 'hover' ? 'hover' : 'fullPage'}`))
const visibleProfiles = computed(() => props.profiles.filter((profile) => profile.action === props.action))
const isAtCapacity = computed(() => visibleProfiles.value.length >= MAX_QUICK_TRANSLATION_PROFILES)
const showCapacity = computed(() => visibleProfiles.value.length >= MAX_QUICK_TRANSLATION_PROFILES - 1)
const allServiceOptions = computed<ServiceOption[]>(() => withCustomOpenAIServiceOptions(
  options.services,
  props.config.customOpenAIProviders,
)
  .filter((option) => !option.disabled)
  .map((option) => ({value: option.value, label: translateLegacy(option.label)})))
const serviceOptions = computed<ServiceOption[]>(() => filterAvailableTranslationServices(allServiceOptions.value))
const defaultDisplayModeLabel = computed(() => translateLegacy(props.config.display === 0 ? '仅译文' : '双语对照'))
const defaultFullPageModeLabel = computed(() => props.config.fullPageTranslationMode === 'all'
  ? translateLegacy('翻译到页底')
  : translateLegacy('按阅读进度'))
const hotkeyEditorValue = computed(() => creatingProfile.value
  ? ''
  : props.profiles.find((profile) => profile.id === hotkeyEditorProfileId.value)?.hotkey || '')

watch(
  () => props.profiles.map((profile) => profile.id),
  (ids) => {
    const existing = new Set(ids)
    expandedIds.value = new Set([...expandedIds.value].filter((id) => existing.has(id)))
    if (hotkeyEditorProfileId.value && !existing.has(hotkeyEditorProfileId.value)) closeHotkeyEditor()
  },
)

function emitProfiles(profiles: QuickTranslationProfile[]): void {
  emit('update:profiles', profiles)
}

function updateProfile(id: string, patch: Partial<QuickTranslationProfile>): void {
  emitProfiles(props.profiles.map((profile) => profile.id === id ? {...profile, ...patch} : profile))
}

function addProfile(event?: MouseEvent): void {
  if (isAtCapacity.value) {
    ElMessage.warning(t('quickTranslation.capacityLimit', {count: MAX_QUICK_TRANSLATION_PROFILES}))
    return
  }
  creatingProfile.value = true
  hotkeyEditorProfileId.value = ''
  hotkeyEditorTrigger.value = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null
  hotkeyEditorOpen.value = true
}

function removeProfile(id: string, event?: MouseEvent): void {
  const index = visibleProfiles.value.findIndex((profile) => profile.id === id)
  const focusTargetId = visibleProfiles.value[index + 1]?.id || visibleProfiles.value[index - 1]?.id || ''
  emitProfiles(props.profiles.filter((profile) => profile.id !== id))
  const nextExpanded = new Set(expandedIds.value)
  nextExpanded.delete(id)
  expandedIds.value = nextExpanded
  if (hotkeyEditorProfileId.value === id) closeHotkeyEditor()
  if (event?.currentTarget instanceof HTMLElement) {
    void nextTick(() => {
      const cards = [...(sectionRoot.value?.querySelectorAll<HTMLElement>('.profile-card') || [])]
      const targetCard = cards.find((card) => card.dataset.profileId === focusTargetId)
      const target = targetCard?.querySelector<HTMLElement>('.profile-summary')
        || sectionRoot.value?.querySelector<HTMLElement>('.add-button')
      target?.focus({preventScroll: true})
    })
  }
}

function isExpanded(id: string): boolean {
  return expandedIds.value.has(id)
}

function toggleExpanded(id: string): void {
  const next = new Set(expandedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedIds.value = next
}

function editorId(id: string): string {
  return `quick-translation-profile-${id}`
}

function openHotkeyEditor(id: string, event?: MouseEvent): void {
  creatingProfile.value = false
  hotkeyEditorProfileId.value = id
  hotkeyEditorTrigger.value = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null
  hotkeyEditorOpen.value = true
}

function closeHotkeyEditor(): void {
  const trigger = hotkeyEditorTrigger.value
  hotkeyEditorOpen.value = false
  creatingProfile.value = false
  hotkeyEditorProfileId.value = ''
  hotkeyEditorTrigger.value = null
  void nextTick(() => trigger?.isConnected && trigger.focus({preventScroll: true}))
}

function hotkeyIdentity(hotkey: string): string {
  return (canonicalizeHotkey(hotkey) || hotkey.trim()).toLocaleLowerCase()
}

function legacyHotkeyEntries(): Array<{hotkey: string, label: string}> {
  const entries = [
    {hotkey: resolveConfiguredHotkey(props.config.hotkey, props.config.customHotkey), label: t('quickTranslation.defaultHover')},
    {hotkey: resolveConfiguredHotkey(props.config.floatingBallHotkey, props.config.customFloatingBallHotkey), label: t('quickTranslation.defaultFullPage')},
  ]
  if (props.config.selectionAreaEnabled) entries.push({hotkey: 'Shift+Z', label: translateLegacy('圈选翻译')})
  const inputBoxHotkey = inputBoxTranslationTriggerHotkey(props.config.inputBoxTranslationTrigger)
  if (inputBoxHotkey) entries.push({hotkey: inputBoxHotkey, label: translateLegacy('输入框翻译')})
  return entries.filter((entry) => Boolean(canonicalizeHotkey(entry.hotkey)))
}

function selectionHotkey(): string {
  if (props.config.selectionTranslatorMode === 'disabled') return ''
  return resolveConfiguredHotkey(
    props.config.selectionTranslatorTrigger,
    props.config.customSelectionTranslatorHotkey,
  )
}

function validateProfileHotkey(hotkey: string): string {
  const normalizedHotkey = hotkey === 'none' ? '' : canonicalizeHotkey(hotkey)
  const identity = hotkeyIdentity(normalizedHotkey)
  if (!identity) return ''
  const id = hotkeyEditorProfileId.value
  const duplicate = props.profiles.some((profile) => (
    profile.id !== id && hotkeyIdentity(profile.hotkey) === identity
  ))
  if (duplicate) return t('quickTranslation.duplicate')
  const legacyConflict = legacyHotkeyEntries()
    .find((entry) => hotkeyIdentity(entry.hotkey) === identity)
  return legacyConflict
    ? t('quickTranslation.legacyConflictEdit', {feature: legacyConflict.label})
    : ''
}

function confirmHotkey(hotkey: string): void {
  const id = hotkeyEditorProfileId.value
  const isCreating = creatingProfile.value
  if (!id && !isCreating) return
  const normalizedHotkey = hotkey === 'none' ? '' : canonicalizeHotkey(hotkey)
  if (isCreating && !normalizedHotkey) {
    ElMessage.warning(t('quickTranslation.recordFirst'))
    return
  }
  const validationMessage = validateProfileHotkey(normalizedHotkey)
  if (validationMessage) {
    ElMessage.warning(validationMessage)
    return
  }
  const identity = hotkeyIdentity(normalizedHotkey)
  if (isCreating) {
    const profile = {
      ...createQuickTranslationProfile(props.action, props.profiles),
      hotkey: normalizedHotkey,
      enabled: true,
    }
    emitProfiles([...props.profiles, profile])
    expandedIds.value = new Set([...expandedIds.value, profile.id])
  } else {
    updateProfile(id, {hotkey: normalizedHotkey, enabled: Boolean(normalizedHotkey)})
  }
  closeHotkeyEditor()
  if (identity && hotkeyIdentity(selectionHotkey()) === identity) {
    ElMessage.info(t('quickTranslation.selectionPrecedence'))
  }
}

function setEnabled(id: string, value: SelectValue): void {
  const profile = props.profiles.find((candidate) => candidate.id === id)
  if (value && !profile?.hotkey) {
    ElMessage.warning(t('quickTranslation.setFirst'))
    return
  }
  if (value && profile) {
    const identity = hotkeyIdentity(profile.hotkey)
    const legacyConflict = legacyHotkeyEntries()
      .find((entry) => hotkeyIdentity(entry.hotkey) === identity)
    if (legacyConflict) {
      ElMessage.warning(t('quickTranslation.legacyConflictEnable', {feature: legacyConflict.label}))
      return
    }
  }
  updateProfile(id, {enabled: Boolean(value)})
}

function setService(id: string, value: SelectValue): void {
  const service = typeof value === 'string' ? value : ''
  const profile = props.profiles.find((candidate) => candidate.id === id)
  updateProfile(id, {service, model: ''})
  if ((service || props.config.service) === services.google && profile?.displayMode !== 'bilingual') {
    ElMessage.info(t('quickTranslation.googleNotice'))
  }
}

function setModel(id: string, value: SelectValue): void {
  const model = typeof value === 'string' ? value : ''
  const profile = props.profiles.find((candidate) => candidate.id === id)
  if (model && profile && !profile.service) {
    updateProfile(id, {service: props.config.service, model})
    return
  }
  updateProfile(id, {model})
}

function setTargetLanguage(id: string, value: SelectValue): void {
  updateProfile(id, {targetLanguage: typeof value === 'string' ? value : ''})
}

function setDisplayMode(id: string, value: SelectValue): void {
  if (value !== 'inherit' && value !== 'bilingual' && value !== 'translation-only') return
  const profile = props.profiles.find((candidate) => candidate.id === id)
  if (value === 'translation-only' && profile && isGoogleProfile(profile)) {
    ElMessage.warning(t('quickTranslation.googleOnly'))
    return
  }
  updateProfile(id, {displayMode: value as QuickTranslationDisplayMode})
}

function setFullPageMode(id: string, value: SelectValue): void {
  if (value !== 'inherit' && value !== 'viewport' && value !== 'all') return
  updateProfile(id, {fullPageMode: value as QuickTranslationFullPageMode})
}

function effectiveService(profile: QuickTranslationProfile): string {
  return profile.service || props.config.service
}

function isGoogleProfile(profile: QuickTranslationProfile): boolean {
  return effectiveService(profile) === services.google
}

function isProfileAvailable(profile: QuickTranslationProfile): boolean {
  return isTranslationServiceAvailable(effectiveService(profile))
}

function serviceLabel(service: string): string {
  return allServiceOptions.value.find((option) => option.value === service)?.label || service || t('common.notSet')
}

function usesModel(profile: QuickTranslationProfile): boolean {
  return servicesType.isUseModel(effectiveService(profile))
}

function configuredDefaultModel(service: string): string {
  const provider = getCustomOpenAIProvider(props.config.customOpenAIProviders, service)
  return resolveConfiguredModel(props.config.model[service], props.config.customModel[service])
    || provider?.models[0]
    || models.get(service)?.find((model) => model !== customModelString)
    || ''
}

function summaryModel(profile: QuickTranslationProfile): string {
  if (profile.model) return profile.model
  const model = configuredDefaultModel(effectiveService(profile))
  return model || t('quickTranslation.defaultModel')
}

function modelDefaultOptionLabel(profile: QuickTranslationProfile): string {
  const model = configuredDefaultModel(effectiveService(profile))
  return model
    ? t('quickTranslation.followServiceDefaultModel', {model})
    : t('quickTranslation.followServiceDefault')
}

function modelOptions(profile: QuickTranslationProfile): string[] {
  const service = effectiveService(profile)
  const provider = getCustomOpenAIProvider(props.config.customOpenAIProviders, service)
  const builtIn = provider
    ? provider.models
    : (models.get(service) || []).filter((model) => model !== customModelString)
  const activeCustomModel = props.config.model[service] === customModelString
    ? props.config.customModel[service]?.trim()
    : ''
  return [...new Set([
    ...builtIn,
    ...(props.config.customModels[service] || []),
    activeCustomModel,
    configuredDefaultModel(service),
    profile.model,
  ].filter((model): model is string => Boolean(model)))]
}

function languageLabel(languageCode: string): string {
  const label = (options.to as LanguageOption[]).find((option) => option.value === languageCode)?.label
  return languageCode
    ? getMultilingualTargetLanguageLabel(languageCode, label || languageCode, language.value)
    : t('common.notSet')
}

function languageOptions(profile: QuickTranslationProfile): LanguageOption[] {
  const known = options.to as LanguageOption[]
  const values = !profile.targetLanguage || known.some((option) => option.value === profile.targetLanguage)
    ? known
    : [...known, {value: profile.targetLanguage, label: profile.targetLanguage}]
  return values.map((option) => ({
    ...option,
    label: getMultilingualTargetLanguageLabel(option.value, option.label, language.value),
  }))
}

function targetLanguageLabel(profile: QuickTranslationProfile): string {
  return profile.targetLanguage
    ? languageLabel(profile.targetLanguage)
    : languageLabel(props.config.to)
}

function displayModeLabel(profile: QuickTranslationProfile): string {
  if (isGoogleProfile(profile)) return `${translateLegacy('双语对照')} · ${t('quickTranslation.serviceRestriction')}`
  if (profile.displayMode === 'bilingual') return translateLegacy('双语对照')
  if (profile.displayMode === 'translation-only') return translateLegacy('仅译文')
  return defaultDisplayModeLabel.value
}

function displaySelectValue(profile: QuickTranslationProfile): QuickTranslationDisplayMode {
  return isGoogleProfile(profile) ? 'bilingual' : profile.displayMode
}

function fullPageModeLabel(profile: QuickTranslationProfile): string {
  if (profile.fullPageMode === 'all') return translateLegacy('翻译到页底')
  if (profile.fullPageMode === 'viewport') return translateLegacy('按阅读进度')
  return defaultFullPageModeLabel.value
}

function hasProfileOverrides(profile: QuickTranslationProfile): boolean {
  return Boolean(profile.service || profile.model || profile.targetLanguage
    || profile.displayMode !== 'inherit'
    || (props.action === 'full-page' && profile.fullPageMode !== 'inherit'))
}

function profileSummaryTitle(profile: QuickTranslationProfile): string {
  if (!hasProfileOverrides(profile)) return t('quickTranslation.useDefaults')
  const service = serviceLabel(effectiveService(profile))
  return usesModel(profile) ? `${service} · ${summaryModel(profile)}` : service
}

function profileSummaryDetail(profile: QuickTranslationProfile): string {
  const detail = [
    targetLanguageLabel(profile),
    displayModeLabel(profile),
    ...(props.action === 'full-page' ? [fullPageModeLabel(profile)] : []),
  ].join(' · ')
  if (!isProfileAvailable(profile)) return t('quickTranslation.profileUnavailable', {detail})
  if (!profile.enabled) return t('quickTranslation.profilePaused', {detail})
  return detail
}

function hotkeyLabel(hotkey: string): string {
  if (!hotkey) return translateLegacy('待设置')
  const parsed = parseHotkey(hotkey)
  return parsed.isValid ? parsed.displayName : hotkey
}

function hotkeyConflictWarning(hotkey: string): string {
  if (!hotkey) return ''
  const warning = validateHotkeyConflicts(parseHotkey(hotkey)).conflictDescription || ''
  return translateLegacy(warning.replace(/^与系统快捷键冲突:\s*/u, ''))
}

function profileAccessibleName(profile: QuickTranslationProfile): string {
  const index = visibleProfiles.value.findIndex((candidate) => candidate.id === profile.id) + 1
  const actionLabel = t(`quickTranslation.action.${props.action === 'hover' ? 'hover' : 'fullPage'}`)
  return t('quickTranslation.profileName', {
    action: actionLabel,
    index: index > 0 ? index : '',
    hotkey: hotkeyLabel(profile.hotkey),
  }).trim()
}

function profileSwitchLabel(profile: QuickTranslationProfile): string {
  const profileName = profileAccessibleName(profile)
  if (!profile.hotkey) return t('quickTranslation.profileNeedsHotkey', {profile: profileName})
  if (profile.enabled) {
    return t(isProfileAvailable(profile)
      ? 'quickTranslation.disableProfile'
      : 'quickTranslation.disableProfileUnavailable', {profile: profileName})
  }
  return t(isProfileAvailable(profile)
    ? 'quickTranslation.enableProfile'
    : 'quickTranslation.enableProfileUnavailable', {profile: profileName})
}
</script>

<style scoped>
.quick-translation-profiles {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 13px 16px 15px;
  border-top: 1px solid var(--line, #e5e8ef);
  color: var(--ink, #172033);
}

.profiles-toolbar,
.toolbar-actions,
.profile-summary-row,
.profile-summary,
.add-button,
.hotkey-button {
  display: flex;
  align-items: center;
}

.profiles-toolbar {
  justify-content: space-between;
  gap: 18px;
}

.profiles-copy {
  min-width: 0;
}

.profiles-copy h3,
.profiles-copy p {
  margin: 0;
}

.profiles-copy h3 {
  font-size: 12px;
  line-height: 1.4;
}

.profiles-copy p {
  margin-top: 3px;
  color: var(--muted, #737c8f);
  font-size: 10px;
  line-height: 1.45;
}

.toolbar-actions {
  flex: none;
  gap: 8px;
}

.capacity-label {
  flex: none;
  color: var(--muted, #737c8f);
  font-size: 9.5px;
  font-weight: 650;
}

.profile-list {
  display: grid;
  gap: 7px;
  margin-top: 11px;
}

.profile-card {
  overflow: hidden;
  border: 1px solid var(--line, #e5e8ef);
  border-radius: 11px;
  background: var(--surface, #fff);
  transition: border-color 150ms ease, background 150ms ease;
}

.profile-card:hover,
.profile-card.is-expanded {
  border-color: rgba(239, 71, 118, .34);
}

.profile-card.is-unavailable {
  border-style: dashed;
}

.profile-summary-row {
  min-width: 0;
  padding: 8px 10px;
}

.profile-summary {
  flex: 1;
  min-width: 0;
  gap: 8px;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.profile-summary:focus-visible,
.delete-button:focus-visible,
.add-button:focus-visible,
.hotkey-button:focus-visible {
  outline: 2px solid rgba(239, 71, 118, .35);
  outline-offset: 2px;
}

kbd {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.profile-summary > kbd {
  flex: none;
  min-width: 62px;
  max-width: 96px;
  padding: 5px 8px;
  overflow: hidden;
  border: 1px solid rgba(239, 71, 118, .2);
  border-radius: 8px;
  color: var(--brand-strong, #dc315f);
  background: var(--brand-soft, #fff0f4);
  font-size: 10px;
  font-weight: 750;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-summary > kbd.empty {
  border-color: var(--line, #e5e8ef);
  color: var(--muted, #737c8f);
  background: var(--surface-soft, #f7f8fb);
}

.service-summary {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.service-summary strong,
.service-summary small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.service-summary strong {
  font-size: 11.5px;
  line-height: 1.35;
}

.service-summary small {
  margin-top: 2px;
  color: var(--muted, #737c8f);
  font-size: 9.5px;
}

.service-summary small.warning {
  color: #9c6b12;
}

.summary-chevron {
  flex: none;
  color: var(--muted, #737c8f);
  font-size: 13px;
  transform: rotate(0deg);
  transition: transform 150ms ease;
}

.is-expanded .summary-chevron {
  transform: rotate(180deg);
}

.profile-switch {
  flex: none;
  margin-left: 9px;
}

.delete-button {
  padding: 6px 2px;
  border: 0;
  border-radius: 7px;
  color: #b42b50;
  background: transparent;
  cursor: pointer;
  font-size: 10px;
  font-weight: 650;
}

.delete-button:hover {
  color: #c52751;
  text-decoration: underline;
}

.profile-editor {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 13px 12px 10px;
  border-top: 1px solid var(--line, #e5e8ef);
  background: var(--surface-soft, #f7f8fb);
}

.editor-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.editor-field > span {
  color: var(--muted, #737c8f);
  font-size: 10px;
  font-weight: 700;
}

.editor-field :deep(.el-select) {
  width: 100%;
}

.editor-field :deep(.el-select__wrapper) {
  min-height: 38px;
  border-radius: 10px;
  box-shadow: 0 0 0 1px var(--line, #e5e8ef) inset;
}

.field-hint {
  margin-top: -2px;
  color: var(--muted, #737c8f);
  font-size: 9px;
}

.field-warning {
  color: #9c6b12;
  line-height: 1.45;
}

.editor-actions {
  display: flex;
  grid-column: 1 / -1;
  justify-content: flex-end;
  padding-top: 1px;
}

.hotkey-button {
  justify-content: space-between;
  gap: 12px;
  min-height: 40px;
  padding: 7px 10px;
  border: 1px solid var(--line, #e5e8ef);
  border-radius: 10px;
  color: var(--ink, #172033);
  background: var(--surface, #fff);
  cursor: pointer;
  text-align: left;
}

.hotkey-button:hover {
  border-color: var(--brand, #ef4776);
}

.hotkey-button kbd {
  color: var(--brand-strong, #dc315f);
  font-size: 11px;
  font-weight: 750;
}

.hotkey-button.empty kbd {
  color: var(--muted, #737c8f);
}

.hotkey-button small {
  color: var(--muted, #737c8f);
  font-size: 9px;
}

.add-button {
  justify-content: center;
  gap: 4px;
  min-height: 31px;
  padding: 5px 10px;
  border: 1px solid rgba(239, 71, 118, .28);
  border-radius: 9px;
  color: var(--brand-strong, #dc315f);
  background: var(--brand-soft, #fff0f4);
  cursor: pointer;
  font-size: 10px;
  font-weight: 750;
}

.add-button:hover:not(:disabled) {
  border-color: rgba(239, 71, 118, .48);
  background: rgba(239, 71, 118, .12);
}

.add-button > span {
  font-size: 12px;
}

.add-button:disabled {
  cursor: not-allowed;
  opacity: .5;
}

@media (max-width: 900px) {
  .profile-editor {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .quick-translation-profiles {
    padding: 12px;
  }

  .profiles-toolbar {
    align-items: flex-start;
  }

  .profiles-copy p {
    max-width: 210px;
  }

  .profile-summary-row {
    padding: 9px;
  }

  .profile-editor {
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    padding: 11px;
  }

  .editor-actions {
    grid-column: 1;
  }
}

@media (max-width: 420px) {
  .profiles-toolbar {
    gap: 10px;
  }

  .profiles-copy p {
    display: none;
  }

  .profile-summary > :deep(.service-brand-icon) {
    display: none;
  }

  .profile-summary > kbd {
    min-width: 56px;
    max-width: 76px;
  }

  .profile-switch {
    margin-left: 6px;
  }
}
</style>
