/**
 * @file src/app/background/imageGlossaryContext.ts
 * 文件职责：在图片与圈选 OCR 跨越 Offscreen 后恢复原页面与开始时的配置快照。
 * 主要内容：与 feature 共用事务表，冻结原生 sender 和图片三态来源，将专用 provider/model 锁进图片快照；配置变更取消图片准备与执行，只有精确的无标签页 Offscreen sender 可以恢复未终止事务。
 * 模块边界：只装配可信 sender、术语和配置快照，不访问浏览器、不传输凭据、不执行 OCR，也不接受消息体自报归属。
 */
import type {BackgroundMessage, BackgroundMessageHandler} from './messageRouter';
import {AREA_TRANSLATE_CAPTURE_MESSAGE_TYPE} from './handlers/areaTranslation';
import {IMAGE_TRANSLATE_MESSAGE_TYPE, IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE, IMAGE_FETCH_MESSAGE_TYPE,
    createImageOperationRegistry, type ImageOperationRegistry, type ImageProgressContext,
    type ImageTransactionSnapshot} from '@/src/features/image-translation/background/handlers';
import {attachTranslationGlossaryContext, attachTranslationProviderConfig, createTranslationProviderConfigSnapshot} from '@/src/services/translation/requestSnapshot';
import {buildGlossaryRevision} from '@/src/core/glossary';
import type {Config} from '@/src/core/config/model';
import {assertImageDocumentContext, copyImageDocumentSession} from '@/src/features/image-translation/background/documentSession';
import {imageAbortError} from '@/src/features/image-translation/background/operationRegistry';
import {attachTranslationSourcePrivacy, assertTranslationSourcePrivacy, type TranslationSourcePrivacy} from '@/src/services/translation/requestPrivacy';
import {lockIncognitoRoute, resolveIncognitoRoute} from '@/src/core/config/incognitoRoute';

