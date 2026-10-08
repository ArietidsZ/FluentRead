import {describe, expect, it, vi} from 'vitest';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {currentModelIds, customModelString, models, services, servicesType} from '@/src/core/config/catalog';
import {getLockedIncognitoRoute, lockIncognitoRoute, normalizeIncognitoRouteField, resolveIncognitoRoute} from '@/src/core/config/incognitoRoute';
import {isTrustedIncognitoSender} from '@/src/platform/browser/incognitoSource';
import {createNativeTranslationRequestFallback, createTranslationRequestFallback, type TranslationRequestContext} from '@/src/app/background/handlers/translation';
import {createBackgroundMessageRouter, createBackgroundRuntimeMessageListener} from '@/src/app/background/messageRouter';
import {createTranslationBroker, resolveTranslationRequestModel} from '@/src/services/translation/broker';
import {attachTranslationProviderConfig, attachTrustedPrivateSource, createTranslationProviderConfigSnapshot, getTranslationProviderConfig, hasTrustedPrivateSource} from '@/src/services/translation/requestSnapshot';
import {commonMsgTemplate, currentConfiguredModel, getCurrentModel, deepseekMsgTemplate, deepseekResponsesMsgTemplate, tongyiMsgTemplate} from '@/src/services/translation/templates';
import {resolveTranslationLanguages} from '@/src/core/translation/languages';
import type {TranslationProviderRequest} from '@/src/services/translation/requestSnapshot';
import {buildHunyuanTranslationRequestBody} from '@/src/providers/translation/hunyuan-translation';
import {buildDoubaoSeedTranslationRequestBody} from '@/src/providers/translation/doubao-seed-translation';
import gemini from '@/src/providers/translation/gemini';
import deepseek from '@/src/providers/translation/deepseek';

const {transport} = vi.hoisted(() => ({transport: vi.fn()}));
vi.mock('@/src/platform/http/runtime', () => ({runtimeFetch: transport}));

vi.mock('@/src/services/config/store', () => ({config: {}}));

function fixture() {
    const config = new Config();
    config.service = services.google;
    config.incognitoService = services.openai;
    config.incognitoModel = 'gpt-5.4-mini';
    config.useCache = true;
    config.enableAIContext = false;
    const cacheGet = vi.fn(async () => null);
    const cacheKeys = vi.fn((identity: Record<string, unknown>) => JSON.stringify(identity));
    const payloads: unknown[] = [];
    const provider = vi.fn(async (input: Record<string, unknown>) => {
        const message = input as unknown as TranslationProviderRequest<string>;
        const snapshot = getTranslationProviderConfig(message, createTranslationProviderConfigSnapshot(config));
        payloads.push(JSON.parse(commonMsgTemplate(message.origin, undefined, undefined, undefined,
            message.serviceOverride, 'zh-Hans', message.modelOverride, snapshot)));
        return '翻译完成';
    });
    const providers = {[services.openai]: provider, [services.google]: provider, [services.tongyi]: provider};
    const broker = createTranslationBroker({
        ready: Promise.resolve(), getConfig: () => config,
        providers,
        cache: {get: cacheGet, set: vi.fn(async () => true), clear: vi.fn(async () => {}), cleanup: vi.fn(async () => {})},
        serviceTypes: {...servicesType, isAiSdk: service => service === services.openai},
        endpointResolver: {resolveOpenAICompatibleEndpoint: () => ({endpoint: 'https://fixture.invalid/v1/chat/completions'}), aiSdkTransportProfile: 'test'},
        promptBuilder: {buildPageSummaryPrompt: () => '', buildPageSummarySystemPrompt: () => ''},
        getMissingCredentialMessage: () => null,
        getTranslationLanguages: override => resolveTranslationLanguages(override, {sourceLanguage: 'auto', targetLanguage: 'zh-Hans'}),
        resolveConfiguredModel: (selected, custom) => selected === customModelString ? custom ?? '' : selected ?? '',
        buildTranslationCacheKey: cacheKeys,
    });
    const handler = createTranslationRequestFallback<{sender?: {id?: string; tab?: {incognito?: boolean}}}>({
        runtimeId: 'fixture-extension', translate: broker.translateWithCache,
        serializeError: error => ({error: (error as Error).message}),
    });
    return {config, broker, handler, cacheGet, cacheKeys, providers, provider, payloads};
}

