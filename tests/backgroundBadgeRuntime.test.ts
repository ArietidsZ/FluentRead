import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {installBackgroundBadge} from '@/src/app/background/badgeRuntime';
import {TabTranslationStateStore} from '@/src/app/background/tabTranslationState';

type Listener = (...args: any[]) => void;

interface FakeAction {
    setBadgeText: ReturnType<typeof vi.fn>;
    setBadgeBackgroundColor: ReturnType<typeof vi.fn>;
    setBadgeTextColor?: ReturnType<typeof vi.fn>;
}

const previousBrowser = (globalThis as Record<string, unknown>).browser;

function createEvent() {
    const listeners: Listener[] = [];
    return {
        listeners,
        addListener: (fn: Listener) => listeners.push(fn),
        emit: (...args: any[]) => listeners.forEach((fn) => fn(...args)),
    };
}

function installBrowser(options: {
    action?: FakeAction;
    namespace?: 'action' | 'browserAction';
    sendMessage?: ReturnType<typeof vi.fn>;
}) {
    const onActivated = createEvent();
    const onUpdated = createEvent();
    const onRemoved = createEvent();
    const browser: Record<string, unknown> = {
        tabs: {
            sendMessage: options.sendMessage ?? vi.fn(async () => undefined),
            onActivated,
            onUpdated,
            onRemoved,
        },
    };
    if (options.action) browser[options.namespace ?? 'action'] = options.action;
    (globalThis as Record<string, unknown>).browser = browser;
    return {onActivated, onUpdated, onRemoved};
}

function createAction(withTextColor = true): FakeAction {
    const action: FakeAction = {
        setBadgeText: vi.fn(async () => undefined),
        setBadgeBackgroundColor: vi.fn(async () => undefined),
    };
    if (withTextColor) action.setBadgeTextColor = vi.fn(async () => undefined);
    return action;
}

afterEach(() => {
    if (previousBrowser === undefined) delete (globalThis as Record<string, unknown>).browser;
    else (globalThis as Record<string, unknown>).browser = previousBrowser;
    vi.restoreAllMocks();
});

