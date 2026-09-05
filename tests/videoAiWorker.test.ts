import {describe, expect, it, vi} from 'vitest';
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

describe('视频 AI Worker timestamp parser', () => {
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
            const language = modelCalls.length === 1 ? 'ko' : 'en';
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
        const send = (requestId: number, languageSessionKey: string) => scope.onmessage?.({data: {
            requestId, type: 'transcribe', model: 'tiny', sourceLanguage: 'auto', languageSessionKey,
            audio: new Float32Array([0, 0, 0, 0]),
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
        expect(modelCalls).toHaveLength(19);
        expect(modelCalls[0].decoder_input_ids.data[0]).toBe(0n);
        expect(transcribeCalls.slice(0, 3).map((call) => call.language)).toEqual(['ko', 'ko', 'en']);
        expect(transcribeCalls.at(-1)?.language).toBe('en');
        expect(detectionTensors.every((tensor) => tensor.disposed)).toBe(true);
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
        expect(buildWhisperTranscriptionGenerationOptions('tiny', 'ko', 20, null).max_new_tokens).toBe(64);
        expect(buildWhisperTranscriptionGenerationOptions('base', 'ko', 20, null).max_new_tokens).toBe(96);
        expect(buildWhisperTranscriptionGenerationOptions('base', 'ko', 1, null).max_new_tokens).toBe(32);
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
