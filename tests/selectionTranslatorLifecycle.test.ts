/**
 * @file tests/selectionTranslatorLifecycle.test.ts
 * 文件职责：执行划词组件的实际挂载与卸载回调，验证扩展消息端口撤销不会留下宿主页面资源。
 * 主要内容：覆盖注销清理、朗读生成与降级、取消、迟到响应、进度隔离和富文本 trim 后的 UTF-16 跟读偏移。
 * 模块边界：编译真实 Vue setup 并替换浏览器和渲染依赖，不模拟完整 UI 或声称真实浏览器验证。
 */
import {hasDistinctTranslation} from '@/src/core/translation/result';
import * as speechProgress from '@/src/core/tts/speechProgress';
import {createSelectionTtsContentController} from '@/src/features/selection-translation/content/selectionTtsContentController';
import {readFileSync} from 'node:fs';
import {afterEach, describe, expect, it, vi, type MockInstance} from 'vitest';
import {compileScript, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import * as Vue from 'vue';
import {Config} from '@/src/core/config/model';
import * as selectionCore from '@/src/features/selection-translation/core';
import * as harness from '@/src/core/config/harness';
import * as runtimeMessages from '@/src/platform/browser/runtimeMessages';
import * as detect from '@/src/core/language/detect';
import * as wordNormalization from '@/src/features/selection-translation/services/wordNormalization';
import * as vocabularyProtocol from '@/src/features/vocabulary/protocol';

vi.mock('webextension-polyfill', () => ({default: {}}));

const filename = 'src/features/selection-translation/ui/SelectionTranslator.vue';
const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename});
const compiled = ts.transpileModule(compileScript(descriptor, {id: 'selection-lifecycle'}).content, {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
}).outputText;
let app: Vue.App | undefined;
afterEach(() => { app?.unmount(); app = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function mountSelection(privateContext = false) {
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
        extension: {inIncognitoContext: privateContext},
    };
    const unsubscribeConfig = vi.fn(), releaseContextMenu = vi.fn();
    let stopTts: MockInstance<(notifyRemote?: boolean) => void>;
    let ttsRequestId = 0;
    const modules: Record<string, unknown> = {
        './SpeechFollowText.vue': {},
        '@/src/core/tts/speechProgress': speechProgress,
        '@/src/core/translation/result': {hasDistinctTranslation},
        vue: {...Vue, useTemplateRef: () => Vue.ref(null)},
        'webextension-polyfill': browser,
        // 本夹具覆盖既有非原生/legacy 消息语义；原生模型通道由 wordCardPrivacyRoute 验证。
        '@/src/core/config/incognitoRoute': {NATIVE_PRIVATE_ROUTE_SUPPORTED: false},
        '@/src/platform/browser/runtimeMessages': runtimeMessages,
        '@/src/services/config/store': {config, subscribeConfig: () => unsubscribeConfig},
        '@/src/features/selection-translation/core': selectionCore,
        '@/src/features/selection-translation/services/wordNormalization': wordNormalization,
        '@/src/core/config/harness': harness,
        '@/src/core/language/detect': detect,
        '@/src/features/vocabulary/protocol': vocabularyProtocol,
        '@/src/features/share-card/public': {isShareCardMounted: () => false},
        '@/src/features/selection-translation/content/selectionTtsContentController': {
            createSelectionTtsContentController: (dependencies: Parameters<typeof createSelectionTtsContentController>[0]) => {
                const controller = createSelectionTtsContentController({
                    ...dependencies,
                    createClientRequestId: () => `tts-client-${++ttsRequestId}`,
                });
                stopTts = vi.spyOn(controller, 'stop');
                return controller;
            },
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
    return {state, event, browser, config, listeners, window, document, unsubscribeConfig, releaseContextMenu, stopTts: stopTts!,
        lifecycleErrors, unmount: () => { currentApp.unmount(); app = undefined; }};
}

describe('explicit selection sentence collection', () => {
    function prepare(text: string, sourceLanguage = 'en', privateContext = false) {
        const fixture = mountSelection(privateContext);
        fixture.config.vocabularyBookEnabled = true;
        const request = {text, generation: 1, sourceLanguage, targetLanguage: 'zh-Hans'};
        fixture.state.snapshot = {text};
        fixture.state.selectedText = text;
        fixture.state.activeContentRequest = request;
        fixture.state.translationAnswer = {...request, answer: '这是一句译文。'};
        fixture.browser.runtime.sendMessage.mockResolvedValue({success: true, data: {id: 'saved-sentence'}});
        return {...fixture, request};
    }

    it('saves a complete selected sentence through the existing card without requiring an English word selection', async () => {
        const fixture = prepare('Good ideas deserve attention.');
        expect(fixture.state.isWordSelection).toBe(false);
        await fixture.state.saveVocabularyEntry({isTrusted: true});
        expect(fixture.browser.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            action: 'upsert', input: expect.objectContaining({
                term: fixture.request.text, sourceLanguage: 'en', translation: '这是一句译文。',
            }),
        }));
        expect(fixture.state.isVocabularySaved).toBe(true);
    });

    it('uses the captured language for other-language sentences and retrieves saved state after explicit card requests', async () => {
        const fixture = prepare('Les idées méritent notre attention.', 'fr');
        await fixture.state.refreshVocabularySaved(fixture.request);
        expect(fixture.browser.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            action: 'getByTerm', sourceLanguage: 'fr', term: fixture.request.text,
        }));
        await fixture.state.saveVocabularyEntry({isTrusted: true});
        expect(fixture.browser.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            action: 'upsert', input: expect.objectContaining({sourceLanguage: 'fr'}),
        }));
    });

    it('does not query or save a selected sentence in a private context', async () => {
        const fixture = prepare('Good ideas deserve attention.', 'en', true);
        fixture.browser.runtime.sendMessage.mockClear();
        await fixture.state.refreshVocabularySaved(fixture.request);
        await fixture.state.saveVocabularyEntry({isTrusted: true});
        expect(fixture.browser.runtime.sendMessage.mock.calls.some(([message]) => message.type === vocabularyProtocol.VOCABULARY_BOOK_MESSAGE)).toBe(false);
    });

    it('does not mark a new selection saved when the previous sentence save finishes late', async () => {
        const fixture = prepare('Good ideas deserve attention.');
        let finish!: (response: unknown) => void;
        fixture.browser.runtime.sendMessage.mockImplementation(message => message.action === 'upsert'
            ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({success: true}));
        const pending = fixture.state.saveVocabularyEntry({isTrusted: true});
        const text = 'Practice makes progress.';
        fixture.state.snapshot = {text};
        fixture.state.selectedText = text;
        fixture.state.beginSelectionContentRequest(text);
        finish({success: true, data: {id: 'old-sentence'}});
        await pending;
        expect(fixture.state.isVocabularySaved).toBe(false);
        expect(fixture.state.noticeMessage).toBe('');
    });

    it.each(['untrusted', 'disabled', 'missing-answer'] as const)('does not save when %s', async condition => {
        const fixture = prepare('Good ideas deserve attention.');
        if (condition === 'disabled') fixture.config.vocabularyBookEnabled = false;
        if (condition === 'missing-answer') fixture.state.translationAnswer = null;
        fixture.browser.runtime.sendMessage.mockClear();
        await fixture.state.saveVocabularyEntry({isTrusted: condition !== 'untrusted'});
        expect(fixture.browser.runtime.sendMessage.mock.calls.some(([message]) => message.action === 'upsert')).toBe(false);
    });
});

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

