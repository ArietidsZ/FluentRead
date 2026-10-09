import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {writeFileSync} from 'node:fs';

const state = vi.hoisted(() => ({
    config: {
        service: 'custom', from: 'en', to: 'zh-Hans', useCache: false, enableAIContext: false,
        token: {custom: 'fixture-a', newapi: 'fixture-b'}, model: {custom: 'fixture-model', newapi: 'fixture-model'},
        customModel: {}, proxy: {}, custom: 'https://quota-a.test/v1', newApiUrl: 'https://healthy-b.test/v1',
        deeplx: '', azureOpenaiEndpoint: '', minimaxBillingPlan: 'payg', minimaxRegion: 'cn',
        mimoBillingPlan: 'payg', mimoRegion: 'cn', customBody: {}, customHeaders: {}, system_role: {}, user_role: {},
        deepseekApiType: 'auto', deepseekThinkingMode: 'disabled', requireApiKey: {}, secret: {},
        youdaoAppKey: '', youdaoAppSecret: '', tencentSecretId: '', tencentSecretKey: '',
        translationMaxRetries: 2, maxConcurrentTranslations: 6,
        translationRequestsPerSecond: 0, translationRequestsPerMinute: 0,
    },
    dispatch: async (_message: unknown): Promise<unknown> => undefined,
}));
vi.mock('@/src/services/config/store', () => ({
    config: state.config, requestConfigCountIncrement: async () => 0,
}));
vi.mock('webextension-polyfill', () => ({default: {
    runtime: {sendMessage: (message: unknown) => state.dispatch(message)}, extension: {inIncognitoContext: false},
}}));

import {createTranslationBroker} from '@/src/services/translation/broker';
import {createTranslationRequestScheduler} from '@/src/services/translation/requestScheduler';
import {translateWithOpenAICompatibleAiSdk} from '@/src/providers/translation/ai-sdk/openai-compatible';
import {AI_SDK_TRANSPORT_PROFILE, resolveOpenAICompatibleEndpoint} from '@/src/providers/translation/ai-sdk/endpoints';
import {createTranslationRequestFallback, createTranslationRequestRegistry, createTranslationCancelHandler, type TranslationRequestContext} from '@/src/app/background/handlers/translation';
import {serializeTranslationError} from '@/src/services/translation/errors';
import {servicesType, resolveConfiguredModel} from '@/src/core/config/catalog';
import {translateText, cancelAllTranslations} from '@/src/app/translation/client';
import {setRuntimeFetch as installRuntimeFetch, type RuntimeFetch} from '@/src/platform/http/runtime';
import {attachTranslationRequestControl} from '@/src/services/translation/requestSnapshot';
import type {TranslationConfigSource} from '@/src/services/translation/types';

function setRuntimeFetch(transport?: RuntimeFetch) {
    installRuntimeFetch(transport ? async (input, init) => {
        if (!['https://quota-a.test/v1/chat/completions', 'https://quota-c.test/v1/chat/completions',
            'https://healthy-b.test/v1/chat/completions'].includes(String(input))) throw new Error('Unmatched runtime network prohibited');
        return transport(input, init);
    } : undefined);
}

function response(status = 200, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(status === 200 ? {
        choices: [{message: {role: 'assistant', content: '这是合成译文。'}, finish_reason: 'stop'}],
        usage: {prompt_tokens: 4, completion_tokens: 3, total_tokens: 7},
    } : {error: {message: 'synthetic response'}}), {status, headers: {'content-type': 'application/json', ...headers}});
}

function harness() {
    const scheduler = createTranslationRequestScheduler(() => state.config);
    const writes: unknown[] = [];
    const broker = createTranslationBroker({
        ready: Promise.resolve(), getConfig: () => state.config as TranslationConfigSource,
        providers: {custom: translateWithOpenAICompatibleAiSdk as never, newapi: translateWithOpenAICompatibleAiSdk as never},
        cache: {get: async () => null, set: async (...args: unknown[]) => {writes.push(args); return true;}, clear: async () => undefined, cleanup: async () => undefined},
        serviceTypes: servicesType, endpointResolver: {resolveOpenAICompatibleEndpoint, aiSdkTransportProfile: AI_SDK_TRANSPORT_PROFILE},
        promptBuilder: {buildPageSummaryPrompt: () => '', buildPageSummarySystemPrompt: () => ''},
        getMissingCredentialMessage: () => null,
        getTranslationLanguages: () => ({sourceLanguage: 'en', targetLanguage: 'zh-Hans'}),
        resolveConfiguredModel, buildTranslationCacheKey: JSON.stringify, requestScheduler: scheduler,
    });
    const registry = createTranslationRequestRegistry();
    const fallback = createTranslationRequestFallback<TranslationRequestContext>({translate: broker.translateWithCache, serializeError: serializeTranslationError, requestRegistry: registry});
    const cancel = createTranslationCancelHandler(registry);
    state.dispatch = (message) => {
        const context = {sender: {id: 'fixture-extension', tab: {id: 1, incognito: false}}};
        const candidate = message as Record<string, unknown>;
        return candidate.type ? Promise.resolve(cancel.handle(candidate as never, context))
            : fallback.handle(candidate as never, context) as Promise<unknown>;
    };
    return {scheduler, broker, writes, fallback};
}

