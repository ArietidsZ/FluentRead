<!--
 * @file src/features/settings/ui/AreaTranslationSettings.vue
 * 文件职责：提供独立圈选翻译设置，组织识别与翻译的常用选择，并按需提供提示词和本地语言包设置。
 * 主要内容：复用设置行和品牌按钮，显示当前模型识图能力，通过独立编辑弹窗修改识图提示词，将 OCR 语言设置收纳在可展开区域。
 * 模块边界：只修改父级配置并发出开关事件；配置持久化和快捷键冲突由 SettingsSections 处理，不截图、不调用模型、不下载识别资源。
 -->
<template>
  <SettingsGroup :title="t('area.settings.title')" :description="t('area.settings.intro')">
    <p v-if="!browserCapabilities.areaTranslation" class="area-settings-note" role="status">{{ t('area.settings.unavailable') }}</p>
    <FeatureEnableCard :model-value="props.enabled" :title="t('area.settings.enabled')" :description="t('area.settings.shortcut')" :disabled="!browserCapabilities.areaTranslation" @update:model-value="emit('update:enabled', $event)" />
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
        <el-option value="ocr" :label="t('area.settings.recognitionOcr')" />
        <el-option value="prefer-vision" :label="t('area.settings.recognitionVision')" />
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
</template>

<script setup lang="ts">
import FeatureEnableCard from '@/src/ui/components/FeatureEnableCard.vue';
import {computed, ref} from 'vue';
import type {Config} from '@/src/core/config/model';
import {resolveConfiguredModel, servicesType} from '@/src/core/config/catalog';
import {DEFAULT_AREA_VISION_PROMPT, resolveModelVisionCapability} from '@/src/core/config/vision';
import {browserCapabilities} from '@/src/platform/browser/capabilities';
import {getTranslationServiceUnavailableMessage} from '@/src/services/translation/capabilities';
import {ImageOcrSettings} from '@/src/features/image-translation/public';
import {useUiI18n} from '@/src/ui/i18n';
import SettingsGroup from './components/SettingsGroup.vue';
import SettingsItem from './components/SettingsItem.vue';

const props = defineProps<{
  config: Config;
  enabled: boolean;
  serviceOptions: readonly {value: string; label: string; disabled?: boolean}[];
}>();
const emit = defineEmits<{'update:enabled': [enabled: boolean]}>();
const {t} = useUiI18n();
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
</style>
