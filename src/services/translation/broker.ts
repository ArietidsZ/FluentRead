/**
 * @file src/services/translation/broker.ts
 *
 * 文件职责：编排翻译请求的配置快照、语言解析、缓存、请求去重、超时与 provider 调用，是后台翻译用例的中心服务。
 * 主要内容：createTranslationBroker 同时支持单条、批量和页面摘要，验证 provider 返回数量和类型，以完整身份构建缓存键，并在清理代次与剩余 deadline 下管理 pending 请求。 可核对的公开符号包括 createTranslationBroker、聚合导出。
 * 模块边界：本文件位于翻译 application service 层，负责用例编排和端口契约；不挂载页面 UI，且不应把某家供应商的网络细节扩散到 feature，具体 HTTP 协议由 providers/platform 实现。
 */

import type {
    TranslationBatchRequestMessage,
    TranslationBroker,
    TranslationBrokerDependencies,
    TranslationProviderConfigSnapshot,
    TranslationProvider,
    TranslationRequestMessage,
    TranslationSingleRequestMessage,
} from './types';
import {
    attachTranslationProviderConfig,
    createTranslationProviderConfigSnapshot,
    TRANSLATION_REMAINING_BUDGET,
    type TranslationRemainingBudgetContext,
} from './requestSnapshot';

export type {
    TranslationBatchRequestMessage,
    TranslationBroker,
    TranslationBrokerDependencies,
    TranslationConfigSnapshot,
    TranslationProviderConfigSnapshot,
    TranslationLanguageOverride,
    TranslationProvider,
    TranslationProviderRegistry,
    TranslationRequestMessage,
    TranslationRequestMessageBase,
    TranslationSingleRequestMessage,
} from './types';

type CacheRequestMode = 'single' | 'batch';

interface TranslationRequestExecution {
    readonly config: TranslationProviderConfigSnapshot;
    readonly service: string;
    readonly sourceLanguage: string;
    readonly targetLanguage: string;
}

const PAGE_SUMMARY_CACHE_SIZE = 8;
const PAGE_SUMMARY_LIMIT = 1200;
const DEFAULT_PROVIDER_TIMEOUT_MS = 45_000;

class TranslationProviderDeadlineError extends Error {
    constructor() {
        super('翻译请求超时');
        this.name = 'TranslationProviderDeadlineError';
    }
}

