import {describe, expect, it, vi} from 'vitest';
import {isDegenerateVideoTranscript} from '@/src/features/video-subtitle/transcription';
import {parseWhisperChunkTimestamps} from '@/src/features/video-subtitle/offscreen/timestampParser';
import {buildWhisperTranscriptionGenerationOptions, chooseWhisperSourceLanguage, normalizeWhisperSourceLanguage} from '@/src/features/video-subtitle/offscreen/transcriptionOptions';

const workerMocks = vi.hoisted(() => {
    class FakeTensor {
        readonly data: Float32Array | BigInt64Array;
        readonly dims: number[];
        disposed = false;
        constructor(_type: string, data: Float32Array | BigInt64Array, dims: number[]) {
            this.data = data;
            this.dims = dims;
        }
        dispose(): void { this.disposed = true; }
    }
    class FakeStoppingCriteria {
        interrupted = false;
        interrupt(): void { this.interrupted = true; }
    }
    return {
        env: {backends: {onnx: {wasm: {}}}},
        InterruptableStoppingCriteria: FakeStoppingCriteria,
        Tensor: FakeTensor,
        pipeline: vi.fn(),
    };
});

vi.mock('@huggingface/transformers', () => workerMocks);
const wasmMocks = vi.hoisted(() => ({
    configureOnnxWasmBackend: vi.fn(),
    withCompressedWasmBinary: (_backend: unknown, _url: string, initialize: () => Promise<unknown>) => initialize(),
}));

vi.mock('@/src/shared/onnx/wasmBinary', () => wasmMocks);
const webGpuMocks = vi.hoisted(() => ({
    probeWebGpu: vi.fn(async () => ({available: false, info: ''})),
}));

vi.mock('@/src/shared/onnx/webgpu', () => webGpuMocks);

function createWorkerScope(): Record<string, any> {
    return {
        setTimeout,
        clearTimeout,
        addEventListener: vi.fn(),
        postMessage: vi.fn(),
        location: {href: 'chrome-extension://test/worker.js'},
    };
}