describe('incognito route configuration and trusted source', () => {
    it('keeps two independent empty defaults and preserves invalid types through normalization', () => {
        expect(new Config()).toMatchObject({incognitoService: '', incognitoModel: ''});
        expect(resolveIncognitoRoute({})).toBeUndefined();
        expect(resolveIncognitoRoute({incognitoService: '', incognitoModel: ''})).toBeUndefined();
        expect(normalizeIncognitoRouteField(' openai ')).toBe('openai');
        expect(normalizeIncognitoRouteField(undefined)).toBe('');
        for (const bad of [null, false, 42, {}, []]) {
            const normalized = normalizeConfig({incognitoService: bad, incognitoModel: bad});
            expect(() => resolveIncognitoRoute(normalized)).toThrow('配置无效');
            expect(() => resolveIncognitoRoute({incognitoService: bad, incognitoModel: bad})).toThrow('配置无效');
        }
    });
    it.each([
        {incognitoService: services.openai, incognitoModel: ''},
        {incognitoService: '', incognitoModel: 'gpt-5.4-mini'},
        {incognitoService: 'deleted-provider', incognitoModel: 'model'},
        {incognitoService: 'custom:deleted', incognitoModel: 'model'},
        {incognitoService: services.openai, incognitoModel: customModelString},
        {incognitoService: services.openai, incognitoModel: 'unregistered-model'},
        {incognitoService: services.localTranslation, incognitoModel: 'unknown-local'},
        {incognitoService: services.localTranslation, incognitoModel: 'unknown-local', customModels: {[services.localTranslation]: ['unknown-local']}},
        {incognitoService: services.google, incognitoModel: 'extra-model'},
        {incognitoService: ' openai', incognitoModel: 'gpt-5.4-mini'},
        {incognitoService: services.openai, incognitoModel: 'gpt-5.4-mini '},
        {incognitoService: services.openai, incognitoModel: 'custom（label）', customModels: {[services.openai]: ['custom（label）']}},
    ])('fails closed for invalid configuration %#', config => expect(() => resolveIncognitoRoute(config)).toThrow());
    it('accepts no-model providers, catalog local models and registered custom providers/models', () => {
        expect(resolveIncognitoRoute({incognitoService: services.google})).toEqual({service: services.google, model: ''});
        const model = models.get(services.localTranslation)![0];
        expect(resolveIncognitoRoute({incognitoService: services.localTranslation, incognitoModel: model})?.model).toBe(model);
        expect(resolveIncognitoRoute({incognitoService: services.openai, incognitoModel: 'saved-private',
            customModels: {[services.openai]: ['saved-private']}})?.model).toBe('saved-private');
        expect(resolveIncognitoRoute({incognitoService: 'custom:fixture', incognitoModel: 'local-model',
            customOpenAIProviders: [{id: 'custom:fixture', name: 'fixture', endpoint: 'https://fixture.invalid/v1', models: ['local-model']}]})).toEqual({service: 'custom:fixture', model: 'local-model'});
    });
    it('fails closed when a model-using provider has no catalog entry and no saved model', () => {
        const saved = models.get(services.openai)!;
        models.delete(services.openai);
        try {
            expect(() => resolveIncognitoRoute({incognitoService: services.openai, incognitoModel: 'gpt-5.4-mini'})).toThrow('配置无效');
        } finally {models.set(services.openai, saved);}
    });
    it('requires native sender identity and a strict incognito boolean', () => {
        expect(isTrustedIncognitoSender({id: 'own', tab: {incognito: true}}, 'own')).toBe(true);
        for (const [sender, id] of [[undefined, 'own'], [{id: 'other', tab: {incognito: true}}, 'own'],
            [{id: 'own'}, 'own'], [{id: 'own', tab: {incognito: false}}, 'own'],
            [{id: 'own', tab: {incognito: true}}, undefined]]) {
            expect(isTrustedIncognitoSender(sender as never, id as never)).toBe(false);
        }
        expect(isTrustedIncognitoSender({id: 'own', tab: {incognito: 'true' as never}}, 'own')).toBe(false);
        expect(hasTrustedPrivateSource({incognito: true})).toBe(false);
        const trusted = attachTrustedPrivateSource({origin: 'text'});
        expect(hasTrustedPrivateSource({...trusted})).toBe(true);
        expect(hasTrustedPrivateSource(JSON.parse(JSON.stringify(trusted)))).toBe(false);
    });
});

