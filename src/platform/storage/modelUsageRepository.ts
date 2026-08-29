/**
 * @file src/platform/storage/modelUsageRepository.ts
 * 文件职责：在扩展后台专属 IndexedDB 中永久保存脱敏的大模型上游调用事件，并提供统计查询与独立重置能力。
 * 主要内容：定义 FluentReadModelUsage Dexie 数据库、严格事件白名单与幂等批量写入，以及最近三十日快照和全历史服务模型维度查询。
 * 模块边界：本文件只拥有模型用量的本地持久化适配，不采集网页文本、不读取 API Key，也不注册 runtime 消息或渲染设置页面。
 */

import Dexie, {type Table} from 'dexie';
import {
    buildModelUsageDashboard,
    getModelUsageRangeStart,
    normalizeModelUsageFilter,
} from '@/src/services/model-usage/aggregation';
import {
    MODEL_USAGE_SCHEMA_VERSION,
    type DashboardSnapshot,
    type Filter,
    type ModelUsageAvailability,
    type ModelUsageEvent,
    type ModelUsageOutcome,
    type ModelUsagePurpose,
    type StoredModelUsageEvent,
} from '@/src/services/model-usage/types';

export const MODEL_USAGE_DATABASE_NAME = 'FluentReadModelUsage' as const;
export const MODEL_USAGE_DATABASE_VERSION = 1 as const;

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_EVENT_ID_LENGTH = 200;
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const PURPOSES = new Set<ModelUsagePurpose>(['translation', 'page-summary', 'connection-test']);
const OUTCOMES = new Set<ModelUsageOutcome>(['success', 'error', 'timeout', 'cancelled']);
const AVAILABILITIES = new Set<ModelUsageAvailability>(['reported', 'unreported', 'malformed']);
let generatedEventSequence = 0;

export class FluentReadModelUsageDatabase extends Dexie {
    events!: Table<StoredModelUsageEvent, string>;

    constructor(name: string = MODEL_USAGE_DATABASE_NAME) {
        super(name);
        this.version(MODEL_USAGE_DATABASE_VERSION).stores({
            events: '&id, startedAt, serviceId, model, [serviceId+model], purpose, outcome, usageAvailability',
        });
    }
}

function requiredIdentifier(value: unknown, field: string): string {
    if (typeof value !== 'string') throw new TypeError(`模型用量事件 ${field} 必须是字符串`);
    const normalized = value
        .normalize('NFC')
        .replace(/[\u0000-\u001F\u007F]/gu, '')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, MAX_IDENTIFIER_LENGTH);
    if (!normalized) throw new TypeError(`模型用量事件 ${field} 不能为空`);
    return normalized;
}

function optionalIdentifier(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    return requiredIdentifier(value, field);
}

function finiteNonNegative(value: unknown, field: string, maximum = Number.MAX_SAFE_INTEGER): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
        throw new TypeError(`模型用量事件 ${field} 必须是非负有限数字`);
    }
    return value;
}

function optionalTokenCount(value: unknown, field: string): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new TypeError(`模型用量事件 ${field} 必须是非负安全整数`);
    }
    return value;
}

function optionalStatusCode(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 100 || value > 599) {
        throw new TypeError('模型用量事件 statusCode 必须是有效 HTTP 状态码');
    }
    return value;
}

