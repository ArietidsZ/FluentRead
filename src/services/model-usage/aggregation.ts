/**
 * @file src/services/model-usage/aggregation.ts
 * 文件职责：把本地大模型调用事件按本地日界线聚合成设置页可直接消费的统计快照。
 * 主要内容：规范化筛选条件，计算今日、七日和三十日汇总，生成逐小时或逐日时间线，并按服务与模型分组。
 * 模块边界：本文件只执行确定性的内存计算，不访问 IndexedDB、浏览器 runtime、供应商响应或 Vue 组件。
 */

import type {
    DashboardSnapshot,
    Filter,
    ModelUsageBreakdownItem,
    ModelUsageDimension,
    ModelUsageEvent,
    ModelUsageTimelinePoint,
    Range,
    StoredModelUsageEvent,
    Totals,
} from './types';

type AggregatableEvent = ModelUsageEvent | StoredModelUsageEvent;

export interface DashboardAggregationOptions {
    now?: number;
    recordingStartedAt?: number | null;
    dimensions?: readonly ModelUsageDimension[];
}

const VALID_RANGES = new Set<Range>(['today', '7d', '30d']);
const HOUR_MS = 60 * 60 * 1000;

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function localDateKey(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function epochHourStart(timestamp: number): number {
    const dayStart = localDayStart(timestamp);
    return dayStart + Math.floor((timestamp - dayStart) / HOUR_MS) * HOUR_MS;
}

function epochHourKey(timestamp: number): string {
    return `hour:${epochHourStart(timestamp)}`;
}

function localDayStart(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

function shiftLocalDays(timestamp: number, delta: number): number {
    const date = new Date(timestamp);
    date.setDate(date.getDate() + delta);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

function safeTokenCount(value: unknown): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function eventModel(event: AggregatableEvent): string {
    const storedModel = 'model' in event && typeof event.model === 'string' ? event.model.trim() : '';
    return storedModel || event.actualModel?.trim() || event.configuredModel.trim() || 'unknown';
}

function matchesDimensions(event: AggregatableEvent, filter: Pick<Filter, 'serviceId' | 'model'>): boolean {
    if (filter.serviceId && event.serviceId !== filter.serviceId) return false;
    if (filter.model && eventModel(event) !== filter.model) return false;
    return true;
}

function eventsWithin(
    events: readonly AggregatableEvent[],
    start: number,
    end: number,
): AggregatableEvent[] {
    return events.filter((event) => event.startedAt >= start && event.startedAt <= end);
}

export function normalizeModelUsageFilter(value?: Partial<Filter>): Filter {
    const range = value?.range && VALID_RANGES.has(value.range) ? value.range : '30d';
    const serviceId = typeof value?.serviceId === 'string' && value.serviceId.trim()
        ? value.serviceId.trim()
        : undefined;
    const model = typeof value?.model === 'string' && value.model.trim()
        ? value.model.trim()
        : undefined;
    return {
        range,
        ...(serviceId ? {serviceId} : {}),
        ...(model ? {model} : {}),
    };
}

export function getModelUsageRangeStart(range: Range, now: number): number {
    const today = localDayStart(now);
    if (range === 'today') return today;
    return shiftLocalDays(today, range === '7d' ? -6 : -29);
}

export function emptyModelUsageTotals(): Totals {
    return {
        requestCount: 0,
        successfulRequests: 0,
        failedRequests: 0,
        reportedTokenRequests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        averageTokensPerReportedRequest: null,
    };
}

export function aggregateModelUsageTotals(events: readonly AggregatableEvent[]): Totals {
    const totals = emptyModelUsageTotals();
    for (const event of events) {
        totals.requestCount += 1;
        if (event.outcome === 'success') totals.successfulRequests += 1;
        else totals.failedRequests += 1;

        if (event.usageAvailability === 'reported') totals.reportedTokenRequests += 1;
        totals.inputTokens += safeTokenCount(event.inputTokens);
        totals.outputTokens += safeTokenCount(event.outputTokens);
        totals.totalTokens += safeTokenCount(event.totalTokens);
        totals.cachedInputTokens += safeTokenCount(event.cachedInputTokens);
        totals.reasoningTokens += safeTokenCount(event.reasoningTokens);
    }
    totals.averageTokensPerReportedRequest = totals.reportedTokenRequests > 0
        ? totals.totalTokens / totals.reportedTokenRequests
        : null;
    return totals;
}

export function collectModelUsageDimensions(events: readonly AggregatableEvent[]): ModelUsageDimension[] {
    const modelsByService = new Map<string, Set<string>>();
    for (const event of events) {
        const serviceId = event.serviceId.trim();
        if (!serviceId) continue;
        const models = modelsByService.get(serviceId) ?? new Set<string>();
        models.add(eventModel(event));
        modelsByService.set(serviceId, models);
    }
    return [...modelsByService]
        .map(([serviceId, models]) => ({serviceId, models: [...models].sort((a, b) => a.localeCompare(b))}))
        .sort((a, b) => a.serviceId.localeCompare(b.serviceId));
}

function buildTimeline(
    events: readonly AggregatableEvent[],
    range: Range,
    now: number,
): ModelUsageTimelinePoint[] {
    const byBucket = new Map<string, AggregatableEvent[]>();
    for (const event of events) {
        const date = new Date(event.startedAt);
        const key = range === 'today' ? epochHourKey(event.startedAt) : localDateKey(date);
        const bucket = byBucket.get(key) ?? [];
        bucket.push(event);
        byBucket.set(key, bucket);
    }

    if (range === 'today') {
        const todayStart = localDayStart(now);
        const tomorrowStart = shiftLocalDays(todayStart, 1);
        const points: ModelUsageTimelinePoint[] = [];
        // 按真实经过的 epoch 小时推进；夏令时切换日会自然得到 23 或 25 个唯一桶。
        for (let bucketStart = todayStart; bucketStart < tomorrowStart; bucketStart += HOUR_MS) {
            const date = new Date(bucketStart);
            const key = epochHourKey(bucketStart);
            points.push({
                key,
                label: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
                startedAt: bucketStart,
                totals: aggregateModelUsageTotals(byBucket.get(key) ?? []),
            });
        }
        return points;
    }

    const days = range === '7d' ? 7 : 30;
    const start = getModelUsageRangeStart(range, now);
    return Array.from({length: days}, (_, index) => {
        const bucketStart = shiftLocalDays(start, index);
        const date = new Date(bucketStart);
        const key = localDateKey(date);
        return {
            key,
            label: `${date.getMonth() + 1}/${date.getDate()}`,
            startedAt: bucketStart,
            totals: aggregateModelUsageTotals(byBucket.get(key) ?? []),
        };
    });
}

function buildBreakdown(events: readonly AggregatableEvent[]): ModelUsageBreakdownItem[] {
    const groups = new Map<string, {serviceId: string; model: string; events: AggregatableEvent[]}>();
    for (const event of events) {
        const model = eventModel(event);
        const key = `${event.serviceId}\u0000${model}`;
        const group = groups.get(key) ?? {serviceId: event.serviceId, model, events: []};
        group.events.push(event);
        groups.set(key, group);
    }
    return [...groups.values()]
        .map((group) => ({
            serviceId: group.serviceId,
            model: group.model,
            totals: aggregateModelUsageTotals(group.events),
        }))
        .sort((left, right) => (
            right.totals.requestCount - left.totals.requestCount
            || left.serviceId.localeCompare(right.serviceId)
            || left.model.localeCompare(right.model)
        ));
}

export function buildModelUsageDashboard(
    events: readonly AggregatableEvent[],
    requestedFilter: Partial<Filter> = {},
    options: DashboardAggregationOptions = {},
): DashboardSnapshot {
    const generatedAt = options.now ?? Date.now();
    const filter = normalizeModelUsageFilter(requestedFilter);
    const dimensionEvents = events.filter((event) => matchesDimensions(event, filter));
    const selectedStart = getModelUsageRangeStart(filter.range, generatedAt);
    const selectedEvents = eventsWithin(dimensionEvents, selectedStart, generatedAt);
    const derivedRecordingStartedAt = events.length > 0
        ? Math.min(...events.map((event) => event.startedAt))
        : null;

    return {
        generatedAt,
        recordingStartedAt: options.recordingStartedAt === undefined
            ? derivedRecordingStartedAt
            : options.recordingStartedAt,
        dimensions: (options.dimensions ?? collectModelUsageDimensions(events)).map((dimension) => ({
            serviceId: dimension.serviceId,
            models: [...dimension.models],
        })),
        metrics: {
            today: aggregateModelUsageTotals(eventsWithin(
                dimensionEvents,
                getModelUsageRangeStart('today', generatedAt),
                generatedAt,
            )),
            sevenDays: aggregateModelUsageTotals(eventsWithin(
                dimensionEvents,
                getModelUsageRangeStart('7d', generatedAt),
                generatedAt,
            )),
            thirtyDays: aggregateModelUsageTotals(eventsWithin(
                dimensionEvents,
                getModelUsageRangeStart('30d', generatedAt),
                generatedAt,
            )),
        },
        selected: {
            filter,
            totals: aggregateModelUsageTotals(selectedEvents),
        },
        timeline: buildTimeline(selectedEvents, filter.range, generatedAt),
        breakdown: buildBreakdown(selectedEvents),
    };
}
