import {installOptionsApp} from '@/src/app/options';
import OptionsApp from '@/src/app/options/OptionsApp.vue';
import {createVueShadowUi, type VueShadowMount} from '@/src/platform/shadow-ui';
import type {ShadowRootContentScriptUi} from 'wxt/utils/content-script-ui/shadow-root';
import {getUserscriptFunction} from './api';
import {
    buildUserscriptSettingsHash,
    buildUserscriptSettingsUrl,
    isUserscriptSettingsUrl,
    USERSCRIPT_SETTINGS_HASH,
} from './settingsPage';

export {buildUserscriptSettingsUrl, isUserscriptSettingsUrl};

let settingsUi: ShadowRootContentScriptUi<VueShadowMount> | null = null;
let settingsMountPromise: Promise<void> | null = null;
let settingsGeneration = 0;

function showInPageFallback(ctx: unknown, section?: string): void {
    void mountSettingsUi(ctx, section).catch((error) => {
        console.error('[FluentRead userscript] 设置标签页和页内回退都未能打开', error);
    });
}

function openSettingsTab(ctx: unknown, section?: string): boolean {
    const settingsUrl = buildUserscriptSettingsUrl(window.location.href, section);
    if (settingsUrl === window.location.href) return false;

    // Tampermonkey/Violentmonkey 等管理器提供的专用 API 不受普通 window.open
    // 弹窗策略影响；Via 等不提供时再退回浏览器原生新标签页。
    const legacyOpenInTab = getUserscriptFunction('GM_openInTab');
    if (legacyOpenInTab) {
        try {
            const result = legacyOpenInTab(settingsUrl, {active: true, insert: true, setParent: true});
            void Promise.resolve(result).catch(() => showInPageFallback(ctx, section));
            return true;
        } catch {
            // 继续尝试 window.open；部分管理器只声明 API 但运行时不可用。
        }
    }

    const modernOpenInTab = getUserscriptFunction(undefined, 'openInTab');
    if (modernOpenInTab) {
        try {
            // Userscripts for Safari uses a boolean background flag and returns
            // a Promise. Invoke it before any async work so the current click
            // remains a valid user gesture for opening a new tab.
            void Promise.resolve(modernOpenInTab(settingsUrl, false))
                .catch(() => showInPageFallback(ctx, section));
            return true;
        } catch {
            // 继续尝试 window.open；部分管理器只声明 API 但运行时不可用。
        }
    }

    try {
        // 不能在这里传入 noopener：部分 Chromium 会在保留新标签页的同时返回
        // null，脚本便会误判为弹窗被拦截并在源网页重复挂载面板。设置页 URL
        // 仍来自当前网页，拿到句柄后立即切断 opener，保留源页面隔离。
        const openedWindow = window.open(
            settingsUrl,
            'fluentread-userscript-settings',
        );
        if (openedWindow) {
            try {
                openedWindow.opener = null;
            } catch {
                // opener 只是一层额外防护；设置页本身仍在 closed Shadow DOM 内运行。
            }
        }
        return Boolean(openedWindow);
    } catch {
        return false;
    }
}

export async function openUserscriptSettings(ctx: unknown, section?: string): Promise<void> {
    if (!isUserscriptSettingsUrl(window.location.href) && openSettingsTab(ctx, section)) return;
    await mountSettingsUi(ctx, section);
}

async function mountSettingsUi(ctx: unknown, section?: string): Promise<void> {
    const separateSettingsPage = isUserscriptSettingsUrl(window.location.href);
    if (separateSettingsPage && section) {
        const nextHash = buildUserscriptSettingsHash(section);
        if (window.location.hash !== nextHash) window.location.hash = nextHash;
    }
    if (settingsUi) return;
    if (settingsMountPromise) return settingsMountPromise;
    const generation = settingsGeneration;
    const mountPromise = createVueShadowUi(ctx as never, {
        name: 'fluent-read-userscript-settings-ui',
        hostId: 'fluent-read-userscript-settings-container',
        component: OptionsApp,
        props: (container) => {
            const root = container.getRootNode();
            const shadowRoot = root instanceof ShadowRoot ? root : null;
            return {
                appearanceRoot: shadowRoot?.host instanceof HTMLElement ? shadowRoot.host : null,
                queryRoot: root,
                settingsHashPrefix: separateSettingsPage ? USERSCRIPT_SETTINGS_HASH : undefined,
                initialSection: separateSettingsPage ? undefined : section,
                locationRouting: separateSettingsPage ? undefined : 'internal',
            };
        },
        configureApp: (app) => installOptionsApp(app, {documentRoot: null}),
        viewport: true,
        zIndex: 2_147_483_647,
        mode: 'closed',
    }).then((ui) => {
        if (generation !== settingsGeneration) ui.remove();
        else settingsUi = ui;
    });
    settingsMountPromise = mountPromise;
    try {
        await mountPromise;
    } finally {
        if (settingsMountPromise === mountPromise) settingsMountPromise = null;
    }
}

export function closeUserscriptSettings(): void {
    settingsGeneration += 1;
    settingsMountPromise = null;
    settingsUi?.remove();
    settingsUi = null;
}
