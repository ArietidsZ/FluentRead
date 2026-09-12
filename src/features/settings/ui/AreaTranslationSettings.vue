<!--
 * @file src/features/settings/ui/AreaTranslationSettings.vue
 * 文件职责：提供独立圈选翻译设置，组织触发快捷键、识别与翻译的常用选择，并按需提供提示词和本地语言包设置。
 * 主要内容：复用设置行和品牌按钮，提供预设与自定义录制的圈选快捷键及占用提示，显示当前模型识图能力，通过独立编辑弹窗修改识图提示词，将 OCR 语言设置收纳在可展开区域。
 * 模块边界：只修改父级配置并发出开关事件；配置持久化由 SettingsSections 负责，快捷键解析与归一化归 core，不截图、不调用模型、不下载识别资源。
 -->
<template>
  <SettingsGroup :title="t('area.settings.title')" :description="t('area.settings.intro')">
    <p v-if="!browserCapabilities.areaTranslation" class="area-settings-note" role="status">{{ t('area.settings.unavailable') }}</p>
    <FeatureEnableCard :model-value="props.enabled" :title="t('area.settings.enabled')" :description="t('area.settings.shortcut', {shortcut: hotkeyDisplayName})" :disabled="!browserCapabilities.areaTranslation" @update:model-value="emit('update:enabled', $event)" />
    <SettingsItem :label="t('area.settings.hotkey')" :description="t('area.settings.hotkeyDescription')" :disabled="!browserCapabilities.areaTranslation">
      <div class="hotkey-config">
        <el-select :model-value="props.config.selectionAreaHotkey" :aria-label="t('area.settings.hotkey')" :disabled="!browserCapabilities.areaTranslation" @change="handleHotkeyChange">
          <el-option v-for="item in AREA_TRANSLATION_HOTKEY_OPTIONS" :key="item.value" :value="item.value" :label="item.label" data-i18n-ignore />
          <el-option value="custom" :label="t('area.settings.hotkeyCustom')" />
        </el-select>
        <div v-if="props.config.selectionAreaHotkey === 'custom'" class="area-hotkey-custom">
          <span v-if="props.config.customSelectionAreaHotkey" class="area-hotkey-text" data-i18n-ignore>{{ hotkeyDisplayName }}</span>
          <span v-else class="area-hotkey-text area-hotkey-placeholder">{{ t('area.settings.hotkeyCustomEmpty') }}</span>
          <el-button size="small" type="text" :aria-label="t('area.settings.hotkeyEdit')" :title="t('area.settings.hotkeyEdit')" @click="showCustomHotkeyDialog = true">
            <el-icon><Edit /></el-icon>
          </el-button>
        </div>
      </div>
    </SettingsItem>
    <SettingsItem :label="t('area.settings.service')" :description="serviceDescription">
      <el-select v-model="props.config.areaTranslationService" :aria-label="t('area.settings.service')" :placeholder="t('area.settings.followService')">
        <el-option :value="''" :label="t('area.settings.followService')" />
        <el-option v-if="savedServiceUnavailable" :value="props.config.areaTranslationService" :label="props.config.areaTranslationService" disabled />
        <el-option v-for="item in props.serviceOptions" :key="item.value" :value="item.value" :label="item.label" :disabled="item.disabled" />
      </el-select>
    </SettingsItem>
    <p v-if="unavailableMessage" class="area-settings-note area-settings-warning" role="status">{{ unavailableMessage }}</p>
    <SettingsItem :label="t('area.settings.recognitionMode')" :description="t(prefersVision ? capabilityMessageKey : 'area.settings.recognitionModeDescription')">
      <el-select v-model="props.config.areaRecognitionMode" data-testid="area-recognition-mode" :aria-label="t('area.settings.recognitionMode')">
        <el-option value="prefer-vision" :label="t('area.settings.recognitionVision')" />
        <el-option value="ocr" :label="t('area.settings.recognitionOcr')" />
      </el-select>
    </SettingsItem>
    <SettingsItem :label="t('area.settings.mode')" :description="t(props.config.areaTranslationMode === 'ai' ? 'area.settings.aiDescription' : 'area.settings.standardDescription')">
      <el-select v-model="props.config.areaTranslationMode" :aria-label="t('area.settings.mode')">
        <el-option value="standard" :label="t('area.settings.standard')" />
        <el-option value="ai" :label="t('area.settings.ai')" :disabled="!supportsAI" />
      </el-select>
    </SettingsItem>
    <p v-if="!supportsAI" class="area-settings-note" :class="{'area-settings-warning': props.config.areaTranslationMode === 'ai'}" role="status">{{ t('area.settings.chooseAI') }}</p>
    <SettingsItem v-if="prefersVision" :label="t('area.settings.visionPrompt')" :description="t('area.settings.visionPromptDescription')">
      <el-button plain @click="promptEditorOpen = true">{{ t('area.settings.editVisionPrompt') }}</el-button>
    </SettingsItem>
    <p class="area-settings-note area-privacy">{{ t(prefersVision ? 'area.settings.visionPrivacy' : 'area.settings.privacy') }}</p>
  </SettingsGroup>
  <details class="area-ocr-details" :open="!prefersVision">
    <summary>{{ t('area.settings.ocrDetails') }}</summary>
    <SettingsGroup>
      <SettingsItem :label="t('area.settings.sourceLanguage')" :description="t('area.settings.sourceLanguageDescription')">
        <el-select v-model="props.config.from" :aria-label="t('area.settings.sourceLanguage')">
          <el-option v-if="!sourceLanguages.some(item => item.value === props.config.from)" :value="props.config.from" :label="props.config.from" disabled />
          <el-option v-for="item in sourceLanguages" :key="item.value" :value="item.value" :label="t(item.label)" />
        </el-select>
      </SettingsItem>
    </SettingsGroup>
    <ImageOcrSettings id-prefix="area" />
  </details>
  <el-dialog v-model="promptEditorOpen" :title="t('area.settings.visionPrompt')" width="min(640px, calc(100vw - 32px))" append-to-body destroy-on-close>
    <p class="area-prompt-description">{{ t('area.settings.visionPromptDescription') }}</p>
    <el-input v-model="props.config.areaVisionPrompt" data-testid="area-vision-prompt" type="textarea" :rows="8" :aria-label="t('area.settings.visionPrompt')" />
    <template #footer>
      <div class="area-prompt-actions">
        <el-button text @click="props.config.areaVisionPrompt = DEFAULT_AREA_VISION_PROMPT">{{ t('area.settings.restorePrompt') }}</el-button>
        <el-button type="primary" @click="promptEditorOpen = false">{{ t('area.settings.promptDone') }}</el-button>
      </div>
    </template>
  </el-dialog>
  <CustomHotkeyInput
    v-model="showCustomHotkeyDialog"
    :current-value="props.config.customSelectionAreaHotkey"
    :validate="findHotkeyConflict"
    @confirm="handleCustomHotkeyConfirm"
    @cancel="handleCustomHotkeyCancel"
  />
