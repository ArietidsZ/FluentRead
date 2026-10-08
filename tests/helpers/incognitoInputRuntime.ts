import {vi} from 'vitest';
import {Config} from '@/src/core/config/model';
import {currentModelIds, customModelString, services, servicesType} from '@/src/core/config/catalog';
import {resolveNativeSourcePrivacy, type NativeMessageSender} from '@/src/platform/browser/incognitoSource';
import {createInputBoxTranslationHandler, type InputBoxTranslationContext} from '@/src/features/input-translation/background/handler';
import {createTranslationBroker} from '@/src/services/translation/broker';
import {createTranslationAvailability} from '@/src/services/translation/availability';
import {commonMsgTemplate} from '@/src/services/translation/templates';
import {createTranslationProviderConfigSnapshot, getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';
import {resolveTranslationLanguages} from '@/src/core/translation/languages';
import {createBackgroundMessageRouter, createBackgroundRuntimeMessageListener} from '@/src/app/background/messageRouter';
import type {TranslationProviderRequest} from '@/src/services/translation/requestSnapshot';
import type {TranslationSingleRequestMessage} from '@/src/services/translation/types';

export const nativeInputSender: NativeMessageSender = {id: 'input-fixture', tab: {incognito: true}};
export function incognitoInputRuntime(factory = createTranslationBroker) {
    const config = new Config();
    config.service = services.google;
    config.inputBoxTranslationService = services.deepseek;
    config.inputBoxTranslationModel = currentModelIds.deepseek;
    config.inputBoxTranslationPrompt = 'INPUT {{origin}} → {{to}}';
    config.inputBoxTranslationSystemPrompt = 'INPUT_SYSTEM';
    config.incognitoService = services.openai; config.incognitoModel = 'gpt-5.4-mini';
    config.enableAIContext = false; config.useCache = true;
    const payloads: any[] = [], providerRequests: TranslationProviderRequest<string>[] = [], snapshots: ReturnType<typeof createTranslationProviderConfigSnapshot>[] = [];
    const cacheGet = vi.fn(async () => null as string | null);
    const cacheKeys = vi.fn((identity: Record<string, unknown>) => JSON.stringify(identity));
    let providerResponse: Promise<string> | undefined;
    const provider = vi.fn(async (message: Record<string, unknown>) => {
        const request = message as unknown as TranslationProviderRequest<string>;
        providerRequests.push(request);
        const snapshot = getTranslationProviderConfig(request, createTranslationProviderConfigSnapshot(config)); snapshots.push(snapshot);
        payloads.push(servicesType.isAI(request.serviceOverride!)
            ? JSON.parse(commonMsgTemplate(request.origin, undefined, undefined, undefined, request.serviceOverride,
                request.targetLanguage, request.modelOverride, snapshot))
            : {q: request.origin});
        return providerResponse ?? '翻译完成';
    });
    const providers = Object.fromEntries([services.openai, services.deepseek, services.google, services.microsoft, services.tongyi].map(service => [service, provider]));
    const broker = factory({ready: Promise.resolve(), getConfig: () => config, providers,
        cache: {get: cacheGet, set: vi.fn(async () => true), clear: vi.fn(async () => {}), cleanup: vi.fn(async () => {})},
        serviceTypes: {...servicesType, isAiSdk: service => service === services.openai},
        endpointResolver: {resolveOpenAICompatibleEndpoint: () => ({endpoint: 'https://fixture.invalid/v1/chat/completions'}), aiSdkTransportProfile: 'fixture'},
        promptBuilder: {buildPageSummaryPrompt: () => '', buildPageSummarySystemPrompt: () => ''}, getMissingCredentialMessage: () => null,
        getTranslationLanguages: override => resolveTranslationLanguages(override, {sourceLanguage: 'auto', targetLanguage: 'zh-Hans'}),
        resolveConfiguredModel: (selected, custom) => selected === customModelString ? custom ?? '' : selected ?? '', buildTranslationCacheKey: cacheKeys,
    });
    let availabilityRequest: TranslationSingleRequestMessage | undefined;
    const availability = createTranslationAvailability({ready: Promise.resolve(), getConfig: () => config, subscribe: () => () => {},
        translate: message => {availabilityRequest = message as TranslationSingleRequestMessage; return broker.translateWithCache(message);},
    });
    const requests: TranslationSingleRequestMessage[] = [];
    const getConfig = vi.fn(() => config);
    const nativeRuntime = {id: nativeInputSender.id, getURL: () => 'chrome-extension://input-fixture/', getContexts: vi.fn(async () => [] as unknown[])};
    const resolveSourcePrivacy = (sender: NativeMessageSender | undefined) => resolveNativeSourcePrivacy(sender, nativeRuntime);
    const handler = createInputBoxTranslationHandler({ready: Promise.resolve(), getConfig, resolveSourcePrivacy,
        translate: request => {requests.push(request); return availability.translateWithCache(request);},
    });
    const listener = createBackgroundRuntimeMessageListener(createBackgroundMessageRouter([handler]), sender => ({sender} as InputBoxTranslationContext));
    return {config, getConfig, broker, availability, handler, listener, requests, provider, providers, providerRequests, snapshots, payloads, cacheGet, cacheKeys,
        nativeRuntime, resolveSourcePrivacy, setProviderResponse: (response: Promise<string>) => {providerResponse = response;}, getAvailabilityRequest: () => availabilityRequest};
}
