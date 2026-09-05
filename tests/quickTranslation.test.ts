import {describe, expect, it} from 'vitest';

import {customModelString, services} from '@/src/core/config/catalog';
import {
    createQuickTranslationProfile,
    enabledQuickTranslationProfiles,
    findEnabledQuickTranslationHotkeyConflict,
    inputBoxTranslationTriggerHotkey,
    normalizeQuickTranslationProfiles,
    type QuickTranslationProfile,
} from '@/src/core/config/quickTranslation';
import {resolveQuickTranslationInvocation} from '@/src/features/quick-translation/core';

function profile(overrides: Partial<QuickTranslationProfile> = {}): QuickTranslationProfile {
    return {
        id: 'quick-1',
        enabled: true,
        action: 'full-page',
        hotkey: 'Ctrl+T',
        service: '',
        model: '',
        targetLanguage: '',
        displayMode: 'inherit',
        fullPageMode: 'inherit',
        ...overrides,
    };
}

describe('快捷翻译调用解析', () => {
    it('创建方案时生成无碰撞 ID，运行时只暴露已启用且已设置热键的匹配动作', () => {
        const created = createQuickTranslationProfile('hover', [
            {id: 'quick-1'},
            {id: 'quick-3'},
        ]);
        expect(created).toEqual({
            id: 'quick-2',
            enabled: false,
            action: 'hover',
            hotkey: '',
            service: '',
            model: '',
            targetLanguage: '',
            displayMode: 'inherit',
            fullPageMode: 'inherit',
        });

        const hover = profile({id: 'hover', action: 'hover', hotkey: 'Ctrl+T'});
        const page = profile({id: 'page', action: 'full-page', hotkey: 'Ctrl+Y'});
        const disabled = profile({id: 'disabled', enabled: false, hotkey: 'Alt+T'});
        const incomplete = profile({id: 'incomplete', hotkey: ''});
        expect(enabledQuickTranslationProfiles([hover, page, disabled, incomplete], 'hover'))
            .toEqual([hover]);
        expect(enabledQuickTranslationProfiles([hover, page, disabled, incomplete]))
            .toEqual([hover, page]);
        expect(findEnabledQuickTranslationHotkeyConflict([hover, page, disabled], 'Control+T')).toBe(hover);
        expect(findEnabledQuickTranslationHotkeyConflict([hover, page, disabled], 'Alt+T')).toBeUndefined();
        expect(findEnabledQuickTranslationHotkeyConflict([hover, page, disabled], 'Control')).toBeUndefined();
    });

    it('纯归一化入口处理缺省上下文、非字符串 ID 与保留热键', () => {
        const normalized = normalizeQuickTranslationProfiles([{
            id: 12, enabled: true, action: 'hover', hotkey: 'Ctrl+T', service: '',
        }], {
            isSupportedService: () => true,
            serviceUsesModel: () => false,
        });
        expect(normalized[0]).toMatchObject({id: 'quick-1', enabled: true, hotkey: 'Ctrl+T'});
    });

    it('输入框触发方式映射到首击占用键，未知值不产生保留项', () => {
        expect(inputBoxTranslationTriggerHotkey('ctrl_enter')).toBe('Ctrl+Enter');
        expect(inputBoxTranslationTriggerHotkey('triple_space')).toBe('Space');
        expect(inputBoxTranslationTriggerHotkey('triple_equal')).toBe('=');
        expect(inputBoxTranslationTriggerHotkey('triple_dash')).toBe('-');
        expect(inputBoxTranslationTriggerHotkey('disabled')).toBe('');
        expect(inputBoxTranslationTriggerHotkey(null)).toBe('');
    });

    it('只有显式布尔 true 才能启用导入方案，畸形 enabled 值全部安全关闭', () => {
        const normalized = normalizeQuickTranslationProfiles([
            {id: 'true', enabled: true, action: 'hover', hotkey: 'F5'},
            {id: 'string', enabled: 'false', action: 'hover', hotkey: 'F6'},
            {id: 'zero', enabled: 0, action: 'hover', hotkey: 'F7'},
            {id: 'null', enabled: null, action: 'hover', hotkey: 'F8'},
            {id: 'missing', action: 'full-page', hotkey: 'F9'},
        ], {
            isSupportedService: () => true,
            serviceUsesModel: () => false,
        });

        expect(normalized.map(({enabled}) => enabled)).toEqual([true, false, false, false, false]);
    });

    it('在全部跟随默认时冻结当前服务、自定义模型、语言、展示和全文范围', () => {
        const invocation = resolveQuickTranslationInvocation(profile(), {
            service: services.openai,
            model: {[services.openai]: customModelString},
            customModel: {[services.openai]: 'private-default-model'},
            to: 'zh-Hans',
            display: 1,
            fullPageTranslationMode: 'viewport',
            translationScope: 'content',
        });

        expect(invocation).toEqual({
            profileId: 'quick-1',
            scope: 'content',
            service: services.openai,
            model: 'private-default-model',
            targetLanguage: 'zh-Hans',
            displayMode: 'bilingual',
            fullPageMode: 'viewport',
        });
    });

    it('显式方案会同时覆盖服务、模型、语言、展示和全文范围', () => {
        const invocation = resolveQuickTranslationInvocation(profile({
            hotkey: 'Ctrl+Y',
            service: services.deepseek,
            model: 'quick-deepseek-model',
            targetLanguage: 'ja',
            displayMode: 'translation-only',
            fullPageMode: 'all',
        }), {
            service: services.openai,
            model: {[services.openai]: 'global-model'},
            customModel: {},
            to: 'zh-Hans',
            display: 1,
            fullPageTranslationMode: 'viewport',
            translationScope: 'content',
        });

        expect(invocation).toEqual({
            profileId: 'quick-1',
            scope: 'content',
            service: services.deepseek,
            model: 'quick-deepseek-model',
            targetLanguage: 'ja',
            displayMode: 'single',
            fullPageMode: 'all',
        });
    });

    it('悬停方案可独立指定服务、模型、语言与展示，但不注入全文范围', () => {
        const invocation = resolveQuickTranslationInvocation(profile({
            action: 'hover',
            service: services.deepseek,
            model: 'hover-deepseek-model',
            targetLanguage: 'fr',
            displayMode: 'bilingual',
            fullPageMode: 'all',
        }), {
            service: services.openai,
            model: {[services.openai]: 'global-model'},
            customModel: {},
            to: 'en',
            display: 0,
            fullPageTranslationMode: 'all',
            translationScope: 'content',
        });

        expect(invocation).toEqual({
            profileId: 'quick-1',
            scope: 'content',
            service: services.deepseek,
            model: 'hover-deepseek-model',
            targetLanguage: 'fr',
            displayMode: 'bilingual',
        });
        expect(invocation).not.toHaveProperty('fullPageMode');
    });

    it('机器翻译且默认仅译文时省略模型并解析为 single', () => {
        expect(resolveQuickTranslationInvocation(profile({service: services.microsoft}), {
            service: services.openai,
            model: {},
            customModel: {},
            to: 'de',
            display: 0,
            fullPageTranslationMode: 'all',
            translationScope: 'content',
        })).toEqual({
            profileId: 'quick-1',
            scope: 'content',
            service: services.microsoft,
            targetLanguage: 'de',
            displayMode: 'single',
            fullPageMode: 'all',
        });
    });

    it('悬浮与全文方案均冻结保存的全部节点设置，并独立保留视口范围', () => {
        const config = {
            service: services.microsoft, model: {}, customModel: {}, to: 'zh', display: 1,
            fullPageTranslationMode: 'viewport' as const, translationScope: 'all' as 'content' | 'all',
        };
        const hover = resolveQuickTranslationInvocation(profile({action: 'hover'}), config);
        const fullPage = resolveQuickTranslationInvocation(profile(), config);
        config.translationScope = 'content';
        expect(hover.scope).toBe('all');
        expect(hover).not.toHaveProperty('fullPageMode');
        expect(fullPage).toMatchObject({scope: 'all', fullPageMode: 'viewport'});
        expect(resolveQuickTranslationInvocation(profile(), config).scope).toBe('content');
    });

    it('Google 只在当次执行时限制为双语，不覆盖方案保存的显示偏好', () => {
        const selected = profile({
            service: services.google,
            displayMode: 'translation-only',
        });
        expect(resolveQuickTranslationInvocation(selected, {
            service: services.openai,
            model: {},
            customModel: {},
            to: 'de',
            display: 0,
            fullPageTranslationMode: 'viewport',
            translationScope: 'content',
        })).toMatchObject({
            service: services.google,
            displayMode: 'bilingual',
        });
        expect(selected.displayMode).toBe('translation-only');
    });
});
