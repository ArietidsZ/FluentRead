import {describe, expect, it} from 'vitest';
import {
    detectChineseScript,
    getChineseScript,
    normalizeChineseLanguageCode,
} from '@/src/core/language/chinese';

describe('中文书写体系与语言代码', () => {
    it.each([
        ['zh', 'zh-Hans'],
        [' zh-CN ', 'zh-Hans'],
        ['ZH_sg', 'zh-Hans'],
        ['zh-CHS', 'zh-Hans'],
        ['zh-Hans', 'zh-Hans'],
        ['zh-Hans-TW', 'zh-Hans'],
        ['zh_TW', 'zh-Hant'],
        ['zh-HK', 'zh-Hant'],
        ['zh-MO', 'zh-Hant'],
        ['zh-CHT', 'zh-Hant'],
        ['zh-Hant', 'zh-Hant'],
        ['zh-Hant-CN', 'zh-Hant'],
        ['zh-cmn-Hant-HK', 'zh-Hant'],
        ['zh-CN-extra', 'zh-Hans'],
        ['zh-TW-extra', 'zh-Hant'],
        ['zh-US', 'zh-US'],
        ['zh-Hans-Hant', 'zh-Hans-Hant'],
        ['zh-', 'zh-'],
        [' yue-Hant ', 'yue-Hant'],
        ['cmn', 'cmn'],
        [' en_US ', 'en_US'],
        [' auto ', 'auto'],
        [' ', ''],
    ])('归一别名但保留其他语言或不明确标签 %#', (value, expected) => {
        expect(normalizeChineseLanguageCode(value)).toBe(expected);
    });

    it.each([
        ['zh', 'Hans'],
        ['zh-Hans-HK', 'Hans'],
        ['zh-CHT', 'Hant'],
        ['zh-Hant-SG', 'Hant'],
        ['yue', undefined],
        ['yue-Hant', undefined],
        ['cmn', undefined],
        ['zh-Hans-Hant', undefined],
        ['auto', undefined],
    ])('中文脚本仅来自支持的中文语言码 %#', (value, expected) => {
        expect(getChineseScript(value)).toBe(expected);
    });

    it.each([
        ['简体中文', 'Hans'],
        ['繁體中文', 'Hant'],
        ['这是一个用于中文语言识别的完整句子。', 'Hans'],
        ['這是一個用於中文語言識別的完整句子。', 'Hant'],
        ['你们可以从这个网页读取文字。', 'Hans'],
        ['你們可以從這個網頁讀取文字。', 'Hant'],
        ['欢迎使用简体中文翻译', 'Hans'],
        ['歡迎使用繁體中文翻譯', 'Hant'],
        ['這個佛像可以玩，王后在台上，矽和硅都是元素用字。', 'Hant'],
        ['这是台上的王后，干杯之后回到里屋。', 'Hans'],
        ['這些共享字包括后、干、台、里、云、于、只、余。', 'Hant'],
        [' 這是第 123 個測試。🎉 ', 'Hant'],
        ['这是繁體中文測試', undefined],
        ['这是简体中文測試', undefined],
        ['這是繁體中文测试', undefined],
        ['这里有兩隻貓', undefined],
        ['這裡有两只猫', undefined],
        ['這是繁體中文𫫇', undefined],
        ['这是简体中文𪚥', undefined],
        ['这里有璟', undefined],
        ['繁體中文 English', undefined],
        ['简体中文 café', undefined],
        ['這裡也有русский', undefined],
        ['今日は良い天気です。', undefined],
        ['あ繁體中文', undefined],
        ['설정 简体中文', undefined],
        ['日本語文章', undefined],
        ['買物', undefined],
        ['写真', undefined],
        ['傷口', undefined],
        ['美麗', undefined],
        ['時間', undefined],
        ['体', undefined],
        ['中文人口', undefined],
        ['云々', undefined],
        ['呢個係繁體嘅廣東話。', undefined],
        ['佢哋話冇問題。', undefined],
        ['这是简体嘅粤语内容。', undefined],
        ['', undefined],
        ['123?! 🎉', undefined],
    ])('仅在中文证据明确且没有冲突时识别字形 %#', (value, expected) => {
        expect(detectChineseScript(value)).toBe(expected);
    });

    it.each(['两', '猫', '数', '软', '𫫇'])('未审核简体字 %s 不得被已有繁体证据掩盖', (character) => {
        expect(detectChineseScript(`這是${character}`)).toBeUndefined();
    });

    it.each(['兩', '隻', '貓', '數', '軟', '𪚥'])('未审核繁体字 %s 不得被已有简体证据掩盖', (character) => {
        expect(detectChineseScript(`这是${character}`)).toBeUndefined();
    });
});
