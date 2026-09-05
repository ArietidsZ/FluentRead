import {beforeEach, describe, expect, it, vi} from 'vitest';
import {services} from '@/src/core/config/catalog';
import type {Config} from '@/src/core/config/model';
import type {QuickTranslationProfile} from '@/src/core/config/quickTranslation';

const mocks = vi.hoisted(() => ({
    mountedDependencies: null as Record<string, any> | null,
    autoTranslateEnglishPage: vi.fn(),
    cancelPendingHoverTranslation: vi.fn(),
    handleTranslation: vi.fn(),
    isFullPageTranslationActive: vi.fn(() => false),
    restoreOriginalContent: vi.fn(),
}));

vi.mock('@/src/features/quick-translation/public', () => ({
    mountQuickTranslationContentFeature: (deps: Record<string, any>) => {
        mocks.mountedDependencies = deps;
    },
}));
vi.mock('@/src/app/content/features', () => ({
    autoTranslateEnglishPage: mocks.autoTranslateEnglishPage,
    cancelPendingHoverTranslation: mocks.cancelPendingHoverTranslation,
    handleTranslation: mocks.handleTranslation,
    isFullPageTranslationActive: mocks.isFullPageTranslationActive,
    restoreOriginalContent: mocks.restoreOriginalContent,
}));

import {mountConfiguredQuickTranslation} from '@/src/app/content/quickTranslationRuntime';

function profile(overrides: Partial<QuickTranslationProfile> = {}): QuickTranslationProfile {
    return {
        id: 'quick-1',
        enabled: true,
        action: 'hover',
        hotkey: 'Ctrl+T',
        service: services.openai,
        model: 'quick-model',
        targetLanguage: 'ja',
        displayMode: 'translation-only',
        fullPageMode: 'inherit',
        ...overrides,
    };
}

function config(): Config {
    return {
        service: services.microsoft,
        model: {[services.microsoft]: ''},
        customModel: {},
        to: 'zh-Hans',
        display: 1,
        fullPageTranslationMode: 'viewport',
        customSelectionTranslatorHotkey: '',
    } as Config;
}

describe('快捷翻译 content composition', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mountedDependencies = null;
        mocks.isFullPageTranslationActive.mockReturnValue(false);
        vi.stubGlobal('document', {addEventListener: vi.fn()});
        vi.stubGlobal('window', {});
    });

    it('把每条悬停方案解析为独立请求覆盖后交给共享翻译引擎', () => {
        const current = config();
        mountConfiguredQuickTranslation(current, {
            shouldReserveSelectionShortcut: vi.fn(),
            getConfiguredSelectionHotkey: vi.fn(() => 'none'),
            hasActiveSelectionTranslationCandidate: vi.fn(() => false),
        } as any, () => false, new AbortController().signal);

        const selected = profile();
        mocks.mountedDependencies!.runHover(selected, 12, 34, {delayMs: 80, continuous: true});

        expect(mocks.handleTranslation).toHaveBeenCalledWith(12, 34, {
            profileId: 'quick-1',
            service: services.openai,
            model: 'quick-model',
            targetLanguage: 'ja',
            displayMode: 'single',
            delayMs: 80,
            continuous: true,
        });
        expect(mocks.mountedDependencies!.cancelPendingHoverTranslation)
            .toBe(mocks.cancelPendingHoverTranslation);
    });

    it('邮件 frame 转发解析后的全文方案，并保留本地悬停执行器', () => {
        const forward = vi.fn();
        mountConfiguredQuickTranslation(config(), {} as any, () => false, new AbortController().signal, vi.fn(), forward);
        const selected = profile({action: 'full-page', fullPageMode: 'all'});
        mocks.mountedDependencies!.runFullPage(selected);
        expect(forward).toHaveBeenCalledWith({profileId: 'quick-1', service: services.openai,
            model: 'quick-model', targetLanguage: 'ja', displayMode: 'single', fullPageMode: 'all'});
        expect(mocks.cancelPendingHoverTranslation).toHaveBeenCalledOnce();
        expect(mocks.autoTranslateEnglishPage).not.toHaveBeenCalled();
        expect(mocks.restoreOriginalContent).not.toHaveBeenCalled();
    });

    it('全文方案按独立范围启动、切换另一方案，并用同一方案恢复原文', () => {
        let active = false;
        mocks.isFullPageTranslationActive.mockImplementation(() => active);
        mocks.restoreOriginalContent.mockImplementation(() => { active = false; });
        mocks.autoTranslateEnglishPage.mockImplementation(() => { active = true; });
        const current = config();
        mountConfiguredQuickTranslation(current, {
            shouldReserveSelectionShortcut: vi.fn(),
            getConfiguredSelectionHotkey: vi.fn(() => 'none'),
            hasActiveSelectionTranslationCandidate: vi.fn(() => false),
        } as any, () => false, new AbortController().signal);
        const selected = profile({action: 'full-page', hotkey: 'Ctrl+Y', fullPageMode: 'all'});
        const second = profile({id: 'quick-2', action: 'full-page', hotkey: 'Ctrl+U',
            model: 'second-model', fullPageMode: 'viewport'});

        mocks.mountedDependencies!.runFullPage(selected);
        expect(mocks.autoTranslateEnglishPage).toHaveBeenCalledWith({
            profileId: 'quick-1',
            service: services.openai,
            model: 'quick-model',
            targetLanguage: 'ja',
            displayMode: 'single',
            fullPageMode: 'all',
        });
        expect(mocks.restoreOriginalContent).toHaveBeenCalledOnce();

        mocks.mountedDependencies!.runFullPage(second);
        expect(mocks.restoreOriginalContent).toHaveBeenCalledTimes(2);
        expect(mocks.autoTranslateEnglishPage).toHaveBeenLastCalledWith(expect.objectContaining({
            profileId: 'quick-2', model: 'second-model', fullPageMode: 'viewport',
        }));

        mocks.mountedDependencies!.runFullPage(second);
        expect(mocks.restoreOriginalContent).toHaveBeenCalledTimes(3);
        expect(mocks.autoTranslateEnglishPage).toHaveBeenCalledTimes(2);
    });
});
