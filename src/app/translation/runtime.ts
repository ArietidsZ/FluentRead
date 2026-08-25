/**
 * @file src/app/translation/runtime.ts
 * 文件职责：在 app 层创建扩展与 userscript 共用的翻译 broker 单例，把配置、provider registry、缓存、端点和提示词依赖完整注入。
 * 主要内容：连接 configReady 与配置快照、服务类型和模型解析、Minimax/MiMo/OpenAI 兼容端点、页面摘要 prompt、语言推导、凭据错误及缓存 key，导出 translateWithCache、clear 与 cleanup。
 * 模块边界：本文件只做 broker composition，不解析 browser 消息、不实现 provider HTTP，也不管理页面队列；请求协议在 background handler，算法与存储分别位于 services/providers。
 */
import {translationProviderRegistry} from '@/src/providers/translation/registry';
import {AI_SDK_TRANSPORT_PROFILE, resolveOpenAICompatibleEndpoint} from '@/src/providers/translation/ai-sdk/endpoints';
import {config, configReady} from '@/src/services/config/store';
import {getMimoEndpoint, MINIMAX_ENDPOINTS} from '@/src/core/config/constants';
import {getMissingCredentialMessage} from '@/src/core/config/validation';
import {resolveConfiguredModel, services, servicesType} from '@/src/core/config/catalog';
import {buildPageSummaryPrompt, buildPageSummarySystemPrompt} from '@/src/core/translation/prompts';
import {getTranslationLanguages} from '@/src/services/translation/languages';
import {createTranslationBroker} from '@/src/services/translation/broker';
import {buildTranslationCacheKey, translationCache} from '@/src/services/translation/cache';

export type {
    TranslationBatchRequestMessage,
    TranslationBroker,
    TranslationBrokerDependencies,
    TranslationProvider,
    TranslationProviderRegistry,
    TranslationRequestMessage,
    TranslationRequestMessageBase,
    TranslationSingleRequestMessage,
} from '@/src/services/translation/broker';

const broker = createTranslationBroker({
    ready: configReady,
    getConfig: () => config,
    providers: translationProviderRegistry,
    cache: translationCache,
    serviceIds: {
        minimax: services.minimax,
        mimo: services.mimo,
    },
    serviceTypes: servicesType,
    endpointResolver: {
        resolveOpenAICompatibleEndpoint,
        getMimoEndpoint,
        minimaxEndpoints: MINIMAX_ENDPOINTS,
        aiSdkTransportProfile: AI_SDK_TRANSPORT_PROFILE,
    },
    promptBuilder: {
        buildPageSummaryPrompt,
        buildPageSummarySystemPrompt,
    },
    getMissingCredentialMessage,
    getTranslationLanguages,
    resolveConfiguredModel,
    buildTranslationCacheKey,
});

/** 扩展与 userscript 共用的翻译 broker singleton。 */
export const translateWithCache = broker.translateWithCache;
export const clearTranslationCache = broker.clearTranslationCache;
export const cleanupTranslationCache = broker.cleanupTranslationCache;
