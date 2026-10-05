import {describe, expect, it, vi} from 'vitest';
import {Config} from '@/src/core/config/model';
import {attachPrivateTranslationContext, isPrivateTranslationContext} from '@/src/services/translation/privateContext';
import {createTranslationBroker} from '@/src/services/translation/broker';
import {reportTranslationModelUsage, getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';
import {createTranslationRequestFallback} from '@/src/app/background/handlers/translation';
import {servicesType, resolveConfiguredModel} from '@/src/core/config/catalog';
function setup() {
    const config = new Config();
    config.service = 'openai'; config.from = 'en'; config.to = 'zh-Hans'; config.enableAIContext = false;
    config.model.openai = 'normal-model'; config.model.deepseek = 'normal-deepseek';
    const calls: Array<{service: string; model: string; origin: unknown}> = [];
    const provider = (service: string) => vi.fn(async (message: any) => {
        const current = getTranslationProviderConfig(message, config as any);
        calls.push({service, model: message.modelOverride || current.model[service], origin: message.origin});
        await Promise.resolve();
        return '这是翻译后的测试内容';
    });
    const openai = provider('openai'), deepseek = provider('deepseek');
    const cache = {get: vi.fn(async () => null), set: vi.fn(async () => true), clear: vi.fn(async () => {}), cleanup: vi.fn(async () => {})};
    const record = vi.fn();
    const usage = vi.fn();
    const broker = createTranslationBroker({ready: Promise.resolve(), getConfig: () => config, providers: {openai, deepseek}, cache,
        serviceTypes: servicesType, endpointResolver: {resolveOpenAICompatibleEndpoint: () => ({endpoint: 'https://provider.test'}), aiSdkTransportProfile: 'test'},
        promptBuilder: {buildPageSummaryPrompt: s => s, buildPageSummarySystemPrompt: () => ''},
        getMissingCredentialMessage: () => null, getTranslationLanguages: o => ({sourceLanguage: o?.sourceLanguage || 'en', targetLanguage: o?.targetLanguage || 'zh-Hans'}),
        resolveConfiguredModel, buildTranslationCacheKey: value => JSON.stringify(value), recordTranslationRequest: record, recordModelUsage: usage});
    return {config, broker, calls, cache, record, usage, openai, deepseek};
}
const request = () => ({origin: 'This is some test content.', serviceOverride: 'openai', modelOverride: 'normal-model', useCache: true});

describe('private translation persistence isolation', () => {
    it('keeps ordinary payloads unchanged and clears a reused private marker', () => {
        const payload = {origin: 'Original'};
        expect(attachPrivateTranslationContext(payload, false)).toBe(payload);
        expect(Reflect.ownKeys(payload)).toEqual(['origin']);
        attachPrivateTranslationContext(payload, true);
        expect(isPrivateTranslationContext(payload)).toBe(true);
        attachPrivateTranslationContext(payload, false);
        expect(isPrivateTranslationContext(payload)).toBe(false);
        expect(Reflect.ownKeys(payload)).toEqual(['origin']);
    });
    it('does not read shared cache or persist private content/usage', async () => {
        const {broker, cache, record, openai} = setup();
        await broker.translateWithCache(attachPrivateTranslationContext(request(), true));
        expect(openai).toHaveBeenCalledOnce();
        expect(cache.get).not.toHaveBeenCalled(); expect(cache.set).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
        await broker.translateWithCache(request());
        expect(cache.get).toHaveBeenCalled(); expect(cache.set).toHaveBeenCalledOnce(); expect(record).toHaveBeenCalledOnce();
    });
    it('does not deduplicate normal/private requests even for the same provider/model and cache off', async () => {
        const {broker, openai} = setup();
        await Promise.all([broker.translateWithCache({...request(), useCache: false}),
            broker.translateWithCache(attachPrivateTranslationContext({...request(), useCache: false}, true))]);
        expect(openai).toHaveBeenCalledTimes(2);
    });
    it('isolates private batch and page-summary work and suppresses token usage', async () => {
        const {config, broker, cache, record, usage, openai} = setup(); config.enableAIContext = true;
        openai.mockImplementation(async (message: any) => {
            reportTranslationModelUsage(message, {usageAvailability: 'reported', actualModel: 'normal-model', inputTokens: 5, outputTokens: 4, totalTokens: 9});
            await Promise.resolve();
            return message.summaryPrompt ? 'A short article summary.' : Array.isArray(message.origin)
                ? message.origin.map(() => '这是翻译后的测试内容') : '这是翻译后的测试内容';
        });
        const payload = {...request(), origin: ['First test sentence.', 'Second test sentence.'], pageContext: 'An article about language translation.', useCache: false};
        await Promise.all([broker.translateWithCache(payload), broker.translateWithCache(attachPrivateTranslationContext({...payload}, true))]);
        expect(openai.mock.calls.filter(([message]) => message.summaryPrompt)).toHaveLength(2);
        expect(openai.mock.calls.filter(([message]) => !message.summaryPrompt)).toHaveLength(2);
        expect(cache.get).not.toHaveBeenCalled(); expect(cache.set).not.toHaveBeenCalled();
        expect(record).toHaveBeenCalledOnce(); expect(usage).toHaveBeenCalledTimes(2);
    });
    it('binds the real sender and split context, ignoring public incognito fields', async () => {
        const translate = vi.fn(async (_request: object) => 'ok');
        const handler = createTranslationRequestFallback<{sender: {tab: {incognito: boolean}}}>({translate, serializeError: String});
        await handler.handle({...request(), incognito: true}, {sender: {tab: {incognito: false}}});
        expect(isPrivateTranslationContext(translate.mock.calls[0][0])).toBe(false);
        await handler.handle(request(), {sender: {tab: {incognito: true}}});
        expect(isPrivateTranslationContext(translate.mock.calls[1][0])).toBe(true);
        const split = createTranslationRequestFallback({translate, serializeError: String, privateContext: () => true});
        await split.handle(request(), undefined);
        expect(isPrivateTranslationContext(translate.mock.calls[2][0])).toBe(true);
        expect(JSON.stringify(translate.mock.calls[2][0])).not.toContain('private-context');
    });
});
