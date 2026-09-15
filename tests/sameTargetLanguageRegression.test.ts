/**
 * @file tests/sameTargetLanguageRegression.test.ts
 * 同目标语言重复翻译的历史缺陷最小复现，只使用长期公开的 detect 与全文槽请求 API。
 * 旧实现失败条件：ISO 639-3 结果未统一导致德/葡/意同目标不跳过；排除语言与目标语言结论不一致；
 * 少于 50 个字母的明确短句一律放行；日/韩正文中的 GPT-6 Sol 被当成外语；未配置排除语言时
 * 富文本槽只做字符集快判，同目标德语槽仍被提交。检测均调用真实 franc-min，不 mock 识别结果。
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import modelPost from './fixtures/chinese-language-model-post.json';

const runtime = vi.hoisted(() => ({
    requests: [] as string[][],
    config: {
        service: 'microsoft',
        model: {microsoft: 'default'} as Record<string, string>,
        customModel: {} as Record<string, string>,
        modelThinking: {} as Record<string, Record<string, boolean>>,
        from: 'auto',
        to: 'de',
        excludedLanguages: [] as string[],
        useCache: false,
        enableAIContext: false,
        enableAIMultiSegment: false,
        display: 1,
        style: 0,
        maxConcurrentTranslations: 2,
        glossaryLibraries: [],
        glossaryEnabled: false,
    },
}));

vi.mock('@/src/services/config/store', () => ({config: runtime.config}));
vi.mock('@/src/app/translation/client', () => ({
    translateText: async (origin: string) => {
        runtime.requests.push([origin]);
        return `T(${origin})`;
    },
    translateTextBatch: async (origins: readonly string[]) => {
        runtime.requests.push([...origins]);
        return origins.map((origin) => `T(${origin})`);
    },
}));

import {detectlang, shouldSkipTranslationForTarget} from '@/src/core/language/detect';
import {captureFullPageTranslationConfig, translateTextSlots} from '@/src/features/full-page-translation/content/translationRequest';

const longGerman = 'Dieser deutsche Absatz beschreibt die verschiedenen Einstellungen der Anwendung und die automatische Übersetzung.';
const longPortuguese = 'Este é um parágrafo em português que descreve as configurações do aplicativo e a tradução automática.';
const longItalian = 'Questo paragrafo italiano descrive le impostazioni dell\'applicazione e la traduzione automatica.';
const releaseNote = '云端模型清单允许清空，且不再连带拒掉无关偏好的保存 (84522b3)';

describe('同目标语言跳过：历史失败条件', () => {
    beforeEach(() => {
        // 宿主页声明 lang="en" 也不能改变局部文本的判断；识别函数本身不读取页面语言。
        vi.stubGlobal('document', {title: 'Release notes', documentElement: {lang: 'en'}});
        runtime.requests = [];
        runtime.config.to = 'de';
        runtime.config.excludedLanguages = [];
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it.each([
        [longGerman, 'de'],
        [longPortuguese, 'pt'],
        [longItalian, 'it'],
    ])('识别正确的长文本在 ISO 639-3 与配置代码不同时仍应跳过 %#', (text, target) => {
        expect(detectlang(text)).toBe(target);
        expect(shouldSkipTranslationForTarget(text, target)).toBe(true);
        expect(shouldSkipTranslationForTarget(text, `${target}-${target.toUpperCase()}`)).toBe(true);
    });

    it.each([
        [longGerman, 'de'],
        [longPortuguese, 'pt'],
        [longItalian, 'it'],
        ['Welcome to the settings page.', 'en'],
        ['Bonjour et bienvenue sur notre site.', 'fr'],
    ])('同一文本作为目标语言与排除语言时结论一致 %#', (text, language) => {
        const asTarget = shouldSkipTranslationForTarget(text, language);
        const asExcluded = shouldSkipTranslationForTarget(text, 'zh-Hans', [language]);
        expect(asExcluded).toBe(asTarget);
        expect(asTarget).toBe(true);
    });

    it.each([
        ['Welcome to the settings page.', 'en'],
        ['Bonjour et bienvenue sur notre site.', 'fr'],
        ['Добро пожаловать на наш сайт.', 'ru'],
    ])('少于 50 个字母但证据充分的同语言短句应跳过 %#', (text, target) => {
        expect((text.match(/\p{L}/gu) ?? []).length).toBeLessThan(50);
        expect(shouldSkipTranslationForTarget(text, target)).toBe(true);
    });

    it.each([
        ['GPT-6 Sol の新しいモデルを発表しました。', 'ja'],
        ['GPT-6 Sol 모델의 새로운 기능을 소개합니다.', 'ko'],
    ])('日韩正文中的带版本模型名不能被当成外语正文 %#', (text, target) => {
        expect(shouldSkipTranslationForTarget(text, target)).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(false);
    });

    it.each([...modelPost, modelPost.join('\n'), releaseNote])('用户反馈的中文原文跳过简体目标且保留跨语言翻译 %#', (text) => {
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hant')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'en')).toBe(false);
    });

    it('未配置排除语言时富文本槽也执行完整同目标判断，只提交相邻外语槽', async () => {
        const snapshot = captureFullPageTranslationConfig();
        const english = 'This English sentence still needs a German translation for the reader.';
        const result = await translateTextSlots([longGerman, english], snapshot);
        expect(runtime.requests).toEqual([[english]]);
        expect(result).toEqual([longGerman, `T(${english})`]);
    });

    it.each([
        ['日本国立大学', 'zh-Hans'],
        ['日本国立大学', 'zh-Hant'],
        ['Settings', 'en'],
        ['Paramètres', 'fr'],
        ['Bienvenido a nuestro sitio web.', 'pt'],
        ['预计将推出 GPT-6 Sol Please translate this sentence.', 'zh-Hans'],
        ['GPT-6 Sol の新しいモデルを発表しました。This English sentence needs translation.', 'ja'],
    ])('单个歧义词、纯汉字、误识别短句与夹带外语句子继续翻译 %#', (text, target) => {
        expect(shouldSkipTranslationForTarget(text, target)).toBe(false);
    });
});
