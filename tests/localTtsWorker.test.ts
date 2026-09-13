/**
 * @file tests/localTtsWorker.test.ts
 * 文件职责：验证本地 TTS Worker 的 WebGPU 优先、WASM 回退、流式失败恢复和生命周期锁定。
 * 主要内容：用假 Kokoro 模型驱动真实 Worker 消息队列，不加载模型文件或启动浏览器 Worker。
 * 模块边界：只覆盖 tts.worker.ts 的设备选择、模型释放、音频重试和错误边界。
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    probeWebGpu: vi.fn(),
    fromPretrained: vi.fn(),
}));

vi.mock('@uzen/kokoro-js', () => ({
    KokoroTTS: {from_pretrained: mocks.fromPretrained},
    env: {wasmPaths: {}},
}));

vi.mock('@huggingface/transformers-kokoro', () => ({
    env: {
        allowLocalModels: false,
        allowRemoteModels: true,
        useBrowserCache: true,
        useWasmCache: false,
        fetch: globalThis.fetch,
        backends: {onnx: {wasm: {}}},
    },
}));

vi.mock('@/src/shared/onnx/wasmBinary', () => ({
    configureOnnxWasmBackend: vi.fn(),
    withCompressedWasmBinary: vi.fn(async (_backend: unknown, _url: string, initialize: () => Promise<unknown>) => initialize()),
}));

vi.mock('@/src/shared/onnx/webgpu', () => ({probeWebGpu: mocks.probeWebGpu}));

type FakeModel = {
    stream: ReturnType<typeof vi.fn>;
    model: {dispose: ReturnType<typeof vi.fn>};
};

type WorkerScope = {
    location: {href: string};
    onmessage?: (event: MessageEvent) => void;
    postMessage: ReturnType<typeof vi.fn>;
};

const originalFetch = globalThis.fetch;

function modelFrom(stream: () => AsyncGenerator<unknown>, dispose = vi.fn()): FakeModel {
    return {
        stream: vi.fn(stream),
        model: {dispose},
    };
}

async function* audioChunks(samples: number[], samplingRate = 24_000): AsyncGenerator<unknown> {
    yield {audio: {audio: new Float32Array(samples), sampling_rate: samplingRate}};
}

async function* audioThenError(): AsyncGenerator<unknown> {
    yield {audio: {audio: new Float32Array([1]), sampling_rate: 24_000}};
    throw new Error('webgpu stream failed');
}

async function* errorStream(): AsyncGenerator<unknown> {
    throw new Error('cpu stream failed');
}

function scope(): WorkerScope {
    const value: WorkerScope = {
        location: {href: 'chrome-extension://test/offscreen.html'},
        postMessage: vi.fn(),
    };
    (globalThis as unknown as {self: WorkerScope}).self = value;
    return value;
}

async function start() {
    vi.resetModules();
    const workerScope = scope();
    const worker = await import('@/src/features/local-tts/offscreen/tts.worker');
    worker.startLocalTtsWorker();
    return workerScope;
}

async function send(workerScope: WorkerScope, request: Record<string, unknown>, messageCount: number) {
    workerScope.onmessage?.({data: request} as MessageEvent);
    await vi.waitFor(() => expect(workerScope.postMessage).toHaveBeenCalledTimes(messageCount));
    return workerScope.postMessage.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

beforeEach(() => {
    mocks.probeWebGpu.mockReset();
    mocks.probeWebGpu.mockResolvedValue({available: true, info: 'test-gpu'});
    mocks.fromPretrained.mockReset();
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
    delete (globalThis as unknown as {self?: WorkerScope}).self;
});

describe('local TTS worker device fallback', () => {
    it('prefers WebGPU and reports initialization failure for a fresh CPU worker', async () => {
        mocks.fromPretrained.mockRejectedValueOnce(new Error('webgpu init failed'));
        const workerScope = await start();

        const response = await send(workerScope, {requestId: 1, type: 'prepare'}, 1);
        expect(response).toMatchObject({requestId: 1, success: false, retryWithCpu: true});
        expect(response.error).toBe('webgpu init failed');
        expect(mocks.fromPretrained.mock.calls.map(([_, options]) => options.device)).toEqual(['webgpu']);
        expect(mocks.probeWebGpu).toHaveBeenCalledOnce();
        expect(mocks.fromPretrained).toHaveBeenCalledOnce();
    });

    it('discards partial GPU audio, releases the GPU model, and reports a fresh CPU retry hint', async () => {
        const gpuDispose = vi.fn();
        const gpuModel = modelFrom(audioThenError, gpuDispose);
        mocks.fromPretrained.mockResolvedValueOnce(gpuModel);
        const workerScope = await start();

        const response = await send(workerScope, {
            requestId: 3,
            type: 'synthesize',
            text: 'first sentence. second sentence.',
            voice: 'zf_001',
            speed: 1,
        }, 1);

        expect(response).toMatchObject({requestId: 3, success: false, retryWithCpu: true});
        expect(gpuModel.stream).toHaveBeenCalledOnce();
        expect(gpuModel.stream.mock.calls[0][0]).toBe('first sentence. second sentence.');
        expect(gpuDispose).toHaveBeenCalledOnce();
        expect(mocks.fromPretrained).toHaveBeenCalledOnce();

        const wasmModel = modelFrom(() => audioChunks([0.5]));
        mocks.fromPretrained.mockReset().mockResolvedValue(wasmModel);
        const cpuWorkerScope = await start();
        const recovered = await send(cpuWorkerScope, {
            requestId: 4,
            type: 'synthesize',
            device: 'wasm',
            text: 'first sentence. second sentence.',
            voice: 'zf_001',
            speed: 1,
        }, 1);
        expect(recovered).toMatchObject({requestId: 4, success: true, backend: 'wasm'});
        expect(wasmModel.stream).toHaveBeenCalledOnce();
        expect(wasmModel.stream.mock.calls[0][0]).toBe('first sentence. second sentence.');
    });

    it('treats NaN GPU audio as an inference failure and reports a fresh CPU retry hint', async () => {
        const gpuDispose = vi.fn();
        const gpuModel = modelFrom(() => audioChunks([Number.NaN]), gpuDispose);
        mocks.fromPretrained.mockResolvedValueOnce(gpuModel);
        const workerScope = await start();

        const response = await send(workerScope, {requestId: 10, type: 'synthesize', text: 'NaN audio'}, 1);
        expect(response).toMatchObject({requestId: 10, success: false, retryWithCpu: true});
        expect(response.error).toContain('本地 TTS 生成了无效音频');
        expect(gpuDispose).toHaveBeenCalledOnce();
        expect(gpuModel.stream).toHaveBeenCalledOnce();
        expect(mocks.fromPretrained).toHaveBeenCalledOnce();
    });

    it('rejects silent CPU audio without retrying or emitting a WAV', async () => {
        mocks.probeWebGpu.mockResolvedValue({available: false, info: ''});
        const cpuModel = modelFrom(() => audioChunks([0, -0, 0]));
        mocks.fromPretrained.mockResolvedValue(cpuModel);
        const workerScope = await start();

        const response = await send(workerScope, {requestId: 11, type: 'synthesize', text: 'silent audio'}, 1);
        expect(response).toMatchObject({requestId: 11, success: false, error: '本地 TTS 生成了静音音频'});
        expect(cpuModel.stream).toHaveBeenCalledOnce();
        expect(mocks.fromPretrained).toHaveBeenCalledOnce();
    });

    it('rejects non-finite CPU audio without retrying', async () => {
        mocks.probeWebGpu.mockResolvedValue({available: false, info: ''});
        const cpuModel = modelFrom(() => audioChunks([Number.NaN, 0.2]));
        mocks.fromPretrained.mockResolvedValue(cpuModel);
        const workerScope = await start();

        const response = await send(workerScope, {requestId: 12, type: 'synthesize', text: 'invalid audio'}, 1);
        expect(response).toMatchObject({requestId: 12, success: false});
        expect(response.error).toContain('本地 TTS 生成了无效音频');
        expect(cpuModel.stream).toHaveBeenCalledOnce();
        expect(mocks.fromPretrained).toHaveBeenCalledOnce();
    });

    it('does not retry a pure CPU stream error or damage the serial queue', async () => {
        mocks.probeWebGpu.mockResolvedValue({available: false, info: ''});
        const cpuModel = modelFrom(errorStream);
        mocks.fromPretrained.mockResolvedValue(cpuModel);
        const workerScope = await start();

        const failed = await send(workerScope, {requestId: 5, type: 'synthesize', text: 'CPU only'}, 1);
        expect(failed).toMatchObject({requestId: 5, success: false, error: 'cpu stream failed'});
        expect(cpuModel.stream).toHaveBeenCalledOnce();
        expect(mocks.fromPretrained).toHaveBeenCalledOnce();

        const prepared = await send(workerScope, {requestId: 6, type: 'prepare'}, 2);
        expect(prepared).toMatchObject({requestId: 6, success: true, backend: 'wasm'});
    });

    it('honors an internal WASM request by releasing GPU and locking the worker to CPU', async () => {
        const gpuDispose = vi.fn();
        const gpuModel = modelFrom(() => audioChunks([0.1]), gpuDispose);
        const wasmModel = modelFrom(() => audioChunks([0.2]));
        mocks.fromPretrained
            .mockResolvedValueOnce(gpuModel)
            .mockResolvedValueOnce(wasmModel);
        const workerScope = await start();

        await send(workerScope, {requestId: 7, type: 'prepare'}, 1);
        const forced = await send(workerScope, {requestId: 8, type: 'prepare', device: 'wasm'}, 2);
        expect(forced).toMatchObject({requestId: 8, success: true, backend: 'wasm'});
        expect(gpuDispose).toHaveBeenCalledOnce();

        await send(workerScope, {requestId: 9, type: 'prepare'}, 3);
        expect(mocks.fromPretrained.mock.calls.map(([_, options]) => options.device)).toEqual(['webgpu', 'wasm']);
    });
});
