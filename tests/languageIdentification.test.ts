/**
 * @file tests/languageIdentification.test.ts
 * 统一识别流水线与公开判断 API：空文本、仅标识符、主文字并列、中日韩分支、名称主导、夹带外语、
 * 单一语言文字与反证、多语言统计与逐句混合检测；detectlang 的规范返回契约；目标语言与排除语言等价；
 * 目标、排除列表或文本变化后重新比较且缓存只以文本为键；用户反馈原文与既有中日韩反例。
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import modelPost from './fixtures/chinese-language-model-post.json';
import {
    detectChineseScript,
    detectlang,
    isTextInLanguage,
    shouldSkipChineseSelection,
    shouldSkipTranslationForTarget,
} from '@/src/core/language/detect';
import {
    clearLanguageIdentificationCache,
    identifyTextLanguage,
    normalizeLanguageEvidenceText,
} from '@/src/core/language/identify';

afterEach(() => {
    clearLanguageIdentificationCache();
    vi.restoreAllMocks();
});

describe('识别状态', () => {
    it.each(['', '   ', '12345', '🎉🔥👀', '—（）…', '2026-09-16 12:00', '$19.99 → €18,50'])('无字母文本 %j 为 empty，所有目标无需请求', text => {
        expect(identifyTextLanguage(text)).toEqual({status: 'empty', languages: []});
        expect(shouldSkipTranslationForTarget(text, 'en')).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(true);
    });

    it.each([
        'https://github.com/solidSpoon/DashPlayer/commit/84522b3ff33401f87da8d5d7c4510ea5453e40ef',
        'GPT-6 Sol', 'src/core/language/detect.ts', '84522b3', 'v2.3.1',
    ])('只有标识符的文本 %s 为 unknown，保留翻译机会', text => {
        expect(identifyTextLanguage(text)).toMatchObject({status: 'unknown', languages: []});
        expect(shouldSkipTranslationForTarget(text, 'en')).toBe(false);
    });

    it.each(['PDF、ePub、DOCX、Markdown', 'AI API', 'OpenAI', 'A B C'])('只有名称、格式或单字母的文本 %s 没有正文证据', text => {
        expect(identifyTextLanguage(text).status).toBe('unknown');
        expect(shouldSkipTranslationForTarget(text, 'en')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(false);
    });

    it('两种文字正文字母数相同时无法确定主文字', () => {
        expect(identifyTextLanguage('中文 ab').status).toBe('unknown');
        expect(identifyTextLanguage('これは Ελληνικά の説明です。').status).not.toBe('identified');
    });

    it.each([
        ['这些算法使用 AI，可以降低成本，但是 Please translate this sentence.', 'Latin 主文字夹带中文'],
        ['预计将推出 GPT-6 Sol Please translate this sentence.', '模型名后的英文句子'],
        ['这些算法可以降低成本，同时需要翻译 café。', '中文夹带普通外语词'],
        ['这些算法可以降低成本，同时还有 русский。', '中文夹带俄文'],
        ['この機能は便利です。 Добро пожаловать на наш сайт.', 'Cyrillic 主文字夹带日文'],
        ['한국어 설명 Русский текст.', 'Cyrillic 主文字夹带谚文'],
        ['Welcome to our website. Nous sommes très heureux de vous accueillir sur notre nouvelle plateforme aujourd\'hui.', '英文句子加法文句子'],
        ['Dieser Absatz beschreibt die Einstellungen der Anwendung sehr genau.\nThis sentence is written in English for the reader.', '换行分隔的德文与英文'],
        ['Καλώς ήρθατε στον ιστότοπό μας, please sign in first.', '希腊文夹带英文'],
        ['हमारी वेबसाइट पर आपका स्वागत है, but the login page is broken.', '印地文夹带英文'],
    ])('%s → mixed（%s）', text => {
        expect(identifyTextLanguage(text).status).toBe('mixed');
    });

    it('希腊字母单字作符号使用时不算外语正文', () => {
        expect(identifyTextLanguage('这个参数 α 控制学习率的衰减速度').status).not.toBe('mixed');
        const withoutSymbol = 'The value of the parameter is the rate at which the model learns from all of the data.';
        expect(identifyTextLanguage(withoutSymbol)).toMatchObject({status: 'identified', languages: ['en']});
        expect(identifyTextLanguage(withoutSymbol.replace('parameter', 'parameter α'))).toMatchObject({status: 'identified', languages: ['en']});
    });

    it('结论对象不可变，调用方无法篡改共享缓存', () => {
        const result = identifyTextLanguage('Добро пожаловать на наш сайт.');
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.languages)).toBe(true);
    });
});

describe('中日韩', () => {
    it.each([
        ['GPT-6 Sol の新しいモデルを発表しました。', 'ja'],
        ['これは OpenAI API を使います。', 'ja'],
        ['この機能は誰でも簡単に使うことが出来ます。', 'ja'],
        ['設定を翻訳', 'ja'],
        ['GPT-6 Sol 모델의 새로운 기능을 소개합니다.', 'ko'],
        ['이 문서는 GitHub API를 설명합니다.', 'ko'],
        ['경제(經濟) 성장률이 올해 크게 높아졌습니다.', 'ko'],
        ['대한민국헌법(大韓民國憲法) 제1조를 설명합니다.', 'ko'],
    ])('%s → %s', (text, language) => {
        expect(identifyTextLanguage(text)).toMatchObject({status: 'identified', languages: [language]});
        expect(shouldSkipTranslationForTarget(text, language)).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'en')).toBe(false);
    });

    it.each([
        ['预计将推出 GPT-6 Sol あ', '假名夹在简体中文中'],
        ['這是繁體中文の説明', '假名夹在繁体中文中'],
        ['设置 简体中文', '谚文与简体字'],
        ['설정 简体中文', '简体字不会出现在韩文汉字中'],
        ['漢字漢字漢字 한', '汉字多于谚文'],
        ['あ안', '假名与谚文同时出现'],
        ['이 단락은 설명입니다. 這段文字說明擴充功能如何保留原文', '韩文后接繁体中文句子'],
    ])('%s 不作为日文或韩文（%s）', text => {
        expect(shouldSkipTranslationForTarget(text, 'ja')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'ko')).toBe(false);
    });

    it('纯共享汉字、罕见字、粤语与简繁混排保持未知，最佳猜测为书写体系未知的中文', () => {
        for (const text of ['日本国立大学', '時間', '株式会社', '这是繁體中文測試。', '呢個係繁體嘅廣東話。', '这里有𱀀']) {
            expect(identifyTextLanguage(text)).toMatchObject({status: 'unknown', bestGuess: 'zh'});
            expect(detectlang(text)).toBe('cmn');
            for (const target of ['zh-Hans', 'zh-Hant', 'ja', 'yue']) expect(shouldSkipTranslationForTarget(text, target)).toBe(false);
        }
    });

    it('简繁同形中文同时属于简体和繁体目标，也可被任一中文排除项跳过', () => {
        expect(identifyTextLanguage('✨ 新增功能')).toMatchObject({status: 'identified', languages: ['zh-Hans', 'zh-Hant']});
        expect(detectlang('✨ 新增功能')).toBe('cmn');
        expect(detectChineseScript('✨ 新增功能')).toBeUndefined();
        expect(shouldSkipTranslationForTarget('✨ 新增功能', 'en', ['zh-Hant'])).toBe(true);
        expect(isTextInLanguage('你好，世界！', 'zh-TW')).toBe(true);
    });

    it('名称按词计权，超过母语字符一半时不能证明整段是目标语言', () => {
        expect(identifyTextLanguage('中文 AI').status).toBe('unknown');
        expect(identifyTextLanguage('中文 GPT-6 Sol').status).toBe('unknown');
        expect(identifyTextLanguage('预计推出 GPT-6 GPT-7 GPT-8 GPT-9 模型').status).toBe('unknown');
        expect(identifyTextLanguage('ハイ OpenAI API GitHub').status).toBe('unknown');
        expect(identifyTextLanguage('请使用 AI 翻译')).toMatchObject({status: 'identified', languages: ['zh-Hans']});
    });
});

describe('用户反馈原文', () => {
    const releaseNote = '云端模型清单允许清空，且不再连带拒掉无关偏好的保存';
    it.each([...modelPost, modelPost.join('\n'), releaseNote, `${releaseNote} (84522b3)`, `${releaseNote}\n(84522b3)`])(
        '中文发布说明与模型公告跳过简体目标，外语目标和繁体目标仍翻译 %#', text => {
            expect(identifyTextLanguage(text)).toMatchObject({status: 'identified', languages: ['zh-Hans']});
            expect(detectlang(text)).toBe('zh-Hans');
            for (const target of ['zh', 'zh-CN', 'zh-Hans', 'zh_SG']) expect(shouldSkipTranslationForTarget(text, target)).toBe(true);
            for (const target of ['zh-Hant', 'en', 'ja', 'ko']) expect(shouldSkipTranslationForTarget(text, target)).toBe(false);
            expect(shouldSkipTranslationForTarget(text, 'en', ['zh-Hans'])).toBe(true);
        });

    it('宿主页面 lang="en" 不参与判断：函数只读取传入文本', () => {
        vi.stubGlobal('document', {documentElement: {lang: 'en'}, title: 'GitHub'});
        expect(shouldSkipTranslationForTarget(`${releaseNote} (84522b3)`, 'en')).toBe(false);
        expect(shouldSkipTranslationForTarget(`${releaseNote} (84522b3)`, 'zh-Hans')).toBe(true);
        vi.unstubAllGlobals();
    });

    it.each([
        ['Welcome to the settings page.', 'en'],
        ['Bonjour et bienvenue sur notre site.', 'fr'],
        ['Добро пожаловать на наш сайт.', 'ru'],
    ])('反馈中的短句 %s 可信识别为 %s', (text, language) => {
        expect(detectlang(text)).toBe(language);
        expect(shouldSkipTranslationForTarget(text, language)).toBe(true);
        expect(shouldSkipTranslationForTarget(text, `${language}-ZZ`)).toBe(true);
        expect(shouldSkipTranslationForTarget(text, language === 'en' ? 'fr' : 'en')).toBe(false);
    });
});

describe('多语言统计与混合', () => {
    it.each([
        ['Dieser deutsche Absatz beschreibt die verschiedenen Einstellungen der Anwendung und die automatische Übersetzung.', 'de'],
        ['Este é um parágrafo em português que descreve as configurações do aplicativo e a tradução automática.', 'pt'],
        ["Questo paragrafo italiano descrive le impostazioni dell'applicazione e la traduzione automatica.", 'it'],
        ['Цей абзац пояснює, як розширення зберігає оригінальний текст і показує переклад одразу під ним.', 'uk'],
        ['توضح هذه الفقرة كيف تحافظ الإضافة على النص الأصلي وتعرض الترجمة أسفله مباشرة.', 'ar'],
        ['यह अनुच्छेद बताता है कि एक्सटेंशन मूल पाठ को कैसे सुरक्षित रखता है और अनुवाद को ठीक उसके नीचे दिखाता है।', 'hi'],
        ['הפסקה הזו מסבירה איך התוסף שומר על הטקסט המקורי ומציג את התרגום ממש מתחתיו.', 'he'],
        ['Αυτή η παράγραφος εξηγεί πώς η επέκταση διατηρεί το αρχικό κείμενο.', 'el'],
        ['ยินดีต้อนรับสู่เว็บไซต์ของเรา', 'th'],
        ['Представлена модель GPT-6 Sol с улучшенными возможностями, подробности в файле README.md.', 'ru'],
    ])('%s → %s，目标语言、地区标签与排除语言三种写法结论一致', (text, language) => {
        expect(detectlang(text)).toBe(language);
        expect(shouldSkipTranslationForTarget(text, language)).toBe(true);
        expect(shouldSkipTranslationForTarget(text, `${language}_XK`)).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans', [language])).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(false);
    });

    it('同一文字但只有一个句子时不做逐句检测；换行也是句子边界', () => {
        const german = 'Dieser Absatz beschreibt die verschiedenen Einstellungen der Anwendung sehr genau.';
        expect(identifyTextLanguage(german).languages).toEqual(['de']);
        expect(identifyTextLanguage(`${german}\n${german}`).languages).toEqual(['de']);
        expect(identifyTextLanguage(`${german} Ok.`).languages).toEqual(['de']);
    });

    it('Myanmar、Ethiopic 等多语言文字和少于两个字母的单一语言文字保持未知', () => {
        expect(identifyTextLanguage('မင်္ဂလာပါ ကြိုဆိုပါတယ်').status).toBe('unknown');
        expect(identifyTextLanguage('ሰላም እንኳን ደህና መጡ').status).toBe('unknown');
        expect(identifyTextLanguage('א').status).toBe('unknown');
        expect(identifyTextLanguage('װאָס מאַכסטו? ײַ').status).toBe('unknown');
        expect(identifyTextLanguage('Ἐν ἀρχῇ ἦν ὁ λόγος.').status).toBe('unknown');
        expect(identifyTextLanguage('𓀀𓁐𓂀 𓃀𓄀').status).toBe('unknown');
    });

    it('非 Latin 统计文字中名称过多时不能证明语言', () => {
        expect(identifyTextLanguage('Новый OpenAI GPT-6 API SDK').status).toBe('unknown');
    });
});

describe('统计库没有给出候选时', () => {
    it('统计文字识别保持未知且不给出最佳猜测，detectlang 退回 und', async () => {
        vi.resetModules();
        vi.doMock('franc-min', () => ({franc: () => 'und', francAll: () => [['und', 1]]}));
        const isolated = await import('@/src/core/language/detect');
        const isolatedIdentify = await import('@/src/core/language/identify');
        expect(isolatedIdentify.identifyTextLanguage('Welcome to the settings page.')).toEqual({status: 'unknown', languages: []});
        expect(isolated.detectlang('Welcome to the settings page.')).toBe('und');
        expect(isolated.shouldSkipTranslationForTarget('Welcome to the settings page.', 'en')).toBe(false);
        vi.doUnmock('franc-min');
        vi.resetModules();
    });
});

describe('detectlang 返回契约', () => {
    it('可信结论优先；不可信时返回规范化最佳猜测；没有文字证据时返回 und', () => {
        expect(detectlang('Hallo Welt.')).not.toMatch(/^[a-z]{3}$/u);
        expect(detectlang('Ласкаво просимо на наш сайт.')).toBe('sr');
        expect(detectlang('12345')).toBe('und');
        expect(detectlang('GPT-6 Sol')).toBe('und');
        expect(detectlang('ברוכים הבאים לאתר שלנו.')).toBe('he');
    });

    it('混合文本没有统计最佳猜测时退回 franc 原始结果并规范化', () => {
        expect(detectlang('The phrase 你好世界 means hello world in Chinese.')).toBe('en');
        expect(detectlang('这是一个很长的中文句子，里面夹带 hello 这个英文单词。')).toBe('cmn');
    });
});

describe('配置或文本变化后的重新判断', () => {
    it('同一文本切换目标语言、排除列表时逐次比较，不复用上一次跳过结论', () => {
        const german = 'Dieser deutsche Absatz beschreibt die verschiedenen Einstellungen der Anwendung und die automatische Übersetzung.';
        const sequence = [
            [german, 'de', [], true], [german, 'en', [], false], [german, 'en', ['de'], true], [german, 'en', [], false],
            [german, 'de-AT', [], true], [german, 'zh-Hans', ['fr', 'ja'], false],
        ] as const;
        for (const [text, target, excluded, expected] of sequence) {
            expect(shouldSkipTranslationForTarget(text, target, excluded)).toBe(expected);
        }
    });

    it('缓存只以规范后的文本为键：空白差异复用，文本变化重新识别，超长文本不缓存', () => {
        const first = identifyTextLanguage('Welcome to the settings page.');
        expect(identifyTextLanguage('  Welcome   to the settings\tpage. ')).toBe(first);
        expect(identifyTextLanguage('Bienvenue sur la page des paramètres de notre site.')).not.toBe(first);
        const long = 'This paragraph explains how the translation extension keeps the original text. '.repeat(60);
        expect(long.length).toBeGreaterThan(4096);
        expect(identifyTextLanguage(long)).not.toBe(identifyTextLanguage(long));
        expect(identifyTextLanguage(long).languages).toEqual(['en']);
    });

    it('缓存有界并按最近使用淘汰，清空后重新计算', () => {
        const kept = identifyTextLanguage('Добро пожаловать на наш сайт.');
        for (let index = 0; index < 600; index += 1) identifyTextLanguage(`条目 ${index} 的中文说明`);
        expect(identifyTextLanguage('Добро пожаловать на наш сайт.')).not.toBe(kept);
        const recent = identifyTextLanguage('条目 599 的中文说明');
        expect(identifyTextLanguage('条目 599 的中文说明')).toBe(recent);
        clearLanguageIdentificationCache();
        expect(identifyTextLanguage('条目 599 的中文说明')).not.toBe(recent);
    });

    it('识别文本规范化合并行内空白但保留换行作为句子边界', () => {
        expect(normalizeLanguageEvidenceText('  a \t b　c \n\n  d  ')).toBe('a b c\nd');
    });
});

describe('选区交互规则保持独立', () => {
    it('纯汉字选区只对中文目标跳过，不作为通用识别结论', () => {
        expect(shouldSkipChineseSelection('日本国立大学', 'zh-CN')).toBe(true);
        expect(shouldSkipTranslationForTarget('日本国立大学', 'zh-CN')).toBe(false);
        expect(shouldSkipChineseSelection('日本国立大学', 'ja')).toBe(false);
    });
});
