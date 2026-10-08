/**
 * @file tests/sentenceActionsMount.test.ts
 * 文件职责：验证页面学习功能不再为悬停高亮挂载额外句子入口。
 * 主要内容：覆盖不同浏览器、逐句高亮和划词开关组合，确认句子操作归已有划词卡片。
 * 模块边界：只测试真实组合根，指针和选区由生产浏览器专项验证。
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Config} from '@/src/core/config/model';
import {resolveBrowserCapabilities} from '@/src/platform/browser/capabilities';
vi.mock('@/src/features/writing-assistant/public', () => ({
    mountWritingAssistant: vi.fn(), unmountWritingAssistant: vi.fn(), isWritingAssistantMounted: () => false,
}));
import {createLearningContentFeatures} from '@/src/app/content/learningFeatures';
import type {ContentScriptContext} from 'wxt/utils/content-script-context';
import {mountWritingAssistant, unmountWritingAssistant} from '@/src/features/writing-assistant/public';

afterEach(() => {vi.unstubAllGlobals(); vi.clearAllMocks();});

describe('sentence entry ownership', () => {
    it.each([
        {browser: 'userscript', on: true, writing: true, href: 'https://mail.google.com/mail/u/0/', enabled: false},
        {browser: 'chrome', on: false, writing: true, href: 'https://mail.google.com/mail/u/0/', enabled: false},
        {browser: 'chrome', on: true, writing: false, href: 'https://mail.google.com/mail/u/0/', enabled: false},
        {browser: 'chrome', on: true, writing: true, href: 'https://example.com/', enabled: false},
        {browser: 'chrome', on: true, writing: true, href: 'https://mail.google.com/mail/u/0/', enabled: true},
    ] as const)('writing entry eligibility follows $browser/$on/$writing/$href', ({browser, on, writing, href, enabled}) => {
        vi.stubGlobal('window', {location: {href}});
        const config = new Config(); config.on = on; config.writing.enabled = writing;
        const ctx = {} as ContentScriptContext;
        const [feature] = createLearningContentFeatures(ctx, config,
            resolveBrowserCapabilities({browser, manifestVersion: 3}));
        expect(feature.isEnabled()).toBe(enabled);
        feature.mount({ctx, signal: new AbortController().signal, isCurrent: () => true});
        expect(mountWritingAssistant).toHaveBeenCalledWith(ctx);
        feature.unmount?.(); expect(unmountWritingAssistant).toHaveBeenCalledOnce();
        expect(feature.isMounted?.()).toBe(false);
    });
    it.each(['chrome', 'firefox', 'userscript'] as const)(
        'does not add a hover entry on %s regardless of highlight or selection preferences', browser => {
            for (const highlighted of [false, true]) {
                for (const selectionMode of ['disabled', 'bilingual'] as const) {
                    const config = Object.assign(new Config(), {
                        bilingualSentenceHighlightEnabled: highlighted, selectionTranslatorMode: selectionMode,
                    });
                    const features = createLearningContentFeatures({} as ContentScriptContext, config,
                        resolveBrowserCapabilities({browser, manifestVersion: browser === 'chrome' ? 3 : 2}));
                    expect(features.map(feature => feature.id)).toEqual(['writing-assistant']);
                }
            }
        },
    );
});
