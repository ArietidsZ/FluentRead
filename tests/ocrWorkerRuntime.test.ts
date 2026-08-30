import {describe, expect, it, vi} from 'vitest';
import {
    createOcrWorkerRuntime,
    type OcrWorkerPort,
} from '@/src/features/image-translation/services/ocrWorkerRuntime';

type RecognitionResult = {worker: string; image: string};

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return {promise, resolve, reject};
}

function createWorker(name: string): OcrWorkerPort<RecognitionResult> {
    return {
        setParameters: vi.fn(async () => undefined),
        recognize: vi.fn(async image => ({worker: name, image})),
        terminate: vi.fn(async () => undefined),
    };
}

describe('OCR worker runtime', () => {
    it('复用同语言 Worker，并为每次识别设置稀疏文本参数', async () => {
        const worker = createWorker('eng');
        const factory = vi.fn(async () => worker);
        const runtime = createOcrWorkerRuntime({createWorker: factory, sparseTextMode: 11});

        await expect(runtime.recognize('first', 'eng')).resolves.toEqual({worker: 'eng', image: 'first'});
        await expect(runtime.recognize('second', 'eng')).resolves.toEqual({worker: 'eng', image: 'second'});

        expect(factory).toHaveBeenCalledOnce();
        expect(worker.setParameters).toHaveBeenCalledTimes(2);
        expect(worker.setParameters).toHaveBeenLastCalledWith({
            tessedit_pageseg_mode: 11,
            preserve_interword_spaces: '1',
        });
        expect(worker.recognize).toHaveBeenLastCalledWith('second', {}, {blocks: true});
    });

    it('等待正在进行的识别结束后才终止 Worker 并切换语言', async () => {
        const firstRecognition = deferred<RecognitionResult>();
        const english = createWorker('eng');
        const japanese = createWorker('jpn');
        vi.mocked(english.recognize).mockReturnValueOnce(firstRecognition.promise);
        const factory = vi.fn(async languages => languages === 'eng' ? english : japanese);
        const runtime = createOcrWorkerRuntime({createWorker: factory, sparseTextMode: 'sparse'});

        const recognizing = runtime.recognize('active', 'eng');
        await vi.waitFor(() => expect(english.recognize).toHaveBeenCalledOnce());
        const switching = runtime.recognize('next', 'jpn');

        await Promise.resolve();
        expect(english.terminate).not.toHaveBeenCalled();
        expect(factory).toHaveBeenCalledTimes(1);

        firstRecognition.resolve({worker: 'eng', image: 'active'});
        await expect(recognizing).resolves.toEqual({worker: 'eng', image: 'active'});
        await expect(switching).resolves.toEqual({worker: 'jpn', image: 'next'});
        expect(english.terminate).toHaveBeenCalledOnce();
        expect(factory).toHaveBeenLastCalledWith('jpn');
    });

    it('串行化同 Worker 的并发识别，防止参数与识别调用交叉', async () => {
        const firstRecognition = deferred<RecognitionResult>();
        const worker = createWorker('eng');
        vi.mocked(worker.recognize).mockReturnValueOnce(firstRecognition.promise);
        const runtime = createOcrWorkerRuntime({
            createWorker: vi.fn(async () => worker),
            sparseTextMode: 11,
        });

        const first = runtime.recognize('first', 'eng');
        await vi.waitFor(() => expect(worker.recognize).toHaveBeenCalledOnce());
        const second = runtime.recognize('second', 'eng');
        await Promise.resolve();
        expect(worker.setParameters).toHaveBeenCalledOnce();

        firstRecognition.resolve({worker: 'eng', image: 'first'});
        await expect(first).resolves.toEqual({worker: 'eng', image: 'first'});
        await expect(second).resolves.toEqual({worker: 'eng', image: 'second'});
        expect(worker.setParameters).toHaveBeenCalledTimes(2);
    });

    it('下载语言包也等待识别结束，并忽略旧 Worker 的终止异常', async () => {
        const recognition = deferred<RecognitionResult>();
        const english = createWorker('eng');
        const packs = createWorker('packs');
        vi.mocked(english.recognize).mockReturnValueOnce(recognition.promise);
        vi.mocked(english.terminate).mockRejectedValueOnce(new Error('already closed'));
        const runtime = createOcrWorkerRuntime({
            createWorker: vi.fn(async languages => languages === 'eng' ? english : packs),
            sparseTextMode: 11,
        });

        const active = runtime.recognize('active', 'eng');
        await vi.waitFor(() => expect(english.recognize).toHaveBeenCalledOnce());
        const downloading = runtime.ensureLanguages(['chi_sim', 'eng']);
        expect(english.terminate).not.toHaveBeenCalled();

        recognition.resolve({worker: 'eng', image: 'active'});
        await active;
        await expect(downloading).resolves.toBeUndefined();
        expect(english.terminate).toHaveBeenCalledOnce();
    });

    it('空语言列表不创建 Worker', async () => {
        const factory = vi.fn(async () => createWorker('unused'));
        const runtime = createOcrWorkerRuntime({createWorker: factory, sparseTextMode: 11});

        await expect(runtime.ensureLanguages([])).resolves.toBeUndefined();
        expect(factory).not.toHaveBeenCalled();
    });

    it('创建失败后清理状态，后续请求可以重试', async () => {
        const worker = createWorker('eng');
        const factory = vi.fn()
            .mockRejectedValueOnce(new Error('download failed'))
            .mockResolvedValueOnce(worker);
        const runtime = createOcrWorkerRuntime({createWorker: factory, sparseTextMode: 11});

        await expect(runtime.recognize('first', 'eng')).rejects.toThrow('download failed');
        await expect(runtime.recognize('retry', 'eng')).resolves.toEqual({worker: 'eng', image: 'retry'});
        expect(factory).toHaveBeenCalledTimes(2);
    });

    it('上一项识别失败后仍执行队列中的下一项', async () => {
        const worker = createWorker('eng');
        vi.mocked(worker.recognize)
            .mockRejectedValueOnce(new Error('recognize failed'))
            .mockResolvedValueOnce({worker: 'eng', image: 'second'});
        const runtime = createOcrWorkerRuntime({
            createWorker: vi.fn(async () => worker),
            sparseTextMode: 11,
        });

        const first = runtime.recognize('first', 'eng');
        const second = runtime.recognize('second', 'eng');
        await expect(first).rejects.toThrow('recognize failed');
        await expect(second).resolves.toEqual({worker: 'eng', image: 'second'});
    });

    it('取消永不结束的识别会终止旧 Worker，并允许下一请求使用新 Worker', async () => {
        const never = deferred<RecognitionResult>();
        const stuckWorker = createWorker('stuck');
        const recoveredWorker = createWorker('recovered');
        vi.mocked(stuckWorker.recognize).mockReturnValueOnce(never.promise);
        const factory = vi.fn()
            .mockResolvedValueOnce(stuckWorker)
            .mockResolvedValueOnce(recoveredWorker);
        const runtime = createOcrWorkerRuntime({createWorker: factory, sparseTextMode: 11});
        const controller = new AbortController();

        const stuck = runtime.recognize('first', 'eng', controller.signal);
        await vi.waitFor(() => expect(stuckWorker.recognize).toHaveBeenCalledOnce());
        controller.abort();

        await expect(stuck).rejects.toMatchObject({name: 'AbortError'});
        await vi.waitFor(() => expect(stuckWorker.terminate).toHaveBeenCalledOnce());
        await expect(runtime.recognize('second', 'eng')).resolves.toEqual({
            worker: 'recovered',
            image: 'second',
        });
        expect(factory).toHaveBeenCalledTimes(2);
    });

    it('预取消的识别与语言准备不会创建 Worker', async () => {
        const factory = vi.fn(async () => createWorker('unused'));
        const runtime = createOcrWorkerRuntime({createWorker: factory, sparseTextMode: 11});
        const controller = new AbortController();
        controller.abort();

        await expect(runtime.recognize('image', 'eng', controller.signal))
            .rejects.toMatchObject({name: 'AbortError'});
        await expect(runtime.ensureLanguages(['eng'], controller.signal))
            .rejects.toMatchObject({name: 'AbortError'});
        expect(factory).not.toHaveBeenCalled();
    });

    it('Worker 创建期间发生取消时命中 runAbortable 入口并终止刚创建的 Worker', async () => {
        const worker = createWorker('creating');
        const controller = new AbortController();
        const runtime = createOcrWorkerRuntime({
            createWorker: vi.fn(() => {
                controller.abort();
                return Promise.resolve(worker);
            }),
            sparseTextMode: 11,
        });

        await expect(runtime.recognize('image', 'eng', controller.signal))
            .rejects.toMatchObject({name: 'AbortError'});
        await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce());
    });

    it('取消语言切换时不让迟到的 getWorker 覆盖新 Worker 所有权', async () => {
        const oldTermination = deferred<unknown>();
        const nextCreation = deferred<OcrWorkerPort<RecognitionResult>>();
        const nextRecognition = deferred<RecognitionResult>();
        const staleCreation = deferred<OcrWorkerPort<RecognitionResult>>();
        const initialWorker = createWorker('initial');
        const nextWorker = createWorker('next');
        const staleWorker = createWorker('stale');
        vi.mocked(initialWorker.terminate).mockReturnValue(oldTermination.promise);
        vi.mocked(nextWorker.recognize).mockReturnValue(nextRecognition.promise);
        const factory = vi.fn((languages: string) => {
            if (languages === 'eng') return Promise.resolve(initialWorker);
            if (languages === 'fra') return nextCreation.promise;
            return staleCreation.promise;
        });
        const runtime = createOcrWorkerRuntime({createWorker: factory, sparseTextMode: 11});

        await runtime.recognize('seed', 'eng');
        const switchingController = new AbortController();
        const switching = runtime.recognize('switching', 'jpn', switchingController.signal);
        await vi.waitFor(() => expect(initialWorker.terminate).toHaveBeenCalledOnce());

        switchingController.abort();
        await expect(switching).rejects.toMatchObject({name: 'AbortError'});

        const nextController = new AbortController();
        const next = runtime.recognize('next', 'fra', nextController.signal);
        await vi.waitFor(() => expect(factory).toHaveBeenCalledWith('fra'));

        oldTermination.resolve(undefined);
        await Promise.resolve();
        await Promise.resolve();
        nextCreation.resolve(nextWorker);
        await vi.waitFor(() => expect(nextWorker.recognize).toHaveBeenCalledOnce());

        nextController.abort();
        await expect(next).rejects.toMatchObject({name: 'AbortError'});
        staleCreation.resolve(staleWorker);
        nextRecognition.resolve({worker: 'next', image: 'late'});
        await Promise.resolve();
        await Promise.resolve();

        expect(factory).not.toHaveBeenCalledWith('jpn');
        await vi.waitFor(() => expect(nextWorker.terminate).toHaveBeenCalledOnce());
        expect(staleWorker.terminate).not.toHaveBeenCalled();
    });

    it('操作已完成后忽略迟到的自定义 abort 回调', async () => {
        const worker = createWorker('settled');
        let abortListener: (() => void) | undefined;
        const signal = {
            aborted: false,
            addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
                abortListener = typeof listener === 'function'
                    ? () => listener(new Event('abort'))
                    : () => listener.handleEvent(new Event('abort'));
            },
            removeEventListener: vi.fn(),
        } as unknown as AbortSignal;
        const runtime = createOcrWorkerRuntime({
            createWorker: vi.fn(async () => worker),
            sparseTextMode: 11,
        });

        await expect(runtime.recognize('image', 'eng', signal))
            .resolves.toEqual({worker: 'settled', image: 'image'});
        abortListener?.();
        expect(worker.terminate).not.toHaveBeenCalled();
    });
});
