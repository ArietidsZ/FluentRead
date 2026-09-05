/**
 * @file src/core/config/credentialBinding.ts
 * 文件职责：把服务凭据绑定到请求实际抵达的配置地址，防止配置替换后把旧密钥带到另一端点。
 * 主要内容：按 provider 的真实路由计算 token 与腾讯共享密钥的目标身份，并在目标变化且未显式重新绑定时丢弃旧凭据。
 * 模块边界：本文件只做 Config、凭据映射与 URL 的纯比较，不读取存储、不执行请求；调用方仍负责配置合并与持久化。
 */
import {
    currentModelIds,
    resolveConfiguredModel,
    services,
    servicesType,
} from './catalog';
import {
    getMimoEndpoint,
    MINIMAX_ENDPOINTS,
    tongyiTokenPlanUrl,
    urls,
} from './constants';
import {getCustomOpenAIProvider, isCustomOpenAIProviderId} from './customOpenAI';
import {DEFAULT_DEEPLX_ENDPOINT, parseDeepLXEndpoints} from './deeplx';
import type {ConfigCredentialField, ConfigCredentials} from './credentials';
import type {Config} from './model';

function canonicalFetchEndpoint(value: string): string {
    const endpoint = value.trim();
    if (!endpoint) return '';
    try {
        const url = new URL(endpoint);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return endpoint;
        url.hash = '';
        return url.toString();
    } catch {
        return endpoint;
    }
}

function canonicalOpenAICompatibleEndpoint(value: string): string {
    const endpoint = canonicalFetchEndpoint(value);
    try {
        const url = new URL(endpoint);
        url.searchParams.sort();
        if (/\/chat\/completions\/$/u.test(url.pathname)) {
            url.pathname = url.pathname.slice(0, -1);
        }
        return url.toString();
    } catch {
        return endpoint;
    }
}

function canonicalNewApiEndpoint(value: string): string {
    const endpoint = value.trim();
    if (!endpoint) return '';
    try {
        const url = new URL(endpoint);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return endpoint;
        url.hash = '';
        url.searchParams.sort();
        const path = url.pathname.replace(/\/+$/u, '');
        if (/\/chat\/completions$/u.test(path)) url.pathname = path;
        else if (/\/v1$/u.test(path)) url.pathname = `${path}/chat/completions`;
        else url.pathname = `${path}/v1/chat/completions`;
        return url.toString();
    } catch {
        return endpoint;
    }
}

function configuredTongyiDestinations(config: Config): string {
    const service = services.tongyi;
    const configuredModels = [
        resolveConfiguredModel(config.model[service], config.customModel[service]),
        resolveConfiguredModel(config.documentModel[service], config.documentCustomModel[service]),
    ];
    return Array.from(new Set(configuredModels.map((model) => (
        model === currentModelIds.tongyiTokenPlan
            ? canonicalFetchEndpoint(tongyiTokenPlanUrl)
            : canonicalFetchEndpoint(String(urls[service]))
    )))).sort().join('|');
}

function configuredDeepLXDestinations(config: Config): string {
    const proxyEndpoints = parseDeepLXEndpoints(config.proxy[services.deeplx]);
    const configuredEndpoints = proxyEndpoints.length > 0
        ? proxyEndpoints
        : parseDeepLXEndpoints(config.deeplx);
    return (configuredEndpoints.length > 0 ? configuredEndpoints : [DEFAULT_DEEPLX_ENDPOINT])
        .map(canonicalFetchEndpoint)
        .sort()
        .join('|');
}

function urlDestination(service: string, value: string): string {
    const endpoint = servicesType.isAiSdk(service)
        ? canonicalOpenAICompatibleEndpoint(value)
        : canonicalFetchEndpoint(value);
    return `urls:${endpoint}`;
}

function tokenCredentialDestination(config: Config, service: string): string {
    if (isCustomOpenAIProviderId(service)) {
        const proxy = config.proxy[service]?.trim();
        if (proxy) return urlDestination(service, proxy);
        const endpoint = getCustomOpenAIProvider(config.customOpenAIProviders, service)?.endpoint || '';
        return urlDestination(service, endpoint);
    }
    // AI SDK 的 NewAPI/Azure 路由不读取通用 proxy，必须按真实直连字段绑定。
    if (service === services.newapi) return `urls:${canonicalNewApiEndpoint(config.newApiUrl)}`;
    if (service === services.azureOpenai) return urlDestination(service, config.azureOpenaiEndpoint);
    if (service === services.azureTranslator) return urlDestination(service, urls[service]);
    // Gemini 代理请求按协议不携带 x-goog-api-key；Key 始终只信任 Google 官方端点，
    // 因此代理开关或代理地址变化不能误删仍安全保存的官方凭据。
    if (service === services.gemini) return urlDestination(service,
        'https://generativelanguage.googleapis.com/',
    );
    if (service === services.deeplx) return `urls:${configuredDeepLXDestinations(config)}`;
    const proxy = config.proxy[service]?.trim();
    if (proxy) return urlDestination(service, proxy);
    if (service === services.minimax) {
        const plan = config.minimaxBillingPlan === 'token-plan' ? 'token-plan' : 'payg';
        const region = config.minimaxRegion === 'global' ? 'global' : 'cn';
        return urlDestination(service, MINIMAX_ENDPOINTS[plan][region]);
    }
    if (service === services.mimo) {
        return urlDestination(service, getMimoEndpoint(config.mimoBillingPlan, config.mimoRegion));
    }
    if (service === services.tongyi) {
        return `urls:${configuredTongyiDestinations(config)}`;
    }
    const officialEndpoint = urls[service];
    return typeof officialEndpoint === 'string' && officialEndpoint.trim()
        ? urlDestination(service, officialEndpoint)
        : `service:${service}`;
}

function tencentCredentialDestination(config: Config): string {
    return [services.tencent, services.huanYuanTranslation]
        .map((service) => tokenCredentialDestination(config, service))
        .join('|');
}

const TENCENT_CREDENTIAL_FIELDS = [
    'tencentSecretId',
    'tencentSecretKey',
] as const satisfies readonly ConfigCredentialField[];

export function dropCredentialsForChangedDestinations(
    credentials: ConfigCredentials,
    current: Config,
    next: Config,
    explicitlyBoundTokens: ReadonlySet<string> = new Set(),
    explicitlyBoundCredentialFields: ReadonlySet<ConfigCredentialField> = new Set(),
): ConfigCredentials {
    const token = {...credentials.token};
    let tokenChanged = false;
    for (const service of Object.keys(token)) {
        if (tokenCredentialDestination(current, service) === tokenCredentialDestination(next, service)) continue;
        if (explicitlyBoundTokens.has(service)) continue;
        tokenChanged = true;
        delete token[service];
    }

    let nextCredentials = tokenChanged ? {...credentials, token} : credentials;
    const tencentDestinationChanged = tencentCredentialDestination(current)
        !== tencentCredentialDestination(next);
    const explicitlyBoundTencentPair = TENCENT_CREDENTIAL_FIELDS.every((field) => (
        explicitlyBoundCredentialFields.has(field)
    ));
    if (tencentDestinationChanged && !explicitlyBoundTencentPair
        && TENCENT_CREDENTIAL_FIELDS.some((field) => Boolean(nextCredentials[field]))) {
        nextCredentials = {
            ...nextCredentials,
            tencentSecretId: '',
            tencentSecretKey: '',
        };
    }
    return nextCredentials;
}
