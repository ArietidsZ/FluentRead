import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

function source(path: string): string {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('popup feature visibility', () => {
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

    it('filters Chrome Translator but renders old synchronized selections as unavailable', () => {
        const popup = source('src/app/popup/PopupApp.vue');

        expect(popup).toContain('filterAvailableTranslationServices(allServiceOptions.value)');
        expect(popup).toContain('selectedServiceUnavailableMessage');
        expect(popup).toContain('selectedVideoServiceUnavailableMessage');
        expect(popup).toContain('Chrome内置AI翻译（当前浏览器不可用）');
        expect(popup).toContain('原有开关偏好已保留');
    });
});
