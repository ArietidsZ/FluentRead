import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {nextTick} from 'vue';

const store = vi.hoisted(() => {
    const listeners = new Set<(config: {uiLanguage?: string}) => void>();
    return {
        config: {uiLanguage: 'zh-CN'} as {uiLanguage?: string},
        listeners,
        requestConfigPatch: vi.fn(async () => undefined),
        emit(next: {uiLanguage?: string}) {
            Object.assign(this.config, next);
            for (const listener of listeners) listener(this.config);
        },
    };
});
const loader = vi.hoisted(() => ({ensure: vi.fn<(language: unknown) => Promise<boolean>>()}));

vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage: vi.fn()}}}));
vi.mock('@/src/services/config/store', () => ({
    config: store.config,
    configReady: Promise.resolve(),
    requestConfigPatch: store.requestConfigPatch,
    subscribeConfig: (listener: (config: {uiLanguage?: string}) => void) => {
        store.listeners.add(listener);
        return () => store.listeners.delete(listener);
    },
}));
vi.mock('@/src/platform/i18n/uiLanguageBundles', () => ({ensureUiLanguageBundle: loader.ensure}));

import {registerUiLanguageBundle} from '@/src/core/i18n';
import {createUiI18nContext} from '@/src/ui/i18n';

function deferred() {
    let resolve!: (value: boolean) => void;
    const promise = new Promise<boolean>((done) => { resolve = done; });
    return {promise, resolve};
}

beforeEach(() => {
    store.config.uiLanguage = 'zh-CN';
    store.listeners.clear();
    store.requestConfigPatch.mockClear();
    loader.ensure.mockReset();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Vue 界面语言资源按需刷新', () => {
    it('资源到达后只为仍在使用该语言的界面递增修订号，普通配置变化不触发刷新', async () => {
        const pending = deferred();
        loader.ensure.mockReturnValue(pending.promise);
        const context = createUiI18nContext();
        await Promise.resolve();
        expect(loader.ensure).not.toHaveBeenCalled();

        store.emit({uiLanguage: 'ko-KR'});
        expect(context.language.value).toBe('ko-KR');
        expect(context.t('popup.donationTitle')).toBe(context.t('popup.donationTitle'));
        registerUiLanguageBundle('ko-KR', {messages: {'popup.donationTitle': '후원'}, legacyText: {}, legacyPatterns: {early: [], late: []}});
        pending.resolve(true);
        await pending.promise;
        await nextTick();
        expect(context.bundleRevision.value).toBe(1);
        expect(context.t('popup.donationTitle')).toBe('후원');

        // 已注册语言上的其他配置写入不应重复加载或整页重扫。
        store.emit({uiLanguage: 'ko-KR'});
        await Promise.resolve();
        expect(loader.ensure).toHaveBeenCalledOnce();
        expect(context.bundleRevision.value).toBe(1);
        context.dispose();
    });

    it('迟到或失败的资源不会刷新已切走或已销毁的界面', async () => {
        const stale = deferred();
        const failed = deferred();
        loader.ensure.mockReturnValueOnce(stale.promise).mockReturnValueOnce(failed.promise);
        const context = createUiI18nContext();
        store.emit({uiLanguage: 'ru-RU'});
        store.emit({uiLanguage: 'es-ES'});
        stale.resolve(true);
        failed.resolve(false);
        await Promise.all([stale.promise, failed.promise]);
        await nextTick();
        expect(context.bundleRevision.value).toBe(0);

        const late = deferred();
        loader.ensure.mockReturnValueOnce(late.promise);
        store.emit({uiLanguage: 'ja-JP'});
        context.dispose();
        late.resolve(true);
        await late.promise;
        expect(context.bundleRevision.value).toBe(0);
    });

    it('主动切换语言时先取得资源再提交配置，保存失败回滚到原语言', async () => {
        loader.ensure.mockResolvedValue(true);
        const context = createUiI18nContext();
        await context.setLanguage('fr-FR');
        expect(loader.ensure).toHaveBeenCalledWith('fr-FR');
        expect(loader.ensure.mock.invocationCallOrder[0]).toBeLessThan(store.requestConfigPatch.mock.invocationCallOrder[0]!);
        expect(store.requestConfigPatch).toHaveBeenCalledWith({uiLanguage: 'fr-FR', uiLanguageSetupCompleted: true}, expect.any(Function));
        expect(context.language.value).toBe('fr-FR');

        store.requestConfigPatch.mockRejectedValueOnce(new Error('offline'));
        await expect(context.setLanguage('en-US')).rejects.toThrow('offline');
        expect(context.language.value).toBe('fr-FR');
        context.dispose();
    });
});