</template>

<script setup lang="ts">
import FeatureEnableCard from '@/src/ui/components/FeatureEnableCard.vue';
import {computed, defineAsyncComponent, ref} from 'vue';
import {Edit} from '@element-plus/icons-vue';
import {ElMessage} from 'element-plus';
import type {Config} from '@/src/core/config/model';
import {resolveConfiguredModel, servicesType} from '@/src/core/config/catalog';
import {DEFAULT_AREA_VISION_PROMPT, resolveModelVisionCapability} from '@/src/core/config/vision';
import {
    areaTranslationHotkeyDisplayName,
    AREA_TRANSLATION_HOTKEY_OPTIONS,
    DEFAULT_AREA_TRANSLATION_HOTKEY,
} from '@/src/core/config/areaTranslation';
import {canonicalizeHotkey, resolveConfiguredHotkey} from '@/src/core/hotkey';
import {
    findEnabledQuickTranslationHotkeyConflict,
    inputBoxTranslationTriggerHotkey,
} from '@/src/core/config/quickTranslation';
import {browserCapabilities} from '@/src/platform/browser/capabilities';
import {getTranslationServiceUnavailableMessage} from '@/src/services/translation/capabilities';
import {ImageOcrSettings} from '@/src/features/image-translation/public';
import {useUiI18n} from '@/src/ui/i18n';
import SettingsGroup from './components/SettingsGroup.vue';
import SettingsItem from './components/SettingsItem.vue';

