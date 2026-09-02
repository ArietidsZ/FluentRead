import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

function source(path: string): string {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('popup feature visibility', () => {
    it('keeps the real Popup under a first-open language mask until confirmation', () => {
        const popup = source('src/app/popup/PopupApp.vue');
        const onboarding = source('src/ui/components/UiLanguageOnboarding.vue');
        const styles = source('src/app/popup/popup.css');

        expect(popup).toContain('uiLanguageSetupCompleted');
        expect(popup).toContain('<UiLanguageOnboarding');
        expect(popup).toContain('<div class="popup-content" :inert="showLanguageOnboarding">');
        expect(popup).toContain('@confirmed="handleLanguageOnboardingConfirmed"');
        expect(onboarding).toContain('class="language-onboarding-backdrop"');
        expect(onboarding).toContain('class="onboarding-success"');
        expect(onboarding).toContain('setTimeout(() =>');
        expect(styles).toContain('.popup-shell.language-onboarding-shell { overflow: hidden; }');
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

    it('blocks early interaction until the stored configuration is hydrated', () => {
        const popup = source('src/app/popup/PopupApp.vue');
        const styles = source('src/app/popup/popup.css');

        expect(popup).toContain(':data-config-ready="hydrated ? \'true\' : \'false\'"');
        expect(popup).toContain(':inert="!hydrated"');
        expect(popup).toContain(':aria-busy="!hydrated"');
        expect(popup).toContain('watch(() => JSON.stringify(config.value)');
        expect(styles).toContain('.popup-shell.config-loading { pointer-events: none; }');
    });

    it('keeps full-page floating-ball settings out of the popup', () => {
        const popup = source('src/app/popup/PopupApp.vue');

        expect(popup).not.toContain("openDrawer('floating')");
        expect(popup).not.toContain("activeDrawer === 'floating'");
        expect(popup).not.toContain('全文悬浮球');
        expect(popup).not.toContain('启用或关闭全文翻译悬浮球');
        expect(popup.match(/class="feature-card\b/gu)).toHaveLength(6);
    });

    it('keeps full-page floating-ball and hotkey controls in the options page', () => {
        const options = source('src/features/settings/ui/SettingsSections.vue');

        expect(options).toContain('v-model="floatingBallEnabled"');
        expect(options).toContain('aria-label="全文翻译悬浮球"');
        expect(options).toContain('v-model="config.floatingBallHotkey"');
        expect(options).toContain('aria-label="全文翻译快捷键"');
    });

    it('keeps the default-disabled video subtitle card visually neutral', () => {
        const popup = source('src/app/popup/PopupApp.vue');
        const styles = source('src/app/popup/popup.css');

        expect(popup).toContain(":class=\"{ 'needs-enable': !config.videoTranslationEnabled }\"");
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
        expect(popup).toContain('serviceSearchInput.value?.focus()');
        expect(popup).toContain('const moreServicesOpen = ref(false)');
        expect(popup).toContain('moreServicesOpen.value = selectedServiceIsMore.value');
        expect(styles).toContain('.service-picker-results { min-height: 0; overflow-y: auto; scrollbar-width: thin; }');
    });
});
