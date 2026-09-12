/**
 * @file src/services/translation/requestScheduler.ts
 *
 * 文件职责：统一执行翻译任务的并发和请求启动速率限制，支持取消、截止时间、服务/模型 bucket 与真实 HTTP attempt。
 * 主要内容：旧配置继续使用 global bucket；启用服务或模型限制后按稳定请求身份切换 bucket，provider 的 attempt 只复用速率历史而不重复占用外层并发槽。
 * 模块边界：本模块只管理调度时序，不选择服务、不实现重试、不读取或写入配置；配置由调用方通过 getConfig 提供。
 */

import {
    normalizeMaxConcurrentTranslations,
    normalizeTranslationRequestsPerMinute,
    normalizeTranslationRequestsPerSecond,
} from '@/src/core/config/scheduling';
import {normalizeTranslationRequestLimits} from '@/src/core/config/requestLimits';

export interface TranslationRequestLimits {
    maxConcurrentTranslations?: unknown;
    translationRequestsPerSecond?: unknown;
    translationRequestsPerMinute?: unknown;
}

export interface TranslationRequestLimitSetting {
    enabled?: unknown;
    limits?: TranslationRequestLimits;
}

export interface TranslationRequestSchedulerConfig extends TranslationRequestLimits {
    serviceRequestLimits?: Record<string, TranslationRequestLimitSetting>;
    modelRequestLimits?: Record<string, Record<string, TranslationRequestLimitSetting>>;
}

export interface TranslationRequestIdentity {
    readonly service?: string;
    readonly model?: string;
}

export interface TranslationRequestLease {
    holdUntil(settlement: PromiseLike<unknown>): void;
}

export interface TranslationRequestSchedulerTaskOptions {
    signal?: AbortSignal;
    deadlineAt?: number;
    identity?: TranslationRequestIdentity;
    /** 外层 AI SDK 调用只占并发，真实 HTTP attempt 由 scheduleAttempt 计速率。 */
    countRate?: boolean;
}

export interface TranslationRequestAttemptOptions {
    signal?: AbortSignal;
    deadlineAt?: number;
    identity?: TranslationRequestIdentity;
}

export interface TranslationRequestScheduler {
    schedule<T>(task: (lease: TranslationRequestLease) => Promise<T>, options?: TranslationRequestSchedulerTaskOptions): Promise<T>;
    /** 真实 HTTP attempt 只取得速率许可；外层 provider 已持有并发 lease。 */
    scheduleAttempt<T>(task: () => Promise<T>, options?: TranslationRequestAttemptOptions): Promise<T>;
}

export class TranslationRequestSchedulerDeadlineError extends Error {
    readonly code = 'TRANSLATION_SCHEDULER_DEADLINE_EXCEEDED';
    constructor(message = '翻译请求超时') {
        super(message);
        this.name = 'TranslationRequestSchedulerDeadlineError';
    }
}

