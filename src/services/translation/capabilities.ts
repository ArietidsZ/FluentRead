/**
 * @file src/services/translation/capabilities.ts
 *
 * 文件职责：把浏览器能力映射为翻译服务可用性，防止不支持的平台展示或调用 Chrome 内置翻译。
 * 主要内容：声明不可用提示，提供 isTranslationServiceAvailable、getTranslationServiceUnavailableMessage 与 filterAvailableTranslationServices，根据 BrowserCapabilities 过滤服务选项。 可核对的公开符号包括 CHROME_TRANSLATOR_UNAVAILABLE_MESSAGE、isTranslationServiceAvailable、getTranslationServiceUnavailableMessage、filterAvailableTranslationServices。
 * 模块边界：本文件位于翻译 application service 层，负责用例编排和端口契约；不挂载页面 UI，且不应把某家供应商的网络细节扩散到 feature，具体 HTTP 协议由 providers/platform 实现。
 */

import {services} from '@/src/core/config/catalog';
import {
    browserCapabilities,
    type BrowserCapabilities,
} from '@/src/platform/browser/capabilities';

export const CHROME_TRANSLATOR_UNAVAILABLE_MESSAGE =
    '当前浏览器暂不支持 Chrome 内置翻译；原配置会保留，请切换到其他翻译服务。';

export function isTranslationServiceAvailable(
    service: string,
    capabilities: BrowserCapabilities = browserCapabilities,
): boolean {
    return service !== services.chromeTranslator || capabilities.chromeTranslation;
}

export function getTranslationServiceUnavailableMessage(
    service: string,
    capabilities: BrowserCapabilities = browserCapabilities,
): string | null {
    return isTranslationServiceAvailable(service, capabilities)
        ? null
        : CHROME_TRANSLATOR_UNAVAILABLE_MESSAGE;
}

export function filterAvailableTranslationServices<TOption extends {readonly value: string}>(
    options: readonly TOption[],
    capabilities: BrowserCapabilities = browserCapabilities,
): TOption[] {
    return options.filter((option) => isTranslationServiceAvailable(option.value, capabilities));
}
