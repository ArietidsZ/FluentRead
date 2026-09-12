/**
 * @file tests/translationVisionProviders.test.ts
 *
 * 文件职责：用 mock runtime transport 验证各视觉 provider 的真实序列化请求。
 * 主要内容：覆盖 OpenAI-compatible SDK、Gemini、Claude、通义和智谱，并确认自定义 body 无法替换视觉模型与图片。
 * 模块边界：测试只截获本地 runtimeFetch，不访问真实供应商网络，也不验证 UI 或 OCR。
 */

import {afterEach, describe, expect, it, vi} from 'vitest';
import {Config} from '@/src/core/config/model';
import {setRuntimeFetch} from '@/src/platform/http/runtime';
import {attachTranslationImageInput, attachTranslationProviderConfig, createTranslationProviderConfigSnapshot} from '@/src/services/translation/requestSnapshot';
import {translateWithOpenAICompatibleAiSdk} from '@/src/providers/translation/ai-sdk/openai-compatible';
import gemini from '@/src/providers/translation/gemini';
import claude from '@/src/providers/translation/claude';
import tongyi from '@/src/providers/translation/tongyi';
import zhipu from '@/src/providers/translation/zhipu';

const image = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const response = (body: unknown) => new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}});

function request(config: Config, service: string, model: string) {
    const message: any = {origin: '读取图片', serviceOverride: service, modelOverride: model, targetLanguage: 'zh-Hans', requestTimeoutMs: 5000};
    attachTranslationImageInput(message, image);
    attachTranslationProviderConfig(message, createTranslationProviderConfigSnapshot(config as any));
    return {message, config};
}

describe('translation vision provider payloads', () => {
    afterEach(() => setRuntimeFetch());

    it('sends OpenAI-compatible vision content and ignores customBody', async () => {
        const config = new Config();
        config.customOpenAIProviders = [{id: 'custom:vision', name: 'Vision', endpoint: 'https://vision.test/v1/chat/completions', models: ['vision-model']}];
        config.token['custom:vision'] = 'secret';
        config.customBody['custom:vision'] = '{"model":"attacker","messages":[]}';
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body));
            expect(body.model).toBe('vision-model');
            expect(body.messages[1].content[1].image_url.url).toBe(image);
            return response({choices: [{message: {content: 'ok'}}]});
        });
        setRuntimeFetch(fetchMock);
        await expect(translateWithOpenAICompatibleAiSdk({...request(config, 'custom:vision', 'vision-model').message})).resolves.toBe('ok');
    });

    it.each([
        ['gemini', gemini, 'gemini-2.5-flash'],
        ['claude', claude, 'claude-test'],
        ['tongyi', tongyi, 'qwen-test'],
        ['zhipu', zhipu, 'glm-test'],
    ] as const)('serializes %s native image input', async (name, provider, model) => {
        const config = new Config();
        config.service = name;
        config.model[name] = model;
        config.token[name] = name === 'zhipu' ? 'id.secret' : 'secret';
        config.customBody[name] = '{"model":"attacker"}';
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body));
            if (name === 'gemini') expect(body.contents[0].parts[1].inline_data.data).toContain('9j');
            if (name === 'claude') expect(body.messages[0].content[1].source.data).toContain('9j');
            if (name === 'tongyi' || name === 'zhipu') expect(body.messages[1].content[1].image_url.url).toBe(image);
            expect(body.model).not.toBe('attacker');
            return name === 'gemini'
                ? response({candidates: [{content: {parts: [{text: 'ok'}]}}]})
                : name === 'claude'
                    ? response({content: [{type: 'text', text: 'ok'}]})
                    : response({choices: [{message: {content: 'ok'}}]});
        });
        setRuntimeFetch(fetchMock);
        const {message} = request(config, name, model);
        await expect(provider(message)).resolves.toBe('ok');
        expect(fetchMock).toHaveBeenCalledOnce();
    });
});
