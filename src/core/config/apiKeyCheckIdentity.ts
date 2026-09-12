/**
 * @file src/core/config/apiKeyCheckIdentity.ts
 * 文件职责：为按行 API Key 连通性检测生成不泄露密钥的配置指纹，阻止跨窗口检测把结果写到错误配置行。
 * 主要内容：按服务提取 endpoint、代理、模型、请求参数、计费路由、自定义 provider 和原始 key 行，计算稳定 SHA-256 指纹并校验其格式。
 * 模块边界：本文件只做纯身份计算，不读写配置、不发起网络请求、不保存健康状态；调用方负责在检测开始前执行校验。
 */

import sha256 from 'crypto-js/sha256';
import {getServiceApiKeyRows, type ApiKeyConfigSource} from './apiKeys';

export interface ApiKeyCheckIdentitySource extends ApiKeyConfigSource {
    proxy?: unknown;
    customBody?: unknown;
    customHeaders?: unknown;
    model?: unknown;
    customModel?: unknown;
    custom?: unknown;
    deeplx?: unknown;
    deeplApiPlan?: unknown;
    newApiUrl?: unknown;
    azureOpenaiEndpoint?: unknown;
    minimaxRegion?: unknown;
    minimaxBillingPlan?: unknown;
    mimoRegion?: unknown;
    mimoBillingPlan?: unknown;
    deepseekApiType?: unknown;
    customOpenAIProviders?: unknown;
}

function serviceMapValue(source: ApiKeyCheckIdentitySource, name: string, service: string): unknown {
    const value = (source as unknown as Record<string, unknown>)[name];
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)[service]
        : undefined;
}

/** 仅返回 64 位十六进制摘要；原始 key 只参与本地 hash，不进入返回值。 */
export function createApiKeyCheckRevision(source: ApiKeyCheckIdentitySource, service: string): string {
    const routeFields: Record<string, readonly string[]> = {
        custom: ['custom'],
        deeplx: ['deeplx'],
        deepL: ['deeplApiPlan'],
        newapi: ['newApiUrl'],
        azureOpenai: ['azureOpenaiEndpoint'],
        minimax: ['minimaxRegion', 'minimaxBillingPlan'],
        mimo: ['mimoRegion', 'mimoBillingPlan'],
        deepseek: ['deepseekApiType'],
    };
    const route: Record<string, unknown> = {};
    const fields = source as unknown as Record<string, unknown>;
    for (const name of routeFields[service] ?? []) route[name] = fields[name];
    const customProvider = Array.isArray(source.customOpenAIProviders)
        ? source.customOpenAIProviders
            .filter((item) => item && typeof item === 'object'
                && (item as {id?: unknown}).id === service)
            .map((item) => {
                const provider = item as {id?: unknown; endpoint?: unknown; models?: unknown};
                return {id: provider.id, endpoint: provider.endpoint, models: provider.models};
            })[0]
        : undefined;
    const identity = {
        service,
        keyRows: getServiceApiKeyRows(source, service),
        proxy: serviceMapValue(source, 'proxy', service),
        customBody: serviceMapValue(source, 'customBody', service),
        customHeaders: serviceMapValue(source, 'customHeaders', service),
        model: serviceMapValue(source, 'model', service),
        customModel: serviceMapValue(source, 'customModel', service),
        route,
        customProvider,
    };
    return sha256(JSON.stringify(identity)).toString();
}

export function matchesApiKeyCheckRevision(
    source: ApiKeyCheckIdentitySource,
    service: string,
    revision: unknown,
): revision is string {
    return typeof revision === 'string'
        && /^[a-f0-9]{64}$/u.test(revision)
        && createApiKeyCheckRevision(source, service) === revision;
}
