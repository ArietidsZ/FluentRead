/**
 * @file src/core/config/requestLimits.ts
 *
 * 文件职责：定义翻译请求的全局、服务级和模型级限流配置契约，并提供安全的纯归一化、解析与不可变更新函数。
 * 主要内容：支持并发、每秒和每分钟三类上限；enabled=false 时保留用户填写的 custom 值但解析时继承上一级配置；映射使用无原型对象，避免特殊键污染配置边界。
 * 模块边界：本文件属于 core 配置领域层，只处理配置数据，不读取存储、不访问浏览器 API、不启动调度器；持久化与请求执行分别由 services 和 translation 层负责。
 */

import {
    normalizeMaxConcurrentTranslations,
    normalizeTranslationRequestsPerMinute,
    normalizeTranslationRequestsPerSecond,
} from './scheduling';

export interface TranslationRequestLimits {
    maxConcurrentTranslations: number;
    translationRequestsPerSecond: number;
    translationRequestsPerMinute: number;
}

export interface RequestLimitPreference {
    enabled: boolean;
    limits: TranslationRequestLimits;
}

export type ServiceRequestLimits = Record<string, RequestLimitPreference>;
export type ModelRequestLimits = Record<string, Record<string, RequestLimitPreference>>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function own(value: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function emptyRecord<T>(): Record<string, T> {
    return Object.create(null) as Record<string, T>;
}

const UNSAFE_MAPPING_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isSafeMappingKey(value: string): boolean {
    return value.length > 0 && !UNSAFE_MAPPING_KEYS.has(value);
}

export function normalizeTranslationRequestLimits(value: unknown): TranslationRequestLimits {
    const source = isRecord(value) ? value : {};
    return {
        maxConcurrentTranslations: normalizeMaxConcurrentTranslations(source.maxConcurrentTranslations),
        translationRequestsPerSecond: normalizeTranslationRequestsPerSecond(source.translationRequestsPerSecond),
        translationRequestsPerMinute: normalizeTranslationRequestsPerMinute(source.translationRequestsPerMinute),
    };
}

export function normalizeRequestLimitPreference(value: unknown): RequestLimitPreference {
    const source = isRecord(value) ? value : {};
    return {
        enabled: source.enabled === true,
        limits: normalizeTranslationRequestLimits(source.limits),
    };
}

export function normalizeServiceRequestLimits(value: unknown): ServiceRequestLimits {
    const result = emptyRecord<RequestLimitPreference>();
    if (!isRecord(value)) return result;
    for (const [service, preference] of Object.entries(value)) {
        if (!isSafeMappingKey(service)) continue;
        result[service] = normalizeRequestLimitPreference(preference);
    }
    return result;
}

export function normalizeModelRequestLimits(value: unknown): ModelRequestLimits {
    const result = emptyRecord<Record<string, RequestLimitPreference>>();
    if (!isRecord(value)) return result;
    for (const [service, models] of Object.entries(value)) {
        if (!isSafeMappingKey(service)) continue;
        if (!isRecord(models)) continue;
        const normalizedModels = emptyRecord<RequestLimitPreference>();
        for (const [model, preference] of Object.entries(models)) {
            if (!isSafeMappingKey(model)) continue;
            normalizedModels[model] = normalizeRequestLimitPreference(preference);
        }
        if (Object.keys(normalizedModels).length > 0) result[service] = normalizedModels;
    }
    return result;
}

export interface RequestLimitResolutionInput {
    globalLimits: unknown;
    serviceId?: unknown;
    modelId?: unknown;
    serviceRequestLimits?: unknown;
    modelRequestLimits?: unknown;
}

/** 解析有效配置：模型级 custom 优先，其次服务级 custom，最后共享全局 bucket。 */
export function resolveRequestLimits(input: RequestLimitResolutionInput): TranslationRequestLimits;
export function resolveRequestLimits(
    globalLimits: unknown,
    serviceId: unknown,
    modelId?: unknown,
    serviceRequestLimits?: unknown,
    modelRequestLimits?: unknown,
): TranslationRequestLimits;
export function resolveRequestLimits(
    inputOrGlobal: RequestLimitResolutionInput | unknown,
    serviceId?: unknown,
    modelId?: unknown,
    serviceRequestLimits?: unknown,
    modelRequestLimits?: unknown,
): TranslationRequestLimits {
    const input: RequestLimitResolutionInput = isRecord(inputOrGlobal) && own(inputOrGlobal, 'globalLimits')
        ? inputOrGlobal as unknown as RequestLimitResolutionInput
        : isRecord(inputOrGlobal) && own(inputOrGlobal, 'maxConcurrentTranslations')
            ? {
                globalLimits: inputOrGlobal,
                serviceId,
                modelId,
                serviceRequestLimits: serviceRequestLimits ?? inputOrGlobal.serviceRequestLimits,
                modelRequestLimits: modelRequestLimits ?? inputOrGlobal.modelRequestLimits,
            }
            : {globalLimits: inputOrGlobal, serviceId, modelId, serviceRequestLimits, modelRequestLimits};
    const globalLimits = normalizeTranslationRequestLimits(input.globalLimits);
    const service = typeof input.serviceId === 'string' ? input.serviceId : '';
    const model = typeof input.modelId === 'string' ? input.modelId : '';
    const servicePreference = service
        ? normalizeServiceRequestLimits(input.serviceRequestLimits)[service]
        : undefined;
    const modelPreference = service && model
        ? normalizeModelRequestLimits(input.modelRequestLimits)[service]?.[model]
        : undefined;
    if (modelPreference?.enabled) return {...modelPreference.limits};
    if (servicePreference?.enabled) return {...servicePreference.limits};
    return {...globalLimits};
}

export function getServiceRequestLimitPreference(
    mapping: unknown,
    serviceId: string,
): RequestLimitPreference | undefined {
    if (!serviceId) return undefined;
    const normalized = normalizeServiceRequestLimits(mapping);
    const preference = normalized[serviceId];
    return preference ? {enabled: preference.enabled, limits: {...preference.limits}} : undefined;
}

export function getModelRequestLimitPreference(
    mapping: unknown,
    serviceId: string,
    modelId: string,
): RequestLimitPreference | undefined {
    if (!serviceId || !modelId) return undefined;
    const preference = normalizeModelRequestLimits(mapping)[serviceId]?.[modelId];
    return preference ? {enabled: preference.enabled, limits: {...preference.limits}} : undefined;
}

export function withServiceRequestLimit(
    mapping: unknown,
    serviceId: string,
    preference: unknown,
): ServiceRequestLimits {
    const result = normalizeServiceRequestLimits(mapping);
    if (isSafeMappingKey(serviceId)) {
        result[serviceId] = normalizeRequestLimitPreference(preference);
    }
    return result;
}

export function withModelRequestLimit(
    mapping: unknown,
    serviceId: string,
    modelId: string,
    preference: unknown,
): ModelRequestLimits {
    const result = normalizeModelRequestLimits(mapping);
    if (!isSafeMappingKey(serviceId) || !isSafeMappingKey(modelId)) return result;
    const models = result[serviceId] ? {...result[serviceId]} : emptyRecord<RequestLimitPreference>();
    models[modelId] = normalizeRequestLimitPreference(preference);
    result[serviceId] = models;
    return result;
}

export function withoutModelRequestLimit(mapping: unknown, serviceId: string, modelId?: string): ModelRequestLimits {
    const result = normalizeModelRequestLimits(mapping);
    if (!own(result, serviceId)) return result;
    if (modelId === undefined) {
        delete result[serviceId];
        return result;
    }
    const models = {...result[serviceId]};
    delete models[modelId];
    if (Object.keys(models).length === 0) delete result[serviceId];
    else result[serviceId] = models;
    return result;
}
