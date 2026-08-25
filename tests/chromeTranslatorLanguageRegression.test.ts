import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    config: {from: 'auto', to: 'zh-Hans'},
    send: vi.fn(),
}));

vi.mock('@/src/services/config/store', () => ({config: mocks.config}));

import defaultChromeTranslator, {createChromeTranslator} from '@/src/providers/translation/chrome-translator';
import {buildChromeOffscreenTranslationData} from '@/src/providers/translation/chromeTranslatorRequest';

const chromeTranslator = createChromeTranslator({
    capabilities: {chromeTranslation: true},
    offscreenClient: {send: mocks.send},
});

describe('Chrome translator 请求级语言回归', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.assign(mocks.config, {from: 'auto', to: 'zh-Hans'});
        mocks.send.mockResolvedValue({success: true, result: '翻译结果'});
    });

    it('纯 payload builder 使用请求覆盖，空白覆盖才回退配置快照', () => {
        expect(buildChromeOffscreenTranslationData({
            origin: 'hello', sourceLanguage: ' en ', targetLanguage: ' ja ',
        }, {sourceLanguage: 'auto', targetLanguage: 'zh-Hans'})).toEqual({
            text: 'hello', from: 'en', to: 'ja',
        });
        expect(buildChromeOffscreenTranslationData({
            origin: 'hello', sourceLanguage: ' ', targetLanguage: undefined,
        }, {sourceLanguage: 'auto', targetLanguage: 'zh-Hans'})).toEqual({
            text: 'hello', from: 'auto', to: 'zh-Hans',
        });
        expect(() => buildChromeOffscreenTranslationData({origin: null}, {
            sourceLanguage: 'auto', targetLanguage: 'zh-Hans',
        })).toThrow('翻译文本不能为空');
        expect(() => buildChromeOffscreenTranslationData({origin: '   '}, {
            sourceLanguage: 'auto', targetLanguage: 'zh-Hans',
        })).toThrow('翻译文本不能为空');
    });

    it('真实 provider 发往 offscreen 的 data 与 broker 请求覆盖完全一致', async () => {
        await expect(chromeTranslator({
            origin: 'hello',
            sourceLanguage: 'en',
            targetLanguage: 'ja',
        })).resolves.toBe('翻译结果');

        expect(mocks.send).toHaveBeenCalledWith({
            type: 'CHROME_TRANSLATE_OFFSCREEN',
            data: {text: 'hello', from: 'en', to: 'ja'},
        });
    });

    it('未覆盖语言时仍使用当前配置，非法原文不会发消息', async () => {
        await expect(chromeTranslator({origin: 'hello'})).resolves.toBe('翻译结果');
        expect(mocks.send).toHaveBeenLastCalledWith(expect.objectContaining({
            data: {text: 'hello', from: 'auto', to: 'zh-Hans'},
        }));

        mocks.send.mockClear();
        await expect(chromeTranslator({origin: ''})).rejects.toThrow('翻译文本不能为空');
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it('默认 unknown 构建保守拒绝 Chrome provider，且不会触碰 Offscreen', async () => {
        await expect(defaultChromeTranslator({origin: 'hello'}))
            .rejects.toThrow('当前浏览器不支持 Chrome 内置翻译');
        expect(mocks.send).not.toHaveBeenCalled();
    });
});
