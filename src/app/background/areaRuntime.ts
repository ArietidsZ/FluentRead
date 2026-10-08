/**
 * @file src/app/background/areaRuntime.ts
 * 文件职责：为图片与圈选翻译装配浏览器、离屏计算、识别配置与共享事务表。
 * 主要内容：静态组装能力门控、OCR 语言包、图片来源校验、术语快照及区域模型路由；图片与圈选共用事务身份和标签页释放。
 * 模块边界：本文件仅注入依赖，不实现模型能力、截图裁剪、OCR 或翻译算法；消息安装由 messageRuntime 统一负责。
 */
import type {ImageOperationRegistry} from '@/src/features/image-translation/protocol';
import {config} from '@/src/services/config/store';
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

export function createAreaTranslationRuntime(assertLanguagesDownloaded: (language: string) => Promise<void>, operationRegistry?: ImageOperationRegistry) {
    return createAreaTranslationBackgroundHandlers({
        operationRegistry,
        captureVisibleTab: (windowId) => browser.tabs.captureVisibleTab(windowId, {format: 'png'}),
        assertCaptureOwner: createAreaCaptureOwnershipVerifier(tabId => browser.tabs.get(tabId)),
        getDefaultSourceLanguage: () => config.from,
        assertLanguagesDownloaded,
        translateArea: areaTranslationOffscreenAdapter.translateArea,
        getVisionRoute: (frozen) => resolveAreaRecognitionRoute(frozen ?? config),
        prepareVisionRoute: (frozen) => prepareModelVisionRoute(frozen ?? config, modelVisionProbe.resolve),
        prepareVisionTranslation: (language, title, _context, frozen) => prepareAreaVisionRecognition(frozen ?? config, language, title,
            areaTranslationOffscreenAdapter.cropArea, translateWithCache),
        prepareTextTranslation: (language, title, context, frozen) => prepareAreaTextTranslation(frozen ?? config, language, title,
            {pageUrl: context.sender?.url, context: 'page'}, translateWithCache),
        sendProgress: imageTranslationProgressTransport.sendProgress,
    });
}

/** 图片与圈选在同一装配边界创建一次身份表；中央消息根只安装已有 handlers。 */
export function createImageAreaTranslationRuntime<TContext extends ImageGlossarySenderContext>(
    repository: ReturnType<typeof createImageOcrLanguageRepository>, capabilities: BrowserCapabilities,
) {
    const registry = createImageOperationRegistry('image-area', context =>
        context.sender?.id === browser.runtime.id && imageTranslationProgressTransport.isOffscreenSender(context));
    const glossary = createImageGlossaryContext<TContext>({ready: configReady, operationRegistry: registry,
        getConfig: () => config, offscreenUrl: browser.runtime.getURL('/offscreen.html'),
        getSourceLanguage: () => config.from, getGlossaryRevision: () => buildGlossaryRevision(config.glossaryLibraries, config.glossaryEnabled)});
    return {releaseTab: registry.releaseTab, handlers: glossary.wrap(createCapabilityGatedBackgroundHandlers<TContext>(capabilities, {
        areaTranslation: () => createAreaTranslationRuntime(repository.assertDownloaded, registry),
        imageTranslation: () => createImageTranslationBackgroundHandlers({operationRegistry: registry,
            assertLanguagesDownloaded: repository.assertDownloaded, getDownloadedLanguages: repository.getDownloaded,
            ...imageTranslationOffscreenAdapter, ...imageTranslationSourceTransport, translateTexts: translateWithCache,
            getTranslationService: () => config.imageTranslationService || config.service, getGlossaryConfig: () => config,
            getImageOcrEngine: () => config.imageTranslationOcrEngine, supportsBatchTranslation: supportsTranslationBatch,
            markLanguagesDownloaded: repository.markDownloaded, markLanguagesRemoved: repository.markRemoved,
            ...imageTranslationProgressTransport,
        }),
    }))};
}
