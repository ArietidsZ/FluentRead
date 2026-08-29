import 'fake-indexeddb/auto';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    FluentReadModelUsageDatabase,
    ModelUsageRepository,
    normalizeStoredModelUsageEvent,
} from '@/src/platform/storage/modelUsageRepository';
import type {ModelUsageEvent} from '@/src/services/model-usage/types';

let databaseSequence = 0;
const databases: FluentReadModelUsageDatabase[] = [];

function createRepository(label = 'default') {
    databaseSequence += 1;
    const database = new FluentReadModelUsageDatabase(`FluentReadModelUsage-test-${label}-${databaseSequence}`);
    databases.push(database);
    return new ModelUsageRepository(database);
}

function usageEvent(overrides: Partial<ModelUsageEvent> = {}): ModelUsageEvent {
    return {
        id: `event-${databaseSequence}-${Math.random().toString(36).slice(2)}`,
        startedAt: new Date(2026, 7, 29, 10).getTime(),
        durationMs: 250,
        serviceId: 'moonshot',
        configuredModel: 'kimi-k2.6',
        purpose: 'translation',
        outcome: 'success',
        usageAvailability: 'reported',
        inputTokens: 80,
        outputTokens: 20,
        totalTokens: 100,
        ...overrides,
    };
}

afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await Promise.all(databases.splice(0).map(async (database) => {
        database.close();
        await database.delete();
    }));
});

