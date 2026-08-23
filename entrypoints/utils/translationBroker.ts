import {_service} from '@/entrypoints/service/_service';
import {config, configReady} from '@/entrypoints/utils/config';
import {getMimoEndpoint, MINIMAX_ENDPOINTS} from '@/entrypoints/utils/constant';
import {getMissingCredentialMessage} from '@/entrypoints/utils/configValidation';
import {resolveConfiguredModel, services, servicesType} from '@/entrypoints/utils/option';
import {buildPageSummaryPrompt, buildPageSummarySystemPrompt} from '@/entrypoints/utils/template';
import {
    buildTranslationCacheKey,
    translationCache,
} from '@/entrypoints/utils/translationCache';
import {
    getTranslationLanguages,
    type TranslationLanguageOverride,
} from '@/entrypoints/utils/translationLanguage';

export interface TranslationRequestMessageBase {
    context?: string;
    pageContext?: string;
    useCache?: boolean;
    /** 视频字幕使用的独立翻译服务；普通网页请求不设置。 */
    serviceOverride?: string;
    /** 翻译中心仅对当前请求使用的语言，不改变全局设置。 */
    sourceLanguage?: string;
    targetLanguage?: string;
}

export type TranslationSingleRequestMessage = TranslationRequestMessageBase & {origin: string};
export type TranslationBatchRequestMessage = TranslationRequestMessageBase & {origin: string[]};
export type TranslationRequestMessage = TranslationSingleRequestMessage | TranslationBatchRequestMessage;

type CacheRequestMode = 'single' | 'batch';

function getSelectedModel(service: string): string {
    return resolveConfiguredModel(config.model[service], config.customModel[service]);
}

function isAIContextEnabled(service = config.service): boolean {
    return config.enableAIContext && servicesType.isUseAIContext(service, getSelectedModel(service));
}

function getProviderEndpoint(service: string): string {
    if (config.proxy[service]) return config.proxy[service];
    if (service === 'custom') return config.custom;
    if (service === 'deeplx') return config.deeplx;
    if (service === 'newapi') return config.newApiUrl;
    if (service === services.minimax) {
        const plan = config.minimaxBillingPlan === 'token-plan' ? 'token-plan' : 'payg';
        const region = config.minimaxRegion === 'cn' ? 'cn' : 'global';
        return MINIMAX_ENDPOINTS[plan][region];
    }
    if (service === services.mimo) {
        return getMimoEndpoint(config.mimoBillingPlan, config.mimoRegion);
    }
    return '';
}

function buildCacheKey(
    origin: string | string[],
    context: string,
    pageContext: string,
    mode: CacheRequestMode,
    serviceOverride?: string,
    languageOverride?: TranslationLanguageOverride,
): string {
    const service = serviceOverride || config.service;
    const {sourceLanguage, targetLanguage} = getTranslationLanguages(languageOverride);

    return buildTranslationCacheKey({
        requestMode: mode,
        sourceText: origin,
        sourceLanguage,
        targetLanguage,
        service,
        model: getSelectedModel(service),
        endpoint: getProviderEndpoint(service),
        azureOpenaiEndpoint: service === 'azureOpenai' ? config.azureOpenaiEndpoint : undefined,
        robotId: service === 'cozecom' || service === 'cozecn'
            ? config.robot_id[service] || ''
            : undefined,
        customBody: config.customBody[service] || '',
        systemRole: config.system_role[service] || '',
        userRole: config.user_role[service] || '',
        deepseekApiType: config.deepseekApiType,
        deepseekThinkingMode: config.deepseekThinkingMode,
        // DeepL sends the title context to the provider. AI adapters send the
        // bounded webpage context through their prompt templates.
        context: service === 'deepL' ? context : undefined,
        pageContext: isAIContextEnabled(service) ? pageContext : undefined,
    });
}

function isCacheEnabled(message: TranslationRequestMessage): boolean {
    return config.useCache && message.useCache !== false;
}

function isCacheableResult(origin: string, result: unknown): result is string {
    return typeof result === 'string' && result.length > 0 && result !== origin;
}

function getTranslationService(serviceName = config.service) {
    const service = _service[serviceName];
    if (!service) {
        throw new Error(`未找到翻译服务适配器: ${serviceName}`);
    }
    return service;
}

