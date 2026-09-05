import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const {config} = vi.hoisted(() => ({config: {} as Record<string, any>}));
vi.mock('@/src/services/config/store', () => ({config}));
import microsoft from '@/src/providers/translation/microsoft';
import tencent from '@/src/providers/translation/tencent';
import hunyuan from '@/src/providers/translation/hunyuan-translation';
import youdao from '@/src/providers/translation/youdao';
import xiaoniu from '@/src/providers/translation/xiaoniu';
import {Config} from '@/src/core/config/model';
import {services} from '@/src/core/config/catalog';

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
    Object.assign(config, new Config(), {
        from: 'auto', to: 'zh-Hans',
        tencentSecretId: 'test-secret-id', tencentSecretKey: 'test-secret-key',
        youdaoAppKey: 'test-app-key', youdaoAppSecret: 'test-app-secret',
    });
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const providers = [
    {name: 'Microsoft', service: services.microsoft, run: microsoft, hans: 'zh-Hans', hant: 'zh-Hant', response: [{translations: [{text: 'result'}]}], read: (url: unknown, _body: string) => ({source: new URL(String(url)).searchParams.get('from'), target: new URL(String(url)).searchParams.get('to')})},
    {name: 'Tencent', service: services.tencent, run: tencent, hans: 'zh', hant: 'zh-TW', response: {Response: {TargetText: 'result'}}, read: (_url: unknown, body: string) => ({source: JSON.parse(body).Source, target: JSON.parse(body).Target})},
    {name: 'Hunyuan', service: services.huanYuanTranslation, run: hunyuan, hans: 'zh', hant: 'zh-TR', response: {Response: {Choices: [{Message: {Content: 'result'}}]}}, read: (_url: unknown, body: string) => ({target: JSON.parse(body).Target})},
    {name: 'Youdao', service: services.youdao, run: youdao, hans: 'zh-CHS', hant: 'zh-CHT', response: {errorCode: '0', translation: ['result']}, read: (_url: unknown, body: string) => ({source: new URLSearchParams(body).get('from'), target: new URLSearchParams(body).get('to')})},
    {name: 'NiuTrans', service: services.xiaoniu, run: xiaoniu, hans: 'zh', hant: 'cht', response: {tgt_text: 'result'}, read: (_url: unknown, body: string) => ({source: new URLSearchParams(body).get('from'), target: new URLSearchParams(body).get('to')})},
];

describe('中文书写系统到实际供应商协议的端到端映射', () => {
    describe.each(providers)('$name 中文脚本协议', (provider) => {
        it.each([
            ['en', 'zh-Hans', 'hans'], ['en', 'zh-TW', 'hant'],
            ['zh-Hans', 'zh-Hant', 'hant'], ['zh-Hant', 'zh-Hans', 'hans'],
        ])('请求 %s → %s 保留目标书写系统', async (sourceLanguage, targetLanguage, script) => {
            config.service = provider.service;
            fetchMock.mockResolvedValue(new Response(JSON.stringify(provider.response)));
            await expect(provider.run({origin: '翻譯测试', sourceLanguage, targetLanguage})).resolves.toBe('result');
            expect(fetchMock).toHaveBeenCalledOnce();
            const [url, init] = fetchMock.mock.calls[0]!;
            const languages = provider.read(url, String(init?.body));
            expect(languages.target).toBe(script === 'hans' ? provider.hans : provider.hant);
            if ('source' in languages) {
                expect(languages.source).toBe(sourceLanguage === 'zh-Hans' ? provider.hans : sourceLanguage === 'zh-Hant' ? provider.hant : 'en');
            }
        });
        it('保留繁体源语言向英语请求', async () => {
            config.service = provider.service;
            fetchMock.mockResolvedValue(new Response(JSON.stringify(provider.response)));
            await provider.run({origin: '這是翻譯測試', sourceLanguage: 'zh-HK', targetLanguage: 'en'});
            const [url, init] = fetchMock.mock.calls[0]!;
            const languages = provider.read(url, String(init?.body));
            expect(languages.target).toBe('en');
            if ('source' in languages) expect(languages.source).toBe(provider.hant);
        });
    });

    it('混元自动识别繁体后仍将繁转简发往翻译服务，不错误短路', async () => {
        config.service = services.huanYuanTranslation;
        fetchMock.mockResolvedValue(new Response(JSON.stringify(providers[2]!.response)));
        await expect(hunyuan({origin: '這是一段需要翻譯的繁體中文測試。', sourceLanguage: 'auto', targetLanguage: 'zh-Hans'})).resolves.toBe('result');
        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).Target).toBe('zh');
    });

    it('混元明确同一繁体书写系统保持原文', async () => {
        config.service = services.huanYuanTranslation;
        await expect(hunyuan({origin: '繁體中文', sourceLanguage: 'zh-Hant', targetLanguage: 'zh-TW'})).resolves.toBe('繁體中文');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('有道不再把未列出语言静默替换成简体中文', async () => {
        config.service = services.youdao;
        fetchMock.mockResolvedValue(new Response(JSON.stringify(providers[3]!.response)));
        await youdao({origin: 'hello', sourceLanguage: 'en', targetLanguage: 'eo'});
        expect(new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body)).get('to')).toBe('eo');
    });
});
