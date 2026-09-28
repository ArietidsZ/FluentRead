import {describe, expect, it, vi} from 'vitest';
// Vitest 的 Node 配置不编译 Vue 组件；这里仅检验无浏览器 API 的运行时空适配器。
vi.mock('@/src/features/image-translation/ui/ImageOcrSettings.vue', () => ({default: {}}));
import {
    isAreaTranslatorMounted,
    isSupportedVideoPage,
    mountAreaTranslator,
    mountImageTranslator,
    mountVideoSubtitleTranslation,
    unmountAreaTranslator,
    unmountImageTranslator,
} from '@/userscript/unsupportedCapabilities';

describe('userscript extension-only capability stubs', () => {
    it('never mounts area, image, or video runtimes', () => {
        expect(isAreaTranslatorMounted()).toBe(false);
        expect(mountAreaTranslator()).toBeUndefined();
        expect(mountImageTranslator()).toBeUndefined();
        expect(unmountAreaTranslator()).toBeUndefined();
        expect(unmountImageTranslator()).toBeUndefined();
        expect(mountVideoSubtitleTranslation()()).toBeUndefined();
        expect(isSupportedVideoPage()).toBe(false);
    });
});