function deferredTts() {
    let resolve!: (response: Record<string, unknown>) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<Record<string, unknown>>((yes, no) => { resolve = yes; reject = no; });
    return {promise, resolve, reject};
}

function ttsMessages(fixture: ReturnType<typeof mountSelection>, type: string) {
    return fixture.browser.runtime.sendMessage.mock.calls
        .map(([message]) => message as {type: string; text?: string; clientRequestId: string})
        .filter(message => message.type === type);
}

function prepareTts(fixture: ReturnType<typeof mountSelection>, responses: Promise<Record<string, unknown>>[]) {
    fixture.config.selectionTtsMode = 'local-only';
    fixture.browser.runtime.sendMessage.mockImplementation((message: any) => {
        if (message.type === 'selectionTts') {
            const response = responses.shift();
            if (!response) throw new Error('Unexpected TTS request');
            return response;
        }
        return Promise.resolve({success: true, zoom: 1});
    });
}

function emitTtsState(fixture: ReturnType<typeof mountSelection>, clientRequestId: string, state: string, extra = {}) {
    return fixture.event.addListener.mock.calls.map(([listener]) =>
        listener({type: 'selectionTtsState', clientRequestId, state, ...extra}));
}

function expectAudioReset(state: Record<string, any>) {
    expect(state.isPreparingAudio).toBe(false);
    expect(state.isPlaying).toBe(false);
    expect(state.audioProgress).toBeNull();
    expect(state.currentAudioKind).toBeNull();
    expect(state.currentAudioText).toBe('');
    expect(state.currentAudioKey).toBe('');
}

