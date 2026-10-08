/**
 * @file src/features/input-translation/background/handler.ts
 * 文件职责：定义输入框快捷翻译的后台消息处理器，在调用共享翻译 broker 前校验原文和目标语言，并统一返回成功译文结构。
 * 主要内容：同步校验纯文本与可选请求 ID 并捕获真实 sender 和原生文档租约，生产拒绝无文档身份的 frame；使用独立注册表在水合与来源等待前登记，断连或取消及时结束准备等待，锁定快照后最后附着 control；专用 cancel 只作用于同 owner 输入请求。
 * 模块边界：不监听键盘、不修改输入框或绑定 provider；content 负责触发和提交，composition root 为 start/cancel 注入同一输入注册表，统一路由负责错误响应。页面公开 ID 在 broker 前移除，模型与凭据仅从后台配置读取；userscript 沿用旧纯文本协议。
 */
import {servicesType, resolveConfiguredModel} from '@/src/core/config/catalog';
import {Config} from '@/src/core/config/model';
import {getLockedIncognitoRoute, lockIncognitoRoute, resolveIncognitoRoute, NATIVE_PRIVATE_ROUTE_SUPPORTED, type IncognitoRoute} from '@/src/core/config/incognitoRoute';
import type {NativeMessageSender} from '@/src/platform/browser/incognitoSource';
import {assertNativeDocumentContext} from '@/src/platform/browser/documentSession';
import {captureTranslationRequestContext, createTranslationRequestRegistry, parseClientRequestId, throwIfTranslationRequestAborted, waitForTranslationRequestPreparation, type TranslationRequestRegistry} from '@/src/services/translation/requestRegistry';
import {attachTranslationSourcePrivacy, type TranslationSourcePrivacy} from '@/src/services/translation/requestPrivacy';
import {
    DEFAULT_INPUT_BOX_TRANSLATION_SYSTEM_PROMPT,
    completeInputBoxTranslationPrompt,
    normalizeInputBoxTranslationModel,
    normalizeInputBoxTranslationPrompt,
    normalizeInputBoxTranslationService,
    supportsInputBoxTranslationPrompt,
} from '@/src/core/config/inputTranslation';
import {
    attachTranslationProviderConfig,
    attachTranslationRequestControl,
    createTranslationProviderConfigSnapshot,
} from '@/src/services/translation/requestSnapshot';
import type {TranslationCancelResponse, TranslationSingleRequestMessage} from '@/src/services/translation/types';
export const INPUT_BOX_TRANSLATION_MESSAGE_TYPE = 'inputBoxTranslation' as const;
export const INPUT_BOX_TRANSLATION_CANCEL_MESSAGE_TYPE = 'inputBoxTranslationCancel' as const;

export interface InputBoxTranslationMessage {
    type: typeof INPUT_BOX_TRANSLATION_MESSAGE_TYPE;
    text?: unknown;
    targetLang?: unknown;
    clientRequestId?: unknown;
}

export interface InputBoxTranslationCancelMessage {
    type: typeof INPUT_BOX_TRANSLATION_CANCEL_MESSAGE_TYPE;
    clientRequestId?: unknown;
}

export interface InputBoxTranslationResponse {
    success: true;
    translatedText: string;
}

export interface InputBoxTranslationDependencies {
    readonly ready: Promise<unknown>;
    readonly getConfig: () => Config;
    readonly translate: (message: TranslationSingleRequestMessage) => Promise<string | string[]>;
    readonly resolveSourcePrivacy?: (sender: NativeMessageSender | undefined) => Promise<TranslationSourcePrivacy>;
    readonly requestRegistry?: TranslationRequestRegistry;
    readonly requireDocumentOwner?: boolean;
}

export interface InputBoxTranslationContext {sender?: NativeMessageSender}

export interface InputBoxTranslationHandler {
    readonly type: typeof INPUT_BOX_TRANSLATION_MESSAGE_TYPE;
    handle(message: InputBoxTranslationMessage, context?: InputBoxTranslationContext): Promise<InputBoxTranslationResponse>;
}

function parseRequiredString(value: unknown, field: string): string {
    if (typeof value !== 'string') throw new TypeError(`输入框翻译 ${field} 必须是字符串`);
    if (!value.trim()) throw new TypeError(`输入框翻译 ${field} 不能为空`);
    return field === 'targetLang' ? value.trim() : value;
}

/**
 * 从本地配置按独立选择或网页默认建立输入框翻译 provider snapshot。
 * 只有通用提示词型 AI 服务接收输入框 prompt；机器翻译和原生 MT 模型沿用原配置，
 * 从而不会把无效的提示词或模型设置误传给不支持它们的 provider。
 */