async function flush() {
    // Node Response.clone() streams also settle through the real event loop.
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

function client(origin: string, serviceOverride = 'custom', timeout = 125_000, signal = new AbortController().signal) {
    return translateText(origin, 'synthetic benchmark', {
        serviceOverride, timeout, signal, skipLanguageDetection: true, pageContext: '', enableAIContext: false, useCache: false,
    });
}

beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.stubGlobal('fetch', vi.fn(async () => {throw new Error('Unmatched real network prohibited');}));
    state.config.custom = 'https://quota-a.test/v1'; state.config.newApiUrl = 'https://healthy-b.test/v1';
    state.config.model.custom = 'fixture-model'; state.config.token.custom = 'fixture-a';
    state.config.customHeaders = {};
    state.config.translationMaxRetries = 2; state.config.maxConcurrentTranslations = 6;
    setRuntimeFetch(async () => {throw new Error('Unmatched runtime network prohibited');});
});
afterEach(() => {cancelAllTranslations(); setRuntimeFetch(); vi.useRealTimers(); vi.unstubAllGlobals();});

describe('shared Retry-After real client/broker/SDK transport replay', () => {
    it('replays 30 fixed seeds with identical arrivals and server quota windows', async () => {
        const cases: unknown[] = [];
        for (let seed = 1; seed <= 30; seed += 1) {
            harness();
            const start = Date.now(); const delay = [2_000, 60_000, 90_000][(seed - 1) % 3]!;
            const attempts: Array<{scope: string; at: number; status: number; bodyBytes: number}> = [];
            let unmatched = 0;
            setRuntimeFetch(async (input, init) => {
                const url = String(input);
                const scope = url === 'https://quota-a.test/v1/chat/completions' ? 'A'
                    : url === 'https://healthy-b.test/v1/chat/completions' ? 'B' : '';
                if (!scope) {unmatched += 1; throw new Error('Unmatched network prohibited');}
                const at = Date.now() - start; const status = scope === 'A' && at < delay ? 429 : 200;
                attempts.push({scope, at, status, bodyBytes: new TextEncoder().encode(String(init?.body)).byteLength});
                return response(status, status === 429 ? {'retry-after': String(delay / 1000)} : {});
            });
            const jobs: Array<Promise<boolean>> = [];
            const add = (id: string, service: string) => jobs.push(client(id, service).then(() => true, () => false));
            add(`seed ${seed} original alpha`, 'custom');
            await vi.advanceTimersByTimeAsync(100 + seed % 13);
            add(`seed ${seed} next alpha`, 'custom');
            add(`seed ${seed} healthy beta`, 'newapi');
            await vi.advanceTimersByTimeAsync(100 + seed % 17);
            add(`seed ${seed} final alpha`, 'custom');
            await vi.runAllTimersAsync(); await flush();
            const outcomes = await Promise.all(jobs);
            expect(unmatched).toBe(0); expect(attempts.filter(x => x.scope === 'B')).toHaveLength(1);
            expect(outcomes[2]).toBe(true);
            if ((process.env.FLUENTREAD_COOLDOWN_VARIANT ?? 'C') === 'C') {
                expect(outcomes).toEqual([true, true, true, true]);
                expect(attempts.filter(x => x.scope === 'A' && x.at > 0 && x.at < delay)).toHaveLength(0);
            }
            cases.push({seed, delay, outcomes, attempts, successes: outcomes.filter(Boolean).length,
                healthyAttempts: attempts.filter(x => x.scope === 'B').length,
                healthyBodyBytes: attempts.filter(x => x.scope === 'B').reduce((sum, x) => sum + x.bodyBytes, 0),
                leakedDispatches: attempts.filter(x => x.scope === 'A' && x.at > 0 && x.at < delay).length});
        }
        const replay = {variant: process.env.FLUENTREAD_COOLDOWN_VARIANT ?? 'C', seeds: 30, cases};
        if (process.env.FLUENTREAD_COOLDOWN_EVIDENCE) writeFileSync(process.env.FLUENTREAD_COOLDOWN_EVIDENCE, JSON.stringify(replay, null, 2));
    }, 30_000);

    it.each([
        [429, {'retry-after': '2'}, 2000],
        [429, {'retry-after': '60'}, 60_000],
        [429, {'retry-after': '90'}, 90_000],
        [429, {'retry-after': 'Thu, 01 Jan 2026 00:00:02 GMT'}, 2000],
        [429, {'retry-after-ms': '250', 'retry-after': '90'}, 250],
        [503, {'retry-after': '2'}, 2000],
        [503, {'retry-after-ms': '125', 'retry-after': '90'}, 125],
        [503, {'retry-after-ms': 'invalid', 'retry-after': '2'}, 2000],
    ])('gates fresh calls and locked SDK retries on HTTP %s headers %j', async (status, headers, delay) => {
        harness(); const attempts: number[] = []; const start = Date.now();
        setRuntimeFetch(async input => {
            if (String(input) !== 'https://quota-a.test/v1/chat/completions') throw new Error('Unmatched network');
            attempts.push(Date.now() - start);
            return response(attempts.length === 1 ? status : 200, headers as Record<string, string>);
        });
        const original = client('original alpha').catch(() => 'failed');
        await vi.advanceTimersByTimeAsync(5);
        const next = client('second alpha').catch(() => 'failed');
        await vi.advanceTimersByTimeAsync(delay - 6);
        expect(attempts).toEqual([0]);
        await vi.runAllTimersAsync();
        expect(await original).toBe('这是合成译文。'); expect(await next).toBe('这是合成译文。');
        expect(attempts).toHaveLength(3); expect(attempts.slice(1).every(at => at >= delay)).toBe(true);
    });

    it.each([
        [503, {}, 0], [503, {'retry-after': '-1'}, 0], [503, {'retry-after': 'junk'}, 0],
        [503, {'retry-after': 'Infinity'}, 0], [503, {'retry-after': '2junk'}, 0],
        [503, {'retry-after': '0'}, 0], [503, {'retry-after-ms': '0'}, 0],
        [503, {'retry-after': 'Wed, 31 Dec 2025 23:59:00 GMT'}, 0],
        [503, {'retry-after': '9999999999'}, 7 * 86_400_000],
        [429, {}, 2000], [429, {'retry-after': '-1'}, 2000],
        [429, {'retry-after-ms': 'NaN'}, 2000],
        [401, {'retry-after': '90'}, 0], [403, {'retry-after': '90'}, 0], [200, {'retry-after': '90'}, 0],
    ])('bounds or ignores malformed/extreme signals %s %j', async (status, headers, delay) => {
        const {scheduler} = harness(); const identity = {service: 'custom', quotaScope: 'synthetic-scope'};
        scheduler.observeResponse(identity, response(status, headers as Record<string, string>));
        let started = false;
        const task = scheduler.scheduleAttempt(async () => {started = true;}, {identity});
        await flush(); expect(started).toBe(delay === 0);
        if (delay) {await vi.advanceTimersByTimeAsync(delay - 1); expect(started).toBe(false);}
        await vi.runAllTimersAsync(); await task; expect(started).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([503, 429, 401, 403])('preserves SDK retry responsibility/count on repeated HTTP %s', async status => {
        harness(); let attempts = 0;
        setRuntimeFetch(async input => {
            if (String(input) !== 'https://quota-a.test/v1/chat/completions') throw new Error('Unmatched network');
            attempts += 1;
            return response(status, status === 429 ? {'retry-after': '2'} : {});
        });
        const outcome = client('repeated error alpha').then(() => 'success', () => 'error');
        await vi.runAllTimersAsync(); expect(await outcome).toBe('error');
        expect(attempts).toBe(status === 401 || status === 403 ? 1 : 3);
    });

    it('stops over-deadline requests and cancels queued cooldown work without late dispatch', async () => {
        const {writes} = harness(); let attempts = 0;
        setRuntimeFetch(async input => {
            if (String(input) !== 'https://quota-a.test/v1/chat/completions') throw new Error('Unmatched network');
            attempts += 1; return response(429, {'retry-after': '90'});
        });
        const first = client('short deadline alpha', 'custom', 4000).then(() => 'success', () => 'error');
        await vi.advanceTimersByTimeAsync(10);
        const controller = new AbortController();
        const cancelled = client('cancelled queue alpha', 'custom', 125_000, controller.signal).then(() => 'success', () => 'cancelled');
        const short = client('queued short deadline alpha', 'custom', 4000).then(() => 'success', () => 'error');
        await vi.advanceTimersByTimeAsync(20); controller.abort();
        expect(await cancelled).toBe('cancelled');
        await vi.advanceTimersByTimeAsync(4000);
        expect(await first).toBe('error'); expect(await short).toBe('error'); expect(attempts).toBe(1);
        await vi.runAllTimersAsync(); expect(attempts).toBe(1); expect(writes).toEqual([]);
        setRuntimeFetch(async () => {attempts += 1; return response();});
        const afterExpiry = client('fresh after expiry alpha');
        await vi.runAllTimersAsync(); expect(await afterExpiry).toBe('这是合成译文。'); expect(attempts).toBe(2);
    });

    it.each(['private', 'endpoint', 'model', 'credential', 'header'])('separates trusted quota identity after %s changes', async change => {
        const {fallback, scheduler} = harness(); state.config.translationMaxRetries = 0;
        const observed = vi.spyOn(scheduler, 'observeResponse'); let attempts = 0;
        setRuntimeFetch(async input => {
            if (!['https://quota-a.test/v1/chat/completions', 'https://quota-c.test/v1/chat/completions'].includes(String(input))) throw new Error('Unmatched network');
            attempts += 1; return response(attempts === 1 ? 429 : 200, {'retry-after': '90'});
        });
        const first = client('first ordinary alpha').catch(() => 'error');
        await vi.advanceTimersByTimeAsync(10); expect(await first).toBe('error');
        if (change === 'endpoint') state.config.custom = 'https://quota-c.test/v1';
        if (change === 'model') state.config.model.custom = 'other-fixture-model';
        if (change === 'credential') state.config.token.custom = 'other-fixture-credential';
        if (change === 'header') (state.config.customHeaders as Record<string, string>).custom = '{"X-Synthetic-Quota":"other"}';
        const next = fallback.handle({origin: 'next alpha', useCache: false, requestTimeoutMs: 1000} as never,
            {sender: {tab: {id: 2, incognito: change === 'private'}}});
        await vi.advanceTimersByTimeAsync(10); expect(attempts).toBe(2); expect(await next).toBe('这是合成译文。');
        const scopes = observed.mock.calls.map(x => x[0]?.quotaScope);
        expect(scopes[0]).toMatch(/^[a-f0-9]{64}$/u); expect(scopes[1]).not.toBe(scopes[0]);
        expect(JSON.stringify(observed.mock.calls.map(x => x[0]))).not.toContain('fixture-credential');
        expect(JSON.stringify(observed.mock.calls.map(x => x[0]))).not.toContain('fixture-a');
    });

    it('rejects page-supplied quota/privacy fields while preserving trusted sender isolation', async () => {
        const {fallback} = harness(); state.config.translationMaxRetries = 0; let attempts = 0;
        setRuntimeFetch(async () => {attempts += 1; return response(attempts === 1 ? 429 : 200, {'retry-after': '90'});});
        const first = client('ordinary quota alpha').catch(() => undefined);
        await vi.advanceTimersByTimeAsync(10); await first;
        const forged = fallback.handle({origin: 'forged alpha', quotaScope: 'fresh', privateContext: true, requestTimeoutMs: 1000} as never,
            {sender: {tab: {id: 1, incognito: false}}});
        await vi.advanceTimersByTimeAsync(1100); await forged; expect(attempts).toBe(1);
        const privateCall = fallback.handle({origin: 'real private alpha', requestTimeoutMs: 1000} as never,
            {sender: {tab: {id: 2, incognito: true}}});
        await vi.advanceTimersByTimeAsync(10); expect(await privateCall).toBe('这是合成译文。'); expect(attempts).toBe(2);
    });

    it('keeps the outer lease until a cancelled real transport actually settles', async () => {
        const {broker, writes} = harness(); state.config.maxConcurrentTranslations = 1; state.config.translationMaxRetries = 0;
        let settle!: (response: Response) => void; let attempts = 0;
        setRuntimeFetch(async () => {
            attempts += 1;
            return attempts === 1 ? new Promise<Response>(resolve => {settle = resolve;}) : response();
        });
        const controller = new AbortController();
        const first = broker.translateWithCache(attachTranslationRequestControl({origin: 'cancel in flight alpha', useCache: true, requestTimeoutMs: 5000},
            {signal: controller.signal, ownershipKey: 'synthetic-owner'})).catch(() => 'cancelled');
        await vi.advanceTimersByTimeAsync(10); controller.abort(); expect(await first).toBe('cancelled');
        const second = client('healthy queued beta', 'newapi');
        await vi.advanceTimersByTimeAsync(100); expect(attempts).toBe(1);
        settle(response()); await vi.runAllTimersAsync();
        expect(await second).toBe('这是合成译文。'); expect(attempts).toBe(2); expect(writes).toEqual([]);
    });

    it('uses a small real timer integration through the locked SDK and shared scheduler', async () => {
        vi.useRealTimers(); harness(); let attempts = 0; const started: number[] = [];
        setRuntimeFetch(async () => {
            started.push(Date.now()); attempts += 1;
            return response(attempts === 1 ? 429 : 200, {'retry-after-ms': '30'});
        });
        expect(await client('real timer integration alpha')).toBe('这是合成译文。');
        expect(attempts).toBe(2); expect(started[1]! - started[0]!).toBeGreaterThanOrEqual(25);
    });
});