export function createTranslationBroker(deps: TranslationBrokerDependencies): TranslationBroker {
    const pendingTranslations = new Map<string, Promise<string>>();
    const pendingBatches = new Map<string, Promise<string[]>>();
    const pageSummaryCache = new Map<string, string>();
    const pendingPageSummaries = new Map<string, Promise<string>>();
    const pendingCacheWrites = new Map<Promise<unknown>, number>();
    let cacheGeneration = 0;
    const now = deps.now ?? (() => Date.now());
    const logger = deps.logger ?? console;

    function warn(message: string, error: unknown): void {
        try {
            logger.warn(message, error);
        } catch {
            // 步骤 1：诊断器是旁路依赖；自定义 logger 失败不能中断用户翻译。
        }
    }

    function config() {
        return deps.getConfig();
    }

    function getSelectedModel(
        current: TranslationProviderConfigSnapshot,
        service: string,
        modelOverride?: string,
    ): string {
        return deps.resolveConfiguredModel(
            modelOverride || current.model[service],
            modelOverride || current.customModel[service],
        );
    }

    function isAIContextEnabled(
        current: TranslationProviderConfigSnapshot,
        service: string,
        modelOverride?: string,
    ): boolean {
        return current.enableAIContext
            && deps.serviceTypes.isUseAIContext(service, getSelectedModel(current, service, modelOverride));
    }

    function getProviderEndpoint(current: TranslationProviderConfigSnapshot, service: string): string {
        if (deps.serviceTypes.isAiSdk(service)) {
            try {
                return deps.endpointResolver.resolveOpenAICompatibleEndpoint(service, current).endpoint;
            } catch {
                // 步骤 1：配置校验负责用户可见错误；缓存 key 生成必须在设置缺失时仍可完成。
                return '';
            }
        }
        if (current.proxy[service]) return current.proxy[service];
        if (service === 'custom') return current.custom;
        if (service === 'deeplx') return current.deeplx;
        if (service === 'newapi') return current.newApiUrl;
        if (service === deps.serviceIds.minimax) {
            const plan = current.minimaxBillingPlan === 'token-plan' ? 'token-plan' : 'payg';
            const region = current.minimaxRegion === 'cn' ? 'cn' : 'global';
            return deps.endpointResolver.minimaxEndpoints[plan]?.[region] || '';
        }
        if (service === deps.serviceIds.mimo) {
            return deps.endpointResolver.getMimoEndpoint(current.mimoBillingPlan, current.mimoRegion);
        }
        return '';
    }

    function buildCacheKey(
        execution: TranslationRequestExecution,
        origin: string | string[],
        context: string,
        pageContext: string,
        mode: CacheRequestMode,
        modelOverride?: string,
    ): string {
        const {config: current, service, sourceLanguage, targetLanguage} = execution;

        return deps.buildTranslationCacheKey({
            requestMode: mode,
            sourceText: origin,
            sourceLanguage,
            targetLanguage,
            service,
            model: getSelectedModel(current, service, modelOverride),
            endpoint: getProviderEndpoint(current, service),
            azureOpenaiEndpoint: service === 'azureOpenai' ? current.azureOpenaiEndpoint : undefined,
            customBody: current.customBody[service] || '',
            systemRole: current.system_role[service] || '',
            userRole: current.user_role[service] || '',
            deepseekApiType: current.deepseekApiType,
            deepseekThinkingMode: current.deepseekThinkingMode,
            transportProfile: deps.serviceTypes.isAiSdk(service)
                ? deps.endpointResolver.aiSdkTransportProfile
                : undefined,
            // 步骤 1：DeepL 把标题上下文直接发送给 provider；AI adapter 通过 prompt 注入页面上下文。
            context: service === 'deepL' ? context : undefined,
            pageContext: isAIContextEnabled(current, service, modelOverride) ? pageContext : undefined,
        });
    }

    function isCacheEnabled(current: TranslationProviderConfigSnapshot, message: TranslationRequestMessage): boolean {
        return current.useCache && message.useCache !== false;
    }

    function isCacheableResult(origin: string, result: unknown): result is string {
        return typeof result === 'string' && result.length > 0 && result !== origin;
    }

    function requireSingleResult(result: unknown): string {
        if (typeof result !== 'string') throw new Error('单条翻译返回格式异常');
        return result;
    }

    function requireBatchResult(result: unknown, expectedLength: number): string[] {
        if (!Array.isArray(result)) throw new Error('批量翻译返回格式异常');
        if (result.length !== expectedLength) throw new Error('批量翻译返回数量异常');
        if (result.some((value) => typeof value !== 'string')) {
            throw new Error('批量翻译返回格式异常');
        }
        return result;
    }

    function getTranslationService(serviceName: string): TranslationProvider {
        const service = deps.providers[serviceName];
        if (!service) throw new Error(`未找到翻译服务适配器: ${serviceName}`);
        return service;
    }

    /** 公开请求至少保留一秒，避免调用方误传 0 导致请求永远无法启动。 */
    function normalizeExternalRequestTimeoutMs(requestTimeoutMs?: number): number | undefined {
        return typeof requestTimeoutMs === 'number' && Number.isFinite(requestTimeoutMs)
            ? Math.max(1_000, Math.floor(requestTimeoutMs))
            : undefined;
    }

    /** 内部剩余预算必须保持精确，不能再次抬高到公开请求的一秒下限。 */
    function normalizeDeadlineTimeoutMs(requestTimeoutMs: number): number {
        return Math.max(1, Math.floor(requestTimeoutMs));
    }

    function getRemainingDeadlineMs(requestDeadline: number): number {
        const remaining = Math.floor(requestDeadline - now());
        if (remaining <= 0) throw new TranslationProviderDeadlineError();
        return remaining;
    }

    async function runWithinDeadline<T>(
        operation: () => Promise<T>,
        requestDeadline: number,
    ): Promise<T> {
        const remaining = getRemainingDeadlineMs(requestDeadline);
        const work = operation();

        let timer: ReturnType<typeof setTimeout>;
        const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new TranslationProviderDeadlineError()), remaining);
        });
        try {
            return await Promise.race([work, timeout]);
        } finally {
            clearTimeout(timer!);
        }
    }

    function applyRemainingDeadline<T extends TranslationRequestMessage>(
        message: T,
        requestDeadline: number,
    ): T {
        const remaining = getRemainingDeadlineMs(requestDeadline);
        return {...message, requestTimeoutMs: remaining};
    }

    function buildPendingRequestKey(cacheKey: string, requestTimeoutMs: number): string {
        const normalizedTimeoutMs = normalizeDeadlineTimeoutMs(requestTimeoutMs);
        return `${cacheKey}:timeout:${normalizedTimeoutMs}ms`;
    }

    /**
     * 把 requestTimeoutMs 落实为 broker 拥有的 provider 截止时间。
     *
     * content 端停止等待 runtime message 并不会取消 background 中的 fetch；如果只把
     * timeout 数字传给 provider，未实现 AbortSignal 的旧适配器会让 pending Map 永久
     * 保留。这里无论 provider 是否主动消费 abortSignal，都会在截止时间释放调用方和
     * pending 所有权；支持 AbortSignal 的适配器还能同步停止底层请求。
     */
    function callProviderWithinDeadline(
        execution: TranslationRequestExecution,
        message: TranslationRequestMessage,
    ): Promise<unknown> {
        const provider = getTranslationService(execution.service);
        const timeoutMs = normalizeDeadlineTimeoutMs(message.requestTimeoutMs as number);

        const controller = new AbortController();
        const providerMessage = {
            ...message,
            abortSignal: controller.signal,
        };

        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (callback: () => void) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                callback();
            };
            const timer = setTimeout(() => {
                controller.abort();
                finish(() => reject(new TranslationProviderDeadlineError()));
            }, timeoutMs);

            void Promise.resolve()
                .then(() => provider(providerMessage))
                .then(
                    (result) => finish(() => resolve(result)),
                    (error) => finish(() => reject(error)),
                );
        });
    }

    function buildPageSummaryCacheKey(
        execution: TranslationRequestExecution,
        pageContext: string,
        modelOverride?: string,
    ): string {
        const {config: current, service} = execution;
        return deps.buildTranslationCacheKey({
            requestMode: 'page-summary',
            sourceLanguage: current.from,
            targetLanguage: '',
            sourceText: pageContext,
            service,
            model: getSelectedModel(current, service, modelOverride),
            endpoint: getProviderEndpoint(current, service),
            customBody: current.customBody[service] || '',
            transportProfile: deps.serviceTypes.isAiSdk(service)
                ? deps.endpointResolver.aiSdkTransportProfile
                : undefined,
        });
    }

    function cachePageSummary(key: string, value: string): void {
        if (pageSummaryCache.size >= PAGE_SUMMARY_CACHE_SIZE) {
            const oldestKey = pageSummaryCache.keys().next().value;
            if (oldestKey) pageSummaryCache.delete(oldestKey);
        }
        pageSummaryCache.set(key, value);
    }

    async function writeCacheIfCurrent(generation: number, key: string, value: string): Promise<void> {
        if (generation !== cacheGeneration) return;

        const write = Promise.resolve(deps.cache.set(key, value));
        pendingCacheWrites.set(write, generation);
        try {
            await write;
        } finally {
            pendingCacheWrites.delete(write);
        }
    }

    function scheduleCacheWrite(generation: number, key: string, value: string): void {
        // 缓存是旁路优化：写入仍参与 generation/clear 纪律，但不能阻塞成功译文或摘要正文。
        void writeCacheIfCurrent(generation, key, value).catch((error) => {
            warn('[FluentRead] translation cache write failed:', error);
        });
    }

    async function addPageSummary(
        execution: TranslationRequestExecution,
        pageContext: string,
        useCache: boolean,
        requestGeneration: number,
        requestDeadline: number,
        modelOverride?: string,
        requestTimeoutMs?: number,
    ): Promise<string> {
        if (!isAIContextEnabled(execution.config, execution.service, modelOverride) || !pageContext.trim()) return '';

        const key = buildPageSummaryCacheKey(execution, pageContext, modelOverride);
        if (useCache) {
            const cached = pageSummaryCache.get(key);
            if (cached) return cached;
        }

        const summaryTimeoutMs = normalizeDeadlineTimeoutMs(requestTimeoutMs as number);
        const pendingKey = `${buildPendingRequestKey(key, summaryTimeoutMs)}:cache:${useCache ? 'on' : 'off'}`;
        const existing = pendingPageSummaries.get(pendingKey);
        if (existing) return runWithinDeadline(() => existing, requestDeadline);

        const request = (async () => {
            try {
                // 步骤 1：先读持久缓存，覆盖 MV3 service worker 重启后的重复摘要。
                if (useCache) {
                    const persisted = await runWithinDeadline(() => deps.cache.get(key), requestDeadline);
                    if (persisted !== null) {
                        if (requestGeneration === cacheGeneration) cachePageSummary(key, persisted);
                        return persisted;
                    }
                }

                // 步骤 2：缓存未命中时生成短摘要，失败时回退到原始上下文。
                const remainingTotalMs = getRemainingDeadlineMs(requestDeadline);
                const providerTimeoutMs = Math.min(summaryTimeoutMs, remainingTotalMs);
                const result = await callProviderWithinDeadline(
                    execution,
                    attachTranslationProviderConfig({
                        origin: '',
                        context: '',
                        pageContext: '',
                        summaryPrompt: deps.promptBuilder.buildPageSummaryPrompt(pageContext),
                        summarySystemPrompt: deps.promptBuilder.buildPageSummarySystemPrompt(),
                        serviceOverride: execution.service,
                        sourceLanguage: execution.sourceLanguage,
                        targetLanguage: execution.targetLanguage,
                        modelOverride,
                        requestTimeoutMs: providerTimeoutMs,
                    }, execution.config),
                );
                const summary = typeof result === 'string' ? result.trim().slice(0, PAGE_SUMMARY_LIMIT) : '';
                if (!summary) {
                    if (useCache && requestGeneration === cacheGeneration) cachePageSummary(key, pageContext);
                    return pageContext;
                }

                const summarizedContext = `Page summary (AI-generated reference):\n${summary}\n\n${pageContext}`.slice(0, 4000);
                if (useCache && requestGeneration === cacheGeneration) cachePageSummary(key, summarizedContext);
                if (useCache) scheduleCacheWrite(requestGeneration, key, summarizedContext);
                return summarizedContext;
            } catch (error) {
                warn('[FluentRead] page context summary failed; using extracted context:', error);
                // 超时只是本次摘要预算耗尽，不能把原上下文当成成功摘要缓存，否则同 key 无法重试。
                if (!(error instanceof TranslationProviderDeadlineError)
                    && useCache
                    && requestGeneration === cacheGeneration) {
                    cachePageSummary(key, pageContext);
                }
                return pageContext;
            }
        })();

        pendingPageSummaries.set(pendingKey, request);
        // addPageSummary 内部把 provider/cache/logger 失败都降级为原始上下文，因此该 Promise 只会 fulfilled。
        void request.then(() => {
            if (pendingPageSummaries.get(pendingKey) === request) pendingPageSummaries.delete(pendingKey);
        });
        return request;
    }

    async function translateSingleWithCache(
        execution: TranslationRequestExecution,
        message: TranslationSingleRequestMessage,
        context: string,
        pageContext: string,
        useCache: boolean,
        requestGeneration: number,
        requestDeadline: number,
        pendingBudgetMs: number,
    ): Promise<string> {
        if (!useCache) {
            const result = await callProviderWithinDeadline(
                execution,
                applyRemainingDeadline({...message, context, pageContext}, requestDeadline),
            );
            return requireSingleResult(result);
        }

        const key = buildCacheKey(execution, message.origin, context, pageContext, 'single', message.modelOverride);
        const pendingKey = buildPendingRequestKey(key, pendingBudgetMs);
        const existing = pendingTranslations.get(pendingKey);
        if (existing) return existing;

        const request = (async () => {
            // 步骤 1：先读持久缓存；未命中后只发起一次 provider 请求。
            const cached = await runWithinDeadline(() => deps.cache.get(key), requestDeadline);
            if (cached !== null) {
                getRemainingDeadlineMs(requestDeadline);
                return cached;
            }

            const result = requireSingleResult(
                await callProviderWithinDeadline(
                    execution,
                    applyRemainingDeadline({...message, context, pageContext}, requestDeadline),
                ),
            );
            if (isCacheableResult(message.origin, result)) {
                scheduleCacheWrite(requestGeneration, key, result);
            }
            return result;
        })();

        pendingTranslations.set(pendingKey, request);
        void request.then(
            () => {
                if (pendingTranslations.get(pendingKey) === request) pendingTranslations.delete(pendingKey);
            },
            () => {
                if (pendingTranslations.get(pendingKey) === request) pendingTranslations.delete(pendingKey);
            },
        );
        return request;
    }

    async function translateBatchWithCache(
        execution: TranslationRequestExecution,
        message: TranslationBatchRequestMessage,
        context: string,
        pageContext: string,
        useCache: boolean,
        requestGeneration: number,
        requestDeadline: number,
        pendingBudgetMs: number,
    ): Promise<string[]> {
        if (!useCache) {
            const result = await callProviderWithinDeadline(
                execution,
                applyRemainingDeadline({...message, context, pageContext}, requestDeadline),
            );
            return requireBatchResult(result, message.origin.length);
        }

        const batchKey = buildCacheKey(execution, message.origin, context, pageContext, 'batch', message.modelOverride);
        const pendingKey = buildPendingRequestKey(batchKey, pendingBudgetMs);
        const existing = pendingBatches.get(pendingKey);
        if (existing) return existing;

        const request = (async () => {
            // 步骤 1：分项读取缓存，只把缺失且去重后的原文交给 provider。
            const cached = await runWithinDeadline(
                () => Promise.all(message.origin.map((origin) => deps.cache.get(
                    buildCacheKey(execution, origin, context, pageContext, 'batch', message.modelOverride),
                ))),
                requestDeadline,
            );
            const missingIndexes = cached
                .map((value, index) => value === null ? index : -1)
                .filter((index) => index >= 0);

            if (missingIndexes.length === 0) {
                getRemainingDeadlineMs(requestDeadline);
                return cached as string[];
            }

            const missingEntries = missingIndexes.map((index) => ({index, origin: message.origin[index]}));
            const uniqueMissingOrigins = Array.from(
                new Map(
                    missingEntries.map(({origin}) => [
                        buildCacheKey(execution, origin, context, pageContext, 'batch', message.modelOverride),
                        origin,
                    ]),
                ).values(),
            );
            const translated = requireBatchResult(
                await callProviderWithinDeadline(
                    execution,
                    applyRemainingDeadline({
                        ...message,
                        context,
                        pageContext,
                        origin: uniqueMissingOrigins,
                    }, requestDeadline),
                ),
                uniqueMissingOrigins.length,
            );

            // 步骤 2：按原请求顺序回填结果，并只缓存有效译文。
            const result = [...cached] as Array<string | null>;
            const translatedByKey = new Map(
                uniqueMissingOrigins.map((origin, index) => [
                    buildCacheKey(execution, origin, context, pageContext, 'batch', message.modelOverride),
                    translated[index],
                ]),
            );
            missingEntries.forEach(({index, origin}) => {
                const value = translatedByKey.get(buildCacheKey(execution, origin, context, pageContext, 'batch', message.modelOverride));
                result[index] = value as string;
                if (isCacheableResult(origin, value)) {
                    scheduleCacheWrite(
                        requestGeneration,
                        buildCacheKey(execution, origin, context, pageContext, 'batch', message.modelOverride),
                        value,
                    );
                }
            });

            return result as string[];
        })();

        pendingBatches.set(pendingKey, request);
        void request.then(
            () => {
                if (pendingBatches.get(pendingKey) === request) pendingBatches.delete(pendingKey);
            },
            () => {
                if (pendingBatches.get(pendingKey) === request) pendingBatches.delete(pendingKey);
            },
        );
        return request;
    }

    async function translateWithCache(message: TranslationRequestMessage): Promise<string | string[]> {
        // 空请求没有 provider 语义，也不应被配置水合阻塞。
        if (Array.isArray(message.origin) && message.origin.length === 0) return [];
        if (typeof message.origin === 'string' && !message.origin.trim()) return message.origin;

        // deadline 从公开入口开始计时，配置水合不能让上层剩余预算重新获得完整时长。
        const providerStartedAt = now();
        const isRemainingBudget = (message as TranslationRequestMessage & TranslationRemainingBudgetContext)
            [TRANSLATION_REMAINING_BUDGET] === true;
        const providerBudget = (isRemainingBudget
            ? normalizeDeadlineTimeoutMs(message.requestTimeoutMs as number)
            : normalizeExternalRequestTimeoutMs(message.requestTimeoutMs)) ?? DEFAULT_PROVIDER_TIMEOUT_MS;
        const providerDeadline = providerStartedAt + providerBudget;
        await runWithinDeadline(() => deps.ready, providerDeadline);

        const requestGeneration = cacheGeneration;

        // 步骤 1：在任何 cache/provider await 前复制一次配置；后续 UI 原地修改不能改变本请求身份。
        const current = createTranslationProviderConfigSnapshot(config());
        const serviceOverride = message.serviceOverride;
        const selectedService = serviceOverride || current.service;
        const {sourceLanguage, targetLanguage} = deps.getTranslationLanguages({
            sourceLanguage: message.sourceLanguage?.trim() || current.from,
            targetLanguage: message.targetLanguage?.trim() || current.to,
        });
        const execution: TranslationRequestExecution = {
            config: current,
            service: selectedService,
            sourceLanguage,
            targetLanguage,
        };
        const credentialConfig = message.modelOverride
            ? {
                ...current,
                model: {...current.model, [selectedService]: message.modelOverride},
                customModel: {...current.customModel, [selectedService]: message.modelOverride},
            }
            : current;
        const missingCredentialMessage = deps.getMissingCredentialMessage(selectedService, credentialConfig);
        if (missingCredentialMessage) throw new Error(missingCredentialMessage);
        if (serviceOverride && !deps.serviceTypes.machine.has(serviceOverride) && !deps.serviceTypes.isAI(serviceOverride)) {
            throw new Error('独立翻译服务不可用，请选择已配置的机器翻译或 AI 服务');
        }

        const context = typeof message.context === 'string' ? message.context : '';
        const rawPageContext = typeof message.pageContext === 'string' ? message.pageContext : '';
        const useCache = isCacheEnabled(current, message);
        // 步骤 2：摘要是 AI 上下文增强，只拿 provider deadline 的一小段预算。
        const summaryBudget = Math.min(10_000, Math.max(1_000, Math.floor(providerBudget / 4)));
        const pageContext = await addPageSummary(
            execution,
            rawPageContext,
            useCache,
            requestGeneration,
            providerDeadline,
            message.modelOverride,
            summaryBudget,
        );
        const remainingProviderBudget = getRemainingDeadlineMs(providerDeadline);

        // 步骤 3：把摘要耗时从剩余 provider 请求中扣除，避免后台无限等待。
        const requestMessage = attachTranslationProviderConfig(
            {
                ...message,
                sourceLanguage,
                targetLanguage,
                requestTimeoutMs: remainingProviderBudget,
            } as TranslationRequestMessage,
            current,
        );
        // 步骤 4：根据 origin 类型进入单条或批量管线，两者共享缓存身份与 pending 去重。
        if (Array.isArray(requestMessage.origin)) {
            return translateBatchWithCache(
                execution,
                requestMessage as TranslationBatchRequestMessage,
                context,
                pageContext,
                useCache,
                requestGeneration,
                providerDeadline,
                providerBudget,
            );
        }
        return translateSingleWithCache(
            execution,
            requestMessage as TranslationSingleRequestMessage,
            context,
            pageContext,
            useCache,
            requestGeneration,
            providerDeadline,
            providerBudget,
        );
    }

    async function clearTranslationCache(): Promise<void> {
        // 步骤 1：先切换代次并断开旧请求去重；旧 provider 仍可返回给原调用者，但不能重新填充缓存。
        cacheGeneration += 1;
        pendingTranslations.clear();
        pendingBatches.clear();
        pendingPageSummaries.clear();
        pageSummaryCache.clear();

        // 步骤 2：等待清理开始前已经进入存储适配器的写入，随后再清库，保证成功返回后没有旧写入复活。
        const staleWrites = [...pendingCacheWrites]
            .filter(([, generation]) => generation < cacheGeneration)
            .map(([write]) => write);
        await Promise.allSettled(staleWrites);
        await deps.cache.clear();
        pageSummaryCache.clear();
    }

    async function cleanupTranslationCache(): Promise<void> {
        await deps.cache.cleanup();
    }

    return {
        translateWithCache,
        clearTranslationCache,
        cleanupTranslationCache,
    };
}