interface BucketLimit {
    concurrency: number;
    perSecond: number;
    perMinute: number;
}
interface BucketState {
    active: number;
    starts: number[];
}
interface PendingRequest<T> {
    readonly task: (lease: TranslationRequestLease) => Promise<T>;
    readonly signal?: AbortSignal;
    readonly deadlineAt?: number;
    readonly identity?: TranslationRequestIdentity;
    readonly attemptOnly: boolean;
    readonly countRate: boolean;
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
function clean(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function createTranslationRequestScheduler(
    getConfig: () => TranslationRequestSchedulerConfig,
    dependencies: TranslationRequestSchedulerDependencies = {},
): TranslationRequestScheduler {
    const now = dependencies.now ?? (() => Date.now());
    const buckets = new Map<string, BucketState>();
    let pending: Array<PendingRequest<unknown> | undefined> = [];
    let head = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let draining = false;
    let lastNow: number | undefined;

    function readNow(): number {
        const current = finiteNow(now);
        if (lastNow !== undefined && current < lastNow) {
            for (const state of buckets.values()) state.starts.length = 0;
        }
        lastNow = current;
        return current;
    }

    function currentConfig(): TranslationRequestSchedulerConfig {
        try {
            return getConfig() || {};
        } catch {
            return {};
        }
    }

    function keysFor(identity: TranslationRequestIdentity | undefined, config: TranslationRequestSchedulerConfig): string[] {
        const service = clean(identity?.service);
        const model = clean(identity?.model);
        if (!service) return ['global'];
        const serviceSetting = config.serviceRequestLimits?.[service];
        const modelSetting = model ? config.modelRequestLimits?.[service]?.[model] : undefined;
        if (modelSetting?.enabled === true) {
            const result = [JSON.stringify(['model', service, model])];
            if (serviceSetting?.enabled === true) result.push(JSON.stringify(['service', service]));
            return result;
        }
        return serviceSetting?.enabled === true ? [JSON.stringify(['service', service])] : ['global'];
    }

    function stateFor(key: string): BucketState {
        let state = buckets.get(key);
        if (!state) {
            state = {active: 0, starts: []};
            buckets.set(key, state);
        }
        return state;
    }

    function limitFor(key: string, config: TranslationRequestSchedulerConfig): BucketLimit {
        if (key === 'global') return {
            concurrency: normalizeMaxConcurrentTranslations(config.maxConcurrentTranslations),
            perSecond: normalizeTranslationRequestsPerSecond(config.translationRequestsPerSecond),
            perMinute: normalizeTranslationRequestsPerMinute(config.translationRequestsPerMinute),
        };
        const parts = JSON.parse(key) as string[];
        const [kind, service, model] = parts;
        const setting = kind === 'service' ? config.serviceRequestLimits?.[service!] : config.modelRequestLimits?.[service!]?.[model!];
        const limits = normalizeTranslationRequestLimits(setting?.limits);
        return {
            concurrency: limits.maxConcurrentTranslations,
            perSecond: limits.translationRequestsPerSecond,
            perMinute: limits.translationRequestsPerMinute,
        };
    }

    function prune(state: BucketState, current: number): void {
        const cutoff = current - 60_000;
        let index = 0;
        while (index < state.starts.length && state.starts[index]! <= cutoff) index += 1;
        if (index) state.starts.splice(0, index);
    }

    function waitFor(key: string, current: number, config: TranslationRequestSchedulerConfig, concurrency: boolean, countRate: boolean): number {
        const state = stateFor(key);
        const limits = limitFor(key, config);
        prune(state, current);
        if (concurrency && state.active >= limits.concurrency) return Number.POSITIVE_INFINITY;
        if (!countRate) return 0;
        let wait = 0;
        if (limits.perSecond > 0) {
            const recentSecond = state.starts.filter(value => value > current - 1_000);
            if (recentSecond.length >= limits.perSecond) {
                wait = Math.max(wait, recentSecond[recentSecond.length - limits.perSecond]! + 1_000 - current);
            }
        }
        if (limits.perMinute > 0 && state.starts.length >= limits.perMinute) {
            wait = Math.max(wait, state.starts[state.starts.length - limits.perMinute]! + 60_000 - current);
        }
        return wait;
    }

    function compact(): void {
        while (head < pending.length && !pending[head]) head += 1;
        if (head >= pending.length) {
            pending = [];
            head = 0;
        } else if (head >= 1024 && head * 2 >= pending.length) {
            pending = pending.slice(head);
            head = 0;
        }
    }

    function rejectPending(entry: PendingRequest<unknown>, error: unknown): void {
        entry.settled = true;
        entry.removeAbortListener?.();
        entry.reject(error);
    }

    function rejectInactive(current: number): void {
        for (let index = head; index < pending.length; index += 1) {
            const entry = pending[index];
            if (!entry) continue;
            if (entry.settled) pending[index] = undefined;
            else if (entry.deadlineAt !== undefined && entry.deadlineAt <= current) {
                pending[index] = undefined;
                rejectPending(entry, new TranslationRequestSchedulerDeadlineError());
            }
        }
        compact();
    }

    function hasEarlierSameBucket(index: number, keys: readonly string[], attemptOnly: boolean, config: TranslationRequestSchedulerConfig): boolean {
        for (let prior = head; prior < index; prior += 1) {
            const entry = pending[prior];
            if (!entry || entry.settled) continue;
            // HTTP 重试复用已占用的并发槽，不能被等待该槽的外层任务反向阻塞。
            if (attemptOnly && !entry.attemptOnly) continue;
            if (keysFor(entry.identity, config).some(key => keys.includes(key))) return true;
        }
        return false;
    }

    function arm(delay: number): void {
        timer = setTimeout(() => {
            timer = undefined;
            drain();
        }, Math.max(1, Math.ceil(delay)));
    }

    function createLease() {
        const waits: Promise<void>[] = [];
        let open = true;
        return {
            lease: {
                holdUntil: (settlement: PromiseLike<unknown>) => {
                    if (!open) throw new Error('翻译请求已结束，无法继续占用调度槽');
                    waits.push(Promise.resolve(settlement).then(() => undefined, () => undefined));
                },
            },
            waits,
            close: () => { open = false; },
        };
    }

    async function execute(entry: PendingRequest<unknown>, keys: readonly string[]): Promise<void> {
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
            // 调用方可以先收到取消/超时；真实传输结束后才归还并发槽。
            leaseState.close();
            await Promise.all(leaseState.waits);
            if (!entry.attemptOnly) {
                for (const key of keys) stateFor(key).active -= 1;
            }
            drain();
        }
    }

    function drain(): void {
        if (draining) return;
        draining = true;
        try {
            if (timer !== undefined) {
                clearTimeout(timer);
                timer = undefined;
            }
            const config = currentConfig();
            const current = readNow();
            rejectInactive(current);
            let earliest = Number.POSITIVE_INFINITY;
            let started = true;
            while (started) {
                started = false;
                for (let index = head; index < pending.length; index += 1) {
                    const entry = pending[index];
                    if (!entry || entry.settled) continue;
                    const keys = keysFor(entry.identity, config);
                    if (hasEarlierSameBucket(index, keys, entry.attemptOnly, config)) continue;
                    const wait = Math.max(...keys.map(key => waitFor(key, current, config, !entry.attemptOnly, entry.countRate)));
                    if (wait > 0 || wait === Number.POSITIVE_INFINITY) {
                        if (wait < earliest) earliest = wait;
                        continue;
                    }
                    pending[index] = undefined;
                    for (const key of keys) {
                        const state = stateFor(key);
                        if (!entry.attemptOnly) state.active += 1;
                        if (entry.countRate) state.starts.push(current);
                    }
                    void execute(entry, keys);
                    started = true;
                    break;
                }
            }
            compact();
            const deadlines = pending.slice(head).filter(Boolean).map(entry => entry!.deadlineAt).filter((value): value is number => value !== undefined);
            const deadlineWait = deadlines.length ? Math.max(0, Math.min(...deadlines) - current) : Number.POSITIVE_INFINITY;
            const nextWait = Math.min(earliest, deadlineWait);
            if (nextWait < Number.POSITIVE_INFINITY) arm(nextWait);
        } finally {
            draining = false;
        }
    }

    function enqueue<T>(entry: PendingRequest<T>): Promise<T> {
        if (entry.signal?.aborted) return Promise.reject(createAbortError());
        return new Promise<T>((resolve, reject) => {
            (entry as {resolve: typeof resolve; reject: typeof reject}).resolve = resolve;
            (entry as {resolve: typeof resolve; reject: typeof reject}).reject = reject;
            if (entry.signal) {
                const onAbort = () => {
                    entry.settled = true;
                    entry.reject(createAbortError());
                    drain();
                };
                entry.signal.addEventListener('abort', onAbort, {once: true});
                entry.removeAbortListener = () => entry.signal?.removeEventListener('abort', onAbort);
            }
            pending.push(entry as PendingRequest<unknown>);
            drain();
        });
    }

    return {
        schedule: <T>(task: (lease: TranslationRequestLease) => Promise<T>, options: TranslationRequestSchedulerTaskOptions = {}) => enqueue({
            task,
            signal: options.signal,
            deadlineAt: options.deadlineAt,
            identity: options.identity,
            attemptOnly: false,
            countRate: options.countRate !== false,
            resolve: undefined as never,
            reject: undefined as never,
            settled: false,
        }),
        scheduleAttempt: <T>(task: () => Promise<T>, options: TranslationRequestAttemptOptions = {}) => enqueue({
            task: async () => task(),
            signal: options.signal,
            deadlineAt: options.deadlineAt,
            identity: options.identity,
            attemptOnly: true,
            countRate: true,
            resolve: undefined as never,
            reject: undefined as never,
            settled: false,
        }),
    };
}
