/**
 * @file src/app/content/quickTranslationRuntime.ts
 * 文件职责：把快捷翻译手势 feature 与当前页面配置、划词优先级及全文/悬停执行器组装起来。
 * 主要内容：解析方案的请求级覆盖，协调旧单例监听器与多方案路由，并保持全文切换与悬停取消语义。
 * 模块边界：本文件只做 content composition；手势判定属于 quick-translation feature，翻译请求与 DOM 状态属于 full-page feature。
 */
import type {Config} from '@/src/core/config/model';
import {resolveQuickTranslationInvocation} from '@/src/features/quick-translation/core';
import {mountQuickTranslationContentFeature} from '@/src/features/quick-translation/public';
import {isTranslationServiceAvailable} from '@/src/services/translation/capabilities';
import type {ContentHotkeyRuntime} from './hotkeyRuntime';
import {
    autoTranslateEnglishPage,
    cancelPendingHoverTranslation,
    handleTranslation,
    isFullPageTranslationActive,
    restoreOriginalContent,
} from './features';

/** 安装额外方案；命中时清空旧手势状态，再由当前方案独占后续按键。 */
export function mountConfiguredQuickTranslation(
    config: Config,
    hotkeys: ContentHotkeyRuntime,
    isSiteDisabled: () => boolean,
    signal: AbortSignal,
    resetLegacyKeyboardGestures: () => void = () => undefined,
): void {
    let activeFullPageInvocation = '';
    const clearActiveInvocation = () => { activeFullPageInvocation = ''; };
    document.addEventListener('fluentread-translation-started', clearActiveInvocation, {signal});
    document.addEventListener('fluentread-translation-ended', clearActiveInvocation, {signal});
    mountQuickTranslationContentFeature({
        config,
        document,
        window,
        isSiteDisabled,
        isProfileAvailable: (profile) => isTranslationServiceAvailable(profile.service || config.service),
        shouldReserveSelectionShortcut: hotkeys.shouldReserveSelectionShortcut,
        getConfiguredSelectionHotkey: hotkeys.getConfiguredSelectionHotkey,
        getCustomSelectionHotkey: () => config.customSelectionTranslatorHotkey,
        hasActiveSelectionTranslationCandidate: hotkeys.hasActiveSelectionTranslationCandidate,
        resetLegacyKeyboardGestures,
        cancelPendingHoverTranslation,
        runHover: (profile, mouseX, mouseY, invocation = {}) => handleTranslation(mouseX, mouseY, {
            ...resolveQuickTranslationInvocation(profile, config),
            ...invocation,
        }),
        runFullPage: (profile) => {
            const invocation = resolveQuickTranslationInvocation(profile, config);
            const invocationIdentity = JSON.stringify(invocation);
            cancelPendingHoverTranslation();
            if (isFullPageTranslationActive()) {
                const shouldStop = activeFullPageInvocation === invocationIdentity;
                restoreOriginalContent();
                if (shouldStop) return;
            } else {
                restoreOriginalContent();
            }
            autoTranslateEnglishPage(invocation);
            if (isFullPageTranslationActive()) activeFullPageInvocation = invocationIdentity;
        },
    }, signal);
}
