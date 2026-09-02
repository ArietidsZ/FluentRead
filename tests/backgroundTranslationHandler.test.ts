import {describe, expect, it, vi} from 'vitest';
import {
    createTranslationCancelHandler,
    createTranslationRequestFallback,
    createTranslationRequestRegistry,
    parseTranslationRequest,
    type TranslationRequestContext,
} from '@/src/app/background/handlers/translation';
import {
    attachTranslationRequestControl,
    getTranslationRequestControl,
} from '@/src/services/translation/requestSnapshot';

describe('background translation fallback handler', () => {
    it('只认无 type 且自有 origin 的历史翻译消息', () => {
        const fallback = createTranslationRequestFallback({
            translate: vi.fn(),
            serializeError: vi.fn(),
        });

        expect(fallback.canHandle({origin: 'hello'})).toBe(true);
        expect(fallback.canHandle({origin: ['a', 'b']})).toBe(true);
        expect(fallback.canHandle(Object.create({origin: 'prototype'}))).toBe(false);
        expect(fallback.canHandle({type: 'unknown', origin: 'hello'})).toBe(false);
        expect(fallback.canHandle(null)).toBe(false);
        expect(fallback.canHandle([])).toBe(false);
        expect(fallback.canHandle({context: 'missing origin'})).toBe(false);
    });

    it('只把协议允许的字段传给 broker', async () => {
        const translate = vi.fn().mockResolvedValue('你好');
        const fallback = createTranslationRequestFallback({translate, serializeError: vi.fn()});
        const candidate = {
            origin: 'hello',
            context: 'title',
            pageContext: 'article',
            enableAIContext: true,
            aiMultiSegment: true,
            useCache: false,
            serviceOverride: 'google',
            modelOverride: 'model',
            thinkingOverride: true,
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            sourceLanguageDetectionText: 'Bonjour le monde.',
            requestTimeoutMs: 12_000,
            clientRequestId: 'translation-request-1',
            injected: 'must-not-pass',
        };

        await expect(fallback.handle(candidate, undefined)).resolves.toBe('你好');
        expect(translate).toHaveBeenCalledWith({
            origin: 'hello',
            context: 'title',
            pageContext: 'article',
            enableAIContext: true,
            aiMultiSegment: true,
            useCache: false,
            serviceOverride: 'google',
            modelOverride: 'model',
            thinkingOverride: true,
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            sourceLanguageDetectionText: 'Bonjour le monde.',
            requestTimeoutMs: 12_000,
        });
        const brokerMessage = translate.mock.calls[0]?.[0];
        expect(brokerMessage).not.toHaveProperty('clientRequestId');
        expect(getTranslationRequestControl(brokerMessage)).toMatchObject({
            signal: expect.any(AbortSignal),
            ownershipKey: expect.stringContaining('translation-request-1'),
        });
    });

    it('外部 runtime parser 不复制进程内取消 symbol 或同名伪造字段', () => {
        const controller = new AbortController();
        const candidate = attachTranslationRequestControl({
            origin: 'hello',
            abortSignal: 'forged',
            ownershipKey: 'forged-string',
        }, {
            signal: controller.signal,
            ownershipKey: 'forged-symbol',
        });
        const parsed = parseTranslationRequest(candidate);

        expect(getTranslationRequestControl(candidate)).toBeDefined();
        expect(getTranslationRequestControl(parsed)).toBeUndefined();
        expect(Object.getOwnPropertySymbols(parsed)).toEqual([]);
        expect(parsed).toEqual({origin: 'hello'});
    });

    it('保留字符串数组并忽略未提供的可选字段', () => {
        expect(parseTranslationRequest({origin: ['a', 'b']})).toEqual({origin: ['a', 'b']});
        expect(parseTranslationRequest({origin: '', context: undefined})).toEqual({origin: ''});
    });

    it('无 clientRequestId 的兼容请求不附加取消所有权，保留 broker pending 去重', async () => {
        const translate = vi.fn().mockResolvedValue('译文');
        const fallback = createTranslationRequestFallback({translate, serializeError: vi.fn()});

        await expect(fallback.handle({origin: 'legacy'}, undefined)).resolves.toBe('译文');
        expect(getTranslationRequestControl(translate.mock.calls[0]?.[0])).toBeUndefined();
    });

    it('拒绝数量正确但包含稀疏空槽的 origin 数组', () => {
        const fullySparse = new Array(2);
        const trailingHole = ['ok'];
        trailingHole.length = 2;

        expect(() => parseTranslationRequest({origin: fullySparse})).toThrow('origin');
        expect(() => parseTranslationRequest({origin: trailingHole})).toThrow('origin');
    });

    it.each([
        [{origin: 1}, 'origin'],
        [{origin: ['ok', 2]}, 'origin'],
        [{origin: 'ok', context: 1}, 'context'],
        [{origin: 'ok', pageContext: false}, 'pageContext'],
        [{origin: 'ok', serviceOverride: {}}, 'serviceOverride'],
        [{origin: 'ok', modelOverride: null}, 'modelOverride'],
        [{origin: 'ok', thinkingOverride: 'yes'}, 'thinkingOverride'],
        [{origin: 'ok', sourceLanguage: []}, 'sourceLanguage'],
        [{origin: 'ok', targetLanguage: 1}, 'targetLanguage'],
        [{origin: 'ok', sourceLanguageDetectionText: {text: 'forged'}}, 'sourceLanguageDetectionText'],
        [{origin: 'ok', enableAIContext: 'yes'}, 'enableAIContext'],
        [{origin: ['ok'], aiMultiSegment: 'yes'}, 'aiMultiSegment'],
        [{origin: 'ok', useCache: 'yes'}, 'useCache'],
        [{origin: 'ok', requestTimeoutMs: Number.NaN}, 'requestTimeoutMs'],
        [{origin: 'ok', clientRequestId: ''}, 'clientRequestId'],
        [{origin: 'ok', clientRequestId: 'x'.repeat(129)}, 'clientRequestId'],
        [{origin: 'ok', clientRequestId: 'contains whitespace'}, 'clientRequestId'],
        [{origin: 'ok', clientRequestId: 1}, 'clientRequestId'],
    ])('拒绝非法协议字段 %#', (candidate, field) => {
        expect(() => parseTranslationRequest(candidate as never)).toThrow(field);
    });

    it('把校验失败与 broker 失败都交给版本化错误序列化器', async () => {
        const brokerError = new Error('provider failed');
        const translate = vi.fn()
            .mockRejectedValueOnce(brokerError)
            .mockResolvedValueOnce('unused');
        const serializeError = vi.fn((error: unknown) => ({kind: 'translation-error', error}));
        const fallback = createTranslationRequestFallback({translate, serializeError});

        await expect(fallback.handle({origin: 'hello'}, undefined)).resolves.toEqual({
            kind: 'translation-error',
            error: brokerError,
        });
        const invalid = {origin: 'hello', useCache: 'yes'};
        await expect(fallback.handle(invalid, undefined)).resolves.toMatchObject({kind: 'translation-error'});
        expect(translate).toHaveBeenCalledTimes(1);
        expect(serializeError).toHaveBeenCalledTimes(2);
    });

    it('以同一 sender + clientRequestId 精确取消在途 broker，不取消其他 ID', async () => {
        const registry = createTranslationRequestRegistry();
        const cancel = createTranslationCancelHandler(registry);
        let signal!: AbortSignal;
        const translate = vi.fn((message: Parameters<typeof getTranslationRequestControl>[0]) => {
            signal = getTranslationRequestControl(message)!.signal;
            return new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => {
                const error = new Error('provider aborted');
                error.name = 'AbortError';
                reject(error);
            }, {once: true}));
        });
        const serializeError = vi.fn((error: unknown) => error);
        const fallback = createTranslationRequestFallback<TranslationRequestContext>({
            translate, serializeError, requestRegistry: registry,
        });
        const context = {sender: {id: 'extension', tab: {id: 7}, frameId: 0, documentId: 'doc-a'}};
        const pending = fallback.handle({
            origin: 'hello',
            clientRequestId: 'translation-active',
        }, context);
        await vi.waitFor(() => expect(translate).toHaveBeenCalledOnce());

        expect(cancel.handle({
            type: 'fluentReadTranslationCancel',
            clientRequestId: 'translation-other',
        }, context)).toEqual({
            success: true,
            cancelled: false,
            clientRequestId: 'translation-other',
        });
        expect(signal.aborted).toBe(false);
        expect(cancel.handle({
            type: 'fluentReadTranslationCancel',
            clientRequestId: 'translation-active',
        }, context)).toEqual({
            success: true,
            cancelled: true,
            clientRequestId: 'translation-active',
        });
        await expect(pending).resolves.toMatchObject({name: 'AbortError'});
        expect(signal.aborted).toBe(true);
    });

    it('相同 ID 的其他页面无权取消，并拒绝在途或已完成的重复 ID', async () => {
        const registry = createTranslationRequestRegistry();
        const cancel = createTranslationCancelHandler(registry);
        const first = deferred<string>();
        let firstSignal!: AbortSignal;
        const translate = vi.fn((message: Parameters<typeof getTranslationRequestControl>[0]) => {
            firstSignal = getTranslationRequestControl(message)!.signal;
            return first.promise;
        });
        const serializeError = vi.fn((error: unknown) => error);
        const fallback = createTranslationRequestFallback<TranslationRequestContext>({
            translate, serializeError, requestRegistry: registry,
        });
        const owner = {sender: {tab: {id: 1}, frameId: 0}};
        const other = {sender: {tab: {id: 2}, frameId: 0}};
        const active = fallback.handle({origin: 'first', clientRequestId: 'same-id'}, owner);
        await vi.waitFor(() => expect(translate).toHaveBeenCalledOnce());

        expect(cancel.handle({
            type: 'fluentReadTranslationCancel', clientRequestId: 'same-id',
        }, other)).toMatchObject({cancelled: false});
        expect(firstSignal.aborted).toBe(false);
        await expect(fallback.handle({
            origin: 'duplicate', clientRequestId: 'same-id',
        }, owner)).resolves.toMatchObject({message: expect.stringContaining('clientRequestId 已在使用')});

        first.resolve('done');
        await expect(active).resolves.toBe('done');
        await expect(fallback.handle({
            origin: 'duplicate after completion', clientRequestId: 'same-id',
        }, owner)).resolves.toMatchObject({message: expect.stringContaining('clientRequestId 已在使用')});
        expect(translate).toHaveBeenCalledOnce();
    });

    it('无 tab 的扩展页按 documentId 隔离相同 URL、frame 与请求 ID', async () => {
        const registry = createTranslationRequestRegistry();
        const cancel = createTranslationCancelHandler(registry);
        const first = deferred<string>();
        let firstSignal!: AbortSignal;
        const translate = vi.fn((message: Parameters<typeof getTranslationRequestControl>[0]) => {
            firstSignal = getTranslationRequestControl(message)!.signal;
            return first.promise;
        });
        const fallback = createTranslationRequestFallback<TranslationRequestContext>({
            translate,
            serializeError: vi.fn((error: unknown) => error),
            requestRegistry: registry,
        });
        const sharedSender = {
            id: 'extension',
            url: 'chrome-extension://extension/options.html',
            frameId: 0,
        };
        const documentA = {sender: {...sharedSender, documentId: 'document-a'}};
        const documentB = {sender: {...sharedSender, documentId: 'document-b'}};
        const active = fallback.handle({
            origin: 'first',
            clientRequestId: 'same-extension-page-id',
        }, documentA);
        await vi.waitFor(() => expect(translate).toHaveBeenCalledOnce());

        expect(cancel.handle({
            type: 'fluentReadTranslationCancel',
            clientRequestId: 'same-extension-page-id',
        }, documentB)).toMatchObject({cancelled: false});
        expect(firstSignal.aborted).toBe(false);

        first.resolve('done');
        await expect(active).resolves.toBe('done');
    });

    it('处理 cancel-before-start 竞态，并严格校验 typed cancel ID', async () => {
        const registry = createTranslationRequestRegistry();
        const cancel = createTranslationCancelHandler(registry);
        const translate = vi.fn().mockResolvedValue('unused');
        const serializeError = vi.fn((error: unknown) => error);
        const fallback = createTranslationRequestFallback<TranslationRequestContext>({
            translate, serializeError, requestRegistry: registry,
        });
        const context = {sender: {tab: {id: 3}, frameId: 1}};

        expect(cancel.handle({
            type: 'fluentReadTranslationCancel', clientRequestId: 'cancel-before-start',
        }, context)).toMatchObject({cancelled: false});
        await expect(fallback.handle({
            origin: 'never starts', clientRequestId: 'cancel-before-start',
        }, context)).resolves.toMatchObject({name: 'AbortError'});
        expect(translate).not.toHaveBeenCalled();

        expect(() => cancel.handle({
            type: 'fluentReadTranslationCancel', clientRequestId: '../invalid id',
        }, context)).toThrow('clientRequestId');
    });

    it('有界保存扩展页 cancel-before-start：最旧记录淘汰后可启动，最新记录仍阻止启动', async () => {
        const registry = createTranslationRequestRegistry();
        const cancel = createTranslationCancelHandler(registry);
        const context = {sender: {id: 'extension', url: 'chrome-extension://extension/options.html'}};
        const translate = vi.fn().mockResolvedValue('started');
        const fallback = createTranslationRequestFallback<TranslationRequestContext>({
            translate,
            serializeError: vi.fn((error: unknown) => error),
            requestRegistry: registry,
        });
        const cancelId = (clientRequestId: string) => cancel.handle({
            type: 'fluentReadTranslationCancel', clientRequestId,
        }, context);

        for (let index = 0; index <= 512; index += 1) cancelId(`bounded-${index}`);

        await expect(fallback.handle({
            origin: 'oldest was evicted', clientRequestId: 'bounded-0',
        }, context)).resolves.toBe('started');
        await expect(fallback.handle({
            origin: 'latest remains cancelled', clientRequestId: 'bounded-512',
        }, context)).resolves.toMatchObject({name: 'AbortError'});
        expect(translate).toHaveBeenCalledOnce();
    });

    it('重复 cancel 不占用 cancel-before-start 历史容量', async () => {
        const registry = createTranslationRequestRegistry();
        const cancel = createTranslationCancelHandler(registry);
        const context = {sender: {id: 'extension', url: 'chrome-extension://extension/options.html'}};
        const translate = vi.fn().mockResolvedValue('unexpected');
        const fallback = createTranslationRequestFallback<TranslationRequestContext>({
            translate,
            serializeError: vi.fn((error: unknown) => error),
            requestRegistry: registry,
        });
        const cancelId = (clientRequestId: string) => cancel.handle({
            type: 'fluentReadTranslationCancel', clientRequestId,
        }, context);

        expect(cancelId('repeat')).toMatchObject({cancelled: false});
        expect(cancelId('repeat')).toMatchObject({cancelled: false});
        for (let index = 0; index < 511; index += 1) cancelId(`unique-${index}`);

        await expect(fallback.handle({
            origin: 'duplicate remains oldest', clientRequestId: 'repeat',
        }, context)).resolves.toMatchObject({name: 'AbortError'});
        await expect(fallback.handle({
            origin: 'latest remains cancelled', clientRequestId: 'unique-510',
        }, context)).resolves.toMatchObject({name: 'AbortError'});
        expect(translate).not.toHaveBeenCalled();
    });
});

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
}
