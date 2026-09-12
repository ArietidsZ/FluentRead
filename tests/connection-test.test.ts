import {afterEach, describe, expect, it, vi} from 'vitest';

const {adapter} = vi.hoisted(() => ({
    adapter: vi.fn(),
}));

vi.mock('@/src/providers/translation/registry', () => ({
    translationProviderRegistry: {
        custom: adapter,
        demo: adapter,
    },
}));

import {
    CONNECTION_TEST_ORIGIN,
    CONNECTION_TEST_TIMEOUT_MS,
    formatConnectionTestError,
    runTranslationServiceConnectionTest,
} from '@/src/providers/translation/connectionTest';
import {formatServiceError, getServiceErrorMessage} from '@/src/services/translation/serviceErrors';
import {services} from '@/src/core/config/catalog';
import {
    createTranslationProviderConfigSnapshot,
    getTranslationRequestScheduler,
    reportTranslationModelUsage,
    TRANSLATION_PROVIDER_CONFIG,
} from '@/src/services/translation/requestSnapshot';
import {createTranslationRequestScheduler} from '@/src/services/translation/requestScheduler';
import {normalizeConfig} from '@/src/core/config/model';

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, reject, resolve};
}

describe('翻译服务连接测试', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('调用真实适配器并禁用翻译缓存', async () => {
        adapter.mockResolvedValue('测试译文');

        await expect(runTranslationServiceConnectionTest('demo')).resolves.toEqual(expect.objectContaining({
            durationMs: expect.any(Number),
        }));
        expect(adapter).toHaveBeenCalledWith(expect.objectContaining({
            origin: CONNECTION_TEST_ORIGIN,
            serviceOverride: 'demo',
            useCache: false,
            abortSignal: expect.any(AbortSignal),
        }));
    });

    it('无 config 时不注入不完整的 provider snapshot，保持 adapter 原有 fallback', async () => {
        adapter.mockImplementation(async (message: object) => {
            expect(Object.prototype.hasOwnProperty.call(message, TRANSLATION_PROVIDER_CONFIG)).toBe(false);
            return '测试译文';
        });

        await expect(runTranslationServiceConnectionTest('demo')).resolves.toEqual(expect.objectContaining({
            durationMs: expect.any(Number),
        }));
    });

    it('提供 config 时绑定调用方 snapshot，供 adapter 读取真实配置', async () => {
        const config = createTranslationProviderConfigSnapshot(normalizeConfig({
            service: 'demo',
            model: {demo: 'configured-demo-model'},
        }));
        adapter.mockImplementation(async (message: object) => {
            expect(Object.prototype.hasOwnProperty.call(message, TRANSLATION_PROVIDER_CONFIG)).toBe(true);
            return '测试译文';
        });

        await expect(runTranslationServiceConnectionTest('demo', {config})).resolves.toEqual(expect.objectContaining({
            durationMs: expect.any(Number),
        }));
    });

    it('排队期间不调用 adapter，超时取消后也不会迟到发出真实请求', async () => {
        vi.useFakeTimers();
        const scheduler = createTranslationRequestScheduler(() => ({
            maxConcurrentTranslations: 1,
            translationRequestsPerSecond: 0,
            translationRequestsPerMinute: 0,
        }));
        const blocker = deferred<string>();
        adapter.mockImplementationOnce((message: object) => {
            expect(getTranslationRequestScheduler(message)?.identity?.model).toBe('effective-demo');
            return blocker.promise;
        }).mockResolvedValueOnce('不应发出的译文');

        const first = runTranslationServiceConnectionTest('demo', {requestScheduler: scheduler, effectiveModel: ' effective-demo '});
        const firstOutcome = first.catch(error => error);
        await Promise.resolve();
        expect(adapter).toHaveBeenCalledOnce();

        const second = runTranslationServiceConnectionTest('demo', {requestScheduler: scheduler});
        const secondOutcome = second.catch(error => error);
        await Promise.resolve();
        expect(adapter).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(CONNECTION_TEST_TIMEOUT_MS);
        await expect(secondOutcome).resolves.toMatchObject({message: '翻译请求超时'});
        await expect(firstOutcome).resolves.toMatchObject({message: '翻译请求超时'});
        blocker.resolve('第一个译文');
        await Promise.resolve();
        expect(adapter).toHaveBeenCalledOnce();
    });

    it('动态 custom:* 服务回退到共享 custom adapter，同时保留动态 serviceOverride', async () => {
        adapter.mockResolvedValue('动态服务译文');

        await expect(runTranslationServiceConnectionTest('custom:1')).resolves.toEqual({
            durationMs: expect.any(Number),
        });
        expect(adapter).toHaveBeenCalledWith(expect.objectContaining({
            serviceOverride: 'custom:1',
            origin: CONNECTION_TEST_ORIGIN,
        }));
    });

    it('拒绝空响应，避免把仅 HTTP 成功误报为连接正常', async () => {
        adapter.mockResolvedValue('   ');

        await expect(runTranslationServiceConnectionTest('demo')).rejects.toThrow('没有返回有效译文');
    });

    it('拒绝非字符串响应与未知适配器', async () => {
        adapter.mockResolvedValue(['unexpected batch']);

        await expect(runTranslationServiceConnectionTest('demo')).rejects.toThrow('没有返回有效译文');
        await expect(runTranslationServiceConnectionTest('missing')).rejects.toThrow('未找到翻译服务适配器: missing');
    });

    it('系统时钟回拨时将耗时钳制为零', async () => {
        adapter.mockResolvedValue('测试译文');
        vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(90);

        await expect(runTranslationServiceConnectionTest('demo')).resolves.toEqual({durationMs: 0});
    });

    it('30 秒后中止 legacy adapter signal，统一返回超时且忽略迟到结果', async () => {
        vi.useFakeTimers();
        let signal: AbortSignal | undefined;
        let resolveLate!: (value: string) => void;
        adapter.mockImplementation((message: {abortSignal?: AbortSignal}) => {
            signal = message.abortSignal;
            return new Promise<string>((resolve) => {
                resolveLate = resolve;
            });
        });

        const request = runTranslationServiceConnectionTest('demo');
        const rejection = expect(request).rejects.toThrow('翻译请求超时');
        await vi.advanceTimersByTimeAsync(CONNECTION_TEST_TIMEOUT_MS - 1);
        expect(signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await rejection;
        expect(signal?.aborted).toBe(true);

        resolveLate('迟到译文');
        await Promise.resolve();
        expect(adapter).toHaveBeenCalledOnce();
    });

    it('非超时 adapter 错误保持原始原因', async () => {
        const failure = new Error('provider failed');
        adapter.mockRejectedValue(failure);

        await expect(runTranslationServiceConnectionTest('demo')).rejects.toBe(failure);
    });

    it('把真实连接测试尝试记录为 connection-test，并在返回前等待统计写入', async () => {
        const usageWrite = deferred<void>();
        const recordModelUsage = vi.fn(() => usageWrite.promise);
        adapter.mockImplementation(async (message: Record<string, unknown>) => {
            reportTranslationModelUsage(message, {
                actualModel: 'demo-model',
                startedAt: 10,
                durationMs: -5,
                usageAvailability: 'reported',
                inputTokens: 4,
                outputTokens: 2,
                totalTokens: 6,
            });
            reportTranslationModelUsage(message, {
                startedAt: Number.NaN,
                durationMs: Number.NaN,
                usageAvailability: 'unreported',
            });
            return '测试译文';
        });

        let settled = false;
        const request = runTranslationServiceConnectionTest('demo', {
            configuredModel: '  demo-config  ',
            recordModelUsage,
        });
        void request.finally(() => {
            settled = true;
        });
        await vi.waitFor(() => expect(recordModelUsage).toHaveBeenCalledOnce());
        expect(settled).toBe(false);
        expect(recordModelUsage).toHaveBeenCalledWith([
            expect.objectContaining({
                serviceId: 'demo',
                configuredModel: 'demo-config',
                actualModel: 'demo-model',
                startedAt: 10,
                durationMs: 0,
                purpose: 'connection-test',
                outcome: 'success',
                totalTokens: 6,
            }),
            expect.objectContaining({
                startedAt: expect.any(Number),
                durationMs: 0,
                outcome: 'success',
                usageAvailability: 'unreported',
            }),
        ]);
        usageWrite.resolve();
        await expect(request).resolves.toEqual(expect.objectContaining({durationMs: expect.any(Number)}));
    });

    it('连接测试用量写入超过宽限期后释放成功响应', async () => {
        vi.useFakeTimers();
        const recordModelUsage = vi.fn(() => new Promise<void>(() => undefined));
        const warn = vi.fn();
        adapter.mockImplementation(async (message: Record<string, unknown>) => {
            reportTranslationModelUsage(message, {usageAvailability: 'unreported'});
            return '测试译文';
        });

        const request = runTranslationServiceConnectionTest('demo', {
            recordModelUsage,
            warn,
            persistenceGraceMs: 25,
        });
        for (let index = 0; index < 20; index += 1) await Promise.resolve();
        expect(recordModelUsage).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(24);
        let settled = false;
        void request.finally(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(request).resolves.toEqual(expect.objectContaining({durationMs: expect.any(Number)}));
        expect(warn).toHaveBeenCalledWith(
            '[FluentRead] connection test usage write timed out:',
            expect.any(Error),
        );
    });

    it('连接测试预检失败不造请求，结构化 timeout 会校准 transport cancelled', async () => {
        const recordModelUsage = vi.fn(async () => undefined);
        adapter.mockRejectedValueOnce(new Error('local validation failed'));
        await expect(runTranslationServiceConnectionTest('demo', {recordModelUsage}))
            .rejects.toThrow('local validation failed');
        expect(recordModelUsage).not.toHaveBeenCalled();

        const timeoutError = Object.assign(new Error('provider timeout'), {kind: 'timeout'});
        adapter.mockImplementationOnce(async (message: Record<string, unknown>) => {
            reportTranslationModelUsage(message, {
                outcome: 'cancelled',
                usageAvailability: 'unreported',
            });
            throw timeoutError;
        });
        await expect(runTranslationServiceConnectionTest('demo', {recordModelUsage}))
            .rejects.toBe(timeoutError);
        expect(recordModelUsage).toHaveBeenNthCalledWith(1, [
            expect.objectContaining({
                purpose: 'connection-test',
                outcome: 'timeout',
            }),
        ]);

        const httpTimeout = new Error('adapter omitted structured timeout');
        adapter.mockImplementationOnce(async (message: Record<string, unknown>) => {
            reportTranslationModelUsage(message, {
                outcome: 'error',
                statusCode: 408,
                usageAvailability: 'unreported',
            });
            throw httpTimeout;
        });
        await expect(runTranslationServiceConnectionTest('demo', {recordModelUsage}))
            .rejects.toBe(httpTimeout);
        expect(recordModelUsage).toHaveBeenNthCalledWith(2, [
            expect.objectContaining({
                purpose: 'connection-test',
                statusCode: 408,
                outcome: 'timeout',
            }),
        ]);
    });

    it('区分取消与不同结构化超时，并处理非对象错误', async () => {
        const abortError = new Error('caller cancelled');
        abortError.name = 'AbortError';
        adapter.mockRejectedValueOnce(abortError);
        await expect(runTranslationServiceConnectionTest('demo')).rejects.toBe(abortError);

        for (const timeoutError of [
            Object.assign(new Error('named timeout'), {name: 'TimeoutError'}),
            Object.assign(new Error('http timeout'), {statusCode: 408}),
        ]) {
            adapter.mockRejectedValueOnce(timeoutError);
            await expect(runTranslationServiceConnectionTest('demo')).rejects.toBe(timeoutError);
        }

        adapter.mockRejectedValueOnce('plain failure');
        await expect(runTranslationServiceConnectionTest('demo')).rejects.toBe('plain failure');
    });

    it('统计写入的异步或同步失败都只告警，不改变连接测试结果', async () => {
        const asyncFailure = new Error('async usage failure');
        const syncFailure = new Error('sync usage failure');
        const warn = vi.fn();
        adapter.mockImplementation(async (message: Record<string, unknown>) => {
            reportTranslationModelUsage(message, {usageAvailability: 'unreported'});
            return '测试译文';
        });

        await expect(runTranslationServiceConnectionTest('demo', {
            recordModelUsage: vi.fn(async () => { throw asyncFailure; }),
            warn,
        })).resolves.toEqual(expect.objectContaining({durationMs: expect.any(Number)}));
        await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(
            '[FluentRead] connection test usage write failed:',
            asyncFailure,
        ));

        await expect(runTranslationServiceConnectionTest('demo', {
            recordModelUsage: vi.fn(() => { throw syncFailure; }),
            warn,
        })).resolves.toEqual(expect.objectContaining({durationMs: expect.any(Number)}));
        expect(warn).toHaveBeenCalledWith(
            '[FluentRead] connection test usage write failed:',
            syncFailure,
        );
    });

    it('复用统一服务错误格式化器', () => {
        expect(formatConnectionTestError('demo', new Error('plain failure'))).toBe('plain failure');
    });

    it('将 MiniMax 2049 错误转换为 Key、区域和计费类型提示', () => {
        const message = formatServiceError(
            services.minimax,
            new Error('翻译失败: 401 Unauthorized'),
        );

        expect(message).toContain('Token Plan Key');
        expect(message).toContain('api.minimaxi.com');
        expect(message).toContain('api.minimax.io');
        expect(message).toContain('不能互换');
    });

    it('将 MiMo 鉴权错误转换为 Key 前缀和集群提示', () => {
        const message = formatServiceError(
            services.mimo,
            new Error('翻译失败: 401 Unauthorized'),
        );

        expect(message).toContain('sk-');
        expect(message).toContain('tp-');
        expect(message).toContain('中国、新加坡或欧洲集群');
    });

    it('统一读取 Error 与非 Error 的消息', () => {
        expect(getServiceErrorMessage(new Error('from-error'))).toBe('from-error');
        expect(getServiceErrorMessage(503)).toBe('503');
    });

    it('网络错误增加可识别前缀，其他错误保持供应商原文', () => {
        expect(formatServiceError('demo', new Error('Failed to fetch endpoint')))
            .toBe('网络连接失败：Failed to fetch endpoint');
        expect(formatServiceError('demo', new Error('provider rejected request')))
            .toBe('provider rejected request');
    });

    it('空错误使用稳定兜底，并且鉴权提示只对匹配服务生效', () => {
        expect(formatServiceError('demo', '   ')).toBe('未知错误');
        expect(formatServiceError('demo', '401 Unauthorized')).toBe('401 Unauthorized');
    });
});