describe('SelectionTranslator TTS generation and progress ownership', () => {
    it('5 second controls use the active route, reject unavailable playback and ignore late seek failures', async () => {
        const fixture=mountSelection();const response=deferredTts();prepareTts(fixture,[response.promise]);
        const pending=fixture.state.toggleAudio('Hello world','source');
        await fixture.state.seekAudio(5);expect(ttsMessages(fixture,'selectionTtsSeek')).toEqual([]);
        response.resolve({success:true,transport:'offscreen'});await pending;
        await fixture.state.seekAudio(5);expect(ttsMessages(fixture,'selectionTtsSeek')).toEqual([]);
        emitTtsState(fixture,'tts-client-1','progress',{progress:{start:0,end:5,fraction:0,estimated:true},position:{currentTime:2,duration:12}});
        fixture.browser.runtime.sendMessage.mockResolvedValue({success:true});
        await fixture.state.seekAudio(5);await fixture.state.seekAudio(-5);
        expect(ttsMessages(fixture,'selectionTtsSeek')).toEqual([
            {type:'selectionTtsSeek',clientRequestId:'tts-client-1',offsetSeconds:5},
            {type:'selectionTtsSeek',clientRequestId:'tts-client-1',offsetSeconds:-5},
        ]);
        expect(fixture.state.audioPosition).toEqual({currentTime:2,duration:12});
        const delayed=deferredTts();fixture.browser.runtime.sendMessage.mockImplementation(message=>message.type==='selectionTtsSeek'?delayed.promise:Promise.resolve({success:true}));
        const jump=fixture.state.seekAudio(5);fixture.state.stopAudio();delayed.resolve({success:false});await jump;
        expect(fixture.state.audioPosition).toBeNull();expect(fixture.state.noticeMessage).toBe('');
        expect(fixture.state.playbackTime(65.9)).toBe('1:05');
    });

    it('page audio jumps by 5 seconds, updates text immediately and clears its sampling timer on stop', async () => {
        const fixture=mountSelection();const audios:FakeSeekAudio[]=[];
        class FakeSeekAudio {
            currentTime=2;duration=12;ontimeupdate:((event?:Event)=>void)|null=null;
            play=vi.fn(async()=>undefined);pause=vi.fn();removeAttribute=vi.fn();
            constructor(public src:string){audios.push(this);}
        }
        vi.stubGlobal('Audio',FakeSeekAudio);
        await fixture.state.playExternalAudio('https://audio','Hello world','source','Hello world',0);
        await fixture.state.seekAudio(5);expect(audios[0].currentTime).toBe(7);
        expect(fixture.state.audioPosition).toEqual({currentTime:7,duration:12});expect(fixture.state.audioProgress.start).toBe(6);
        await fixture.state.seekAudio(-5);await fixture.state.seekAudio(-5);expect(audios[0].currentTime).toBe(0);
        expect(fixture.state.audioProgress.start).toBe(0);
        await fixture.state.seekAudio(5);await fixture.state.seekAudio(5);await fixture.state.seekAudio(5);expect(audios[0].currentTime).toBe(12);
        expect(audios[0].play).toHaveBeenCalledOnce();expect(ttsMessages(fixture,'selectionTtsSeek')).toEqual([]);
        fixture.state.stopAudio();expect(fixture.state.audioPosition).toBeNull();
        const stopped=fixture.state.audioProgress;await vi.advanceTimersByTimeAsync(500);expect(fixture.state.audioProgress).toBe(stopped);
    });
    it.each(['source', 'translation'] as const)('keeps %s in preparation until synthesis succeeds', async kind => {
        const fixture = mountSelection();
        const response = deferredTts();
        prepareTts(fixture, [response.promise]);
        const pending = fixture.state.toggleAudio('  Practice helps.  ', kind);
        expect(fixture.state.isPreparingAudio).toBe(true);
        expect(fixture.state.isPlaying).toBe(false);
        expect(fixture.state.audioProgress).toBeNull();
        expect(fixture.state.currentAudioKind).toBe(kind);
        expect(fixture.state.currentAudioText).toBe('Practice helps.');
        expect(ttsMessages(fixture, 'selectionTts')).toEqual([
            expect.objectContaining({text: 'Practice helps.', clientRequestId: 'tts-client-1'}),
        ]);
        await vi.advanceTimersByTimeAsync(500);
        expect(fixture.state.isPreparingAudio).toBe(true);
        expect(fixture.state.isPlaying).toBe(false);
        response.resolve({success: true, transport: 'offscreen'});
        await pending;
        expect(fixture.state.isPreparingAudio).toBe(false);
        expect(fixture.state.isPlaying).toBe(true);
        expect(fixture.state.currentAudioKind).toBe(kind);
        expect(fixture.state.currentAudioKey).toBe('Practice helps.');
        expect(fixture.state.noticeMessage).toBe('');
        expect(fixture.lifecycleErrors).not.toHaveBeenCalled();
    });

    it.each(['response', 'rejection'] as const)('resets preparation and displays an error after synthesis %s', async failure => {
        const fixture = mountSelection();
        const response = deferredTts();
        prepareTts(fixture, [response.promise]);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const pending = fixture.state.toggleAudio('Practice helps.', 'source');
        expect(fixture.state.isPreparingAudio).toBe(true);
        if (failure === 'response') response.resolve({success: false, error: '模型推理失败'});
        else response.reject(new Error('worker disconnected'));
        await pending;
        expectAudioReset(fixture.state);
        expect(fixture.state.noticeMessage).toBe(failure === 'response' ? '模型推理失败' : '本地语音生成失败，请重试');
        expect(fixture.stopTts).toHaveBeenLastCalledWith(false);
        expect(ttsMessages(fixture, 'selectionTtsStop')).toEqual([]);
        if (failure === 'rejection') expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({message: 'worker disconnected'}));
    });

    it.each(['stop button', 'same text toggle', 'unmount'] as const)('cancels pending synthesis via %s and discards late success', async action => {
        const fixture = mountSelection();
        const response = deferredTts();
        prepareTts(fixture, [response.promise]);
        const pending = fixture.state.toggleAudio('Practice helps.', 'source');
        const {clientRequestId} = ttsMessages(fixture, 'selectionTts')[0];
        if (action === 'stop button') fixture.state.stopAudioFromUi();
        else if (action === 'same text toggle') await fixture.state.toggleAudio('Practice helps.', 'source');
        else fixture.unmount();
        await Vue.nextTick();
        expectAudioReset(fixture.state);
        expect(fixture.stopTts).toHaveBeenLastCalledWith(true);
        expect(ttsMessages(fixture, 'selectionTtsStop')).toEqual([{type: 'selectionTtsStop', clientRequestId}]);
        response.resolve({success: true, transport: 'offscreen'});
        await pending;
        await Vue.nextTick();
        expectAudioReset(fixture.state);
        expect(ttsMessages(fixture, 'selectionTts')).toHaveLength(1);
        // STOP 可以先于远端 PLAY 生效；迟到成功须再次精确停止旧请求。
        expect(ttsMessages(fixture, 'selectionTtsStop')).toEqual([
            {type: 'selectionTtsStop', clientRequestId}, {type: 'selectionTtsStop', clientRequestId},
        ]);
        expect(fixture.state.noticeMessage).toBe('');
    });

    it.each(['success', 'failure', 'rejection'] as const)('ignores old synthesis %s while the replacement is playing', async outcome => {
        const fixture = mountSelection();
        const oldResponse = deferredTts(), newResponse = deferredTts();
        prepareTts(fixture, [oldResponse.promise, newResponse.promise]);
        const oldPending = fixture.state.toggleAudio('Old sentence.', 'source');
        const newPending = fixture.state.toggleAudio('新句子。', 'translation');
        const [oldRequest, newRequest] = ttsMessages(fixture, 'selectionTts');
        expect(oldRequest.clientRequestId).not.toBe(newRequest.clientRequestId);
        newResponse.resolve({success: true, transport: 'offscreen'});
        await newPending;
        const progress = {start: 0, end: 4, fraction: 0.5, estimated: true};
        expect(emitTtsState(fixture, newRequest.clientRequestId, 'progress', {progress})).toContain(true);
        if (outcome === 'success') oldResponse.resolve({success: true, transport: 'offscreen'});
        else if (outcome === 'failure') oldResponse.resolve({success: false, error: 'old model failed'});
        else oldResponse.reject(new Error('old worker disconnected'));
        await oldPending;
        await Vue.nextTick();
        expect(fixture.state.isPlaying).toBe(true);
        expect(fixture.state.isPreparingAudio).toBe(false);
        expect(fixture.state.currentAudioKind).toBe('translation');
        expect(fixture.state.currentAudioText).toBe('新句子。');
        expect(fixture.state.audioProgress).toEqual(progress);
        expect(fixture.state.noticeMessage).toBe('');
        expect(ttsMessages(fixture, 'selectionTtsStop').every(message => message.clientRequestId === oldRequest.clientRequestId)).toBe(true);
        expect(ttsMessages(fixture, 'selectionTtsStop')).toHaveLength(outcome === 'success' ? 2 : 1);
    });

    it('does not clear replacement preparation when old synthesis completes first', async () => {
        const fixture = mountSelection();
        const oldResponse = deferredTts(), newResponse = deferredTts();
        prepareTts(fixture, [oldResponse.promise, newResponse.promise]);
        const oldPending = fixture.state.toggleAudio('Old sentence.', 'source');
        const newPending = fixture.state.toggleAudio('New sentence.', 'source');
        oldResponse.resolve({success: true, transport: 'offscreen'});
        await oldPending;
        expect(fixture.state.isPreparingAudio).toBe(true);
        expect(fixture.state.isPlaying).toBe(false);
        expect(fixture.state.currentAudioText).toBe('New sentence.');
        newResponse.resolve({success: true, transport: 'offscreen'});
        await newPending;
        expect(fixture.state.isPreparingAudio).toBe(false);
        expect(fixture.state.isPlaying).toBe(true);
    });

    it('routes progress to the pending or active request and rejects old, unrelated and malformed progress', async () => {
        const fixture = mountSelection();
        const oldResponse = deferredTts(), newResponse = deferredTts();
        prepareTts(fixture, [oldResponse.promise, newResponse.promise]);
        const oldPending = fixture.state.toggleAudio('Old sentence.', 'source');
        oldResponse.resolve({success: true, transport: 'offscreen'});
        await oldPending;
        const newPending = fixture.state.toggleAudio('新句子。', 'translation');
        const [oldRequest, newRequest] = ttsMessages(fixture, 'selectionTts');
        const progress = {start: 0, end: 4, fraction: 0.25, estimated: true};
        expect(emitTtsState(fixture, oldRequest.clientRequestId, 'progress', {progress})).not.toContain(true);
        expect(emitTtsState(fixture, 'another-card', 'progress', {progress})).not.toContain(true);
        expect(fixture.state.audioProgress).toBeNull();
        expect(emitTtsState(fixture, newRequest.clientRequestId, 'progress', {progress})).toContain(true);
        expect(fixture.state.audioProgress).toEqual(progress);
        expect(fixture.state.isPreparingAudio).toBe(true);
        expect(fixture.state.isPlaying).toBe(false);
        expect(fixture.state.audioProgressFor('translation')).toBeNull();
        newResponse.resolve({success: true, transport: 'offscreen'});
        await newPending;
        expect(fixture.state.audioProgressFor('translation')).toEqual(progress);
        expect(fixture.state.audioProgressFor('source')).toBeNull();
        emitTtsState(fixture, oldRequest.clientRequestId, 'progress', {progress: {...progress, fraction: 0.9}});
        expect(fixture.state.audioProgress).toEqual(progress);
        emitTtsState(fixture, newRequest.clientRequestId, 'progress', {progress: {...progress, fraction: Number.NaN}});
        expect(fixture.state.audioProgress).toBeNull();
        fixture.state.stopAudioFromUi();
        expect(emitTtsState(fixture, newRequest.clientRequestId, 'progress', {progress})).not.toContain(true);
        expectAudioReset(fixture.state);
    });

    it.each(['ended', 'stopped', 'error'] as const)('resets playback on matching %s without stopping the remote again', async terminal => {
        const fixture = mountSelection();
        prepareTts(fixture, [Promise.resolve({success: true, transport: 'offscreen'})]);
        await fixture.state.toggleAudio('Practice helps.', 'source');
        const {clientRequestId} = ttsMessages(fixture, 'selectionTts')[0];
        emitTtsState(fixture, clientRequestId, 'progress', {progress: {start: 0, end: 15, fraction: 0.5, estimated: true}});
        expect(emitTtsState(fixture, 'another-card', terminal, {error: '其他卡片错误'})).not.toContain(true);
        expect(fixture.state.isPlaying).toBe(true);
        expect(emitTtsState(fixture, clientRequestId, terminal, {error: '音频解码失败'})).toContain(true);
        expectAudioReset(fixture.state);
        expect(fixture.stopTts).toHaveBeenLastCalledWith(false);
        await Vue.nextTick();
        expect(ttsMessages(fixture, 'selectionTtsStop')).toEqual([]);
        expect(fixture.state.noticeMessage).toBe(terminal === 'error' ? '音频解码失败' : '');
    });
});

