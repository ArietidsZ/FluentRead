import {
    cancelPendingHoverTranslation,
    handleTranslation,
    autoTranslateEnglishPage,
    isFullPageTranslationActive,
    restoreOriginalContent,
} from "./main/trans";
import { constants } from "@/entrypoints/utils/constant";
import { detectlang, getCenterPoint } from "@/entrypoints/utils/common";
import pageStyles from './style.css?inline';
import { config, configReady, subscribeConfig } from "@/entrypoints/utils/config";
import {
    mountFloatingBall,
    toggleFloatingBallTranslation,
    unmountFloatingBall,
} from "@/entrypoints/utils/floatingBall";
import { mountSelectionTranslator, unmountSelectionTranslator } from "@/entrypoints/utils/selectionTranslator";
import { isAreaTranslatorMounted, mountAreaTranslator, unmountAreaTranslator } from "@/entrypoints/utils/areaTranslator";
import { cancelAllTranslations } from "@/entrypoints/utils/translateApi";
import { mountImageTranslator, unmountImageTranslator } from "@/entrypoints/utils/imageTranslation";
import {
    mountTranslationProgressPanel,
    unmountTranslationProgressPanel,
} from "@/entrypoints/utils/translationProgressPanel";
import {
    canCommitInputBoxTranslation,
    getDeepActiveElement,
    getInputBoxText,
    getInputBoxValueSnapshot,
    isInputElement,
    matchesInputBoxTrigger,
    removeTriggerSymbols,
    type InputBoxTrigger,
} from "@/entrypoints/utils/inputBox";
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi, type ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import { mountVideoSubtitleTranslation } from './main/videoSubtitle';
import {resetPageTranslationContextCache} from '@/entrypoints/utils/pageContext';
import { matchesConfiguredHotkey, shouldClaimConfiguredHotkey } from '@/entrypoints/utils/hotkey';
import { isSameLanguage, normalizeSelectionText, shouldIgnoreSelection } from '@/entrypoints/utils/selectionTranslatorCore';
import { normalizeSelectionTranslatorDelay } from '@/entrypoints/utils/model';
import {clearLegacyPageTranslationCache} from '@/entrypoints/utils/legacyPageCache';
import {isExtensionDisabledOnSite, shouldAutoTranslatePage} from '@/entrypoints/utils/siteRules';
import {ensureContentFeatureMounted} from '@/entrypoints/utils/contentFeatureLifecycle';

let contentScriptContext: ContentScriptContext | null = null;
let inputTooltipUi: ShadowRootContentScriptUi<HTMLElement> | null = null;
let inputTooltipOwnerRequestId: number | null = null;
let activeInputTranslationRequestId = 0;
let activeInputTranslationElement: HTMLElement | null = null;
let unmountVideoSubtitleTranslation: (() => void) | null = null;
let unsubscribeContentConfig: (() => void) | null = null;
let currentPageSiteDisabled = false;
let updateCurrentPageSiteDisabled: ((disabled: boolean) => Promise<void>) | null = null;

function isInputBoxTranslationEnabled(): boolean {
    return config.on !== false && config.inputBoxTranslationTrigger !== 'disabled';
}

function inputBoxTranslationConfigKey(value: typeof config): string {
    return JSON.stringify([
        value.on,
        value.inputBoxTranslationTrigger,
        value.inputBoxTranslationTarget,
    ]);
}

function invalidateActiveInputBoxTranslation(): void {
    activeInputTranslationRequestId += 1;
    activeInputTranslationElement?.classList.remove('fluent-input-translating');
    activeInputTranslationElement = null;
    removeExistingTooltip();
}

function shouldAutomaticallyTranslateCurrentPage(nextConfig: typeof config): boolean {
    return shouldAutoTranslatePage(window.location.href, {
        on: nextConfig.on,
        autoTranslate: nextConfig.autoTranslate,
        alwaysTranslateDomains: nextConfig.alwaysTranslateDomains,
        disabledExtensionDomains: nextConfig.disabledExtensionDomains,
    });
}

function installPageStyles(ctx: ContentScriptContext): () => void {
    const existing = document.getElementById('fluent-read-page-styles');
    if (existing) return () => undefined;

    const style = document.createElement('style');
    style.id = 'fluent-read-page-styles';
    style.textContent = pageStyles;
    (document.head ?? document.documentElement).appendChild(style);
    const remove = () => style.remove();
    ctx.onInvalidated(remove);
    return remove;
}

