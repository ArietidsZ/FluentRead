import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    captureGeneration: vi.fn(() => 11),
    recordMany: vi.fn(async (_events: unknown, _generation: number) => 1),
    resolveConfiguredModel: vi.fn((_selected?: string, _custom?: string) => 'resolved-model'),
    runConnectionTest: vi.fn(async (_service: string, _options: any) => ({durationMs: 25})),
    resolveVisionProbe: vi.fn(async () => ({capability: 'supported' as const, source: 'probe' as const, checkedAt: 1})),
    getFreeTranslationWeightSnapshot: vi.fn(async () => ({total: 100, observedAt: 1, entries: []})),
}));

vi.mock('@/src/app/translation/visionProbeRuntime', () => ({modelVisionProbe: {resolve: mocks.resolveVisionProbe}}));

vi.mock('@/src/providers/translation/connectionTest', () => ({
    formatConnectionTestError: vi.fn(),
    runTranslationServiceConnectionTest: mocks.runConnectionTest,
}));
vi.mock('@/src/providers/translation/free-translation', () => ({
    getFreeTranslationWeightSnapshot: mocks.getFreeTranslationWeightSnapshot,
}));
vi.mock('@/src/app/translation/runtime', () => ({
    translateWithCache: vi.fn(async () => 'UNKNOWN'),
    translationRequestScheduler: {
        schedule: vi.fn(async (task: (lease: any) => Promise<unknown>) => task({holdUntil: vi.fn()})),
    },
}));
vi.mock('@/src/services/translation/broker', () => ({
    resolveTranslationRequestModel: vi.fn(() => 'resolved-model'),
}));
vi.mock('@/src/services/config/store', () => ({
    configReady: Promise.resolve(),
    config: {
        model: {moonshot: 'kimi-k2.6'},
        customModel: {moonshot: ''},
    },
}));
vi.mock('@/src/core/config/catalog', () => ({
    resolveConfiguredModel: mocks.resolveConfiguredModel,
    servicesType: {isAiSdk: vi.fn(() => false)},
}));
vi.mock('@/src/platform/storage/modelUsageRepository', () => ({
    modelUsageRepository: {
        captureGeneration: mocks.captureGeneration,
        recordMany: mocks.recordMany,
    },
}));

import {createProviderTestRuntimeHandlers, getFreeTranslationWeightSnapshot, runTranslationServiceConnectionTestWithUsage} from '@/src/app/background/providerRuntime';

import {config} from '@/src/services/config/store';
import {freezeVisionProbeConfig} from '@/src/services/translation/visionProbe';
import {createVisionProbeIdentity} from '@/src/core/config/visionProbe';
import {createVisionProbeHandlers, VISION_PROBE_MESSAGE, VISION_PROBE_CANCEL_MESSAGE} from '@/src/app/background/handlers/visionProbe';

afterEach(() => vi.unstubAllGlobals());

describe('background provider runtime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('wires real provider handlers and restricts vision probes to the exact settings page', async () => {
        const settingsUrl = 'chrome-extension://fixture/options.html';
        vi.stubGlobal('browser', {runtime: {getURL: (path: string) => `chrome-extension://fixture${path}`}});
        const handlers = createProviderTestRuntimeHandlers();
        expect(handlers.map(handler => handler.type)).toEqual(['testTranslationService', VISION_PROBE_MESSAGE, VISION_PROBE_CANCEL_MESSAGE]);
        const connection = handlers.find(handler => handler.type === 'testTranslationService')!;
        await expect(connection.handle({type: 'testTranslationService', service: 'moonshot'}, {}))
            .resolves.toEqual({success: true, durationMs: 25});
        expect(mocks.runConnectionTest).toHaveBeenCalledOnce();
        const vision = handlers.find(handler => handler.type === VISION_PROBE_MESSAGE)! as ReturnType<typeof createVisionProbeHandlers>[number];
        const message = {type: VISION_PROBE_MESSAGE, service: 'moonshot', model: 'kimi-k2.6',
            identity: createVisionProbeIdentity(freezeVisionProbeConfig(config), 'moonshot', 'kimi-k2.6'), requestId: 'composition-vision'};
        await expect(vision.handle(message, {sender: {url: `${settingsUrl}?tab=models#vision`}}))
            .resolves.toEqual({success: true, capability: 'supported', source: 'probe', checkedAt: 1});
        expect(mocks.resolveVisionProbe).toHaveBeenCalledWith(expect.objectContaining({model: {moonshot: 'kimi-k2.6'}}),
            'moonshot', 'kimi-k2.6', expect.objectContaining({force: true, signal: expect.any(AbortSignal)}));
        await expect(vision.handle(message, {sender: {url: `${settingsUrl}/elsewhere`}})).rejects.toThrow('识图检测仅可从设置页执行');
        expect(mocks.resolveVisionProbe).toHaveBeenCalledOnce();
    });

    it('captures reset generation before connection test and injects model usage persistence', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const events = [{serviceId: 'moonshot'}] as never;

        await expect(runTranslationServiceConnectionTestWithUsage('moonshot'))
            .resolves.toEqual({durationMs: 25});

        expect(mocks.captureGeneration).toHaveBeenCalledOnce();
        const options = mocks.runConnectionTest.mock.calls[0][1];
        expect(options.configuredModel).toBe('resolved-model');
        await options.recordModelUsage(events);
        expect(mocks.recordMany).toHaveBeenCalledWith(events, 11);

        const failure = new Error('usage write failed');
        options.warn('usage warning', failure);
        expect(warn).toHaveBeenCalledWith('usage warning', failure);
        warn.mockRestore();
    });

    it('exposes the provider-owned free translation weight snapshot through the composition root', async () => {
        await expect(getFreeTranslationWeightSnapshot()).resolves.toEqual({total: 100, observedAt: 1, entries: []});
        expect(mocks.getFreeTranslationWeightSnapshot).toHaveBeenCalledOnce();
    });
});
