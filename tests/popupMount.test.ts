import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    config: {uiLanguageSetupCompleted: false, uiLanguage: 'en-US', interfaceFont: 'system'},
    ready: Promise.resolve(), create: vi.fn(), language: vi.fn(), font: vi.fn(), plugin: vi.fn(),
    app: {use: vi.fn(), component: vi.fn(), mount: vi.fn()}, coffee: {name: 'Coffee'},
}));
vi.mock('vue', () => ({createApp: mocks.create}));
vi.mock('@element-plus/icons-vue', () => ({Coffee: mocks.coffee}));
vi.mock('@/src/services/config/store', () => ({config: mocks.config, get configReady() {return mocks.ready;}}));
vi.mock('@/src/platform/i18n/uiLanguageBundles', () => ({ensureUiLanguageBundle: mocks.language}));
vi.mock('@/src/ui/interfaceAppearance', () => ({prepareInterfaceFont: mocks.font}));
vi.mock('@/src/ui/i18n', () => ({createUiI18nPlugin: mocks.plugin}));
vi.mock('@/src/app/popup/PopupOnboarding.vue', () => ({default: {name: 'Onboarding'}}));
vi.mock('@/src/app/popup/PopupApp.vue', () => ({default: {name: 'MainMenu'}}));

beforeEach(() => {
    vi.resetModules(); vi.resetAllMocks();
    mocks.ready = Promise.resolve(); mocks.config.uiLanguageSetupCompleted = false;
    mocks.create.mockReturnValue(mocks.app); mocks.plugin.mockReturnValue({name: 'i18n'});
    vi.stubGlobal('document', {body: {id: 'popup-body'}});
});
afterEach(() => vi.unstubAllGlobals());

describe('popup mount composition', () => {
    it.each([false, true])('mounts the prepared root for setupCompleted=%s', async completed => {
        mocks.config.uiLanguageSetupCompleted = completed;
        const {mountPreparedPopupApp} = await import('@/src/app/popup/mount');
        await mountPreparedPopupApp('#custom-popup');
        expect(mocks.create).toHaveBeenCalledWith({name: completed ? 'MainMenu' : 'Onboarding'});
        expect(mocks.font).toHaveBeenCalledWith('system');
        if (completed) expect(mocks.language).toHaveBeenCalledWith('en-US');
        else expect(mocks.language).not.toHaveBeenCalled();
        expect(mocks.plugin).toHaveBeenCalledWith({documentRoot: document.body, documentTitleKey: 'metadata.popupTitle'});
        expect(mocks.app.use).toHaveBeenCalledWith({name: 'i18n'});
        expect(mocks.app.component).toHaveBeenCalledWith('Coffee', mocks.coffee);
        expect(mocks.app.mount).toHaveBeenCalledWith('#custom-popup');
    });

    it('waits for configuration before choosing and preparing the root', async () => {
        let resolve!: () => void;
        mocks.ready = new Promise<void>(yes => {resolve = yes;});
        const {mountPreparedPopupApp} = await import('@/src/app/popup/mount');
        const pending = mountPreparedPopupApp('#app');
        try {
            await Promise.resolve();
            expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.font).not.toHaveBeenCalled();
            mocks.config.uiLanguageSetupCompleted = true;
        } finally {resolve(); await pending;}
        expect(mocks.create).toHaveBeenCalledWith({name: 'MainMenu'});
        expect(mocks.language).toHaveBeenCalledWith('en-US');
    });

    it('does not create or mount a partially prepared menu when language loading fails', async () => {
        mocks.config.uiLanguageSetupCompleted = true;
        mocks.language.mockRejectedValueOnce(new Error('language unavailable'));
        const {mountPreparedPopupApp} = await import('@/src/app/popup/mount');
        await expect(mountPreparedPopupApp('#app')).rejects.toThrow('language unavailable');
        expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.app.mount).not.toHaveBeenCalled();
    });
});