function handleRuntimeMessage(
    message: unknown,
    ctx: ContentScriptContext,
    sendResponse: (response?: unknown) => void,
): boolean {
    if (!message || typeof message !== 'object') return false;
    const payload = message as Record<string, unknown>;

    if (payload.message === 'clearCache') {
        browser.runtime.sendMessage({ type: 'clearTranslationCache' })
            .then(() => sendResponse())
            .catch(() => sendResponse());
        return true;
    }

    if (payload.type === 'updateSiteExtensionDisabled') {
        if (typeof payload.isDisabled !== 'boolean') return false;
        const update = updateCurrentPageSiteDisabled;
        if (!update) {
            sendResponse({ status: 'unavailable' });
            return true;
        }
        void update(payload.isDisabled)
            .then(() => sendResponse({ status: 'success' }))
            .catch(() => sendResponse({ status: 'failed' }));
        return true;
    }

    if (currentPageSiteDisabled && payload.type !== 'getFullPageTranslationState') {
        sendResponse({ status: 'disabled' });
        return true;
    }

    if (payload.type === 'toggleFloatingBall') {
        const isEnabled = payload.isEnabled === true;
        config.disableFloatingBall = !isEnabled;
        if (isEnabled) {
            void mountFloatingBall(ctx);
        } else {
            unmountFloatingBall();
        }
        sendResponse();
        return true;
    }

    if (payload.type === 'updateSelectionTranslatorMode') {
        const mode = payload.mode;
        if (mode !== 'disabled' && mode !== 'bilingual' && mode !== 'translation-only') return false;

        config.selectionTranslatorMode = mode;
        config.disableSelectionTranslator = mode === 'disabled';
        if (mode === 'disabled') {
            unmountSelectionTranslator();
        } else if (!document.getElementById('fluent-read-selection-translator-container')) {
            void mountSelectionTranslator(ctx);
        }
        sendResponse();
        return true;
    }

    if (payload.type === 'updateSelectionTranslatorSettings') {
        const trigger = payload.trigger;
        const hotkey = payload.hotkey;
        const customHotkey = payload.customHotkey;
        const delay = payload.delay;
        if (trigger !== 'direct' && trigger !== 'icon' && trigger !== 'dot' && trigger !== 'Control' && trigger !== 'Alt' && trigger !== 'Shift' && trigger !== 'custom') return false;
        if (hotkey !== undefined && hotkey !== 'none' && hotkey !== 'Control' && hotkey !== 'Alt' && hotkey !== 'Shift' && hotkey !== 'custom') return false;
        if (customHotkey !== undefined && typeof customHotkey !== 'string') return false;
        if (delay !== undefined && typeof delay !== 'number' && typeof delay !== 'string') return false;

        // trigger 是唯一运行时真源；hotkey 仅为兼容旧调用方的消息结构而校验。
        const resolvedTrigger = trigger;
        config.selectionTranslatorTrigger = resolvedTrigger;
        config.selectionTranslatorHotkey = resolvedTrigger === 'Control' || resolvedTrigger === 'Alt' || resolvedTrigger === 'Shift' || resolvedTrigger === 'custom'
            ? resolvedTrigger
            : 'none';
        config.customSelectionTranslatorHotkey = typeof customHotkey === 'string' ? customHotkey : '';
        if (delay !== undefined) config.selectionTranslatorDelay = normalizeSelectionTranslatorDelay(delay);
        sendResponse();
        return true;
    }

    if (payload.type === 'toggleSelectionAreaTranslator') {
        const isEnabled = payload.isEnabled === true;
        config.selectionAreaEnabled = isEnabled;
        if (isEnabled) {
            void mountAreaTranslator(ctx);
        } else {
            unmountAreaTranslator();
        }
        sendResponse();
        return true;
    }

    if (payload.type === 'toggleImageTranslator') {
        const isEnabled = payload.isEnabled === true;
        config.disableImageTranslator = !isEnabled;
        if (isEnabled) {
            mountImageTranslator();
        } else {
            unmountImageTranslator();
        }
        sendResponse();
        return true;
    }

    if (payload.type === 'toggleTranslationProgressPanel') {
        const isEnabled = payload.isEnabled === true;
        config.translationProgressPanelEnabled = isEnabled;
        if (isEnabled) {
            void mountTranslationProgressPanel(ctx);
        } else {
            unmountTranslationProgressPanel();
        }
        sendResponse();
        return true;
    }

    if (payload.type === 'getFullPageTranslationState') {
        sendResponse({
            status: 'success',
            isTranslated: !currentPageSiteDisabled && isFullPageTranslationActive(),
            isSiteDisabled: currentPageSiteDisabled,
        });
        return true;
    }

    if (payload.type === 'contextMenuTranslate') {
        if (config.on === false || currentPageSiteDisabled) {
            sendResponse({ status: 'disabled' });
            return true;
        }
        if (payload.action === 'fullPage') {
            autoTranslateEnglishPage();
            const isTranslated = isFullPageTranslationActive();
            sendResponse({
                status: isTranslated ? 'success' : 'failed',
                action: isTranslated ? 'translated' : 'unchanged',
                isTranslated,
            });
            return true;
        }
        if (payload.action === 'restore') {
            restoreOriginalContent();
            const isTranslated = isFullPageTranslationActive();
            sendResponse({
                status: isTranslated ? 'failed' : 'success',
                action: isTranslated ? 'unchanged' : 'restored',
                isTranslated,
            });
            return true;
        }
    }

    return false;
}

