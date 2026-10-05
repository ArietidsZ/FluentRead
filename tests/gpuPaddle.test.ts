import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({create: vi.fn(), detection: vi.fn(), recognition: vi.fn(), recognize: vi.fn()}));
vi.mock('onnxruntime-web/webgpu', () => ({InferenceSession: {create: mocks.create}}));
vi.mock('ppu-paddle-ocr/web', () => ({PaddleOcrService: class {
    protected options: any;protected detectionSession: any = null;protected recognitionSession: any = null;
    constructor(options: unknown) {this.options = options;}recognize = mocks.recognize;
}, DetectionService: class {constructor(...args: unknown[]) {mocks.detection(...args);}}, RecognitionService: class {constructor(...args: unknown[]) {mocks.recognition(...args);}}}));
import {GpuPaddleService} from '@/src/features/image-translation/services/gpuPaddle';
const bytes = () => ({detection: new ArrayBuffer(1), recognition: new ArrayBuffer(2), charactersDictionary: new TextEncoder().encode('a\r\n中\n').buffer as ArrayBuffer});
const session = () => ({run: vi.fn(), release: vi.fn(async () => {})});
beforeEach(() => {vi.clearAllMocks();mocks.create.mockReset();mocks.recognize.mockReset();});
afterEach(() => vi.restoreAllMocks());
describe('GPU-only Paddle model initialization', () => {
    it('owns sequential GPU sessions, keeps dictionary indices, drops source buffers and releases exactly once', async () => {
        const detection = session(), recognition = session(), model = bytes();
        mocks.create.mockResolvedValueOnce(detection).mockResolvedValueOnce(recognition);
        const service = new GpuPaddleService(model, {});await service.initialize();
        expect(mocks.create.mock.calls.map(call => call[0])).toEqual([model.detection, model.recognition]);
        expect(mocks.create.mock.calls.every(call => call[1].executionProviders.join() === 'webgpu')).toBe(true);
        expect(mocks.create.mock.calls[0][1].extra.session.disable_cpu_ep_fallback).toBe('1');
        expect(mocks.create.mock.calls[1][1].extra).toBeUndefined();
        expect(mocks.recognition.mock.calls[0][1].charactersDictionary).toEqual(['a', '中', '']);
        expect((service as any).modelBytes).toBeUndefined();
        await service.destroy();await service.destroy();expect(detection.release).toHaveBeenCalledOnce();expect(recognition.release).toHaveBeenCalledOnce();
        await expect(service.initialize()).rejects.toThrow('模型已释放');
    });
    it('releases partial initialization without invoking SDK fallback or masking the original failure', async () => {
        const detection = session();detection.release.mockRejectedValueOnce(new Error('release failed'));
        mocks.create.mockResolvedValueOnce(detection).mockRejectedValueOnce(new Error('unsupported GPU operator'));
        const service = new GpuPaddleService(bytes(), {});
        await expect(service.initialize()).rejects.toThrow('unsupported GPU operator');
        expect(mocks.create).toHaveBeenCalledTimes(2);expect(detection.release).toHaveBeenCalledOnce();
    });
    it.each([0, 1, 2])('cleans cancellation after %s model creations', async after => {
        const abort = new AbortController(), sessions: ReturnType<typeof session>[] = [];
        if (after === 0) abort.abort();
        mocks.create.mockImplementation(async () => {const value = session();sessions.push(value);if (sessions.length === after) abort.abort();return value;});
        await expect(new GpuPaddleService(bytes(), {}, abort.signal).initialize()).rejects.toMatchObject({name: 'AbortError'});
        expect(mocks.create).toHaveBeenCalledTimes(after);sessions.forEach(value => expect(value.release).toHaveBeenCalledOnce());
    });
    it('rejects an empty dictionary before allocating GPU memory', async () => {
        await expect(new GpuPaddleService({...bytes(), charactersDictionary: new ArrayBuffer(0)}, {}).initialize()).rejects.toThrow('字典为空');
        expect(mocks.create).not.toHaveBeenCalled();
    });
    it('surfaces swallowed inference errors and does not reuse a failed session', async () => {
        const detection = session(), recognition = session();recognition.run.mockRejectedValue(new Error('device lost'));
        mocks.create.mockResolvedValueOnce(detection).mockResolvedValueOnce(recognition);
        const service = new GpuPaddleService(bytes(), {});await service.initialize();
        mocks.recognize.mockImplementation(async () => {try {await recognition.run();} catch {}return {results: []};});
        const options = {flatten: true, noCache: true, strategy: 'per-box'} as const;
        await expect(service.recognizeManga({} as HTMLCanvasElement, options)).rejects.toThrow('device lost');
        await expect(service.recognizeManga({} as HTMLCanvasElement, options)).rejects.toThrow('device lost');
        await service.destroy();expect(mocks.create).toHaveBeenCalledTimes(2);
    });
    it('passes through successful recognition and releases both sessions after first release fails', async () => {
        const detection = session(), recognition = session();detection.release.mockRejectedValue(new Error('lost'));
        mocks.create.mockResolvedValueOnce(detection).mockResolvedValueOnce(recognition);
        const service = new GpuPaddleService(bytes(), {});await service.initialize();mocks.recognize.mockResolvedValue({results: []});
        expect(await service.recognizeManga({} as HTMLCanvasElement, {flatten: true, noCache: true, strategy: 'per-box'})).toEqual({results: []});
        await service.destroy();expect(recognition.release).toHaveBeenCalledOnce();
    });
});