describe('private route rejects model-bound conflicts before dispatch', () => {
    it.each([services.openai, services.huanYuanTranslation, services.tongyi, services.doubao])('rejects model and uppercase Model overrides for %s', service => {
        const model = models.get(service)![0];
        for (const field of ['model', 'Model']) {
            for (const replacement of ['other-model', null, 7]) {
                expect(() => resolveIncognitoRoute({incognitoService: service, incognitoModel: model,
                    customBody: {[service]: JSON.stringify({[field]: replacement})}})).toThrow('请求体冲突');
            }
        }
        expect(resolveIncognitoRoute({incognitoService: service, incognitoModel: model,
            customBody: {[service]: JSON.stringify({model, Model: model, temperature: 0})}})?.model).toBe(model);
    });
    it.each(['{', 'null', '[]', '42'])('rejects malformed or non-object custom body %s', body => {
        expect(() => resolveIncognitoRoute({incognitoService: services.openai, incognitoModel: 'gpt-5.4-mini', customBody: {[services.openai]: body}})).toThrow();
    });
    it('rejects Gemini and Azure endpoint conflicts without changing either endpoint', () => {
        for (const [service, model, field, endpoint] of [
            [services.gemini, models.get(services.gemini)![0], 'proxy', 'https://fixture.invalid/v1/models/other:generateContent'],
            [services.azureOpenai, 'gpt-5.4-mini', 'azureOpenaiEndpoint', 'https://fixture.invalid/openai/deployments/other/chat/completions'],
        ]) {
            const input = {incognitoService: service, incognitoModel: model,
                [field]: field === 'proxy' ? {[service]: endpoint} : endpoint};
            expect(() => resolveIncognitoRoute(input)).toThrow('端点绑定冲突');
            expect(input[field as keyof typeof input]).toEqual(field === 'proxy' ? {[service]: endpoint} : endpoint);
        }
        expect(() => resolveIncognitoRoute({incognitoService: services.gemini, incognitoModel: models.get(services.gemini)![0], proxy: {[services.gemini]: 'bad-url'}})).toThrow('端点配置无效');
        expect(() => resolveIncognitoRoute({incognitoService: services.gemini, incognitoModel: models.get(services.gemini)![0], proxy: {[services.gemini]: 'https://fixture.invalid/models/%zz:generateContent'}})).toThrow('端点配置无效');
        expect(resolveIncognitoRoute({incognitoService: services.gemini, incognitoModel: models.get(services.gemini)![0], proxy: {[services.gemini]: 'https://fixture.invalid/models/{model}:generateContent?key={key}'}})).toBeDefined();
        expect(resolveIncognitoRoute({incognitoService: services.azureOpenai, incognitoModel: 'gpt-5.4-mini', azureOpenaiEndpoint: 'https://fixture.invalid/openai/deployments/gpt-5.4-mini/chat/completions'})).toBeDefined();
    });
});

