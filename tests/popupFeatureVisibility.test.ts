import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

function source(path: string): string {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('popup feature visibility', () => {
    it('keeps full-page floating-ball settings out of the popup', () => {
        const popup = source('entrypoints/popup/App.vue');

        expect(popup).not.toContain("openDrawer('floating')");
        expect(popup).not.toContain("activeDrawer === 'floating'");
        expect(popup).not.toContain('全文悬浮球');
        expect(popup).not.toContain('启用或关闭全文翻译悬浮球');
        expect(popup.match(/class="feature-card\b/gu)).toHaveLength(6);
    });

    it('keeps full-page floating-ball and hotkey controls in the options page', () => {
        const options = source('components/Main.vue');

        expect(options).toContain('v-model="floatingBallEnabled"');
        expect(options).toContain('aria-label="全文翻译悬浮球"');
        expect(options).toContain('v-model="config.floatingBallHotkey"');
        expect(options).toContain('aria-label="全文翻译快捷键"');
    });
});
