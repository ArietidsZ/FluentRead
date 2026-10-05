import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Config} from '@/src/core/config/model';
import type {BrowserCapabilities} from '@/src/platform/browser/capabilities';
import type {ContentScriptContext} from 'wxt/utils/content-script-context';

const mocks = vi.hoisted(() => ({
    config: {uiLanguageSetupCompleted: false, uiLanguage: 'fr-FR', interfaceFont: 'system'},
    ready: Promise.resolve(), font: vi.fn(), language: vi.fn(), createApp: vi.fn(), plugin: vi.fn(),
    app: {use: vi.fn(), component: vi.fn(), mount: vi.fn()},
    writingPage: vi.fn(), mountWriting: vi.fn(), unmountWriting: vi.fn(), writingMounted: vi.fn(),
    mountSentence: vi.fn(), unmountSentence: vi.fn(), sentenceMounted: vi.fn(),
}));
vi.mock('vue', () => ({createApp: mocks.createApp}));
vi.mock('@element-plus/icons-vue', () => ({Coffee: 'coffee-component'}));
vi.mock('@/src/services/config/store', () => ({config: mocks.config, get configReady() {return mocks.ready;}}));
vi.mock('@/src/ui/i18n', () => ({createUiI18nPlugin: mocks.plugin}));
vi.mock('@/src/ui/interfaceAppearance', () => ({prepareInterfaceFont: mocks.font}));
vi.mock('@/src/platform/i18n/uiLanguageBundles', () => ({ensureUiLanguageBundle: mocks.language}));
vi.mock('@/src/app/popup/PopupOnboarding.vue', () => ({default: 'onboarding-component'}));
vi.mock('@/src/app/popup/PopupApp.vue', () => ({default: 'main-component'}));
vi.mock('@/src/core/config/writing', () => ({isWritingPage: mocks.writingPage}));
vi.mock('@/src/features/writing-assistant/public', () => ({mountWritingAssistant: mocks.mountWriting,
    unmountWritingAssistant: mocks.unmountWriting, isWritingAssistantMounted: mocks.writingMounted}));
vi.mock('@/src/features/vocabulary/content/public', () => ({mountSentenceActions: mocks.mountSentence,
    unmountSentenceActions: mocks.unmountSentence, isSentenceActionsMounted: mocks.sentenceMounted}));

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => {resolve = done;});
    return {promise, resolve};
}
beforeEach(() => {
    vi.resetAllMocks(); vi.resetModules();
    mocks.config.uiLanguageSetupCompleted = false;
    mocks.ready = Promise.resolve();
    mocks.font.mockResolvedValue(undefined); mocks.language.mockResolvedValue(true);
    mocks.createApp.mockReturnValue(mocks.app); mocks.plugin.mockReturnValue('i18n-plugin');
    mocks.writingPage.mockReturnValue(true);
    vi.stubGlobal('document', {body: {id: 'popup-document'}});
    vi.stubGlobal('window', {location: {href: 'https://example.com/article'}});
});
afterEach(() => vi.unstubAllGlobals());