const CustomHotkeyInput = defineAsyncComponent(() => import('@/src/ui/components/CustomHotkeyInput.vue'));

const props = defineProps<{
  config: Config;
  enabled: boolean;
  serviceOptions: readonly {value: string; label: string; disabled?: boolean}[];
}>();
const emit = defineEmits<{'update:enabled': [enabled: boolean]}>();
const {t, translateLegacy} = useUiI18n();
const showCustomHotkeyDialog = ref(false);
let previousHotkey = '';
const hotkeyDisplayName = computed(() => areaTranslationHotkeyDisplayName(
    props.config.selectionAreaHotkey,
    props.config.customSelectionAreaHotkey,
));

/** 列出已被其他功能占用的快捷键，避免两个功能同时响应同一个组合键。 */
function reservedHotkeyOwners(): {hotkey: string; feature: string}[] {
    return [
        {hotkey: resolveConfiguredHotkey(props.config.hotkey, props.config.customHotkey), feature: t('popup.hoverTranslation')},
        {hotkey: resolveConfiguredHotkey(props.config.floatingBallHotkey, props.config.customFloatingBallHotkey), feature: t('quickTranslation.commonFullPageShortcut')},
        {
            // 划词已停用时它的旧快捷键不再接管按键，不应阻止圈选使用同一个组合键。
            hotkey: props.config.selectionTranslatorMode === 'disabled'
                ? ''
                : resolveConfiguredHotkey(props.config.selectionTranslatorTrigger, props.config.customSelectionTranslatorHotkey),
            feature: t('popup.selectionTranslation'),
        },
        {hotkey: inputBoxTranslationTriggerHotkey(props.config.inputBoxTranslationTrigger), feature: translateLegacy('输入框翻译')},
    ];
}

/** 供自定义录制对话框实时校验；返回空字符串表示可以使用。 */
function findHotkeyConflict(hotkey: string): string {
    const identity = canonicalizeHotkey(hotkey).toLocaleLowerCase();
    if (!identity) return '';
    const owner = reservedHotkeyOwners().find(item => canonicalizeHotkey(item.hotkey).toLocaleLowerCase() === identity);
    if (owner) return t('area.settings.hotkeyConflict', {feature: owner.feature});
    const profile = findEnabledQuickTranslationHotkeyConflict(props.config.quickTranslationProfiles, hotkey);
    if (!profile) return '';
    return t('quickTranslation.conflictProfile', {
        group: t(`quickTranslation.heading.${profile.action === 'hover' ? 'hover' : 'fullPage'}`),
    });
}

function handleHotkeyChange(value: string): void {
    if (value !== 'custom') {
        const conflict = findHotkeyConflict(value);
        if (conflict) {
            ElMessage.warning(conflict);
            return;
        }
        props.config.selectionAreaHotkey = value;
        return;
    }
    // 还没有录制过自定义组合键时记住原值，取消录制即可恢复，不会让圈选失去入口。
    if (!props.config.customSelectionAreaHotkey) previousHotkey = props.config.selectionAreaHotkey;
    props.config.selectionAreaHotkey = 'custom';
    if (!props.config.customSelectionAreaHotkey) showCustomHotkeyDialog.value = true;
}