const pendingTranslations = new Map<string, Promise<string>>();
const pendingBatches = new Map<string, Promise<string[]>>();
const pageSummaryCache = new Map<string, string>();
const pendingPageSummaries = new Map<string, Promise<string>>();
const PAGE_SUMMARY_CACHE_SIZE = 8;
const PAGE_SUMMARY_LIMIT = 1200;

function buildPageSummaryCacheKey(pageContext: string, service = config.service): string {
    return buildTranslationCacheKey({
        requestMode: 'page-summary',
        sourceLanguage: config.from,
        targetLanguage: '',
        sourceText: pageContext,
        service,
        model: getSelectedModel(service),
        endpoint: getProviderEndpoint(service),
        customBody: config.customBody[service] || '',
    });
}

function cachePageSummary(key: string, value: string): void {
    if (pageSummaryCache.size >= PAGE_SUMMARY_CACHE_SIZE) {
        const oldestKey = pageSummaryCache.keys().next().value;
        if (oldestKey) pageSummaryCache.delete(oldestKey);
    }
    pageSummaryCache.set(key, value);
}

/**
 * Generate one short summary per page context and reuse it for the paragraphs
 * that follow. A summary failure is deliberately non-fatal: the raw readable
 * context is still useful and the ordinary translation must continue.
 */
async function addPageSummary(pageContext: string, service = config.service): Promise<string> {
    if (!isAIContextEnabled(service) || !pageContext.trim()) {
        return '';
    }

    const key = buildPageSummaryCacheKey(pageContext, service);
    const cached = pageSummaryCache.get(key);
    if (cached) return cached;

    const existing = pendingPageSummaries.get(key);
    if (existing) return existing;

    const request = (async () => {
        try {
            // Keep summaries across MV3 service-worker restarts. Cache failures
            // are swallowed by translationCache and fall through to generation.
            const persisted = await translationCache.get(key);
            if (persisted !== null) {
                cachePageSummary(key, persisted);
                return persisted;
            }

            const result = await getTranslationService(service)({
                origin: '',
                context: '',
                pageContext: '',
                summaryPrompt: buildPageSummaryPrompt(pageContext),
                summarySystemPrompt: buildPageSummarySystemPrompt(),
                serviceOverride: service,
            });
            const summary = typeof result === 'string' ? result.trim().slice(0, PAGE_SUMMARY_LIMIT) : '';
            if (!summary) {
                cachePageSummary(key, pageContext);
                return pageContext;
            }

            const summarizedContext = `Page summary (AI-generated reference):\n${summary}\n\n${pageContext}`.slice(0, 4000);
            cachePageSummary(key, summarizedContext);
            await translationCache.set(key, summarizedContext);
            return summarizedContext;
        } catch (error) {
            console.warn('[FluentRead] page context summary failed; using extracted context:', error);
            cachePageSummary(key, pageContext);
            return pageContext;
        }
    })();

    pendingPageSummaries.set(key, request);
    void request.then(
        () => {
            if (pendingPageSummaries.get(key) === request) pendingPageSummaries.delete(key);
        },
        () => {
            if (pendingPageSummaries.get(key) === request) pendingPageSummaries.delete(key);
        },
    );
    return request;
}

async function translateSingleWithCache(
    message: TranslationSingleRequestMessage,
    context: string,
    pageContext: string,
    useCache: boolean,
): Promise<string> {
    const service = message.serviceOverride || config.service;
    if (!useCache) {
        return getTranslationService(service)({...message, context, pageContext});
    }

    const key = buildCacheKey(message.origin, context, pageContext, 'single', service, message);
    const existing = pendingTranslations.get(key);
    if (existing) return existing;

    const request = (async () => {
        const cached = await translationCache.get(key);
        if (cached !== null) return cached;

        const result = await getTranslationService(service)({...message, context, pageContext});
        if (isCacheableResult(message.origin, result)) {
            await translationCache.set(key, result);
        }
        return result as string;
    })();

    pendingTranslations.set(key, request);
    void request.then(
        () => {
            if (pendingTranslations.get(key) === request) pendingTranslations.delete(key);
        },
        () => {
            if (pendingTranslations.get(key) === request) pendingTranslations.delete(key);
        },
    );
    return request;
}