async function waitForWorkerMessages(scope: Record<string, any>, count: number): Promise<void> {
    for (let index = 0; index < 30 && scope.postMessage.mock.calls.length < count; index += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}

describe('视频 AI Worker timestamp parser', () => {
    it('数字静音直接返回空字幕，不初始化模型或检测语言', async () => {
        vi.resetModules();
        const scope = createWorkerScope();
        vi.stubGlobal('self', scope);
        vi.stubGlobal('navigator', {hardwareConcurrency: 1});
        workerMocks.pipeline.mockReset();
        webGpuMocks.probeWebGpu.mockReset();
        (await import('@/src/features/video-subtitle/offscreen/transcription.worker')).startVideoTranscriptionWorker();
        scope.onmessage({data: {requestId: 1, type: 'transcribe', sourceLanguage: 'auto', audio: new Float32Array(160_000)}});
        await waitForWorkerMessages(scope, 1);
        expect(workerMocks.pipeline).not.toHaveBeenCalled();
        expect(webGpuMocks.probeWebGpu).not.toHaveBeenCalled();
        expect(scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({success: true, text: '', segments: [], inferenceMs: 0, audioDurationMs: 10_000}));
        vi.unstubAllGlobals();
    });

    it.each([true, false])('裁剪长静音后恢复字幕绝对窗口位置（有 timestamp：%s）', async (withTimestamps) => {
        vi.resetModules();
        const scope = createWorkerScope();
        vi.stubGlobal('self', scope);
        vi.stubGlobal('navigator', {hardwareConcurrency: 1});
        webGpuMocks.probeWebGpu.mockReset().mockResolvedValue({available: false, info: ''});
        const transcriber = vi.fn(async (_audio: Float32Array, _options: Record<string, unknown>) => ({text: 'A complete sentence.', chunks: withTimestamps ? [{timestamp: [.16, 1.16], text: 'A complete sentence.'}] : []}));
        workerMocks.pipeline.mockReset().mockResolvedValue(transcriber);
        (await import('@/src/features/video-subtitle/offscreen/transcription.worker')).startVideoTranscriptionWorker();
        const audio = new Float32Array(5 * 16_000);
        audio.fill(.04, 2 * 16_000, 3 * 16_000);
        scope.onmessage({data: {requestId: 1, type: 'transcribe', sourceLanguage: 'en', audio}});
        await waitForWorkerMessages(scope, 1);
        expect(transcriber.mock.calls[0][0].length).toBe(1320 * 16);
        expect(transcriber.mock.calls[0][1]).toMatchObject({max_new_tokens: 30, language: 'en'});
        expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
            success: true, audioDurationMs: 5000,
            segments: [{startMs: withTimestamps ? 2000 : 1840, endMs: withTimestamps ? 3000 : 3160, text: 'A complete sentence.'}],
        }));
        vi.unstubAllGlobals();
    });

    it('调用 Whisper 首步模型 logits 检测 auto 语言，并按 stream session 缓存后切换', async () => {
        vi.resetModules();
        const scope: Record<string, any> = {
            setTimeout,
            clearTimeout,
            addEventListener: vi.fn(),
            postMessage: vi.fn(),
            location: {href: 'chrome-extension://test/worker.js'},
        };
        vi.stubGlobal('self', scope);
        vi.stubGlobal('navigator', {hardwareConcurrency: 1});
        workerMocks.pipeline.mockReset();
        const detectionTensors: any[] = [];
        const modelCalls: any[] = [];
        const transcribeCalls: any[] = [];
        const transcriber: any = vi.fn(async (_audio: Float32Array, options: Record<string, unknown>) => {
            transcribeCalls.push(options);
            return {text: options.language === 'ko' ? '한국어' : 'English', chunks: []};
        });
        transcriber.processor = vi.fn(async () => {
            const feature = new workerMocks.Tensor('float32', new Float32Array([0]), [1]);
            detectionTensors.push(feature);
            return {input_features: feature};
        });
        transcriber.model = vi.fn(async (inputs: Record<string, any>) => {
            modelCalls.push(inputs);
            const language = modelCalls.length <= 2 ? 'ko' : 'en';
            const logits = new workerMocks.Tensor('float32', new Float32Array([0, language === 'ko' ? 1 : 9, language === 'ko' ? 8 : 1]), [1, 1, 3]);
            detectionTensors.push(logits);
            return {logits};
        });
        transcriber.model.config = {is_multilingual: true, decoder_start_token_id: 0};
        transcriber.model.generation_config = {
            is_multilingual: true,
            decoder_start_token_id: 0,
            lang_to_id: {'<|en|>': 1, '<|ko|>': 2},
        };
        transcriber.dispose = vi.fn(async () => undefined);
        workerMocks.pipeline.mockResolvedValue(transcriber);
        const workerModule = await import('@/src/features/video-subtitle/offscreen/transcription.worker');
        workerModule.startVideoTranscriptionWorker();
        expect(wasmMocks.configureOnnxWasmBackend).toHaveBeenCalledWith(
            workerMocks.env.backends.onnx.wasm,
            expect.objectContaining({
                mjs: expect.stringContaining('ort-wasm-simd-threaded.asyncify.mjs'),
                wasm: expect.stringContaining('ort-wasm-simd-threaded.asyncify.wasm'),
            }),
        );
        const send = (requestId: number, languageSessionKey: string) => scope.onmessage?.({data: {
            requestId, type: 'transcribe', model: 'tiny', sourceLanguage: 'auto', languageSessionKey,
            audio: new Float32Array(48_000).fill(0.04),
        }});
        send(1, 'stream-ko');
        for (let index = 0; index < 10 && scope.postMessage.mock.calls.length < 1; index += 1) await new Promise(resolve => setTimeout(resolve, 0));
        send(2, 'stream-ko');
        for (let index = 0; index < 10 && scope.postMessage.mock.calls.length < 2; index += 1) await new Promise(resolve => setTimeout(resolve, 0));
        send(3, 'stream-en');
        for (let index = 0; index < 10 && scope.postMessage.mock.calls.length < 3; index += 1) await new Promise(resolve => setTimeout(resolve, 0));
        for (let index = 0; index < 16; index += 1) {
            send(10 + index, `stream-${index}`);
            for (let attempt = 0; attempt < 10 && scope.postMessage.mock.calls.length < 4 + index; attempt += 1) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        send(30, 'stream-ko');
        for (let index = 0; index < 10 && scope.postMessage.mock.calls.length < 20; index += 1) await new Promise(resolve => setTimeout(resolve, 0));
        expect(modelCalls).toHaveLength(20);
        expect(modelCalls[0].decoder_input_ids.data[0]).toBe(0n);
        expect(transcribeCalls.slice(0, 3).map((call) => call.language)).toEqual(['ko', 'ko', 'en']);
        expect(transcribeCalls.at(-1)?.language).toBe('en');
        expect(detectionTensors.every((tensor) => tensor.disposed)).toBe(true);
        vi.unstubAllGlobals();
    });

    it('低置信度首窗不锁定错误语言，两个中文窗确认后复用；显式中文跳过检测', async () => {
        vi.resetModules();
        const scope = createWorkerScope();
        vi.stubGlobal('self', scope);
        vi.stubGlobal('navigator', {hardwareConcurrency: 1});
        webGpuMocks.probeWebGpu.mockResolvedValue({available: false, info: ''});
        const transcriber: any = vi.fn(async (_audio, options) => ({text: options.language === 'zh' ? '我挟天子以令诸侯。' : 'uncertain', chunks: []}));
        transcriber.processor = vi.fn(async () => ({input_features: new workerMocks.Tensor('float32', new Float32Array([0]), [1])}));
        const logits = [[0, 1.1, 1], [0, 0, 9], [0, 0, 9]];
        transcriber.model = vi.fn(async () => ({logits: new workerMocks.Tensor('float32', new Float32Array(logits.shift() || [0, 0, 9]), [1, 1, 3])}));
        transcriber.model.config = {is_multilingual: true, decoder_start_token_id: 0};
        transcriber.model.generation_config = {lang_to_id: {'<|en|>': 1, '<|zh|>': 2}};
        workerMocks.pipeline.mockReset().mockResolvedValue(transcriber);
        (await import('@/src/features/video-subtitle/offscreen/transcription.worker')).startVideoTranscriptionWorker();
        for (let requestId = 1; requestId <= 4; requestId += 1) {
            scope.onmessage({data: {requestId, type: 'transcribe', model: 'tiny', sourceLanguage: 'auto', languageSessionKey: 'chinese', audio: new Float32Array(64_000).fill(0.04)}});
            await waitForWorkerMessages(scope, requestId);
        }
        expect(transcriber.model).toHaveBeenCalledTimes(3);
        expect(transcriber.mock.calls.map((call: any[]) => call[1].language)).toEqual(['en', 'zh', 'zh', 'zh']);
        scope.onmessage({data: {requestId: 5, type: 'transcribe', model: 'tiny', sourceLanguage: 'zh-Hans', audio: new Float32Array(64_000).fill(0.04)}});
        await waitForWorkerMessages(scope, 5);
        expect(transcriber.model).toHaveBeenCalledTimes(3);
        expect(transcriber.mock.calls.at(-1)[1]).toMatchObject({language: 'zh', task: 'transcribe', no_repeat_ngram_size: 8});
        expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({success: true, text: '我挟天子以令诸侯。'}));
        vi.unstubAllGlobals();
    });

    it.each([false, true])('长串中文重复只重试一次，失败给出恢复提示而不提交错误字幕（继续重复：%s）', async stillRepeated => {
        vi.resetModules();
        const scope = createWorkerScope();
        vi.stubGlobal('self', scope);
        vi.stubGlobal('navigator', {hardwareConcurrency: 1});
        webGpuMocks.probeWebGpu.mockResolvedValue({available: false, info: ''});
        const repeated = '全套 不' + '吻'.repeat(50);
        const transcriber: any = vi.fn()
            .mockResolvedValueOnce({text: repeated, chunks: []})
            .mockResolvedValueOnce({text: stillRepeated ? repeated : '我挟天子以令诸侯。', chunks: []});
        workerMocks.pipeline.mockReset().mockResolvedValue(transcriber);
        (await import('@/src/features/video-subtitle/offscreen/transcription.worker')).startVideoTranscriptionWorker();
        scope.onmessage({data: {requestId: 1, type: 'transcribe', model: 'tiny', sourceLanguage: 'zh-Hans', languageSessionKey: 'repeat', audio: new Float32Array(64_000).fill(0.04)}});
        await waitForWorkerMessages(scope, 1);
        expect(transcriber).toHaveBeenCalledTimes(2);
        expect(transcriber.mock.calls[1][1]).toMatchObject({language: 'zh', no_repeat_ngram_size: 4, repetition_penalty: 1.15});
        if (stillRepeated) expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({success: false, error: expect.stringContaining('异常重复')}));
        else expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({success: true, text: '我挟天子以令诸侯。'}));
        vi.unstubAllGlobals();
    });

    it('总文本正常但 timestamp chunk 出现重复时也重新识别', async () => {
        vi.resetModules();
        const scope = createWorkerScope();
        vi.stubGlobal('self', scope);
        vi.stubGlobal('navigator', {hardwareConcurrency: 1});
        webGpuMocks.probeWebGpu.mockResolvedValue({available: false, info: ''});
        const transcriber: any = vi.fn()
            .mockResolvedValueOnce({text: '看起来正常。', chunks: [{text: '吻'.repeat(50), timestamp: [0, 1]}]})
            .mockResolvedValueOnce({text: '恢复的字幕。', chunks: [{text: '恢复的字幕。', timestamp: [0, 1]}]});
        workerMocks.pipeline.mockReset().mockResolvedValue(transcriber);
        (await import('@/src/features/video-subtitle/offscreen/transcription.worker')).startVideoTranscriptionWorker();
        scope.onmessage({data: {requestId: 1, type: 'transcribe', model: 'base', sourceLanguage: 'zh', audio: new Float32Array(64_000).fill(0.04)}});
        await waitForWorkerMessages(scope, 1);
        expect(transcriber).toHaveBeenCalledTimes(2);
        expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({success: true, segments: [expect.objectContaining({text: '恢复的字幕。'})]}));
        vi.unstubAllGlobals();
    });

    it('退化检测覆盖中文长串与英文短语循环，保留叠词和正常重复强调', () => {
        expect(isDegenerateVideoTranscript('全套 不' + '吻'.repeat(50))).toBe(true);
        expect(isDegenerateVideoTranscript('Thank you for watching. '.repeat(8))).toBe(true);
        expect(isDegenerateVideoTranscript('你好你好你好')).toBe(false);
        expect(isDegenerateVideoTranscript('不，不，不，这是我的选择。')).toBe(false);
        expect(isDegenerateVideoTranscript('哈哈哈哈哈，谢谢谢谢。')).toBe(false);
        expect(isDegenerateVideoTranscript('1234567890'.repeat(6))).toBe(true);
        expect(isDegenerateVideoTranscript(undefined)).toBe(false);
    });

    it('硬件 WebGPU 可用时优先创建 q4 session，并回传 GPU 诊断', async () => {
        vi.resetModules();
        const scope: Record<string, any> = {
            setTimeout,
            clearTimeout,
            addEventListener: vi.fn(),
            postMessage: vi.fn(),
            location: {href: 'chrome-extension://test/worker.js'},
        };
        vi.stubGlobal('self', scope);
        vi.stubGlobal('navigator', {hardwareConcurrency: 8});
        workerMocks.pipeline.mockReset();
        webGpuMocks.probeWebGpu.mockReset().mockResolvedValue({available: true, info: 'Apple / MTL / GPU'});
        const gpuTranscriber: any = vi.fn(async () => ({text: 'GPU result', chunks: []}));
        gpuTranscriber.dispose = vi.fn(async () => undefined);
        workerMocks.pipeline.mockResolvedValue(gpuTranscriber);

        const workerModule = await import('@/src/features/video-subtitle/offscreen/transcription.worker');
        workerModule.startVideoTranscriptionWorker();
        scope.onmessage?.({data: {requestId: 1, type: 'prepare', model: 'tiny'}});
        for (let index = 0; index < 10 && scope.postMessage.mock.calls.length < 1; index += 1) await new Promise(resolve => setTimeout(resolve, 0));

        expect(webGpuMocks.probeWebGpu).toHaveBeenCalledTimes(1);
        expect(workerMocks.pipeline).toHaveBeenCalledWith('automatic-speech-recognition', expect.any(String), expect.objectContaining({
            device: 'webgpu',
            dtype: 'q4',
            session_options: expect.objectContaining({enableCpuMemArena: false, enableMemPattern: false, executionMode: 'sequential'}),
        }));
        expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
            success: true,
            backend: 'webgpu',
            gpuInfo: 'Apple / MTL / GPU',
            dtype: 'q4',
        }));
        vi.unstubAllGlobals();
    });

    it('GPU 语言检测失败时释放旧 session 并回传 fresh CPU 重试提示', async () => {
        vi.resetModules();
        const scope: Record<string, any> = {
            setTimeout,
            clearTimeout,
            addEventListener: vi.fn(),
            postMessage: vi.fn(),
            location: {href: 'chrome-extension://test/worker.js'},
        };
        vi.stubGlobal('self', scope);
        vi.stubGlobal('navigator', {hardwareConcurrency: 4});
        workerMocks.pipeline.mockReset();
        webGpuMocks.probeWebGpu.mockReset().mockResolvedValue({available: true, info: 'Discrete GPU'});

        const gpuTranscriber: any = vi.fn(async () => ({text: 'should not run', chunks: []}));
        gpuTranscriber.processor = vi.fn(async () => ({input_features: new workerMocks.Tensor('float32', new Float32Array([0]), [1])}));
        gpuTranscriber.model = vi.fn(async () => { throw new Error('GPU language detection failed'); });
        gpuTranscriber.model.config = {is_multilingual: true, decoder_start_token_id: 0};
        gpuTranscriber.model.generation_config = {
            is_multilingual: true,
            decoder_start_token_id: 0,
            lang_to_id: {'<|en|>': 1},
        };
        gpuTranscriber.dispose = vi.fn(async () => undefined);

        workerMocks.pipeline.mockResolvedValue(gpuTranscriber);

        const workerModule = await import('@/src/features/video-subtitle/offscreen/transcription.worker');
        workerModule.startVideoTranscriptionWorker();
        const send = (requestId: number, device?: 'wasm') => scope.onmessage?.({data: {
            requestId,
            type: 'transcribe',
            model: 'tiny',
            sourceLanguage: 'auto',
            languageSessionKey: `stream-${requestId}`,
            audio: new Float32Array([0.04, 0.04, 0.04, 0.04]),
            device,
        }});
        send(1);
        for (let index = 0; index < 20 && scope.postMessage.mock.calls.length < 1; index += 1) await new Promise(resolve => setTimeout(resolve, 0));
        expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({success: false, error: 'GPU language detection failed', retryWithCpu: true}));
        expect(gpuTranscriber.dispose).toHaveBeenCalledTimes(1);
        expect(workerMocks.pipeline.mock.calls.map(([, , options]) => options.device)).toEqual(['webgpu']);
        expect(workerMocks.pipeline).toHaveBeenCalledTimes(1);
        expect(webGpuMocks.probeWebGpu).toHaveBeenCalledTimes(1);
        vi.unstubAllGlobals();
    });

    it('GPU 上的语言配置错误直接返回，不误判为 GPU 故障或重建 session', async () => {
        vi.resetModules();
        const scope = createWorkerScope();
        vi.stubGlobal('self', scope);
        vi.stubGlobal('navigator', {hardwareConcurrency: 4});
        workerMocks.pipeline.mockReset();
        webGpuMocks.probeWebGpu.mockReset().mockResolvedValue({available: true, info: 'Discrete GPU'});
        const gpuTranscriber: any = vi.fn();
        gpuTranscriber.processor = vi.fn();
        gpuTranscriber.model = vi.fn();
        gpuTranscriber.model.config = {is_multilingual: true, decoder_start_token_id: 0};
        gpuTranscriber.dispose = vi.fn(async () => undefined);
        workerMocks.pipeline.mockResolvedValue(gpuTranscriber);

        const workerModule = await import('@/src/features/video-subtitle/offscreen/transcription.worker');
        workerModule.startVideoTranscriptionWorker();
        scope.onmessage?.({data: {
            requestId: 1,
            type: 'transcribe',
            model: 'tiny',
            sourceLanguage: 'auto',
            audio: new Float32Array([0.04, 0.04, 0.04, 0.04]),
        }});
        await waitForWorkerMessages(scope, 1);

        expect(scope.postMessage).toHaveBeenLastCalledWith({requestId: 1, success: false, error: 'Whisper 模型缺少语言 token 配置'});
        expect(gpuTranscriber.dispose).not.toHaveBeenCalled();
        expect(gpuTranscriber.model).not.toHaveBeenCalled();
        expect(workerMocks.pipeline).toHaveBeenCalledTimes(1);
        vi.unstubAllGlobals();
    });

    it('GPU 初始化失败后释放状态并回传 fresh CPU 重试提示', async () => {
        vi.resetModules();
        const scope = createWorkerScope();
        vi.stubGlobal('self', scope);
        vi.stubGlobal('navigator', {hardwareConcurrency: 4});
        workerMocks.pipeline.mockReset();
        webGpuMocks.probeWebGpu.mockReset().mockResolvedValue({available: true, info: 'Discrete GPU'});
        workerMocks.pipeline.mockRejectedValue(new Error('GPU init failed'));

        const workerModule = await import('@/src/features/video-subtitle/offscreen/transcription.worker');
        workerModule.startVideoTranscriptionWorker();
        scope.onmessage?.({data: {requestId: 1, type: 'prepare', model: 'tiny'}});
        await waitForWorkerMessages(scope, 1);

        expect(workerMocks.pipeline.mock.calls.map(([, , options]) => options.device)).toEqual(['webgpu']);
        expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({success: false, error: 'GPU init failed', retryWithCpu: true}));
        expect(workerMocks.pipeline).toHaveBeenCalledTimes(1);
        expect(webGpuMocks.probeWebGpu).toHaveBeenCalledTimes(1);
        vi.unstubAllGlobals();
    });

    it('显式源语言的 GPU 推理失败后释放 session 并回传 fresh CPU 重试提示', async () => {
        vi.resetModules();
        const scope = createWorkerScope();
        vi.stubGlobal('self', scope);
        vi.stubGlobal('navigator', {hardwareConcurrency: 4});
        workerMocks.pipeline.mockReset();
        webGpuMocks.probeWebGpu.mockReset().mockResolvedValue({available: true, info: 'Discrete GPU'});
        const gpuTranscriber: any = vi.fn(async () => { throw new Error('GPU inference failed'); });
        gpuTranscriber.dispose = vi.fn(async () => undefined);
        workerMocks.pipeline.mockResolvedValue(gpuTranscriber);

        const workerModule = await import('@/src/features/video-subtitle/offscreen/transcription.worker');
        workerModule.startVideoTranscriptionWorker();
        scope.onmessage?.({data: {
            requestId: 1,
            type: 'transcribe',
            model: 'tiny',
            sourceLanguage: 'en-US',
            audio: new Float32Array([0.04, 0.04, 0.04, 0.04]),
        }});
        await waitForWorkerMessages(scope, 1);

        expect(gpuTranscriber.dispose).toHaveBeenCalledTimes(1);
        expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({success: false, error: 'GPU inference failed', retryWithCpu: true}));
        expect(workerMocks.pipeline).toHaveBeenCalledTimes(1);
        vi.unstubAllGlobals();
    });

    it('WASM 推理失败时直接返回错误，不再次创建或重试 session', async () => {
        vi.resetModules();
        const scope = createWorkerScope();
        vi.stubGlobal('self', scope);
        vi.stubGlobal('navigator', {hardwareConcurrency: 1});
        workerMocks.pipeline.mockReset();
        webGpuMocks.probeWebGpu.mockReset().mockResolvedValue({available: false, info: ''});
        const cpuTranscriber: any = vi.fn(async () => { throw new Error('CPU inference failed'); });
        workerMocks.pipeline.mockResolvedValue(cpuTranscriber);

        const workerModule = await import('@/src/features/video-subtitle/offscreen/transcription.worker');
        workerModule.startVideoTranscriptionWorker();
        scope.onmessage?.({data: {
            requestId: 1,
            type: 'transcribe',
            model: 'tiny',
            sourceLanguage: 'en',
            audio: new Float32Array([0.04, 0.04, 0.04, 0.04]),
        }});
        await waitForWorkerMessages(scope, 1);

        expect(cpuTranscriber).toHaveBeenCalledTimes(1);
        expect(workerMocks.pipeline).toHaveBeenCalledTimes(1);
        expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({success: false, error: 'CPU inference failed'}));
        expect(scope.postMessage.mock.calls.at(-1)?.[0]).not.toHaveProperty('retryWithCpu');
        vi.unstubAllGlobals();
    });

    it('收到 device wasm 时释放 GPU session 并锁定本 Worker 使用 WASM', async () => {
        vi.resetModules();
        const scope = createWorkerScope();
        vi.stubGlobal('self', scope);
        vi.stubGlobal('navigator', {hardwareConcurrency: 4});
        workerMocks.pipeline.mockReset();
        webGpuMocks.probeWebGpu.mockReset().mockResolvedValue({available: true, info: 'Discrete GPU'});
        const gpuTranscriber: any = vi.fn(async () => ({text: 'GPU result', chunks: []}));
        gpuTranscriber.dispose = vi.fn(async () => undefined);
        const cpuTranscriber: any = vi.fn(async () => ({text: 'CPU result', chunks: []}));
        workerMocks.pipeline
            .mockResolvedValueOnce(gpuTranscriber)
            .mockResolvedValueOnce(cpuTranscriber);

        const workerModule = await import('@/src/features/video-subtitle/offscreen/transcription.worker');
        workerModule.startVideoTranscriptionWorker();
        scope.onmessage?.({data: {requestId: 1, type: 'prepare', model: 'tiny'}});
        await waitForWorkerMessages(scope, 1);
        scope.onmessage?.({data: {requestId: 2, type: 'prepare', model: 'tiny', device: 'wasm'}});
        await waitForWorkerMessages(scope, 2);

        expect(gpuTranscriber.dispose).toHaveBeenCalledTimes(1);
        expect(workerMocks.pipeline.mock.calls.map(([, , options]) => options.device)).toEqual(['webgpu', 'wasm']);
        expect(scope.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({success: true, backend: 'wasm', dtype: 'q4'}));
        expect(webGpuMocks.probeWebGpu).toHaveBeenCalledTimes(1);
        vi.unstubAllGlobals();
    });

    it('为显式韩语和 auto 构建独立 transcribe 参数，auto 会清除上次语言', () => {
        const korean = buildWhisperTranscriptionGenerationOptions('tiny', 'ko-KR', 2, 'criteria');
        const english = buildWhisperTranscriptionGenerationOptions('tiny', 'en-US', 2, 'criteria');
        const automatic = buildWhisperTranscriptionGenerationOptions('tiny', 'auto', 2, 'criteria');
        expect(korean).toMatchObject({language: 'ko', task: 'transcribe', stopping_criteria: 'criteria'});
        expect(english.language).toBe('en');
        expect(automatic).toMatchObject({language: null, task: 'transcribe'});
        expect(korean).not.toBe(automatic);
        expect(normalizeWhisperSourceLanguage(undefined)).toBeNull();
        expect(normalizeWhisperSourceLanguage('')).toBeNull();
        expect(normalizeWhisperSourceLanguage('_')).toBeNull();
        expect(normalizeWhisperSourceLanguage('automatic')).toBeNull();
        expect(normalizeWhisperSourceLanguage('  ko_KR ')).toBe('ko');
    });

    it('按模型和音频时长限制 token 预算，不允许负时长扩大请求', () => {
        expect(buildWhisperTranscriptionGenerationOptions('tiny', 'ko', -1, null).max_new_tokens).toBe(24);
        expect(buildWhisperTranscriptionGenerationOptions('tiny', 'en', 20, null).max_new_tokens).toBe(64);
        expect(buildWhisperTranscriptionGenerationOptions('base', 'en', 20, null).max_new_tokens).toBe(96);
        expect(buildWhisperTranscriptionGenerationOptions('base', 'ko', 1, null).max_new_tokens).toBe(32);
    });

    it('中文与日韩对白获得足够 token 预算，长音频仍保持有界', () => {
        expect(buildWhisperTranscriptionGenerationOptions('tiny', 'zh-Hans', 10, null).max_new_tokens).toBe(100);
        expect(buildWhisperTranscriptionGenerationOptions('tiny', 'ja', 30, null).max_new_tokens).toBe(128);
        expect(buildWhisperTranscriptionGenerationOptions('base', 'ko', 14, null).max_new_tokens).toBe(160);
        expect(buildWhisperTranscriptionGenerationOptions('base', 'zh', 1, null).max_new_tokens).toBe(32);
    });

    it('从首个 decoder step 的多语语言 token logits 选择韩语并计算置信度', () => {
        const result = chooseWhisperSourceLanguage({
            data: new Float32Array([0, 2, 9, 3, 1]), dims: [1, 1, 5],
        }, {isMultilingual: true, langToId: {'<|en|>': 1, '<|ko|>': 2, '<|zh|>': 3}});
        expect(result?.language).toBe('ko');
        expect(result?.confidence).toBeGreaterThan(0.99);
        expect(chooseWhisperSourceLanguage({data: [1, 2], dims: [1, 1, 4]}, {langToId: {'<|ko|>': 3}})).toBeNull();
        expect(chooseWhisperSourceLanguage({data: [1], dims: [1, 1, 1]}, {isMultilingual: false, langToId: {'<|ko|>': 0}})).toBeNull();
        expect(chooseWhisperSourceLanguage({data: [1], dims: [1, 1, 1]}, {isMultilingual: true, langToId: {'bad': 0}})).toBeNull();
        expect(chooseWhisperSourceLanguage({data: [1], dims: [1, 1, 1]}, {isMultilingual: true, langToId: {'<|english|>': 0}})).toBeNull();
        expect(chooseWhisperSourceLanguage({data: [1], dims: [1, 1, 1]}, {isMultilingual: true, langToId: {'<|--|>': 0}})).toBeNull();
        expect(chooseWhisperSourceLanguage({data: [1, 2], dims: [1, 1, 2]}, {isMultilingual: true, langToId: {'<|ko|>': '1'}})?.language).toBe('ko');
        expect(chooseWhisperSourceLanguage(null, {langToId: {'<|ko|>': 0}})).toBeNull();
        expect(chooseWhisperSourceLanguage({data: {length: 'bad'} as unknown as ArrayLike<number>}, {langToId: {'<|ko|>': 0}})).toBeNull();
        expect(chooseWhisperSourceLanguage({data: [1]}, {langToId: null})).toBeNull();
        expect(chooseWhisperSourceLanguage({data: [1], dims: [1, 1, 0]}, {langToId: {'<|ko|>': 0}})).toBeNull();
        expect(chooseWhisperSourceLanguage({data: [1], dims: [1, 1, 2]}, {langToId: {'<|ko|>': 1}})).toBeNull();
        expect(chooseWhisperSourceLanguage({data: [Number.NaN], dims: [1, 1, 1]}, {langToId: {'<|ko|>': 0}})).toBeNull();
        expect(chooseWhisperSourceLanguage({data: [1], dims: undefined}, {langToId: {'<|ko|>': 0}})?.language).toBe('ko');
    });

    it('把连续缺失 timestamp 的 chunks 分成单调区间', () => {
        const result = parseWhisperChunkTimestamps([
            {text: 'first'},
            {text: 'second'},
        ], 2_000);
        expect(result).toEqual([
            {startMs: 0, endMs: 1_000, text: 'first'},
            {startMs: 1_000, endMs: 2_000, text: 'second'},
        ]);
    });

    it('使用下一段已知起点填补缺失结束点并避免相撞', () => {
        const result = parseWhisperChunkTimestamps([
            {timestamp: [0, null], text: 'first'},
            {timestamp: [1.5, 2], text: 'second'},
        ], 2_000);
        expect(result[0]).toMatchObject({startMs: 0, endMs: 1_500});
        expect(result[1]).toMatchObject({startMs: 1_500, endMs: 2_000});
    });

    it('过滤空文本并限制越界时间', () => {
        const result = parseWhisperChunkTimestamps([
            {timestamp: [-1, 99], text: '  kept  '},
            {timestamp: [99, 100], text: ''},
        ], 1_000);
        expect(result).toEqual([{startMs: 0, endMs: 1_000, text: 'kept'}]);
    });

    it('修复相同起止点为最小可见区间', () => {
        const result = parseWhisperChunkTimestamps([{timestamp: [1, 1], text: 'edge'}], 2_000);
        expect(result[0]).toMatchObject({startMs: 1_000, endMs: 1_400});
    });
    it('对非法音频时长和非字符串文本返回空结果', () => {
        expect(parseWhisperChunkTimestamps([{timestamp: [0, 1], text: 123}], Number.NaN)).toEqual([]);
    });
});
