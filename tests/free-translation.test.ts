import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {mockConfig, storedHealth, microsoftMock, officialMock, googleMock, myMemoryMock, webMock, chineseMock, extraMock} = vi.hoisted(() => ({
    mockConfig: {} as Record<string, any>,
    storedHealth: {records: null as unknown},
    microsoftMock: vi.fn(),
    officialMock: vi.fn(),
    googleMock: vi.fn(),
    myMemoryMock: vi.fn(),
    webMock: vi.fn(),
    chineseMock: vi.fn(),
    extraMock: vi.fn(),
}));
vi.mock('@/src/platform/storage/freeTranslationHealthStorage', () => ({freeTranslationHealthStorage: {load: async () => storedHealth.records, save: async () => undefined}}));
vi.mock('@/src/services/config/store', () => ({config: mockConfig}));
vi.mock('@/src/providers/translation/microsoft', () => ({translateMicrosoftTexts: microsoftMock}));
vi.mock('@/src/providers/translation/free-official-web', () => ({translateOfficialFreeWebProvider: officialMock}));
vi.mock('@/src/providers/translation/google', () => ({translateGoogleText: googleMock}));
vi.mock('@/src/providers/translation/mymemory', () => ({default: myMemoryMock}));
vi.mock('@/src/providers/translation/free-web', () => ({translateFreeWebText: webMock}));
vi.mock('@/src/providers/translation/free-chinese-web', () => ({translateFreeChineseWebText: chineseMock}));
vi.mock('@/src/providers/translation/free-extra-web', () => ({translateExtraFreeWebText: extraMock}));

import type {TranslationConfigSource} from '@/src/services/translation/types';
import {DEFAULT_DEEPLX_ENDPOINT} from '@/src/core/config/deeplx';
import {FREE_TRANSLATION_PROVIDERS} from '@/src/core/config/freeTranslation';

let freeTranslation: typeof import('@/src/providers/translation/free-translation').default;
let FREE_TRANSLATION_BATCH_CONCURRENCY: number;
let getFreeTranslationWeightSnapshot: typeof import('@/src/providers/translation/free-translation').getFreeTranslationWeightSnapshot;
let translateFreeTranslationProvider: typeof import('@/src/providers/translation/free-translation').translateFreeTranslationProvider;
let attachTranslationProviderConfig: typeof import('@/src/services/translation/requestSnapshot').attachTranslationProviderConfig;
let createTranslationProviderConfigSnapshot: typeof import('@/src/services/translation/requestSnapshot').createTranslationProviderConfigSnapshot;
let getTranslationProviderConfig: typeof import('@/src/services/translation/requestSnapshot').getTranslationProviderConfig;
const translateFreeText = (text: string, message: Record<string, unknown> = {}) => (
    freeTranslation({...message, origin: text}) as Promise<string>
);
const flush = async () => { await vi.advanceTimersByTimeAsync(0); };
async function settle<T>(request: Promise<T>): Promise<T> {
    let done = false;
    void request.then(() => {done = true;}, () => {done = true;});
    for (let step = 0; step < 200 && !done; step += 1) await vi.advanceTimersByTimeAsync(50);
    return request;
}
const httpFailure = (statusCode = 503) => Object.assign(new Error('private original and token'), {statusCode});
const readSnapshot = (message: object) => getTranslationProviderConfig(message, mockConfig as never);

