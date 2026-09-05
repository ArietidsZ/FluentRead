import {describe, expect, it, vi} from 'vitest';
import {createVideoSubtitleBackgroundHandlers, releaseVideoSubtitleOwnerForTab} from '@/src/features/video-subtitle/background/handlers';

function setup(response: unknown = {success: true, backend: 'wasm'}) {
    const offscreen = {
        hasDocument: vi.fn(async () => true),
        ensureDocument: vi.fn(async () => undefined),
        send: vi.fn(async <TResponse>() => response as TResponse),
        sendIfPresent: vi.fn(async <TResponse>() => ({success: true} as TResponse)),
    };
    const offscreenClient = offscreen as unknown as import('@/src/platform/offscreen/client').OffscreenClient;
    const storage = {get: vi.fn(async () => ({fluentReadVideoLocalTranscriptionModels: []})), set: vi.fn(async () => undefined)};
    const handlers = createVideoSubtitleBackgroundHandlers({offscreen: offscreenClient, storage});
    return {offscreen, storage, handlers};
}
const context = (id: number) => ({sender: {tab: {id}}});
const find = (handlers: readonly {type: string; handle: Function}[], type: string) => handlers.find((item) => item.type === type)!;

describe('video subtitle background ownership', () => {
    it('cache prepare does not require stream/generation', async () => {
        const {handlers, storage} = setup();
        const result = await find(handlers, 'fluentReadPrepareLocalVideoModel').handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: false}, context(1));
        expect(result.success).toBe(true);
        expect(storage.set).toHaveBeenCalledTimes(1);
    });
    it('returns normalized downloaded model state through a background-only query', async () => {
        const {handlers} = setup();
        const result = await find(handlers, 'fluentReadGetLocalVideoModelState').handle({type: 'fluentReadGetLocalVideoModelState'}, context(1));
        expect(result).toEqual({success: true, models: [], available: {tiny: false, base: false}});
    });

    it('serializes concurrent cache writes so Tiny and Base state are merged', async () => {
        const stored: Record<string, unknown> = {fluentReadVideoLocalTranscriptionModels: []};
        const offscreen = {
            send: vi.fn(async () => ({success: true})),
            sendIfPresent: vi.fn(async () => ({success: true})),
        } as any;
        const storage = {
            get: vi.fn(async () => ({...stored})),
            set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(stored, value); }),
        };
        const handlers = createVideoSubtitleBackgroundHandlers({offscreen, storage});
        const prepare = find(handlers, 'fluentReadPrepareLocalVideoModel');
        const [tiny, base] = await Promise.all([
            prepare.handle({model: 'tiny'}, context(1)),
            prepare.handle({model: 'base'}, context(1)),
        ]);
        expect(tiny.models).toEqual(['tiny']);
        expect(base.models).toEqual(['tiny', 'base']);
        expect(stored.fluentReadVideoLocalTranscriptionModels).toEqual(['tiny', 'base']);
    });
    it('does not mark failed prepare as downloaded', async () => {
        const {handlers, storage} = setup({success: false, error: 'failed'});
        const result = await find(handlers, 'fluentReadPrepareLocalVideoModel').handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny'}, context(1));
        expect(result.success).toBe(false);
        expect(storage.set).not.toHaveBeenCalled();
    });
    it('rejects another tab while an owner is warm', async () => {
        const {handlers} = setup();
        const prepare = find(handlers, 'fluentReadPrepareLocalVideoModel');
        await prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true, streamId: 's', generation: 1}, context(1));
        await expect(prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true, streamId: 's2', generation: 1}, context(2))).rejects.toThrow('另一个标签页');
    });
    it('cancellation uses sendIfPresent and releases the matching generation', async () => {
        const {handlers, offscreen} = setup();
        const prepare = find(handlers, 'fluentReadPrepareLocalVideoModel');
        const cancel = find(handlers, 'fluentReadCancelLocalVideoTranscription');
        await prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true, streamId: 's', generation: 1}, context(1));
        await cancel.handle({type: 'fluentReadCancelLocalVideoTranscription', streamId: 's', generation: 1}, context(1));
        expect(offscreen.sendIfPresent).toHaveBeenCalled();
    });
    it('tab release cancels the owner and allows another tab to acquire it', async () => {
        const {handlers, offscreen} = setup();
        const prepare = find(handlers, 'fluentReadPrepareLocalVideoModel');
        await prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true, streamId: 's', generation: 1}, context(1));
        releaseVideoSubtitleOwnerForTab(1);
        await expect(prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true, streamId: 's2', generation: 1}, context(2))).resolves.toMatchObject({success: true});
        expect(offscreen.sendIfPresent).toHaveBeenCalled();
    });
    it('rejects malformed warm and cancel messages', async () => {
        const {handlers} = setup();
        const prepare = find(handlers, 'fluentReadPrepareLocalVideoModel');
        const cancel = find(handlers, 'fluentReadCancelLocalVideoTranscription');
        await expect(prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true}, context(1))).rejects.toThrow('缺少流标识');
        await expect(cancel.handle({type: 'fluentReadCancelLocalVideoTranscription', streamId: '', generation: 1}, context(1))).rejects.toThrow('缺少流标识');
    });
    it('forwards successful transcription and cancels the previous generation', async () => {
        const {handlers, offscreen} = setup({success: true, text: 'ok', segments: []});
        const transcribe = find(handlers, 'fluentReadTranscribeLocalVideoAudio');
        const first = await transcribe.handle({type: 'fluentReadTranscribeLocalVideoAudio', streamId: 's', generation: 1, audioPcm16Base64: 'AAAAAA=='}, context(1));
        expect(first).toMatchObject({success: true, text: 'ok'});
        const second = await transcribe.handle({type: 'fluentReadTranscribeLocalVideoAudio', streamId: 's', generation: 2, audioPcm16Base64: 'AAAAAA=='}, context(1));
        expect(second.success).toBe(true);
        expect(offscreen.sendIfPresent).toHaveBeenCalled();
    });
    it('rejects cancelled and conflicting generations without touching Offscreen', async () => {
        const {handlers, offscreen} = setup();
        const prepare = find(handlers, 'fluentReadPrepareLocalVideoModel');
        const cancel = find(handlers, 'fluentReadCancelLocalVideoTranscription');
        await prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true, streamId: 's', generation: 1}, context(1));
        await cancel.handle({type: 'fluentReadCancelLocalVideoTranscription', streamId: 's', generation: 1}, context(1));
        const calls = offscreen.sendIfPresent.mock.calls.length;
        await expect(prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true, streamId: 's', generation: 1}, context(1))).rejects.toThrow('已取消');
        await expect(prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true, streamId: 'other', generation: 1}, context(2))).resolves.toMatchObject({success: true});
        releaseVideoSubtitleOwnerForTab(999);
        expect(offscreen.sendIfPresent.mock.calls.length).toBeGreaterThanOrEqual(calls);
    });
    it('ignores a stale cancel so it cannot terminate a newer generation', async () => {
        const {handlers, offscreen} = setup();
        const prepare = find(handlers, 'fluentReadPrepareLocalVideoModel');
        const cancel = find(handlers, 'fluentReadCancelLocalVideoTranscription');
        await prepare.handle({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny', keepWarm: true, streamId: 's', generation: 2}, context(1));
        offscreen.sendIfPresent.mockClear();
        const result = await cancel.handle({type: 'fluentReadCancelLocalVideoTranscription', streamId: 's', generation: 1}, context(1));
        expect(result).toMatchObject({success: true, stale: true});
        expect(offscreen.sendIfPresent).not.toHaveBeenCalled();
        await cancel.handle({type: 'fluentReadCancelLocalVideoTranscription', streamId: 's', generation: 2}, context(1));
    });
});
