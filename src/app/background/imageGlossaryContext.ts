/**
 * @file src/app/background/imageGlossaryContext.ts
 * 文件职责：在图片与圈选 OCR 跨越 Offscreen 后恢复原页面与开始时的配置快照。
 * 主要内容：与 feature 共用后台事务表，把公开 ID 与内部事务 ID 分离；只有精确的无标签页 Offscreen 发送者可以恢复未终止事务。
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

export interface ImageGlossarySenderContext extends ImageProgressContext {}
interface ImageGlossaryMessage extends BackgroundMessage {requestId?: unknown; timeoutMs?: unknown; sourceLanguage?: unknown;}
export interface ImageGlossaryContextDependencies {
    readonly ready: Promise<unknown>;
    readonly offscreenUrl: string;
    readonly operationRegistry?: ImageOperationRegistry;
    readonly getConfig?: () => Config;
    readonly getSourceLanguage: () => string;
    readonly getGlossaryRevision: () => string;
}
function pageUrlFromSender(context: ImageGlossarySenderContext): string | undefined {
    const value = context.sender?.url;
    if (!value) return undefined;
    try {const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;}
    catch {return undefined;}
}
/** 配置只在原页面开始事务时读取；恢复旧事务禁止读当前设置。 */
export function createImageGlossaryContext<TContext extends ImageGlossarySenderContext>(
    dependencies: ImageGlossaryContextDependencies,
): {wrap(handlers: readonly BackgroundMessageHandler<TContext>[]): BackgroundMessageHandler<TContext>[]} {
    const fromOffscreen = (context: ImageGlossarySenderContext) => context.sender?.url === dependencies.offscreenUrl && context.sender.tab === undefined;
    const registry = dependencies.operationRegistry ?? createImageOperationRegistry('image-glossary', fromOffscreen);
    const snapshot = (context: TContext, sourceLanguage: unknown): ImageTransactionSnapshot => {
        const source = dependencies.getConfig?.();
        const config = source ? Object.freeze({...createTranslationProviderConfigSnapshot(source), modelVision: Object.freeze(Object.fromEntries(
            Object.entries(source.modelVision).map(([service, models]) => [service, Object.freeze({...models})])))}) as unknown as Readonly<Config> : undefined;
        return Object.freeze({pageUrl: pageUrlFromSender(context),
            sourceLanguage: typeof sourceLanguage === 'string' && sourceLanguage.trim() ? sourceLanguage : config?.from ?? dependencies.getSourceLanguage(),
            glossaryRevision: config ? buildGlossaryRevision(config.glossaryLibraries, config.glossaryEnabled) : dependencies.getGlossaryRevision(),
            ...(config ? {config} : {})});
    };
    return {wrap: handlers => handlers.map(handler => {
        const starts = handler.type === IMAGE_TRANSLATE_MESSAGE_TYPE || handler.type === AREA_TRANSLATE_CAPTURE_MESSAGE_TYPE || handler.type === IMAGE_FETCH_MESSAGE_TYPE;
        if (!starts && handler.type !== IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE) return handler;
        return {type: handler.type, async handle(rawMessage, context) {
            await dependencies.ready;
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
            return registry.run(message, options => {
                const bound = registry.bind(context, options) as TContext;
                return starts ? Promise.resolve(handler.handle({...message, requestId: options.requestId} as BackgroundMessage, bound)) : Promise.resolve(invoke(options.snapshot!, bound));
            }, context, () => snapshot(context, starts ? message.sourceLanguage : undefined));
        }};
    })};
}
