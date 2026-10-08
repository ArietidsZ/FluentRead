/**
 * @file src/core/config/incognitoRoute.ts
 * 文件职责：验证私密来源专用服务和模型，拒绝失效配置及请求体或端点的模型冲突。
 * 主要内容：保留错误类型的失败标记，从服务目录和已保存模型解析独立路由，以内部 symbol 冻结模型身份。
 * 模块边界：纯配置领域规则，不读取浏览器、存储或凭据，不发送请求，也不推断来源是否私密。
 */
import {customModelString, models, services, servicesType} from './catalog';
import {getCustomOpenAIProvider, isConfiguredCustomOpenAIProvider, isCustomOpenAIProviderId, type CustomOpenAIProvider} from './customOpenAI';

// 使用既有保留占位符保留错误类型；它不能成为实际服务或模型。
const INVALID_FIELD = customModelString;
const ROUTE = Symbol('fluentread.incognito-route');
/** 构建目标能力；油猴适配器为 false，不是用户可设置的信任字段。 */
export const NATIVE_PRIVATE_ROUTE_SUPPORTED = true;

export interface IncognitoRouteConfig {
    incognitoService?: unknown;
    incognitoModel?: unknown;
    customModels?: Readonly<Record<string, readonly string[]>>;
    customOpenAIProviders?: readonly CustomOpenAIProvider[];
    customBody?: Readonly<Record<string, string>>;
    proxy?: Readonly<Record<string, string>>;
    azureOpenaiEndpoint?: string;
}

export interface IncognitoRoute {readonly service: string; readonly model: string}

/** 只有 undefined/空字符串是未设置；null、错误类型和失效占位符仍要求可信来源。 */
export function hasConfiguredIncognitoRoute(config: IncognitoRouteConfig): boolean {
    return (config.incognitoService !== undefined && config.incognitoService !== '')
        || (config.incognitoModel !== undefined && config.incognitoModel !== '');
}

/** 缺省仍为空；错误类型不能被归一化为空并意外恢复普通线路。 */
export function normalizeIncognitoRouteField(value: unknown): string {
    if (value === undefined) return '';
    return typeof value === 'string' ? value.trim() : INVALID_FIELD;
}

export function initializeIncognitoRouteConfig(config: {incognitoService: string; incognitoModel: string}): void {
    config.incognitoService = '';
    config.incognitoModel = '';
}

export function normalizeIncognitoRouteConfig(config: {incognitoService: string; incognitoModel: string}, source: IncognitoRouteConfig): void {
    config.incognitoService = normalizeIncognitoRouteField(source.incognitoService);
    config.incognitoModel = normalizeIncognitoRouteField(source.incognitoModel);
}

function fail(): never {throw new Error('私密翻译服务或模型配置无效，请检查独立配置');}

export function resolveIncognitoRoute(config: IncognitoRouteConfig): IncognitoRoute | undefined {
    const service = config.incognitoService === undefined ? '' : config.incognitoService;
    const model = config.incognitoModel === undefined ? '' : config.incognitoModel;
    if (service === '' && model === '') return undefined;
    if (typeof service !== 'string' || typeof model !== 'string'
        || !service || service.trim() !== service || model.trim() !== model
        || service === INVALID_FIELD || model === INVALID_FIELD) fail();
    const customProviders = config.customOpenAIProviders ?? [];
    const custom = isCustomOpenAIProviderId(service);
    if (custom ? !isConfiguredCustomOpenAIProvider(customProviders, service)
        : !servicesType.machine.has(service) && !servicesType.AI.has(service)) fail();
    if (servicesType.isUseModel(service)) {
        // 本地模型必须先通过目录校验，不能交给会默认回退的 local normalizer。
        const allowed = custom ? getCustomOpenAIProvider(customProviders, service)!.models
            : [...(models.get(service) ?? []), ...(service === services.localTranslation ? [] : config.customModels?.[service] ?? [])];
        if (!model || model.includes('（') || !allowed.includes(model)) fail();
    } else if (model !== '') fail();

    const body = config.customBody?.[service];
    if (body?.trim()) {
        let parsed: unknown;
        try {parsed = JSON.parse(body);} catch {fail();}
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail();
        for (const field of ['model', 'Model']) {
            if (Object.prototype.hasOwnProperty.call(parsed, field)
                && (parsed as Record<string, unknown>)[field] !== model) {
                throw new Error('私密翻译模型与高级请求体冲突');
            }
        }
    }
    const endpoint = service === services.gemini ? config.proxy?.[service]
        : service === services.azureOpenai ? config.azureOpenaiEndpoint : undefined;
    if (endpoint?.trim()) {
        let url: URL;
        try {url = new URL(endpoint.replaceAll('{model}', encodeURIComponent(model)).replaceAll('{key}', 'redacted'));}
        catch {throw new Error('私密翻译端点配置无效');}
        const bound = url.pathname.match(service === services.gemini ? /\/models\/([^/:]+):/u : /\/deployments\/([^/]+)/u);
        if (bound) {
            let endpointModel: string;
            try {endpointModel = decodeURIComponent(bound[1]);} catch {throw new Error('私密翻译端点配置无效');}
            if (endpointModel !== model) throw new Error('私密翻译模型与端点绑定冲突');
        }
    }
    return Object.freeze({service, model});
}

/** 内部路由标记随对象展开保留，但不能由 JSON runtime 消息或导入配置构造。 */
export function lockIncognitoRoute<T extends object>(config: T, route: IncognitoRoute): T {
    return Object.freeze({...config, [ROUTE]: Object.freeze({...route})});
}

export function getLockedIncognitoRoute(config: object): IncognitoRoute | undefined {
    return (config as {[ROUTE]?: IncognitoRoute})[ROUTE];
}
