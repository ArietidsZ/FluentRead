/**
 * @file src/services/translation/requestSnapshot.ts
 *
 * 文件职责：在翻译消息上附加只读 provider 配置快照，消除异步缓存读取期间全局配置变化造成的请求身份错配。
 * 主要内容：定义 TRANSLATION_PROVIDER_CONFIG 符号与请求上下文类型，精确复制 token、proxy、model、prompt 等字段，并提供 attach/get 函数供 broker 和 provider 共享同一快照。 可核对的公开符号包括 TRANSLATION_PROVIDER_CONFIG、TranslationProviderRequestContext、createTranslationProviderConfigSnapshot、attachTranslationProviderConfig、getTranslationProviderConfig。
 * 模块边界：本文件位于翻译 application service 层，负责用例编排和端口契约；不挂载页面 UI，且不应把某家供应商的网络细节扩散到 feature，具体 HTTP 协议由 providers/platform 实现。
 */

import type {
    TranslationConfigSource,
    TranslationProviderConfigSnapshot,
} from './types';

/** 内部 symbol 无法由 content runtime 消息伪造，也不会进入网络 JSON。 */
export const TRANSLATION_PROVIDER_CONFIG = Symbol('fluentread.translation-provider-config');

export type TranslationProviderRequestContext = {
    readonly [TRANSLATION_PROVIDER_CONFIG]?: TranslationProviderConfigSnapshot;
};

function frozenStringMap(value: Record<string, string> | undefined): Readonly<Record<string, string>> {
    return Object.freeze({...value});
}

function frozenBooleanMap(value: Record<string, boolean> | undefined): Readonly<Record<string, boolean>> {
    return Object.freeze({...value});
}

/**
 * 在任何 await 之前复制 provider 与缓存身份会读取的字段。嵌套映射和顶层对象
 * 均冻结，配置页后续原地修改不会改变已在途请求。
 */
export function createTranslationProviderConfigSnapshot(
    source: TranslationConfigSource,
): TranslationProviderConfigSnapshot {
    return Object.freeze({
        ...source,
        model: frozenStringMap(source.model),
        customModel: frozenStringMap(source.customModel),
        proxy: frozenStringMap(source.proxy),
        robot_id: frozenStringMap(source.robot_id),
        customBody: frozenStringMap(source.customBody),
        system_role: frozenStringMap(source.system_role),
        user_role: frozenStringMap(source.user_role),
        token: frozenStringMap(source.token),
        requireApiKey: frozenBooleanMap(source.requireApiKey),
        youdaoAppKey: source.youdaoAppKey ?? '',
        youdaoAppSecret: source.youdaoAppSecret ?? '',
        tencentSecretId: source.tencentSecretId ?? '',
        tencentSecretKey: source.tencentSecretKey ?? '',
    }) as TranslationProviderConfigSnapshot;
}

export function attachTranslationProviderConfig<T extends object>(
    message: T,
    snapshot: TranslationProviderConfigSnapshot,
): T & TranslationProviderRequestContext {
    return Object.assign(message, {[TRANSLATION_PROVIDER_CONFIG]: snapshot});
}

/** Provider 直调测试保留 fallback；broker 路径始终命中不可伪造的 request snapshot。 */
export function getTranslationProviderConfig(
    message: unknown,
    fallback: TranslationProviderConfigSnapshot,
): TranslationProviderConfigSnapshot {
    if (message && typeof message === 'object') {
        const snapshot = (message as TranslationProviderRequestContext)[TRANSLATION_PROVIDER_CONFIG];
        if (snapshot) return snapshot;
    }
    return fallback;
}
