/**
 * @file src/app/background/badgeRuntime.ts
 * 文件职责：按标签页显示浏览器原生的三态翻译状态角标。
 * 主要内容：根据内容脚本真实结果显示蓝色省略号、绿色对勾或橙色感叹号，序列化写入并在导航和关闭时清理。
 * 模块边界：只读取状态并调用 action/browserAction，不改页面 DOM、用户配置或翻译任务；角标尺寸由浏览器管理，不需要额外权限或后台 Canvas。
 */
import {TabTranslationStateStore} from './tabTranslationState';
import {createTabTranslationStateReader} from './tabTranslationQuery';
import {normalizeTranslationToolbarStatus, type TranslationToolbarStatus} from '@/src/features/full-page-translation/toolbarStatus';

interface BadgeActionApi {
    setBadgeText(details: {tabId: number; text: string}): Promise<void> | void;
    setBadgeBackgroundColor(details: {tabId: number; color: string}): Promise<void> | void;
    setBadgeTextColor?(details: {tabId: number; color: string}): Promise<void> | void;
    setIcon(details: {tabId: number; path: Record<number, string>}): Promise<void> | void;
}
export interface BackgroundBadgeRuntime {
    readonly isSupported: boolean;
    update(tabId: number): Promise<void>;
}

const iconPaths = Object.fromEntries([16, 32, 48, 64, 128].map(size => [size, `icon/${size}.png`]));
const badges = {
    translating: {text: '…', color: '#2563eb'},
    translated: {text: '✓', color: '#15803d'},
    error: {text: '!', color: '#b45309'},
};

export function installBackgroundBadge(tabTranslationStates: TabTranslationStateStore): BackgroundBadgeRuntime {
    const action = (browser.action ?? browser.browserAction) as BadgeActionApi | undefined;
    const isSupported = !!action;
    const read = createTabTranslationStateReader(tabTranslationStates);
    const queues = new Map<number, Promise<void>>();
    const versions = new Map<number, object>();
    const rendered = new Map<number, TranslationToolbarStatus>();

    const render = (tabId: number, status: TranslationToolbarStatus): Promise<void> => {
        if (!action) return Promise.resolve();
        const version = {}; versions.set(tabId, version);
        const job = (queues.get(tabId) ?? Promise.resolve()).then(async () => {
            if (versions.get(tabId) !== version || rendered.get(tabId) === status) return;
            try {
                // 首次写入后旧缓存便不能代表实际角标；中断或失败后回到原状态也必须重画。
                rendered.delete(tabId);
                // 恢复品牌原图，避免静态叠层与原生角标同时显示。
                await action.setBadgeText({tabId, text: ''});
                if (versions.get(tabId) !== version) return;
                await action.setIcon({tabId, path: iconPaths});
                if (versions.get(tabId) !== version) return;
                if (status !== 'idle') {
                    const badge = badges[status];
                    await action.setBadgeBackgroundColor({tabId, color: badge.color});
                    if (versions.get(tabId) !== version) return;
                    if (action.setBadgeTextColor) {
                        await action.setBadgeTextColor({tabId, color: '#ffffff'});
                        if (versions.get(tabId) !== version) return;
                    }
                    await action.setBadgeText({tabId, text: badge.text});
                }
                if (versions.get(tabId) === version) rendered.set(tabId, status);
            } catch (error) { console.error('Failed to update toolbar translation status:', error); }
        }).finally(() => { if (queues.get(tabId) === job) queues.delete(tabId); });
        queues.set(tabId, job);
        return job;
    };
    const update = async (tabId: number): Promise<void> => {
        if (!isSupported) return;
        const state = tabTranslationStates.get(tabId);
        await render(tabId, state.isTranslated && !state.isSiteDisabled
            ? normalizeTranslationToolbarStatus(state.toolbarStatus) : 'idle');
    };
    const refresh = async (tabId: number): Promise<void> => {
        if (!isSupported) return;
        const token = {}; versions.set(tabId, token);
        await read(tabId, true);
        if (versions.get(tabId) === token) await update(tabId);
    };
    if (isSupported) {
        browser.tabs.onActivated.addListener((info: {tabId: number}) => { void refresh(info.tabId); });
        browser.tabs.onUpdated.addListener((tabId: number, change: {status?: string}) => {
            if (change.status === 'loading') { rendered.delete(tabId); void render(tabId, 'idle'); }
        });
        browser.tabs.onRemoved.addListener((tabId: number) => { versions.delete(tabId); rendered.delete(tabId); });
    }
    return {isSupported, update};
}
