import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {popupQuickFeatureOptions} from '@/src/core/config/interfaceAppearance';

function source(path: string): string {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('popup feature visibility', () => {
    it('keeps the real Popup under a first-open language mask until confirmation', () => {
        const popup = source('src/app/popup/PopupApp.vue');
        const onboarding = source('src/ui/components/UiLanguageOnboarding.vue');
        const styles = source('src/app/popup/popup.css');
        const i18n = source('src/ui/i18n.ts');

        expect(popup).toContain('uiLanguageSetupCompleted');
        expect(popup).toContain('<UiLanguageOnboarding');
        expect(popup).toContain('<div class="popup-content" :inert="showLanguageOnboarding">');
        expect(popup).toContain('@confirmed="handleLanguageOnboardingConfirmed"');
        expect(popup).toContain('if (!showLanguageOnboarding.value) await hydrateCurrentSite();');
        expect(popup).toContain('void hydrateCurrentSite();');
        expect(onboarding).toContain('class="language-onboarding-backdrop"');
        expect(onboarding).toContain('data-testid="onboarding-welcome"');
        expect(onboarding).toContain('data-testid="onboarding-language-step"');
        expect(onboarding).toContain('WELCOME_GREETING_WORDS');
        expect(onboarding).toContain('getUiLanguageBilingualLabel(option.value)');
        expect(onboarding).toContain("messageZh('language.onboardingTitle')");
        expect(onboarding).toContain("messageEn('language.onboardingTitle')");
        expect(onboarding).toContain("messageZh('language.onboardingConfirm')");
        expect(onboarding).toContain("messageEn('language.onboardingConfirm')");
        expect(onboarding).not.toContain("messageZh('language.onboardingWelcomeDescription')");
        expect(onboarding).not.toContain("messageEn('language.onboardingWelcomeDescription')");
        expect(onboarding).not.toContain("messageZh('language.onboardingDescription')");
        expect(onboarding).not.toContain("messageEn('language.onboardingDescription')");
        expect(onboarding).not.toContain("language.onboardingBrowserHint");
        expect(onboarding).not.toContain("language.onboardingConfirmHint");
        expect(onboarding).not.toContain('class="onboarding-language-code"');
        expect(onboarding).toContain('class="onboarding-confirm-guide"');
        expect(onboarding).toContain('animation: onboarding-point 1.05s ease-in-out infinite');
        expect(onboarding).toContain('M8 1v15M3 12l5 5 5-5');
        expect(onboarding).not.toContain('>↘</span>');
        expect(onboarding).not.toContain('transform: rotate(8deg);\n  animation: onboarding-point');
        expect(onboarding).not.toContain('.onboarding-language-option:last-child:nth-child(odd)');
        expect(onboarding).toContain('data-testid="onboarding-language-next"');
        expect(onboarding).not.toContain('<select');
        expect(onboarding).toContain('.onboarding-success::before');
        expect(onboarding).not.toContain('.language-onboarding-card::before');
        expect(onboarding).toContain('class="onboarding-success"');
        expect(onboarding).toContain('setTimeout(() =>');
        expect(styles).toContain('.popup-shell.language-onboarding-shell { overflow: hidden; }');
        expect(i18n).toContain('function isRelevantUiMutation');
        expect(i18n).toContain('setTimeout(() => {');
        expect(i18n).toContain('state.observer.disconnect();');
    });

    it('places app language after extension status and target language first in translation display', () => {
        const settings = source('src/features/settings/ui/SettingsSections.vue');
        const options = source('src/app/options/OptionsApp.vue');

        expect(settings.indexOf('label="插件状态"')).toBeLessThan(settings.indexOf("t('settings.general.language')"));
        expect(settings.indexOf("t('settings.general.language')")).toBeLessThan(settings.indexOf('label="界面主题"'));
        expect(settings.indexOf("t('settings.general.defaultTargetLanguage')")).toBeGreaterThan(settings.indexOf('title="译文显示"'));
        expect(options).not.toContain('<UiLanguageSelector />');
        expect(options).not.toContain('<p>{{ activeItem.detail }}</p>');
    });

    it('uses multilingual labels in every target-language control', () => {
        const popup = source('src/app/popup/PopupApp.vue');
        const settings = source('src/features/settings/ui/SettingsSections.vue');
        const center = source('src/features/translation-center/ui/TranslationCenter.vue');
        const documentApp = source('src/app/document-translation/DocumentApp.vue');

        expect(popup).toContain('getMultilingualTargetLanguageLabel(item.value, item.label, language)');
        expect(settings).toContain(':label="getMultilingualTargetLanguageLabel(item.value, item.label, language)"');
        expect(center).toContain('getMultilingualTargetLanguageLabel(item.value, item.label, language)');
        expect(documentApp).toContain('getMultilingualTargetLanguageLabel(item.value, item.label, language)');
    });

    it('uses the same multilingual display policy for interface-language selectors', () => {
        const selector = source('src/ui/components/UiLanguageSelector.vue');
        const onboarding = source('src/ui/components/UiLanguageOnboarding.vue');

        expect(selector).toContain('getUiLanguageDisplayLabel(option.value, language)');
        expect(selector).toContain('<ElSelect');
        expect(selector).toContain('popper-class="ui-language-select-popper"');
        expect(selector).not.toContain('<select');
        expect(onboarding).toContain('getUiLanguageBilingualLabel(option.value)');
    });

    it('blocks early interaction until the stored configuration is hydrated', () => {
        const popup = source('src/app/popup/PopupApp.vue');
        const styles = source('src/app/popup/popup.css');
        const startup = source('src/app/popup/index.ts');

        expect(popup).toContain(':data-config-ready="hydrated ? \'true\' : \'false\'"');
        expect(popup).toContain(':inert="!hydrated"');
        expect(popup).toContain(':aria-busy="!hydrated"');
        expect(popup).toContain('watch(() => JSON.stringify(config.value)');
        expect(popup).toContain("}, { flush: 'post' });");
        expect(popup).toContain('!config.value.uiLanguageSetupCompleted');
        expect(styles).toContain('.popup-shell.config-loading { pointer-events: none; }');
        expect(startup.indexOf('await configReady')).toBeLessThan(startup.indexOf('const app = createApp(App)'));
        expect(popup).toContain('const config = ref(normalizeConfig(runtimeConfig))');
        expect(popup).not.toContain('ref(new Config())');
        expect(popup.indexOf('applyInterfaceSkin(config.value.interfaceSkin)')).toBeLessThan(popup.indexOf('hydrated.value = true'));
    });

    it('keeps full-page floating-ball settings out of the popup', () => {
        const popup = source('src/app/popup/PopupApp.vue');

        expect(popup).not.toContain("openDrawer('floating')");
        expect(popup).not.toContain("activeDrawer === 'floating'");
        expect(popup).not.toContain('全文悬浮球');
        expect(popup).not.toContain('启用或关闭全文翻译悬浮球');
        expect(popupQuickFeatureOptions).toHaveLength(6);
        expect(popup).toContain('v-for="feature in visiblePopupQuickFeatures"');
        expect(popup).toContain(':data-popup-quick-feature="feature.id"');
    });

    it('keeps full-page floating-ball and hotkey controls in the options page', () => {
        const options = source('src/features/settings/ui/SettingsSections.vue');

        expect(options).toContain('v-model="floatingBallEnabled"');
        expect(options).toContain('aria-label="全文翻译悬浮球"');
        expect(options).toContain(':model-value="config.floatingBallHotkey"');
        expect(options).toContain('aria-label="全文翻译快捷键"');
    });

    it('keeps beta labels out of every user-facing feature surface', () => {
        const userFacingSources = [
            'src/app/popup/PopupApp.vue',
            'src/app/document-translation/DocumentApp.vue',
            'src/features/settings/model/navigation.ts',
            'src/features/settings/ui/SettingsSections.vue',
            'src/core/config/catalog.ts',
            'src/features/video-subtitle/content/runtime.ts',
        ].map(source);
        const localizedCatalogs = [
            'src/core/i18n/messages/zh-CN.ts',
            'src/core/i18n/messages/en-US.ts',
            'src/core/i18n/messages/ja-JP.ts',
            'src/core/i18n/messages/ko-KR.ts',
            'src/core/i18n/messages/fr-FR.ts',
            'src/core/i18n/messages/ru-RU.ts',
            'src/core/i18n/messages/es-ES.ts',
            'src/core/i18n/messages/legacy-overrides.ts',
        ].map(source);
        const vocabulary = source('src/features/vocabulary/ui/VocabularyBook.vue');

        for (const content of userFacingSources) {
            expect(content).not.toMatch(/\bBeta\b|测试版/u);
        }
        for (const content of localizedCatalogs) {
            expect(content).not.toMatch(/\bBeta\b|Bêta|ベータ|베타|Бета/u);
        }
        expect(vocabulary).not.toMatch(/>\s*Beta\s*<|开启 Beta|Beta 已开启|单词本 Beta/u);
    });

    it('keeps the default-disabled video subtitle card visually neutral', () => {
        const popup = source('src/app/popup/PopupApp.vue');
        const styles = source('src/app/popup/popup.css');

        expect(popup).toContain("className: `video-feature-card${config.value.videoTranslationEnabled ? '' : ' needs-enable'}`");
        expect(popup).toContain(':class="feature.className"');
        expect(popup).toContain("'点击开启 · YouTube'");
        expect(styles).not.toMatch(/\.video-feature-card\.needs-enable\s*\{/u);
        expect(styles).toContain('.video-feature-card.needs-enable small { color: var(--brand-strong); font-weight: 700; }');
    });

    it('keeps unsupported capability explanations reachable while disabling only their actions', () => {
        const popup = source('src/app/popup/PopupApp.vue');

        expect(popup).toContain('当前浏览器暂不支持圈选翻译');
        expect(popup).toContain('当前浏览器暂不支持图片翻译与 OCR');
        expect(popup).toContain('v-else class="area-translation-block"');
        expect(popup).toContain('v-if="browserCapabilities.imageTranslation" class="setting-row"');
        expect(popup).toContain("image: 'settings-image-translation'");
        expect(popup).not.toContain(':disabled="!config.on || !browserCapabilities.imageTranslation"');
        expect(popup).not.toContain(':disabled="!browserCapabilities.areaTranslation"');
    });

    it('routes hover and selection drawers to the merged translation settings section', () => {
        const popup = source('src/app/popup/PopupApp.vue');

        expect(popup).toContain("hover: 'settings-translation'");
        expect(popup).toContain("selection: 'settings-translation'");
        expect(popup).not.toContain("'settings-shortcuts'");
    });

    it('keeps multi-profile editing in options while surfacing an accurate popup summary', () => {
        const popup = source('src/app/popup/PopupApp.vue');
        const styles = source('src/app/popup/popup.css');

        expect(popup).toContain("enabledQuickTranslationProfiles(config.value.quickTranslationProfiles, 'hover')");
        expect(popup).toContain('data-testid="popup-quick-hover-profiles"');
        expect(popup).toContain('{{ quickProfileSummary(profile) }}');
        expect(popup).toContain("t('popup.quickTranslation.defaultHoverShortcut')");
        expect(popup).toContain("t('popup.quickTranslation.defaultOnly', {count: quickHoverProfiles.length})");
        expect(popup).toContain(":aria-label=\"t('popup.quickTranslation.toggleDefaultHover')\"");
        expect(popup).toContain(':aria-checked="defaultHoverEnabled"');
        expect(popup).toContain("resolveConfiguredHotkey(config.value.hotkey, config.value.customHotkey)");
        expect(popup).not.toContain('aria-label="启用或关闭鼠标悬停翻译"');
        expect(popup).toContain("t('popup.quickTranslation.extraProfiles')");
        expect(popup).not.toContain('<QuickTranslationProfiles');
        expect(popup).toContain("enabledQuickTranslationProfiles(config.value.quickTranslationProfiles, 'full-page')");
        expect(popup).toContain("quickFullPageProfiles.value.length ? t('popup.quickTranslation.defaultNotSet') : t('common.notSet')");
        expect(popup).toContain("t('popup.quickTranslation.fullPageHint', {count: quickFullPageProfiles.value.length})");
        expect(popup).toContain(':title="fullPageHotkeyTitle"');
        expect(popup).toContain('findEnabledQuickTranslationHotkeyConflict');
        expect(popup).toContain(':validate="validateCustomMouseHotkey"');
        expect(styles).toContain('.quick-profile-preview-row');
        expect(styles).toContain('.setting-row small.independent-profile-note');
        expect(styles).toContain('flex: 0 1 84px');
        expect(styles).toContain('.translate-hotkey span');
        expect(popup).toContain('ref<HTMLElement | HTMLElement[] | null>(null)');
        expect(popup).toContain('Array.isArray(servicePicker.value)');
        expect(popup).toContain('pickers.some(picker => picker?.contains(target))');
        expect(popup).toContain('ref<HTMLInputElement | HTMLInputElement[] | null>(null)');
        expect(popup).toContain('Array.isArray(serviceSearchInput.value)');
        expect(popup).toContain('void nextTick(focusServiceSearchInput)');
    });

    it('filters Chrome Translator but renders old synchronized selections as unavailable', () => {
        const popup = source('src/app/popup/PopupApp.vue');

        expect(popup).toContain('filterAvailableTranslationServices(allServiceOptions.value)');
        expect(popup).toContain('selectedServiceUnavailableMessage');
        expect(popup).toContain('selectedVideoServiceUnavailableMessage');
        expect(popup).toContain('Chrome内置AI翻译（当前浏览器不可用）');
        expect(popup).toContain('原有开关偏好已保留');
    });

    it('supports quick popup search by service name and model keyword', () => {
        const popup = source('src/app/popup/PopupApp.vue');
        const styles = source('src/app/popup/popup.css');

        expect(popup).toContain('searchServiceOptions(');
        expect(popup).toContain('withCustomOpenAIServiceOptions(');
        expect(popup).toContain('config.value.customOpenAIProviders.forEach(provider => merged.set(provider.id, provider.models))');
        expect(popup).toContain('searchableModels.value');
        expect(popup).toContain('aria-label="搜索翻译服务或模型"');
        expect(popup).toContain('class="service-picker-panel" role="dialog" aria-label="选择翻译服务"');
        expect(popup).toContain('role="listbox" aria-label="匹配的翻译服务"');
        expect(popup).toContain('placeholder="搜索服务或模型，如 gpt、qwen"');
        expect(popup).toContain(':data-matching-models="item.matchingModels.join(\',\') || undefined"');
        expect(popup).toContain('没有找到包含“{{ serviceSearchQuery.trim() }}”的服务或模型');
        expect(popup).toContain('inputs[0]?.focus()');
        expect(popup).toContain('const moreServicesOpen = ref(true)');
        expect(popup).toContain('moreServicesOpen.value = true');
        expect(styles).toContain('.service-picker-results { min-height: 0; overflow-y: auto; scrollbar-width: thin; }');
    });
});