describe('popup composition readiness', () => {
    it('waits for configuration and opens onboarding without loading the main language bundle', async () => {
        const ready = deferred(); mocks.ready = ready.promise;
        const {mountPreparedPopupApp} = await import('@/src/app/popup/mount');
        const pending = mountPreparedPopupApp('#requested-root');
        await Promise.resolve();
        expect(mocks.font).not.toHaveBeenCalled(); expect(mocks.createApp).not.toHaveBeenCalled();
        ready.resolve(); await pending;
        expect(mocks.createApp).toHaveBeenCalledWith('onboarding-component');
        expect(mocks.language).not.toHaveBeenCalled();
        expect(mocks.font).toHaveBeenCalledWith('system');
        expect(mocks.plugin).toHaveBeenCalledWith({documentRoot: document.body, documentTitleKey: 'metadata.popupTitle'});
        expect(mocks.app.use).toHaveBeenCalledWith('i18n-plugin');
        expect(mocks.app.component).toHaveBeenCalledWith('Coffee', 'coffee-component');
        expect(mocks.app.mount).toHaveBeenCalledWith('#requested-root');
    });
    it('waits for both the main language and font before mounting the main popup', async () => {
        mocks.config.uiLanguageSetupCompleted = true;
        const font = deferred(), language = deferred(), started = deferred();
        mocks.font.mockImplementation(() => {started.resolve(); return font.promise;});
        mocks.language.mockReturnValue(language.promise);
        const {mountPreparedPopupApp} = await import('@/src/app/popup/mount');
        const pending = mountPreparedPopupApp('#main');
        await started.promise;
        expect(mocks.language).toHaveBeenCalledWith('fr-FR');
        expect(mocks.createApp).not.toHaveBeenCalled();
        font.resolve(); await Promise.resolve();
        expect(mocks.createApp).not.toHaveBeenCalled();
        language.resolve(); await pending;
        expect(mocks.createApp).toHaveBeenCalledWith('main-component');
        expect(mocks.app.mount).toHaveBeenCalledOnce();
    });
    it.each(['font', 'language'] as const)('does not mount after %s preparation fails and supports retry', async dependency => {
        mocks.config.uiLanguageSetupCompleted = true;
        mocks[dependency].mockRejectedValueOnce(new Error('unavailable'));
        const {mountPreparedPopupApp} = await import('@/src/app/popup/mount');
        await expect(mountPreparedPopupApp('#main')).rejects.toThrow('unavailable');
        expect(mocks.createApp).not.toHaveBeenCalled();
        await mountPreparedPopupApp('#main');
        expect(mocks.app.mount).toHaveBeenCalledOnce();
    });
    it('keeps lightweight onboarding keys complete in both languages', async () => {
        const {onboardingChineseMessages, onboardingEnglishMessages, onboardingLoadError} = await import('@/src/core/i18n/messages/onboarding');
        expect(Object.keys(onboardingEnglishMessages)).toEqual(Object.keys(onboardingChineseMessages));
        for (const messages of [onboardingChineseMessages, onboardingEnglishMessages]) {
            expect(Object.values(messages).every(value => value.trim().length > 0)).toBe(true);
            expect(messages).toHaveProperty('language.saveFailed');
            expect(messages).toHaveProperty('language.onboardingConfirm');
            expect(messages).toHaveProperty('common.retry');
        }
        expect(onboardingLoadError['en-US']).toContain('retry');
        expect(onboardingLoadError['zh-CN']).toContain('重试');
    });
});

describe('learning feature composition', () => {
    it('wires separate lifecycle owners and reevaluates feature, site and browser gates', async () => {
        const {createLearningContentFeatures} = await import('@/src/app/content/learningFeatures');
        const config = {on: true, bilingualSentenceHighlightEnabled: true, writing: {enabled: true}} as Config;
        const capabilities = {browser: 'chrome'};
        const context = {} as ContentScriptContext;
        const [sentence, writing] = createLearningContentFeatures(context, config, capabilities as BrowserCapabilities);
        expect([sentence.id, writing.id]).toEqual(['sentence-actions', 'writing-assistant']);
        expect(sentence.isEnabled()).toBe(true); expect(writing.isEnabled()).toBe(true);
        expect(mocks.writingPage).toHaveBeenCalledWith('https://example.com/article');
        const runtime = {ctx: context, signal: new AbortController().signal, isCurrent: () => true};
        sentence.mount(runtime); writing.mount(runtime);
        expect(mocks.mountSentence).toHaveBeenCalledWith(context); expect(mocks.mountWriting).toHaveBeenCalledWith(context);
        sentence.unmount!(); writing.unmount!();
        expect(mocks.unmountSentence).toHaveBeenCalledOnce(); expect(mocks.unmountWriting).toHaveBeenCalledOnce();
        mocks.sentenceMounted.mockReturnValue(true); mocks.writingMounted.mockReturnValue(false);
        expect(sentence.isMounted!()).toBe(true); expect(writing.isMounted!()).toBe(false);
        config.on = false;
        expect(sentence.isEnabled()).toBe(false); expect(writing.isEnabled()).toBe(false);
        config.on = true; config.bilingualSentenceHighlightEnabled = false; config.writing.enabled = false;
        expect(sentence.isEnabled()).toBe(false); expect(writing.isEnabled()).toBe(false);
        config.writing.enabled = true; mocks.writingPage.mockReturnValue(false);
        expect(writing.isEnabled()).toBe(false);
        capabilities.browser = 'userscript';
        expect(sentence.isEnabled()).toBe(false); expect(writing.isEnabled()).toBe(false);
    });
});
