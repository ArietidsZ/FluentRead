/**
 * @file src/services/translation/documentChannel.ts
 * 文件职责：定义文本、批量文本、输入框、设置识图检测和划词原文词典共用的原生文档长连接协议。
 * 主要内容：版本化端口名称以及严格限定的 start/cancel 消息集合；公开请求 ID 只用于同连接内定位，不提供文档身份。
 * 模块边界：不连接浏览器或供应商，不授予 capability；真实连接租约由 platform 后台 Port 工厂创建。
 */
import {createNativeDocumentPortHandler} from '@/src/platform/browser/documentSession';
import type {BrowserRequestContext} from '@/src/platform/browser/requestOwner';
import type {TranslationRequestRegistry} from './requestRegistry';
import {NATIVE_PRIVATE_ROUTE_SUPPORTED} from '@/src/core/config/incognitoRoute';
export const TRANSLATION_DOCUMENT_PORT = 'fluentReadTranslationDocument:v1';
export const TRANSLATION_DOCUMENT_VERSION = 1;
export function isTranslationDocumentOperation(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const message = value as Record<string, unknown>;
    if (typeof message.clientRequestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(message.clientRequestId)) return false;
    if (Object.prototype.hasOwnProperty.call(message, 'type')) {
        if (NATIVE_PRIVATE_ROUTE_SUPPORTED && ['fluentReadModelVisionProbe', 'fluentReadModelVisionProbeCancel', 'selectionWordLookup', 'selectionWordLookupCancel'].includes(message.type as string)) return true;
        return ['fluentReadTranslationCancel', 'inputBoxTranslation', 'inputBoxTranslationCancel'].includes(message.type as string);
    }
    return Object.prototype.hasOwnProperty.call(message, 'origin');
}
export function translationDocumentCancelKey(message: Record<string, unknown>): string | undefined {
    const type = message.type;
    if (NATIVE_PRIVATE_ROUTE_SUPPORTED && type === 'fluentReadModelVisionProbeCancel') return `vision:${message.clientRequestId}`;
    if (NATIVE_PRIVATE_ROUTE_SUPPORTED && type === 'selectionWordLookupCancel') return `dictionary:${message.clientRequestId}`;
    if (type !== 'fluentReadTranslationCancel' && type !== 'inputBoxTranslationCancel') return undefined;
    return `${type === 'inputBoxTranslationCancel' ? 'input' : 'text'}:${message.clientRequestId}`;
}
export function translationDocumentRequestKey(message: Record<string, unknown>): string {
    if (NATIVE_PRIVATE_ROUTE_SUPPORTED && message.type === 'fluentReadModelVisionProbe') return `vision:${message.clientRequestId}`;
    if (NATIVE_PRIVATE_ROUTE_SUPPORTED && message.type === 'selectionWordLookup') return `dictionary:${message.clientRequestId}`;
    return `${message.type === 'inputBoxTranslation' ? 'input' : 'text'}:${message.clientRequestId}`;
}

/** 共用原生产 router，只装配协议白名单和各独立注册表的撤销。 */
export function createTranslationDocumentPortHandler(options: {
    runtimeId: string;
    dispatch(message: Record<string, unknown>, context: BrowserRequestContext): Promise<{handled: boolean; response?: unknown}>;
    registries: TranslationRequestRegistry[];
}) {
    return createNativeDocumentPortHandler({runtimeId: options.runtimeId, name: TRANSLATION_DOCUMENT_PORT, version: TRANSLATION_DOCUMENT_VERSION,
        accepts: isTranslationDocumentOperation,
        dispatch: async (message, context) => {const result = await options.dispatch(message, context); return result.handled ? result.response : {success: false, error: '不支持的后台消息'};},
        releaseOwner: context => {for (const registry of options.registries) registry.releaseOwner(context);},
    });
}