describe('background to broker to request payload vertical route', () => {
    it('freezes actual model despite client feature overrides and later live configuration edits', async () => {
        const f = fixture();
        let release!: () => void;
        f.cacheGet.mockImplementationOnce(() => new Promise<null>(resolve => {release = () => resolve(null);}));
        const pending = f.handler.handle({origin: 'A complete sentence for translation.', serviceOverride: services.google,
            modelOverride: 'attacker-model', incognito: false}, {sender: {id: 'fixture-extension', tab: {incognito: true}}});
        await vi.waitFor(() => expect(f.cacheGet).toHaveBeenCalled());
        f.config.incognitoService = services.tongyi;
        f.config.incognitoModel = 'qwen-mt-plus';
        f.config.model[services.openai] = 'changed-live';
        f.config.customBody[services.openai] = '{"model":"changed-body"}';
        release();
        expect(await pending).toBe('翻译完成');
        expect(f.provider).toHaveBeenCalledOnce();
        expect(f.payloads[0]).toMatchObject({model: 'gpt-5.4-mini'});
        expect(f.cacheKeys.mock.calls[0][0]).toMatchObject({service: services.openai, model: 'gpt-5.4-mini'});
        const request = f.provider.mock.calls[0][0];
        expect(request).toMatchObject({serviceOverride: services.openai, modelOverride: 'gpt-5.4-mini'});
        const snapshot = getTranslationProviderConfig(request, createTranslationProviderConfigSnapshot(f.config));
        expect(getLockedIncognitoRoute({...snapshot})).toEqual({service: services.openai, model: 'gpt-5.4-mini'});
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(currentConfiguredModel(snapshot, services.openai, 'late-override')).toBe('gpt-5.4-mini');
        expect(resolveTranslationRequestModel(snapshot, services.openai, 'late-override', () => true, () => true)).toBe('gpt-5.4-mini');
    });
    it('keeps ordinary advanced-body behavior and cannot be promoted by a client incognito flag', async () => {
        const f = fixture();
        f.config.customBody[services.openai] = '{"model":"ordinary-body-model"}';
        expect(await f.handler.handle({origin: 'A complete sentence.', incognito: true, serviceOverride: services.openai,
            modelOverride: 'ordinary-feature'}, {sender: {id: 'fixture-extension', tab: {incognito: false}}})).toBe('翻译完成');
        expect(f.payloads[0]).toMatchObject({model: 'ordinary-body-model'});
        expect(getLockedIncognitoRoute(getTranslationProviderConfig(f.provider.mock.calls[0][0], createTranslationProviderConfigSnapshot(f.config)))).toBeUndefined();
    });
    it('preserves existing behavior with both private fields empty and rejects invalid private config before cache/provider work', async () => {
        const f = fixture();
        f.config.incognitoService = '';
        f.config.incognitoModel = '';
        expect(await f.handler.handle({origin: 'A complete sentence.', serviceOverride: services.openai, modelOverride: 'feature-model'},
            {sender: {id: 'fixture-extension', tab: {incognito: true}}})).toBe('翻译完成');
        expect(f.payloads[0]).toMatchObject({model: 'feature-model'});
        f.provider.mockClear(); f.cacheGet.mockClear();
        f.config.incognitoService = services.localTranslation;
        f.config.incognitoModel = 'unknown-local';
        expect(await f.handler.handle({origin: 'Another complete sentence.'},
            {sender: {id: 'fixture-extension', tab: {incognito: true}}})).toEqual({error: expect.stringContaining('配置无效')});
        expect(f.provider).not.toHaveBeenCalled(); expect(f.cacheGet).not.toHaveBeenCalled();
    });
    it('honors registered custom models from an immutable internal provider snapshot', async () => {
        const f = fixture();
        f.config.incognitoModel = 'saved-private';
        f.config.customModels[services.openai] = ['saved-private'];
        const snapshot = createTranslationProviderConfigSnapshot(f.config);
        f.config.customModels[services.openai][0] = 'changed';
        const request = attachTrustedPrivateSource(attachTranslationProviderConfig({origin: 'A complete sentence.', serviceOverride: services.google}, snapshot));
        expect(await f.broker.translateWithCache(request)).toBe('翻译完成');
        expect(f.payloads[0]).toMatchObject({model: 'saved-private'});
    });
    it('retains an already frozen internal route despite later feature route overrides', async () => {
        const f = fixture();
        const route = resolveIncognitoRoute(f.config)!;
        const snapshot = lockIncognitoRoute(createTranslationProviderConfigSnapshot(f.config), route);
        const request = attachTrustedPrivateSource(attachTranslationProviderConfig({origin: 'A complete sentence.', serviceOverride: services.google, modelOverride: 'feature-change'}, snapshot));
        f.config.incognitoService = 'deleted-provider';
        expect(await f.broker.translateWithCache(request)).toBe('翻译完成');
        expect(f.payloads[0]).toMatchObject({model: route.model});
        expect(currentConfiguredModel(snapshot, services.google, 'ordinary-override')).toBe('ordinary-override');
        expect(getCurrentModel(services.google, 'ordinary-override', snapshot)).toBe('ordinary-override');
        expect(resolveTranslationRequestModel(snapshot, services.google, 'ordinary-override', () => false, () => false)).toBe('ordinary-override');
        expect(Object.isFrozen(getLockedIncognitoRoute(snapshot))).toBe(true);
    });
    it('locks Qwen MT actual model while retaining compatible advanced-body fields', () => {
        const f = fixture(); f.config.incognitoService = services.tongyi; f.config.incognitoModel = 'qwen-mt-plus';
        f.config.customBody[services.tongyi] = '{"model":"qwen-mt-plus","translation_options":{"domain":"fixture"}}';
        const route = resolveIncognitoRoute(f.config)!;
        const snapshot = lockIncognitoRoute(createTranslationProviderConfigSnapshot(f.config), route);
        expect(JSON.parse(tongyiMsgTemplate('Text', undefined, undefined, undefined, services.tongyi, 'zh-Hans', 'malicious', snapshot))).toMatchObject({model: 'qwen-mt-plus', translation_options: {domain: 'fixture'}});
    });
    it('preserves ordinary model resolution in a build target without native private routing', async () => {
        vi.resetModules();
        vi.doMock('@/src/core/config/incognitoRoute', async () => ({
            ...await vi.importActual<typeof import('@/src/core/config/incognitoRoute')>('@/src/core/config/incognitoRoute'),
            NATIVE_PRIVATE_ROUTE_SUPPORTED: false,
        }));
        try {
            const core = await import('@/src/core/config/incognitoRoute');
            const templates = await import('@/src/services/translation/templates');
            const broker = await import('@/src/services/translation/broker');
            const f = fixture(); f.config.customBody[services.openai] = '{"model":"ordinary-body"}';
            const snapshot = core.lockIncognitoRoute(createTranslationProviderConfigSnapshot(f.config), {service: services.openai, model: 'private-model'});
            expect(templates.currentConfiguredModel(snapshot, services.openai, 'ordinary-feature')).toBe('ordinary-feature');
            expect(templates.getCurrentModel(services.openai, 'ordinary-feature', snapshot)).toBe('ordinary-feature');
            expect(broker.resolveTranslationRequestModel(snapshot, services.openai, 'ordinary-feature', () => true, () => true)).toBe('ordinary-body');
        } finally {
            vi.doUnmock('@/src/core/config/incognitoRoute'); vi.resetModules();
        }
    });
    it('locks native Hunyuan uppercase Model and Doubao seed model after body merging', () => {
        for (const service of [services.huanYuanTranslation, services.doubao]) {
            const model = service === services.doubao ? 'doubao-seed-translation-250915' : models.get(service)![0];
            const config = {incognitoService: service, incognitoModel: model,
                customBody: {[service]: JSON.stringify(service === services.huanYuanTranslation ? {Model: model, Stream: false} : {model, temperature: 0})}};
            const route = resolveIncognitoRoute(config)!;
            const body = service === services.huanYuanTranslation
                ? buildHunyuanTranslationRequestBody('Hello', 'zh', route.model, config.customBody[service])
                : buildDoubaoSeedTranslationRequestBody('Hello', 'zh', 'en', route.model, config.customBody[service]);
            expect(body).toMatchObject(service === services.huanYuanTranslation ? {Model: model} : {model});
        }
    });
    it('uses the frozen Gemini model in the actual adapter URL and rejects conflicts before transport', async () => {
        const f = fixture();
        const model = models.get(services.gemini)![0];
        f.config.incognitoService = services.gemini; f.config.incognitoModel = model;
        Object.assign(f.providers, {[services.gemini]: (input: Record<string, unknown>) => gemini(input as unknown as TranslationProviderRequest<string>)});
        transport.mockResolvedValue(new Response(JSON.stringify({candidates: [{content: {parts: [{text: '翻译完成'}]}}]})));
        expect(await f.handler.handle({origin: 'A complete sentence.', serviceOverride: services.google, modelOverride: 'other'},
            {sender: {id: 'fixture-extension', tab: {incognito: true}}})).toBe('翻译完成');
        expect(transport).toHaveBeenCalledOnce();
        expect(transport.mock.calls[0][0]).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
        transport.mockClear(); f.cacheGet.mockClear();
        f.config.proxy[services.gemini] = 'https://fixture.invalid/models/other:generateContent';
        expect(await f.handler.handle({origin: 'Another complete sentence.'},
            {sender: {id: 'fixture-extension', tab: {incognito: true}}})).toEqual({error: expect.stringContaining('端点绑定冲突')});
        expect(transport).not.toHaveBeenCalled(); expect(f.cacheGet).not.toHaveBeenCalled();
    });
    it.each([
        ['deepseek-chat', 'chat'], ['deepseek-chat', 'responses'],
        ['deepseek-reasoner', 'chat'], ['deepseek-reasoner', 'responses'],
    ] as const)('keeps saved private model %s identical in cache and actual %s transport', async (model, apiType) => {
        const normalized = normalizeConfig({incognitoService: services.deepseek, incognitoModel: model,
            customModels: {[services.deepseek]: [model]}, deepseekApiType: apiType});
        expect(normalized.customModels[services.deepseek]).toContain(model);
        expect(normalized.incognitoModel).toBe(model);
        const f = fixture(); Object.assign(f.config, normalized, {useCache: true, enableAIContext: false});
        Object.assign(f.providers, {[services.deepseek]: (input: Record<string, unknown>) => deepseek(input as unknown as TranslationProviderRequest<string>)});
        transport.mockClear();
        transport.mockImplementation(async () => new Response(JSON.stringify(apiType === 'responses'
            ? {output: [{type: 'message', content: [{type: 'output_text', text: '翻译完成'}]}]}
            : {choices: [{message: {content: '翻译完成'}}]})));
        expect(await f.handler.handle({origin: 'A complete sentence for translation.', modelOverride: 'late-feature-override'},
            {sender: {id: 'fixture-extension', tab: {incognito: true}}})).toBe('翻译完成');
        expect(transport).toHaveBeenCalledOnce();
        const actualBody = JSON.parse(transport.mock.calls[0][1].body as string);
        const cacheIdentity = f.cacheKeys.mock.calls[0][0];
        expect(cacheIdentity).toMatchObject({service: services.deepseek, model});
        expect(actualBody.model).toBe(model);
        expect(actualBody.model).toBe(cacheIdentity.model);
        const ordinaryConfig = new Config();
        ordinaryConfig.model[services.deepseek] = customModelString;
        ordinaryConfig.customModel[services.deepseek] = model;
        const ordinary = createTranslationProviderConfigSnapshot(ordinaryConfig);
        expect(getCurrentModel(services.deepseek, model, ordinary)).toBe(currentModelIds.deepseek);
        expect(getCurrentModel(services.deepseek, undefined, ordinary)).toBe(currentModelIds.deepseek);
        expect(JSON.parse(deepseekMsgTemplate('Text', undefined, undefined, undefined, services.deepseek,
            'zh-Hans', model, ordinary)).model).toBe(currentModelIds.deepseek);
        expect(JSON.parse(deepseekResponsesMsgTemplate('Text', undefined, undefined, undefined, services.deepseek,
            'zh-Hans', model, ordinary)).model).toBe(currentModelIds.deepseek);
    });
});