describe('SelectionTranslator word TTS generation and fallback', () => {
    const pronunciation = {text: 'American pronunciation', label: '美式'};

    function beginWordTts(fixture: ReturnType<typeof mountSelection>, response: ReturnType<typeof deferredTts>) {
        fixture.state.wordCard = {word: 'hello'};
        prepareTts(fixture, [response.promise]);
        return fixture.state.toggleWordAudio(pronunciation);
    }

    function browserSpeech(fixture: ReturnType<typeof mountSelection>) {
        const speak = vi.fn();
        Object.assign(fixture.window.speechSynthesis, {getVoices: () => [], speak});
        vi.stubGlobal('SpeechSynthesisUtterance', class {
            constructor(public text: string) {}
        });
        return speak;
    }

    it.each(['offscreen', 'page'] as const)('keeps word generation pending then restores the pronunciation key after %s playback', async transport => {
        const fixture = mountSelection();
        const response = deferredTts();
        const audios: Array<{play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>}> = [];
        vi.stubGlobal('Audio', class {
            preload = '';
            play = vi.fn(async () => undefined);
            pause = vi.fn();
            removeAttribute = vi.fn();
            constructor() { audios.push(this); }
        });
        const pending = beginWordTts(fixture, response);
        expect(fixture.state.isPreparingAudio).toBe(true);
        expect(fixture.state.isPlaying).toBe(false);
        expect(fixture.state.currentAudioKind).toBe('word');
        expect(fixture.state.currentAudioText).toBe('hello');
        expect(fixture.state.currentAudioKey).toBe(pronunciation.text);
        await vi.advanceTimersByTimeAsync(500);
        expect(fixture.state.isPreparingAudio).toBe(true);
        expect(fixture.state.isPlaying).toBe(false);
        response.resolve({success: true, transport, ...(transport === 'page' ? {audioBase64: 'YQ==', contentType: 'audio/mpeg'} : {})});
        await pending;
        expect(fixture.state.isPreparingAudio).toBe(false);
        expect(fixture.state.isPlaying).toBe(true);
        expect(fixture.state.currentAudioKey).toBe(pronunciation.text);
        expect(fixture.state.isCurrentWordAudio(pronunciation)).toBe(true);
        await fixture.state.toggleWordAudio(pronunciation);
        await Vue.nextTick();
        expectAudioReset(fixture.state);
        expect(ttsMessages(fixture, 'selectionTts')).toHaveLength(1);
        expect(ttsMessages(fixture, 'selectionTtsStop')).toEqual(transport === 'offscreen'
            ? [{type: 'selectionTtsStop', clientRequestId: 'tts-client-1'}] : []);
        if (transport === 'page') {
            expect(audios[0].play).toHaveBeenCalledOnce();
            expect(audios[0].pause).toHaveBeenCalledOnce();
        }
    });

    it('cancels the same pronunciation key during generation and never adopts its late result', async () => {
        const fixture = mountSelection();
        const response = deferredTts();
        const pending = beginWordTts(fixture, response);
        expect(fixture.state.isPreparingAudio).toBe(true);
        await fixture.state.toggleWordAudio(pronunciation);
        await Vue.nextTick();
        expectAudioReset(fixture.state);
        expect(ttsMessages(fixture, 'selectionTtsStop')).toEqual([{type: 'selectionTtsStop', clientRequestId: 'tts-client-1'}]);
        response.resolve({success: true, transport: 'offscreen'});
        await pending;
        await Vue.nextTick();
        expectAudioReset(fixture.state);
        expect(ttsMessages(fixture, 'selectionTts')).toHaveLength(1);
        expect(ttsMessages(fixture, 'selectionTtsStop')).toEqual([
            {type: 'selectionTtsStop', clientRequestId: 'tts-client-1'}, {type: 'selectionTtsStop', clientRequestId: 'tts-client-1'},
        ]);
    });

    it.each([
        ['inference failure', {success: false, error: '单词推理失败'}, '单词推理失败', null],
        ['model missing', {success: false, errorCode: 'local-tts-model-not-downloaded'}, 'selectionTts.localModelNotDownloaded', 'open-local-tts'],
        ['language unsupported', {success: false, errorCode: 'local-tts-language-unsupported'}, 'selectionTts.languageUnsupported', null],
    ])('clears local-only word ownership and displays the notice for %s', async (_kind, failure, notice, action) => {
        const fixture = mountSelection();
        const response = deferredTts();
        const speak = browserSpeech(fixture);
        const pending = beginWordTts(fixture, response);
        const generation = fixture.state.ttsContentController.currentGeneration();
        response.resolve(failure as Record<string, unknown>);
        await pending;
        expectAudioReset(fixture.state);
        expect(fixture.state.ttsContentController.currentGeneration()).toBeGreaterThan(generation);
        expect(fixture.state.noticeMessage).toBe(notice);
        expect(fixture.state.noticeAction).toBe(action);
        expect(fixture.stopTts).toHaveBeenLastCalledWith(false);
        expect(speak).not.toHaveBeenCalled();
        expect(ttsMessages(fixture, 'selectionTtsGoogle')).toEqual([]);
    });

    it('continues to browser speech when the EdgeSpeechResult object has handled=false', async () => {
        const fixture = mountSelection();
        const response = deferredTts();
        const speak = browserSpeech(fixture);
        fixture.state.wordCard = {word: 'hello'};
        prepareTts(fixture, [response.promise]);
        fixture.config.selectionTtsMode = 'online-only';
        const pending = fixture.state.toggleWordAudio({text: 'hello'});
        response.resolve({success: false, error: 'Edge offline'});
        await pending;
        expect(speak).toHaveBeenCalledOnce();
        expect(speak).toHaveBeenCalledWith(expect.objectContaining({text: 'hello', lang: 'en-US'}));
        expect(fixture.state.isPreparingAudio).toBe(false);
        expect(fixture.state.isPlaying).toBe(true);
        expect(fixture.state.currentAudioKind).toBe('word');
        expect(fixture.state.isCurrentWordAudio({text: 'hello'})).toBe(true);
        expect(ttsMessages(fixture, 'selectionTtsGoogle')).toEqual([]);
    });

    it('preserves the selected pronunciation key after browser fallback so the next click stops playback', async () => {
        const fixture = mountSelection();
        const response = deferredTts();
        const speak = browserSpeech(fixture);
        const pending = beginWordTts(fixture, response);
        fixture.config.selectionTtsMode = 'online-only';
        response.resolve({success: false, error: 'Edge offline'});
        await pending;
        expect(speak).toHaveBeenCalledOnce();
        expect(fixture.state.currentAudioKey).toBe(pronunciation.text);
        expect(fixture.state.isCurrentWordAudio(pronunciation)).toBe(true);
        await fixture.state.toggleWordAudio(pronunciation);
        expectAudioReset(fixture.state);
        expect(ttsMessages(fixture, 'selectionTts')).toHaveLength(1);
    });

    it('continues to Google offscreen fallback and keeps a distinct pronunciation key cancellable', async () => {
        const fixture = mountSelection();
        const response = deferredTts();
        fixture.state.wordCard = {word: 'hello'};
        fixture.config.selectionTtsMode = 'online-only';
        fixture.browser.runtime.sendMessage.mockImplementation((message: any) => message.type === 'selectionTts'
            ? response.promise : Promise.resolve({success: true, transport: 'offscreen'}));
        const pending = fixture.state.toggleWordAudio(pronunciation);
        response.resolve({success: false, error: 'Edge offline'});
        await pending;
        expect(ttsMessages(fixture, 'selectionTtsGoogle')).toEqual([
            expect.objectContaining({text: 'hello', language: 'en-US', clientRequestId: 'tts-client-2'}),
        ]);
        expect(fixture.state.isPreparingAudio).toBe(false);
        expect(fixture.state.isPlaying).toBe(true);
        expect(fixture.state.currentAudioKey).toBe(pronunciation.text);
        await fixture.state.toggleWordAudio(pronunciation);
        await Vue.nextTick();
        expectAudioReset(fixture.state);
        expect(ttsMessages(fixture, 'selectionTtsStop')).toEqual([{type: 'selectionTtsStop', clientRequestId: 'tts-client-2'}]);
    });

    it('follows external word pronunciation using actual media time and ignores timeupdate after stop', async () => {
        const fixture = mountSelection();
        const audios: PronunciationAudio[] = [];
        class PronunciationAudio {
            currentTime = 0;
            duration = 4;
            ontimeupdate: (() => void) | null = null;
            play = vi.fn(async () => undefined);
            pause = vi.fn();
            removeAttribute = vi.fn();
            constructor(public src: string) { audios.push(this); }
        }
        vi.stubGlobal('Audio', PronunciationAudio);
        fixture.state.wordCard = {word: 'hello'};
        const pronunciation = {audio: 'https://dictionary.test/hello.mp3', label: '美式'};
        await fixture.state.toggleWordAudio(pronunciation);
        expect(fixture.state.isPreparingAudio).toBe(false);
        expect(fixture.state.isPlaying).toBe(true);
        expect(fixture.state.currentAudioKind).toBe('word');
        expect(fixture.state.currentAudioKey).toBe(pronunciation.audio);
        expect(fixture.state.audioProgress).toEqual({start:0,end:5,fraction:0,estimated:true});
        expect(fixture.state.audioPosition).toEqual({currentTime:0,duration:4});
        expect(ttsMessages(fixture, 'selectionTts')).toEqual([]);
        const audio = audios[0];
        expect(audio.src).toBe(pronunciation.audio);
        expect(audio.play).toHaveBeenCalledOnce();
        expect(audio.ontimeupdate).toBeTypeOf('function');
        audio.currentTime = 2;
        audio.ontimeupdate?.();
        expect(fixture.state.audioProgressFor('word')).toEqual({start: 0, end: 5, fraction: 0.5, estimated: true});
        expect(fixture.state.audioProgressFor('source')).toBeNull();
        audio.currentTime = 1;
        audio.ontimeupdate?.();
        expect(fixture.state.audioProgressFor('word')).toEqual({start: 0, end: 5, fraction: 0.25, estimated: true});
        const staleTimeupdate = audio.ontimeupdate;
        await fixture.state.toggleWordAudio(pronunciation);
        expectAudioReset(fixture.state);
        expect(audio.pause).toHaveBeenCalledOnce();
        expect(audio.removeAttribute).toHaveBeenCalledWith('src');
        audio.currentTime = 3;
        staleTimeupdate?.();
        expectAudioReset(fixture.state);
        expect(audios).toHaveLength(1);
    });
});