function createEventId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    generatedEventSequence = (generatedEventSequence + 1) % Number.MAX_SAFE_INTEGER;
    return `usage-${Date.now().toString(36)}-${generatedEventSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeEventId(value: unknown): string {
    if (value === undefined) return createEventId();
    if (typeof value !== 'string') throw new TypeError('模型用量事件 id 必须是字符串');
    const id = value.trim();
    if (!id || id.length > MAX_EVENT_ID_LENGTH || !/^[A-Za-z0-9._:-]+$/u.test(id)) {
        throw new TypeError('模型用量事件 id 格式无效');
    }
    return id;
}

/** 只重建允许持久化的数值与标识字段，调用方附带的文本、URL 或凭据不会进入数据库。 */
export function normalizeStoredModelUsageEvent(event: ModelUsageEvent): StoredModelUsageEvent {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw new TypeError('模型用量事件必须是对象');
    }
    if (event.schemaVersion !== undefined && event.schemaVersion !== MODEL_USAGE_SCHEMA_VERSION) {
        throw new TypeError('模型用量事件版本不受支持');
    }
    if (!PURPOSES.has(event.purpose)) throw new TypeError('模型用量事件 purpose 无效');
    if (!OUTCOMES.has(event.outcome)) throw new TypeError('模型用量事件 outcome 无效');
    if (!AVAILABILITIES.has(event.usageAvailability)) {
        throw new TypeError('模型用量事件 usageAvailability 无效');
    }

    const configuredModel = requiredIdentifier(event.configuredModel || 'unknown', 'configuredModel');
    const actualModel = optionalIdentifier(event.actualModel, 'actualModel');
    return {
        id: normalizeEventId(event.id),
        schemaVersion: MODEL_USAGE_SCHEMA_VERSION,
        startedAt: finiteNonNegative(event.startedAt, 'startedAt', MAX_TIMESTAMP),
        durationMs: finiteNonNegative(event.durationMs, 'durationMs'),
        serviceId: requiredIdentifier(event.serviceId, 'serviceId'),
        configuredModel,
        ...(actualModel ? {actualModel} : {}),
        model: actualModel || configuredModel,
        purpose: event.purpose,
        outcome: event.outcome,
        usageAvailability: event.usageAvailability,
        ...optionalNumericFields(event),
    };
}

function optionalNumericFields(event: ModelUsageEvent): Pick<
StoredModelUsageEvent,
'inputTokens' | 'outputTokens' | 'totalTokens' | 'cachedInputTokens' | 'reasoningTokens' | 'statusCode'
> {
    const inputTokens = optionalTokenCount(event.inputTokens, 'inputTokens');
    const outputTokens = optionalTokenCount(event.outputTokens, 'outputTokens');
    const totalTokens = optionalTokenCount(event.totalTokens, 'totalTokens');
    const cachedInputTokens = optionalTokenCount(event.cachedInputTokens, 'cachedInputTokens');
    const reasoningTokens = optionalTokenCount(event.reasoningTokens, 'reasoningTokens');
    const statusCode = optionalStatusCode(event.statusCode);
    return {
        ...(inputTokens !== undefined ? {inputTokens} : {}),
        ...(outputTokens !== undefined ? {outputTokens} : {}),
        ...(totalTokens !== undefined ? {totalTokens} : {}),
        ...(cachedInputTokens !== undefined ? {cachedInputTokens} : {}),
        ...(reasoningTokens !== undefined ? {reasoningTokens} : {}),
        ...(statusCode !== undefined ? {statusCode} : {}),
    };
}

function sameEvent(left: StoredModelUsageEvent, right: StoredModelUsageEvent): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

export class ModelUsageRepository {
    private usageGeneration = 0;

    constructor(readonly database: FluentReadModelUsageDatabase = new FluentReadModelUsageDatabase()) {}

    /** Provider 在发起真实请求前同步捕获；reset 会立即推进代次，使旧请求后续写入失效。 */
    captureGeneration(): number {
        return this.usageGeneration;
    }

    /** 整批先完成白名单重建，再在一个事务中补写缺失事件；相同 id 的重试保持幂等。 */
    async recordMany(
        events: readonly ModelUsageEvent[],
        expectedGeneration = this.usageGeneration,
    ): Promise<number> {
        if (events.length === 0) return 0;
        const normalized = events.map(normalizeStoredModelUsageEvent);
        if (expectedGeneration !== this.usageGeneration) return 0;
        const unique = new Map<string, StoredModelUsageEvent>();
        for (const event of normalized) {
            const previous = unique.get(event.id);
            if (previous && !sameEvent(previous, event)) {
                throw new Error(`模型用量事件 id 冲突: ${event.id}`);
            }
            unique.set(event.id, event);
        }

        return this.database.transaction('rw', this.database.events, async () => {
            const candidates = [...unique.values()];
            const existing = await this.database.events.bulkGet(candidates.map((event) => event.id));
            // clear 可在 bulkGet 等待期间同步推进 generation；此时不得再补写旧请求。
            if (expectedGeneration !== this.usageGeneration) return 0;
            const pending: StoredModelUsageEvent[] = [];
            candidates.forEach((event, index) => {
                const stored = existing[index];
                if (!stored) {
                    pending.push(event);
                    return;
                }
                if (!sameEvent(stored, event)) throw new Error(`模型用量事件 id 冲突: ${event.id}`);
            });
            if (pending.length > 0) await this.database.events.bulkAdd(pending);
            return pending.length;
        });
    }

    async getDashboard(filter: Filter = {range: '30d'}, now = Date.now()): Promise<DashboardSnapshot> {
        const normalizedFilter = normalizeModelUsageFilter(filter);
        const recentStart = getModelUsageRangeStart('30d', now);
        const [events, first, dimensionKeys] = await this.database.transaction(
            'r',
            this.database.events,
            async () => Promise.all([
                this.database.events.where('startedAt').between(recentStart, now, true, true).toArray(),
                this.database.events.orderBy('startedAt').first(),
                this.database.events.orderBy('[serviceId+model]').uniqueKeys(),
            ]),
        );
        const modelsByService = new Map<string, Set<string>>();
        for (const key of dimensionKeys) {
            if (!Array.isArray(key) || typeof key[0] !== 'string' || typeof key[1] !== 'string') continue;
            const models = modelsByService.get(key[0]) ?? new Set<string>();
            models.add(key[1]);
            modelsByService.set(key[0], models);
        }
        const dimensions = [...modelsByService]
            .map(([serviceId, models]) => ({serviceId, models: [...models].sort((a, b) => a.localeCompare(b))}))
            .sort((a, b) => a.serviceId.localeCompare(b.serviceId));

        return buildModelUsageDashboard(events, normalizedFilter, {
            now,
            recordingStartedAt: first?.startedAt ?? null,
            dimensions,
        });
    }

    /** 重置只清空模型用量事件表，不删除翻译缓存、配置、词书或其他 IndexedDB。 */
    async clear(): Promise<void> {
        // 必须在第一个 await 前推进代次，确保清除进行中完成的旧 provider 立即失效。
        this.usageGeneration += 1;
        await this.database.events.clear();
    }
}

export const modelUsageDb = new FluentReadModelUsageDatabase();
export const modelUsageRepository = new ModelUsageRepository(modelUsageDb);
