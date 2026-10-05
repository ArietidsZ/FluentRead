/**
 * @file src/core/config/privateTranslation.ts
 * 文件职责：定义浏览器无痕窗口的独立翻译服务与模型配置，保持普通窗口配置不变。
 * 主要内容：确保专用模型优先于普通高级请求体 model 字段；归一化显式开关，校验专用供应商与模型，并生成单次调用使用的配置副本；无效配置拒绝调用，不回退普通服务。
 * 模块边界：纯配置规则，不检测浏览器窗口、不持久化、不发起模型或网络请求。
 */
import {parseCustomBody} from './customBody';
import {isLocalTranslationModel} from './localTranslation';
import {services, servicesType} from './catalog';
import {getCustomOpenAIProvider, isCustomOpenAIProviderId, type CustomOpenAIProvider} from './customOpenAI';

export interface PrivateTranslationProfile {enabled: boolean; service: string; model: string}
export function normalizePrivateTranslationProfile(value: unknown): PrivateTranslationProfile {
    const input = value && typeof value === 'object' ? value as Partial<PrivateTranslationProfile> : {};
    return {enabled: input.enabled === true,
        service: typeof input.service === 'string' ? input.service.trim().slice(0, 128) : '',
        model: typeof input.model === 'string' ? input.model.trim().slice(0, 256) : ''};
}
export function privateTranslationError(config: {privateTranslation: PrivateTranslationProfile; customOpenAIProviders: readonly CustomOpenAIProvider[]}): string | undefined {
    const {service, model} = config.privateTranslation;
    if (!service) return '请先配置无痕窗口专用翻译服务；不会回退普通窗口服务';
    if (service === services.freeTranslation
        || (!servicesType.machine.has(service) && !servicesType.isAI(service))
        || (isCustomOpenAIProviderId(service) && !getCustomOpenAIProvider(config.customOpenAIProviders, service))) {
        return '无痕窗口专用服务不可用，请重新选择；不会回退其他服务';
    }
    if (service === services.localTranslation && !isLocalTranslationModel(model)) return '无痕窗口专用本地模型不可用，请重新选择';
    if (servicesType.isUseModel(service) && !model) return '请先配置无痕窗口专用模型';
    return undefined;
}
/** 保留其余高级参数，但专用模型不能被普通服务的高级 model 字段覆盖。 */
export function privateTranslationCustomBody(mapping: Record<string, string>, service: string): Record<string, string> {
    if (!servicesType.isUseModel(service)) return mapping;
    const body = parseCustomBody(mapping[service]);
    if (!body || !Object.prototype.hasOwnProperty.call(body, 'model')) return mapping;
    delete body.model;
    return {...mapping, [service]: JSON.stringify(body)};
}
/** 仅声明本规则实际读取的字段，避免依赖完整 Config 并反向形成配置模块循环。 */
interface PrivateTranslationConfigSource {
    privateTranslation: PrivateTranslationProfile;
    customOpenAIProviders: readonly CustomOpenAIProvider[];
    model: Record<string, string>;
    customModel: Record<string, string>;
    customBody: Record<string, string>;
    harness: {service: string; model: string};
    writing: {service: string; model: string};
}
/** 只复制会被覆写的层；保留调用方具体配置类型，不修改普通功能分配。 */
export function resolvePrivateTranslationConfig<T extends PrivateTranslationConfigSource>(current: T, privateContext: boolean): T {
    if (!privateContext || !current.privateTranslation?.enabled) return current;
    const error = privateTranslationError(current);
    if (error) throw new Error(error);
    const {service, model} = current.privateTranslation;
    return {...current, service, useCache: false,
        customBody: privateTranslationCustomBody(current.customBody, service),
        inputBoxTranslationService: service, inputBoxTranslationModel: model, areaTranslationService: service,
        model: {...current.model, [service]: model}, customModel: {...current.customModel, [service]: model},
        harness: {...current.harness, service, model}, writing: {...current.writing, service, model}};
}
