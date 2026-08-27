import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    chromeOffscreenClient,
    createOffscreenClient,
    OFFSCREEN_READY_MESSAGE_TYPE,
    type OffscreenDocumentApi,
    type OffscreenRuntimeApi,
} from '@/src/platform/offscreen/client';

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, resolve, reject};
}

function createRuntime(options: {
    contexts?: unknown[];
    response?: unknown;
    runtimeError?: {message?: string};
} = {}) {
    let runtimeError = options.runtimeError;
    const getContexts = vi.fn(async () => options.contexts ?? []);
    const sendMessage = vi.fn((message: unknown, callback: (response: unknown) => void) => {
        callback((message as {type?: unknown})?.type === OFFSCREEN_READY_MESSAGE_TYPE
            ? {success: true, ready: true}
            : options.response);
    });
    const runtime: OffscreenRuntimeApi = {
        get lastError() {
            return runtimeError;
        },
        getContexts,
        sendMessage,
    };
    return {
        getContexts,
        runtime,
        sendMessage,
        setRuntimeError(error: {message?: string} | undefined) {
            runtimeError = error;
        },
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('Offscreen platform client', () => {
    it('reports document presence without creating it', async () => {
        const missingOffscreen = createRuntime({contexts: [{}]});
        const missingClient = createOffscreenClient({
            getRuntime: () => missingOffscreen.runtime,
            getOffscreen: () => undefined,
        });
        await expect(missingClient.hasDocument()).resolves.toBe(false);
        expect(missingOffscreen.getContexts).not.toHaveBeenCalled();

        const missingGetContextsRuntime: OffscreenRuntimeApi = {
            sendMessage: vi.fn(),
        };
        const missingGetContextsClient = createOffscreenClient({
            getRuntime: () => missingGetContextsRuntime,
            getOffscreen: () => ({createDocument: vi.fn(async () => undefined)}),
        });
        await expect(missingGetContextsClient.hasDocument()).resolves.toBe(false);

        const absent = createRuntime();
        const absentClient = createOffscreenClient({
            getRuntime: () => absent.runtime,
            getOffscreen: () => ({createDocument: vi.fn(async () => undefined)}),
        });
        await expect(absentClient.hasDocument()).resolves.toBe(false);
        expect(absent.getContexts).toHaveBeenCalledWith({contextTypes: ['OFFSCREEN_DOCUMENT']});

        const present = createRuntime({contexts: [{contextType: 'OFFSCREEN_DOCUMENT'}]});
        const presentClient = createOffscreenClient({
            getRuntime: () => present.runtime,
            getOffscreen: () => ({createDocument: vi.fn(async () => undefined)}),
        });
        await expect(presentClient.hasDocument()).resolves.toBe(true);
    });

    it('rejects unsupported creation APIs and wraps context lookup failures', async () => {
        const runtime = createRuntime();
        await expect(createOffscreenClient({
            getRuntime: () => runtime.runtime,
            getOffscreen: () => undefined,
        }).ensureDocument()).rejects.toThrow('当前浏览器不支持扩展 Offscreen 文档');

        await expect(createOffscreenClient({
            getRuntime: () => runtime.runtime,
            getOffscreen: () => ({}) as OffscreenDocumentApi,
        }).ensureDocument()).rejects.toThrow('当前浏览器不支持扩展 Offscreen 文档');

        const noLookupRuntime: OffscreenRuntimeApi = {sendMessage: vi.fn()};
        await expect(createOffscreenClient({
            getRuntime: () => noLookupRuntime,
            getOffscreen: () => ({createDocument: vi.fn(async () => undefined)}),
        }).ensureDocument()).rejects.toThrow('无法创建 Offscreen 文档：当前浏览器不支持查询 Offscreen 文档');

        const stringFailure = createRuntime();
        stringFailure.getContexts.mockRejectedValueOnce('lookup failed');
        await expect(createOffscreenClient({
            getRuntime: () => stringFailure.runtime,
            getOffscreen: () => ({createDocument: vi.fn(async () => undefined)}),
        }).ensureDocument()).rejects.toThrow('无法创建 Offscreen 文档：lookup failed');
    });

    it('reuses an existing document and deduplicates concurrent creation', async () => {
        const existing = createRuntime({contexts: [{}]});
        const existingCreate = vi.fn(async () => undefined);
        await expect(createOffscreenClient({
            getRuntime: () => existing.runtime,
            getOffscreen: () => ({createDocument: existingCreate}),
        }).ensureDocument()).resolves.toBeUndefined();
        expect(existingCreate).not.toHaveBeenCalled();

        const contextLookup = deferred<unknown[]>();
        const creation = deferred<void>();
        const concurrentRuntime = createRuntime();
        concurrentRuntime.getContexts
            .mockImplementationOnce(() => contextLookup.promise);
        const createDocument = vi.fn(() => creation.promise);
        const client = createOffscreenClient({
            getRuntime: () => concurrentRuntime.runtime,
            getOffscreen: () => ({createDocument}),
            documentUrl: 'pages/offscreen.html',
        });

        const first = client.ensureDocument();
        const second = client.ensureDocument();
        contextLookup.resolve([]);
        await vi.waitFor(() => expect(createDocument).toHaveBeenCalledOnce());
        expect(concurrentRuntime.getContexts).toHaveBeenCalledOnce();
        expect(createDocument).toHaveBeenCalledOnce();
        expect(createDocument).toHaveBeenCalledWith({
            url: 'pages/offscreen.html',
            reasons: ['DOM_SCRAPING', 'AUDIO_PLAYBACK'],
            justification: 'FluentRead needs an extension-owned DOM for Translation API, OCR, and CSP-independent TTS playback',
        });
        creation.resolve();
        await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    });

    it('requires a ready receiver and rebuilds a context that has no message listener once', async () => {
        let runtimeError: {message?: string} | undefined;
        let readyAttempts = 0;
        const getContexts = vi.fn(async () => [{}]);
        const sendMessage = vi.fn((message: unknown, callback: (response: unknown) => void) => {
            if ((message as {type?: unknown})?.type === OFFSCREEN_READY_MESSAGE_TYPE) {
                readyAttempts += 1;
                if (readyAttempts === 1) {
                    runtimeError = {message: 'Could not establish connection. Receiving end does not exist.'};
                    callback(undefined);
                    runtimeError = undefined;
                    return;
                }
                callback({success: true, ready: true});
                return;
            }
            callback({success: true, value: 7});
        });
        const runtime: OffscreenRuntimeApi = {
            get lastError() {
                return runtimeError;
            },
            getContexts,
            sendMessage,
        };
        const closeDocument = vi.fn(async () => undefined);
        const createDocument = vi.fn(async () => undefined);
        const client = createOffscreenClient({
            getRuntime: () => runtime,
            getOffscreen: () => ({createDocument, closeDocument}),
            readyRetryAttempts: 1,
            readyRetryDelay: vi.fn(async () => undefined),
        });

        await expect(client.send<{success: boolean; value: number}>({type: 'PING'}))
            .resolves.toEqual({success: true, value: 7});
        expect(closeDocument).toHaveBeenCalledOnce();
        expect(createDocument).toHaveBeenCalledOnce();
        expect(readyAttempts).toBe(2);
        expect(sendMessage).toHaveBeenLastCalledWith(
            {type: 'PING', target: 'offscreen'},
            expect.any(Function),
        );
    });

    it('waits through a non-ready handshake before accepting the receiver', async () => {
        let readyAttempts = 0;
        const runtime: OffscreenRuntimeApi = {
            getContexts: vi.fn(async () => [{}]),
            sendMessage: vi.fn((message: unknown, callback: (response: unknown) => void) => {
                if ((message as {type?: unknown})?.type === OFFSCREEN_READY_MESSAGE_TYPE) {
                    readyAttempts += 1;
                    callback(readyAttempts === 1
                        ? {success: true, ready: false}
                        : {success: true, ready: true});
                    return;
                }
                callback({success: true});
            }),
        };
        const client = createOffscreenClient({
            getRuntime: () => runtime,
            getOffscreen: () => ({createDocument: vi.fn(async () => undefined)}),
        });

        await expect(client.ensureDocument()).resolves.toBeUndefined();
        expect(readyAttempts).toBe(2);
    });

    it('reports a failed receiver rebuild and preserves a non-receiver business error', async () => {
        let missingRuntimeError: {message?: string} | undefined;
        const missingRuntime: OffscreenRuntimeApi = {
            get lastError() {
                return missingRuntimeError;
            },
            getContexts: vi.fn(async () => [{}]),
            sendMessage: vi.fn((_message: unknown, callback: (response: unknown) => void) => {
                missingRuntimeError = {message: 'Could not establish connection.'};
                callback(undefined);
                missingRuntimeError = undefined;
            }),
        };
        const missingClient = createOffscreenClient({
            getRuntime: () => missingRuntime,
            getOffscreen: () => ({createDocument: vi.fn(async () => undefined)}),
            readyRetryAttempts: 1,
        });
        await expect(missingClient.ensureDocument())
            .rejects.toThrow('无法创建 Offscreen 文档：当前浏览器无法重建失去接收端的 Offscreen 文档');

        let businessRuntimeError: {message?: string} | undefined;
        const businessRuntime: OffscreenRuntimeApi = {
            get lastError() {
                return businessRuntimeError;
            },
            getContexts: vi.fn(async () => [{}]),
            sendMessage: vi.fn((message: unknown, callback: (response: unknown) => void) => {
                if ((message as {type?: unknown})?.type === OFFSCREEN_READY_MESSAGE_TYPE) {
                    callback({success: true, ready: true});
                    return;
                }
                businessRuntimeError = {message: 'port closed'};
                callback(undefined);
                businessRuntimeError = undefined;
            }),
        };
        const businessClient = createOffscreenClient({
            getRuntime: () => businessRuntime,
            getOffscreen: () => ({createDocument: vi.fn(async () => undefined)}),
        });
        await expect(businessClient.send({type: 'PING'})).rejects.toThrow('port closed');
    });

    it('rebuilds and retries one business message when the ready receiver disappears', async () => {
        let runtimeError: {message?: string} | undefined;
        let businessAttempts = 0;
        const sendMessage = vi.fn((message: unknown, callback: (response: unknown) => void) => {
            if ((message as {type?: unknown})?.type === OFFSCREEN_READY_MESSAGE_TYPE) {
                callback({success: true, ready: true});
                return;
            }
            businessAttempts += 1;
            if (businessAttempts === 1) {
                runtimeError = {message: 'Could not establish connection. Receiving end does not exist.'};
                callback(undefined);
                runtimeError = undefined;
                return;
            }
            callback({success: true, value: 9});
        });
        const runtime: OffscreenRuntimeApi = {
            get lastError() {
                return runtimeError;
            },
            getContexts: vi.fn(async () => [{}]),
            sendMessage,
        };
        const closeDocument = vi.fn(async () => undefined);
        const createDocument = vi.fn(async () => undefined);
        const client = createOffscreenClient({
            getRuntime: () => runtime,
            getOffscreen: () => ({createDocument, closeDocument}),
            readyRetryAttempts: 1,
        });

        await expect(client.send<{success: boolean; value: number}>({type: 'PING'}))
            .resolves.toEqual({success: true, value: 9});
        expect(businessAttempts).toBe(2);
        expect(closeDocument).toHaveBeenCalledOnce();
        expect(createDocument).toHaveBeenCalledOnce();
    });

    it('does not let an in-flight ordinary probe consume a forced rebuild', async () => {
        let runtimeError: {message?: string} | undefined;
        let readyAttempts = 0;
        let businessAttempts = 0;
        let concurrentEnsure: Promise<void> | undefined;
        const closeDocument = vi.fn(async () => undefined);
        const createDocument = vi.fn(async () => undefined);
        let client: ReturnType<typeof createOffscreenClient>;
        const runtime: OffscreenRuntimeApi = {
            get lastError() {
                return runtimeError;
            },
            getContexts: vi.fn(async () => [{}]),
            sendMessage: vi.fn((message: unknown, callback: (response: unknown) => void) => {
                if ((message as {type?: unknown})?.type === OFFSCREEN_READY_MESSAGE_TYPE) {
                    readyAttempts += 1;
                    if (readyAttempts === 2) {
                        runtimeError = {message: 'Could not establish connection. Receiving end does not exist.'};
                        callback(undefined);
                        runtimeError = undefined;
                        return;
                    }
                    callback({success: true, ready: true});
                    return;
                }

                businessAttempts += 1;
                if (businessAttempts === 1) concurrentEnsure = client.ensureDocument();
                if (closeDocument.mock.calls.length === 0) {
                    runtimeError = {message: 'Could not establish connection. Receiving end does not exist.'};
                    callback(undefined);
                    runtimeError = undefined;
                    return;
                }
                callback({success: true, value: 11});
            }),
        };
        client = createOffscreenClient({
            getRuntime: () => runtime,
            getOffscreen: () => ({createDocument, closeDocument}),
            readyRetryAttempts: 1,
        });

        await expect(client.send<{success: boolean; value: number}>({type: 'PING'}))
            .resolves.toEqual({success: true, value: 11});
        await expect(concurrentEnsure).resolves.toBeUndefined();
        expect(readyAttempts).toBe(3);
        expect(businessAttempts).toBe(2);
        expect(closeDocument).toHaveBeenCalledOnce();
        expect(createDocument).toHaveBeenCalledOnce();
    });

    it('still forces a rebuild after an in-flight ordinary probe succeeds', async () => {
        let runtimeError: {message?: string} | undefined;
        let readyAttempts = 0;
        let businessAttempts = 0;
        let concurrentEnsure: Promise<void> | undefined;
        const closeDocument = vi.fn(async () => undefined);
        const createDocument = vi.fn(async () => undefined);
        let client: ReturnType<typeof createOffscreenClient>;
        const runtime: OffscreenRuntimeApi = {
            get lastError() {
                return runtimeError;
            },
            getContexts: vi.fn(async () => [{}]),
            sendMessage: vi.fn((message: unknown, callback: (response: unknown) => void) => {
                if ((message as {type?: unknown})?.type === OFFSCREEN_READY_MESSAGE_TYPE) {
                    readyAttempts += 1;
                    callback({success: true, ready: true});
                    return;
                }

                businessAttempts += 1;
                if (businessAttempts === 1) concurrentEnsure = client.ensureDocument();
                if (closeDocument.mock.calls.length === 0) {
                    runtimeError = {message: 'Could not establish connection. Receiving end does not exist.'};
                    callback(undefined);
                    runtimeError = undefined;
                    return;
                }
                callback({success: true, value: 13});
            }),
        };
        client = createOffscreenClient({
            getRuntime: () => runtime,
            getOffscreen: () => ({createDocument, closeDocument}),
            readyRetryAttempts: 1,
        });

        await expect(client.send<{success: boolean; value: number}>({type: 'PING'}))
            .resolves.toEqual({success: true, value: 13});
        await expect(concurrentEnsure).resolves.toBeUndefined();
        expect(readyAttempts).toBe(3);
        expect(businessAttempts).toBe(2);
        expect(closeDocument).toHaveBeenCalledOnce();
        expect(createDocument).toHaveBeenCalledOnce();
    });

    it('reuses a fresh document created by an in-flight ordinary probe', async () => {
        let runtimeError: {message?: string} | undefined;
        let readyAttempts = 0;
        let businessAttempts = 0;
        let concurrentEnsure: Promise<void> | undefined;
        const getContexts = vi.fn()
            .mockResolvedValueOnce([{}])
            .mockResolvedValueOnce([]);
        const closeDocument = vi.fn(async () => undefined);
        const createDocument = vi.fn(async () => undefined);
        let client: ReturnType<typeof createOffscreenClient>;
        const runtime: OffscreenRuntimeApi = {
            get lastError() {
                return runtimeError;
            },
            getContexts,
            sendMessage: vi.fn((message: unknown, callback: (response: unknown) => void) => {
                if ((message as {type?: unknown})?.type === OFFSCREEN_READY_MESSAGE_TYPE) {
                    readyAttempts += 1;
                    callback({success: true, ready: true});
                    return;
                }

                businessAttempts += 1;
                if (businessAttempts === 1) concurrentEnsure = client.ensureDocument();
                if (createDocument.mock.calls.length === 0) {
                    runtimeError = {message: 'Could not establish connection. Receiving end does not exist.'};
                    callback(undefined);
                    runtimeError = undefined;
                    return;
                }
                callback({success: true, value: 17});
            }),
        };
        client = createOffscreenClient({
            getRuntime: () => runtime,
            getOffscreen: () => ({createDocument, closeDocument}),
            readyRetryAttempts: 1,
        });

        await expect(client.send<{success: boolean; value: number}>({type: 'PING'}))
            .resolves.toEqual({success: true, value: 17});
        await expect(concurrentEnsure).resolves.toBeUndefined();
        expect(getContexts).toHaveBeenCalledTimes(2);
        expect(readyAttempts).toBe(2);
        expect(businessAttempts).toBe(2);
        expect(closeDocument).not.toHaveBeenCalled();
        expect(createDocument).toHaveBeenCalledOnce();
    });

    it('clears a failed creation promise so a later default-url attempt can retry', async () => {
        const runtime = createRuntime();
        const createDocument = vi.fn()
            .mockRejectedValueOnce(new Error('creation denied'))
            .mockResolvedValueOnce(undefined);
        const client = createOffscreenClient({
            getRuntime: () => runtime.runtime,
            getOffscreen: () => ({createDocument}),
            documentUrl: '',
        });

        await expect(client.ensureDocument()).rejects.toThrow('无法创建 Offscreen 文档：creation denied');
        await expect(client.ensureDocument()).resolves.toBeUndefined();
        expect(createDocument).toHaveBeenCalledTimes(2);
        expect(createDocument).toHaveBeenLastCalledWith(expect.objectContaining({url: 'offscreen.html'}));
    });

    it('sends a targeted message after ensuring a document and surfaces runtime callback errors', async () => {
        const runtime = createRuntime({contexts: [{}], response: {success: true, value: 1}});
        const client = createOffscreenClient({
            getRuntime: () => runtime.runtime,
            getOffscreen: () => ({createDocument: vi.fn(async () => undefined)}),
        });

        await expect(client.send<{success: boolean; value: number}>({type: 'PING'}))
            .resolves.toEqual({success: true, value: 1});
        expect(runtime.sendMessage).toHaveBeenCalledWith(
            {type: 'PING', target: 'offscreen'},
            expect.any(Function),
        );

        runtime.setRuntimeError({message: 'port closed'});
        await expect(client.send({type: 'PING'})).rejects.toThrow('port closed');
        runtime.setRuntimeError({});
        await expect(client.send({type: 'PING'})).rejects.toThrow('Offscreen 消息发送失败');
    });

    it('does not create for optional sends and propagates synchronous messaging failures', async () => {
        const absent = createRuntime();
        const absentCreate = vi.fn(async () => undefined);
        const absentClient = createOffscreenClient({
            getRuntime: () => absent.runtime,
            getOffscreen: () => ({createDocument: absentCreate}),
        });
        await expect(absentClient.sendIfPresent({type: 'STOP'})).resolves.toBeUndefined();
        expect(absentCreate).not.toHaveBeenCalled();
        expect(absent.sendMessage).not.toHaveBeenCalled();

        const present = createRuntime({contexts: [{}], response: {success: true}});
        const presentClient = createOffscreenClient({
            getRuntime: () => present.runtime,
            getOffscreen: () => ({createDocument: vi.fn(async () => undefined)}),
        });
        await expect(presentClient.sendIfPresent({type: 'STOP'})).resolves.toEqual({success: true});

        present.sendMessage.mockImplementationOnce(() => {
            throw new TypeError('send failed');
        });
        await expect(presentClient.sendIfPresent({type: 'STOP'})).rejects.toThrow('send failed');
    });

    it('binds the production singleton lazily to the Chrome globals', async () => {
        const runtime = createRuntime();
        vi.stubGlobal('chrome', {
            runtime: runtime.runtime,
            offscreen: {createDocument: vi.fn(async () => undefined)},
        });

        await expect(chromeOffscreenClient.hasDocument()).resolves.toBe(false);
        expect(runtime.getContexts).toHaveBeenCalledWith({contextTypes: ['OFFSCREEN_DOCUMENT']});
    });
});