beforeEach(async () => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T00:00:00Z'));
    storedHealth.records = null;
    for (const key of Object.keys(mockConfig)) delete mockConfig[key];
    Object.assign(mockConfig, {
        service: 'freeTranslation', from: 'auto', to: 'zh-Hans',
        token: {}, proxy: {}, model: {}, customModel: {},
        freeTranslationTimeoutMs: 1_000, freeTranslationCooldownMs: 1_000,
        freeTranslationMode: 'sequential',
        freeTranslationOrder: ['microsoft', 'alibabaFree', 'google', 'myMemory'],
        myMemoryEmail: '', deeplx: 'https://deeplx.example/translate',
    });
    for (const mock of [microsoftMock, officialMock, googleMock, myMemoryMock, chineseMock, extraMock]) {
        mock.mockRejectedValue(httpFailure());
    }
    ({default: freeTranslation, FREE_TRANSLATION_BATCH_CONCURRENCY, getFreeTranslationWeightSnapshot, translateFreeTranslationProvider}
        = await import('@/src/providers/translation/free-translation'));
    ({attachTranslationProviderConfig, createTranslationProviderConfigSnapshot, getTranslationProviderConfig}
        = await import('@/src/services/translation/requestSnapshot'));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('免费翻译服务', () => {
    it.each(FREE_TRANSLATION_PROVIDERS)('单服务检查直接使用 $id 匿名适配器，即使没有开启', async ({id}) => {
        mockConfig.freeTranslationOrder = ['microsoft'];
        microsoftMock.mockResolvedValue(['有效译文']);
        for (const mock of [officialMock, googleMock, myMemoryMock, webMock, chineseMock, extraMock]) mock.mockResolvedValue('有效译文');
        await expect(translateFreeTranslationProvider(id, {origin: 'Hello from FluentRead.', sourceLanguage: 'en', targetLanguage: 'zh-Hans'})).resolves.toBe('有效译文');
        const calls = [microsoftMock, officialMock, googleMock, myMemoryMock, webMock, chineseMock, extraMock].reduce((total, mock) => total + mock.mock.calls.length, 0);
        expect(calls).toBe(1);
        const families = {transmart: webMock, yandexFree: webMock, volcengineFree: webMock, youdaoFree: chineseMock, icibaFree: chineseMock,
            sogouFree: extraMock, reversoFree: extraMock, apertiumFree: extraMock};
        if (id in families) expect(families[id as keyof typeof families]).toHaveBeenCalledWith(id, 'Hello from FluentRead.', 'en', 'zh-Hans', undefined);
        if (['alibabaFree', 'modernMtFree', 'laraFree', 'lingvanexFree'].includes(id)) expect(officialMock).toHaveBeenCalledWith(id, expect.objectContaining({origin: 'Hello from FluentRead.', sourceLanguage: 'en', targetLanguage: 'zh-Hans'}));
        expect(mockConfig.freeTranslationOrder).toEqual(['microsoft']);
    });

    it('单服务检查保留匿名边界和结果验证，失败或原文回显不会自动换线', async () => {
        mockConfig.token = {deeplx: 'saved-private-key'};
        mockConfig.proxy = {deeplx: 'https://private.example'};
        mockConfig.deeplx = 'https://private.example/translate';
        officialMock.mockResolvedValueOnce('有效译文');
        await translateFreeTranslationProvider('alibabaFree', {origin: 'Hello from FluentRead.', sourceLanguage: 'en', targetLanguage: 'zh-Hans'});
        const snapshot = getTranslationProviderConfig(officialMock.mock.calls[0][1], mockConfig as any);
        expect(snapshot.token).toEqual({});
        expect(snapshot.proxy).toEqual({});
        expect(snapshot.deeplx).toBe(DEFAULT_DEEPLX_ENDPOINT);
        microsoftMock.mockResolvedValue(['备用译文']);
        officialMock.mockRejectedValueOnce(new Error('服务不可用'));
        await expect(translateFreeTranslationProvider('alibabaFree', {origin: 'Hello', targetLanguage: 'zh-Hans'})).rejects.toThrow('服务不可用');
        const echoed = 'The software translates this paragraph with a fast backup when the first service is slow.';
        officialMock.mockResolvedValueOnce(echoed);
        await expect(translateFreeTranslationProvider('alibabaFree', {origin: echoed, targetLanguage: 'zh-Hans'})).rejects.toThrow();
        await expect(translateFreeTranslationProvider('unknown', {origin: 'Hello'})).rejects.toThrow('无效的免费翻译服务');
        expect(microsoftMock).not.toHaveBeenCalled();
    });
    it('保留微软、阿里翻译、谷歌优先顺序并新增 MyMemory 官方后备', async () => {
        mockConfig.freeTranslationOrder = ['microsoft', 'alibabaFree', 'google', 'myMemory'];
        const calls: string[] = [];
        microsoftMock.mockImplementation(async () => { calls.push('microsoft'); throw httpFailure(); });
        officialMock.mockImplementation(async () => { calls.push('alibabaFree'); throw httpFailure(); });
        googleMock.mockImplementation(async () => { calls.push('google'); throw httpFailure(); });
        myMemoryMock.mockImplementation(async () => { calls.push('myMemory'); return '官方译文'; });
        await expect(settle(translateFreeText('Hello'))).resolves.toBe('官方译文');
        expect(calls).toEqual(['microsoft', 'alibabaFree', 'google', 'myMemory']);
        expect(microsoftMock).toHaveBeenCalledWith(['Hello'], 'auto', 'zh-Hans', expect.any(AbortSignal));
        expect(officialMock).toHaveBeenCalledWith('alibabaFree', expect.objectContaining({origin: 'Hello', sourceLanguage: 'auto', targetLanguage: 'zh-Hans'}));
        expect(myMemoryMock).toHaveBeenCalledWith(expect.objectContaining({origin: 'Hello', serviceOverride: 'myMemory', abortSignal: expect.any(AbortSignal)}));
    });

    it('每次线路尝试上报免费服务标识、结果、耗时与文本长度', async () => {
        const {attachTranslationRouteObserver} = await import('@/src/services/translation/requestSnapshot');
        const observations: Array<Record<string, unknown>> = [];
        microsoftMock.mockRejectedValue(httpFailure());
        officialMock.mockResolvedValue('阿里翻译 译文');
        const message = attachTranslationRouteObserver({origin: 'Hello route'}, observation => observations.push({...observation}));

        await expect(settle(freeTranslation(message) as Promise<string>)).resolves.toBe('阿里翻译 译文');

        expect(observations).toEqual([
            {route: 'microsoft', outcome: 'error', durationMs: expect.any(Number), chars: 11},
            {route: 'alibabaFree', outcome: 'success', durationMs: expect.any(Number), chars: 11},
        ]);
    });

    it('首个服务成功即返回，不会外发给后续服务', async () => {
        microsoftMock.mockResolvedValue(['微软译文']);
        await expect(settle(freeTranslation({origin: 'Hello'}))).resolves.toBe('微软译文');
        expect(microsoftMock).toHaveBeenCalledOnce();
        expect(officialMock).not.toHaveBeenCalled();
        expect(myMemoryMock).not.toHaveBeenCalled();
    });

    it('图片裸网址原样返回时不轮询后备服务或报免费线路全部失败', async () => {
        const url = 'docs.sglang.io/cookbook';
        microsoftMock.mockResolvedValue([url]);
        await expect(settle(freeTranslation({origin: [url]}))).resolves.toEqual([url]);
        expect(microsoftMock).toHaveBeenCalledOnce();
        expect(officialMock).not.toHaveBeenCalled();
        expect(googleMock).not.toHaveBeenCalled();
        expect(myMemoryMock).not.toHaveBeenCalled();
    });

    it('中文目标遇到整段日文时换线，后续段落仍可使用原线路', async () => {
        mockConfig.freeTranslationOrder = ['microsoft', 'alibabaFree'];
        const japanese = 'このファイルの最初の文字にも制限があります。簡単にするために、最初の文字として文字を使用できます。';
        microsoftMock.mockResolvedValueOnce([japanese]).mockResolvedValueOnce(['下一段的中文译文']);
        officialMock.mockResolvedValue('这个文件的首字母也有限制。');
        const origin = 'There are also restrictions on the first character of this file.';

        await expect(settle(translateFreeText(origin))).resolves.toBe('这个文件的首字母也有限制。');
        await expect(settle(translateFreeText('The next paragraph has different text.'))).resolves.toBe('下一段的中文译文');
        expect(microsoftMock).toHaveBeenCalledTimes(2);
        expect(officialMock).toHaveBeenCalledOnce();
    });

    it('英文标签列表被线路原样返回时换用后备服务，且不把该线路全局冷却', async () => {
        mockConfig.freeTranslationOrder = ['microsoft', 'alibabaFree'];
        const tags = 'solo, blush, smile, bangs, looking_at_viewer, long_hair, blue_eyes';
        microsoftMock.mockImplementation(async ([text]) => [text]);
        officialMock.mockResolvedValue('单人，脸红，微笑，刘海，看向观众，长发，蓝眼睛');

        await expect(settle(translateFreeText(tags))).resolves.toBe('单人，脸红，微笑，刘海，看向观众，长发，蓝眼睛');
        await expect(settle(translateFreeText('solo, blush, smile, bangs, long_hair, blue_eyes, white_dress')))
            .resolves.toBe('单人，脸红，微笑，刘海，看向观众，长发，蓝眼睛');
        expect(microsoftMock).toHaveBeenCalledTimes(2);
        expect(officialMock).toHaveBeenCalledTimes(2);
    });

    it('短英文标题被线路原样返回时换用后备服务', async () => {
        mockConfig.freeTranslationOrder = ['transmart', 'google'];
        webMock.mockResolvedValue('Frontend Developer');
        googleMock.mockResolvedValue('前端开发者');

        await expect(settle(translateFreeText('Frontend Developer'))).resolves.toBe('前端开发者');
        expect(webMock).toHaveBeenCalledWith('transmart', 'Frontend Developer', 'auto', 'zh-Hans', expect.any(AbortSignal));
        expect(googleMock).toHaveBeenCalledOnce();
    });

    it('保存顺序里的有 Key 服务全部剔除，仅按所选免密钥服务翻译', async () => {
        mockConfig.freeTranslationOrder = ['azureTranslator', 'deepL', 'openai', 'custom:key-provider', 'myMemory', 'microsoft'];
        mockConfig.token = {azureTranslator: 'configured-key', deepL: 'free-key:fx', openai: 'secret-key'};
        myMemoryMock.mockResolvedValue('MyMemory');
        await expect(settle(translateFreeText('Hello'))).resolves.toBe('MyMemory');
        expect(microsoftMock).not.toHaveBeenCalled();
        expect(officialMock).not.toHaveBeenCalled();
        expect(readSnapshot(myMemoryMock.mock.calls[0][0]).freeTranslationOrder).toEqual(['myMemory', 'microsoft']);
        expect(readSnapshot(myMemoryMock.mock.calls[0][0]).token).toEqual({});
    });

    it('旧设置只保存有 Key 服务时回到匿名默认链，历史 Key 不影响选择', async () => {
        mockConfig.freeTranslationOrder = ['azureTranslator', 'deepL'];
        mockConfig.token = {azureTranslator: 'configured-key', deepL: 'free-key:fx'};
        myMemoryMock.mockResolvedValue('备用');
        await expect(settle(translateFreeText('Hello'))).resolves.toBe('备用');
        expect(readSnapshot(myMemoryMock.mock.calls[0][0]).freeTranslationOrder).toEqual(['microsoft', 'transmart', 'volcengineFree', 'google', 'youdaoFree', 'icibaFree', 'yandexFree', 'myMemory', 'sogouFree', 'reversoFree', 'apertiumFree', 'alibabaFree', 'modernMtFree', 'laraFree', 'lingvanexFree']);
    });

    it('上游挂起时局部超时继续降级，下一段跳过正在冷却的上游', async () => {
        microsoftMock.mockImplementation(() => new Promise(() => {}));
        officialMock.mockResolvedValue('备用');
        const first = translateFreeText('Hello');
        await vi.advanceTimersByTimeAsync(1_000);
        await expect(first).resolves.toBe('备用');
        // 冷却时长带抖动，且到期后允许再次探测；断言必须落在冷却窗口内，
        // 否则 settle 推进的时钟可能越过冷却终点，把合法探测当成未跳过。
        const second = translateFreeText('World');
        await vi.advanceTimersByTimeAsync(900);
        expect(microsoftMock).toHaveBeenCalledOnce();
        await expect(settle(second)).resolves.toBe('备用');
        expect(microsoftMock.mock.calls[0][3].aborted).toBe(true);
    });

    it('返回空译文时继续降级，全部失败只汇总安全原因', async () => {
        microsoftMock.mockResolvedValue(['']);
        googleMock.mockRejectedValue(httpFailure(429));
        const request = translateFreeText('private source text');
        await expect(request).rejects.toThrow('微软翻译: 未返回有效译文；阿里翻译: HTTP 503；谷歌翻译: HTTP 429；MyMemory: HTTP 503');
        await expect(request).rejects.not.toThrow('private');
    });

    it('请求启动后修改全局顺序、语言、凭据和端点不影响在途降级', async () => {
        let rejectFirst!: (error: Error) => void;
        microsoftMock.mockImplementation(() => new Promise((_resolve, reject) => { rejectFirst = reject; }));
        officialMock.mockResolvedValue('原配置译文');
        mockConfig.token.deeplx = 'original-key';
        mockConfig.freeTranslationOrder = ['microsoft', 'alibabaFree'];
        const request = translateFreeText('Hello');
        await flush();
        mockConfig.token.deeplx = 'new-key';
        mockConfig.deeplx = 'https://new.example/translate';
        mockConfig.from = 'ja';
        mockConfig.to = 'fr';
        mockConfig.freeTranslationOrder.splice(0, 2, 'google');
        rejectFirst(httpFailure());
        await expect(request).resolves.toBe('原配置译文');
        const fallbackRequest = officialMock.mock.calls[0][1];
        expect(fallbackRequest).toMatchObject({sourceLanguage: 'auto', targetLanguage: 'zh-Hans'});
        expect(readSnapshot(fallbackRequest)).toMatchObject({
            token: {}, proxy: {}, deeplx: DEFAULT_DEEPLX_ENDPOINT,
            freeTranslationOrder: ['microsoft', 'alibabaFree'],
        });
        expect(Object.isFrozen(readSnapshot(fallbackRequest).freeTranslationOrder)).toBe(true);
        expect(googleMock).not.toHaveBeenCalled();
    });

    it('broker 附带的配置快照优先于已经变化的全局设置', async () => {
        mockConfig.freeTranslationOrder = ['myMemory'];
        mockConfig.myMemoryEmail = 'old@example.com';
        const snapshot = createTranslationProviderConfigSnapshot(mockConfig as TranslationConfigSource);
        const message = attachTranslationProviderConfig({origin: 'Hello', targetLanguage: 'ja'}, snapshot);
        mockConfig.freeTranslationOrder = ['google'];
        mockConfig.myMemoryEmail = 'new@example.com';
        myMemoryMock.mockResolvedValue('冻结译文');
        await expect(settle(freeTranslation(message))).resolves.toBe('冻结译文');
        expect(readSnapshot(myMemoryMock.mock.calls[0][0]).myMemoryEmail).toBe('old@example.com');
        expect(myMemoryMock.mock.calls[0][0].targetLanguage).toBe('ja');
        expect(googleMock).not.toHaveBeenCalled();
    });

    it('被官方接口忽略的残留 proxy 不影响配额冷却身份', async () => {
        mockConfig.freeTranslationOrder = ['myMemory', 'google'];
        googleMock.mockResolvedValue('备用');
        myMemoryMock.mockRejectedValue(httpFailure(429));
        await expect(settle(translateFreeText('one'))).resolves.toBe('备用');
        mockConfig.proxy.myMemory = 'https://other.example/memory';
        await expect(settle(translateFreeText('two'))).resolves.toBe('备用');
        expect(myMemoryMock).toHaveBeenCalledOnce();
    });

    it('更换 MyMemory 邮箱不继承旧匿名/邮箱额度冷却', async () => {
        mockConfig.freeTranslationOrder = ['myMemory', 'google'];
        myMemoryMock.mockRejectedValueOnce(httpFailure(429)).mockResolvedValue('新邮箱译文');
        googleMock.mockResolvedValue('备用');
        await expect(settle(translateFreeText('one'))).resolves.toBe('备用');
        mockConfig.myMemoryEmail = 'new@example.com';
        await expect(settle(translateFreeText('two'))).resolves.toBe('新邮箱译文');
        expect(myMemoryMock).toHaveBeenCalledTimes(2);
    });

    it.each(['token', 'endpoint', 'proxy'])('更换独立 阿里翻译 的%s 不改变免费链的匿名连接或冷却状态', async changed => {
        mockConfig.freeTranslationOrder = ['alibabaFree', 'google'];
        mockConfig.token.deeplx = 'old-key';
        officialMock.mockRejectedValue(httpFailure(429));
        googleMock.mockResolvedValue('备用');
        await expect(settle(translateFreeText('one'))).resolves.toBe('备用');
        await expect(settle(translateFreeText('two'))).resolves.toBe('备用');
        if (changed === 'token') mockConfig.token.deeplx = 'new-key';
        else if (changed === 'endpoint') mockConfig.deeplx = 'https://new.example/translate';
        else mockConfig.proxy.deeplx = 'https://proxy.example/translate';
        await expect(settle(translateFreeText('three'))).resolves.toBe('备用');
        expect(officialMock).toHaveBeenCalledOnce();
    });

    it('已保存的 阿里翻译 代理及默认地址都不会绕过匿名公共接口的冷却', async () => {
        mockConfig.freeTranslationOrder = ['alibabaFree', 'google'];
        mockConfig.proxy.deeplx = 'https://active.example/translate';
        officialMock.mockRejectedValue(httpFailure(429));
        googleMock.mockResolvedValue('备用');
        await expect(settle(translateFreeText('one'))).resolves.toBe('备用');
        mockConfig.deeplx = 'https://unused.example/translate';
        await expect(settle(translateFreeText('two'))).resolves.toBe('备用');
        expect(officialMock).toHaveBeenCalledOnce();
    });

    it.each(['deeplx', 'lingvaFree'])('第三方旧节点 %s 不会参与检查或已保存的免费顺序', async id => {
        mockConfig.freeTranslationOrder = [id, 'google'];
        googleMock.mockResolvedValue('官方译文');
        await expect(settle(translateFreeText('Hello'))).resolves.toBe('官方译文');
        await expect(translateFreeTranslationProvider(id, {origin: 'Hello'})).rejects.toThrow('无效的免费翻译服务');
        expect(officialMock).not.toHaveBeenCalled();
    });

    it('single-provider batches respect Microsoft concurrency and spacing while preserving output order', async () => {
        mockConfig.freeTranslationOrder = ['microsoft'];
        const pending: Array<{text: string; resolve: (value: string[]) => void}> = [];
        let active = 0;
        let maximum = 0;
        microsoftMock.mockImplementation(([text]: [string]) => new Promise<string[]>(resolve => {
            active += 1;
            maximum = Math.max(maximum, active);
            pending.push({text, resolve: value => { active -= 1; resolve(value); }});
        }));
        const request = freeTranslation({origin: ['A', 'B', 'C', 'D', 'E', 'F']});
        await flush();
        expect(pending).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(100);
        expect(pending).toHaveLength(2);
        pending[1].resolve(['译:B']);
        await vi.advanceTimersByTimeAsync(100);
        expect(pending).toHaveLength(3);
        pending[0].resolve(['译:A']);
        await vi.advanceTimersByTimeAsync(100);
        pending[3].resolve(['译:D']);
        await vi.advanceTimersByTimeAsync(100);
        pending[2].resolve(['译:C']);
        await vi.advanceTimersByTimeAsync(100);
        pending[5].resolve(['译:F']);
        pending[4].resolve(['译:E']);
        await expect(request).resolves.toEqual(['译:A', '译:B', '译:C', '译:D', '译:E', '译:F']);
        expect(maximum).toBe(2);
        expect(FREE_TRANSLATION_BATCH_CONCURRENCY).toBe(6);
    });

    it('a shared batch deadline includes pacing and prevents later segments starting', async () => {
        mockConfig.freeTranslationOrder = ['microsoft'];
        const pending: Array<(value: string[]) => void> = [];
        microsoftMock.mockImplementation(() => new Promise<string[]>(resolve => { pending.push(resolve); }));
        const request = freeTranslation({origin: ['A', 'B', 'C', 'D', 'E'], requestTimeoutMs: 500});
        const assertion = expect(request).rejects.toThrow('请求超时');
        await vi.advanceTimersByTimeAsync(300);
        expect(microsoftMock).toHaveBeenCalledTimes(2);
        pending[0](['译:A']);
        await flush();
        expect(microsoftMock).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(200);
        await assertion;
        expect(microsoftMock).toHaveBeenCalledTimes(3);
        expect(officialMock).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('批量遇限流后后续段跳过失败服务，保序翻译', async () => {
        microsoftMock.mockRejectedValue(httpFailure(429));
        officialMock.mockImplementation(async (_id: string, request: {origin: string}) => `译:${request.origin}`);
        await expect(settle(freeTranslation({origin: ['A', 'B', 'C', 'D', 'E']}))).resolves.toEqual(['译:A', '译:B', '译:C', '译:D', '译:E']);
        expect(microsoftMock).toHaveBeenCalledTimes(1);
        expect(officialMock).toHaveBeenCalledTimes(5);
    });

    it('调用方取消中止所有在途 worker，不启动未领取段落、不继续降级', async () => {
        mockConfig.freeTranslationOrder = ['microsoft'];
        const controller = new AbortController();
        microsoftMock.mockImplementation(() => new Promise(() => {}));
        const request = freeTranslation({origin: ['A', 'B', 'C', 'D', 'E'], abortSignal: controller.signal});
        const assertion = expect(request).rejects.toThrow('用户取消');
        await vi.advanceTimersByTimeAsync(100);
        controller.abort(new Error('用户取消'));
        await assertion;
        expect(microsoftMock).toHaveBeenCalledTimes(2);
        expect(microsoftMock.mock.calls.every(call => call[3].aborted)).toBe(true);
        expect(officialMock).not.toHaveBeenCalled();
        microsoftMock.mockResolvedValue(['恢复']);
        await expect(settle(translateFreeText('next'))).resolves.toBe('恢复');
    });

    it('任一文本耗尽所有备用后取消 sibling，避免余下请求继续外发', async () => {
        microsoftMock.mockImplementation(([text]: [string]) => text === 'bad' ? Promise.reject(httpFailure()) : new Promise(() => {}));
        await expect(settle(freeTranslation({origin: ['bad', 'slow-1', 'slow-2', 'not-started']}))).rejects.toThrow('免费翻译服务均不可用');
        expect(microsoftMock).toHaveBeenCalledTimes(1);
        expect(microsoftMock.mock.calls.slice(1).every(call => call[3].aborted)).toBe(true);
        expect(officialMock).toHaveBeenCalledOnce();
        expect(googleMock).toHaveBeenCalledOnce();
        expect(myMemoryMock).toHaveBeenCalledOnce();
    });

    it.each(['single', 'batch'])('预先取消的%s消息不启动任何服务', async kind => {
        const controller = new AbortController();
        controller.abort('stop');
        await expect(freeTranslation({origin: kind === 'batch' ? ['Hello'] : 'Hello', abortSignal: controller.signal}))
            .rejects.toMatchObject({name: 'AbortError'});
        expect(microsoftMock).not.toHaveBeenCalled();
    });

    it.each([{sourceLanguage: 'en'}, {targetLanguage: 'ja'}])('显式语言覆盖传入每个备用 provider %#', async languages => {
        officialMock.mockResolvedValue('译文');
        await expect(settle(translateFreeText('Hello', languages))).resolves.toBe('译文');
        expect(officialMock.mock.calls[0][1]).toMatchObject(languages);
    });

    it('空批量直接返回并拒绝非文本输入', async () => {
        await expect(settle(freeTranslation({origin: []}))).resolves.toEqual([]);
        await expect(settle(freeTranslation({origin: [42 as unknown as string]}))).rejects.toThrow('仅支持文本输入');
        await expect(settle(freeTranslation({origin: 42 as unknown as string}))).rejects.toThrow('仅支持文本输入');
        expect(microsoftMock).not.toHaveBeenCalled();
    });
});

it.each(['transmart', 'yandexFree', 'volcengineFree'])('routes %s only via free policy with request language and cancellation', async id => {
    mockConfig.freeTranslationOrder = [id];
    webMock.mockResolvedValue('新译文');
    const abort = new AbortController();
    await expect(settle(translateFreeText('Hello', {sourceLanguage: 'en', targetLanguage: 'zh-Hant', abortSignal: abort.signal}))).resolves.toBe('新译文');
    expect(webMock).toHaveBeenCalledWith(id, 'Hello', 'en', 'zh-Hant', expect.any(AbortSignal));
});
it('maps background health to the enabled services of the current settings for the weight snapshot', async () => {
    mockConfig.freeTranslationMode = 'balanced';
    mockConfig.freeTranslationOrder = ['microsoft', 'google', 'myMemory'];
    mockConfig.myMemoryEmail = 'old@example.com';
    microsoftMock.mockRejectedValue(httpFailure(503));
    googleMock.mockRejectedValue(httpFailure(413));
    myMemoryMock.mockResolvedValue('MyMemory 译文');
    await expect(settle(translateFreeText('Hello'))).resolves.toBe('MyMemory 译文');

    const snapshot = await getFreeTranslationWeightSnapshot(Date.now());
    const byId = new Map(snapshot.entries.map(entry => [entry.providerId, entry]));
    expect(snapshot.total).toBe(100);
    expect(byId.get('microsoft')).toMatchObject({weight: 0, status: 'cooling'});
    // 文本级 413 不产生健康记录，谷歌仍按默认权重参与分配。
    expect(byId.get('google')).toMatchObject({status: 'ready'});
    expect(byId.get('google')!.weight).toBeGreaterThan(0);
    expect(byId.get('myMemory')).toMatchObject({status: 'ready'});
    expect(byId.get('alibabaFree')).toMatchObject({weight: 0, status: 'disabled'});
    expect(JSON.stringify(snapshot)).not.toMatch(/[a-f0-9]{64}|old@example\.com/u);

    // MyMemory 邮箱属于连接身份；换邮箱后不能把旧身份的健康记录展示给新配置。
    mockConfig.freeTranslationOrder = ['microsoft', 'myMemory'];
    mockConfig.myMemoryEmail = 'new@example.com';
    const changed = await getFreeTranslationWeightSnapshot(Date.now());
    expect(changed.entries.find(entry => entry.providerId === 'google')).toMatchObject({weight: 0, status: 'disabled'});
    expect(changed.entries.find(entry => entry.providerId === 'myMemory')).toMatchObject({weight: 100, status: 'ready'});
});

it('shows a persisted legacy cooling record without performance data after a background restart', async () => {
    const {default: sha256} = await import('crypto-js/sha256');
    const retryAt = Date.now() + 60_000;
    storedHealth.records = [{identity: `google:${sha256(JSON.stringify(['google'])).toString()}`, retryAt, failures: 2, category: 'blocked'}];
    mockConfig.freeTranslationOrder = ['microsoft', 'google'];

    const snapshot = await getFreeTranslationWeightSnapshot(Date.now());
    expect(snapshot.entries.find(entry => entry.providerId === 'google')).toEqual({providerId: 'google', weight: 0, status: 'cooling', retryAt});
    expect(snapshot.entries.find(entry => entry.providerId === 'microsoft')).toMatchObject({weight: 100, status: 'ready'});
});

it('falls back and cools down a failed new route while keeping language errors request-local', async () => {
    mockConfig.freeTranslationOrder = ['transmart', 'yandexFree', 'volcengineFree'];
    webMock.mockImplementation(async id => {if (id === 'transmart') throw httpFailure(429); if (id === 'yandexFree') throw httpFailure(400); return '译文';});
    await expect(settle(translateFreeText('One'))).resolves.toBe('译文');
    await expect(settle(translateFreeText('Two'))).resolves.toBe('译文');
    expect(webMock.mock.calls.map(call => call[0])).toEqual(['transmart', 'yandexFree', 'volcengineFree', 'yandexFree', 'volcengineFree']);
});

it.each([
    ['youdaoFree', 'chinese'], ['icibaFree', 'chinese'],
    ['sogouFree', 'extra'], ['reversoFree', 'extra'], ['apertiumFree', 'extra'],
] as const)('routes %s through the dedicated adapter with frozen language and cancellation', async (id, kind) => {
    mockConfig.freeTranslationOrder = [id];
    const mock = kind === 'chinese' ? chineseMock : extraMock;
    mock.mockResolvedValue('适配器译文');
    const abort = new AbortController();
    await expect(settle(translateFreeText('Hello', {sourceLanguage: 'en', targetLanguage: 'zh-Hans', abortSignal: abort.signal}))).resolves.toBe('适配器译文');
    if (kind === 'chinese') expect(mock).toHaveBeenCalledWith(id, 'Hello', 'en', 'zh-Hans', expect.any(AbortSignal));
    else expect(mock).toHaveBeenCalledWith(id, 'Hello', 'en', 'zh-Hans', expect.any(AbortSignal));
});

it('passes balanced mode while excluding supplied manual weights from the frozen request', async () => {
    mockConfig.freeTranslationOrder = ['microsoft', 'sogouFree'];
    mockConfig.freeTranslationMode = 'balanced';
    mockConfig.freeTranslationWeights = {microsoft: 7, sogouFree: 2};
    microsoftMock.mockRejectedValue(httpFailure(429));
    extraMock.mockResolvedValue('均衡译文');
    await expect(settle(translateFreeText('Hello'))).resolves.toBe('均衡译文');
    const request = extraMock.mock.calls[0]![4];
    expect(request).toBeInstanceOf(AbortSignal);
    const snapshot = createTranslationProviderConfigSnapshot(mockConfig as TranslationConfigSource);
    expect(mockConfig.freeTranslationMode).toBe('balanced');
    expect(mockConfig.freeTranslationWeights).toEqual({microsoft: 7, sogouFree: 2});
    expect(Object.isFrozen(snapshot.freeTranslationOrder)).toBe(true);
    expect(snapshot).not.toHaveProperty('freeTranslationWeights');
});


it('六家官方节点同时分担不同段落，任务上限和输出顺序保持有界', async () => {
    mockConfig.freeTranslationMode = 'balanced';
    mockConfig.freeTranslationOrder = ['microsoft', 'transmart', 'google', 'alibabaFree', 'modernMtFree', 'laraFree'];
    const running: Array<{id: string; text: string; resolve: () => void}> = [];
    let active = 0;
    let maximum = 0;
    const pending = (id: string, text: string, array = false) => new Promise(resolve => {
        active++; maximum = Math.max(maximum, active);
        running.push({id, text, resolve: () => {active--; resolve(array ? [`译:${text}`] : `译:${text}`);}});
    });
    microsoftMock.mockImplementation(([text]: string[]) => pending('microsoft', text, true));
    googleMock.mockImplementation(text => pending('google', text));
    webMock.mockImplementation((id, text) => pending(id, text));
    officialMock.mockImplementation((id, request) => pending(id, request.origin));
    const texts = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const request = freeTranslation({origin: texts});
    await flush();
    expect(running).toHaveLength(6);
    expect(new Set(running.map(item => item.id)).size).toBe(6);
    expect(running.map(item => item.text)).toEqual(texts.slice(0, 6));
    running.splice(0).reverse().forEach(item => item.resolve());
    await vi.advanceTimersByTimeAsync(1000);
    running.splice(0).reverse().forEach(item => item.resolve());
    await expect(settle(request)).resolves.toEqual(texts.map(text => `译:${text}`));
    expect(maximum).toBe(6);
    expect(vi.getTimerCount()).toBe(0);
});

it('取消同时停止六家节点，不继续领取队列中的段落', async () => {
    mockConfig.freeTranslationMode = 'balanced';
    mockConfig.freeTranslationOrder = ['microsoft', 'transmart', 'google', 'alibabaFree', 'modernMtFree', 'laraFree'];
    const signals: AbortSignal[] = [];
    const pending = (signal: AbortSignal) => {signals.push(signal); return new Promise(() => {});};
    microsoftMock.mockImplementation((_texts, _from, _to, signal) => pending(signal));
    googleMock.mockImplementation((_text, _from, _to, signal) => pending(signal));
    webMock.mockImplementation((_id, _text, _from, _to, signal) => pending(signal));
    officialMock.mockImplementation((_id, request) => pending(request.abortSignal));
    const caller = new AbortController();
    const request = freeTranslation({origin: ['A', 'B', 'C', 'D', 'E', 'F', 'queued'], abortSignal: caller.signal});
    const assertion = expect(request).rejects.toMatchObject({name: 'AbortError'});
    await flush();
    expect(signals).toHaveLength(6);
    caller.abort();
    await assertion;
    expect(signals).toHaveLength(6);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
});

it.each([
    ['direct', 'single'], ['direct', 'batch'], ['broker', 'single'], ['broker', 'batch'],
])('%s 的 %s 免费翻译实际只请求官方阿里节点，隔离历史凭据和私有代理', async (entrypoint, mode) => {
    const actual = await vi.importActual<typeof import('@/src/providers/translation/free-official-web')>('@/src/providers/translation/free-official-web');
    officialMock.mockImplementation(actual.translateOfficialFreeWebProvider);
    mockConfig.freeTranslationOrder = ['alibabaFree'];
    mockConfig.token = {deeplx: 'stored-secret', aliyunTranslation: 'cloud-secret'};
    mockConfig.proxy = {deeplx: 'https://private.example/secret', aliyunTranslation: 'https://proxy.example/secret'};
    mockConfig.customHeaders = {aliyunTranslation: '{"Authorization":"private-header"}'};
    mockConfig.secret = {aliyunTranslation: 'private-cloud-secret'};
    const fetchMock = vi.fn(async (url, init) => String(url).endsWith('/csrftoken')
        ? Response.json({token: 'anonymous-csrf', headerName: 'X-XSRF-TOKEN_PROPERTY_ITEM'})
        : Response.json({success: true, data: {translateText: `译:${(init.body as FormData).get('query')}`}}));
    vi.stubGlobal('fetch', fetchMock);
    const origin = mode === 'batch' ? ['Hello', 'World'] : 'Hello';
    const message = {origin, sourceLanguage: 'en', targetLanguage: 'zh-Hans'};
    const request = entrypoint === 'broker'
        ? attachTranslationProviderConfig(message, createTranslationProviderConfigSnapshot(mockConfig as TranslationConfigSource)) : message;
    await expect(settle(freeTranslation(request))).resolves.toEqual(mode === 'batch' ? ['译:Hello', '译:World'] : '译:Hello');
    expect(fetchMock).toHaveBeenCalledTimes(mode === 'batch' ? 4 : 2);
    for (const [url, init] of fetchMock.mock.calls) {
        expect(new URL(String(url)).hostname).toBe('translate.alibaba.com');
        expect(init.credentials).toBe('omit');
        const body = init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : init.body;
        expect(JSON.stringify([url, init.headers, body])).not.toMatch(/stored-secret|private|proxy\.example|cloud-secret/u);
    }
    expect(readSnapshot(officialMock.mock.calls[0][1])).toMatchObject({token: {}, secret: {}, proxy: {}, customHeaders: {}});
    expect(mockConfig.token.deeplx).toBe('stored-secret');
});
