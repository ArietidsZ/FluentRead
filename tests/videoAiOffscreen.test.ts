import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const budgetMocks = vi.hoisted(() => ({run: vi.fn()}));
vi.mock('@/src/shared/onnx/resources', async original => ({
    ...await original<typeof import('@/src/shared/onnx/resources')>(),
    withLocalInferenceBudget: budgetMocks.run,
}));
import {createLocalInferenceBudget} from '@/src/shared/onnx/resources';
import {removeLocalVideoTranscriptionModel, cancelLocalVideoTranscription, prepareLocalVideoTranscriptionModel, transcribeLocalVideoAudio} from '@/src/features/video-subtitle/offscreen/transcription';

class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminated = false;
    messages: any[] = [];
    constructor() { FakeWorker.instances.push(this); }
    postMessage(message: any, transfer: Transferable[] = []): void {
        (this as any).lastMessage = transfer.length
            ? structuredClone(message, {transfer})
            : structuredClone(message);
        this.messages.push((this as any).lastMessage);
    }
    terminate(): void { this.terminated = true; }
    reply(response: Record<string, unknown>): void { this.onmessage?.({data: response} as MessageEvent); }
    fail(message = 'worker failed'): void { this.onerror?.({message} as ErrorEvent); }
}

beforeEach(() => {
    // 保留真实预算的排队和释放语义，用单槽位模拟其他本地推理占满共享预算。
    budgetMocks.run.mockReset().mockImplementation(createLocalInferenceBudget(1));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllTimers();
    vi.useRealTimers();
    FakeWorker.instances = [];
});

function installWorker(): void {
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('window', {location: {href: 'chrome-extension://test/offscreen.html'}, setTimeout, clearTimeout});
}
const audio = 'AAAAAA==';
const tick = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };
const drain = async (): Promise<void> => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => {resolve = done;});
    return {promise, resolve};
};

function requestVideoWorker(kind: 'transcribe' | 'prepare', streamId: string, model: 'tiny' | 'base' = 'tiny') {
    return kind === 'transcribe'
        ? transcribeLocalVideoAudio({streamId, audioPcm16Base64: audio, model})
        : prepareLocalVideoTranscriptionModel(model, {keepWarm: true, streamId});
}

function completeWorker(worker: FakeWorker, model: 'tiny' | 'base' = 'tiny'): void {
    worker.reply({requestId: worker.messages.at(-1).requestId, success: true, text: 'budget result', segments: [], model, backend: 'wasm'});
}

