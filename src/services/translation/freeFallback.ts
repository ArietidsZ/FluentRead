/**
 * @file src/services/translation/freeFallback.ts
 * 文件职责：有界免费翻译回退，共享短期冷却、并发预算和取消所有权。
 * 主要内容：协调单次超时、总截止时间、跨段恢复探测及迟到失败的代际保护。
 * 模块边界：只接收 provider 回调与不含凭据的身份摘要，不读取配置或发起网络请求。
 */
import {abortErrorFromSignal} from '@/src/platform/http/runtime';

export interface FreeFallbackCandidate {
    readonly identity: string;
    readonly label: string;
    readonly translate: (signal: AbortSignal) => Promise<unknown>;
}

export interface FreeFallbackOptions {
    readonly signal?: AbortSignal;
    readonly timeoutMs: number;
    readonly cooldownMs: number;
    /** 同一批次共享绝对截止时间，排队与所有备用服务共同消费预算。 */
    readonly deadline?: number;
}

interface Health {
    retryAt: number;
    /** 成功递增，令成功前已启动请求的迟到失败失去熔断权限。 */
    generation: number;
    probing: boolean;
}

class AttemptTimeoutError extends Error {
    constructor() { super('请求超时'); }
}

class InvalidTranslationError extends Error {
    constructor() { super('未返回有效译文'); }
}

function statusCode(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const candidate = error as {statusCode?: unknown; status?: unknown};
    const status = candidate.statusCode ?? candidate.status;
    return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
        ? status : undefined;
}

function isCancellation(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

function shouldCoolDown(error: unknown): boolean {
    const status = statusCode(error);
    // 参数、文本长度和不支持的语言属于该请求，不能熔断其他段落。
    return status === undefined || status >= 500 || [401, 403, 408, 429, 456].includes(status);
}

function safeFailure(error: unknown): string {
    const status = statusCode(error);
    if (status !== undefined) return `HTTP ${status}`;
    if (error instanceof AttemptTimeoutError || error instanceof InvalidTranslationError) return error.message;
    // 不传播 transport/代理错误正文，它可能包含原文、完整 URL 或密钥。
    return '请求失败';
}

/** 即使不合规 transport 忽略 signal，也让调用方按预算结束；迟到结果不再改变健康状态。 */
async function runAttempt(
    candidate: FreeFallbackCandidate,
    timeoutMs: number,
    signal?: AbortSignal,
): Promise<string> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const result = new Promise<string>((resolve, reject) => {
        onAbort = () => {
            const error = abortErrorFromSignal(signal);
            reject(error);
            controller.abort(error);
        };
        signal?.addEventListener('abort', onAbort, {once: true});
        timer = setTimeout(() => {
            const error = new AttemptTimeoutError();
            reject(error);
            controller.abort(error);
        }, timeoutMs);
        // Promise.resolve 包住同步 throw；超时后的 resolve/reject 都会被该 Promise 忽略。
        Promise.resolve().then(() => {
            if (controller.signal.aborted) throw abortErrorFromSignal(controller.signal);
            return candidate.translate(controller.signal);
        }).then(value => {
            if (typeof value !== 'string' || !value.trim()) reject(new InvalidTranslationError());
            else resolve(value);
        }, reject);
    });
    try { return await result; }
    finally {
        clearTimeout(timer);
        if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
}

/** 每个后台实例最多保留 128 个配置身份；密钥/端点只由调用方生成摘要。 */
export function createFreeFallbackRunner(maxConcurrency = 3) {
    const health = new Map<string, Health>();
    const queue: Array<() => void> = [];
    let active = 0;
    const concurrency = Math.max(1, Math.floor(maxConcurrency));

    function getHealth(identity: string): Health {
        let state = health.get(identity);
        if (!state) {
            state = {retryAt: 0, generation: 0, probing: false};
            health.set(identity, state);
            if (health.size > 128) health.delete(health.keys().next().value!);
        } else {
            health.delete(identity);
            health.set(identity, state);
        }
        return state;
    }

    async function acquire(deadline: number, signal?: AbortSignal): Promise<() => void> {
        if (Date.now() >= deadline) throw new AttemptTimeoutError();
        if (active >= concurrency) {
            await new Promise<void>((resolve, reject) => {
                const cleanup = () => {
                    clearTimeout(timer);
                    signal?.removeEventListener('abort', onAbort);
                    const index = queue.indexOf(onReady);
                    if (index >= 0) queue.splice(index, 1);
                };
                const onReady = () => { cleanup(); resolve(); };
                const onAbort = () => { cleanup(); reject(abortErrorFromSignal(signal)); };
                const timer = setTimeout(() => { cleanup(); reject(new AttemptTimeoutError()); }, Math.max(1, deadline - Date.now()));
                signal?.addEventListener('abort', onAbort, {once: true});
                queue.push(onReady);
            });
        } else active += 1;
        // release 将许可直接交给队首，避免微任务间隙新请求插队突破并发上限。
        return () => {
            const next = queue.shift();
            if (next) next();
            else active -= 1;
        };
    }

    return async (candidates: readonly FreeFallbackCandidate[], options: FreeFallbackOptions): Promise<string> => {
        if (options.signal?.aborted) throw abortErrorFromSignal(options.signal);
        if (!candidates.length) throw new Error('免费翻译服务均不可用：所选服务尚未配置免费凭据');
        const deadline = options.deadline ?? Date.now() + options.timeoutMs * candidates.length;
        const release = await acquire(deadline, options.signal);
        const failures: string[] = [];
        let attempted = false;
        try {
            for (const candidate of candidates) {
                if (options.signal?.aborted) throw abortErrorFromSignal(options.signal);
                const remaining = deadline - Date.now();
                if (remaining <= 0) throw new AttemptTimeoutError();
                const state = getHealth(candidate.identity);
                if (state.retryAt > Date.now() || state.probing) {
                    failures.push(`${candidate.label}: 冷却中`);
                    continue;
                }
                const generation = state.generation;
                // 过期后仅放行一个探测请求，其他请求继续备用服务。
                const probing = state.retryAt !== 0;
                if (probing) state.probing = true;
                attempted = true;
                try {
                    const result = await runAttempt(candidate, Math.min(options.timeoutMs, remaining), options.signal);
                    if (options.signal?.aborted) throw abortErrorFromSignal(options.signal);
                    state.generation += 1;
                    state.retryAt = 0;
                    return result;
                } catch (error) {
                    if (options.signal?.aborted) throw abortErrorFromSignal(options.signal);
                    if (isCancellation(error)) throw new DOMException('The request was aborted.', 'AbortError');
                    // 上层剩余预算不足以完成一次正常尝试，不能据此认定该服务发生故障。
                    if (error instanceof AttemptTimeoutError && remaining < options.timeoutMs && Date.now() >= deadline) throw error;
                    if (shouldCoolDown(error) && state.generation === generation) {
                        state.retryAt = Date.now() + options.cooldownMs;
                    }
                    failures.push(`${candidate.label}: ${safeFailure(error)}`);
                } finally {
                    if (probing) state.probing = false;
                }
            }
            const reason = attempted ? failures.join('；') : '所选服务正在冷却，请稍后重试';
            throw new Error(`免费翻译服务均不可用（${candidates.map(item => item.label).join(' → ')}）：${reason}`);
        } finally { release(); }
    };
}
