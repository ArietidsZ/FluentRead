/**
 * @file src/app/background/contextMenuRuntime.ts
 * 文件职责：管理后台右键菜单的安装、展示状态同步和点击路由，让页面翻译菜单随配置及标签页翻译状态保持一致。
 * 主要内容：等待配置就绪后创建或更新菜单，订阅配置变化，读取 TabTranslationStateStore 决定“翻译/恢复”状态，保留可重复的“识别全部节点”入口，并把合法标签页上的点击转成对应运行时消息。
 * 模块边界：这里只编排 browser.contextMenus、tabs 与 app 层状态，不执行正文翻译、不解析站点规则细节；菜单展示决策和翻译动作分别交给 feature domain 与 content runtime。
 */
import {CONTEXT_MENU_IDS} from '@/src/core/config/constants';
import {config, configReady, subscribeConfig} from '@/src/services/config/store';
import {getContextMenuItems, resolveContextMenuLanguage} from './contextMenuUi';
import {isBrowserTabId, type TabTranslationState, TabTranslationStateStore} from './tabTranslationState';

interface BrowserTabSummary {
    id?: number;
}

interface FullPageStateResponse {
    status?: string;
    isTranslated?: boolean;
    isSiteDisabled?: boolean;
}

export interface BackgroundContextMenuRuntime {
    readonly isSupported: boolean;
    update(tabId: number): Promise<void>;
}

/**
 * 组装右键菜单与标签页生命周期。
 *
 * 该模块只保存 worker 瞬时状态；页面是否已翻译仍以 content script 的回复为真值。
 */
export function installBackgroundContextMenus(
    tabTranslationStates: TabTranslationStateStore,
): BackgroundContextMenuRuntime {
    const isSupported = !!browser.contextMenus;
    let contextMenusReady = false;
    let contextMenuEnabled = true;
    let contextMenuLanguage = resolveContextMenuLanguage(config.uiLanguage);
    let contextMenuSyncQueue: Promise<void> = Promise.resolve();

    const readTabTranslationState = async (tabId: number): Promise<TabTranslationState> => {
        try {
            const response = await browser.tabs.sendMessage(tabId, {
                type: 'getFullPageTranslationState',
            }) as FullPageStateResponse | undefined;
            if (response?.status === 'success') {
                return tabTranslationStates.set(tabId, {
                    isTranslated: response.isTranslated === true,
                    isSiteDisabled: response.isSiteDisabled === true,
                });
            }
        } catch {
            // 浏览器内部页或尚未注入内容脚本的页面无法查询，沿用当前 worker 的安全默认值。
        }

        return tabTranslationStates.set(tabId, tabTranslationStates.get(tabId));
    };

    const update = async (tabId: number): Promise<void> => {
        if (!isSupported || !contextMenusReady) return;
        // contextMenus.update 修改全局菜单项；后台标签页不能覆盖当前活动页的标题。
        const activeTabs = await browser.tabs.query({active: true, lastFocusedWindow: true}) as BrowserTabSummary[];
        if (!activeTabs.some((tab) => tab.id === tabId)) return;

        const state = await readTabTranslationState(tabId);
        try {
            for (const {id, ...presentation} of getContextMenuItems(state.isTranslated, state.isSiteDisabled, contextMenuLanguage)) {
                await browser.contextMenus.update(id, presentation);
            }
        } catch (error) {
            console.error('Failed to update context menu:', error);
        }
    };

    const sync = (): Promise<void> => {
        const requestedEnabled = contextMenuEnabled;
        contextMenuSyncQueue = contextMenuSyncQueue
            .catch(() => undefined)
            .then(async () => {
                if (requestedEnabled !== contextMenuEnabled) return;
                contextMenusReady = false;
                await browser.contextMenus.removeAll();
                if (!requestedEnabled || requestedEnabled !== contextMenuEnabled) return;

                for (const item of getContextMenuItems(false, false, contextMenuLanguage)) {
                    await browser.contextMenus.create({...item, contexts: ['page', 'selection']});
                }
                if (requestedEnabled !== contextMenuEnabled) {
                    await browser.contextMenus.removeAll();
                    return;
                }

                contextMenusReady = true;
                const activeTabs = await browser.tabs.query({active: true, lastFocusedWindow: true}) as BrowserTabSummary[];
                const activeTab = activeTabs.find((tab) => typeof tab.id === 'number');
                if (activeTab?.id !== undefined) await update(activeTab.id);
            })
            .catch((error) => {
                contextMenusReady = false;
                console.error('Error syncing context menu:', error);
            });
        return contextMenuSyncQueue;
    };

    if (!isSupported) {
        console.log('不支持右键菜单');
    } else {
        void configReady.then(() => {
            contextMenuEnabled = config.contextMenuEnabled !== false;
            contextMenuLanguage = resolveContextMenuLanguage(config.uiLanguage);
            void sync();
            subscribeConfig((nextConfig) => {
                const nextEnabled = nextConfig.contextMenuEnabled !== false;
                const nextLanguage = resolveContextMenuLanguage(nextConfig.uiLanguage); const languageChanged = nextLanguage !== contextMenuLanguage;
                contextMenuLanguage = nextLanguage;
                if (nextEnabled === contextMenuEnabled && !languageChanged) return;
                contextMenuEnabled = nextEnabled;
                void sync();
            });
        });

        browser.contextMenus.onClicked.addListener((info: any, tab: any) => {
            if (!contextMenuEnabled
                || !Object.values(CONTEXT_MENU_IDS).includes(info.menuItemId)
                || !isBrowserTabId(tab?.id)) return;

            void (async () => {
                try {
                    const state = await readTabTranslationState(tab.id);
                    if (state.isSiteDisabled) {
                        await update(tab.id);
                        return;
                    }
                    const action = info.menuItemId === CONTEXT_MENU_IDS.TRANSLATE_ALL_NODES
                        ? 'allNodes' : state.isTranslated ? 'restore' : 'fullPage';
                    const response = await browser.tabs.sendMessage(tab.id, {
                        type: 'contextMenuTranslate', action,
                    }) as FullPageStateResponse | undefined;
                    if (response?.status !== 'success') return;
                    tabTranslationStates.setTranslated(
                        tab.id,
                        typeof response.isTranslated === 'boolean'
                            ? response.isTranslated
                            : action !== 'restore',
                    );
                    await update(tab.id);
                } catch (error) {
                    console.error('Failed to send message to content script:', error);
                }
            })();
        });
    }

    browser.tabs.onActivated.addListener((activeInfo: any) => { if (isSupported) void update(activeInfo.tabId); });
    browser.tabs.onUpdated.addListener((tabId: any, changeInfo: any) => { if (changeInfo.status !== 'loading') return; tabTranslationStates.reset(tabId); if (isSupported) void update(tabId); });
    browser.tabs.onRemoved.addListener((tabId: any) => tabTranslationStates.delete(tabId));

    return {isSupported, update};
}
