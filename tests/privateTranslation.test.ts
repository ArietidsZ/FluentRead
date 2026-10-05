import {describe, expect, it, vi} from 'vitest';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {privateTranslationCustomBody, privateTranslationError, normalizePrivateTranslationProfile, resolvePrivateTranslationConfig} from '@/src/core/config/privateTranslation';
import {attachPrivateTranslationContext, isPrivateTranslationContext} from '@/src/services/translation/privateContext';
import {commonMsgTemplate} from '@/src/services/translation/templates';
import {createTranslationBroker} from '@/src/services/translation/broker';
import {attachTranslationProviderConfig, createTranslationProviderConfigSnapshot, getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';
import {createTranslationRequestFallback} from '@/src/app/background/handlers/translation';
import {DEFAULT_LOCAL_TRANSLATION_MODEL, LOCAL_TRANSLATION_MODELS} from '@/src/core/config/localTranslation';
import {servicesType, resolveConfiguredModel} from '@/src/core/config/catalog';

function setup(credentialError?: string) {
    const config = new Config();
    config.service = 'openai'; config.from = 'en'; config.to = 'zh-Hans'; config.enableAIContext = false;
    config.model.openai = 'normal-model'; config.model.deepseek = 'normal-deepseek';
    config.privateTranslation = {enabled: true, service: 'deepseek', model: 'private-model'};
    const calls: Array<{service: string; model: string; origin: unknown}> = [];
    const provider = (service: string) => vi.fn(async (message: any) => {
        const current = getTranslationProviderConfig(message, config as any);
        calls.push({service, model: message.modelOverride || current.model[service], origin: message.origin});
        await Promise.resolve();
        return '这是翻译后的测试内容';
    });
    const openai = provider('openai'), deepseek = provider('deepseek'), local = provider('localTranslation');
    const cache = {get: vi.fn(async () => null), set: vi.fn(async () => true), clear: vi.fn(async () => {}), cleanup: vi.fn(async () => {})};
    const record = vi.fn();
    const broker = createTranslationBroker({ready: Promise.resolve(), getConfig: () => config, providers: {openai, deepseek, localTranslation: local}, cache,
        serviceTypes: servicesType, endpointResolver: {resolveOpenAICompatibleEndpoint: () => ({endpoint: 'https://provider.test'}), aiSdkTransportProfile: 'test'},
        promptBuilder: {buildPageSummaryPrompt: s => s, buildPageSummarySystemPrompt: () => ''},
        getMissingCredentialMessage: () => credentialError ?? null, getTranslationLanguages: o => ({sourceLanguage: o?.sourceLanguage || 'en', targetLanguage: o?.targetLanguage || 'zh-Hans'}),
        resolveConfiguredModel, buildTranslationCacheKey: value => JSON.stringify(value), recordTranslationRequest: record});
    return {config, broker, calls, cache, record, openai, deepseek, local};
}
const request = () => ({origin: 'This is some test content.', serviceOverride: 'openai', modelOverride: 'normal-model', useCache: true});

describe('browser-private translation profile', () => {
    it('normalizes legacy and malformed values without enabling the feature', () => {
        expect(normalizePrivateTranslationProfile(null)).toEqual({enabled: false, service: '', model: ''});
        expect(normalizeConfig({privateTranslation: {enabled: 'true', service: 1, model: []}}).privateTranslation)
            .toEqual({enabled: false, service: '', model: ''});
        expect(normalizePrivateTranslationProfile({enabled: true, service: ' deepseek ', model: ' model '}))
            .toEqual({enabled: true, service: 'deepseek', model: 'model'});
    });
    it('accepts explicit machine, available local and configured custom targets without inventing a model', () => {
        const {config} = setup();
        for (const [service, model] of [['microsoft', ''], ['localTranslation', DEFAULT_LOCAL_TRANSLATION_MODEL], ['custom:known', 'my-model']]) {
            config.customOpenAIProviders = [{id: 'custom:known', name: 'Known', endpoint: 'https://custom.test', models: ['my-model']}];
            config.privateTranslation = {enabled: true, service, model};
            expect(privateTranslationError(config)).toBeUndefined();
        }
    });
    it('copies only private selection and never mutates ordinary or per-feature preferences', () => {
        const {config} = setup(); const before = JSON.stringify(config);
        const privateConfig = resolvePrivateTranslationConfig(config, true);
        expect(privateConfig.service).toBe('deepseek'); expect(privateConfig.harness.model).toBe('private-model');
        expect(privateConfig.writing.model).toBe('private-model'); expect(privateConfig.inputBoxTranslationModel).toBe('private-model');
        expect(JSON.stringify(config)).toBe(before); expect(resolvePrivateTranslationConfig(config, false)).toBe(config);
        config.privateTranslation.enabled = false; expect(resolvePrivateTranslationConfig(config, true)).toBe(config);
        delete (config as Partial<Config>).privateTranslation; expect(resolvePrivateTranslationConfig(config, true)).toBe(config);
    });
    it('routes simultaneous regular/private requests independently and does not persist private text', async () => {
        const {config, broker, calls, cache, record} = setup(); const before = JSON.stringify(config);
        await Promise.all([broker.translateWithCache(request()), broker.translateWithCache(attachPrivateTranslationContext(request(), true))]);
        expect(calls).toEqual(expect.arrayContaining([{service: 'openai', model: 'normal-model', origin: request().origin},
            {service: 'deepseek', model: 'private-model', origin: request().origin}]));
        expect(calls).toHaveLength(2); expect(cache.set).toHaveBeenCalledTimes(1); expect(record).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(config)).toBe(before);
    });
    it('isolates pending work even when both windows use the same provider/model and caching is off', async () => {
        const {config, broker, openai} = setup(); config.privateTranslation = {enabled: true, service: 'openai', model: 'normal-model'};
        await Promise.all([broker.translateWithCache({...request(), useCache: false}),
            broker.translateWithCache(attachPrivateTranslationContext({...request(), useCache: false}, true))]);
        expect(openai).toHaveBeenCalledTimes(2);
    });
    it.each([{service: '', model: ''}, {service: 'missing-provider', model: 'x'},
        {service: 'freeTranslation', model: ''}, {service: 'deepseek', model: ''}, {service: 'custom:deleted', model: 'x'}, {service: 'localTranslation', model: 'typo-or-retired'}])
    ('fails closed for unavailable private profile %j', async profile => {
        const {config, broker, calls, cache} = setup(); config.privateTranslation = {enabled: true, ...profile};
        await expect(broker.translateWithCache(attachPrivateTranslationContext(request(), true))).rejects.toThrow('无痕');
        expect(calls).toHaveLength(0); expect(cache.get).not.toHaveBeenCalled();
        expect(() => resolvePrivateTranslationConfig(config, true)).toThrow('无痕');
    });
    it('keeps the dedicated model in the actual merged provider payload despite ordinary customBody.model', async () => {
        const {config, broker, openai} = setup();
        config.privateTranslation = {enabled: true, service: 'openai', model: 'private-model'};
        config.customBody.openai = JSON.stringify({model: 'ordinary-model', temperature: 0.2});
        const original = config.customBody.openai;
        openai.mockImplementation(async (message: any) => {
            const snapshot = getTranslationProviderConfig(message, config as any);
            const payload = JSON.parse(commonMsgTemplate(message.origin, '', undefined, undefined, 'openai', 'zh-Hans', message.modelOverride, snapshot));
            expect(payload.model).toBe('private-model'); expect(payload.temperature).toBe(0.2);
            return '这是翻译后的测试内容';
        });
        await broker.translateWithCache(attachPrivateTranslationContext(request(), true));
        expect(config.customBody.openai).toBe(original);
        const assistant = resolvePrivateTranslationConfig(config, true);
        expect(JSON.parse(assistant.customBody.openai)).toEqual({temperature: 0.2});
        const invalid = {openai: '{broken'}; expect(privateTranslationCustomBody(invalid, 'openai')).toBe(invalid);
        const machine = {microsoft: '{"model":"transport-option"}'}; expect(privateTranslationCustomBody(machine, 'microsoft')).toBe(machine);
    });
    it('does not fall back to the normal provider after missing credentials or private-provider failure', async () => {
        const missing = setup('Private credential missing');
        await expect(missing.broker.translateWithCache(attachPrivateTranslationContext(request(), true))).rejects.toThrow('Private credential missing');
        expect(missing.openai).not.toHaveBeenCalled(); expect(missing.deepseek).not.toHaveBeenCalled();
        const unavailable = setup(); unavailable.deepseek.mockRejectedValue(new Error('Private provider unavailable'));
        await expect(unavailable.broker.translateWithCache(attachPrivateTranslationContext(request(), true))).rejects.toThrow('Private provider unavailable');
        expect(unavailable.openai).not.toHaveBeenCalled();
    });
    it.each(LOCAL_TRANSLATION_MODELS.filter(model => !model.legacy).map(model => model.value))
    ('preserves an installed private local model %s without falling back on GPU errors', async model => {
        const {config, broker, local, openai, deepseek, calls, cache, record} = setup();
        config.privateTranslation = {enabled: true, service: 'localTranslation', model};
        expect(privateTranslationError(config)).toBeUndefined();
        const normalModel = config.model.localTranslation;
        await broker.translateWithCache(attachPrivateTranslationContext(request(), true));
        expect(calls).toEqual([{service: 'localTranslation', model, origin: request().origin}]);
        expect(config.model.localTranslation).toBe(normalModel);
        local.mockRejectedValue(new Error('LOCAL_TRANSLATION_GPU_UNAVAILABLE'));
        await expect(broker.translateWithCache(attachPrivateTranslationContext(request(), true)))
            .rejects.toThrow('LOCAL_TRANSLATION_GPU_UNAVAILABLE');
        expect(openai).not.toHaveBeenCalled(); expect(deepseek).not.toHaveBeenCalled();
        expect(cache.get).not.toHaveBeenCalled(); expect(cache.set).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });
    it('adapts a normal-provider batch to a private single-only local provider', async () => {
        const {config, broker, local, openai} = setup();
        config.privateTranslation = {enabled: true, service: 'localTranslation', model: DEFAULT_LOCAL_TRANSLATION_MODEL};
        local.mockImplementation(async (message: any) => {
            expect(typeof message.origin).toBe('string'); return '这是翻译后的测试内容';
        });
        const result = await broker.translateWithCache(attachPrivateTranslationContext({...request(),
            origin: ['First test sentence.', 'Second test sentence.'], aiMultiSegment: true}, true));
        expect(result).toHaveLength(2); expect(local).toHaveBeenCalledTimes(2); expect(openai).not.toHaveBeenCalled();
    });
    it('keeps a frozen private profile across asynchronous OCR/configuration changes', async () => {
        const {config, broker, calls} = setup();
        const frozen = createTranslationProviderConfigSnapshot(config);
        const queued = attachPrivateTranslationContext(attachTranslationProviderConfig(request(), frozen), true);
        config.privateTranslation.service = 'openai'; config.privateTranslation.model = 'later-model';
        expect(Object.isFrozen(frozen.privateTranslation)).toBe(true);
        await broker.translateWithCache(queued);
        expect(calls).toEqual([{service: 'deepseek', model: 'private-model', origin: request().origin}]);
    });
    it('validates a trusted legacy private snapshot without a custom-provider catalog', async () => {
        const {config, broker, calls, cache} = setup();
        const snapshot = {...createTranslationProviderConfigSnapshot(config), customOpenAIProviders: undefined};
        const payload = attachPrivateTranslationContext(attachTranslationProviderConfig(request(), snapshot), true);
        await expect(broker.translateWithCache(payload)).resolves.toBe('这是翻译后的测试内容');
        expect(calls).toEqual([{service: 'deepseek', model: 'private-model', origin: request().origin}]);
        expect(cache.get).not.toHaveBeenCalled(); expect(cache.set).not.toHaveBeenCalled();
        expect(snapshot.customOpenAIProviders).toBeUndefined();
    });

    it('preserves normal routing when the optional private assignment is off', async () => {
        const {config, broker, calls} = setup(); config.privateTranslation.enabled = false;
        await broker.translateWithCache(attachPrivateTranslationContext(request(), true));
        expect(calls[0]).toMatchObject({service: 'openai', model: 'normal-model'});
    });
    it('takes privacy only from trusted sender/context, ignoring forged request fields', async () => {
        const translate = vi.fn(async (_request: object) => 'ok');
        const handler = createTranslationRequestFallback<{sender: {tab: {incognito: boolean}}}>({translate, serializeError: String});
        await handler.handle({...request(), incognito: true, privateContext: true}, {sender: {tab: {incognito: false}}});
        expect(isPrivateTranslationContext(translate.mock.calls[0][0])).toBe(false);
        await handler.handle(request(), {sender: {tab: {incognito: true}}});
        expect(isPrivateTranslationContext(translate.mock.calls[1][0])).toBe(true);
        const split = createTranslationRequestFallback({translate, serializeError: String, privateContext: () => true});
        await split.handle(request(), undefined);
        expect(isPrivateTranslationContext(translate.mock.calls[2][0])).toBe(true);
        expect(JSON.stringify(translate.mock.calls[2][0])).not.toContain('private-context');
    });
});
