/**
 * @file src/providers/translation/connectionTest.ts
 *
 * 文件职责：通过真实 provider registry 执行最小翻译连接测试，覆盖服务鉴权、端点、模型配置和响应解析。
 * 主要内容：使用固定英文测试文本调用指定适配器，验证非空结果并返回耗时；formatConnectionTestError 将失败转换为带服务名的可读消息。 可核对的公开符号包括 CONNECTION_TEST_ORIGIN、runTranslationServiceConnectionTest、formatConnectionTestError。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {translationProviderRegistry} from './registry';
import {formatServiceError} from '@/src/services/translation/serviceErrors';

export const CONNECTION_TEST_ORIGIN = 'Hello from FluentRead.';

function isNonEmptyText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/** 通过现有服务适配器发出真实的最小翻译请求，覆盖鉴权、端点、模型和响应解析。 */
export async function runTranslationServiceConnectionTest(service: string): Promise<{durationMs: number}> {
    const adapter = translationProviderRegistry[service];
    if (!adapter) {
        throw new Error(`未找到翻译服务适配器: ${service}`);
    }

    const startedAt = Date.now();
    const result = await adapter({
        origin: CONNECTION_TEST_ORIGIN,
        context: '',
        pageContext: '',
        summaryPrompt: '',
        summarySystemPrompt: '',
        serviceOverride: service,
        useCache: false,
        requestTimeoutMs: 30_000,
    });

    if (!isNonEmptyText(result)) {
        throw new Error('服务已响应，但没有返回有效译文');
    }

    return {durationMs: Math.max(0, Date.now() - startedAt)};
}

export function formatConnectionTestError(service: string, error: unknown): string {
    return formatServiceError(service, error);
}
