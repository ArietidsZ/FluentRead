import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {CONTEXT_MENU_IDS} from '@/src/core/config/constants';
import {installBackgroundContextMenus} from '@/src/app/background/contextMenuRuntime';
import {TabTranslationStateStore} from '@/src/app/background/tabTranslationState';

const mocks = vi.hoisted(() => ({
    config: {contextMenuEnabled: true, uiLanguage: 'zh-CN'},
    subscribeConfig: vi.fn(),
}));
vi.mock('@/src/services/config/store', () => ({
    config: mocks.config,
    configReady: Promise.resolve(),
    subscribeConfig: mocks.subscribeConfig,
}));

const FULL_PAGE = CONTEXT_MENU_IDS.TRANSLATE_FULL_PAGE;
const ALL_NODES = CONTEXT_MENU_IDS.TRANSLATE_ALL_NODES;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function eventPort() {
    return {addListener: vi.fn()};
}

function fixture(supported = true) {
    const state = {isTranslated: false, isSiteDisabled: false};
    const contextMenus = {
        create: vi.fn(async (_item: unknown) => undefined),
        update: vi.fn(async (_id: string, _item: unknown) => undefined),
        removeAll: vi.fn(async () => undefined),
        onClicked: eventPort(),
    };
    const tabs = {
        query: vi.fn(async (_query: unknown): Promise<Array<{id?: number}>> => [{id: 7}]),
        sendMessage: vi.fn(async (_id: number, message: {type: string; action?: string}): Promise<unknown> => {
            if (message.type === 'contextMenuTranslate') state.isTranslated = message.action !== 'restore';
            return {status: 'success', ...state};
        }),
        onActivated: eventPort(),
        onUpdated: eventPort(),
        onRemoved: eventPort(),
    };
    vi.stubGlobal('browser', {contextMenus: supported ? contextMenus : undefined, tabs});
    const store = new TabTranslationStateStore();
    const runtime = installBackgroundContextMenus(store);
    const notifyConfig = (patch: Partial<typeof mocks.config>) => {
        Object.assign(mocks.config, patch);
        mocks.subscribeConfig.mock.calls[0][0]({...mocks.config});
    };
    const click = async (id: string = ALL_NODES, tab: unknown = {id: 7}) => {
        contextMenus.onClicked.addListener.mock.calls[0][0]({menuItemId: id}, tab);
        await flush();
    };
    const actions = () => tabs.sendMessage.mock.calls
        .filter(([, message]) => message.type === 'contextMenuTranslate')
        .map(([, message]) => message.action);
    return {state, store, runtime, tabs, contextMenus, click, actions, notifyConfig};
}

beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.config, {contextMenuEnabled: true, uiLanguage: 'zh-CN'});
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('网页右键全部节点入口与普通全文菜单共用生命周期', () => {
    it('同时注册两个页面和选区入口，并从内容页读取当前状态', async () => {
        const f = fixture();
        expect(f.runtime.isSupported).toBe(true);
        await f.runtime.update(7);
        await flush();
        expect(f.contextMenus.create.mock.calls.map(([item]) => item)).toEqual([
            {id: FULL_PAGE, title: '流畅阅读翻译', enabled: true, contexts: ['page', 'selection']},
            {id: ALL_NODES, title: '识别全部节点', enabled: true, contexts: ['page', 'selection']},
        ]);
        expect(f.tabs.sendMessage).toHaveBeenCalledWith(7, {type: 'getFullPageTranslationState'});
        expect(f.contextMenus.update).toHaveBeenCalledWith(ALL_NODES, {title: '识别全部节点', enabled: true});
    });

    it('首次与重复识别全部节点始终发送 allNodes，普通菜单仍可恢复和再次翻译', async () => {
        const f = fixture();
        await flush();
        await f.click();
        await f.click();
        expect(f.actions()).toEqual(['allNodes', 'allNodes']);
        expect(f.store.get(7).isTranslated).toBe(true);
        expect(f.contextMenus.update).toHaveBeenLastCalledWith(ALL_NODES, {title: '识别全部节点', enabled: true});
        expect(f.contextMenus.update).toHaveBeenCalledWith(FULL_PAGE, {title: '流畅阅读取消翻译', enabled: true});
        await f.click(FULL_PAGE);
        await f.click(FULL_PAGE);
        expect(f.actions()).toEqual(['allNodes', 'allNodes', 'restore', 'fullPage']);
    });

    it('已翻译页面识别失败时保留恢复入口，不把未成功的调用当作状态切换', async () => {
        const f = fixture();
        f.state.isTranslated = true;
        await flush();
        f.tabs.sendMessage.mockImplementation(async (_id, message) => message.type === 'getFullPageTranslationState'
            ? {status: 'success', ...f.state} : {status: 'failed', error: 'service unavailable'});
        f.contextMenus.update.mockClear();
        await f.click();
        expect(f.actions()).toEqual(['allNodes']);
        expect(f.store.get(7).isTranslated).toBe(true);
        expect(f.contextMenus.update).not.toHaveBeenCalled();
    });

    it('缺失回执或内容脚本断开时不伪造翻译成功，并允许下次重试', async () => {
        const f = fixture();
        await flush();
        f.tabs.sendMessage.mockImplementationOnce(async () => ({status: 'success', ...f.state}))
            .mockResolvedValueOnce(undefined);
        await f.click();
        expect(f.store.get(7).isTranslated).toBe(false);
        f.tabs.sendMessage.mockImplementationOnce(async () => ({status: 'success', ...f.state}))
            .mockRejectedValueOnce(new Error('disconnected'));
        await f.click();
        expect(f.store.get(7).isTranslated).toBe(false);
        expect(console.error).toHaveBeenCalledWith('Failed to send message to content script:', expect.any(Error));
        await f.click();
        expect(f.store.get(7).isTranslated).toBe(true);
    });

    it('优先采纳成功回执中的显式状态，而兼容旧回执时按动作含义推导', async () => {
        const f = fixture();
        await flush();
        f.tabs.query.mockResolvedValue([{id: 8}]);
        for (const [id, before, response, after] of [
            [ALL_NODES, true, {status: 'success'}, true],
            [ALL_NODES, false, {status: 'success'}, true],
            [FULL_PAGE, true, {status: 'success'}, false],
            [FULL_PAGE, false, {status: 'success'}, true],
            [ALL_NODES, true, {status: 'success', isTranslated: false}, false],
        ] as const) {
            f.state.isTranslated = before;
            f.tabs.sendMessage.mockImplementationOnce(async () => ({status: 'success', ...f.state}))
                .mockResolvedValueOnce(response);
            await f.click(id);
            expect(f.store.get(7).isTranslated).toBe(after);
        }
    });

    it('禁用站点同时禁用两项，保留全部节点名称并在点击时再次确认站点状态', async () => {
        const f = fixture();
        await flush();
        f.state.isSiteDisabled = true;
        await f.click();
        await f.click(FULL_PAGE);
        expect(f.actions()).toEqual([]);
        expect(f.contextMenus.update).toHaveBeenCalledWith(FULL_PAGE, {title: '流畅阅读（当前网站已禁用）', enabled: false});
        expect(f.contextMenus.update).toHaveBeenCalledWith(ALL_NODES, {title: '识别全部节点', enabled: false});
        f.state.isSiteDisabled = false;
        await f.runtime.update(7);
        await f.click();
        expect(f.actions()).toEqual(['allNodes']);
    });

    it('未知菜单、非法标签页和关闭菜单后的旧点击均不发送消息', async () => {
        const f = fixture();
        await flush();
        f.tabs.sendMessage.mockClear();
        await f.click('unrelated-menu');
        for (const tab of [null, {}, {id: -1}, {id: 1.5}, {id: '7'}]) await f.click(ALL_NODES, tab);
        f.contextMenus.onClicked.addListener.mock.calls[0][0]({menuItemId: ALL_NODES}, undefined);
        await flush();
        expect(f.actions()).toEqual([]);
        f.notifyConfig({contextMenuEnabled: false});
        await flush();
        await f.click();
        expect(f.actions()).toEqual([]);
    });

    it('初始关闭时不创建菜单，启用及语言变化重建两项，其他配置不会重建', async () => {
        mocks.config.contextMenuEnabled = false;
        const f = fixture();
        await flush();
        expect(f.contextMenus.create).not.toHaveBeenCalled();
        f.notifyConfig({contextMenuEnabled: true});
        await flush();
        expect(f.contextMenus.create).toHaveBeenCalledTimes(2);
        f.notifyConfig({});
        await flush();
        expect(f.contextMenus.create).toHaveBeenCalledTimes(2);
        f.notifyConfig({uiLanguage: 'en-US'});
        await flush();
        expect(f.contextMenus.create).toHaveBeenCalledTimes(4);
        expect(f.contextMenus.create).toHaveBeenLastCalledWith({
            id: ALL_NODES, title: 'Detect all nodes', enabled: true, contexts: ['page', 'selection'],
        });
        f.notifyConfig({contextMenuEnabled: false});
        await flush();
        expect(f.contextMenus.removeAll).toHaveBeenCalledTimes(4);
    });

    it('非活动标签页不能覆盖全局菜单，而激活、刷新与关闭沿用状态清理', async () => {
        const f = fixture();
        await flush();
        f.contextMenus.update.mockClear();
        await f.runtime.update(8);
        expect(f.contextMenus.update).not.toHaveBeenCalled();
        f.state.isTranslated = true;
        f.tabs.onActivated.addListener.mock.calls[0][0]({tabId: 7});
        await flush();
        expect(f.store.get(7).isTranslated).toBe(true);
        f.tabs.onUpdated.addListener.mock.calls[0][0](7, {status: 'complete'});
        expect(f.store.get(7).isTranslated).toBe(true);
        f.state.isTranslated = false;
        f.tabs.onUpdated.addListener.mock.calls[0][0](7, {status: 'loading'});
        await flush();
        expect(f.store.get(7).isTranslated).toBe(false);
        f.tabs.onRemoved.addListener.mock.calls[0][0](7);
        expect(f.store.hasCompleteState(7)).toBe(false);
    });

    it('页面未注入时沿用已知禁用状态，空状态回执归一化为未翻译', async () => {
        const f = fixture();
        await flush();
        f.store.set(7, {isTranslated: false, isSiteDisabled: true});
        f.tabs.sendMessage.mockRejectedValueOnce(new Error('no receiver'));
        await f.runtime.update(7);
        expect(f.contextMenus.update).toHaveBeenLastCalledWith(ALL_NODES, {title: '识别全部节点', enabled: false});
        f.tabs.sendMessage.mockResolvedValueOnce(undefined);
        await f.runtime.update(7);
        expect(f.store.get(7).isSiteDisabled).toBe(true);
        f.tabs.sendMessage.mockResolvedValueOnce({status: 'success'});
        await f.runtime.update(7);
        expect(f.store.get(7)).toEqual({isTranslated: false, isSiteDisabled: false});
    });

    it('浏览器不支持菜单时仍清理标签页状态而不访问菜单 API', async () => {
        const f = fixture(false);
        await flush();
        expect(f.runtime.isSupported).toBe(false);
        expect(mocks.subscribeConfig).not.toHaveBeenCalled();
        f.store.set(7, {isTranslated: true, isSiteDisabled: false});
        await f.runtime.update(7);
        f.tabs.onActivated.addListener.mock.calls[0][0]({tabId: 7});
        f.tabs.onUpdated.addListener.mock.calls[0][0](7, {status: 'loading'});
        expect(f.store.get(7).isTranslated).toBe(false);
        f.tabs.onRemoved.addListener.mock.calls[0][0](7);
        expect(f.store.hasCompleteState(7)).toBe(false);
        expect(f.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('菜单 API 失败后记录错误，后续配置刷新可恢复两项', async () => {
        const f = fixture();
        f.contextMenus.create.mockRejectedValueOnce(new Error('creation failed'));
        await flush();
        expect(console.error).toHaveBeenCalledWith('Error syncing context menu:', expect.any(Error));
        f.notifyConfig({uiLanguage: 'en-US'});
        await flush();
        expect(f.contextMenus.create).toHaveBeenLastCalledWith(expect.objectContaining({id: ALL_NODES}));
        f.contextMenus.update.mockRejectedValueOnce(new Error('update failed'));
        await f.runtime.update(7);
        expect(console.error).toHaveBeenCalledWith('Failed to update context menu:', expect.any(Error));
        await f.runtime.update(7);
        expect(f.contextMenus.update).toHaveBeenLastCalledWith(ALL_NODES, {title: 'Detect all nodes', enabled: true});
    });

    it('菜单创建中关闭配置时清理部分菜单，之后重新启用不会重复注册', async () => {
        const f = fixture();
        f.contextMenus.create.mockImplementationOnce(async () => {
            f.notifyConfig({contextMenuEnabled: false});
        });
        await flush();
        expect(f.contextMenus.removeAll.mock.invocationCallOrder.at(-1))
            .toBeGreaterThan(f.contextMenus.create.mock.invocationCallOrder.at(-1)!);
        expect(f.contextMenus.update).not.toHaveBeenCalled();
        f.notifyConfig({contextMenuEnabled: true});
        await flush();
        expect(f.contextMenus.update).toHaveBeenLastCalledWith(ALL_NODES, {title: '识别全部节点', enabled: true});
    });

    it('串行同步跳过过期配置请求，移除菜单期间的禁用不会继续创建', async () => {
        const f = fixture();
        await flush();
        f.contextMenus.create.mockClear();
        f.notifyConfig({contextMenuEnabled: false});
        f.notifyConfig({contextMenuEnabled: true});
        f.contextMenus.removeAll.mockImplementationOnce(async () => {
            f.notifyConfig({contextMenuEnabled: false});
        });
        await flush();
        expect(f.contextMenus.create).not.toHaveBeenCalled();
        expect(f.contextMenus.update).toHaveBeenCalledTimes(2);
    });

    it('没有活动标签页时仍注册两项，等下次激活再刷新展示', async () => {
        const f = fixture();
        f.tabs.query.mockResolvedValue([{id: undefined}]);
        await flush();
        expect(f.contextMenus.create).toHaveBeenCalledTimes(2);
        expect(f.contextMenus.update).not.toHaveBeenCalled();
        f.tabs.query.mockResolvedValue([{id: 7}]);
        f.tabs.onActivated.addListener.mock.calls[0][0]({tabId: 7});
        await flush();
        expect(f.contextMenus.update).toHaveBeenCalledTimes(2);
    });
});
