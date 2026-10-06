/**
 * @file tests/selectionTranslatorLifecycle.test.ts
 * 文件职责：执行划词组件的实际挂载与卸载回调，验证扩展消息端口撤销不会留下宿主页面资源。
 * 主要内容：显式启用划词，覆盖正常注销、runtime 撤销和事件注销抛错后的 DOM、订阅、计时器与请求清理。
 * 模块边界：编译真实 Vue setup 并替换浏览器和渲染依赖，不模拟完整 UI 或声称真实浏览器验证。
 */
import {hasDistinctTranslation} from '@/src/core/translation/result';
import {readFileSync} from 'node:fs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {compileScript, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import * as Vue from 'vue';
import {Config} from '@/src/core/config/model';
import * as selectionCore from '@/src/features/selection-translation/core';
import * as harness from '@/src/core/config/harness';
import * as runtimeMessages from '@/src/platform/browser/runtimeMessages';
import * as detect from '@/src/core/language/detect';
import * as wordNormalization from '@/src/features/selection-translation/services/wordNormalization';

vi.mock('webextension-polyfill', () => ({default: {}}));

const filename = 'src/features/selection-translation/ui/SelectionTranslator.vue';
const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename});
const compiled = ts.transpileModule(compileScript(descriptor, {id: 'selection-lifecycle'}).content, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
}).outputText;
let app: Vue.App | undefined;
afterEach(() => { app?.unmount(); app = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); });

function mountSelection() {
    vi.useFakeTimers();
    const config = Object.assign(new Config(), {
        disableSelectionTranslator: false, selectionTranslatorMode: 'bilingual', theme: 'light',
    });
    const listeners = new Map<string, Set<(...args: any[]) => any>>();
    const eventTarget = (prefix: string) => ({
        addEventListener: vi.fn((type: string, listener: (...args: any[]) => any) => {
            const key = `${prefix}:${type}`;
            if (!listeners.has(key)) listeners.set(key, new Set());
            listeners.get(key)!.add(listener);
        }),
        removeEventListener: vi.fn((type: string, listener: (...args: any[]) => any) => {
            listeners.get(`${prefix}:${type}`)?.delete(listener);
        }),
    });
    const media = eventTarget('media');
    const document = {...eventTarget('document'), getElementById: vi.fn(() => null)};
    const window = {
        ...eventTarget('window'), innerWidth: 1000, innerHeight: 800,
        matchMedia: () => ({matches: false, ...media}),
        setTimeout, clearTimeout,
        requestAnimationFrame: (callback: () => void) => setTimeout(callback, 16),
        cancelAnimationFrame: vi.fn((id: ReturnType<typeof setTimeout>) => clearTimeout(id)),
        speechSynthesis: {cancel: vi.fn()},
    };
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', window);
    const event = {addListener: vi.fn(), removeListener: vi.fn()};
    const browser = {
        runtime: {onMessage: event, getURL: (path: string) => path,
            sendMessage: vi.fn().mockResolvedValue({success: true, zoom: 1})},
        extension: {inIncognitoContext: false},
    };
    const unsubscribeConfig = vi.fn(), releaseContextMenu = vi.fn(), stopTts = vi.fn();
    const modules: Record<string, unknown> = {
        '@/src/core/translation/result': {hasDistinctTranslation},
        vue: {...Vue, useTemplateRef: () => Vue.ref(null)},
        'webextension-polyfill': browser,
        '@/src/platform/browser/runtimeMessages': runtimeMessages,
        '@/src/services/config/store': {config, subscribeConfig: () => unsubscribeConfig},
        '@/src/features/selection-translation/core': selectionCore,
        '@/src/features/selection-translation/services/wordNormalization': wordNormalization,
        '@/src/core/config/harness': harness,
        '@/src/core/language/detect': detect,
        '@/src/features/share-card/public': {isShareCardMounted: () => false},
        '@/src/features/selection-translation/content/selectionTtsContentController': {
            createSelectionTtsContentController: () => ({stop: stopTts}),
        },
        '@/src/features/selection-translation/content/contextMenuBridge': {
            setSelectionContextMenuHandler: () => releaseContextMenu,
        },
        '@/src/features/selection-translation/pageZoom': {normalizeSelectionPageZoom: () => 1},
        '@/src/ui/i18n': {useUiI18n: () => ({t: (key: string) => key, translateLegacy: (text: string) => text})},
    };
    const exports: Record<string, any> = {};
    new Function('require', 'exports', compiled)((id: string) => {
        if (!(id in modules) && !id.startsWith('@/src/')) throw new Error(`Unexpected import: ${id}`);
        return modules[id] ?? {};
    }, exports);
    exports.default.render = () => null;
    const renderer = Vue.createRenderer<Record<string, unknown>, Record<string, unknown>>({
        patchProp() {}, insert() {}, remove() {}, createElement: () => ({}),
        createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {},
        parentNode: () => null, nextSibling: () => null,
    });
    const currentApp = renderer.createApp(exports.default);
    const lifecycleErrors = vi.fn();
    currentApp.config.errorHandler = lifecycleErrors;
    app = currentApp;
    const vm = currentApp.mount({});
    const state = (vm.$ as any).setupState as Record<string, any>;
    return {state, event, browser, config, listeners, window, document, unsubscribeConfig, releaseContextMenu, stopTts,
        lifecycleErrors, unmount: () => { currentApp.unmount(); app = undefined; }};
}