describe('大模型用量 IndexedDB repository', () => {
    it('批量写入只保留白名单字段，并以事件 id 幂等去重', async () => {
        const repository = createRepository('allowlist');
        const first = {
            ...usageEvent({id: 'request-a', actualModel: 'kimi-k3', cachedInputTokens: 12}),
            prompt: '不得持久化的网页正文',
            url: 'https://private.example/path?token=secret',
            apiKey: 'sk-sensitive-sentinel',
        } as ModelUsageEvent;
        const second = usageEvent({id: 'request-b', usageAvailability: 'unreported', totalTokens: undefined});

        await expect(repository.recordMany([first, second])).resolves.toBe(2);
        await expect(repository.recordMany([first, second])).resolves.toBe(0);

        const stored = await repository.database.events.orderBy('id').toArray();
        expect(stored).toHaveLength(2);
        expect(stored[0]).toMatchObject({
            id: 'request-a',
            schemaVersion: 1,
            serviceId: 'moonshot',
            configuredModel: 'kimi-k2.6',
            actualModel: 'kimi-k3',
            model: 'kimi-k3',
            totalTokens: 100,
        });
        expect(JSON.stringify(stored)).not.toContain('网页正文');
        expect(JSON.stringify(stored)).not.toContain('private.example');
        expect(JSON.stringify(stored)).not.toContain('sk-sensitive-sentinel');
        await expect(repository.recordMany([])).resolves.toBe(0);
    });

    it('同批验证失败不留下半批事件，重复 id 的不同内容也不会覆盖旧记录', async () => {
        const repository = createRepository('atomic');
        const valid = usageEvent({id: 'stable-event'});
        await expect(repository.recordMany([
            valid,
            {...usageEvent({id: 'invalid-event'}), inputTokens: -1},
        ])).rejects.toThrow('inputTokens');
        await expect(repository.database.events.count()).resolves.toBe(0);

        await repository.recordMany([valid]);
        await expect(repository.recordMany([{...valid, totalTokens: 999}]))
            .rejects.toThrow('id 冲突');
        await expect(repository.database.events.get('stable-event')).resolves.toMatchObject({totalTokens: 100});

        const duplicate = usageEvent({id: 'same-batch'});
        await expect(repository.recordMany([duplicate, duplicate])).resolves.toBe(1);
        await expect(repository.recordMany([duplicate, {...duplicate, totalTokens: 101}]))
            .rejects.toThrow('id 冲突');
    });

    it('自动生成事件 id，并在 randomUUID 不可用时使用本地回退标识', async () => {
        const repository = createRepository('generated-id');
        await repository.recordMany([usageEvent({id: undefined})]);
        const uuidRecord = await repository.database.events.toCollection().first();
        expect(uuidRecord?.id).toMatch(/^[0-9a-f-]{36}$/iu);

        vi.stubGlobal('crypto', {});
        await repository.recordMany([usageEvent({id: undefined, configuredModel: ''})]);
        const records = await repository.database.events.toArray();
        expect(records.some((record) => record.id.startsWith('usage-'))).toBe(true);
        expect(records.some((record) => record.configuredModel === 'unknown' && record.model === 'unknown')).toBe(true);
    });

    it('查询仅扫描最近三十日本地窗口，但保留全历史起点与服务模型维度', async () => {
        const repository = createRepository('dashboard');
        const now = new Date(2026, 7, 29, 16).getTime();
        const old = new Date(2026, 3, 1, 12).getTime();
        await repository.recordMany([
            usageEvent({
                id: 'historical',
                startedAt: old,
                serviceId: 'openai',
                configuredModel: 'gpt-5-mini',
                totalTokens: 500,
            }),
            usageEvent({
                id: 'today-kimi',
                startedAt: new Date(2026, 7, 29, 10).getTime(),
                serviceId: 'moonshot',
                configuredModel: 'kimi-k2.6',
                totalTokens: 100,
            }),
            usageEvent({
                id: 'yesterday-kimi',
                startedAt: new Date(2026, 7, 28, 10).getTime(),
                serviceId: 'moonshot',
                configuredModel: 'kimi-k2.6',
                outcome: 'timeout',
                usageAvailability: 'unreported',
                inputTokens: undefined,
                outputTokens: undefined,
                totalTokens: undefined,
            }),
        ]);

        const snapshot = await repository.getDashboard({range: '7d', serviceId: 'moonshot'}, now);
        expect(snapshot.recordingStartedAt).toBe(old);
        expect(snapshot.dimensions).toEqual([
            {serviceId: 'moonshot', models: ['kimi-k2.6']},
            {serviceId: 'openai', models: ['gpt-5-mini']},
        ]);
        expect(snapshot.metrics.today.totalTokens).toBe(100);
        expect(snapshot.selected.totals).toMatchObject({
            requestCount: 2,
            successfulRequests: 1,
            failedRequests: 1,
        });
        expect(snapshot.selected.totals.totalTokens).toBe(100);
    });

    it('clear 只清当前模型用量库，不影响另一个仓库', async () => {
        const target = createRepository('target');
        const untouched = createRepository('untouched');
        const inFlightGeneration = target.captureGeneration();
        await target.recordMany([usageEvent({id: 'target-event'})]);
        await untouched.recordMany([usageEvent({id: 'untouched-event'})]);

        await target.clear();

        await expect(target.database.events.count()).resolves.toBe(0);
        await expect(untouched.database.events.count()).resolves.toBe(1);
        await expect(target.recordMany([
            usageEvent({id: 'finished-after-reset'}),
        ], inFlightGeneration)).resolves.toBe(0);
        await expect(target.database.events.count()).resolves.toBe(0);

        const currentGeneration = target.captureGeneration();
        expect(currentGeneration).not.toBe(inFlightGeneration);
        await expect(target.recordMany([
            usageEvent({id: 'started-after-reset'}),
        ], currentGeneration)).resolves.toBe(1);
        await expect(target.database.events.count()).resolves.toBe(1);

        const racing = createRepository('reset-race');
        const racingGeneration = racing.captureGeneration();
        const originalBulkGet = racing.database.events.bulkGet.bind(racing.database.events);
        let clearPromise: Promise<void> | undefined;
        vi.spyOn(racing.database.events, 'bulkGet').mockImplementationOnce((keys) => {
            clearPromise = racing.clear();
            return originalBulkGet(keys);
        });
        await expect(racing.recordMany([
            usageEvent({id: 'raced-finish'}),
        ], racingGeneration)).resolves.toBe(0);
        await clearPromise;
        await expect(racing.database.events.count()).resolves.toBe(0);
    });

    it('严格拒绝非法枚举、时间、状态码和非整数 Token', async () => {
        const repository = createRepository('validation');
        expect(() => normalizeStoredModelUsageEvent(null as never)).toThrow('必须是对象');
        expect(() => normalizeStoredModelUsageEvent([] as never)).toThrow('必须是对象');
        expect(() => normalizeStoredModelUsageEvent({...usageEvent(), schemaVersion: 2 as never}))
            .toThrow('版本');
        await expect(repository.recordMany([{...usageEvent(), purpose: 'billing' as never}]))
            .rejects.toThrow('purpose');
        await expect(repository.recordMany([{...usageEvent(), outcome: 'pending' as never}]))
            .rejects.toThrow('outcome');
        await expect(repository.recordMany([{...usageEvent(), usageAvailability: 'partial' as never}]))
            .rejects.toThrow('usageAvailability');
        await expect(repository.recordMany([{...usageEvent(), durationMs: Number.NaN}]))
            .rejects.toThrow('durationMs');
        await expect(repository.recordMany([{...usageEvent(), startedAt: MAX_DATE_PLUS_ONE}]))
            .rejects.toThrow('startedAt');
        await expect(repository.recordMany([{...usageEvent(), statusCode: 999}]))
            .rejects.toThrow('statusCode');
        await expect(repository.recordMany([{...usageEvent(), totalTokens: 1.5}]))
            .rejects.toThrow('totalTokens');
        await expect(repository.recordMany([{...usageEvent(), serviceId: 42 as never}]))
            .rejects.toThrow('serviceId');
        await expect(repository.recordMany([{...usageEvent(), serviceId: '\u0000  '}]))
            .rejects.toThrow('不能为空');
        await expect(repository.recordMany([{...usageEvent(), id: 42 as never}]))
            .rejects.toThrow('id 必须是字符串');
        await expect(repository.recordMany([{...usageEvent(), id: 'invalid id'}]))
            .rejects.toThrow('id 格式');
        await expect(repository.database.events.count()).resolves.toBe(0);
    });

    it('保存全部可选数值字段并处理空库、损坏维度键', async () => {
        const empty = createRepository('empty-dashboard');
        const emptySnapshot = await empty.getDashboard({range: '30d'}, new Date(2026, 7, 29).getTime());
        expect(emptySnapshot.recordingStartedAt).toBeNull();
        expect(emptySnapshot.dimensions).toEqual([]);

        const repository = createRepository('optional-fields');
        await repository.recordMany([usageEvent({
            id: 'all-optionals',
            cachedInputTokens: 0,
            reasoningTokens: 0,
            statusCode: 429,
        })]);
        await expect(repository.database.events.get('all-optionals')).resolves.toMatchObject({
            cachedInputTokens: 0,
            reasoningTokens: 0,
            statusCode: 429,
        });

        const originalOrderBy = repository.database.events.orderBy.bind(repository.database.events);
        vi.spyOn(repository.database.events, 'orderBy').mockImplementation((index: string | string[]) => {
            if (index === '[serviceId+model]') {
                return {uniqueKeys: async () => ['invalid', [42, 'model'], ['service'], ['moonshot', 'kimi-k2.6']]} as never;
            }
            return originalOrderBy(index);
        });
        const snapshot = await repository.getDashboard({range: 'today'}, new Date(2026, 7, 29, 12).getTime());
        expect(snapshot.dimensions).toEqual([{serviceId: 'moonshot', models: ['kimi-k2.6']}]);
    });
});

const MAX_DATE_PLUS_ONE = 8_640_000_000_000_001;
