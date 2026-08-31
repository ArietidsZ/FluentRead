/**
 * @file src/services/translation/requestScheduler.ts
 *
 * 文件职责：在共享翻译 provider 入口统一执行并发和请求启动速率限制，并支持可取消、带截止时间的排队任务。
 * 主要内容：按 FIFO 调度翻译请求，分别约束每秒/每分钟请求数，保留 transport lease 直到真实请求结束，避免调用方超时后立即释放后台并发槽。
 * 模块边界：该模块只管理翻译请求的调度时序，不选择服务、不实现重试、不读取或写入配置；配置由调用方通过 getConfig 提供。
 */

import {
    normalizeMaxConcurrentTranslations,
    normalizeTranslationRequestsPerMinute,
    normalizeTranslationRequestsPerSecond,
} from '@/src/core/config/scheduling';

export interface TranslationRequestSchedulerConfig {
    maxConcurrentTranslations?: unknown;
    translationRequestsPerSecond?: unknown;
    translationRequestsPerMinute?: unknown;
}

export interface TranslationRequestLease {
    holdUntil(settlement: PromiseLike<unknown>): void;
}

export interface TranslationRequestSchedulerTaskOptions {
    signal?: AbortSignal;
    /** 排队等待也计入本次 provider 预算；到达该时间点后不会再启动 provider。 */
    deadlineAt?: number;
}

export interface TranslationRequestScheduler {
    schedule<T>(
        task: (lease: TranslationRequestLease) => Promise<T>,
        options?: TranslationRequestSchedulerTaskOptions,
    ): Promise<T>;
}

export class TranslationRequestSchedulerDeadlineError extends Error {
    readonly code = 'TRANSLATION_SCHEDULER_DEADLINE_EXCEEDED';

    constructor(message = '翻译请求超时') {
        super(message);
        this.name = 'TranslationRequestSchedulerDeadlineError';
    }
}

interface PendingRequest<T> {
    readonly task: (lease: TranslationRequestLease) => Promise<T>;
    readonly signal?: AbortSignal;
    readonly deadlineAt?: number;
    readonly resolve: (value: T | PromiseLike<T>) => void;
    readonly reject: (reason?: unknown) => void;
    settled: boolean;
    removeAbortListener?: () => void;
}

export interface TranslationRequestSchedulerDependencies {
    now?: () => number;
}

function createAbortError(): Error {
    const error = new Error('翻译已取消');
    error.name = 'AbortError';
    return error;
}

function finiteNow(now: () => number): number {
    const value = now();
    return Number.isFinite(value) ? value : Date.now();
}

/**
 * 创建一个共享 provider 调度器。请求启动时间使用滑动窗口记录，因此同一时刻
 * 可以合法启动一小批请求，但不会突破任一窗口的上限；0 表示对应窗口不限速。
 */