describe('SelectionTranslator lifecycle after extension reload', () => {
    it.each(['normal', 'runtime removed', 'event removed', 'removeListener throws'] as const)(
        'cleans up all selection resources when %s', async failure => {
            const fixture = mountSelection();
            const {state, event, browser, window, listeners} = fixture;
            await Vue.nextTick();
            expect(fixture.config.disableSelectionTranslator).toBe(false);
            expect(fixture.config.selectionTranslatorMode).toBe('bilingual');
            const registered = event.addListener.mock.calls.map(([listener]) => listener);
            expect(registered).toHaveLength(4);
            const onTimer = vi.fn();
            for (const timer of ['readingHoverTimer', 'selectionLossTimer', 'selectionPresentationTimer', 'copyTimer', 'noticeTimer']) {
                state[timer] = setTimeout(onTimer, 50);
            }
            state.selectionFrame = window.requestAnimationFrame(onTimer);
            state.positionFrame = window.requestAnimationFrame(onTimer);
            const pendingTranslation = new AbortController();
            state.translationAbortController = pendingTranslation;
            const pendingWordLookup = new AbortController();
            state.wordLookupAbortController = pendingWordLookup;
            state.isWordCardSupportLoading = true;
            state.translationResult = '译文';
            state.isLoading = true;
            if (failure === 'runtime removed') Reflect.deleteProperty(browser, 'runtime');
            else if (failure === 'event removed') Reflect.deleteProperty(browser.runtime, 'onMessage');
            else if (failure === 'removeListener throws') {
                event.removeListener.mockImplementation(() => { throw new Error('Extension context invalidated.'); });
            }

            expect(() => fixture.unmount()).not.toThrow();
            expect(fixture.lifecycleErrors).not.toHaveBeenCalled();
            expect(event.removeListener.mock.calls.map(([listener]) => listener)).toEqual(registered);
            expect(fixture.unsubscribeConfig).toHaveBeenCalledOnce();
            expect(fixture.releaseContextMenu).toHaveBeenCalledOnce();
            expect([...listeners.values()].every(set => set.size === 0)).toBe(true);
            expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(2);
            expect(pendingTranslation.signal.aborted).toBe(true);
            expect(pendingWordLookup.signal.aborted).toBe(true);
            expect(state.isWordCardSupportLoading).toBe(false);
            expect(fixture.stopTts).toHaveBeenCalledWith(true);
            expect(window.speechSynthesis.cancel).toHaveBeenCalledOnce();
            expect(state.translationResult).toBe('');
            expect(state.isLoading).toBe(false);
            expect(vi.getTimerCount()).toBe(0);
            await vi.advanceTimersByTimeAsync(100);
            expect(onTimer).not.toHaveBeenCalled();
        },
    );

    const card = (word: string) => ({word, normalizedWord: word, phonetics: [], sources: [],
        meanings: [{partOfSpeech: '名词', definitions: [{definition: 'an English definition'}]}]});
    function beginWord(fixture: ReturnType<typeof mountSelection>, word: string) {
        fixture.state.snapshot = {text: word};
        fixture.state.selectedText = word;
        return fixture.state.beginSelectionContentRequest(word);
    }

    it('shows the first word card while auxiliary translation is pending and cancels that wait on unmount', async () => {
        const fixture = mountSelection();
        const {state, browser} = fixture;
        browser.runtime.sendMessage.mockImplementation((message: any) => message.type !== 'selectionWordLookup'
            ? Promise.resolve({success: true, zoom: 1})
            : message.translateFields ? new Promise(() => {}) : Promise.resolve({success: true, data: card(message.word)}));
        const pending = state.requestWordCard(beginWord(fixture, 'read'));
        await vi.advanceTimersByTimeAsync(0);
        expect(state.wordCard.word).toBe('read');
        expect(state.isWordCardLoading).toBe(false);
        expect(state.isWordCardSupportLoading).toBe(true);
        fixture.unmount();
        await pending;
        expect(vi.getTimerCount()).toBe(0);
        expect(state.wordCard).toBeNull();
    });

    it('ends an unresponsive message after 3.5 seconds while keeping the ordinary translation', async () => {
        const fixture = mountSelection();
        fixture.browser.runtime.sendMessage.mockImplementation((message: any) => message.type === 'selectionWordLookup'
            ? new Promise(() => {}) : Promise.resolve({success: true, zoom: 1}));
        const request = beginWord(fixture, 'missing');
        fixture.state.translationResult = '已有译文';
        const pending = fixture.state.requestWordCard(request);
        await vi.advanceTimersByTimeAsync(3_500);
        await pending;
        expect(fixture.state.isWordCardLoading).toBe(false);
        expect(fixture.state.wordCardError).toContain('可稍后重查');
        expect(fixture.state.translationResult).toBe('已有译文');
    });

    it('ignores an old word response after the user selects a new word', async () => {
        const fixture = mountSelection();
        let release!: (response: any) => void;
        fixture.browser.runtime.sendMessage.mockImplementation((message: any) => message.type !== 'selectionWordLookup'
            ? Promise.resolve({success: true, zoom: 1}) : message.word === 'old'
                ? new Promise(resolve => { release = resolve; }) : Promise.resolve({success: true, data: card(message.word)}));
        const old = fixture.state.requestWordCard(beginWord(fixture, 'old'));
        const current = fixture.state.requestWordCard(beginWord(fixture, 'new'));
        await vi.advanceTimersByTimeAsync(0);
        await current;
        release({success: true, data: card('old')});
        await old;
        expect(fixture.state.wordCard.word).toBe('new');
        expect(fixture.state.wordCardError).toBe('');
        expect(fixture.state.isWordCardSupportLoading).toBe(false);
    });
});

