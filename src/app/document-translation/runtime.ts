/**
 * @file src/app/document-translation/runtime.ts
 * 文件职责：把通用翻译客户端、配置 store 与文档 feature 的纯服务连接起来，为页面提供可直接调用的分段翻译和文件下载适配器。
 * 主要内容：在文档页面原生私密提示下解析有效专用线路，先固定服务/模型再交给现有单条/批量编排；以不外发的配置摘要撤销旧翻译和导出，生成下载时注入 PDF 栅格化器。
 * 模块边界：本文件是 app adapter，不授予后台来源身份、不解析源文件或另建传输/注册表；后台仍独立核验原生三态，业务算法归文档 feature，网络请求归 translation client。
 */
import {translateText, translateTextBatch} from '@/src/app/translation/client';
import {services} from '@/src/core/config/catalog';
import {buildGlossaryRevision} from '@/src/core/glossary';
import {
    createDocumentDownload as createDocumentDownloadWithAdapters,
    type CreateDocumentDownloadOptions,
} from '@/src/features/document-translation/services/binary';
import {createDocumentSegmentTranslator} from '@/src/features/document-translation/services/translation';
import {rasterizePdfTranslationPage} from '@/src/features/document-translation/ui/pdfPreview';
import {config, configReady} from '@/src/services/config/store';
import browser from 'webextension-polyfill';
import {resolvePageTranslationRouteHint} from '@/src/services/translation/requestPrivacy';
import {sha256Hex} from '@/src/shared/function/sha256';
import type {Config} from '@/src/core/config/model';
import type {TranslateDocumentSegments} from '@/src/features/document-translation/services/translation';
import type {
    DocumentRenderMode,
    ParsedDocument,
} from '@/src/features/document-translation/core/document';

const BATCH_DOCUMENT_SERVICES = new Set<string>([
    services.microsoft,
    services.freeTranslation,
]);

/** WXT 组合根：把运行时配置和翻译 API 注入纯文档业务服务。 */
const translateSegments = createDocumentSegmentTranslator({
    getGlossaryOptions: () => ({
        glossaryIds: config.documentGlossaryIds,
        glossaryRevision: buildGlossaryRevision(config.glossaryLibraries, config.glossaryEnabled),
    }),
    waitUntilReady: () => configReady,
    getDefaultService: () => config.service,
    supportsBatch: (service) => BATCH_DOCUMENT_SERVICES.has(service),
    translateText,
    translateTextBatch,
});

/** 仅供前端显示与编排；不附着来源标记，后台原生 sender 仍是唯一执行授权。 */
export function resolveDocumentPrivateRoute(source: Config = config) {
    return resolvePageTranslationRouteHint(source, browser.extension?.inIncognitoContext);
}

/** 私密有效 pair 必须先于现有 feature 的拆批、上下文和客户端凭据预检。 */
export const translateDocumentSegments: TranslateDocumentSegments = async (segments, options) => {
    await configReady;
    options.signal?.throwIfAborted();
    const route = resolveDocumentPrivateRoute();
    return translateSegments(segments, route ? {...options, serviceOverride: route.service, modelOverride: route.model} : options);
};

/** 只在页面内比较，不把连接值、私密标记或此摘要放入翻译请求/持久缓存。计数与 UI 设置不参与。 */
export function documentTranslationRouteKey(source: Config): string {
    return sha256Hex(JSON.stringify([
        source.documentService, source.documentModel, source.documentCustomModel,
        source.service, source.model, source.customModel, source.incognitoService, source.incognitoModel,
        source.customModels, source.customOpenAIProviders, source.proxy, source.token, source.secret,
        source.apiKeys, source.apiKeyRotationEnabled, source.apiKeyRecoveryMs, source.requireApiKey,
        source.customBody, source.customHeaders, source.requestHeaderRules, source.modelThinking,
        source.system_role, source.user_role, source.enableAIContext, source.useCache,
        source.translationMaxRetries, source.translationBackoffBaseMs, source.translationBackoffMaxMs,
        source.maxConcurrentTranslations, source.translationRequestsPerSecond, source.translationRequestsPerMinute,
        source.serviceRequestLimits, source.modelRequestLimits,
        source.freeTranslationOrder, source.freeTranslationMode, source.freeTranslationTimeoutMs, source.freeTranslationCooldownMs, source.myMemoryEmail,
        source.azureOpenaiEndpoint, source.newApiUrl, source.custom, source.deepseekApiType, source.deepseekThinkingMode,
        source.minimaxRegion, source.minimaxBillingPlan, source.mimoRegion, source.mimoBillingPlan,
        source.deeplx, source.deeplApiPlan, source.serviceRegion,
        source.youdaoAppKey, source.youdaoAppSecret, source.tencentSecretId, source.tencentSecretKey,
    ]));
}

/** 浏览器组合根为 PDF 下载注入 Canvas rasterizer；其他格式仍走同一纯二进制服务。 */
export function createDocumentDownload(
    document: ParsedDocument,
    translations: readonly string[],
    mode: DocumentRenderMode,
    options: CreateDocumentDownloadOptions = {},
) {
    return createDocumentDownloadWithAdapters(document, translations, mode, {
        ...options,
        pdfPageRasterizer: options.pdfPageRasterizer ?? rasterizePdfTranslationPage,
    });
}
