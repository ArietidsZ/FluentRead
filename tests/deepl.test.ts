import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {mockConfig} = vi.hoisted(() => ({
    mockConfig: {
        from: 'auto',
        to: 'zh-Hans',
        service: 'deepL',
        deeplApiPlan: undefined as 'free' | 'pro' | undefined,
        proxy: {} as Record<string, string>,
        token: {} as Record<string, string>,
    },
}));

vi.mock('@/src/services/config/store', () => ({config: mockConfig}));

import deepl from '@/src/providers/translation/deepl';
import {Config} from '@/src/core/config/model';
import {
    DEFAULT_DEEPL_API_PLAN,
    DEEPL_API_ENDPOINTS,
    getDeepLEndpoint,
    normalizeDeepLApiPlan,
} from '@/src/core/config/deepl';
import {
    attachTranslationProviderConfig,
    createTranslationProviderConfigSnapshot,
} from '@/src/services/translation/requestSnapshot';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({translations: [{text: '你好'}]})));
    Object.assign(mockConfig, {
        service: 'deepL', from: 'auto', to: 'zh-Hans', deeplApiPlan: undefined,
        proxy: {}, token: {deepL: 'test-key'},
    });
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('DeepL API 套餐配置', () => {
    it('使用官方 Free / Pro 地址，并让缺失与无效旧值保持 Free', () => {
        expect(DEFAULT_DEEPL_API_PLAN).toBe('free');
        expect(Object.isFrozen(DEEPL_API_ENDPOINTS)).toBe(true);
        expect(normalizeDeepLApiPlan('pro')).toBe('pro');
        expect(getDeepLEndpoint('pro')).toBe('https://api.deepl.com/v2/translate');
        for (const value of ['free', undefined, null, '', 'PRO', 'paid', 1, {}, []]) {
            expect(normalizeDeepLApiPlan(value)).toBe('free');
            expect(getDeepLEndpoint(value)).toBe('https://api-free.deepl.com/v2/translate');
        }
    });

    it('去掉代理外围空白，无效或空白代理回到所选官方端点', () => {
        expect(getDeepLEndpoint('free', '  https://proxy.example/translate  '))
            .toBe('https://proxy.example/translate');
        for (const proxy of [undefined, null, '', '  ', 1, {}, []]) {
            expect(getDeepLEndpoint('pro', proxy)).toBe(DEEPL_API_ENDPOINTS.pro);
        }
    });
});

describe('DeepL adapter', () => {
    it.each([
        [undefined, 'https://api-free.deepl.com/v2/translate'],
        ['free', 'https://api-free.deepl.com/v2/translate'],
        ['pro', 'https://api.deepl.com/v2/translate'],
    ] as const)('按所选套餐 %s 发送到正确端点并保留 API 鉴权和上下文', async (plan, endpoint) => {
        mockConfig.deeplApiPlan = plan;
        const controller = new AbortController();

        await expect(deepl({origin: 'Hello', context: 'Article title', abortSignal: controller.signal}))
            .resolves.toBe('你好');

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0]?.[0]).toBe(endpoint);
        const init = fetchMock.mock.calls[0]?.[1];
        expect(init).toMatchObject({method: 'POST', signal: controller.signal});
        expect(init?.headers).toEqual({
            'Content-Type': 'application/json',
            Authorization: 'DeepL-Auth-Key test-key',
        });
        expect(JSON.parse(String(init?.body))).toEqual({
            text: ['Hello'], target_lang: 'zh', tag_handling: 'html',
            context: 'Article title', preserve_formatting: true,
        });
    });

    it.each(['free', 'pro'] as const)('自定义代理优先于 %s 套餐的官方端点', async (plan) => {
        mockConfig.deeplApiPlan = plan;
        mockConfig.proxy.deepL = '  https://proxy.example/translate  ';
        await deepl({origin: 'Hello'});
        expect(fetchMock.mock.calls[0]?.[0]).toBe('https://proxy.example/translate');
    });

    it('空白代理仍使用所选 Pro 官方端点', async () => {
        mockConfig.deeplApiPlan = 'pro';
        mockConfig.proxy.deepL = '  ';
        await deepl({origin: 'Hello'});
        expect(fetchMock.mock.calls[0]?.[0]).toBe(DEEPL_API_ENDPOINTS.pro);
    });

    it('服务覆盖和已冻结套餐不受全局设置后续修改影响', async () => {
        const source = Object.assign(new Config(), {
            service: 'microsoft', deeplApiPlan: 'free', token: {deepL: 'frozen-key'},
        });
        const request = attachTranslationProviderConfig({
            origin: 'Hello', serviceOverride: 'deepL', targetLanguage: 'de',
        }, createTranslationProviderConfigSnapshot(source));
        source.deeplApiPlan = 'pro';
        source.token.deepL = 'new-key';
        mockConfig.deeplApiPlan = 'pro';
        mockConfig.token.deepL = 'global-key';
        mockConfig.proxy.deepL = 'https://new-proxy.example/translate';

        await deepl(request);

        expect(fetchMock.mock.calls[0]?.[0]).toBe(DEEPL_API_ENDPOINTS.free);
        expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
            Authorization: 'DeepL-Auth-Key frozen-key',
        });
        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).target_lang).toBe('de');
    });

    it('付费 API 的 HTTP 错误沿用既有错误处理', async () => {
        mockConfig.deeplApiPlan = 'pro';
        fetchMock.mockResolvedValue(new Response('Forbidden', {status: 403}));

        await expect(deepl({origin: 'Hello'})).rejects.toThrow('403');
    });
});