describe('SelectionTranslator trimmed speech offsets in rich text', () => {
    it.each([
        ['source', '  ', 'x', ''],
        ['translation', '\t\uFEFF', 'x', '  '],
        ['source', '  ', '😀x', '\t'],
        ['translation', '', 'x', '  '],
    ] as const)('maps %s trimmed speech into the original code/text parts (%j, %j)', async (kind, leading, code, trailing) => {
        const fixture = mountSelection();
        const parts = [{kind: 'code', text: leading + code}, {kind: 'text', text: ' hello' + trailing}];
        const text = parts.map(part => part.text).join('');
        if (kind === 'source') {
            fixture.state.selectedText = text;
            fixture.state.snapshot = {text, parts};
        } else {
            fixture.state.translationResult = text;
            fixture.state.translationParts = parts;
        }
        prepareTts(fixture, [Promise.resolve({success: true, transport: 'offscreen'})]);
        await fixture.state.toggleAudio(text, kind);
        expect(ttsMessages(fixture, 'selectionTts')[0].text).toBe(text.trim());
        const trimmedStart = text.trim().indexOf('hello');
        const rawProgress = {start: trimmedStart, end: trimmedStart + 5, fraction: 0.5, estimated: true};
        emitTtsState(fixture, 'tts-client-1', 'progress', {progress: rawProgress});
        expect(fixture.state.audioProgress).toEqual(rawProgress);
        const displayed = fixture.state.audioProgressFor(kind);
        expect(displayed).toEqual({...rawProgress, start: text.indexOf('hello'), end: text.indexOf('hello') + 5});
        expect(fixture.state.audioTextOffset).toBe(leading.length);
        expect(fixture.state.audioProgressFor(kind === 'source' ? 'translation' : 'source')).toBeNull();
        const displayedParts = kind === 'source' ? fixture.state.snapshot.parts : fixture.state.translationParts;
        const offset = fixture.state.partOffset(displayedParts, 1);
        expect(offset).toBe(leading.length + code.length);
        expect(speechProgress.speechTextSlices(displayedParts[1].text, offset, displayed)).toEqual({
            before: ' ', active: 'hello', after: trailing, fraction: 0.5,
        });
        expect(displayedParts[0].text).toBe(leading + code);
        expect(displayedParts.map((part: {text: string}) => part.text).join('')).toBe(text);
        fixture.state.stopAudioFromUi();
        expect(fixture.state.audioTextOffset).toBe(0);
        expect(fixture.state.audioProgressFor(kind)).toBeNull();
        expectAudioReset(fixture.state);
    });

    it.each(['source', 'translation'] as const)('preserves the %s trim offset when remote error falls back to browser word boundaries', async kind => {
        const fixture = mountSelection();
        const text = '  x hello';
        const parts = [{kind: 'code', text: '  x'}, {kind: 'text', text: ' hello'}];
        if (kind === 'source') {
            fixture.state.selectedText = text;
            fixture.state.snapshot = {text, parts};
        } else {
            fixture.state.translationResult = text;
            fixture.state.translationParts = parts;
        }
        const speak = vi.fn();
        Object.assign(fixture.window.speechSynthesis, {getVoices: () => [], speak});
        vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
        prepareTts(fixture, [Promise.resolve({success: true, transport: 'offscreen'})]);
        fixture.config.selectionTtsMode = 'online-only';
        await fixture.state.toggleAudio(text, kind);
        expect(fixture.state.audioTextOffset).toBe(2);
        expect(emitTtsState(fixture, 'tts-client-1', 'error', {error: 'decode failed'})).toContain(true);
        expect(speak).toHaveBeenCalledOnce();
        const utterance = speak.mock.calls[0][0];
        expect(utterance.text).toBe('x hello');
        expect(fixture.state.isPlaying).toBe(true);
        expect(fixture.state.audioTextOffset).toBe(2);
        utterance.onboundary({charIndex: 2, charLength: 5});
        const displayed = fixture.state.audioProgressFor(kind);
        expect(displayed).toEqual({start: 4, end: 9, fraction: 1, estimated: false});
        expect(speechProgress.speechTextSlices(parts[1].text, fixture.state.partOffset(parts, 1), displayed)).toEqual({
            before: ' ', active: 'hello', after: '', fraction: 1,
        });
        fixture.state.stopAudioFromUi();
        expect(fixture.state.audioTextOffset).toBe(0);
        expectAudioReset(fixture.state);
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
