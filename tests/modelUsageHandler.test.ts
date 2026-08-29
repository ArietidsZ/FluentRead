import {describe, expect, it, vi} from 'vitest';
import {
    MODEL_USAGE_MESSAGE_TYPE,
    createModelUsageHandler,
    parseModelUsageFilter,
    type ModelUsageRepositoryContract,
} from '@/src/app/background/handlers/modelUsage';
import {emptyModelUsageTotals} from '@/src/services/model-usage/aggregation';
import type {DashboardSnapshot, Filter} from '@/src/services/model-usage/types';

function snapshot(filter: Filter): DashboardSnapshot {
    const totals = emptyModelUsageTotals();
    return {
        generatedAt: 1_000,
        recordingStartedAt: null,
        dimensions: [],
        metrics: {today: totals, sevenDays: totals, thirtyDays: totals},
        selected: {filter, totals},
        timeline: [],
        breakdown: [],
    };
}

function createRepository(): ModelUsageRepositoryContract & {
    getDashboard: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
} {
    return {
        getDashboard: vi.fn(async (filter: Filter) => snapshot(filter)),
        clear: vi.fn(async () => undefined),
    };
}

describe('模型用量后台 handler', () => {
    it('query 默认查询三十日，并返回类型化 dashboard 数据', async () => {
        const repository = createRepository();
        const handler = createModelUsageHandler(repository);

        const response = await handler.handle({
            type: MODEL_USAGE_MESSAGE_TYPE,
            action: 'query',
        }, undefined);

        expect(handler.type).toBe('modelUsage');
        expect(repository.getDashboard).toHaveBeenCalledWith({range: '30d'});
        expect(response).toEqual({success: true, data: snapshot({range: '30d'})});
    });

    it('query 收窄并清理服务、模型筛选文本', async () => {
        const repository = createRepository();
        const handler = createModelUsageHandler(repository);

        const response = await handler.handle({
            type: MODEL_USAGE_MESSAGE_TYPE,
            action: 'query',
            filter: {range: '7d', serviceId: ' moonshot ', model: ' kimi-k3 '},
        }, undefined);

        const filter = {range: '7d', serviceId: 'moonshot', model: 'kimi-k3'} as const;
        expect(repository.getDashboard).toHaveBeenCalledWith(filter);
        expect(response).toEqual({success: true, data: snapshot(filter)});

        await handler.handle({
            type: MODEL_USAGE_MESSAGE_TYPE,
            action: 'query',
            filter: {range: 'today', model: 'kimi-k3'},
        }, undefined);
        expect(repository.getDashboard).toHaveBeenLastCalledWith({range: 'today', model: 'kimi-k3'});
    });

    it('reset 只委托仓库 clear 并返回明确确认', async () => {
        const repository = createRepository();
        const response = await createModelUsageHandler(repository).handle({
            type: MODEL_USAGE_MESSAGE_TYPE,
            action: 'reset',
        }, undefined);

        expect(repository.clear).toHaveBeenCalledOnce();
        expect(repository.getDashboard).not.toHaveBeenCalled();
        expect(response).toEqual({success: true, data: {cleared: true}});
    });

    it('拒绝未知动作、非法 range、空筛选值与非普通对象', async () => {
        const repository = createRepository();
        const handler = createModelUsageHandler(repository);

        await expect(handler.handle({type: MODEL_USAGE_MESSAGE_TYPE, action: 'export'}, undefined))
            .resolves.toEqual({success: false, error: '不支持的模型用量操作'});
        await expect(handler.handle({
            type: MODEL_USAGE_MESSAGE_TYPE,
            action: 'query',
            filter: {range: '365d'},
        }, undefined)).resolves.toMatchObject({success: false, error: expect.stringContaining('range')});
        await expect(handler.handle({
            type: MODEL_USAGE_MESSAGE_TYPE,
            action: 'query',
            filter: {range: 'today', serviceId: '   '},
        }, undefined)).resolves.toMatchObject({success: false, error: expect.stringContaining('serviceId')});
        await expect(handler.handle({
            type: MODEL_USAGE_MESSAGE_TYPE,
            action: 'query',
            filter: {range: 'today', serviceId: 42},
        }, undefined)).resolves.toMatchObject({success: false, error: expect.stringContaining('必须是字符串')});
        await expect(handler.handle({
            type: MODEL_USAGE_MESSAGE_TYPE,
            action: 'query',
            filter: [],
        }, undefined)).resolves.toMatchObject({success: false, error: expect.stringContaining('必须是对象')});
        expect(repository.getDashboard).not.toHaveBeenCalled();
    });

    it('把仓库查询与清理失败转换为可传输错误响应', async () => {
        const repository = createRepository();
        repository.getDashboard.mockRejectedValueOnce(new Error('IndexedDB query blocked'));
        repository.clear.mockRejectedValueOnce(new Error('IndexedDB clear blocked'));
        const handler = createModelUsageHandler(repository);

        await expect(handler.handle({type: MODEL_USAGE_MESSAGE_TYPE, action: 'query'}, undefined))
            .resolves.toEqual({success: false, error: 'IndexedDB query blocked'});
        await expect(handler.handle({type: MODEL_USAGE_MESSAGE_TYPE, action: 'reset'}, undefined))
            .resolves.toEqual({success: false, error: 'IndexedDB clear blocked'});

        repository.getDashboard.mockRejectedValueOnce(null);
        await expect(handler.handle({type: MODEL_USAGE_MESSAGE_TYPE, action: 'query'}, undefined))
            .resolves.toEqual({success: false, error: '模型用量统计暂时不可用'});
    });

    it('公开筛选解析器保留 null prototype 对象并拒绝超长文本', () => {
        const filter = Object.assign(Object.create(null), {range: 'today', serviceId: 'moonshot'});
        expect(parseModelUsageFilter(filter)).toEqual({range: 'today', serviceId: 'moonshot'});
        expect(() => parseModelUsageFilter({range: 'today', model: 'x'.repeat(201)})).toThrow('model');
    });
});
