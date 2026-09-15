/**
 * @file tests/sameTargetLanguageClient.test.ts
 * 共享翻译客户端与页面标题翻译使用真实语言识别的协作验证：多语言同目标文本在发往后台前返回原文、零消息；
 * 其他目标、显式源语言、逐次覆盖的目标语言与 skipLanguageDetection 语义保持不变；标题会话读取冻结的排除语言，
 * 页面把标题改成外语后重新识别并翻译，恢复时写回原标题。只替换浏览器消息、配置存储和页面上下文边界。
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import modelPost from './fixtures/chinese-language-model-post.json';

const mocks = vi.hoisted(() => ({
    sendMessage: vi.fn(),
    config: {
        glossaryEnabled: false,
        glossaryLibraries: [],
        count: 0,
        maxConcurrentTranslations: 4,
        translationMaxRetries: 0,
        translationBackoffBaseMs: 1,
        translationBackoffMaxMs: 1,
        model: {mock: 'mock-model'} as Record<string, string>,
        customModel: {mock: ''} as Record<string, string>,
        modelThinking: {},
        service: 'mock',
        from: 'auto',
        to: 'zh-Hans',
        useCache: false,
        enableAIContext: false,
    },
}));

vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage: mocks.sendMessage}}}));
vi.mock('@/src/services/config/store', () => ({config: mocks.config, requestConfigCountIncrement: vi.fn(async () => 0)}));
vi.mock('@/src/services/translation/context', () => ({getPageTranslationContext: vi.fn(async () => '')}));
vi.mock('@/src/core/config/validation', () => ({getMissingCredentialMessage: () => null}));

import {translateText, translateTextBatch} from '@/src/app/translation/client';
import {clearTranslationQueue} from '@/src/services/translation/queue';
import {startFullPageTitleTranslation, stopFullPageTitleTranslation} from '@/src/features/full-page-translation/content/titleTranslation';
import type {FullPageTranslationConfigSnapshot} from '@/src/features/full-page-translation/content/translationRequest';

const sameTarget = [
    ['de', 'Dieser deutsche Absatz beschreibt die verschiedenen Einstellungen der Anwendung und die automatische Übersetzung.'],
    ['pt', 'Este é um parágrafo em português que descreve as configurações do aplicativo e a tradução automática.'],
    ['it', "Questo paragrafo italiano descrive le impostazioni dell'applicazione e la traduzione automatica."],
    ['en', 'Welcome to the settings page.'],
    ['fr', 'Bonjour et bienvenue sur notre site.'],
    ['ru', 'Добро пожаловать на наш сайт.'],
    ['ja', 'GPT-6 Sol の新しいモデルを発表しました。'],
    ['ko', 'GPT-6 Sol 모델의 새로운 기능을 소개합니다.'],
    ['zh-Hans', modelPost[1]!],
    ['zh-Hans', '云端模型清单允许清空，且不再连带拒掉无关偏好的保存 (84522b3)'],
    ['he', 'הפסקה הזו מסבירה איך התוסף שומר על הטקסט המקורי ומציג את התרגום ממש מתחתיו.'],
    ['hi', 'हमारी वेबसाइट पर आपका स्वागत है।'],
] as const;

beforeEach(() => {
    mocks.sendMessage.mockReset();
    mocks.sendMessage.mockImplementation(async (message: {origin: string | string[]}) =>
        Array.isArray(message.origin) ? message.origin.map(origin => `T:${origin}`) : `T:${message.origin}`);
    mocks.config.from = 'auto';
    mocks.config.to = 'zh-Hans';
    vi.stubGlobal('document', {title: 'Fixture'});
    vi.stubGlobal('location', {protocol: 'https:'});
});

afterEach(() => {
    clearTranslationQueue();
    vi.unstubAllGlobals();
});

describe('共享翻译客户端', () => {
    it.each(sameTarget)('%s 同目标文本直接返回原文且不发送后台消息', async (language, text) => {
        await expect(translateText(text, 'Context', {targetLanguage: language})).resolves.toBe(text);
        expect(mocks.sendMessage).not.toHaveBeenCalled();
    });

    it.each(sameTarget)('%s 文本换成其他目标时正常请求一次', async (language, text) => {
        const other = language === 'en' ? 'zh-Hant' : 'en';
        await expect(translateText(text, 'Context', {targetLanguage: other})).resolves.toBe(`T:${text}`);
        expect(mocks.sendMessage).toHaveBeenCalledOnce();
        expect(mocks.sendMessage.mock.calls[0]![0]).toMatchObject({origin: text, targetLanguage: other});
    });

    it('同一文本逐次覆盖目标语言时每次重新判断，不复用上一次跳过结论', async () => {
        const [, german] = sameTarget[0];
        for (const [target, expectedCalls] of [['de', 0], ['en', 1], ['de-AT', 1], ['zh-Hans', 2], ['de', 2]] as const) {
            await translateText(german, 'Context', {targetLanguage: target});
            expect(mocks.sendMessage).toHaveBeenCalledTimes(expectedCalls);
        }
        mocks.config.to = 'de';
        await translateText(german, 'Context');
        expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('显式源语言不改变基于文本证据的判断：错误的源语言设定不能让外语漏译', async () => {
        const [, german] = sameTarget[0];
        await expect(translateText(german, 'Context', {sourceLanguage: 'en', targetLanguage: 'de'})).resolves.toBe(german);
        const english = 'This English sentence needs a German translation for the reader.';
        await expect(translateText(english, 'Context', {sourceLanguage: 'de', targetLanguage: 'de'})).resolves.toBe(`T:${english}`);
        expect(mocks.sendMessage.mock.calls[0]![0]).toMatchObject({sourceLanguage: 'de', targetLanguage: 'de'});
    });

    it('富文本包使用 skipLanguageDetection 时仍然发送，由调用方负责逐槽过滤', async () => {
        const [, german] = sameTarget[0];
        await expect(translateText(german, 'Context', {targetLanguage: 'de', skipLanguageDetection: true})).resolves.toBe(`T:${german}`);
        await expect(translateTextBatch([german], 'Context', {targetLanguage: 'de'})).resolves.toEqual([`T:${german}`]);
        expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('歧义短词、混合语言和纯共享汉字即使目标看似相同也继续请求', async () => {
        for (const [text, target] of [
            ['Settings', 'en'], ['Bienvenido a nuestro sitio web.', 'pt'], ['日本国立大学', 'zh-Hans'],
            ['预计将推出 GPT-6 Sol Please translate this sentence.', 'zh-Hans'],
            ['Welcome to our website. Nous sommes très heureux de vous accueillir sur notre nouvelle plateforme.', 'en'],
        ] as const) {
            await translateText(text, 'Context', {targetLanguage: target});
        }
        expect(mocks.sendMessage).toHaveBeenCalledTimes(5);
    });

    it('没有字母的文本不请求；只有空白时保持原值', async () => {
        await expect(translateText('2026-09-16 12:00 🎉', 'Context', {targetLanguage: 'en'})).resolves.toBe('2026-09-16 12:00 🎉');
        await expect(translateText(' 　 ', 'Context')).resolves.toBe(' 　 ');
        expect(mocks.sendMessage).not.toHaveBeenCalled();
    });
});

describe('页面标题', () => {
    let currentTitle = '';
    let observers: Array<() => void> = [];
    const snapshot = (overrides: Partial<FullPageTranslationConfigSnapshot> = {}): FullPageTranslationConfigSnapshot => ({
        service: 'mock', model: 'mock-model', thinking: false, sourceLanguage: 'auto', targetLanguage: 'de',
        useCache: false, enableAIContext: false, enableAIMultiSegment: false, displayMode: 'single', style: 0,
        excludedLanguages: [], ...overrides,
    });
    const setPageTitle = (value: string) => {
        currentTitle = value;
        observers.forEach(callback => callback());
    };

    beforeEach(() => {
        vi.useFakeTimers();
        observers = [];
        vi.stubGlobal('document', {
            get title() { return currentTitle; },
            set title(value: string) { setPageTitle(value); },
            head: {},
        });
        vi.stubGlobal('window', {setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout});
        vi.stubGlobal('MutationObserver', class {
            constructor(private readonly callback: () => void) {}
            observe(): void { observers.push(this.callback); }
            disconnect(): void { observers = observers.filter(callback => callback !== this.callback); }
        });
    });

    afterEach(() => {
        stopFullPageTitleTranslation();
        vi.useRealTimers();
    });

    it('同目标德文标题零请求；页面改成英文标题后重新识别并翻译，恢复时写回页面标题', async () => {
        currentTitle = 'Die neuesten Nachrichten aus der Stadt und der Region';
        startFullPageTitleTranslation(snapshot());
        await vi.advanceTimersByTimeAsync(300);
        expect(mocks.sendMessage).not.toHaveBeenCalled();
        expect(currentTitle).toBe('Die neuesten Nachrichten aus der Stadt und der Region');

        setPageTitle('The latest news from the city and the region');
        await vi.advanceTimersByTimeAsync(300);
        expect(mocks.sendMessage).toHaveBeenCalledOnce();
        expect(currentTitle).toBe('T:The latest news from the city and the region');

        stopFullPageTitleTranslation();
        expect(currentTitle).toBe('The latest news from the city and the region');
    });

    it('标题命中会话冻结的排除语言时保留原文，清空排除语言的新会话重新请求', async () => {
        currentTitle = 'GPT-6 Sol の新しいモデルを発表しました';
        startFullPageTitleTranslation(snapshot({excludedLanguages: ['ja']}));
        await vi.advanceTimersByTimeAsync(300);
        expect(mocks.sendMessage).not.toHaveBeenCalled();

        startFullPageTitleTranslation(snapshot({excludedLanguages: []}));
        await vi.advanceTimersByTimeAsync(300);
        expect(mocks.sendMessage).toHaveBeenCalledOnce();
        expect(currentTitle).toBe('T:GPT-6 Sol の新しいモデルを発表しました');
    });
});