export default defineContentScript({
    matches: ['<all_urls>'],  // 匹配所有页面
    runAt: 'document_end',  // 在页面加载完成后运行
    cssInjectionMode: 'ui',
    async main(ctx) {
        contentScriptContext = ctx;
        await configReady; // 等待配置加载完成
        clearLegacyPageTranslationCache();
        currentPageSiteDisabled = isExtensionDisabledOnSite(
            window.location.href,
            config.disabledExtensionDomains,
        );

        const pageEventController = new AbortController();
        document.addEventListener('fluentread-route-change', resetPageTranslationContextCache, {
            signal: pageEventController.signal,
        });
        let runtimeMessageListener: ((message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => boolean) | null = null;
        let cleanedUp = false;
        let featureController: AbortController | null = null;
        let removePageStyles: (() => void) | null = null;
        let shouldAutomaticallyTranslate = false;
        let inputBoxConfigGeneration = 0;
        let previousInputBoxConfigKey = inputBoxTranslationConfigKey(config);

        const reportSiteDisabledState = () => {
            void browser.runtime.sendMessage({
                type: 'siteExtensionDisabledState',
                isDisabled: currentPageSiteDisabled,
            }).catch(() => undefined);
        };

        const disposePageFeatures = () => {
            featureController?.abort();
            featureController = null;
            restoreOriginalContent();
            cancelAllTranslations();
            unmountFloatingBall();
            unmountSelectionTranslator();
            unmountAreaTranslator();
            unmountImageTranslator();
            unmountTranslationProgressPanel();
            unmountVideoSubtitleTranslation?.();
            unmountVideoSubtitleTranslation = null;
            removeExistingTooltip();
            removePageStyles?.();
            removePageStyles = null;
        };

        const activatePageFeatures = async () => {
            if (cleanedUp || currentPageSiteDisabled || featureController) return;

            removePageStyles = installPageStyles(ctx);
            const activationController = new AbortController();
            featureController = activationController;
            const isActivationCurrent = () => !cleanedUp
                && !currentPageSiteDisabled
                && featureController === activationController
                && !activationController.signal.aborted;
            setupInputBoxTranslation(activationController.signal, () => inputBoxConfigGeneration);
            // 视频字幕 Beta 只在 YouTube 播放页监听原生字幕，不采集音频或视频内容。
            unmountVideoSubtitleTranslation = mountVideoSubtitleTranslation();
            // 监听器始终注册并在触发时读取实时配置。这样扩展在当前页面由关闭
            // 切换为开启后，无需刷新页面就能恢复 Control/Alt+T。
            setupManualTranslationTriggers(activationController.signal);
            setupFloatingBallHotkey(activationController.signal);

            if (config.on && config.disableFloatingBall !== true) {
                await ensureContentFeatureMounted({
                    mount: () => mountFloatingBall(ctx),
                    isMounted: () => Boolean(document.getElementById('fluent-read-floating-ball-container')),
                    isStillDesired: () => isActivationCurrent() && config.on && config.disableFloatingBall !== true,
                });
                if (!isActivationCurrent()) return;
            }

            if (config.on && config.disableSelectionTranslator !== true) {
                await ensureContentFeatureMounted({
                    mount: () => mountSelectionTranslator(ctx),
                    isMounted: () => Boolean(document.getElementById('fluent-read-selection-translator-container')),
                    isStillDesired: () => isActivationCurrent() && config.on && config.disableSelectionTranslator !== true,
                });
                if (!isActivationCurrent()) return;
            }
            if (config.on && config.selectionAreaEnabled === true) {
                await ensureContentFeatureMounted({
                    mount: () => mountAreaTranslator(ctx),
                    isMounted: isAreaTranslatorMounted,
                    isStillDesired: () => isActivationCurrent() && config.on && config.selectionAreaEnabled === true,
                });
                if (!isActivationCurrent()) return;
            }

            // 图片翻译使用独立覆盖层，不改写宿主页面的 img 元素；点击入口由事件委托处理动态图片。
            if (config.on && config.disableImageTranslator !== true) mountImageTranslator();
        };

        const applySiteDisabledState = async (disabled: boolean) => {
            if (cleanedUp) return;
            currentPageSiteDisabled = disabled;
            reportSiteDisabledState();
            if (disabled) {
                shouldAutomaticallyTranslate = false;
                disposePageFeatures();
                return;
            }

            await activatePageFeatures();
            if (cleanedUp || currentPageSiteDisabled) return;
            const nextShouldAutomaticallyTranslate = shouldAutomaticallyTranslateCurrentPage(config);
            const shouldStartNow = !shouldAutomaticallyTranslate && nextShouldAutomaticallyTranslate;
            shouldAutomaticallyTranslate = nextShouldAutomaticallyTranslate;
            if (shouldStartNow && !isFullPageTranslationActive()) {
                autoTranslateEnglishPage();
            }
        };
        updateCurrentPageSiteDisabled = applySiteDisabledState;

        const cleanup = () => {
            if (cleanedUp) return;
            cleanedUp = true;
            pageEventController.abort();
            document.dispatchEvent(new CustomEvent('fluentread-shadow-bridge-dispose'));
            if (runtimeMessageListener) {
                browser.runtime.onMessage.removeListener(runtimeMessageListener);
            }
            disposePageFeatures();
            unsubscribeContentConfig?.();
            unsubscribeContentConfig = null;
            updateCurrentPageSiteDisabled = null;
            currentPageSiteDisabled = false;
            contentScriptContext = null;
        };
        ctx.onInvalidated(cleanup);
        window.addEventListener('beforeunload', cleanup, { once: true });

        runtimeMessageListener = (
            message: unknown,
            _sender: unknown,
            sendResponse: (response?: unknown) => void,
        ) => handleRuntimeMessage(message, ctx, sendResponse);
        browser.runtime.onMessage.addListener(runtimeMessageListener);
        reportSiteDisabledState();
        if (!currentPageSiteDisabled) {
            await activatePageFeatures();
            shouldAutomaticallyTranslate = shouldAutomaticallyTranslateCurrentPage(config);
            if (shouldAutomaticallyTranslate) autoTranslateEnglishPage();
        }

        unsubscribeContentConfig = subscribeConfig((nextConfig) => {
            const nextInputBoxConfigKey = inputBoxTranslationConfigKey(nextConfig);
            if (nextInputBoxConfigKey !== previousInputBoxConfigKey) {
                previousInputBoxConfigKey = nextInputBoxConfigKey;
                inputBoxConfigGeneration += 1;
                invalidateActiveInputBoxTranslation();
            }
            const nextSiteDisabled = isExtensionDisabledOnSite(
                window.location.href,
                nextConfig.disabledExtensionDomains,
            );
            if (nextSiteDisabled !== currentPageSiteDisabled) {
                void applySiteDisabledState(nextSiteDisabled);
                return;
            }

            if (nextSiteDisabled) {
                unmountTranslationProgressPanel();
                return;
            }
            if (nextConfig.translationProgressPanelEnabled === true) {
                void mountTranslationProgressPanel(ctx);
            } else {
                unmountTranslationProgressPanel();
            }

            const nextShouldAutomaticallyTranslate = shouldAutomaticallyTranslateCurrentPage(nextConfig);
            const shouldStartNow = !shouldAutomaticallyTranslate && nextShouldAutomaticallyTranslate;
            shouldAutomaticallyTranslate = nextShouldAutomaticallyTranslate;
            // 关闭“始终翻译”只影响之后的页面加载，不撤销用户
            // 已经手动启动的当前会话。只处理 false -> true 才能避免
            // storage.watch 的同值回声重复触发全文翻译。
            if (shouldStartNow && !isFullPageTranslationActive()) {
                autoTranslateEnglishPage();
            }
        });

    }
})

function getConfiguredSelectionHotkey(): string {
    const trigger = config.selectionTranslatorTrigger;
    return ['Control', 'Alt', 'Shift', 'custom'].includes(trigger)
        ? trigger
        : 'none';
}

const activeSelectionCandidateByEvent = new WeakMap<KeyboardEvent, boolean>();

function hasActiveSelectionTranslationCandidate(): boolean {
    if (currentPageSiteDisabled) return false;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
    const selectionHost = document.getElementById('fluent-read-selection-translator-container');
    if (selectionHost && selection.containsNode(selectionHost, true)) return false;

    const text = normalizeSelectionText(selection.toString());
    if (!text || text.length > 4096 || isSameLanguage(detectlang(text), config.to)) return false;

    const range = selection.getRangeAt(0);
    if (shouldIgnoreSelection(range)) return false;
    const hasVisibleRect = Array.from(range.getClientRects()).some(rect => rect.width > 0 || rect.height > 0);
    if (hasVisibleRect) return true;
    const bounds = range.getBoundingClientRect();
    return bounds.width > 0 || bounds.height > 0;
}

function shouldReserveSelectionShortcut(event: KeyboardEvent): boolean {
    if (currentPageSiteDisabled || !config.on || config.selectionTranslatorMode === 'disabled' || config.disableSelectionTranslator) return false;
    return shouldClaimConfiguredHotkey(
        event,
        getConfiguredSelectionHotkey(),
        config.customSelectionTranslatorHotkey,
        () => {
            const cached = activeSelectionCandidateByEvent.get(event);
            if (cached !== undefined) return cached;
            const candidate = hasActiveSelectionTranslationCandidate();
            activeSelectionCandidateByEvent.set(event, candidate);
            return candidate;
        },
    );
}

function matchesSelectionTranslatorShortcut(event: KeyboardEvent): boolean {
    if (currentPageSiteDisabled || !config.on || config.selectionTranslatorMode === 'disabled' || config.disableSelectionTranslator) return false;
    return matchesConfiguredHotkey(
        event,
        getConfiguredSelectionHotkey(),
        config.customSelectionTranslatorHotkey,
    );
}

// 注册所有手动翻译触发事件监听器
function setupManualTranslationTriggers(signal: AbortSignal) {
    const screen = { mouseX: 0, mouseY: 0, hotkeyPressed: false, otherKeyPressed: false, hasSlideTranslation: false };
    let mouseHotkeysPressed = new Set<string>();
    
    const normalizeHotkeyParts = (hotkeyString: string | undefined): string[] => {
        if (!hotkeyString || hotkeyString === 'none') {
            return [];
        }

        return hotkeyString.split('+').map(key => {
            const k = key.trim().toLowerCase();
            if (k === 'ctrl') return 'control';
            if (k === 'option') return 'alt';
            return k;
        }).filter(Boolean);
    };

    // 获取当前配置的鼠标悬浮快捷键
    const getConfiguredMouseHotkeyParts = () => normalizeHotkeyParts(
        config.hotkey === 'custom' ? config.customHotkey : config.hotkey,
    );

    const getConfiguredSelectionHotkeyParts = () => normalizeHotkeyParts(
        getConfiguredSelectionHotkey() === 'custom'
            ? config.customSelectionTranslatorHotkey
            : getConfiguredSelectionHotkey(),
    );

    const matchesPressedHotkeyParts = (hotkeyParts: string[]): boolean => {
        if (hotkeyParts.length === 0) return false;
        return hotkeyParts.every(key => mouseHotkeysPressed.has(key))
            && hotkeyParts.length === mouseHotkeysPressed.size;
    };
    
    // 检查是否匹配鼠标悬浮快捷键
    const checkMouseHotkey = () => {
        return matchesPressedHotkeyParts(getConfiguredMouseHotkeyParts());
    };

    const cancelHoverForActiveSelection = (): boolean => {
        if (!screen.hotkeyPressed || !matchesPressedHotkeyParts(getConfiguredSelectionHotkeyParts())) return false;
        if (!hasActiveSelectionTranslationCandidate()) return false;
        screen.hotkeyPressed = false;
        screen.otherKeyPressed = true;
        screen.hasSlideTranslation = false;
        cancelPendingHoverTranslation();
        return true;
    };

    document.addEventListener('selectionchange', cancelHoverForActiveSelection, { signal });

    // 1. 失去焦点时
    window.addEventListener('blur', () => {
        screen.hotkeyPressed = false;
        screen.otherKeyPressed = false;
        screen.hasSlideTranslation = false;
        mouseHotkeysPressed.clear();
        cancelPendingHoverTranslation();
    }, { signal });

    // 2. 按下按键时
    window.addEventListener('keydown', event => {
        if (!event.isTrusted) return;
        if (currentPageSiteDisabled) return;
        // 防止重复事件
        if (event.repeat) return;
        
        // 在 Mac 上禁止 cmd 键参与快捷键
        const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
        if (isMac && event.metaKey) {
            return;
        }

        const matchesSelectionShortcut = matchesSelectionTranslatorShortcut(event);
        // 已有选区时划词立即拥有本次按键；没有选区时仍让悬浮记录按键，
        // 但不要阻断 SelectionTranslator 记录“先按键、后拖选”的意图。
        if (shouldReserveSelectionShortcut(event)) {
            screen.hotkeyPressed = false;
            screen.otherKeyPressed = true;
            screen.hasSlideTranslation = false;
            mouseHotkeysPressed.clear();
            return;
        }
        
        // 记录修饰键
        if (event.altKey) mouseHotkeysPressed.add('alt');
        if (event.ctrlKey) mouseHotkeysPressed.add('control');
        if (event.metaKey && !isMac) mouseHotkeysPressed.add('control'); // 非Mac系统上metaKey映射到control
        if (event.shiftKey) mouseHotkeysPressed.add('shift');
        
        // 处理普通按键
        const key = event.key.toLowerCase();
        const code = event.code?.toLowerCase();
        
        // 处理字母键
        if (code && code.startsWith('key')) {
            const letter = code.slice(3).toLowerCase();
            mouseHotkeysPressed.add(letter);
        } else if (key.length === 1) {
            // 单个字符的按键
            mouseHotkeysPressed.add(key);
        } else if (/^f\d+$/.test(key)) {
            // 功能键 F1-F12
            mouseHotkeysPressed.add(key);
        } else {
            // 特殊键映射
            const specialKeys: Record<string, string> = {
                'escape': 'escape',
                'enter': 'enter',
                'space': 'space',
                'tab': 'tab',
                'backspace': 'backspace',
                'delete': 'delete',
                'insert': 'insert',
                'home': 'home',
                'end': 'end',
                'pageup': 'pageup',
                'pagedown': 'pagedown',
                'arrowup': 'arrowup',
                'arrowdown': 'arrowdown',
                'arrowleft': 'arrowleft',
                'arrowright': 'arrowright'
            };
            if (specialKeys[key]) {
                mouseHotkeysPressed.add(specialKeys[key]);
            }
        }
        
        // 检查是否匹配鼠标悬浮快捷键
        if (checkMouseHotkey()) {
            screen.hotkeyPressed = true;
            screen.otherKeyPressed = false;
            if (config.on) {
                event.preventDefault();
                if (!matchesSelectionShortcut) event.stopPropagation();
            }
        } else if (screen.hotkeyPressed) {
            screen.otherKeyPressed = true;
            // Ctrl+C 等组合键不应执行鼠标移动时已经排队的悬浮翻译。
            cancelPendingHoverTranslation();
        }
    }, { signal, capture: true });

    document.addEventListener('pointerdown', event => {
        if (!event.isTrusted) return;
        if (currentPageSiteDisabled) return;
        if (!screen.hotkeyPressed || !matchesPressedHotkeyParts(getConfiguredSelectionHotkeyParts())) return;
        screen.hotkeyPressed = false;
        screen.otherKeyPressed = true;
        screen.hasSlideTranslation = false;
        cancelPendingHoverTranslation();
    }, { signal, capture: true });

    // 3. 抬起按键时
    window.addEventListener('keyup', event => {
        if (!event.isTrusted) return;
        if (currentPageSiteDisabled) return;
        // 清除字母键状态（在检查前先清除）
        const releasedKey = event.key.toLowerCase();
        const releasedCode = event.code?.toLowerCase();
        if (releasedCode && releasedCode.startsWith('key')) {
            const letter = releasedCode.slice(3).toLowerCase();
            mouseHotkeysPressed.delete(letter);
        } else if (releasedKey.length === 1) {
            mouseHotkeysPressed.delete(releasedKey);
        } else if (/^f\d+$/.test(releasedKey)) {
            mouseHotkeysPressed.delete(releasedKey);
        } else {
            // 特殊键
            const specialKeys: Record<string, string> = {
                'escape': 'escape',
                'enter': 'enter',
                'space': 'space',
                'tab': 'tab',
                'backspace': 'backspace',
                'delete': 'delete',
                'insert': 'insert',
                'home': 'home',
                'end': 'end',
                'pageup': 'pageup',
                'pagedown': 'pagedown',
                'arrowup': 'arrowup',
                'arrowdown': 'arrowdown',
                'arrowleft': 'arrowleft',
                'arrowright': 'arrowright'
            };
            if (specialKeys[releasedKey]) {
                mouseHotkeysPressed.delete(specialKeys[releasedKey]);
            }
        }
        
        // 清除修饰键状态
        if (!event.altKey) mouseHotkeysPressed.delete('alt');
        if (!event.ctrlKey) mouseHotkeysPressed.delete('control');
        if (!event.metaKey) mouseHotkeysPressed.delete('control');
        if (!event.shiftKey) mouseHotkeysPressed.delete('shift');
        
        // 如果当前按键集合为空，且之前激活了快捷键，且配置的快捷键不包含当前释放的键，则触发翻译
        if (screen.hotkeyPressed && mouseHotkeysPressed.size === 0 && !screen.otherKeyPressed && !screen.hasSlideTranslation) {
            // 检查插件是否开启
            if (config.on) {
                event.preventDefault();
                event.stopPropagation();
                handleTranslation(screen.mouseX, screen.mouseY);
            }
        }
        
        // 如果所有按键都释放了，重置状态
        if (mouseHotkeysPressed.size === 0) {
            screen.hotkeyPressed = false;
            screen.otherKeyPressed = false;
            screen.hasSlideTranslation = false;
        }
    }, { signal, capture: true });

    let longPressTimer: ReturnType<typeof setTimeout> | undefined;
    const longPressStart = { x: 0, y: 0 };

    // 4. 鼠标移动时更新位置，并根据 hotkeyPressed 决定是否触发翻译。
    // 同一监听器同时取消长按，避免为每次 mousemove 注册两条全局路径。
    document.addEventListener('mousemove', event => {
        if (!event.isTrusted) return;
        if (currentPageSiteDisabled) return;
        screen.mouseX = event.clientX;
        screen.mouseY = event.clientY;
        if (longPressTimer !== undefined
            && (Math.abs(event.clientX - longPressStart.x) > 10 || Math.abs(event.clientY - longPressStart.y) > 10)) {
            clearTimeout(longPressTimer);
            longPressTimer = undefined;
        }
        if (screen.hotkeyPressed && config.on) {
            if (cancelHoverForActiveSelection()) return;
            screen.hasSlideTranslation = true;
            handleTranslation(screen.mouseX, screen.mouseY, config.mouseHoverTranslationDelay)
        }
    }, { signal });

    // 5、手机端触摸事件，取中心点翻译
    document.addEventListener('touchstart', event => {
        if (!event.isTrusted) return;
        if (currentPageSiteDisabled) return;
        let coordinate;
        switch (config.hotkey) {
            case constants.TwoFinger:
                coordinate = getCenterPoint(event.touches, 2);
                break;
            case constants.ThreeFinger:
                coordinate = getCenterPoint(event.touches, 3);
                break;
            case constants.FourFinger:
                coordinate = getCenterPoint(event.touches, 4);
                break;
            default:
                return
        }

        // 检查插件是否开启
        if (config.on) {
            handleTranslation(coordinate!.x, coordinate!.y);
        }
    }, { signal, capture: true });

    // 6、双击鼠标翻译事件
    document.addEventListener('dblclick', event => {
        if (!event.isTrusted) return;
        if (currentPageSiteDisabled) return;
        if (config.hotkey == constants.DoubleClick && config.on) {
            // 通过双击事件获取鼠标位置
            let mouseX = event.clientX;
            let mouseY = event.clientY;
            // 调用 handleTranslation 函数进行翻译
            handleTranslation(mouseX, mouseY);
        }
    }, { signal });

    // 7、长按鼠标翻译事件（长按事件时鼠标不能移动）
    document.addEventListener('mouseup', event => {
        if (!event.isTrusted) return;
        if (currentPageSiteDisabled) return;
        if (longPressTimer !== undefined) clearTimeout(longPressTimer);
        longPressTimer = undefined;
    }, { signal });
    document.addEventListener('mousedown', event => {
        if (!event.isTrusted) return;
        if (currentPageSiteDisabled) return;
        if (config.hotkey === constants.LongPress) {
            if (longPressTimer !== undefined) clearTimeout(longPressTimer);
            longPressStart.x = event.clientX;
            longPressStart.y = event.clientY;
            longPressTimer = setTimeout(() => {
                longPressTimer = undefined;
                if (!currentPageSiteDisabled && config.on) {
                    let mouseX = event.clientX;
                    let mouseY = event.clientY;
                    handleTranslation(mouseX, mouseY);
                }
            }, 500);
        }
    }, { signal });
    // 8、鼠标中键翻译事件
    document.addEventListener('mousedown', event => {
        if (!event.isTrusted) return;
        if (currentPageSiteDisabled) return;
        if (config.hotkey === constants.MiddleClick && config.on) {
            if (event.button === 1) {
                let mouseX = event.clientX;
                let mouseY = event.clientY;
                handleTranslation(mouseX, mouseY);
            }
        }
    }, { signal });


    // 9、触屏设备双击/三击翻译事件
    let touchCount = 0;
    let touchTimer: any;
    document.addEventListener('touchstart', event => {
        if (!event.isTrusted) return;
        if (currentPageSiteDisabled) return;
        // 检查是否为有效的热键配置，并且只处理单指触摸事件
        if (![constants.DoubleClickScreen, constants.TripleClickScreen].includes(config.hotkey)
            || event.touches.length !== 1) return;

        // 确定需要的点击次数
        const requiredTouches = config.hotkey === constants.DoubleClickScreen ? 2 : 3;

        touchCount++; // 记录触摸次数

        if (touchCount === 1) {
            // 如果是第一次触摸，设置定时器，500ms内没有达到所需的触摸次数则重置
            touchTimer = setTimeout(() => touchCount = 0, 500);
        } else if (touchCount === requiredTouches) {
            // 如果达到了所需的触摸次数，清除定时器并调用翻译处理函数
            clearTimeout(touchTimer);
            touchCount = 0;
            if (config.on) {
                handleTranslation(event.touches[0].clientX, event.touches[0].clientY);
            }
        }
    }, { signal });

    signal.addEventListener('abort', () => {
        if (longPressTimer !== undefined) clearTimeout(longPressTimer);
        clearTimeout(touchTimer);
    }, { once: true });
}

// 设置全文翻译快捷键（与悬浮球解耦）
function setupFloatingBallHotkey(signal: AbortSignal) {
    // 添加全局键盘事件监听
    let hotkeysPressed = new Set<string>();
    let pendingFullPageToggle = false;
    
    // 开发环境标志
    const isDev = process.env.NODE_ENV === 'development';
    
    // 检测操作系统类型
    const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    
    // 获取当前配置的快捷键
    const getConfiguredHotkeyParts = () => {
        // 如果选择了自定义快捷键，使用自定义的
        const hotkeyString = config.floatingBallHotkey === 'custom' 
            ? config.customFloatingBallHotkey 
            : config.floatingBallHotkey;
        
        if (!hotkeyString || hotkeyString === 'none') {
            return [];
        }
        
        return hotkeyString.split('+').map(key => {
            const k = key.toLowerCase();
            // 标准化修饰键名称
            if (k === 'ctrl') return 'control';
            if (k === 'option') return 'alt';
            return k;
        });
    };
    
    if (isDev) {
        console.log(`[FluentRead] 设置悬浮球快捷键: ${config.floatingBallHotkey}, 系统: ${isMac ? 'macOS' : '其他'}`);
    }
    
    // 监听按键按下事件
    document.addEventListener('keydown', (event) => {
        if (!event.isTrusted) return;
        if (currentPageSiteDisabled) return;
        // 忽略长按产生的重复事件，但不能用全局时间窗口去重：
        // Alt 和 T 本来就可能在 50ms 内连续到达，时间去重会吞掉合法组合键。
        if (event.repeat) return;
        
        // 在 Mac 上禁止 cmd 键参与快捷键
        if (isMac && event.metaKey) {
            return;
        }

        // 划词与全文快捷键冲突时，有有效选区的划词翻译拥有本次按键。
        // 清空全文按键状态并让事件继续传播给 SelectionTranslator。
        if (shouldReserveSelectionShortcut(event)) {
            pendingFullPageToggle = false;
            hotkeysPressed.clear();
            return;
        }
        
        // 记录修饰键状态
        if (event.altKey) hotkeysPressed.add('alt');
        if (event.ctrlKey) hotkeysPressed.add('control');
        if (event.metaKey && !isMac) hotkeysPressed.add('control'); // 非Mac系统上metaKey映射到control
        if (event.shiftKey) hotkeysPressed.add('shift');
        
        // 处理普通按键
        const key = event.key.toLowerCase();
        const code = event.code?.toLowerCase();
        
        // 处理字母键
        if (code && code.startsWith('key')) {
            const letter = code.slice(3).toLowerCase();
            hotkeysPressed.add(letter);
        } else if (key.length === 1) {
            // 单个字符的按键
            hotkeysPressed.add(key);
        } else if (/^f\d+$/.test(key)) {
            // 功能键 F1-F12
            hotkeysPressed.add(key);
        } else {
            // 特殊按键
            const specialKeys: Record<string, string> = {
                'escape': 'escape',
                'enter': 'enter',
                'space': 'space',
                'tab': 'tab',
                'backspace': 'backspace',
                'delete': 'delete',
                'arrowup': 'arrowup',
                'arrowdown': 'arrowdown', 
                'arrowleft': 'arrowleft',
                'arrowright': 'arrowright',
                'home': 'home',
                'end': 'end',
                'pageup': 'pageup',
                'pagedown': 'pagedown',
                'insert': 'insert'
            };
            
            if (specialKeys[key]) {
                hotkeysPressed.add(specialKeys[key]);
            }
        }
        
        // 获取当前配置的快捷键
        const hotkeyParts = getConfiguredHotkeyParts();
        
        // 如果没有配置快捷键，不处理
        if (hotkeyParts.length === 0) {
            return;
        }
        
        // 检查当前按下的键是否完全匹配配置的快捷键
        const allKeysPressed = hotkeyParts.every(key => hotkeysPressed.has(key));
        const exactMatch = allKeysPressed && hotkeyParts.length === hotkeysPressed.size;
        
        // 如果按键组合完全匹配配置的快捷键
        if (exactMatch) {
            // 检查插件是否开启
            if (!config.on) return;
            
            // 防止事件继续传播和默认行为
            event.preventDefault();
            event.stopPropagation();

            if (matchesSelectionTranslatorShortcut(event)) {
                // 悬浮与划词共享按键时，无选区由悬浮回退；否则把全文动作
                // 延迟到 keyup，再确认用户没有完成一次划选手势。
                pendingFullPageToggle = !matchesConfiguredHotkey(
                    event,
                    config.hotkey,
                    config.customHotkey,
                );
                return;
            }
            
            // 内部调用不会跨越到页面共享 DOM，网页脚本无法伪造控制事件。
            if (!toggleFloatingBallTranslation()) {
                if (isFullPageTranslationActive()) {
                    restoreOriginalContent();
                } else {
                    autoTranslateEnglishPage();
                }
            }
            
            if (isDev) {
                const activeHotkey = config.floatingBallHotkey === 'custom' 
                    ? config.customFloatingBallHotkey 
                    : config.floatingBallHotkey;
                console.log(`[FluentRead] 触发悬浮球翻译，快捷键: ${activeHotkey}`);
            }
        }
    }, { signal, capture: true });
    
    // 监听按键释放事件
    document.addEventListener('keyup', (event) => {
        if (!event.isTrusted) return;
        if (currentPageSiteDisabled) return;
        if (pendingFullPageToggle) {
            pendingFullPageToggle = false;
            if (config.on && !hasActiveSelectionTranslationCandidate()) {
                event.preventDefault();
                event.stopPropagation();
                if (!toggleFloatingBallTranslation()) {
                    if (isFullPageTranslationActive()) {
                        restoreOriginalContent();
                    } else {
                        autoTranslateEnglishPage();
                    }
                }
            }
        }
        // 清除字母键状态
        const releasedKey = event.key.toLowerCase();
        const releasedCode = event.code?.toLowerCase();
        if (releasedCode && releasedCode.startsWith('key')) {
            const letter = releasedCode.slice(3).toLowerCase();
            hotkeysPressed.delete(letter);
        } else if (releasedKey.length === 1) {
            hotkeysPressed.delete(releasedKey);
        } else if (/^f\d+$/.test(releasedKey)) {
            hotkeysPressed.delete(releasedKey);
        } else {
            // 特殊键
            const specialKeys: Record<string, string> = {
                'escape': 'escape',
                'enter': 'enter',
                'space': 'space',
                'tab': 'tab',
                'backspace': 'backspace',
                'delete': 'delete',
                'arrowup': 'arrowup',
                'arrowdown': 'arrowdown',
                'arrowleft': 'arrowleft',
                'arrowright': 'arrowright',
                'home': 'home',
                'end': 'end',
                'pageup': 'pageup',
                'pagedown': 'pagedown',
                'insert': 'insert'
            };
            if (specialKeys[releasedKey]) {
                hotkeysPressed.delete(specialKeys[releasedKey]);
            }
        }
        
        // 清除修饰键状态
        if (!event.altKey) hotkeysPressed.delete('alt');
        if (!event.ctrlKey) hotkeysPressed.delete('control');
        if (!event.metaKey) hotkeysPressed.delete('control');
        if (!event.shiftKey) hotkeysPressed.delete('shift');
    }, { signal, capture: true });
    
    // 页面失焦或切换标签页时，清除所有按键状态
    window.addEventListener('blur', () => {
        pendingFullPageToggle = false;
        hotkeysPressed.clear();
    }, { signal });
}

/**
 * 输入框翻译功能
 */
function setupInputBoxTranslation(signal: AbortSignal, readConfigGeneration: () => number) {
    let keyPressCount = 0;
    let keyPressTimer: ReturnType<typeof setTimeout> | null = null;
    let lastInputElement: HTMLElement | null = null;
    const TRIPLE_KEY_TIMEOUT = 1000; // 1秒内连续按三下才生效

    const resetKeyPresses = () => {
        keyPressCount = 0;
        lastInputElement = null;
        if (keyPressTimer) {
            clearTimeout(keyPressTimer);
            keyPressTimer = null;
        }
    };

    const handleKeyDown = async (event: KeyboardEvent) => {
        if (!event.isTrusted) return;
        if (currentPageSiteDisabled) return;
        // 检查功能是否启用
        if (config.on === false || config.inputBoxTranslationTrigger === 'disabled') {
            resetKeyPresses();
            return;
        }

        // 从 Shadow DOM 中找到真正的焦点元素，而不是只看宿主节点。
        const activeElement = getDeepActiveElement();
        if (!isInputElement(activeElement)) {
            resetKeyPresses();
            return;
        }

        // 处理不同的触发方式
        const triggerType = config.inputBoxTranslationTrigger;

        if (triggerType === 'ctrl_enter') {
            // Ctrl+Enter 触发
            if (event.ctrlKey && event.key === 'Enter') {
                event.preventDefault();
                await handleInputBoxTranslation(activeElement, signal, readConfigGeneration);
                return;
            }
        } else if (triggerType === 'triple_space' || triggerType === 'triple_equal' || triggerType === 'triple_dash') {
            // 连按三次触发
            if (event.repeat || !matchesInputBoxTrigger(event, triggerType as InputBoxTrigger)) {
                // 如果按的不是目标键，重置计数器
                resetKeyPresses();
                return;
            }

            // 切换输入框后必须重新开始计数，避免把两个输入框的按键拼成一次触发。
            if (lastInputElement !== activeElement) {
                keyPressCount = 1;
                lastInputElement = activeElement;
            } else {
                keyPressCount++;
            }

            // 如果是第三次按下目标键
            if (keyPressCount === 3) {
                event.preventDefault(); // 阻止默认输入
                resetKeyPresses();
                await handleInputBoxTranslation(activeElement, signal, readConfigGeneration);
                return;
            }

            // 设置超时，如果在指定时间内没有连续按满三次，就重置计数器
            if (keyPressTimer) {
                clearTimeout(keyPressTimer);
            }
            keyPressTimer = setTimeout(() => {
                resetKeyPresses();
            }, TRIPLE_KEY_TIMEOUT);
        }
    };

    // 使用捕获阶段，兼容会在冒泡阶段停止传播键盘事件的富文本编辑器。
    document.addEventListener('keydown', handleKeyDown, { capture: true, signal });
    signal.addEventListener('abort', resetKeyPresses, { once: true });
}

/**
 * 设置输入框中的文本
 */
function setInputBoxText(element: HTMLElement, text: string): void {
    const tagName = element.tagName.toLowerCase();
    
    if (tagName === 'input' || tagName === 'textarea') {
        const inputElement = element as HTMLInputElement | HTMLTextAreaElement;
        inputElement.value = text;
        
        // 触发input事件，以便网页能感知到值的变化
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (isInputElement(element)) {
        element.innerText = text;
        
        // 触发input事件
        element.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

/**
 * 创建并显示翻译提示弹窗
 */
async function createTranslationTooltip(
    element: HTMLElement,
    message: string,
    type: 'translating' | 'success' | 'error',
    requestId: number,
    signal: AbortSignal,
): Promise<HTMLElement | null> {
    if (signal.aborted || requestId !== activeInputTranslationRequestId || currentPageSiteDisabled || !isInputBoxTranslationEnabled()) {
        return null;
    }

    // 只有当前最新请求能替换 tooltip；旧请求即使延迟返回也不会移除新提示。
    removeExistingTooltip();
    inputTooltipOwnerRequestId = requestId;

    if (!contentScriptContext) {
        throw new Error('Content script context is not ready');
    }

    const rect = element.getBoundingClientRect();

    const ui = await createShadowRootUi<HTMLElement>(contentScriptContext, {
        name: 'fluent-read-input-tooltip-ui',
        position: 'overlay',
        alignment: 'top-left',
        zIndex: 2_147_483_647,
        mode: 'closed',
        inheritStyles: false,
        css: `
            :host {
                all: initial !important;
                display: block !important;
                position: relative !important;
                width: 0 !important;
                height: 0 !important;
                overflow: visible !important;
            }
            html, body {
                width: 0 !important;
                height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow: visible !important;
            }
            .fluent-input-tooltip {
                position: fixed;
                box-sizing: border-box;
                background: rgba(17, 24, 39, 0.88);
                color: #fff;
                padding: 8px 12px;
                border: 0;
                border-radius: 8px;
                font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                white-space: nowrap;
                z-index: 2147483647;
                pointer-events: none;
                transition: opacity 0.2s ease, transform 0.2s ease;
                backdrop-filter: blur(8px);
                box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2);
            }
            .fluent-input-tooltip.show { opacity: 1; transform: translateX(-50%) translateY(0); }
            .fluent-input-tooltip.hide { opacity: 0; transform: translateX(-50%) translateY(-5px); }
            .fluent-input-tooltip.translating { background: rgba(59, 130, 246, 0.9); }
            .fluent-input-tooltip.success { background: rgba(34, 197, 94, 0.9); }
            .fluent-input-tooltip.error { background: rgba(239, 68, 68, 0.9); }
        `,
        onMount(container) {
            const tooltip = document.createElement('div');
            tooltip.className = `fluent-input-tooltip ${type}`;
            tooltip.id = 'fluent-input-translation-tooltip';
            tooltip.textContent = `${getTooltipIcon(type)} ${message}`;
            tooltip.style.top = `${rect.bottom + 12}px`;
            tooltip.style.left = `${rect.left + (rect.width / 2)}px`;
            tooltip.style.transform = 'translateX(-50%) translateY(3px)';
            tooltip.style.opacity = config.animations ? '0' : '1';
            container.appendChild(tooltip);
            return tooltip;
        },
    });

    if (
        signal.aborted
        || requestId !== activeInputTranslationRequestId
        || inputTooltipOwnerRequestId !== requestId
        || currentPageSiteDisabled
        || !isInputBoxTranslationEnabled()
    ) {
        ui.remove();
        return null;
    }

    inputTooltipUi = ui;
    ui.shadowHost.id = 'fluent-input-translation-tooltip-host';
    ui.shadowHost.setAttribute('data-fluent-read-ui', 'input-tooltip');
    ui.mount();

    const tooltip = ui.mounted!;
    
    // 如果禁用动画，直接显示，否则使用淡入效果
    if (!config.animations) {
        tooltip.style.opacity = '1';
        tooltip.style.transform = 'translateX(-50%) translateY(0)';
    } else {
        tooltip.style.opacity = '0';
        setTimeout(() => {
            tooltip.classList.add('show');
        }, 10);
    }
    
    return tooltip;
}

/**
 * 获取提示图标
 */
function getTooltipIcon(type: 'translating' | 'success' | 'error'): string {
    const icons = {
        translating: '•',
        success: '✓',
        error: '!'
    };
    return icons[type];
}

/**
 * 移除现有的提示弹窗
 */
function removeExistingTooltip(ownerRequestId?: number): void {
    if (ownerRequestId !== undefined && inputTooltipOwnerRequestId !== ownerRequestId) return;

    const ui = inputTooltipUi;
    const existing = ui?.mounted;
    inputTooltipUi = null;
    inputTooltipOwnerRequestId = null;
    if (ui) {
        if (!existing || !config.animations) {
            // 如果禁用动画，直接移除
            ui.remove();
        } else {
            // 使用淡出动画
            existing.classList.add('hide');
            setTimeout(() => ui.remove(), 300);
        }
    }
}

/**
 * 添加输入框动画效果
 */
function addInputBoxAnimation(
    element: HTMLElement,
    animationType: 'translating' | 'success' | 'error',
    ownerRequestId: number,
): void {
    // 如果禁用了动画，则不添加动画效果
    if (!config.animations) {
        return;
    }
    
    // 移除已存在的动画类
    element.classList.remove('fluent-input-translating', 'fluent-input-success', 'fluent-input-error');
    
    // 添加新的动画类
    element.classList.add(`fluent-input-${animationType}`);
    
    // 如果不是翻译中的动画，在动画完成后移除类
    if (animationType !== 'translating') {
        setTimeout(() => {
            if (ownerRequestId !== activeInputTranslationRequestId) return;
            element.classList.remove(`fluent-input-${animationType}`);
        }, animationType === 'success' ? 1000 : 600);
    }
}

/**
 * 专门用于输入框翻译的微软翻译函数（不使用缓存）
 * 通过background脚本调用，避免Firefox的CORS问题
 */
async function translateWithMicrosoft(text: string, targetLang: string): Promise<string> {
    try {
        // 发送消息给background脚本进行翻译
        const result = await browser.runtime.sendMessage({
            type: 'inputBoxTranslation',
            text: text,
            targetLang: targetLang
        });
        
        if (result && result.success) {
            return result.translatedText;
        } else {
            throw new Error(result?.error || '微软翻译失败');
        }
    } catch (error) {
        console.error('微软翻译请求失败:', error);
        throw error;
    }
}

/**
 * 处理输入框翻译
 */
async function handleInputBoxTranslation(
    element: HTMLElement,
    signal: AbortSignal,
    readConfigGeneration: () => number,
): Promise<void> {
    invalidateActiveInputBoxTranslation();
    const requestId = activeInputTranslationRequestId;
    activeInputTranslationElement = element;
    const configGeneration = readConfigGeneration();
    const inputSnapshot = getInputBoxValueSnapshot(element);
    const originalText = getInputBoxText(element);
    const trigger = config.inputBoxTranslationTrigger;
    const targetLanguage = config.inputBoxTranslationTarget;

    const isCurrentAndUnchanged = () => requestId === activeInputTranslationRequestId
        && canCommitInputBoxTranslation({
            signal,
            expectedValue: inputSnapshot,
            currentValue: getInputBoxValueSnapshot(element),
            expectedConfigGeneration: configGeneration,
            currentConfigGeneration: readConfigGeneration(),
            isEnabled: isInputBoxTranslationEnabled(),
            isSiteDisabled: currentPageSiteDisabled,
        });
    const clearOwnedVisuals = () => {
        if (requestId !== activeInputTranslationRequestId) return;
        element.classList.remove('fluent-input-translating');
        if (activeInputTranslationElement === element) activeInputTranslationElement = null;
        removeExistingTooltip(requestId);
    };
    const handleAbort = () => clearOwnedVisuals();
    signal.addEventListener('abort', handleAbort, { once: true });

    try {
        if (!isCurrentAndUnchanged() || !originalText) return;

        // 根据触发方式去除末尾的触发符号
        const cleanedText = removeTriggerSymbols(originalText, trigger);
        if (!cleanedText) return;

        // 新请求接管当前提示，之前请求的 finally/定时器只能移除自己的 tooltip。
        removeExistingTooltip();
        addInputBoxAnimation(element, 'translating', requestId);
        const loadingTooltip = await createTranslationTooltip(
            element,
            '微软翻译中',
            'translating',
            requestId,
            signal,
        );
        if (!loadingTooltip || !isCurrentAndUnchanged()) {
            clearOwnedVisuals();
            return;
        }

        try {
            // runtime.sendMessage 无法中断已发往 background 的请求，
            // 因此在结果落地前同时校验 feature signal、请求序号与输入快照。
            const translatedText = await translateWithMicrosoft(cleanedText, targetLanguage);
            if (!isCurrentAndUnchanged()) {
                clearOwnedVisuals();
                return;
            }

            element.classList.remove('fluent-input-translating');
            removeExistingTooltip(requestId);
            if (translatedText && translatedText !== cleanedText) {
                setInputBoxText(element, translatedText);
                addInputBoxAnimation(element, 'success', requestId);
                await createTranslationTooltip(element, '翻译成功', 'success', requestId, signal);
            } else {
                addInputBoxAnimation(element, 'error', requestId);
                await createTranslationTooltip(element, '内容无需翻译', 'error', requestId, signal);
            }
        } catch (translationError) {
            if (!isCurrentAndUnchanged()) {
                clearOwnedVisuals();
                return;
            }
            element.classList.remove('fluent-input-translating');
            addInputBoxAnimation(element, 'error', requestId);
            removeExistingTooltip(requestId);
            await createTranslationTooltip(element, '微软翻译失败', 'error', requestId, signal);
            console.error('微软翻译失败:', translationError);
        }

        // 所有者校验保证旧请求的定时器不会移除新 tooltip。
        setTimeout(() => removeExistingTooltip(requestId), 2500);
    } catch (error) {
        if (!isCurrentAndUnchanged()) {
            clearOwnedVisuals();
            return;
        }
        console.error('输入框翻译失败:', error);
        element.classList.remove('fluent-input-translating');
        addInputBoxAnimation(element, 'error', requestId);
        removeExistingTooltip(requestId);
        await createTranslationTooltip(element, '翻译服务暂时不可用', 'error', requestId, signal);
        setTimeout(() => removeExistingTooltip(requestId), 3000);
    } finally {
        signal.removeEventListener('abort', handleAbort);
    }
}