describe('video AI offscreen queue', () => {
    it('reuses one worker and resolves a successful transcription', async () => {
        installWorker();
        const pending = transcribeLocalVideoAudio({streamId: 's', audioPcm16Base64: audio, model: 'tiny'});
        await tick();
        expect(FakeWorker.instances).toHaveLength(1);
        const worker = FakeWorker.instances[0];
        expect((worker as any).lastMessage.languageSessionKey).toBe('s');
        const requestId = (worker as any).lastMessage.requestId;
        worker.reply({requestId, success: true, text: 'hello', segments: [{startMs: 0, endMs: 500, text: 'hello'}], model: 'tiny', inferenceMs: 10});
        await expect(pending).resolves.toMatchObject({text: 'hello', model: 'tiny'});
        const second = transcribeLocalVideoAudio({streamId: 's', audioPcm16Base64: audio, model: 'tiny'});
        await tick();
        expect(FakeWorker.instances).toHaveLength(1);
        FakeWorker.instances[0].reply({requestId: (FakeWorker.instances[0] as any).lastMessage.requestId, success: true, text: '', segments: [], model: 'tiny'});
        await second;
        await cancelLocalVideoTranscription('s');
    });
    it('cancel rejects active work and terminates only the worker', async () => {
        installWorker();
        const pending = transcribeLocalVideoAudio({streamId: 'cancel-me', audioPcm16Base64: audio, model: 'tiny'});
        await tick();
        await cancelLocalVideoTranscription('cancel-me');
        await expect(pending).rejects.toThrow('取消');
        expect(FakeWorker.instances[0].terminated).toBe(true);
    });
    it('new pending work replaces stale pending work with skipped result', async () => {
        installWorker();
        const first = transcribeLocalVideoAudio({streamId: 'queue', audioPcm16Base64: audio, model: 'tiny'});
        await tick();
        const second = transcribeLocalVideoAudio({streamId: 'queue', audioPcm16Base64: audio, model: 'tiny'});
        const third = transcribeLocalVideoAudio({streamId: 'queue', audioPcm16Base64: audio, model: 'tiny'});
        await expect(second).resolves.toMatchObject({skipped: true});
        await cancelLocalVideoTranscription('queue');
        await expect(first).rejects.toThrow('取消');
        await expect(third).resolves.toMatchObject({skipped: true});
    });
    it('rejects another stream while one stream is active', async () => {
        installWorker();
        const first = transcribeLocalVideoAudio({streamId: 'one', audioPcm16Base64: audio, model: 'tiny'});
        await tick();
        await expect(transcribeLocalVideoAudio({streamId: 'two', audioPcm16Base64: audio, model: 'tiny'})).rejects.toThrow('另一个标签页');
        await cancelLocalVideoTranscription('one');
        await expect(first).rejects.toThrow('取消');
    });
    it('deduplicates prepare requests by model and stream', async () => {
        installWorker();
        const first = prepareLocalVideoTranscriptionModel('tiny', {keepWarm: true, streamId: 'warm'});
        const second = prepareLocalVideoTranscriptionModel('tiny', {keepWarm: true, streamId: 'warm'});
        await tick();
        expect(first).toBe(second);
        const worker = FakeWorker.instances[0];
        worker.reply({requestId: (worker as any).lastMessage.requestId, success: true, model: 'tiny', backend: 'wasm', dtype: 'q4'});
        await expect(first).resolves.toMatchObject({model: 'tiny', backend: 'wasm'});
        await cancelLocalVideoTranscription('warm');
    });

    it('rebuilds a WASM worker once after a worker failure and ignores the stale worker error', async () => {
        installWorker();
        const pending = transcribeLocalVideoAudio({streamId: 'fallback', audioPcm16Base64: audio, model: 'tiny'});
        await tick();
        const first = FakeWorker.instances[0];
        first.fail('GPU worker failed');
        await tick();
        expect(FakeWorker.instances).toHaveLength(2);
        const replacement = FakeWorker.instances[1];
        expect((replacement as any).lastMessage.device).toBe('wasm');
        expect((replacement as any).lastMessage.audio.byteLength).toBeGreaterThan(0);
        first.fail('late stale error');
        replacement.reply({requestId: (replacement as any).lastMessage.requestId, success: true, text: 'cpu', segments: [], model: 'tiny', backend: 'wasm'});
        await expect(pending).resolves.toMatchObject({text: 'cpu', backend: 'wasm'});
        expect(replacement.terminated).toBe(false);
        await cancelLocalVideoTranscription('fallback');
    });

    it('reserves the remaining request budget for one WASM retry after timeout', async () => {
        vi.useFakeTimers();
        installWorker();
        const pending = transcribeLocalVideoAudio({streamId: 'timeout-fallback', audioPcm16Base64: audio, model: 'tiny'});
        await tick();
        vi.advanceTimersByTime(16_001);
        await tick();
        expect(FakeWorker.instances).toHaveLength(2);
        const replacement = FakeWorker.instances[1];
        expect((replacement as any).lastMessage.device).toBe('wasm');
        replacement.reply({requestId: (replacement as any).lastMessage.requestId, success: true, text: 'cpu-timeout', segments: [], model: 'tiny'});
        await expect(pending).resolves.toMatchObject({text: 'cpu-timeout'});
        await cancelLocalVideoTranscription('timeout-fallback');
    });

    it.each([undefined, 'GPU inference failed'])('retries explicit GPU fallback messages on a fresh worker (%s)', async (error) => {
        installWorker();
        const pending = transcribeLocalVideoAudio({streamId: 'gpu-message', audioPcm16Base64: audio, model: 'tiny'});
        await tick();
        const first = FakeWorker.instances[0];
        const firstMessage = (first as any).lastMessage;
        const originalAudio = Array.from(firstMessage.audio);
        first.reply({requestId: firstMessage.requestId, success: false, retryWithCpu: true, error});
        await tick();
        expect(first.terminated).toBe(true);
        expect(FakeWorker.instances).toHaveLength(2);
        const replacement = FakeWorker.instances[1];
        const retry = (replacement as any).lastMessage;
        expect(retry.device).toBe('wasm');
        expect(Array.from(retry.audio)).toEqual(originalAudio);
        first.reply({requestId: firstMessage.requestId, success: true, text: 'stale'});
        replacement.reply({requestId: retry.requestId, success: true, text: 'cpu', segments: [], model: 'tiny', backend: 'wasm'});
        await expect(pending).resolves.toMatchObject({text: 'cpu', backend: 'wasm'});
        await cancelLocalVideoTranscription('gpu-message');
    });

    it('does not retry after the total deadline and releases stream ownership', async () => {
        vi.useFakeTimers();
        installWorker();
        const startedAt = Date.now();
        const pending = transcribeLocalVideoAudio({streamId: 'expired', audioPcm16Base64: audio, model: 'tiny'});
        await tick();
        vi.setSystemTime(startedAt + 32_000);
        FakeWorker.instances[0].fail('late GPU failure');
        await expect(pending).rejects.toThrow('late GPU failure');
        expect(FakeWorker.instances).toHaveLength(1);
        expect(FakeWorker.instances[0].terminated).toBe(true);
        const recovered = transcribeLocalVideoAudio({streamId: 'next-owner', audioPcm16Base64: audio, model: 'tiny'});
        await tick();
        const replacement = FakeWorker.instances[1];
        replacement.reply({requestId: (replacement as any).lastMessage.requestId, success: true, text: 'recovered', segments: []});
        await expect(recovered).resolves.toMatchObject({text: 'recovered'});
        await cancelLocalVideoTranscription('next-owner');
    });

    it('does not restart a cancelled stream between worker error and the fallback microtask', async () => {
        installWorker();
        const pending = transcribeLocalVideoAudio({streamId: 'cancel-between', audioPcm16Base64: audio, model: 'tiny'});
        await tick();
        const first = FakeWorker.instances[0];
        first.fail('GPU worker failed');
        await cancelLocalVideoTranscription('cancel-between');
        await expect(pending).rejects.toThrow('取消');
        expect(FakeWorker.instances).toHaveLength(1);
    });
});

