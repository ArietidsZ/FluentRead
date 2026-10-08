/**
 * @file src/app/background/areaRuntime.ts
 * 文件职责：为图片与圈选翻译装配浏览器、离屏计算、识别配置与共享事务表。
 * 主要内容：静态组装能力门控、OCR 语言包、图片来源校验及区域模型路由；图片与圈选从原生 sender 核验三态来源并在能力探测前冻结有效专用线路，内部请求向 broker 保留来源；相关配置变更取消两类事务；图片与圈选共用文档连接、身份和断连／标签页释放。
 * 模块边界：本文件仅注入依赖，不实现模型能力、截图裁剪、OCR 或翻译算法；消息安装由 messageRuntime 统一负责。
 */
import type {ImageOperationRegistry} from '@/src/features/image-translation/protocol';
import {config, subscribeConfig} from '@/src/services/config/store';
import {translateWithCache} from '@/src/app/translation/runtime';
import {resolveAreaRecognitionRoute} from '@/src/core/config/vision';
import {modelVisionProbe} from '@/src/app/translation/visionProbeRuntime';
import {prepareModelVisionRoute} from '@/src/services/translation/visionProbe';
import {createAreaTranslationBackgroundHandlers, createAreaCaptureOwnershipVerifier} from './handlers/areaTranslation';
import {prepareAreaTextTranslation, prepareAreaVisionRecognition} from '@/src/features/area-translation/services/textTranslation';
import {areaTranslationOffscreenAdapter} from '@/src/features/area-translation/background/offscreenAdapter';
import {imageTranslationOffscreenAdapter, imageTranslationProgressTransport, imageTranslationSourceTransport} from '@/src/features/image-translation/background/offscreenAdapter';
import {createImageOperationRegistry, createImageTranslationBackgroundHandlers} from '@/src/features/image-translation/background/handlers';
import type {createImageOcrLanguageRepository} from '@/src/features/image-translation/background/ocrLanguageRepository';
import {createImageGlossaryContext, type ImageGlossarySenderContext} from './imageGlossaryContext';
import {createCapabilityGatedBackgroundHandlers} from './capabilityRegistry';
import type {BrowserCapabilities} from '@/src/platform/browser/capabilities';
import {supportsTranslationBatch} from '@/src/services/translation/capabilities';
import {configReady} from '@/src/services/config/store';
import {buildGlossaryRevision} from '@/src/core/glossary';
import {createImageDocumentPortHandler} from '@/src/features/image-translation/background/documentSession';
import {resolveNativeSourcePrivacy, type IncognitoSourceRuntime} from '@/src/platform/browser/incognitoSource';
import {attachTranslationSourcePrivacy, getTranslationSourcePrivacy} from '@/src/services/translation/requestPrivacy';
import {getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';

/** 内部来源附在原请求上，保留不可枚举的取消所有权及剩余预算。 */
function translateImageArea(request: Parameters<typeof translateWithCache>[0]) {
    const privacy = getTranslationSourcePrivacy(getTranslationProviderConfig(request, config));
    return translateWithCache(privacy ? Object.assign(request, attachTranslationSourcePrivacy({}, privacy)) : request);
}

export function createAreaTranslationRuntime(assertLanguagesDownloaded: (language: string) => Promise<void>, operationRegistry?: ImageOperationRegistry) {
    return createAreaTranslationBackgroundHandlers({
        requireDocumentOwner: true,
        operationRegistry,
        captureVisibleTab: (windowId) => browser.tabs.captureVisibleTab(windowId, {format: 'png'}),
        assertCaptureOwner: createAreaCaptureOwnershipVerifier(tabId => browser.tabs.get(tabId)),
        getDefaultSourceLanguage: () => config.from,
        assertLanguagesDownloaded,
        translateArea: areaTranslationOffscreenAdapter.translateArea,
        getVisionRoute: (frozen) => resolveAreaRecognitionRoute(frozen ?? config),
        prepareVisionRoute: (frozen) => prepareModelVisionRoute(frozen ?? config, modelVisionProbe.resolve),
        prepareVisionTranslation: (language, title, _context, frozen) => prepareAreaVisionRecognition(frozen ?? config, language, title,
            areaTranslationOffscreenAdapter.cropArea, translateImageArea),
        prepareTextTranslation: (language, title, context, frozen) => prepareAreaTextTranslation(frozen ?? config, language, title,
            {pageUrl: context.sender?.url, context: 'page'}, translateImageArea),
        sendProgress: imageTranslationProgressTransport.sendProgress,
    });
}

/** 图片与圈选在同一装配边界创建一次身份表；中央消息根只安装已有 handlers。 */
export function createImageAreaTranslationRuntime<TContext extends ImageGlossarySenderContext>(
    repository: ReturnType<typeof createImageOcrLanguageRepository>, capabilities: BrowserCapabilities,
) {
    const registry = createImageOperationRegistry('image-area', context =>
        context.sender?.id === browser.runtime.id && imageTranslationProgressTransport.isOffscreenSender(context), Date.now, true);
    const glossary = createImageGlossaryContext<TContext>({ready: configReady, operationRegistry: registry,
        requireDocumentOwner: true,
        resolveImageSourcePrivacy: context => resolveNativeSourcePrivacy(context.sender, browser.runtime as unknown as IncognitoSourceRuntime),
        getConfig: () => config, offscreenUrl: browser.runtime.getURL('/offscreen.html'),
        getSourceLanguage: () => config.from, getGlossaryRevision: () => buildGlossaryRevision(config.glossaryLibraries, config.glossaryEnabled)});
    const handlers = glossary.wrap(createCapabilityGatedBackgroundHandlers<TContext>(capabilities, {
        areaTranslation: () => createAreaTranslationRuntime(repository.assertDownloaded, registry),
        imageTranslation: () => createImageTranslationBackgroundHandlers({operationRegistry: registry,
            assertLanguagesDownloaded: repository.assertDownloaded, getDownloadedLanguages: repository.getDownloaded,
            ...imageTranslationOffscreenAdapter, ...imageTranslationSourceTransport, translateTexts: translateImageArea,
            getTranslationService: () => config.imageTranslationService || config.service, getGlossaryConfig: () => config,
            getImageOcrEngine: () => config.imageTranslationOcrEngine, supportsBatchTranslation: supportsTranslationBatch,
            markLanguagesDownloaded: repository.markDownloaded, markLanguagesRemoved: repository.markRemoved,
            ...imageTranslationProgressTransport,
        }),
    }));
    const configurationKey = (next: typeof config) => JSON.stringify([next.on, next.disabledExtensionDomains,
        next.disableImageTranslator, next.imageTranslationMangaEnabled, next.imageTranslationOcrEngine, next.imageTranslationService,
        next.areaTranslationService, next.areaTranslationMode, next.areaRecognitionMode, next.areaVisionPrompt, next.modelVision,
        next.service, next.model, next.customModel, next.incognitoService, next.incognitoModel, next.customModels, next.customOpenAIProviders,
        next.proxy, next.token, next.secret, next.apiKeys, next.apiKeyRotationEnabled, next.apiKeyRecoveryMs, next.requireApiKey,
        next.customBody, next.customHeaders, next.modelThinking, next.system_role, next.user_role, next.from, next.to, next.enableAIContext,
        next.glossaryLibraries, next.glossaryEnabled, next.azureOpenaiEndpoint, next.newApiUrl, next.deepseekApiType, next.deepseekThinkingMode,
        next.minimaxRegion, next.minimaxBillingPlan, next.mimoRegion, next.mimoBillingPlan, next.deeplx, next.deeplApiPlan,
        next.serviceRegion, next.youdaoAppKey, next.youdaoAppSecret, next.tencentSecretId, next.tencentSecretKey]);
    let imageConfigurationKey = configurationKey(config);
    subscribeConfig(next => {
        const key = configurationKey(next);
        if (key !== imageConfigurationKey) glossary.cancelImages();
        imageConfigurationKey = key;
    });
    const byType = new Map(handlers.map(handler => [handler.type, handler]));
    const ports = createImageDocumentPortHandler({runtimeId: browser.runtime.id, releaseOwner: registry.releaseOwner,
        dispatch: async (message, context) => {
            const handler = byType.get(message.type);
            if (!handler) throw new Error('图片文档操作不可用');
            return handler.handle(message, context as TContext);
        }});
    return {handlers, connect: ports.connect, releaseTab(tabId: number) {ports.releaseTab(tabId); registry.releaseTab(tabId);}};
}