async function translateBatchWithCache(
    message: TranslationBatchRequestMessage,
    context: string,
    pageContext: string,
    useCache: boolean,
): Promise<string[]> {
    const service = message.serviceOverride || config.service;
    if (!useCache) {
        const result = await getTranslationService(service)({...message, context, pageContext});
        if (!Array.isArray(result)) throw new Error('批量翻译返回格式异常');
        return result as string[];
    }

    const batchKey = buildCacheKey(message.origin, context, pageContext, 'batch', service, message);
    const existing = pendingBatches.get(batchKey);
    if (existing) return existing;

    const request = (async () => {
        const cached = await Promise.all(
            message.origin.map((origin) => translationCache.get(buildCacheKey(origin, context, pageContext, 'batch', service, message))),
        );
        const missingIndexes = cached
            .map((value, index) => value === null ? index : -1)
            .filter((index) => index >= 0);

        if (missingIndexes.length === 0) {
            return cached as string[];
        }

        const missingEntries = missingIndexes.map((index) => ({
            index,
            origin: message.origin[index],
        }));
        const uniqueMissingOrigins = Array.from(
            new Map(
                missingEntries.map(({origin}) => [
                    buildCacheKey(origin, context, pageContext, 'batch', service, message),
                    origin,
                ]),
            ).values(),
        );
        const translated = await getTranslationService(service)({
            ...message,
            context,
            pageContext,
            origin: uniqueMissingOrigins,
        });
        if (!Array.isArray(translated) || translated.length !== uniqueMissingOrigins.length) {
            throw new Error('批量翻译返回数量异常');
        }

        const result = [...cached] as Array<string | null>;
        const translatedByKey = new Map(
            uniqueMissingOrigins.map((origin, index) => [
                buildCacheKey(origin, context, pageContext, 'batch', service, message),
                translated[index],
            ]),
        );
        await Promise.all(missingEntries.map(async ({index, origin}) => {
            const value = translatedByKey.get(buildCacheKey(origin, context, pageContext, 'batch', service, message));
            result[index] = value as string;
            if (isCacheableResult(origin, value)) {
                await translationCache.set(buildCacheKey(origin, context, pageContext, 'batch', service, message), value);
            }
        }));

        return result as string[];
    })();

    pendingBatches.set(batchKey, request);
    void request.then(
        () => {
            if (pendingBatches.get(batchKey) === request) pendingBatches.delete(batchKey);
        },
        () => {
            if (pendingBatches.get(batchKey) === request) pendingBatches.delete(batchKey);
        },
    );
    return request;
}

/**
 * Runtime-neutral translation dispatcher shared by the extension background
 * and the userscript entrypoint. It deliberately has no browser messaging API.
 */
export async function translateWithCache(message: TranslationRequestMessage): Promise<string | string[]> {
    await configReady;
    const serviceOverride = message.serviceOverride;
    const selectedService = serviceOverride || config.service;
    const missingCredentialMessage = getMissingCredentialMessage(selectedService, config);
    if (missingCredentialMessage) throw new Error(missingCredentialMessage);
    if (serviceOverride && !servicesType.machine.has(serviceOverride) && !servicesType.isAI(serviceOverride)) {
        throw new Error('视频字幕翻译服务不可用，请在设置中选择已配置的机器翻译或 AI 服务');
    }
    const context = typeof message.context === 'string' ? message.context : '';
    const rawPageContext = typeof message.pageContext === 'string' ? message.pageContext : '';
    const pageContext = await addPageSummary(rawPageContext, selectedService);
    const useCache = isCacheEnabled(message);

    if (Array.isArray(message.origin)) {
        return translateBatchWithCache(message as TranslationBatchRequestMessage, context, pageContext, useCache);
    }
    return translateSingleWithCache(message as TranslationSingleRequestMessage, context, pageContext, useCache);
}

/** Clear both persisted translations and the in-memory page-summary cache. */
export async function clearTranslationCache(): Promise<void> {
    await translationCache.clear();
    pageSummaryCache.clear();
}

/** Run the persistent cache's TTL/size maintenance without browser alarms. */
export async function cleanupTranslationCache(): Promise<void> {
    await translationCache.cleanup();
}
