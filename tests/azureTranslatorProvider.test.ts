import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {mockConfig} = vi.hoisted(() => ({mockConfig: {
    service: 'azureTranslator', from: 'auto', to: 'zh-Hans',
    proxy: {} as Record<string, string>, token: {azureTranslator: 'test-user-key'} as Record<string, string>,
    azureTranslatorRegion: undefined as string | undefined,
}}));
vi.mock('@/src/services/config/store', () => ({config: mockConfig}));

import azureTranslator, {translateAzureTranslatorTexts} from '@/src/providers/translation/azure-translator';
import {attachTranslationProviderConfig, createTranslationProviderConfigSnapshot} from '@/src/services/translation/requestSnapshot';
import type {TranslationConfigSource} from '@/src/services/translation/types';
import {setRuntimeFetch} from '@/src/platform/http/runtime';

const fetchMock = vi.fn<typeof fetch>();
const reply = (texts: string[]) => Response.json(texts.map(text => ({translations: [{text}]})));
beforeEach(() => {
    fetchMock.mockReset();
    mockConfig.from = 'auto';
    mockConfig.to = 'zh-Hans';
    mockConfig.token = {azureTranslator: 'test-user-key'};
    mockConfig.proxy = {};
    mockConfig.azureTranslatorRegion = undefined;
    setRuntimeFetch(fetchMock);
});
afterEach(() => setRuntimeFetch());