export function createTranslationRequestScheduler(
    getConfig: () => TranslationRequestSchedulerConfig,
    dependencies: TranslationRequestSchedulerDependencies = {},
): TranslationRequestScheduler {
    const now = dependencies.now ?? (() => Date.now());
    let activeRequests = 0;
    let pendingRequests: Array<PendingRequest<unknown> | undefined> = [];
    let pendingHead = 0;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    let isDraining = false;
    let lastNow: number | undefined;
    const requestStarts: number[] = [];

    function readNow(): number {
        const current = finiteNow(now);
        // 测试时钟重置和系统时钟回拨都不能让旧窗口永久阻塞新请求。
        if (lastNow !== undefined && current < lastNow) requestStarts.length = 0;
        lastNow = current;
        return current;
    }

    function schedulingConfig(): TranslationRequestSchedulerConfig {
        try {
            return getConfig() || {};
        } catch {
            // 配置旁路读取失败时保持原有请求能力，不把调度器变成新的故障源。
            return {};
        }
    }

    function compactPending(force = false): void {
        if (pendingHead === 0) return;
        if (pendingHead >= pendingRequests.length) {
            pendingRequests = [];
            pendingHead = 0;
            return;
        }
        if (force || (pendingHead >= 1024 && pendingHead * 2 >= pendingRequests.length)) {
            pendingRequests = pendingRequests.slice(pendingHead);
            pendingHead = 0;
        }
    }

    function peekPending(): PendingRequest<unknown> | undefined {
        while (pendingHead < pendingRequests.length && !pendingRequests[pendingHead]) {
            pendingHead += 1;
            compactPending();
        }
        return pendingRequests[pendingHead];
    }

    function dequeuePending(): PendingRequest<unknown> | undefined {
        while (pendingHead < pendingRequests.length) {
            const entry = pendingRequests[pendingHead];
            pendingRequests[pendingHead] = undefined;
            pendingHead += 1;
            compactPending();
            if (entry) return entry;
        }
    }

    function rejectPending(entry: PendingRequest<unknown>, error: unknown): void {
        entry.settled = true;
        entry.removeAbortListener?.();
        entry.reject(error);
    }

    function rejectInactivePending(current: number): void {
        let removed = false;
        for (let index = pendingHead; index < pendingRequests.length; index += 1) {
            const entry = pendingRequests[index];
            if (!entry) continue;
            if (entry.settled) {
                pendingRequests[index] = undefined;
                removed = true;
                continue;
            }
            if (entry.deadlineAt !== undefined && entry.deadlineAt <= current) {
                pendingRequests[index] = undefined;
                rejectPending(entry, new TranslationRequestSchedulerDeadlineError());
                removed = true;
            }
        }
        if (removed) compactPending(true);
    }

    function earliestPendingDeadline(): number | undefined {
        let earliest: number | undefined;
        for (let index = pendingHead; index < pendingRequests.length; index += 1) {
            const entry = pendingRequests[index];
            if (!entry || entry.settled || entry.deadlineAt === undefined) continue;
            if (earliest === undefined || entry.deadlineAt < earliest) earliest = entry.deadlineAt;
        }
        return earliest;
    }

    function pruneRequestStarts(current: number): void {
        const oldestRetained = current - 60_000;
        let firstRetained = 0;
        while (firstRetained < requestStarts.length && requestStarts[firstRetained] <= oldestRetained) {
            firstRetained += 1;
        }
        if (firstRetained > 0) requestStarts.splice(0, firstRetained);
    }

    function getRateLimitSettings(): {perSecond: number; perMinute: number} {
        const currentConfig = schedulingConfig();
        return {
            perSecond: normalizeTranslationRequestsPerSecond(
                currentConfig.translationRequestsPerSecond,
            ),
            perMinute: normalizeTranslationRequestsPerMinute(
                currentConfig.translationRequestsPerMinute,
            ),
        };
    }

    function rateLimitWaitMs(
        current: number,
        limits: {perSecond: number; perMinute: number},
    ): number {
        if (limits.perSecond === 0 && limits.perMinute === 0) {
            requestStarts.length = 0;
            return 0;
        }

        pruneRequestStarts(current);
        let waitMs = 0;
        if (limits.perSecond > 0) {
            const recentSecond = requestStarts.filter((startedAt) => startedAt > current - 1_000);
            if (recentSecond.length >= limits.perSecond) {
                waitMs = Math.max(waitMs, recentSecond[0]! + 1_000 - current);
            }
        }
        if (limits.perMinute > 0) {
            const recentMinute = requestStarts.filter((startedAt) => startedAt > current - 60_000);
            if (recentMinute.length >= limits.perMinute) {
                waitMs = Math.max(waitMs, recentMinute[0]! + 60_000 - current);
            }
        }
        return Math.max(0, waitMs);
    }

    function armDrainTimer(delayMs: number): void {
        drainTimer = setTimeout(() => {
            drainTimer = undefined;
            drain();
        }, Math.max(1, Math.ceil(delayMs)));
    }

    function createLease(): {
        lease: TranslationRequestLease;
        waits: Promise<void>[];
        close: () => void;
    } {
        const waits: Promise<void>[] = [];
        let acceptsHolds = true;
        return {
            lease: {
                holdUntil: (settlement) => {
                    if (!acceptsHolds) {
                        throw new Error('翻译请求已结束，无法继续占用调度槽');
                    }
                    waits.push(Promise.resolve(settlement).then(
                        () => undefined,
                        () => undefined,
                    ));
                },
            },
            waits,
            close: () => {
                acceptsHolds = false;
            },
        };
    }

    async function execute(entry: PendingRequest<unknown>): Promise<void> {
        const leaseState = createLease();
        try {
            const result = await entry.task(leaseState.lease);
            if (!entry.settled) {
                entry.settled = true;
                entry.removeAbortListener?.();
                entry.resolve(result);
            }
        } catch (error) {
            if (!entry.settled) {
                entry.settled = true;
                entry.removeAbortListener?.();
                entry.reject(error);
            }
        } finally {
            leaseState.close();
            await Promise.all(leaseState.waits);
            activeRequests -= 1;
            drain();
        }
    }

    function drain(): void {
        if (isDraining) return;
        isDraining = true;
        try {
            if (drainTimer !== undefined) {
                clearTimeout(drainTimer);
                drainTimer = undefined;
            }

            const currentConfig = schedulingConfig();
            const maxConcurrent = normalizeMaxConcurrentTranslations(
                currentConfig.maxConcurrentTranslations,
            );
            const rateLimits = getRateLimitSettings();
            const current = readNow();
            rejectInactivePending(current);

            while (activeRequests < maxConcurrent) {
                const entry = peekPending();
                if (!entry) return;

                const rateWait = rateLimitWaitMs(current, rateLimits);
                if (rateWait > 0) {
                    const earliestDeadline = earliestPendingDeadline();
                    const deadlineWait = earliestDeadline === undefined
                        ? Number.POSITIVE_INFINITY
                        : Math.max(0, earliestDeadline - current);
                    armDrainTimer(Math.min(rateWait, deadlineWait));
                    return;
                }

                const next = dequeuePending()!;
                if (rateLimits.perSecond > 0 || rateLimits.perMinute > 0) {
                    requestStarts.push(current);
                }
                activeRequests += 1;
                void execute(next);
            }

            const earliestDeadline = earliestPendingDeadline();
            if (earliestDeadline !== undefined) {
                armDrainTimer(Math.max(0, earliestDeadline - current));
            }
        } finally {
            isDraining = false;
        }
    }

    return {
        schedule<T>(
            task: (lease: TranslationRequestLease) => Promise<T>,
            options: TranslationRequestSchedulerTaskOptions = {},
        ): Promise<T> {
            if (options.signal?.aborted) return Promise.reject(createAbortError());

            return new Promise<T>((resolve, reject) => {
                const entry: PendingRequest<T> = {
                    task,
                    signal: options.signal,
                    deadlineAt: options.deadlineAt,
                    resolve,
                    reject,
                    settled: false,
                    removeAbortListener: undefined,
                };
                if (options.signal) {
                    const onAbort = () => {
                        entry.settled = true;
                        entry.reject(createAbortError());
                        drain();
                    };
                    options.signal.addEventListener('abort', onAbort, {once: true});
                    entry.removeAbortListener = () => options.signal?.removeEventListener('abort', onAbort);
                }
                pendingRequests.push(entry as PendingRequest<unknown>);
                drain();
            });
        },
    };
}
