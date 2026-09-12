/**
 * @file src/app/background/contextMenuRuntime.ts
 * 文件职责：管理后台右键菜单的安装、状态同步和点击路由，让菜单结构随设置重建，让标题随当前标签页的翻译与网站状态更新。
 * 主要内容：等待配置就绪后按菜单结构创建条目，订阅配置变化在必要时重建，读取 TabTranslationStateStore 解析每项的标题与可见性，并把点击交给动作模块执行。
 * 模块边界：这里只编排 browser.contextMenus、tabs 与 app 层状态，不推导菜单结构、不渲染文案、不执行翻译；结构归 core/context-menu，文案归 core/context-menu/presentation，动作归 contextMenuActions。
 */
import {
    buildContextMenuPlan,
    CONTEXT_MENU_BUCKET_CONTEXTS,
    resolveContextMenuPresentation,
    type ContextMenuPlanItem,
} from '@/src/core/context-menu/domain';
import {configReady, subscribeConfig} from '@/src/services/config/store';
import {runContextMenuAction, type ContextMenuClickInfo, type ContextMenuClickTab} from './contextMenuActions';
import {readContextMenuSettings, type ContextMenuSettingsSnapshot} from './contextMenuPreferences';
import {renderContextMenuTitle} from '@/src/core/context-menu/presentation';
import {isBrowserTabId, type TabTranslationState, TabTranslationStateStore} from './tabTranslationState';
import {createTabTranslationStateReader} from './tabTranslationQuery';
import {ensureUiLanguageBundle} from '@/src/platform/i18n/uiLanguageBundles';

const NEUTRAL_STATE: TabTranslationState = {isTranslated: false, isSiteDisabled: false};

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
    let settings: ContextMenuSettingsSnapshot = readContextMenuSettings();
    let plan: readonly ContextMenuPlanItem[] = [];
    let syncQueue: Promise<void> = Promise.resolve();
    const readTabTranslationState = createTabTranslationStateReader(tabTranslationStates);

    const present = (items: readonly ContextMenuPlanItem[], state: TabTranslationState) => resolveContextMenuPresentation(items, state, settings.display);
    const update = async (tabId: number, known?: TabTranslationState): Promise<void> => {
        if (!isSupported || plan.length === 0) return;
        // contextMenus.update 修改全局菜单项；后台标签页不能覆盖当前活动页的标题。
        const activeTabs = await browser.tabs.query({active: true, lastFocusedWindow: true}) as ContextMenuClickTab[];
        if (!activeTabs.some((tab) => tab.id === tabId)) return;

        for (const item of present(plan, known ?? await readTabTranslationState(tabId, true))) {
            try {
                await browser.contextMenus.update(item.menuItemId,
                    {title: renderContextMenuTitle(item, settings.titleContext), visible: item.visible});
            } catch (error) {
                console.error('Failed to update context menu:', error);
            }
        }
    };

    const createItems = async (snapshot: ContextMenuSettingsSnapshot): Promise<ContextMenuPlanItem[]> => {
        const items = snapshot.enabled ? [...buildContextMenuPlan(snapshot.toggles)] : [];
        const initial = resolveContextMenuPresentation(items, NEUTRAL_STATE, snapshot.display);
        for (const [index, item] of items.entries()) {
            await browser.contextMenus.create({
                id: item.menuItemId,
                title: renderContextMenuTitle(initial[index], snapshot.titleContext),
                visible: initial[index].visible,
                ...(item.parentId ? {parentId: item.parentId} : {contexts: [...CONTEXT_MENU_BUCKET_CONTEXTS[item.bucket]]}),
            });
        }
        return items;
    };

    const sync = (): Promise<void> => {
        const requested = settings;
        syncQueue = syncQueue
            .catch(() => undefined)
            .then(async () => {
                if (requested !== settings) return;
                // 菜单标题是一次性写入的原生文案；先取得界面语言资源，避免非中文用户看到中文回退。
                await ensureUiLanguageBundle(requested.titleContext.language);
                if (requested !== settings) return;
                plan = [];
                await browser.contextMenus.removeAll();
                const items = await createItems(requested);
                // 重建期间设置又变了：先撤掉刚建好的菜单，交给后一次同步重新生成。
                if (requested !== settings) {
                    await browser.contextMenus.removeAll();
                    return;
                }
                plan = items;
                const active = (await browser.tabs.query({active: true, lastFocusedWindow: true}) as ContextMenuClickTab[])
                    .find((tab) => typeof tab.id === 'number');
                if (active?.id !== undefined) await update(active.id);
            })
            .catch((error) => {
                plan = [];
                console.error('Error syncing context menu:', error);
            });
        return syncQueue;
    };

    const handleClick = async (info: ContextMenuClickInfo, tab: ContextMenuClickTab): Promise<void> => {
        const item = plan.find((entry) => entry.menuItemId === info.menuItemId);
        if (!item || !isBrowserTabId(tab.id)) return;
        try {
            const state = await readTabTranslationState(tab.id, true);
            const [presentation] = present([item], state);
            if (!presentation.visible || !presentation.action) return;
            const result = await runContextMenuAction(presentation.action, tab.id, info, tab, state.isTranslated);
            if (!result.handled) return;
            if (typeof result.isSiteDisabled === 'boolean') tabTranslationStates.setSiteDisabled(tab.id, result.isSiteDisabled);
            if (typeof result.isTranslated === 'boolean') tabTranslationStates.setTranslated(tab.id, result.isTranslated);
            await update(tab.id, tabTranslationStates.get(tab.id));
        } catch (error) {
            console.error('Failed to send message to content script:', error);
        }
    };

    if (!isSupported) {
        console.log('不支持右键菜单');
    } else {
        void configReady.then(() => {
            settings = readContextMenuSettings();
            void sync();
            subscribeConfig(() => {
                const next = readContextMenuSettings();
                if (next.signature === settings.signature) return;
                settings = next;
                void sync();
            });
        });

        browser.contextMenus.onClicked.addListener((info: any, tab: any) => void handleClick(info as ContextMenuClickInfo, (tab ?? {}) as ContextMenuClickTab));
    }

    browser.tabs.onActivated.addListener((activeInfo: any) => { if (isSupported) void update(activeInfo.tabId); });
    browser.tabs.onUpdated.addListener((tabId: any, changeInfo: any) => { if (changeInfo.status !== 'loading') return; tabTranslationStates.reset(tabId); if (isSupported) void update(tabId); });
    browser.tabs.onRemoved.addListener((tabId: any) => tabTranslationStates.delete(tabId));

    return {isSupported, update};
}