describe('video AI shared inference budget and worker generation', () => {
    it.each(['transcribe', 'prepare'] as const)('%s waits for shared capacity before creating a worker or starting its timeout', async kind => {
        vi.useFakeTimers();
        installWorker();
        const busy = deferred(), occupying = budgetMocks.run(() => busy.promise);
        const streamId = `budget-${kind}`, pending = requestVideoWorker(kind, streamId);
        await drain();
        expect(budgetMocks.run).toHaveBeenCalledTimes(2);
        expect(FakeWorker.instances).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(5000);
        expect(FakeWorker.instances).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);

        busy.resolve();await occupying;await drain();
        expect(FakeWorker.instances).toHaveLength(1);
        const worker = FakeWorker.instances[0], message = worker.messages[0];
        expect(message).toMatchObject({type: kind, model: 'tiny'});
        expect(worker.messages).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(1);
        if (kind === 'transcribe') {
            expect(message.languageSessionKey).toBe(streamId);
            expect(message.audio).toBeInstanceOf(Float32Array);
            expect(message.audio.byteLength).toBeGreaterThan(0);
        }
        completeWorker(worker);await expect(pending).resolves.toMatchObject({model: 'tiny', backend: 'wasm'});
        const probe = vi.fn(async () => 'capacity released');
        await expect(budgetMocks.run(probe)).resolves.toBe('capacity released');
        expect(probe).toHaveBeenCalledOnce();
        await cancelLocalVideoTranscription(streamId);
        expect(worker.terminated).toBe(true);expect(vi.getTimerCount()).toBe(0);
    });

    it.each(['transcribe', 'prepare'] as const)('cancelled %s waiting on capacity never creates a worker, and the next model can start', async kind => {
        installWorker();
        const busy = deferred(), occupying = budgetMocks.run(() => busy.promise);
        const oldStream = `old-${kind}`, freshStream = `new-${kind}`;
        const stale = requestVideoWorker(kind, oldStream);
        const cancelled = expect(stale).rejects.toThrow('本地视频 AI 字幕已取消');
        await drain();
        expect(budgetMocks.run).toHaveBeenCalledTimes(2);
        expect(FakeWorker.instances).toHaveLength(0);
        // 此时还没有 Worker：取消也必须增加世代，拦截已经进入预算队列的闭包。
        await cancelLocalVideoTranscription(oldStream);
        const fresh = requestVideoWorker(kind, freshStream, 'base');
        await drain();expect(FakeWorker.instances).toHaveLength(0);

        busy.resolve();await occupying;await cancelled;await drain();
        expect(FakeWorker.instances).toHaveLength(1);
        expect(budgetMocks.run).toHaveBeenCalledTimes(3);
        const worker = FakeWorker.instances[0];
        expect(worker.messages).toHaveLength(1);
        expect(worker.messages[0]).toMatchObject({type: kind, model: 'base'});
        expect(worker.messages[0].device).toBeUndefined();
        if (kind === 'transcribe') expect(worker.messages[0].languageSessionKey).toBe(freshStream);
        completeWorker(worker, 'base');await expect(fresh).resolves.toMatchObject({model: 'base'});
        expect(worker.messages).toHaveLength(1);
        await cancelLocalVideoTranscription(freshStream);
    });

    it('cancel and model change invalidate a queued request against an already warm worker', async () => {
        installWorker();
        const streamId = 'model-change-budget';
        const warm = prepareLocalVideoTranscriptionModel('tiny', {keepWarm: true, streamId});
        await drain();
        const original = FakeWorker.instances[0];
        completeWorker(original);await warm;
        const firstRequestId = original.messages[0].requestId;

        const busy = deferred(), occupying = budgetMocks.run(() => busy.promise);
        const stale = transcribeLocalVideoAudio({streamId, audioPcm16Base64: audio, model: 'tiny'});
        const cancelled = expect(stale).rejects.toThrow('本地视频 AI 字幕已取消');
        await drain();
        expect(original.messages).toHaveLength(1);
        expect(budgetMocks.run).toHaveBeenCalledTimes(3);
        await cancelLocalVideoTranscription(streamId);
        expect(original.terminated).toBe(true);
        const changed = prepareLocalVideoTranscriptionModel('base', {keepWarm: true, streamId});
        await drain();expect(FakeWorker.instances).toHaveLength(1);

        busy.resolve();await occupying;await cancelled;await drain();
        expect(FakeWorker.instances).toHaveLength(2);
        const replacement = FakeWorker.instances[1];
        expect(original.messages).toHaveLength(1);
        expect(replacement.messages).toHaveLength(1);
        expect(replacement.messages[0]).toMatchObject({type: 'prepare', model: 'base', requestId: firstRequestId + 1});
        expect(budgetMocks.run).toHaveBeenCalledTimes(4);
        completeWorker(replacement, 'base');await expect(changed).resolves.toMatchObject({model: 'base'});
        expect(replacement.terminated).toBe(false);
        await cancelLocalVideoTranscription(streamId);
    });

    it('model switching waits for capacity, then advances generation without rejecting subsequent requests', async () => {
        installWorker();
        const streamId = 'switch-generation';
        const warm = prepareLocalVideoTranscriptionModel('tiny', {keepWarm: true, streamId});
        await drain();
        const original = FakeWorker.instances[0];
        completeWorker(original);await warm;

        const busy = deferred(), occupying = budgetMocks.run(() => busy.promise);
        const changed = prepareLocalVideoTranscriptionModel('base', {keepWarm: true, streamId});
        await drain();
        expect(FakeWorker.instances).toHaveLength(1);
        expect(original.terminated).toBe(false);expect(original.messages).toHaveLength(1);
        busy.resolve();await occupying;await drain();
        expect(original.terminated).toBe(true);
        expect(FakeWorker.instances).toHaveLength(2);
        const replacement = FakeWorker.instances[1];
        expect(replacement.messages[0]).toMatchObject({type: 'prepare', model: 'base'});

        const followup = transcribeLocalVideoAudio({streamId, audioPcm16Base64: audio, model: 'base'});
        expect(replacement.messages).toHaveLength(1);
        completeWorker(replacement, 'base');await changed;await drain();
        expect(FakeWorker.instances).toHaveLength(2);
        expect(replacement.messages).toHaveLength(2);
        expect(replacement.messages[1]).toMatchObject({type: 'transcribe', model: 'base', languageSessionKey: streamId});
        expect(budgetMocks.run).toHaveBeenCalledTimes(4);
        completeWorker(replacement, 'base');await expect(followup).resolves.toMatchObject({model: 'base'});
        expect(replacement.terminated).toBe(false);
        await cancelLocalVideoTranscription(streamId);
    });

    it('cancel invalidates a CPU retry waiting on shared capacity and releases it for a new model', async () => {
        installWorker();
        const streamId = 'retry-budget';
        const stale = transcribeLocalVideoAudio({streamId, audioPcm16Base64: audio, model: 'tiny'});
        const cancelled = expect(stale).rejects.toThrow('本地视频 AI 字幕已取消');
        await drain();
        const original = FakeWorker.instances[0];
        // 活跃请求尚占预算；失败释放后由另一类推理先取得槽位，CPU 重试必须排队。
        const busy = deferred(), occupying = budgetMocks.run(() => busy.promise);
        original.fail('GPU failure before budget wait');
        await drain();
        expect(original.terminated).toBe(true);
        expect(budgetMocks.run).toHaveBeenCalledTimes(3);
        expect(FakeWorker.instances).toHaveLength(1);
        await cancelLocalVideoTranscription(streamId);
        const fresh = transcribeLocalVideoAudio({streamId: 'new-after-retry', audioPcm16Base64: audio, model: 'base'});
        busy.resolve();await occupying;await cancelled;await drain();

        expect(FakeWorker.instances).toHaveLength(2);
        const replacement = FakeWorker.instances[1];
        expect(replacement.messages).toHaveLength(1);
        expect(replacement.messages[0]).toMatchObject({type: 'transcribe', model: 'base', languageSessionKey: 'new-after-retry'});
        expect(replacement.messages[0].device).toBeUndefined();
        expect(budgetMocks.run).toHaveBeenCalledTimes(4);
        completeWorker(replacement, 'base');await expect(fresh).resolves.toMatchObject({model: 'base'});
        await cancelLocalVideoTranscription('new-after-retry');
    });
});