export function createInputBoxTranslationRequest(
    current: Config,
    text: string,
    targetLanguage: string,
    privacy?: TranslationSourcePrivacy,
): TranslationSingleRequestMessage {
    let route: IncognitoRoute | undefined;
    if (NATIVE_PRIVATE_ROUTE_SUPPORTED && privacy === 'private') {
        route = getLockedIncognitoRoute(current) ?? resolveIncognitoRoute(current);
        if (route) current = lockIncognitoRoute({...current,
            inputBoxTranslationService: route.service,
            inputBoxTranslationModel: route.model,
            model: {...current.model, [route.service]: route.model},
            customModel: {...current.customModel, [route.service]: route.model},
        }, route);
    }
    const service = normalizeInputBoxTranslationService(
        current.inputBoxTranslationService,
        current.customOpenAIProviders,
    ) || current.service;
    const model = normalizeInputBoxTranslationModel(current.inputBoxTranslationModel);
    const configuredModel = resolveConfiguredModel(current.model[service], current.customModel[service]);
    const effectiveModel = model || configuredModel;
    const promptEnabled = supportsInputBoxTranslationPrompt(service, effectiveModel);
    const snapshotSource = {
        ...current,
        ...(promptEnabled ? {
            system_role: {
                ...current.system_role,
                [service]: normalizeInputBoxTranslationPrompt(current.inputBoxTranslationSystemPrompt)
                    .trim() || DEFAULT_INPUT_BOX_TRANSLATION_SYSTEM_PROMPT,
            },
            user_role: {
                ...current.user_role,
                [service]: completeInputBoxTranslationPrompt(current.inputBoxTranslationPrompt),
            },
        } : {}),
    };
    let snapshot = createTranslationProviderConfigSnapshot(snapshotSource);
    let request: TranslationSingleRequestMessage = {
        origin: text,
        sourceLanguage: 'auto',
        targetLanguage,
        enableAIContext: false,
        glossaryIds: [],
        serviceOverride: service,
        ...(servicesType.isUseModel(service) && model ? {modelOverride: model} : {}),
        useCache: current.useCache,
    };
    if (NATIVE_PRIVATE_ROUTE_SUPPORTED) {
        if (route) snapshot = lockIncognitoRoute(snapshot, route);
        if (privacy !== undefined) request = attachTranslationSourcePrivacy(request, privacy);
    }
    return attachTranslationProviderConfig(request, snapshot);
}

/** 创建输入框翻译 handler；服务、模型、提示词和凭据均由后台配置快照决定。 */
export function createInputBoxTranslationHandler(
    dependencies: InputBoxTranslationDependencies,
): InputBoxTranslationHandler {
    const registry = NATIVE_PRIVATE_ROUTE_SUPPORTED ? dependencies.requestRegistry ?? createTranslationRequestRegistry() : undefined;
    return {
        type: INPUT_BOX_TRANSLATION_MESSAGE_TYPE,
        async handle(message, context) {
            // 步骤 1：页面消息先经过严格协议收窄，避免对象、HTML 或空值进入翻译 broker。
            const text = parseRequiredString(message.text, 'text');
            const targetLanguage = parseRequiredString(message.targetLang, 'targetLang');

            let result: string | string[];
            if (NATIVE_PRIVATE_ROUTE_SUPPORTED) {
                const clientRequestId = parseClientRequestId(message.clientRequestId, true);
                const captured = captureTranslationRequestContext(context);
                assertNativeDocumentContext(captured, dependencies.requireDocumentOwner);
                const operation = async (signal?: AbortSignal, ownershipKey?: string) => {
                    await waitForTranslationRequestPreparation(dependencies.ready, signal);
                    throwIfTranslationRequestAborted(signal);
                    const privacy = dependencies.resolveSourcePrivacy
                        ? await waitForTranslationRequestPreparation(dependencies.resolveSourcePrivacy(captured.sender), signal) : 'unknown';
                    throwIfTranslationRequestAborted(signal);
                    // 步骤 2：身份、快照与私密路线先附着，不可枚举的 control 最后附着。
                    const request = createInputBoxTranslationRequest(dependencies.getConfig(), text, targetLanguage, privacy);
                    if (signal && ownershipKey) attachTranslationRequestControl(request, {signal, ownershipKey: `inputBoxTranslation:${ownershipKey}`});
                    throwIfTranslationRequestAborted(signal);
                    const translated = await dependencies.translate(request);
                    throwIfTranslationRequestAborted(signal);
                    return translated;
                };
                result = await (clientRequestId ? registry!.run(clientRequestId, captured, operation) : operation());
            } else {
                await dependencies.ready;
                result = await dependencies.translate(createInputBoxTranslationRequest(dependencies.getConfig(), text, targetLanguage));
            }
            const translatedText = Array.isArray(result) ? result[0] : result;
            if (typeof translatedText !== 'string' || !translatedText.trim()) {
                throw new Error('输入框翻译未返回有效译文');
            }
            return {success: true, translatedText};
        },
    };
}

/** 独立注册表由后台 composition root 共享给输入 start/cancel，避免与通用文本交叉取消。 */
export function createInputBoxTranslationCancelHandler(registry: TranslationRequestRegistry) {
    return {
        type: INPUT_BOX_TRANSLATION_CANCEL_MESSAGE_TYPE,
        handle(message: InputBoxTranslationCancelMessage, context: InputBoxTranslationContext = {}): TranslationCancelResponse {
            return registry.cancel(message.clientRequestId, context);
        },
    };
}
