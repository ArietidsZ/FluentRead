import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    captureGeneration: vi.fn(() => 11),
    createConnection: vi.fn((_options: any) => ({type: 'connection-fixture'})),
    createVision: vi.fn((_options: any) => [{type: 'vision-fixture'}]),
    visionResolve: vi.fn(),
    recordMany: vi.fn(async (_events: unknown, _generation: number) => 1),
    resolveConfiguredModel: vi.fn((_selected?: string, _custom?: string) => 'resolved-model'),
    runConnectionTest: vi.fn(async (_service: string, _options: any) => ({durationMs: 25})),
    getFreeTranslationWeightSnapshot: vi.fn(async () => ({total: 100, observedAt: 1, entries: []})),
}));

vi.mock('@/src/app/background/handlers/connectionTest', () => ({createConnectionTestHandler: mocks.createConnection}));
vi.mock('@/src/app/background/handlers/visionProbe', () => ({createVisionProbeHandlers: mocks.createVision}));
vi.mock('@/src/app/translation/visionProbeRuntime', () => ({modelVisionProbe: {resolve: mocks.visionResolve}}));
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

afterEach(() => vi.unstubAllGlobals());

describe('background provider runtime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('wires settings-only vision handlers and shared connection dependencies through the app facade', () => {
        vi.stubGlobal('browser', {runtime: {getURL: (path: string) => `chrome-extension://fixture${path}`}});
        expect(createProviderTestRuntimeHandlers()).toEqual([{type: 'connection-fixture'}, {type: 'vision-fixture'}]);
        const connection = mocks.createConnection.mock.calls[0][0];
        expect(connection.runConnectionTest).toBe(runTranslationServiceConnectionTestWithUsage);
        expect(connection.ready).toBeInstanceOf(Promise);
        const vision = mocks.createVision.mock.calls[0][0];
        expect(vision.ready).toBe(connection.ready);
        expect(vision.getConfig().model.moonshot).toBe('kimi-k2.6');
        expect(vision.resolve).toBe(mocks.visionResolve);
        expect(vision.isSettingsUrl('chrome-extension://fixture/options.html?section=services#model')).toBe(true);
        expect(vision.isSettingsUrl('https://host.test/options.html')).toBe(false);
        expect(vision.isSettingsUrl('chrome-extension://fixture/popup.html')).toBe(false);
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
