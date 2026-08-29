/**
 * @file src/app/background/handlers/modelUsage.ts
 * 文件职责：为设置页提供类型化的大模型用量查询与独立重置后台消息协议。
 * 主要内容：校验 query/reset 动作、服务模型筛选和时间范围，调用注入仓库并把成功或存储错误转换成可传输响应。
 * 模块边界：本文件不直接访问 IndexedDB、不记录 provider 请求，也不处理图表渲染；仓库和采集器由后台组合根注入。
 */

import type {BackgroundMessageHandler} from '../messageRouter';
import type {DashboardSnapshot, Filter, Range} from '@/src/services/model-usage/types';

export const MODEL_USAGE_MESSAGE_TYPE = 'modelUsage' as const;

export interface ModelUsageQueryMessage {
    type: typeof MODEL_USAGE_MESSAGE_TYPE;
    action: 'query';
    filter?: unknown;
}

export interface ModelUsageResetMessage {
    type: typeof MODEL_USAGE_MESSAGE_TYPE;
    action: 'reset';
}

export type ModelUsageMessage = ModelUsageQueryMessage | ModelUsageResetMessage | {
    type: typeof MODEL_USAGE_MESSAGE_TYPE;
    action?: unknown;
    filter?: unknown;
};

export type ModelUsageResponse =
    | {success: true; data: DashboardSnapshot}
    | {success: true; data: {cleared: true}}
    | {success: false; error: string};

export interface ModelUsageRepositoryContract {
    getDashboard(filter: Filter): Promise<DashboardSnapshot>;
    clear(): Promise<void>;
}

const VALID_RANGES = new Set<Range>(['today', '7d', '30d']);
const MAX_FILTER_LENGTH = 200;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function optionalFilterText(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw new TypeError(`模型用量筛选 ${field} 必须是字符串`);
    const normalized = value.trim();
    if (!normalized || normalized.length > MAX_FILTER_LENGTH) {
        throw new TypeError(`模型用量筛选 ${field} 无效`);
    }
    return normalized;
}

export function parseModelUsageFilter(value: unknown): Filter {
    if (value === undefined) return {range: '30d'};
    if (!isPlainRecord(value)) throw new TypeError('模型用量筛选必须是对象');
    if (!VALID_RANGES.has(value.range as Range)) {
        throw new TypeError('模型用量筛选 range 无效');
    }
    const serviceId = optionalFilterText(value.serviceId, 'serviceId');
    const model = optionalFilterText(value.model, 'model');
    return {
        range: value.range as Range,
        ...(serviceId ? {serviceId} : {}),
        ...(model ? {model} : {}),
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error && error.message.trim()
        ? error.message
        : '模型用量统计暂时不可用';
}

export function createModelUsageHandler(
    repository: ModelUsageRepositoryContract,
): BackgroundMessageHandler<unknown, ModelUsageMessage, ModelUsageResponse> {
    return {
        type: MODEL_USAGE_MESSAGE_TYPE,
        async handle(message) {
            try {
                if (message.action === 'query') {
                    return {success: true, data: await repository.getDashboard(parseModelUsageFilter(message.filter))};
                }
                if (message.action === 'reset') {
                    await repository.clear();
                    return {success: true, data: {cleared: true}};
                }
                return {success: false, error: '不支持的模型用量操作'};
            } catch (error) {
                return {success: false, error: errorMessage(error)};
            }
        },
    };
}
