/**
 * @file src/core/config/credentialBinding.ts
 * 文件职责：把按服务保存的 token 绑定到请求实际抵达的配置地址，防止配置替换后把旧密钥带到另一端点。
 * 主要内容：计算 proxy 优先的凭据目标身份，并在导入、历史恢复或自动备份恢复时丢弃目标已变化且未显式重新提供的 token。
 * 模块边界：本文件只比较规范化 Config 与凭据映射，不读取存储、不解析网络 URL、不执行请求；调用方仍负责配置合并与持久化。
 */
import {getCustomOpenAIProvider, isCustomOpenAIProviderId} from './customOpenAI';
import {services} from './catalog';
import type {ConfigCredentials} from './credentials';
import type {Config} from './model';

function credentialDestination(config: Config, service: string): string {
    if (isCustomOpenAIProviderId(service)) {
        const proxy = config.proxy[service]?.trim();
        if (proxy) return `proxy:${proxy}`;
        const endpoint = getCustomOpenAIProvider(config.customOpenAIProviders, service)?.endpoint || '';
        return `custom:${endpoint.trim()}`;
    }
    // AI SDK 的 NewAPI/Azure 路由不读取通用 proxy，必须按真实直连字段绑定。
    if (service === services.newapi) return `newapi:${config.newApiUrl.trim()}`;
    if (service === services.azureOpenai) return `azure:${config.azureOpenaiEndpoint.trim()}`;
    const proxy = config.proxy[service]?.trim();
    if (proxy) return `proxy:${proxy}`;
    if (service === services.deeplx) return `deeplx:${config.deeplx.trim()}`;
    return `service:${service}`;
}

export function dropTokensForChangedCredentialDestinations(
    credentials: ConfigCredentials,
    current: Config,
    next: Config,
    explicitlyBoundTokens: ReadonlySet<string> = new Set(),
): ConfigCredentials {
    const token = {...credentials.token};
    let changed = false;
    for (const service of Object.keys(token)) {
        if (credentialDestination(current, service) === credentialDestination(next, service)) continue;
        if (explicitlyBoundTokens.has(service)) continue;
        changed = true;
        delete token[service];
    }
    return changed ? {...credentials, token} : credentials;
}
