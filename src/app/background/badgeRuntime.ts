/**
 * @file src/app/background/badgeRuntime.ts
 * 文件职责：把标签页全文翻译状态映射为工具栏图标上的绿色对勾角标，让用户在图标上直观看到当前页面是否已翻译。
 * 主要内容：installBackgroundBadge 探测 action 命名空间能力，提供缓存路径 update 与再查询路径 refreshActive，并自注册 onActivated/onUpdated/onRemoved 生命周期监听渲染或清空按标签页隔离的角标。
 * 模块边界：本模块只读状态并调用浏览器 action 角标 API，不写 TabTranslationStateStore、不改右键菜单、不发起正文翻译；真值查询复用 tabTranslationQuery，状态变更仍由 full-page feature 上报。
 */
import {type TabTranslationState, TabTranslationStateStore} from './tabTranslationState';
import {createTabTranslationStateReader} from './tabTranslationQuery';

interface BadgeActionApi {
    setBadgeText(details: {tabId?: number; text: string}): Promise<void> | void;
    setBadgeBackgroundColor(details: {tabId?: number; color: string}): Promise<void> | void;
    setBadgeTextColor?(details: {tabId?: number; color: string}): Promise<void> | void;
}

export interface BackgroundBadgeRuntime {
    readonly isSupported: boolean;
    update(tabId: number): Promise<void>;
}

/** 已翻译角标底色：深绿，浅色工具栏下与白勾对比更稳。 */
const BADGE_BACKGROUND = '#15803d';
/** 已翻译角标文字：白色前景，MV3+ 环境下显式设置以保证对比。 */
const BADGE_TEXT_COLOR = '#ffffff';
/** 已翻译角标符号：U+2713 对勾。刻意不用 U+2714，后者在 macOS/Chrome 会走 emoji 渲染而无视 setBadgeTextColor，导致对勾变深色。 */
const BADGE_CHECK = '✓';

/**
 * 安装工具栏翻译状态角标运行时。
 *
 * action 命名空间在 MV3 为 browser.action、Firefox MV2 为 browser.browserAction；polyfill 不会自动别名，必须经空值合并显式回退。userscript 产物无 action，isSupported 为 false 静默空转。
 */
export function installBackgroundBadge(
    tabTranslationStates: TabTranslationStateStore,
): BackgroundBadgeRuntime {
    const action = (browser.action ?? browser.browserAction) as BadgeActionApi | undefined;
    const isSupported = !!action;
    const readTabTranslationState = createTabTranslationStateReader(tabTranslationStates);

    // 纯渲染：仅依据已确定的 state 决定角标，无副作用查询。
    const renderBadge = async (tabId: number, state: TabTranslationState): Promise<void> => {
        if (!action) return;
        const showCheck = state.isTranslated && !state.isSiteDisabled;
        try {
            await action.setBadgeText({tabId, text: showCheck ? BADGE_CHECK : ''});
            if (showCheck) {
                await action.setBadgeBackgroundColor({tabId, color: BADGE_BACKGROUND});
                if (typeof action.setBadgeTextColor === 'function') {
                    await action.setBadgeTextColor({tabId, color: BADGE_TEXT_COLOR});
                }
            }
        } catch (error) {
            console.error('Failed to update action badge:', error);
        }
    };

    // 直接清空某标签页角标，页面进入 loading 时使用，不依赖其他模块 reset 状态。
    const clearBadge = async (tabId: number): Promise<void> => {
        if (!action) return;
        try {
            await action.setBadgeText({tabId, text: ''});
        } catch (error) {
            console.error('Failed to clear action badge:', error);
        }
    };

    // 缓存路径：onFullPageStateChanged → update，状态刚由 content 写入 store，直接读缓存渲染。
    const update = async (tabId: number): Promise<void> => {
        if (!isSupported) return;
        await renderBadge(tabId, tabTranslationStates.get(tabId));
    };

    // 再查询路径：onActivated → 缓存缺失时回源查询真值（MV3 worker 可能刚重启），查询失败内部返回安全默认 {false,false}。
    const refreshActive = async (tabId: number): Promise<void> => {
        if (!isSupported) return;
        const state = tabTranslationStates.hasCompleteState(tabId)
            ? tabTranslationStates.get(tabId)
            : await readTabTranslationState(tabId);
        await renderBadge(tabId, state);
    };

    if (isSupported) {
        browser.tabs.onActivated.addListener((activeInfo: any) => { void refreshActive(activeInfo.tabId); });
        browser.tabs.onUpdated.addListener((tabId: any, changeInfo: any) => {
            // 整页文档进入加载即清空角标；SPA history.pushState 软导航不触发 loading，属已知边界不处理。
            if (changeInfo.status === 'loading') void clearBadge(tabId);
        });
        // 角标随标签页销毁自动消失，保留监听以对齐右键菜单语义；此处无需手动清理。
        browser.tabs.onRemoved.addListener(() => undefined);
    }

    return {isSupported, update};
}