describe('Azure Translator 官方 API 适配器', () => {
    it('以用户自己的密钥请求官方 endpoint，省略 from 启用自动检测', async () => {
        fetchMock.mockResolvedValue(reply(['你好']));
        await expect(azureTranslator({origin: 'hello'})).resolves.toBe('你好');
        const [input, init] = fetchMock.mock.calls[0]!;
        const url = new URL(String(input));
        expect(url.origin + url.pathname).toBe('https://api.cognitive.microsofttranslator.com/translate');
        expect(Object.fromEntries(url.searchParams)).toEqual({'api-version': '3.0', to: 'zh-Hans'});
        expect(init?.headers).toEqual({'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': 'test-user-key'});
        expect(JSON.parse(String(init?.body))).toEqual([{Text: 'hello'}]);
    });

    it('语言、密钥和地域取自冻结请求配置，残留代理设置不会接收密钥', async () => {
        const snapshot = createTranslationProviderConfigSnapshot({
            ...mockConfig, from: 'de', to: 'en', azureTranslatorRegion: ' eastasia ',
            token: {azureTranslator: ' snapshot-key '}, proxy: {azureTranslator: 'https://example.com/translate?existing=1'},
        } as unknown as TranslationConfigSource);
        mockConfig.token.azureTranslator = 'new-key';
        mockConfig.azureTranslatorRegion = 'westus';
        fetchMock.mockResolvedValue(reply(['bonjour']));
        await expect(azureTranslator(attachTranslationProviderConfig({origin: 'test', targetLanguage: 'fr'}, snapshot)))
            .resolves.toBe('bonjour');
        const [input, init] = fetchMock.mock.calls[0]!;
        expect(new URL(String(input)).searchParams.get('from')).toBe('de');
        expect(new URL(String(input)).searchParams.get('to')).toBe('fr');
        expect(new URL(String(input)).origin).toBe('https://api.cognitive.microsofttranslator.com');
        expect(new URL(String(input)).searchParams.has('existing')).toBe(false);
        expect(init?.headers).toMatchObject({
            'Ocp-Apim-Subscription-Key': 'snapshot-key', 'Ocp-Apim-Subscription-Region': 'eastasia',
        });
    });

    it('global 地域不发送地域 header，auto 不受残留代理 URL 的 from 影响', async () => {
        mockConfig.azureTranslatorRegion = 'GLOBAL';
        mockConfig.proxy.azureTranslator = 'https://example.com/translate?from=fr';
        fetchMock.mockResolvedValue(reply(['你好']));
        await expect(translateAzureTranslatorTexts(['hello'])).resolves.toEqual(['你好']);
        expect(new URL(String(fetchMock.mock.calls[0]![0])).searchParams.has('from')).toBe(false);
        expect(fetchMock.mock.calls[0]![1]?.headers).not.toHaveProperty('Ocp-Apim-Subscription-Region');
    });

    it('按 1000 项和 50000 字符合计限制分批，并完整保留输入输出顺序', async () => {
        fetchMock.mockImplementation(async (_url, init) => {
            const values = JSON.parse(String(init?.body)) as Array<{Text: string}>;
            expect(values.length).toBeLessThanOrEqual(1000);
            expect(values.reduce((sum, value) => sum + value.Text.length, 0)).toBeLessThanOrEqual(50000);
            return reply(values.map(value => `译:${value.Text}`));
        });
        const many = Array.from({length: 1001}, (_, index) => `text-${index}`);
        await expect(azureTranslator({origin: many, sourceLanguage: 'en'})).resolves.toEqual(many.map(value => `译:${value}`));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        fetchMock.mockClear();
        const large = ['a'.repeat(30000), 'b'.repeat(20000), 'c'];
        await expect(translateAzureTranslatorTexts(large)).resolves.toEqual(large.map(value => `译:${value}`));
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('在任何请求之前拒绝超大单项，避免部分批次先消耗额度', async () => {
        await expect(translateAzureTranslatorTexts(['valid', 'a'.repeat(50001)]))
            .rejects.toMatchObject({statusCode: 400});
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('不带密钥或输入类型错误时给出本地参数错误，空数组不发请求', async () => {
        mockConfig.token = {};
        await expect(azureTranslator({origin: 'hello'})).rejects.toMatchObject({statusCode: 400});
        await expect(translateAzureTranslatorTexts(42 as never)).rejects.toMatchObject({statusCode: 400});
        await expect(azureTranslator({origin: [1]} as never)).rejects.toMatchObject({statusCode: 400});
        await expect(azureTranslator({origin: []})).resolves.toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        [null, '译文数量异常'],
        [[], '译文数量异常'],
        [[{}, {}], '译文数量异常'],
        [[null], '未返回有效译文'],
        [[{}], '未返回有效译文'],
        [[{translations: []}], '未返回有效译文'],
        [[{translations: [{}]}], '未返回有效译文'],
        [[{translations: [{text: 1}]}], '未返回有效译文'],
        [[{translations: [{text: ' '}]}], '未返回有效译文'],
    ])('拒绝数量错误或无效译文，防止回退链把空结果当成功 %#', async (payload, expected) => {
        fetchMock.mockResolvedValue(Response.json(payload));
        await expect(azureTranslator({origin: 'test'})).rejects.toThrow(expected);
    });

    it('HTTP 状态与 JSON 错误不包含服务端原文或凭据回显', async () => {
        fetchMock.mockResolvedValueOnce(new Response('echo secret key', {status: 429}));
        await expect(azureTranslator({origin: 'hello'})).rejects.toThrow('Azure Translator 翻译失败: 429');
        fetchMock.mockResolvedValueOnce(new Response('echo secret key'));
        await expect(azureTranslator({origin: 'hello'})).rejects.toThrow('Azure Translator 返回的不是有效 JSON');
    });

    it('调用前和响应读取中的取消都不返回迟到译文', async () => {
        const preAborted = new AbortController();
        preAborted.abort('stop');
        await expect(azureTranslator({origin: 'hello', abortSignal: preAborted.signal})).rejects.toMatchObject({name: 'AbortError'});
        expect(fetchMock).not.toHaveBeenCalled();

        const duringFetch = new AbortController();
        fetchMock.mockImplementationOnce(async (_url, init) => {
            expect(init?.signal).toBe(duringFetch.signal);
            duringFetch.abort(new Error('请求已取消'));
            return reply(['late']);
        });
        await expect(azureTranslator({origin: 'hello', abortSignal: duringFetch.signal})).rejects.toThrow('请求已取消');

        const duringJson = new AbortController();
        fetchMock.mockResolvedValueOnce({ok: true, json: async () => {
            duringJson.abort(new Error('解析已取消'));
            return [{translations: [{text: 'late'}]}];
        }} as Response);
        await expect(azureTranslator({origin: 'hello', abortSignal: duringJson.signal})).rejects.toThrow('解析已取消');
    });

    it('在下一批发送前观察到取消时不继续消耗额度', async () => {
        let checks = 0;
        const signal = {get aborted() { return ++checks > 1; }, reason: new Error('批次已取消')} as AbortSignal;
        await expect(translateAzureTranslatorTexts(['hello'], {abortSignal: signal})).rejects.toThrow('批次已取消');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
