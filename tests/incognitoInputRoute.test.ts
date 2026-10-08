import {describe, expect, it, vi} from 'vitest';
import {services, currentModelIds} from '@/src/core/config/catalog';
import {createInputBoxTranslationHandler, createInputBoxTranslationRequest} from '@/src/features/input-translation/background/handler';
import {createTranslationProviderConfigSnapshot, attachTranslationProviderConfig, getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';
import {attachTranslationSourcePrivacy, getTranslationSourcePrivacy} from '@/src/services/translation/requestPrivacy';
import {serializeTranslationError} from '@/src/services/translation/errors';
import {hasConfiguredIncognitoRoute, lockIncognitoRoute} from '@/src/core/config/incognitoRoute';
import {incognitoInputRuntime, nativeInputSender} from './helpers/incognitoInputRuntime';
import {prepareAreaTextTranslation, prepareAreaVisionRecognition} from '@/src/features/area-translation/services/textTranslation';
import {createImageTranslationBackgroundHandlers} from '@/src/features/image-translation/background/handlers';
import {createSelectionWordLookupHandler, type WordCardData} from '@/src/features/selection-translation/background/wordLookupHandler';
import {createModelVisionProbe} from '@/src/services/translation/visionProbe';
import * as inputHandlers from '@/src/features/input-translation/background/handler';
import {createTranslationRequestFallback, createTranslationRequestRegistry, type TranslationRequestContext} from '@/src/app/background/handlers/translation';
import {attachTranslationGlossaryContext, attachTranslationRequestControl, getTranslationRequestControl} from '@/src/services/translation/requestSnapshot';
import {createTranslationBroker} from '@/src/services/translation/broker';
vi.mock('@/src/services/config/store', () => ({config: {}}));
const input = {type: 'inputBoxTranslation' as const, text: 'A complete input sentence.', targetLang: 'zh-Hans'};

describe('native generic and typed input backend cancellation', () => {
    const owner = {sender: {...nativeInputSender, tab: {id: 11, incognito: true}, frameId: 0, documentId: 'document-A'}};
    it.each(['ready', 'source'].flatMap(wait => ['pending', 'resolve', 'reject'].map(late => [wait, late])))
    ('input %s cancellation settles before gate release; late %s cannot affect another request', async (wait, late) => {
        const f = incognitoInputRuntime(), registry = createTranslationRequestRegistry();
        let resolve!: (value: 'private') => void, reject!: (error: Error) => void;
        const gate = new Promise<'private'>((yes, no) => {resolve = yes; reject = no;});
        const source = vi.fn(async () => 'private' as const);
        const blockedSource = vi.fn(() => gate);
        const handler = createInputBoxTranslationHandler({ready: wait === 'ready' ? gate : Promise.resolve(),
            getConfig: f.getConfig, requestRegistry: registry,
            resolveSourcePrivacy: wait === 'source' ? blockedSource : source, translate: f.availability.translateWithCache});
        let result: unknown;
        const pending = handler.handle({...input, clientRequestId: 'never-settling'}, owner).catch(error => error);
        void pending.then(value => {result = value;});
        if (wait === 'source') await vi.waitFor(() => expect(blockedSource).toHaveBeenCalledOnce());
        expect(registry.cancel('never-settling', owner).cancelled).toBe(true);
        // The gate remains unresolved: cancellation must complete the actual handler and clear active.
        await vi.waitFor(() => expect(result).toMatchObject({name: 'AbortError'}), {timeout: 200});
        expect(registry.cancel('never-settling', owner).cancelled).toBe(false);
        expect(f.getConfig).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
        const next = createInputBoxTranslationHandler({ready: Promise.resolve(), getConfig: f.getConfig,
            requestRegistry: registry, resolveSourcePrivacy: source, translate: f.availability.translateWithCache});
        await expect(next.handle({...input, clientRequestId: 'independent'}, owner)).resolves.toMatchObject({success: true});
        const unhandled = vi.fn(); process.on('unhandledRejection', unhandled);
        try {
            if (late === 'resolve') resolve('private');
            if (late === 'reject') reject(new Error('late preparation failure'));
            await new Promise<void>(done => setImmediate(done));
            expect(unhandled).not.toHaveBeenCalled(); expect(f.provider).toHaveBeenCalledOnce();
            expect(registry.cancel('independent', owner).cancelled).toBe(false);
        } finally {process.off('unhandledRejection', unhandled);}
    });
    it.each(['pending', 'resolve', 'reject'])('real generic getContexts cancellation settles independently of late %s', async late => {
        const registry = createTranslationRequestRegistry(), f = incognitoInputRuntime();
        let resolve!: (value: unknown[]) => void, reject!: (error: Error) => void;
        const gate = new Promise<unknown[]>((yes, no) => {resolve = yes; reject = no;});
        f.nativeRuntime.getContexts.mockImplementationOnce(() => gate);
        const context = {sender: {id: nativeInputSender.id, url: 'chrome-extension://input-fixture/document.html', documentId: 'resolver-doc'}};
        const fallback = createTranslationRequestFallback<TranslationRequestContext>({requestRegistry: registry,
            resolveSourcePrivacy: f.resolveSourcePrivacy, translate: f.availability.translateWithCache, serializeError: error => error});
        let result: unknown;
        const pending = fallback.handle({origin: input.text, clientRequestId: 'never-contexts'}, context);
        void Promise.resolve(pending).then(value => {result = value;});
        await vi.waitFor(() => expect(f.nativeRuntime.getContexts).toHaveBeenCalledOnce());
        expect(registry.cancel('never-contexts', context).cancelled).toBe(true);
        await vi.waitFor(() => expect(result).toMatchObject({name: 'AbortError'}), {timeout: 200});
        expect(registry.cancel('never-contexts', context).cancelled).toBe(false);
        expect(f.provider).not.toHaveBeenCalled();
        await expect(fallback.handle({origin: input.text, clientRequestId: 'independent-contexts'}, owner)).resolves.toBe('翻译完成');
        const unhandled = vi.fn(); process.on('unhandledRejection', unhandled);
        try {
            if (late === 'resolve') resolve([{documentId: 'resolver-doc', incognito: true}]);
            if (late === 'reject') reject(new Error('late getContexts failure'));
            await new Promise<void>(done => setImmediate(done));
            expect(unhandled).not.toHaveBeenCalled(); expect(f.provider).toHaveBeenCalledOnce();
        } finally {process.off('unhandledRejection', unhandled);}
    });
    it('input consumes a rejected source promise when its resolver synchronously cancels', async () => {
        const f = incognitoInputRuntime(), registry = createTranslationRequestRegistry();
        const handler = createInputBoxTranslationHandler({ready: Promise.resolve(), getConfig: f.getConfig,
            requestRegistry: registry, translate: f.availability.translateWithCache,
            resolveSourcePrivacy: () => {registry.cancel('sync-source', owner); return Promise.reject(new Error('late source error'));}});
        await expect(handler.handle({...input, clientRequestId: 'sync-source'}, owner)).rejects.toMatchObject({name: 'AbortError'});
        await new Promise<void>(done => setImmediate(done));
        expect(registry.cancel('sync-source', owner).cancelled).toBe(false);
        expect(f.provider).not.toHaveBeenCalled();
    });
    it.each(['generic', 'input'])('%s registry keeps an already dispatched operation active until it actually settles', async kind => {
        const registry = createTranslationRequestRegistry();
        let release!: (value: string) => void;
        const translate = vi.fn(() => new Promise<string>(resolve => {release = resolve;}));
        const dependencies = {ready: Promise.resolve(), getConfig: () => incognitoInputRuntime().config,
            requestRegistry: registry, resolveSourcePrivacy: async () => 'private' as const, translate};
        const pending = kind === 'input'
            ? createInputBoxTranslationHandler(dependencies).handle({...input, clientRequestId: 'dispatched'}, owner)
            : createTranslationRequestFallback<typeof owner>({...dependencies, serializeError: error => error})
                .handle({origin: input.text, clientRequestId: 'dispatched'}, owner);
        const outcome = Promise.resolve(pending).catch(error => error);
        let settled = false; void outcome.then(() => {settled = true;});
        await vi.waitFor(() => expect(translate).toHaveBeenCalledOnce());
        expect(registry.cancel('dispatched', owner).cancelled).toBe(true);
        await new Promise<void>(done => setImmediate(done));
        expect(settled).toBe(false);
        expect(registry.cancel('dispatched', owner).cancelled).toBe(true);
        release('late operation result');
        await expect(outcome).resolves.toMatchObject({name: 'AbortError'});
        expect(registry.cancel('dispatched', owner).cancelled).toBe(false);
    });
    it.each(['generic', 'input'])('%s cancellation reaches the actual private-routed provider signal', async kind => {
        const f = incognitoInputRuntime();
        const registry = createTranslationRequestRegistry();
        let release!: (value: string) => void;
        f.setProviderResponse(new Promise(resolve => {release = resolve;}));
        const dependencies = {ready: Promise.resolve(), getConfig: f.getConfig, requestRegistry: registry,
            resolveSourcePrivacy: f.resolveSourcePrivacy, translate: f.availability.translateWithCache};
        const pending = kind === 'input'
            ? createInputBoxTranslationHandler(dependencies).handle({...input, clientRequestId: 'provider-abort'}, owner)
            : createTranslationRequestFallback<typeof owner>({...dependencies, serializeError: error => error}).handle({origin: input.text,
                serviceOverride: services.google, clientRequestId: 'provider-abort'}, owner);
        const outcome = Promise.resolve(pending).catch(error => error);
        await vi.waitFor(() => expect(f.providerRequests).toHaveLength(1));
        expect(f.providerRequests[0].serviceOverride).toBe(services.openai);
        expect(f.payloads[0].model).toBe('gpt-5.4-mini');
        registry.cancel('provider-abort', owner);
        const aborted = f.providerRequests[0].abortSignal?.aborted;
        release('late result');
        expect(aborted).toBe(true);
        await expect(outcome).resolves.toMatchObject({name: 'AbortError'});
        expect(f.getAvailabilityRequest()).not.toHaveProperty('clientRequestId');
        expect(JSON.stringify(f.cacheKeys.mock.calls)).not.toContain('provider-abort');
        expect(getTranslationRequestControl(f.getAvailabilityRequest())?.signal.aborted).toBe(true);
        expect(registry.cancel('provider-abort', owner).cancelled).toBe(false);
    });
    it.each(['ready', 'source'])('input %s wait stays active during 513 unrelated early cancels', async wait => {
        const f = incognitoInputRuntime(); const registry = createTranslationRequestRegistry();
        let hydrated!: () => void, sourced!: (value: 'private') => void;
        const ready = new Promise<void>(resolve => {hydrated = resolve;});
        const source = new Promise<'private'>(resolve => {sourced = resolve;});
        const handler = createInputBoxTranslationHandler({ready: wait === 'ready' ? ready : Promise.resolve(),
            getConfig: f.getConfig, requestRegistry: registry, resolveSourcePrivacy: () => source,
            translate: f.availability.translateWithCache} as Parameters<typeof createInputBoxTranslationHandler>[0]);
        const message = {...input, clientRequestId: 'input-wait'};
        const pending = handler.handle(message, owner).catch(error => error);
        await Promise.resolve();
        const wasActive = registry.cancel(message.clientRequestId, owner).cancelled;
        for (let index = 0; index < 513; index++) registry.cancel(`other-${index}`, owner);
        hydrated(); sourced('private');
        const result = await pending;
        expect(wasActive).toBe(true); expect(result).toMatchObject({name: 'AbortError'});
        expect(f.getConfig).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
    });
    it('exports a dedicated typed input cancel handler', () => {
        expect((inputHandlers as Record<string, unknown>).createInputBoxTranslationCancelHandler).toBeTypeOf('function');
    });
    it.each(['tab', 'frame', 'document'])('typed input rejects cross-%s cancels and remains separate from generic with the same ID', async scope => {
        const f = incognitoInputRuntime(), inputRegistry = createTranslationRequestRegistry(), genericRegistry = createTranslationRequestRegistry();
        let release!: (value: string) => void;
        f.setProviderResponse(new Promise(resolve => {release = resolve;}));
        const handler = createInputBoxTranslationHandler({ready: Promise.resolve(), getConfig: f.getConfig,
            resolveSourcePrivacy: f.resolveSourcePrivacy, translate: f.availability.translateWithCache, requestRegistry: inputRegistry});
        const cancel = inputHandlers.createInputBoxTranslationCancelHandler(inputRegistry);
        const message = {...input, clientRequestId: 'same-ID'};
        const pending = handler.handle(message, owner).catch(error => error);
        await vi.waitFor(() => expect(f.providerRequests).toHaveLength(1));
        const other = structuredClone(owner);
        if (scope === 'tab') other.sender.tab.id++;
        else if (scope === 'frame') other.sender.frameId++;
        else other.sender.documentId = 'document-B';
        const cancelMessage = {type: inputHandlers.INPUT_BOX_TRANSLATION_CANCEL_MESSAGE_TYPE, clientRequestId: 'same-ID'};
        expect(cancel.handle(cancelMessage, other).cancelled).toBe(false);
        expect(genericRegistry.cancel('same-ID', owner).cancelled).toBe(false);
        expect(f.providerRequests[0].abortSignal?.aborted).toBe(false);
        await expect(handler.handle(message, owner)).rejects.toThrow('已在使用');
        expect(cancel.handle(cancelMessage, owner).cancelled).toBe(true);
        expect(cancel.handle(cancelMessage, owner).cancelled).toBe(true);
        release('late'); await expect(pending).resolves.toMatchObject({name: 'AbortError'});
        await expect(handler.handle(message, owner)).rejects.toThrow('已在使用');
        expect(cancel.handle(cancelMessage, owner).cancelled).toBe(false);
        await expect(handler.handle({...input, clientRequestId: 'new-attempt'}, owner)).resolves.toMatchObject({success: true});
        expect(f.provider).toHaveBeenCalledTimes(2);
    });
    it('typed input validates optional IDs before hydration and handles genuinely early cancellation', async () => {
        const f = incognitoInputRuntime(), registry = createTranslationRequestRegistry();
        const handler = createInputBoxTranslationHandler({ready: new Promise(() => {}), getConfig: f.getConfig,
            translate: f.availability.translateWithCache, requestRegistry: registry});
        const cancel = inputHandlers.createInputBoxTranslationCancelHandler(registry);
        for (const clientRequestId of [null, 1, '', 'with space', 'x'.repeat(129)]) {
            await expect(handler.handle({...input, clientRequestId}, owner)).rejects.toThrow('格式无效');
            expect(() => cancel.handle({type: 'inputBoxTranslationCancel', clientRequestId}, owner)).toThrow('格式无效');
        }
        expect(() => cancel.handle({type: 'inputBoxTranslationCancel'})).toThrow('格式无效');
        expect(cancel.handle({type: 'inputBoxTranslationCancel', clientRequestId: 'early'}, owner).cancelled).toBe(false);
        await expect(handler.handle({...input, clientRequestId: 'early'}, owner)).rejects.toMatchObject({name: 'AbortError'});
        expect(f.getConfig).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
    });
    it('generic registers while real getContexts awaits', async () => {
        const registry = createTranslationRequestRegistry(), f = incognitoInputRuntime();
        let contexts!: (value: unknown[]) => void;
        f.nativeRuntime.getContexts.mockImplementation(() => new Promise(resolve => {contexts = resolve;}));
        const context = {sender: {id: nativeInputSender.id, url: 'chrome-extension://input-fixture/document.html', documentId: 'resolver-doc'}};
        const fallback = createTranslationRequestFallback<typeof context>({requestRegistry: registry,
            resolveSourcePrivacy: f.resolveSourcePrivacy, translate: f.availability.translateWithCache, serializeError: error => error});
        const pending = fallback.handle({origin: input.text, clientRequestId: 'contexts'}, context);
        await vi.waitFor(() => expect(f.nativeRuntime.getContexts).toHaveBeenCalledOnce());
        expect(registry.cancel('contexts', context).cancelled).toBe(true);
        for (let index = 0; index < 513; index++) registry.cancel(`churn-${index}`, context);
        contexts([{documentId: 'resolver-doc', incognito: true}]);
        await expect(pending).resolves.toMatchObject({name: 'AbortError'}); expect(f.provider).not.toHaveBeenCalled();
    });
    it('generic control aborts the actual broker configuration wait before cache or provider', async () => {
        let hydrated!: () => void;
        const ready = new Promise<void>(resolve => {hydrated = resolve;});
        const f = incognitoInputRuntime(dependencies => createTranslationBroker({...dependencies, ready}));
        const registry = createTranslationRequestRegistry();
        const fallback = createTranslationRequestFallback<typeof owner>({requestRegistry: registry, resolveSourcePrivacy: f.resolveSourcePrivacy,
            translate: f.availability.translateWithCache, serializeError: error => error});
        const pending = fallback.handle({origin: input.text, clientRequestId: 'config-wait'}, owner);
        await vi.waitFor(() => expect(f.getAvailabilityRequest()).toBeDefined());
        expect(registry.cancel('config-wait', owner).cancelled).toBe(true);
        for (let index = 0; index < 513; index++) registry.cancel(`config-churn-${index}`, owner);
        hydrated(); await expect(pending).resolves.toMatchObject({name: 'AbortError'});
        expect(f.cacheKeys).not.toHaveBeenCalled(); expect(f.cacheGet).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
    });
    it('generic and input with identical payload/owner/ID do not share a cancellable broker pending operation', async () => {
        const f = incognitoInputRuntime(), genericRegistry = createTranslationRequestRegistry(), inputRegistry = createTranslationRequestRegistry();
        f.config.incognitoService = services.google; f.config.incognitoModel = ''; f.config.inputBoxTranslationService = services.google;
        let release!: (value: string) => void; f.setProviderResponse(new Promise(resolve => {release = resolve;}));
        const fallback = createTranslationRequestFallback<typeof owner>({requestRegistry: genericRegistry, resolveSourcePrivacy: f.resolveSourcePrivacy,
            translate: f.availability.translateWithCache, serializeError: error => error});
        const generic = fallback.handle({origin: input.text, targetLanguage: input.targetLang, sourceLanguage: 'auto',
            serviceOverride: services.google, enableAIContext: false, glossaryIds: [], useCache: true, clientRequestId: 'identical'}, owner);
        await vi.waitFor(() => expect(f.providerRequests).toHaveLength(1));
        const handler = createInputBoxTranslationHandler({ready: Promise.resolve(), getConfig: f.getConfig, requestRegistry: inputRegistry,
            resolveSourcePrivacy: f.resolveSourcePrivacy, translate: f.availability.translateWithCache});
        const typed = handler.handle({...input, clientRequestId: 'identical'}, owner).catch(error => error);
        await vi.waitFor(() => expect(f.providerRequests).toHaveLength(2));
        inputRegistry.cancel('identical', owner);
        expect(f.providerRequests[0].abortSignal?.aborted).toBe(false); expect(f.providerRequests[1].abortSignal?.aborted).toBe(true);
        release('generic succeeds'); await expect(generic).resolves.toBe('generic succeeds'); await expect(typed).resolves.toMatchObject({name: 'AbortError'});
    });
});

describe('typed input native handler → availability → broker → captured provider', () => {
    it('private route wins over input service/model and preserves supported input prompts', async () => {
        const f = incognitoInputRuntime();
        expect(await f.listener({...input, incognito: false, serviceOverride: services.google, modelOverride: 'spoof'}, nativeInputSender)).toEqual({success: true, translatedText: '翻译完成'});
        expect(f.getConfig).toHaveBeenCalledOnce(); expect(f.provider).toHaveBeenCalledOnce();
        expect(f.cacheKeys.mock.calls[0][0]).toMatchObject({service: services.openai, model: 'gpt-5.4-mini'});
        expect(f.payloads[0]).toMatchObject({model: 'gpt-5.4-mini'});
        expect(f.payloads[0].messages).toEqual(expect.arrayContaining([expect.objectContaining({role: 'system', content: 'INPUT_SYSTEM'})]));
        expect(JSON.stringify(f.payloads[0].messages)).toContain('INPUT');
        expect(getTranslationSourcePrivacy(f.getAvailabilityRequest()!)).toBe('private');
        expect(Object.isFrozen(f.snapshots[0])).toBe(true);
    });
    it('private no-model machine route never receives AI input prompts or the ordinary input model', async () => {
        const f = incognitoInputRuntime(); f.config.incognitoService = services.google; f.config.incognitoModel = '';
        f.config.user_role[services.google] = 'GLOBAL_MACHINE_USER'; f.config.system_role[services.google] = 'GLOBAL_MACHINE_SYSTEM';
        expect(await f.handler.handle(input, {sender: nativeInputSender})).toEqual({success: true, translatedText: '翻译完成'});
        expect(f.providerRequests[0]).toMatchObject({serviceOverride: services.google}); expect(f.providerRequests[0].modelOverride).toBe('');
        expect(f.payloads[0]).toEqual({q: input.text});
        expect(f.snapshots[0].user_role[services.google]).toBe('GLOBAL_MACHINE_USER'); expect(f.snapshots[0].system_role[services.google]).toBe('GLOBAL_MACHINE_SYSTEM');
    });
    it('private native MT model preserves its protocol prompt policy', async () => {
        const f = incognitoInputRuntime(); f.config.incognitoService = services.tongyi; f.config.incognitoModel = 'qwen-mt-plus';
        f.config.user_role[services.tongyi] = 'MT_USER'; f.config.system_role[services.tongyi] = 'MT_SYSTEM';
        await f.handler.handle(input, {sender: nativeInputSender});
        expect(f.cacheKeys.mock.calls[0][0]).toMatchObject({service: services.tongyi, model: 'qwen-mt-plus'});
        expect(f.snapshots[0].user_role[services.tongyi]).toBe('MT_USER'); expect(f.snapshots[0].system_role[services.tongyi]).toBe('MT_SYSTEM');
    });
    it('explicit native regular preserves ordinary input choices even with malformed private policy', async () => {
        const f = incognitoInputRuntime(); f.config.incognitoService = 'deleted'; f.config.incognitoModel = 'missing';
        await f.handler.handle(input, {sender: {...nativeInputSender, tab: {incognito: false}}});
        expect(f.payloads[0].model).toBe(currentModelIds.deepseek);
        expect(f.cacheKeys.mock.calls[0][0]).toMatchObject({service: services.deepseek, model: currentModelIds.deepseek});
        expect(f.snapshots[0].system_role[services.deepseek]).toBe('INPUT_SYSTEM');
    });
    it('unknown source and payload privacy spoof fail before cache key/cache/provider; missing resolver also fails safely', async () => {
        const f = incognitoInputRuntime();
        expect(await f.listener({...input, incognito: true, sender: nativeInputSender}, {id: nativeInputSender.id})).toMatchObject({success: false, errorCode: 'TRANSLATION_SOURCE_UNKNOWN'});
        const unbound = createInputBoxTranslationHandler({ready: Promise.resolve(), getConfig: () => f.config, translate: f.availability.translateWithCache});
        await expect(unbound.handle(input)).rejects.toMatchObject({code: 'TRANSLATION_SOURCE_UNKNOWN', retryable: false});
        expect(f.cacheKeys).not.toHaveBeenCalled(); expect(f.cacheGet).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
    });
    it.each([
        {incognitoService: services.openai, incognitoModel: ''},
        {incognitoService: 'custom:deleted', incognitoModel: 'saved'},
        {incognitoService: services.localTranslation, incognitoModel: 'unavailable'},
        {incognitoService: null, incognitoModel: 'gpt-5.4-mini'},
        {customBody: {[services.openai]: '{"model":"conflicting"}'}},
    ])('private invalid/conflicting routes never fall back to ordinary input %#', async policy => {
        const f = incognitoInputRuntime(); Object.assign(f.config, policy);
        await expect(f.handler.handle(input, {sender: nativeInputSender})).rejects.toThrow();
        expect(f.cacheKeys).not.toHaveBeenCalled(); expect(f.cacheGet).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
    });
    it('reads config once after hydration and source resolution, then freezes route and prompts before cache await', async () => {
        const f = incognitoInputRuntime(); let hydrated!: () => void, sourced!: (value: 'private') => void, cached!: (value: null) => void;
        const ready = new Promise<void>(resolve => {hydrated = resolve;});
        const source = new Promise<'private'>(resolve => {sourced = resolve;});
        f.cacheGet.mockImplementationOnce(() => new Promise(resolve => {cached = resolve;}));
        const handler = createInputBoxTranslationHandler({ready, getConfig: f.getConfig, resolveSourcePrivacy: () => source, translate: f.availability.translateWithCache});
        const pending = handler.handle(input, {sender: nativeInputSender}); expect(f.getConfig).not.toHaveBeenCalled();
        hydrated(); await Promise.resolve(); expect(f.getConfig).not.toHaveBeenCalled();
        f.config.customModels[services.openai] = ['captured-private'];
        f.config.incognitoModel = 'captured-private'; sourced('private');
        await vi.waitFor(() => expect(f.cacheGet).toHaveBeenCalledOnce()); expect(f.getConfig).toHaveBeenCalledOnce();
        f.config.incognitoService = services.google; f.config.incognitoModel = ''; f.config.inputBoxTranslationSystemPrompt = 'LATE_SYSTEM';
        cached(null); await pending;
        expect(f.payloads[0].model).toBe('captured-private'); expect(f.snapshots[0].system_role[services.openai]).toBe('INPUT_SYSTEM');
    });
    it('an already locked route keeps its captured model before input capability checks', async () => {
        const f = incognitoInputRuntime();
        const locked = lockIncognitoRoute(f.config, {service: services.openai, model: 'gpt-5.4-mini'});
        const request = createInputBoxTranslationRequest(locked, input.text, input.targetLang, 'private');
        await f.availability.translateWithCache(request);
        expect(f.payloads[0].model).toBe('gpt-5.4-mini');
    });
    it('private source with both fields unset preserves ordinary input overrides, while missing context is unknown', async () => {
        const f = incognitoInputRuntime(); f.config.incognitoService = ''; f.config.incognitoModel = '';
        await f.handler.handle(input, {sender: nativeInputSender});
        expect(f.payloads[0].model).toBe(currentModelIds.deepseek);
        f.config.incognitoService = services.google;
        await expect(f.handler.handle(input)).rejects.toMatchObject({code: 'TRANSLATION_SOURCE_UNKNOWN'});
    });
    it('actual availability wrapper preserves non-enumerable source and provider snapshot descriptors', async () => {
        const f = incognitoInputRuntime(); const request = createInputBoxTranslationRequest(f.config, input.text, input.targetLang, 'private');
        attachTranslationGlossaryContext(request, {pageUrl: 'https://captured.invalid/', context: 'page'});
        attachTranslationRequestControl(request, {signal: new AbortController().signal, ownershipKey: 'descriptor-owner'});
        for (const key of Object.getOwnPropertySymbols(request)) Object.defineProperty(request, key, {...Object.getOwnPropertyDescriptor(request, key), enumerable: false});
        await f.availability.translateWithCache(request);
        const forwarded = f.getAvailabilityRequest()!;
        expect(getTranslationSourcePrivacy(forwarded)).toBe('private');
        for (const key of Object.getOwnPropertySymbols(request)) expect(Object.getOwnPropertyDescriptor(forwarded, key)?.enumerable).toBe(false);
        expect(getTranslationProviderConfig(forwarded, f.config as never)).toBe(getTranslationProviderConfig(request, f.config as never));
        expect(f.payloads[0].model).toBe('gpt-5.4-mini');
        expect(f.snapshots[0].glossaryMatchContext?.pageUrl).toBe('https://captured.invalid/');
    });
});

describe('native broker admission containment', () => {
    it.each(['unknown', undefined] as const)('live policy and attached snapshot independently protect %s source', async privacy => {
        for (const direction of ['live', 'snapshot'] as const) {
            const f = incognitoInputRuntime(); const snapshot = createTranslationProviderConfigSnapshot({...f.config,
                ...(direction === 'live' ? {incognitoService: '', incognitoModel: ''} : {})});
            if (direction === 'snapshot') {f.config.incognitoService = ''; f.config.incognitoModel = '';}
            let request = attachTranslationProviderConfig({origin: input.text}, snapshot);
            if (privacy) request = attachTranslationSourcePrivacy(request, privacy);
            let error: unknown; try {await f.broker.translateWithCache(request);} catch (value) {error = value;}
            expect(serializeTranslationError(error)).toMatchObject({code: 'TRANSLATION_SOURCE_UNKNOWN', retryable: false, kind: 'bad-request'});
            expect(f.cacheKeys).not.toHaveBeenCalled(); expect(f.cacheGet).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
        }
    });
    it('both genuinely unset preserve ordinary behavior for missing/unknown source', async () => {
        for (const fields of [{}, {incognitoService: '', incognitoModel: ''}, {incognitoService: undefined, incognitoModel: undefined}]) {
            expect(hasConfiguredIncognitoRoute(fields)).toBe(false);
            for (const privacy of ['unknown', undefined] as const) {
                const f = incognitoInputRuntime(); Object.assign(f.config, {incognitoService: undefined, incognitoModel: undefined}, fields);
                const request = {origin: input.text, serviceOverride: services.deepseek};
                expect(await f.broker.translateWithCache(privacy ? attachTranslationSourcePrivacy(request, privacy) : request)).toBe('翻译完成');
            }
        }
    });
    it.each([{incognitoService: null}, {incognitoService: false}, {incognitoService: '' ,incognitoModel: false}, {incognitoModel: 'dangling'}, {incognitoService: 42}])('malformed policy still requires source %#', async fields => {
        expect(hasConfiguredIncognitoRoute(fields)).toBe(true);
        const f = incognitoInputRuntime(); Object.assign(f.config, {incognitoService: '', incognitoModel: ''}, fields);
        await expect(f.broker.translateWithCache({origin: input.text})).rejects.toMatchObject({retryable: false, code: 'TRANSLATION_SOURCE_UNKNOWN'});
        expect(f.provider).not.toHaveBeenCalled();
    });
    it('explicit regular does not validate private policy and marked requests retain their captured policy', async () => {
        const f = incognitoInputRuntime(); f.config.incognitoService = 'invalid';
        await f.broker.translateWithCache(attachTranslationSourcePrivacy({origin: input.text, serviceOverride: services.deepseek}, 'regular'));
        const ordinarySnapshot = createTranslationProviderConfigSnapshot({...f.config, incognitoService: '', incognitoModel: ''});
        const oldRequest = attachTranslationProviderConfig(attachTranslationSourcePrivacy({origin: 'A different captured sentence.', serviceOverride: services.deepseek}, 'private'), ordinarySnapshot);
        f.config.incognitoService = services.openai; f.config.incognitoModel = 'gpt-5.4-mini';
        await f.broker.translateWithCache(oldRequest);
        expect(f.providerRequests[1].serviceOverride).toBe(services.deepseek);
    });
    it('userscript native capability false exempts unmarked/unknown configured policy through the real broker', async () => {
        vi.resetModules(); vi.doMock('@/src/core/config/incognitoRoute', async () => ({...await vi.importActual<typeof import('@/src/core/config/incognitoRoute')>('@/src/core/config/incognitoRoute'), NATIVE_PRIVATE_ROUTE_SUPPORTED: false}));
        try {
            const privacy = await import('@/src/services/translation/requestPrivacy');
            const broker = await import('@/src/services/translation/broker');
            const f = incognitoInputRuntime(broker.createTranslationBroker);
            expect(() => privacy.assertTranslationSourcePrivacy({}, f.config, f.config)).not.toThrow();
            const typedInput = await import('@/src/features/input-translation/background/handler');
            const contentInput = await import('@/src/features/input-translation/content');
            const sourceResolver = vi.fn(async () => 'private' as const);
            const handler = typedInput.createInputBoxTranslationHandler({ready: Promise.resolve(), getConfig: f.getConfig,
                resolveSourcePrivacy: sourceResolver, translate: f.availability.translateWithCache});
            await handler.handle(input, {sender: nativeInputSender});
            expect(sourceResolver).not.toHaveBeenCalled(); expect(f.payloads[0].model).toBe(currentModelIds.deepseek);
            expect(contentInput.inputBoxTranslationConfigKey(f.config)).toBe(contentInput.inputBoxTranslationConfigKey({...f.config, incognitoService: '', incognitoModel: ''}));

            expect(await f.broker.translateWithCache({origin: input.text, serviceOverride: services.deepseek})).toBe('翻译完成');
            expect(await f.broker.translateWithCache(privacy.attachTranslationSourcePrivacy({origin: 'Another complete input sentence.', serviceOverride: services.deepseek}, 'unknown'))).toBe('翻译完成');
        } finally {vi.doUnmock('@/src/core/config/incognitoRoute'); vi.resetModules();}
    });
});


describe('unwired feature containment through actual availability and broker', () => {
    const ordinaryContext = {sender: {id: 'input-fixture', tab: {id: 4, incognito: false}, url: 'https://ordinary.invalid/page'}};
    const options = () => ({requestId: 'containment-fixture', timeoutMs: 10_000, signal: new AbortController().signal});
    const recognized = {image: 'data:image/png;base64,AA==', lines: [{text: 'A complete input sentence.', bbox: {x0: 0, y0: 0, x1: 100, y1: 10}}]};
    it.each(['standard', 'ai'] as const)('area %s path stays unmarked and blocks even for an ordinary-page context', async mode => {
        const f = incognitoInputRuntime(); f.config.areaTranslationMode = mode; f.config.areaTranslationService = services.openai;
        let requestSource: unknown = 'not-called';
        const run = prepareAreaTextTranslation(f.config, 'en', '', {pageUrl: ordinaryContext.sender.url, context: 'page'},
            request => {requestSource = getTranslationSourcePrivacy(request); return f.availability.translateWithCache(request);});
        await expect(run(recognized, options())).rejects.toMatchObject({code: 'TRANSLATION_SOURCE_UNKNOWN', retryable: false});
        expect(requestSource).toBeUndefined(); expect(f.cacheKeys).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
    });
    it('area cropped vision transcription stops before cache and provider without a source marker', async () => {
        const f = incognitoInputRuntime(); f.config.areaTranslationService = services.openai;
        const run = prepareAreaVisionRecognition(f.config, 'en', '', async () => recognized, f.availability.translateWithCache);
        await expect(run(recognized.image, {left: 0, top: 0, width: 10, height: 10, viewportWidth: 20, viewportHeight: 20}, options()))
            .rejects.toMatchObject({code: 'TRANSLATION_SOURCE_UNKNOWN', retryable: false});
        expect(f.cacheKeys).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
    });
    it.each([true, false])('actual image text handler batch=%s remains contained on a regular page; clearing enables new requests', async batch => {
        const f = incognitoInputRuntime(); const sources: unknown[] = [];
        const handler = createImageTranslationBackgroundHandlers({assertLanguagesDownloaded: vi.fn(), translateImage: vi.fn(), fetchImage: vi.fn(),
            translateTexts: request => {sources.push(getTranslationSourcePrivacy(request)); return f.availability.translateWithCache(request);},
            getTranslationService: () => services.google, supportsBatchTranslation: () => batch, downloadLanguages: vi.fn(), markLanguagesDownloaded: vi.fn()})
            .find(handler => handler.type === 'fluentReadImageTranslateTexts')!;
        const message = {type: 'fluentReadImageTranslateTexts' as const, texts: ['A complete input sentence.'], requestId: 'image-containment'};
        await expect(handler.handle(message, ordinaryContext)).rejects.toThrow('无法确认');
        expect(sources).toEqual([undefined]); expect(f.cacheKeys).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
        if (!batch) {
            f.config.incognitoService = ''; f.config.incognitoModel = '';
            expect(await handler.handle({...message, requestId: 'new-image-request'}, ordinaryContext)).toEqual({success: true, translations: ['翻译完成']});
        }
    });
    it('word-card auxiliary translation is contained while the independent dictionary lookup still executes', async () => {
        const f = incognitoInputRuntime(); const warn = vi.fn();
        const card: WordCardData = {word: 'fixture', normalizedWord: 'fixture', sources: [], phonetics: [], meanings: [{partOfSpeech: 'noun', definitions: [{definition: 'A complete input sentence.'}]}]};
        const lookupWord = vi.fn(async () => card);
        const handler = createSelectionWordLookupHandler({lookupWord, getDefaultTargetLanguage: () => 'zh-Hans', warn,
            translate: request => f.availability.translateWithCache({...request, serviceOverride: services.google})});
        const result = await handler.handle({type: 'selectionWordLookup', word: 'fixture'});
        expect(lookupWord).toHaveBeenCalledOnce(); expect(result.data?.meanings[0].definitions[0].definition).toBe('A complete input sentence.');
        expect(result.data?.meanings[0].definitions[0].translatedDefinition).toBeUndefined();
        expect(warn.mock.calls[0][1]).toMatchObject({code: 'TRANSLATION_SOURCE_UNKNOWN', retryable: false});
        expect(f.cacheKeys).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
    });
    it('actual forced vision probe remains contained and never writes a supported/unsupported capability', async () => {
        const f = incognitoInputRuntime(); const storage = {load: vi.fn(async () => []), save: vi.fn(async (_records: unknown[]) => {})};
        const probe = createModelVisionProbe({translate: f.availability.translateWithCache, storage, random: () => new Uint8Array([1, 2, 3])});
        await expect(probe.resolve(f.config, services.openai, 'gpt-5.4-mini', {force: true}))
            .rejects.toMatchObject({code: 'TRANSLATION_SOURCE_UNKNOWN', retryable: false});
        expect(f.cacheKeys).not.toHaveBeenCalled(); expect(f.provider).not.toHaveBeenCalled();
        expect(storage.save.mock.calls.every(call => call[0].length === 0)).toBe(true);
    });
});
