import {describe, expect, it, vi} from 'vitest';

import {createFrameSessionController, isFrameTranslationState, type FrameTranslationState} from '@/src/features/full-page-translation/content/frameSession';

const config = {service: 'freeTranslation', model: '', thinking: false, sourceLanguage: 'en', targetLanguage: 'zh-CN', useCache: true, enableAIContext: false, enableAIMultiSegment: false, displayMode: 'bilingual' as const, style: 0, profileId: 'default', requestOverridesApplied: true as const};
const state = (overrides: Partial<FrameTranslationState> = {}): FrameTranslationState => ({enabled: true, revision: 1, sessionId: 1, translationConfig: config, fullPageMode: 'all', ...overrides});
const deferred = <T>() => {let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void; const promise = new Promise<T>((r, j) => {resolve = r; reject = j;}); return {promise, resolve, reject};};

describe('QQ mail frame session snapshots', () => {
    it('accepts valid single/bilingual snapshots and optional fields', () => {
        expect(isFrameTranslationState(state())).toBe(true);
        expect(isFrameTranslationState(state({translationConfig: {...config, displayMode: 'single', profileId: undefined, requestOverridesApplied: undefined}, fullPageMode: 'viewport'}))).toBe(true);
    });

    it('validates glossary versions and bounded selections before sharing a full-page session', () => {
        for (const glossaryIds of [null, [], ['technical']]) {
            expect(isFrameTranslationState(state({translationConfig: {...config, glossaryIds, glossaryRevision: 'glossary-v1:disabled'}}))).toBe(true);
        }
        for (const glossaryRevision of [1, 'forged']) {
            expect(isFrameTranslationState(state({translationConfig: {...config, glossaryRevision} as never}))).toBe(false);
        }
        for (const glossaryIds of ['all', Array(101).fill('a'), [1], ['a'.repeat(129)], new Array(1)]) {
            expect(isFrameTranslationState(state({translationConfig: {...config, glossaryIds} as never}))).toBe(false);
        }
    });

    it.each([
        null, {}, {enabled: 'yes', revision: 1, sessionId: null}, {enabled: true, revision: -1, sessionId: null},
        {enabled: true, revision: 1.2, sessionId: null}, {enabled: true, revision: 1, sessionId: 0}, {enabled: true, revision: 1, sessionId: '1'},
        {...state(), fullPageMode: 'bad'}, {...state(), translationConfig: undefined}, {...state(), translationConfig: {...config, service: 1}},
        {...state(), translationConfig: {...config, thinking: 'false'}}, {...state(), translationConfig: {...config, displayMode: 'bad'}},
        {...state(), translationConfig: {...config, style: Infinity}}, {...state(), translationConfig: {...config, profileId: 4}},
        {...state(), translationConfig: {...config, requestOverridesApplied: false}},
    ])('rejects malformed snapshot %#', value => expect(isFrameTranslationState(value)).toBe(false));

    it('starts once, marks availability, and ignores repeated state', async () => {
        const deps = {readState: vi.fn(async () => state()), isEnabled: vi.fn(() => true), setAvailable: vi.fn(), start: vi.fn(), restore: vi.fn()};
        const controller = createFrameSessionController(deps); await controller.refresh(); await controller.refresh();
        expect(deps.setAvailable).toHaveBeenCalledWith(true); expect(deps.start).toHaveBeenCalledTimes(1); expect(deps.restore).toHaveBeenCalledTimes(1);
    });

    it('restores and starts a new session or revision, and clears disabled/bad/rejected reads', async () => {
        let next: unknown = state(); const deps = {readState: vi.fn(async () => next), isEnabled: vi.fn(() => true), setAvailable: vi.fn(), start: vi.fn(), restore: vi.fn()}; const c = createFrameSessionController(deps);
        await c.refresh(); next = state({revision: 2}); await c.refresh(); expect(deps.start).toHaveBeenCalledTimes(2);
        next = {...state({sessionId: null, revision: 3})}; await c.refresh(); expect(deps.restore).toHaveBeenCalledTimes(3);
        next = null; await c.refresh(); expect(deps.setAvailable).toHaveBeenLastCalledWith(false); expect(deps.restore).toHaveBeenCalledTimes(4);
        next = state(); deps.isEnabled.mockReturnValue(false); await c.refresh(); expect(deps.restore).toHaveBeenCalledTimes(5);
        deps.readState.mockRejectedValueOnce(new Error('gone')); deps.isEnabled.mockReturnValue(true); await c.refresh(); expect(deps.restore).toHaveBeenCalledTimes(6);
    });

    it('lets the newest refresh win and prevents pending work after suspend/dispose', async () => {
        const first = deferred<unknown>(); const second = deferred<unknown>(); const deps = {readState: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise), isEnabled: vi.fn(() => true), setAvailable: vi.fn(), start: vi.fn(), restore: vi.fn()}; const c = createFrameSessionController(deps);
        const a = c.refresh(); const b = c.refresh(); first.resolve(state({revision: 1})); second.resolve(state({revision: 2})); await Promise.all([a, b]); expect(deps.start).toHaveBeenCalledTimes(1); expect(deps.start).toHaveBeenCalledWith(expect.objectContaining({revision: 2}));
        const pending = deferred<unknown>(); deps.readState.mockReturnValueOnce(pending.promise); const stale = c.refresh(); c.suspend(); pending.resolve(state({revision: 9})); await stale; expect(deps.start).toHaveBeenCalledTimes(1);
        const disposed = deferred<unknown>(); deps.readState.mockReturnValueOnce(disposed.promise); const late = c.refresh(); c.dispose(); disposed.resolve(state({revision: 10})); await late; expect(deps.setAvailable).toHaveBeenLastCalledWith(false);
        await c.refresh(); expect(deps.readState).toHaveBeenCalledTimes(4);
    });
});
