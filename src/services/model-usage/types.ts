/**
 * @file src/services/model-usage/types.ts
 * 文件职责：定义大模型上游调用事件、筛选条件与设置页统计快照的共享数据合同。
 * 主要内容：声明时间范围、用途、结果、Token 可用性、汇总指标、时间线、服务模型维度和查询快照类型。
 * 模块边界：本文件只描述本地统计数据形状，不读取浏览器存储、不解析供应商响应，也不包含设置页展示逻辑。
 */

export const MODEL_USAGE_SCHEMA_VERSION = 1 as const;

export type Range = 'today' | '7d' | '30d';
export type ModelUsagePurpose = 'translation' | 'page-summary' | 'connection-test';
export type ModelUsageOutcome = 'success' | 'error' | 'timeout' | 'cancelled';
export type ModelUsageAvailability = 'reported' | 'unreported' | 'malformed';

/** 一条事件只代表一次真实上游尝试；仓库会为缺少 id 的内部事件生成唯一标识。 */
export interface ModelUsageEvent {
    id?: string;
    schemaVersion?: typeof MODEL_USAGE_SCHEMA_VERSION;
    startedAt: number;
    durationMs: number;
    serviceId: string;
    configuredModel: string;
    actualModel?: string;
    purpose: ModelUsagePurpose;
    outcome: ModelUsageOutcome;
    usageAvailability: ModelUsageAvailability;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
    reasoningTokens?: number;
    statusCode?: number;
}

/** IndexedDB 中的事件只包含白名单字段，并补齐稳定主键与实际聚合模型。 */
export interface StoredModelUsageEvent extends Omit<ModelUsageEvent, 'id' | 'schemaVersion'> {
    id: string;
    schemaVersion: typeof MODEL_USAGE_SCHEMA_VERSION;
    model: string;
}

export interface Filter {
    range: Range;
    serviceId?: string;
    model?: string;
}

export interface Totals {
    requestCount: number;
    successfulRequests: number;
    failedRequests: number;
    reportedTokenRequests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
    averageTokensPerReportedRequest: number | null;
    averageInputTokensPerReportedRequest: number | null;
    averageOutputTokensPerReportedRequest: number | null;
}

export interface ModelUsageDimension {
    serviceId: string;
    models: string[];
}

export interface ModelUsageMetrics {
    today: Totals;
    sevenDays: Totals;
    thirtyDays: Totals;
}

export interface ModelUsageTimelinePoint {
    key: string;
    label: string;
    startedAt: number;
    totals: Totals;
}

export interface ModelUsageBreakdownItem {
    serviceId: string;
    model: string;
    totals: Totals;
}

export interface DashboardSnapshot {
    generatedAt: number;
    recordingStartedAt: number | null;
    dimensions: ModelUsageDimension[];
    metrics: ModelUsageMetrics;
    selected: {
        filter: Filter;
        totals: Totals;
    };
    timeline: ModelUsageTimelinePoint[];
    breakdown: ModelUsageBreakdownItem[];
}

// 保留带领域前缀的别名，方便 recorder 和未来非 UI 调用方获得自说明类型。
export type ModelUsageRange = Range;
export type ModelUsageFilter = Filter;
export type ModelUsageTotals = Totals;
export type ModelUsageDashboardSnapshot = DashboardSnapshot;
