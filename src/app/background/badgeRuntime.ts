/**
 * @file src/app/background/badgeRuntime.ts
 * 文件职责：按标签页显示尺寸可控、半透明的工具栏翻译状态叠层。
 * 主要内容：根据内容脚本提供的真实结果状态选择静态图标，序列化同一标签页的写入，并在导航和关闭时清理；MV3 与 MV2 共用静态 PNG。
 * 模块边界：只读取状态并调用 action/browserAction，不改页面 DOM、用户配置或翻译任务；静态资源不需要额外权限或后台 Canvas。
 */
import {TabTranslationStateStore} from './tabTranslationState';
import {createTabTranslationStateReader} from './tabTranslationQuery';
import {normalizeTranslationToolbarStatus, type TranslationToolbarStatus} from '@/src/features/full-page-translation/toolbarStatus';

interface BadgeActionApi {
    setBadgeText(details: {tabId: number; text: string}): Promise<void> | void;
    setIcon(details: {tabId: number; path: Record<number, string>}): Promise<void> | void;
}
export interface BackgroundBadgeRuntime {
    readonly isSupported: boolean;
    update(tabId: number): Promise<void>;
}

const iconPaths = (status: TranslationToolbarStatus): Record<number, string> => Object.fromEntries(
    [16, 32, 48, 64, 128].map(size => [size, status === 'idle' ? `icon/${size}.png` : `icon/toolbar/${status}-${size}.png`]),
);

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
                // 清理升级前的原生大角标；新叠层已经包含在静态图标中。
                await action.setBadgeText({tabId, text: ''});
                if (versions.get(tabId) !== version) return;
                await action.setIcon({tabId, path: iconPaths(status)});
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