function handleCustomHotkeyConfirm(hotkey: string): void {
    const canonical = canonicalizeHotkey(hotkey);
    if (canonical && findHotkeyConflict(canonical)) return;
    // 清除自定义组合键等于放弃自定义入口；圈选没有别的触发方式，因此回到默认预设而不是停用。
    props.config.customSelectionAreaHotkey = canonical;
    props.config.selectionAreaHotkey = canonical ? 'custom' : DEFAULT_AREA_TRANSLATION_HOTKEY;
    showCustomHotkeyDialog.value = false;
    previousHotkey = '';
    ElMessage({message: t('area.settings.hotkeySet', {shortcut: hotkeyDisplayName.value}), type: 'success', duration: 2000});
}

function handleCustomHotkeyCancel(): void {
    if (!props.config.customSelectionAreaHotkey) {
        props.config.selectionAreaHotkey = previousHotkey || DEFAULT_AREA_TRANSLATION_HOTKEY;
    }
    previousHotkey = '';
}
const service = computed(() => props.config.areaTranslationService || props.config.service);
const model = computed(() => resolveConfiguredModel(props.config.model[service.value], props.config.customModel[service.value]));
const serviceDescription = computed(() => model.value
  ? `${props.serviceOptions.find(item => item.value === service.value)?.label || service.value} · ${model.value}`
  : t('area.settings.serviceDescription'));
const capability = computed(() => resolveModelVisionCapability(service.value, model.value, props.config.modelVision));
const prefersVision = computed(() => props.config.areaRecognitionMode === 'prefer-vision');
const promptEditorOpen = ref(false);
const capabilityMessageKey = computed(() => capability.value === 'supported'
  ? 'area.settings.capabilitySupported'
  : capability.value === 'unsupported' ? 'area.settings.capabilityUnsupported' : 'area.settings.capabilityUnknown');
const supportsAI = computed(() => servicesType.isUseAIContext(
  service.value,
  resolveConfiguredModel(props.config.model[service.value], props.config.customModel[service.value]),
));
const unavailableMessage = computed(() => getTranslationServiceUnavailableMessage(service.value));
const savedServiceUnavailable = computed(() => props.config.areaTranslationService
  && !props.serviceOptions.some(item => item.value === props.config.areaTranslationService));
const sourceLanguages = [
  {value: 'auto', label: 'area.settings.languageAuto'},
  {value: 'en', label: 'area.settings.languageEnglish'},
  {value: 'zh-Hans', label: 'area.settings.languageChinese'},
  {value: 'zh-Hant', label: 'area.settings.languageTraditionalChinese'},
  {value: 'ja', label: 'area.settings.languageJapanese'},
];
</script>

<style scoped>
.area-settings-note { margin: 8px 16px 16px; color: var(--muted); font-size: 12px; line-height: 1.65; }
.area-settings-warning { color: var(--el-color-warning); }
.area-privacy { margin-top: 0; padding-top: 12px; border-top: 1px solid var(--line); }
.area-ocr-details { width: min(100%, 1080px); margin: 0 auto 24px; }
.area-ocr-details > summary { padding: 2px 2px 14px; color: var(--muted); font-size: 12px; font-weight: 600; cursor: pointer; }
.area-ocr-details > summary:hover { color: var(--ink); }
.area-prompt-description { margin: 0 0 14px; color: var(--muted); font-size: 12px; line-height: 1.6; }
.area-prompt-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.hotkey-config { display: flex; flex-direction: column; gap: 8px; }
.area-hotkey-custom { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 8px; border: 1px dashed var(--line); border-radius: 8px; }
.area-hotkey-text { color: var(--ink); font-size: 12px; overflow-wrap: anywhere; }
.area-hotkey-placeholder { color: var(--muted); }
</style>