describe('后台翻译状态角标', () => {
    describe('状态到角标的映射（缓存路径 update）', () => {
        let store: TabTranslationStateStore;
        let action: FakeAction;

        beforeEach(() => {
            action = createAction();
            installBrowser({action});
            store = new TabTranslationStateStore();
        });

        it('已翻译且站点未禁用时显示深绿底白勾', async () => {
            store.set(3, {isTranslated: true, isSiteDisabled: false});
            const badge = installBackgroundBadge(store);
            await badge.update(3);
            expect(action.setBadgeText).toHaveBeenCalledWith({tabId: 3, text: '✓'});
            expect(action.setBadgeBackgroundColor).toHaveBeenCalledWith({tabId: 3, color: '#15803d'});
            expect(action.setBadgeTextColor).toHaveBeenCalledWith({tabId: 3, color: '#ffffff'});
        });

        it('恢复原文（未翻译）时清空角标且不再设色', async () => {
            store.set(3, {isTranslated: false, isSiteDisabled: false});
            const badge = installBackgroundBadge(store);
            await badge.update(3);
            expect(action.setBadgeText).toHaveBeenCalledWith({tabId: 3, text: ''});
            expect(action.setBadgeBackgroundColor).not.toHaveBeenCalled();
            expect(action.setBadgeTextColor).not.toHaveBeenCalled();
        });

        it('站点被禁用即使 isTranslated 为真也不显示角标', async () => {
            store.set(9, {isTranslated: true, isSiteDisabled: true});
            const badge = installBackgroundBadge(store);
            await badge.update(9);
            expect(action.setBadgeText).toHaveBeenCalledWith({tabId: 9, text: ''});
            expect(action.setBadgeBackgroundColor).not.toHaveBeenCalled();
        });
    });

    describe('再查询路径（onActivated）', () => {
        it('缓存缺失时回源查询真值并渲染角标', async () => {
            const action = createAction();
            const sendMessage = vi.fn(async () => ({status: 'success', isTranslated: true, isSiteDisabled: false}));
            const events = installBrowser({action, sendMessage});
            const store = new TabTranslationStateStore();
            installBackgroundBadge(store);

            await events.onActivated.emit({tabId: 5});
            // 等待再查询链路 resolve
            await Promise.resolve();
            await Promise.resolve();

            expect(sendMessage).toHaveBeenCalledWith(5, {type: 'getFullPageTranslationState'});
            expect(action.setBadgeText).toHaveBeenLastCalledWith({tabId: 5, text: '✓'});
        });

        it('回源查询失败时安全降级为无角标，不抛错', async () => {
            const action = createAction();
            const sendMessage = vi.fn(async () => {throw new Error('no content script');});
            const events = installBrowser({action, sendMessage});
            const store = new TabTranslationStateStore();
            installBackgroundBadge(store);

            await events.onActivated.emit({tabId: 7});
            await Promise.resolve();
            await Promise.resolve();

            expect(action.setBadgeText).toHaveBeenLastCalledWith({tabId: 7, text: ''});
            expect(action.setBadgeBackgroundColor).not.toHaveBeenCalled();
        });

        it('已有完整缓存时直接渲染，不再回源查询', async () => {
            const action = createAction();
            const sendMessage = vi.fn(async () => undefined);
            const events = installBrowser({action, sendMessage});
            const store = new TabTranslationStateStore();
            store.set(2, {isTranslated: true, isSiteDisabled: false});
            installBackgroundBadge(store);

            await events.onActivated.emit({tabId: 2});
            await Promise.resolve();

            expect(sendMessage).not.toHaveBeenCalled();
            expect(action.setBadgeText).toHaveBeenLastCalledWith({tabId: 2, text: '✓'});
        });
    });

    describe('生命周期自清空（onUpdated）', () => {
        it('页面进入 loading 时直接清空角标，不读写状态仓库', async () => {
            const action = createAction();
            const events = installBrowser({action});
            const store = new TabTranslationStateStore();
            store.set(4, {isTranslated: true, isSiteDisabled: false});
            const resetSpy = vi.spyOn(store, 'reset');
            installBackgroundBadge(store);

            await events.onUpdated.emit(4, {status: 'loading'});
            await Promise.resolve();

            expect(action.setBadgeText).toHaveBeenCalledWith({tabId: 4, text: ''});
            expect(resetSpy).not.toHaveBeenCalled();
        });

        it('非 loading 的更新不触发清空', async () => {
            const action = createAction();
            const events = installBrowser({action});
            const store = new TabTranslationStateStore();
            installBackgroundBadge(store);

            await events.onUpdated.emit(4, {status: 'complete'});
            await Promise.resolve();

            expect(action.setBadgeText).not.toHaveBeenCalled();
        });
    });

    describe('跨浏览器与降级', () => {
        it('Firefox MV2 经 browserAction 回退且缺 setBadgeTextColor 时仍设文案与底色', async () => {
            const action = createAction(false);
            installBrowser({action, namespace: 'browserAction'});
            const store = new TabTranslationStateStore();
            store.set(1, {isTranslated: true, isSiteDisabled: false});
            const badge = installBackgroundBadge(store);

            expect(badge.isSupported).toBe(true);
            await expect(badge.update(1)).resolves.toBeUndefined();
            expect(action.setBadgeText).toHaveBeenCalledWith({tabId: 1, text: '✓'});
            expect(action.setBadgeBackgroundColor).toHaveBeenCalledWith({tabId: 1, color: '#15803d'});
        });

        it('无 action 命名空间时 isSupported 为 false 且 update 静默空转', async () => {
            installBrowser({});
            const store = new TabTranslationStateStore();
            store.set(1, {isTranslated: true, isSiteDisabled: false});
            const badge = installBackgroundBadge(store);

            expect(badge.isSupported).toBe(false);
            await expect(badge.update(1)).resolves.toBeUndefined();
        });
    });
});