export interface ImageGlossarySenderContext extends ImageProgressContext {}
interface ImageGlossaryMessage extends BackgroundMessage {requestId?: unknown; timeoutMs?: unknown; sourceLanguage?: unknown;}
export interface ImageGlossaryContextDependencies {
    readonly requireDocumentOwner?: boolean;
    readonly ready: Promise<unknown>;
    readonly offscreenUrl: string;
    readonly operationRegistry?: ImageOperationRegistry;
    readonly getConfig?: () => Config;
    readonly getSourceLanguage: () => string;
    readonly getGlossaryRevision: () => string;
    readonly resolveImageSourcePrivacy?: (context: ImageGlossarySenderContext) => Promise<TranslationSourcePrivacy>;
}
function pageUrlFromSender(context: ImageGlossarySenderContext): string | undefined {
    const value = context.sender?.url;
    if (!value) return undefined;
    try {const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;}
    catch {return undefined;}
}
/** 配置只在原文档开始事务时读取；等待配置后重查连接，恢复旧事务禁止读当前设置。 */
export function createImageGlossaryContext<TContext extends ImageGlossarySenderContext>(
    dependencies: ImageGlossaryContextDependencies,
): {wrap(handlers: readonly BackgroundMessageHandler<TContext>[]): BackgroundMessageHandler<TContext>[]; cancelImages(): void} {
    const fromOffscreen = (context: ImageGlossarySenderContext) => context.sender?.url === dependencies.offscreenUrl && context.sender.tab === undefined;
    const registry = dependencies.operationRegistry ?? createImageOperationRegistry('image-glossary', fromOffscreen);
    let configurationGeneration = 0;
    const imageControllers = new Set<AbortController>();
    const snapshot = (context: TContext, sourceLanguage: unknown): ImageTransactionSnapshot => {
        const source = dependencies.getConfig?.();
        const config = source ? Object.freeze({...createTranslationProviderConfigSnapshot(source), modelVision: Object.freeze(Object.fromEntries(
            Object.entries(source.modelVision).map(([service, models]) => [service, Object.freeze({...models})])))}) as unknown as Readonly<Config> : undefined;
        return Object.freeze({pageUrl: pageUrlFromSender(context),
            sourceLanguage: typeof sourceLanguage === 'string' && sourceLanguage.trim() ? sourceLanguage : config?.from ?? dependencies.getSourceLanguage(),
            glossaryRevision: config ? buildGlossaryRevision(config.glossaryLibraries, config.glossaryEnabled) : dependencies.getGlossaryRevision(),
            ...(config ? {config} : {})});
    };
    return {cancelImages() {
        configurationGeneration++;
        for (const controller of imageControllers) controller.abort(imageAbortError(false));
    }, wrap: handlers => handlers.map(handler => {
        const starts = handler.type === IMAGE_TRANSLATE_MESSAGE_TYPE || handler.type === AREA_TRANSLATE_CAPTURE_MESSAGE_TYPE || handler.type === IMAGE_FETCH_MESSAGE_TYPE;
        if (!starts && handler.type !== IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE) return handler;
        return {type: handler.type, async handle(rawMessage, context) {
            const sender = context.sender;
            context = Object.freeze(copyImageDocumentSession(context, {...context, ...(sender ? {sender: Object.freeze({...sender,
                ...(sender.tab ? {tab: Object.freeze({...sender.tab})} : {})})} : {})})) as TContext;
            const generation = configurationGeneration;
            await dependencies.ready;
            if (!fromOffscreen(context)) assertImageDocumentContext(context, dependencies.requireDocumentOwner);
            const message = rawMessage as ImageGlossaryMessage;
            const invoke = (frozen: ImageTransactionSnapshot, bound: TContext) => {
                let trusted = attachTranslationGlossaryContext({...message, glossaryRevision: frozen.glossaryRevision,
                    sourceLanguage: frozen.sourceLanguage}, {pageUrl: frozen.pageUrl, context: 'page'});
                if (frozen.config) trusted = attachTranslationProviderConfig(trusted, frozen.config);
                return handler.handle(trusted, bound);
            };
            if (!starts && fromOffscreen(context)) {
                const record = registry.restore(message.requestId, context);
                return invoke(record.snapshot!, registry.bind(context, record.options) as TContext);
            }
            let frozen = snapshot(context, starts ? message.sourceLanguage : undefined);
            const imageRequest = handler.type !== AREA_TRANSLATE_CAPTURE_MESSAGE_TYPE;
            if (imageRequest && dependencies.resolveImageSourcePrivacy && frozen.config) {
                const privacy = await dependencies.resolveImageSourcePrivacy(context);
                assertImageDocumentContext(context, dependencies.requireDocumentOwner);
                const trusted = attachTranslationSourcePrivacy(frozen.config, privacy);
                assertTranslationSourcePrivacy(trusted, dependencies.getConfig!(), frozen.config);
                const route = privacy === 'private' ? resolveIncognitoRoute(frozen.config) : undefined;
                const effective = route ? lockIncognitoRoute({...trusted, imageTranslationService: route.service,
                    model: Object.freeze({...trusted.model, [route.service]: route.model}),
                    customModel: Object.freeze({...trusted.customModel, [route.service]: route.model}),
                }, route) : Object.freeze(trusted);
                frozen = Object.freeze({...frozen, config: effective});
            }
            if (imageRequest && generation !== configurationGeneration) throw imageAbortError(false);
            let controller: AbortController | undefined;
            try {
                return await registry.run(message, options => {
                    const bound = registry.bind(context, options) as TContext;
                    if (imageRequest) {controller = options.controller!; imageControllers.add(controller);}
                    return Promise.resolve(starts ? handler.handle({...message, requestId: options.requestId} as BackgroundMessage, bound) : invoke(options.snapshot!, bound));
                }, context, () => frozen);
            } finally {if (controller) imageControllers.delete(controller);}
        }};
    })};
}
