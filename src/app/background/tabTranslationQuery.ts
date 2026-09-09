/**
 * @file src/app/background/tabTranslationQuery.ts
 * 文件职责：把「向 content script 回源查询某标签页全文翻译真值」下沉为后台共享函数，供右键菜单与工具栏角标复用同一份真值来源。
 * 主要内容：createTabTranslationStateReader 绑定 TabTranslationStateStore 返回读取器，命中完整缓存直接返回，否则发送 getFullPageTranslationState 消息并写回缓存，查询失败时回退安全默认值。
 * 模块边界：这里只封装状态查询与缓存写回，不渲染菜单文案、不设置图标角标、不发起正文翻译；展示决策与生命周期监听仍归各自 runtime 模块。
 */
import {type TabTranslationState, TabTranslationStateStore} from './tabTranslationState';

export interface FullPageStateResponse {
    status?: string;
    isTranslated?: boolean;
    isSiteDisabled?: boolean;
}

/** 读取标签页翻译真值：force 为 true 时跳过缓存强制回源，用于菜单点击等需要最新态的场景。 */
export type TabTranslationStateReader = (tabId: number, force?: boolean) => Promise<TabTranslationState>;

/**
 * 绑定状态仓库返回真值读取器。
 *
 * 命中完整缓存直接返回；否则向 content script 查询并写回缓存。浏览器内部页或尚未注入内容脚本的页面查询失败，沿用当前 worker 的安全默认值。
 */
export function createTabTranslationStateReader(
    tabTranslationStates: TabTranslationStateStore,
): TabTranslationStateReader {
    return async (tabId: number, force = false): Promise<TabTranslationState> => {
        if (!force && tabTranslationStates.hasCompleteState(tabId)) return tabTranslationStates.get(tabId);
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
}
