/**
 * @file tests/translationVisionPayload.test.ts
 *
 * 文件职责：验证受信图片载荷的私有性、边界校验和各原生模板的序列化结构。
 * 主要内容：覆盖 data image 白名单、JSON 隐藏、OpenAI/Gemini/Claude/通义视觉字段以及自定义 body 隔离。
 * 模块边界：本文件只测试纯快照与模板契约，不发起真实网络请求；provider transport 的 mock 请求由集成测试覆盖。
 */

import {describe, expect, it} from 'vitest';
import {
    attachTranslationImageInput,
    getTranslationImageInput,
    TRANSLATION_IMAGE_INPUT,
} from '@/src/services/translation/requestSnapshot';
import {
    claudeMsgTemplate,
    commonMsgTemplate,
    geminiMsgTemplate,
    tongyiMsgTemplate,
} from '@/src/services/translation/templates';

const image = 'data:image/png;base64,iVBORw0KGgo=';
const base = {
    service: 'custom', from: 'en', to: 'zh-Hans', useCache: true, enableAIContext: true,
    model: {custom: 'vision-model'}, customModel: {}, proxy: {}, custom: '', deeplx: '',
    newApiUrl: '', minimaxBillingPlan: 'payg', minimaxRegion: 'global', mimoBillingPlan: 'payg', mimoRegion: 'global',
    azureOpenaiEndpoint: '', customBody: {custom: '{"model":"attacker"}'}, system_role: {}, user_role: {},
    deepseekApiType: 'chat', deepseekThinkingMode: 'disabled', token: {}, requireApiKey: {},
    youdaoAppKey: '', youdaoAppSecret: '', tencentSecretId: '', tencentSecretKey: '',
} as any;

describe('trusted translation image payload', () => {
    it('keeps the image out of JSON and rejects URLs, SVG, and oversized values', () => {
        const message: Record<string, unknown> = {origin: 'text'};
        attachTranslationImageInput(message, image);
        expect(getTranslationImageInput(message)).toBe(image);
        expect(JSON.stringify(message)).toBe('{"origin":"text"}');
        expect(() => attachTranslationImageInput({}, 'https://example.test/a.png')).toThrow();
        expect(() => attachTranslationImageInput({}, 'data:image/svg+xml;base64,PHN2Zz4=')).toThrow();
        expect(() => attachTranslationImageInput({}, 'data:image/png;base64,A')).toThrow();
        expect(() => attachTranslationImageInput({}, `data:image/png;base64,${'A'.repeat(20 * 1024 * 1024)}`)).toThrow();
        expect(getTranslationImageInput(undefined)).toBeUndefined();
        expect(getTranslationImageInput('serialized')).toBeUndefined();
        const invalid: Record<PropertyKey, unknown> = {};
        Object.defineProperty(invalid, TRANSLATION_IMAGE_INPUT, {value: 'data:image/png;base64,A'});
        expect(getTranslationImageInput(invalid)).toBeUndefined();
    });

    it('rejects unsupported image formats at the template boundary', () => {
        expect(() => commonMsgTemplate('read this', undefined, undefined, undefined, 'custom', 'zh-Hans', undefined, base, undefined, 'data:image/svg+xml;base64,PHN2Zz4=')).toThrow('图片输入格式无效');
    });

    it('serializes native image parts and ignores custom body replacement', () => {
        const openai = JSON.parse(commonMsgTemplate('read this', undefined, undefined, undefined, 'custom', 'zh-Hans', undefined, base, undefined, image));
        expect(openai.model).toBe('vision-model');
        expect(openai.messages[1].content[1]).toEqual({type: 'image_url', image_url: {url: image}});

        const gemini = JSON.parse(geminiMsgTemplate('read this', undefined, undefined, undefined, 'gemini', 'zh-Hans', base, undefined, undefined, image));
        expect(gemini.contents[0].parts[1].inline_data).toEqual({mime_type: 'image/png', data: 'iVBORw0KGgo='});

        const claude = JSON.parse(claudeMsgTemplate('read this', undefined, undefined, undefined, 'claude', 'zh-Hans', undefined, base, undefined, image));
        expect(claude.messages[0].content[1].source).toEqual({type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo='});

        const tongyi = JSON.parse(tongyiMsgTemplate('read this', undefined, undefined, undefined, 'tongyi', 'zh-Hans', undefined, base, undefined, 'en', image));
        expect(tongyi.messages[1].content[1].image_url.url).toBe(image);
        expect(openai.model).not.toBe('attacker');
        expect(() => tongyiMsgTemplate('read this', undefined, undefined, undefined, 'tongyi', 'zh-Hans', 'qwen-mt-plus', base, undefined, 'en', image)).toThrow('不支持图片');
    });
});