it('keeps an existing ordinary translation running when opening the learning view', async () => {
    const fixture = mountSelection();
    fixture.config.harness.enabled = true;
    fixture.state.selectionConfigVersion += 1;
    await Vue.nextTick();
    const pending = new AbortController();
    fixture.state.snapshot = {text: 'Practice helps.', range: {}, parts: [{kind: 'text', text: 'Practice helps.'}]};
    fixture.state.readingSelection = {text: 'Practice helps.', context: '', sentence: 'Practice helps.'};
    fixture.state.activeContentRequest = {text: 'Practice helps.', generation: 1, sourceLanguage: 'auto', targetLanguage: 'zh-Hans'};
    fixture.state.translationAbortController = pending;
    fixture.state.isLoading = true;
    fixture.state.openReadingCard();
    expect(fixture.state.readingMode).toBe(true);
    expect(pending.signal.aborted).toBe(false);
    fixture.unmount();
    expect(pending.signal.aborted).toBe(true);
});


describe('selection card geometry across content changes', () => {
    it('preserves the opening position across learning tabs and expanding content', async () => {
        const {state} = mountSelection();
        state.tooltipRef = {getBoundingClientRect: () => ({width: 388, height: 180})};
        state.manualPopupPosition = {left: 220, top: 410};
        state.applyManualPopupGeometry();
        expect(state.tooltipStyle).toMatchObject({left: '220px', top: '410px', maxHeight: '378px'});
        state.readingMode = true;
        await Vue.nextTick();
        state.tooltipRef = {getBoundingClientRect: () => ({width: 388, height: 520})};
        state.applyManualPopupGeometry();
        expect(state.tooltipStyle).toMatchObject({left: '220px', top: '410px', maxHeight: '378px'});
        state.readingMode = false;
        await Vue.nextTick();
        state.applyManualPopupGeometry();
        expect(state.tooltipStyle).toMatchObject({left: '220px', top: '410px'});
    });
    it('preserves a resized card and clamps it only when the viewport shrinks', () => {
        const {state, window} = mountSelection();
        state.tooltipRef = {getBoundingClientRect: () => ({width: 450, height: 240})};
        state.manualPopupPosition = {left: 510, top: 490};
        state.manualPopupSize = {width: 450, height: 240};
        state.applyManualPopupGeometry();
        expect(state.tooltipStyle).toMatchObject({left: '510px', top: '490px', width: '450px', height: '240px'});
        window.innerWidth = 390; window.innerHeight = 400;
        state.applyManualPopupGeometry();
        expect(state.tooltipStyle).toMatchObject({left: '12px', top: '248px', width: '366px', height: '140px'});
    });
});

it('相同译文隐藏后，切换选区与不同结果仍恢复显示', async () => {
    const {state, lifecycleErrors} = mountSelection();
    state.selectedText = 'Café'; state.translationResult = 'Cafe\u0301'; await Vue.nextTick();
    expect(state.hasDistinctTranslationResult).toBe(false);
    state.translationResult = '咖啡馆'; await Vue.nextTick();
    expect(state.hasDistinctTranslationResult).toBe(true);
    state.selectedText = '咖啡馆'; await Vue.nextTick();
    expect(state.hasDistinctTranslationResult).toBe(false);
    expect(lifecycleErrors).not.toHaveBeenCalled();
});
