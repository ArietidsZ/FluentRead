import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    config: {on: true, harness: {enabled: true}, disabledExtensionDomains: ['blocked']},
    ready: Promise.resolve(), subscribe: vi.fn(), createHandler: vi.fn(), createRuntime: vi.fn(),
    handler: {handle: vi.fn(), cancelAll: vi.fn(), cancelDisallowed: vi.fn(), cancelTab: vi.fn()},
    runtime: {run: vi.fn()}, removed: vi.fn(), updated: vi.fn(), record: vi.fn(), generation: vi.fn(() => 9),
}));
vi.mock('webextension-polyfill', () => ({default: {runtime: {id: 'extension'}, tabs: {onRemoved: {addListener: mocks.removed}, onUpdated: {addListener: mocks.updated}}}}));
vi.mock('@/src/services/config/store', () => ({config: mocks.config, configReady: mocks.ready, subscribeConfig: mocks.subscribe}));
vi.mock('@/src/features/reading-assistant/background', () => ({createReadingAssistantHandler: mocks.createHandler}));
vi.mock('@/src/services/harness/runtime', () => ({createHarnessRuntime: mocks.createRuntime}));
vi.mock('@/src/core/site-rules/domain', () => ({isExtensionDisabledOnSite: (url: string) => url.includes('blocked')}));
vi.mock('@/src/platform/storage/modelUsageRepository', () => ({modelUsageRepository: {recordMany: mocks.record, captureGeneration: mocks.generation}}));

import {installHarnessBackgroundRuntime} from '@/src/app/background/harnessRuntime';

describe('Harness background composition', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.config.on = true;
        mocks.config.harness.enabled = true;
        mocks.createHandler.mockReturnValue(mocks.handler);
        mocks.createRuntime.mockReturnValue(mocks.runtime);
        mocks.record.mockResolvedValue(1);
    });
    it('binds configuration, owner eligibility, navigation and generation-scoped usage', async () => {
        const router = installHarnessBackgroundRuntime();
        expect(router.type).toBe('fluentReadHarness');
        const [getConfig, createSink] = mocks.createRuntime.mock.calls[0];
        expect(getConfig()).toBe(mocks.config);
        const sink = createSink();
        const event = {purpose: 'reading'};
        sink(event);
        expect(mocks.record).toHaveBeenCalledWith([event], 9);
        mocks.record.mockRejectedValueOnce(new Error('storage unavailable'));
        sink(event);
        await Promise.resolve();

        const dependencies = mocks.createHandler.mock.calls[0][0];
        expect(dependencies).toMatchObject({extensionId: 'extension', ready: mocks.ready});
        expect(dependencies.eligibility({})).toBeUndefined();
        expect(dependencies.eligibility({url: 'https://allowed.test', tab: {url: 'https://allowed.test'}})).toBeUndefined();
        expect(dependencies.eligibility({url: 'https://blocked.test'})).toContain('禁用');
        expect(dependencies.eligibility({tab: {url: 'https://blocked.test'}})).toContain('禁用');
        mocks.config.on = false;
        expect(dependencies.eligibility({})).toContain('停用');
        mocks.config.on = true;
        mocks.config.harness.enabled = false;
        expect(dependencies.eligibility({})).toContain('停用');
        const signal = new AbortController().signal;
        dependencies.run('request', signal);
        expect(mocks.runtime.run).toHaveBeenCalledWith('request', signal);

        const changed = mocks.subscribe.mock.calls[0][0];
        changed({harness: {enabled: true}});
        expect(mocks.handler.cancelAll).not.toHaveBeenCalled();
        changed({harness: {enabled: false}});
        expect(mocks.handler.cancelAll).toHaveBeenCalledOnce();
        expect(mocks.handler.cancelDisallowed).toHaveBeenCalledTimes(2);
        mocks.removed.mock.calls[0][0](7);
        const updated = mocks.updated.mock.calls[0][0];
        updated(8, {status: 'loading'});
        updated(9, {url: 'https://new.test'});
        updated(10, {status: 'complete'});
        expect(mocks.handler.cancelTab.mock.calls).toEqual([[7], [8], [9]]);
        await router.handle({type: 'a'}, {sender: {id: 'extension'}});
        await router.handle({type: 'b'}, {});
        expect(mocks.handler.handle.mock.calls).toEqual([[{type: 'a'}, {id: 'extension'}], [{type: 'b'}, {}]]);
    });
});
