import {afterEach, describe, expect, it, vi} from 'vitest';
import {detectlang, shouldSkipTranslationForTarget} from '@/src/core/language/detect';
import {throttle} from '@/src/shared/function/throttle';
import {getCenterPoint} from '@/src/shared/geometry/touch';

describe('语义化公共工具', () => {
    afterEach(() => vi.restoreAllMocks());

    it('节流函数保留 this/参数，并在时间窗内拒绝同步重入', () => {
        const now = vi.spyOn(Date, 'now')
            .mockReturnValueOnce(1_000)
            .mockReturnValueOnce(1_000)
            .mockReturnValueOnce(1_099)
            .mockReturnValueOnce(1_100);
        const calls: Array<{owner: string; value: number}> = [];
        let throttled!: (this: {owner: string}, value: number) => void;
        throttled = throttle(function (this: {owner: string}, value: number) {
            calls.push({owner: this.owner, value});
            if (value === 1) throttled.call(this, 2);
        }, 100);
        const receiver = {owner: 'content'};

        throttled.call(receiver, 1);
        throttled.call(receiver, 3);
        throttled.call(receiver, 4);

        expect(calls).toEqual([
            {owner: 'content', value: 1},
            {owner: 'content', value: 4},
        ]);
        expect(now).toHaveBeenCalledTimes(4);
    });

    it.each([
        ['这是一个用于中文语言识别的完整句子。', 'zh-Hans'],
        ['This is a complete English sentence for language detection.', 'en'],
        ['これは言語判定のための十分に長い日本語の文章です。', 'ja'],
        ['이 문장은 언어 감지를 위한 충분히 긴 한국어 문장입니다.', 'ko'],
        ['Cette phrase française est suffisamment longue pour identifier la langue.', 'fr'],
        ['Это достаточно длинное русское предложение для определения языка.', 'ru'],
    ])('把常用 franc 结果映射到产品语言代码 %#', (value, expected) => {
        expect(detectlang(value)).toBe(expected);
    });

    it('未知或不确定语言保持 franc 原始代码', () => {
        expect(detectlang('12345')).toBe('und');
    });

    it.each([
        ['今日は良い天気です。', 'ja', true],
        ['今日は良い天気です。', 'zh-Hans', false],
        ['이 문장은 한국어로 작성되었습니다.', 'ko', true],
        ['이 문장은 한국어로 작성되었습니다.', 'ja', false],
        ['这是中文测试。', 'zh-Hans', true],
        ['这是中文测试。', 'zh-Hant', false],
        ['这是中文测试。', 'zh-TW', false],
        ['繁體中文測試。', 'zh-Hant', true],
        ['繁體中文測試。', 'zh-Hans', false],
        ['繁體中文測試。', 'zh-CN', false],
        ['这是繁體中文測試。', 'zh-Hans', false],
        ['这是繁體中文測試。', 'zh-Hant', false],
        ['这是中文测试。', 'zh', false],
        ['这是中文测试。', 'ja', false],
        ['日本語文章', 'zh-Hans', false],
        ['日本語文章', 'ja', false],
        ['時間', 'zh-Hant', false],
        ['云々', 'zh-Hans', false],
        ['Bonjour le monde.', 'en', false],
        ['Hallo Welt.', 'en', false],
        ['AI API', 'en', false],
    ] as const)('仅在字符集能明确证明目标语言时跳过 %#', (value, target, expected) => {
        expect(shouldSkipTranslationForTarget(value, target)).toBe(expected);
    });

    it('未知目标或不足以统计判定的文本会 fail-open', () => {
        const longEnglish = 'This is a deliberately long English paragraph with enough alphabetic characters for reliable language detection.';
        const shortEnglish = 'This ordinary English sentence stays below threshold.';

        expect(shouldSkipTranslationForTarget(longEnglish, 'und')).toBe(false);
        expect(shouldSkipTranslationForTarget(longEnglish, 'unknown')).toBe(false);
        expect(detectlang(shortEnglish)).toBe('en');
        expect(shortEnglish.match(/\p{L}/gu)?.length).toBeLessThan(50);
        expect(shouldSkipTranslationForTarget(shortEnglish, 'en')).toBe(false);
    });

    it('只对至少五十个字母且统计语言匹配的长文本跳过', () => {
        const longEnglish = 'This is a deliberately long English paragraph with enough alphabetic characters for reliable language detection.';
        const longFrench = 'Cette phrase française est suffisamment longue pour identifier la langue avec une confiance raisonnable.';

        expect(longEnglish.match(/\p{L}/gu)?.length).toBeGreaterThanOrEqual(50);
        expect(longFrench.match(/\p{L}/gu)?.length).toBeGreaterThanOrEqual(50);
        expect(shouldSkipTranslationForTarget(longEnglish, 'en')).toBe(true);
        expect(shouldSkipTranslationForTarget(longEnglish, 'fr')).toBe(false);
        expect(shouldSkipTranslationForTarget(longFrench, 'fr')).toBe(true);
        expect(shouldSkipTranslationForTarget(longFrench, 'en')).toBe(false);
    });

    it('只为精确数量的非空触摸点计算中心', () => {
        const touches = {
            0: {clientX: 10, clientY: 20},
            1: {clientX: 30, clientY: 60},
            length: 2,
            item: () => null,
        };

        expect(getCenterPoint(touches, 2)).toEqual({x: 20, y: 40});
        expect(getCenterPoint(touches, 3)).toBeUndefined();
        expect(getCenterPoint({length: 0, item: () => null}, 0)).toBeUndefined();
    });
});