it('删除模型拒绝活跃工作并在失败后恢复可用状态', async () => {
 installWorker(); let release!:()=>void;
 vi.stubGlobal('caches',{open:()=>new Promise<any>(resolve=>{release=()=>resolve({keys:async()=>[]})})});
 await expect(removeLocalVideoTranscriptionModel('bad')).rejects.toThrow('无效');
 const clearing=removeLocalVideoTranscriptionModel('tiny');
 await expect(removeLocalVideoTranscriptionModel('base')).rejects.toThrow('正在');
 await expect(prepareLocalVideoTranscriptionModel('tiny')).rejects.toThrow('清除');
 await expect(transcribeLocalVideoAudio({streamId:'busy',audioPcm16Base64:audio,model:'tiny'})).rejects.toThrow('清除');
 release(); await clearing;
 vi.stubGlobal('caches',{open:async()=>{throw new Error('disk')}});
 await expect(removeLocalVideoTranscriptionModel('tiny')).rejects.toThrow('disk');
 vi.stubGlobal('caches',{open:async()=>({keys:async()=>[]})});
 const pending=transcribeLocalVideoAudio({streamId:'loaded',audioPcm16Base64:audio,model:'tiny'}); await tick();
 await expect(removeLocalVideoTranscriptionModel('tiny')).rejects.toThrow('正在');
 const worker=FakeWorker.instances[0]; worker.reply({requestId:(worker as any).lastMessage.requestId,success:true,text:'hello',segments:[],model:'tiny'});await pending;
 await removeLocalVideoTranscriptionModel('tiny');expect(worker.terminated).toBe(true);
});