describe('native runtime composition → broker → captured provider', () => {
    function nativeFixture(records: unknown = []) {
        const f = fixture();
        const getContexts = vi.fn(async () => records);
        const runtime = {id: 'fixture-extension', getURL: () => 'chrome-extension://fixture-extension/', getContexts};
        const fallback = createNativeTranslationRequestFallback<TranslationRequestContext>(runtime, {
            translate: f.broker.translateWithCache,
            serializeError: error => ({error: (error as Error).message}),
        });
        const listener = createBackgroundRuntimeMessageListener(createBackgroundMessageRouter([], fallback), sender => ({sender: sender as TranslationRequestContext['sender']}));
        return {...f, getContexts, runtime, listener};
    }
    const sender = {id: 'fixture-extension', documentId: 'original', url: 'chrome-extension://fixture-extension/options.html', origin: 'chrome-extension://fixture-extension'};
    const context = {contextId: 'context', contextType: 'TAB', documentId: 'original', documentUrl: sender.url, documentOrigin: sender.origin, incognito: true};
    it('routes exact tabless private context to the configured model in payload and cache', async () => {
        const f = nativeFixture([context]);
        expect(await f.listener({origin: 'A complete source sentence.', serviceOverride: services.tongyi, modelOverride: 'client-model'}, sender)).toBe('翻译完成');
        expect(f.payloads[0]).toMatchObject({model: 'gpt-5.4-mini'});
        expect(f.cacheKeys.mock.calls[0][0]).toMatchObject({service: services.openai, model: 'gpt-5.4-mini'});
        expect(f.getContexts).toHaveBeenCalledWith({documentIds: ['original']});
    });
    it('native normal tab has priority and keeps ordinary overrides even with invalid private config', async () => {
        const f = nativeFixture([context]); f.config.incognitoService = 'deleted';
        expect(await f.listener({origin: 'A complete source sentence.', serviceOverride: services.openai, modelOverride: 'gpt-5.4'}, {...sender, tab: {incognito: false}})).toBe('翻译完成');
        expect(f.payloads[0]).toMatchObject({model: 'gpt-5.4'}); expect(f.getContexts).not.toHaveBeenCalled();
    });
    it('tabless regular TAB keeps its ordinary provider', async () => {
        const f = nativeFixture([{...context, incognito: false}]);
        expect(await f.listener({origin: 'A complete source sentence.', serviceOverride: services.openai, modelOverride: 'gpt-5.4'}, sender)).toBe('翻译完成');
        expect(f.payloads[0]).toMatchObject({model: 'gpt-5.4'});
    });
    it.each([[], [context, context], [{...context, documentId: 'new'}], [{...context, contextType: 'POPUP', incognito: false}], [{...context, contextType: 'SIDE_PANEL', incognito: false}]].map(records => ({records})))('unknown source fails before cache or provider %#', async ({records}) => {
        const f = nativeFixture(records);
        expect(await f.listener({origin: 'Source sentence.', incognito: true, privacy: 'regular'}, sender)).toMatchObject({error: expect.stringContaining('无法确认')});
        expect(f.provider).not.toHaveBeenCalled(); expect(f.cacheGet).not.toHaveBeenCalled(); expect(f.cacheKeys).not.toHaveBeenCalled();
    });
    it('unsupported APIs/old Firefox documentId fail closed but typed UI messages bypass translation', async () => {
        const f = nativeFixture([context]);
        delete (f.runtime as {getContexts?: unknown}).getContexts;
        expect(await f.listener({origin: 'Source sentence.'}, sender)).toMatchObject({error: expect.stringContaining('无法确认')});
        expect(await f.listener({origin: 'Source sentence.'}, {id: sender.id, url: sender.url})).toMatchObject({error: expect.stringContaining('无法确认')});
        expect(await f.listener({type: 'unknown-ui-message'}, sender)).toMatchObject({success: false});
        expect(f.provider).not.toHaveBeenCalled();
    });
    it('both empty preserve ordinary behavior for unknown source, malformed route still closes', async () => {
        const f = nativeFixture(); f.config.incognitoService = ''; f.config.incognitoModel = '';
        expect(await f.listener({origin: 'A complete source sentence.', serviceOverride: services.openai, modelOverride: 'gpt-5.4'}, sender)).toBe('翻译完成');
        f.config.incognitoService = undefined as unknown as string;
        f.config.incognitoModel = undefined as unknown as string;
        expect(await f.listener({origin: 'Another complete source sentence.', serviceOverride: services.openai, modelOverride: 'gpt-5.4'}, sender)).toBe('翻译完成');
        f.config.incognitoService = ''; f.config.incognitoModel = undefined as unknown as string;
        expect(await f.listener({origin: 'A third complete source sentence.', serviceOverride: services.openai, modelOverride: 'gpt-5.4'}, sender)).toBe('翻译完成');
        f.config.incognitoModel = '';
        f.config.incognitoService = null as unknown as string;
        expect(await f.listener({origin: 'Source sentence.'}, sender)).toMatchObject({error: expect.stringContaining('无法确认')});
        f.config.incognitoService = ''; f.config.incognitoModel = 'dangling';
        expect(await f.listener({origin: 'Source sentence.'}, sender)).toMatchObject({error: expect.stringContaining('无法确认')});
    });
    it('preserves comparison model cards in regular/both-empty paths and explicitly rejects private route', async () => {
        const f = nativeFixture([context]);
        const request = {origin: 'A complete source sentence.', requestPurpose: 'comparison', serviceOverride: services.openai, modelOverride: 'gpt-5.4'};
        expect(await f.listener(request, sender)).toMatchObject({error: expect.stringContaining('多模型对比')});
        expect(f.provider).not.toHaveBeenCalled(); expect(f.cacheGet).not.toHaveBeenCalled();
        expect(await f.listener(request, {...sender, tab: {incognito: false}})).toBe('翻译完成');
        expect(f.payloads[0]).toMatchObject({model: 'gpt-5.4'});
        f.config.incognitoService = ''; f.config.incognitoModel = '';
        expect(await f.listener(request, sender)).toBe('翻译完成');
        expect(f.payloads[1]).toMatchObject({model: 'gpt-5.4'});
        expect(await f.listener({...request, requestPurpose: 'invented'}, sender)).toMatchObject({error: expect.stringContaining('requestPurpose')});
    });
});
