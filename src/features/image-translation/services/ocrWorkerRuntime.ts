/**
 * @file src/features/image-translation/services/ocrWorkerRuntime.ts
 * 文件职责：实现与具体 OCR 引擎无关的 Worker 生命周期和串行任务队列，保证识别、参数设置、语言切换及销毁不会在并发请求间交叉污染。
 * 主要内容：定义 OcrWorkerPort、依赖与 runtime 契约，由 createOcrWorkerRuntime 复用同语言 worker、在切换时安全终止旧实例，并提供 recognize、downloadLanguages 与 dispose。
 * 模块边界：此层不依赖 Tesseract.js 类型、浏览器 storage 或图片翻译 UI；具体 worker 工厂由 ocrRuntime 注入，语言状态记录和 Offscreen 消息编排位于其他模块。
 */
/**
 * OCR Worker 的最小能力边界。
 *
 * 这里不依赖 Tesseract.js 或 Chrome API，便于单测完整覆盖 Worker 的并发与切换语义。
 */
export interface OcrWorkerPort<TResult> {
    setParameters(parameters: Record<string, string | number>): Promise<unknown>;
    recognize(image: string, options: Record<string, never>, output: {blocks: true}): Promise<TResult>;
    terminate(): Promise<unknown>;
}

export type OcrWorkerRuntimeDependencies<TResult> = {
    createWorker: (languages: string) => Promise<OcrWorkerPort<TResult>>;
    sparseTextMode: string | number;
};

export type OcrWorkerRuntime<TResult> = {
    recognize: (image: string, languages: string, signal?: AbortSignal) => Promise<TResult>;
    ensureLanguages: (languages: string[], signal?: AbortSignal) => Promise<void>;
};

function createOcrAbortError(): Error {
    const error = new Error('图片 OCR 请求已取消');
    error.name = 'AbortError';
    return error;
}

/**
 * 串行化所有 Worker 操作，避免语言切换终止仍在识别的 Worker，也避免同一
 * Worker 的 setParameters/recognize 被另一次请求交叉覆盖。
 */
export function createOcrWorkerRuntime<TResult>(
    dependencies: OcrWorkerRuntimeDependencies<TResult>,
): OcrWorkerRuntime<TResult> {
    let workerPromise: Promise<OcrWorkerPort<TResult>> | null = null;
    let workerLanguages = '';
    let workerOwnershipGeneration = 0;
    let operationTail: Promise<void> = Promise.resolve();

    function terminateCurrentWorker(): void {
        const current = workerPromise;
        workerPromise = null;
        workerLanguages = '';
        workerOwnershipGeneration += 1;
        // terminate 本身也可能等待底层 Worker；取消请求不能继续阻塞串行尾链。
        void current?.then(worker => worker.terminate()).catch(() => undefined);
    }

    function runAbortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
        if (!signal) return operation;
        return new Promise<T>((resolve, reject) => {
            let settled = false;
            const cleanup = () => signal.removeEventListener('abort', handleAbort);
            const finish = (callback: () => void) => {
                if (settled) return;
                settled = true;
                cleanup();
                callback();
            };
            const handleAbort = () => finish(() => {
                terminateCurrentWorker();
                reject(createOcrAbortError());
            });

            if (signal.aborted) {
                handleAbort();
                return;
            }
            signal.addEventListener('abort', handleAbort, {once: true});
            void operation.then(
                value => finish(() => resolve(value)),
                error => finish(() => reject(error)),
            );
        });
    }

    function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
        // 步骤 1：无论上一项成功还是失败，后续 OCR 操作都必须继续执行。
        const result = operationTail.then(operation, operation);
        // 步骤 2：尾链只保存完成信号，调用方仍收到原始结果或异常。
        operationTail = result.then(() => undefined, () => undefined);
        return result;
    }

    async function getWorker(languages: string): Promise<OcrWorkerPort<TResult>> {
        if (workerPromise && workerLanguages === languages) return workerPromise;

        if (workerPromise) {
            const previousWorkerPromise = workerPromise;
            const ownershipGeneration = workerOwnershipGeneration;
            const assertTransitionOwnership = () => {
                if (workerOwnershipGeneration !== ownershipGeneration
                    || workerPromise !== previousWorkerPromise) {
                    throw createOcrAbortError();
                }
            };
            const previousWorker = await previousWorkerPromise.catch(() => null);
            assertTransitionOwnership();
            await previousWorker?.terminate().catch(() => undefined);
            // 调用方 abort 会立即放行队列中的下一项；旧切换恢复后只能
            // 清理自己当时拥有的 Worker，不得覆盖新请求已安装的实例。
            assertTransitionOwnership();
            workerPromise = null;
            workerLanguages = '';
        }

        const nextWorkerPromise = dependencies.createWorker(languages);
        workerPromise = nextWorkerPromise;
        workerLanguages = languages;

        try {
            return await nextWorkerPromise;
        } catch (error) {
            if (workerPromise === nextWorkerPromise) {
                workerPromise = null;
                workerLanguages = '';
            }
            throw error;
        }
    }

    return {
        recognize(image, languages, signal) {
            return runExclusive(async () => {
                if (signal?.aborted) throw createOcrAbortError();
                const worker = await runAbortable(getWorker(languages), signal);
                await runAbortable(worker.setParameters({
                    tessedit_pageseg_mode: dependencies.sparseTextMode,
                    preserve_interword_spaces: '1',
                }), signal);
                return runAbortable(worker.recognize(image, {}, {blocks: true}), signal);
            });
        },
        ensureLanguages(languages, signal) {
            if (languages.length === 0) return Promise.resolve();
            return runExclusive(async () => {
                if (signal?.aborted) throw createOcrAbortError();
                await runAbortable(getWorker(languages.join('+')), signal);
            });
        },
    };
}
