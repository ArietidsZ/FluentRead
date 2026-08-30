import {afterEach, describe, expect, it, vi} from 'vitest';
import {
    fetchImageInOffscreen,
    fetchRemoteImageForOcr,
    imageBufferToDataUrl,
    MAX_REMOTE_IMAGE_BYTES,
    normalizeRemoteImageMimeType,
    normalizeRemoteImageUrl,
    REMOTE_IMAGE_TIMEOUT_MS,
    type RemoteImageResponse,
} from '@/src/features/image-translation/services/remoteImage';

function response(options: {
    ok?: boolean;
    status?: number;
    contentType?: string | null;
    contentLength?: string | null;
    bytes?: number[];
    url?: string;
    body?: ReadableStream<Uint8Array> | null;
    arrayBuffer?: () => Promise<ArrayBuffer>;
} = {}): RemoteImageResponse {
    const headers = new Map<string, string>();
    if (options.contentType !== null) headers.set('content-type', options.contentType ?? 'image/png');
    if (options.contentLength !== null) headers.set('content-length', options.contentLength ?? '2');
    return {
        ok: options.ok ?? true,
        status: options.status ?? 200,
        url: options.url,
        headers: {get: (name) => headers.get(name) ?? null},
        body: options.body,
        arrayBuffer: options.arrayBuffer ?? (async () => new Uint8Array(options.bytes ?? [1, 2]).buffer),
    };
}

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('Offscreen 远程图片读取', () => {
    it('只接受 HTTPS X/Twitter 媒体域，并拒绝无效地址、凭据和自定义端口', () => {
        expect(normalizeRemoteImageUrl('https://pbs.twimg.com/media/demo.png?format=png'))
            .toBe('https://pbs.twimg.com/media/demo.png?format=png');
        expect(normalizeRemoteImageUrl('https://twimg.com/media/demo.png'))
            .toBe('https://twimg.com/media/demo.png');
        expect(normalizeRemoteImageUrl('https://pbs.twimg.com./media/demo.png'))
            .toBe('https://pbs.twimg.com./media/demo.png');

        for (const source of [
            '',
            'not a URL',
            'http://pbs.twimg.com/media/demo.png',
            'https://user:pass@pbs.twimg.com/media/demo.png',
            'https://pbs.twimg.com:8443/media/demo.png',
            'https://example.com/media/demo.png',
        ]) {
            expect(() => normalizeRemoteImageUrl(source)).toThrow();
        }
    });

    it('规范化图片 MIME、编码字节，并拒绝非图片和超大 buffer', () => {
        expect(normalizeRemoteImageMimeType('IMAGE/PNG; charset=binary')).toBe('image/png');
        expect(imageBufferToDataUrl(new Uint8Array([0, 255]).buffer, 'image/png'))
            .toBe('data:image/png;base64,AP8=');
        expect(() => normalizeRemoteImageMimeType('text/html')).toThrow('远程地址不是图片');
        expect(() => imageBufferToDataUrl(new ArrayBuffer(MAX_REMOTE_IMAGE_BYTES + 1), 'image/png'))
            .toThrow('图片文件过大');
    });

    it('省略凭据、拒绝重定向并把无 body 响应转成 data URL', async () => {
        const request = vi.fn(async () => response({contentLength: null, bytes: [0, 255]}));
        await expect(fetchRemoteImageForOcr('https://pbs.twimg.com/media/demo.png', request))
            .resolves.toBe('data:image/png;base64,AP8=');
        expect(request).toHaveBeenCalledWith(
            'https://pbs.twimg.com/media/demo.png',
            {
                credentials: 'omit',
                redirect: 'error',
                signal: expect.any(AbortSignal),
            },
        );

        await expect(fetchRemoteImageForOcr(
            'https://pbs.twimg.com/media/redirect.png',
            async () => { throw new TypeError('redirect mode is error'); },
        )).rejects.toThrow('redirect mode is error');
    });

    it('拒绝 HTTP、非 2xx、过大响应、非图片响应和不安全最终 URL，并释放响应体', async () => {
        const failedBodyCancel = vi.fn(async () => undefined);
        await expect(fetchRemoteImageForOcr(
            'https://pbs.twimg.com/media/failed.png',
            async () => response({ok: false, status: 403, body: {cancel: failedBodyCancel} as never}),
        )).rejects.toThrow('图片服务器返回 403');
        expect(failedBodyCancel).toHaveBeenCalledOnce();

        const largeBodyCancel = vi.fn(async () => undefined);
        await expect(fetchRemoteImageForOcr(
            'https://pbs.twimg.com/media/large.png',
            async () => response({contentLength: String(MAX_REMOTE_IMAGE_BYTES + 1), body: {cancel: largeBodyCancel} as never}),
        )).rejects.toThrow('图片文件过大');
        expect(largeBodyCancel).toHaveBeenCalledOnce();

        const mimeBodyCancel = vi.fn(async () => undefined);
        const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
        const getReader = vi.fn();
        await expect(fetchRemoteImageForOcr(
            'https://pbs.twimg.com/media/html.png',
            async () => response({contentType: 'text/html', body: {getReader, cancel: mimeBodyCancel} as never, arrayBuffer}),
        )).rejects.toThrow('远程地址不是图片');
        expect(mimeBodyCancel).toHaveBeenCalledOnce();
        expect(getReader).not.toHaveBeenCalled();
        expect(arrayBuffer).not.toHaveBeenCalled();

        const missingMimeBodyCancel = vi.fn(async () => undefined);
        await expect(fetchRemoteImageForOcr(
            'https://pbs.twimg.com/media/missing-mime.png',
            async () => response({contentType: null, body: {cancel: missingMimeBodyCancel} as never}),
        )).rejects.toThrow('远程地址不是图片');
        expect(missingMimeBodyCancel).toHaveBeenCalledOnce();

        const redirectBodyCancel = vi.fn(async () => undefined);
        await expect(fetchRemoteImageForOcr(
            'https://pbs.twimg.com/media/redirect.png',
            async () => response({url: 'https://cdn.twimg.com/media/redirect.png', body: {cancel: redirectBodyCancel} as never}),
        )).rejects.toThrow('不允许重定向');
        expect(redirectBodyCancel).toHaveBeenCalledOnce();

        const unsafeBodyCancel = vi.fn(async () => undefined);
        await expect(fetchRemoteImageForOcr(
            'https://pbs.twimg.com/media/unsafe.png',
            async () => response({url: 'https://attacker.example/unsafe.png', body: {cancel: unsafeBodyCancel} as never}),
        )).rejects.toThrow('跨域图片来源');
        expect(unsafeBodyCancel).toHaveBeenCalledOnce();
    });

    it('流式 body 忽略空块并按顺序合并字节，超限时取消 reader', async () => {
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({done: false, value: new Uint8Array()})
                .mockResolvedValueOnce({done: false, value: new Uint8Array([0])})
                .mockResolvedValueOnce({done: false, value: new Uint8Array([255])})
                .mockResolvedValueOnce({done: true, value: undefined}),
            cancel: vi.fn(async () => undefined),
            releaseLock: vi.fn(),
        };
        const body = {getReader: () => reader} as unknown as ReadableStream<Uint8Array>;
        await expect(fetchRemoteImageForOcr(
            'https://pbs.twimg.com/media/stream.png',
            async () => response({contentLength: null, body}),
        )).resolves.toBe('data:image/png;base64,AP8=');
        expect(reader.cancel).not.toHaveBeenCalled();
        expect(reader.releaseLock).toHaveBeenCalledOnce();

        const oversizedReader = {
            read: vi.fn().mockResolvedValueOnce({
                done: false,
                value: {byteLength: MAX_REMOTE_IMAGE_BYTES + 1} as Uint8Array,
            }),
            cancel: vi.fn(async () => undefined),
            releaseLock: vi.fn(() => { throw new Error('pending read'); }),
        };
        const oversizedBody = {getReader: () => oversizedReader} as unknown as ReadableStream<Uint8Array>;
        const oversizedArrayBuffer = vi.fn(async () => new ArrayBuffer(0));
        await expect(fetchRemoteImageForOcr(
            'https://pbs.twimg.com/media/stream-large.png',
            async () => response({contentLength: null, body: oversizedBody, arrayBuffer: oversizedArrayBuffer}),
        )).rejects.toThrow('图片文件过大');
        expect(oversizedReader.cancel).toHaveBeenCalledOnce();
        expect(oversizedReader.releaseLock).toHaveBeenCalledOnce();
        expect(oversizedArrayBuffer).not.toHaveBeenCalled();
    });

    it('流式 reader 失败时取消 reader，并处理没有 releaseLock 的异常分支', async () => {
        const reader = {
            read: vi.fn(async () => { throw new Error('stream failed'); }),
            cancel: vi.fn(async () => undefined),
            releaseLock: vi.fn(() => { throw new Error('release failed'); }),
        };
        const body = {getReader: () => reader} as unknown as ReadableStream<Uint8Array>;
        await expect(fetchRemoteImageForOcr(
            'https://pbs.twimg.com/media/stream-error.png',
            async () => response({contentLength: null, body}),
        )).rejects.toThrow('stream failed');
        expect(reader.cancel).toHaveBeenCalledOnce();
        expect(reader.releaseLock).toHaveBeenCalledOnce();
    });

    it('调用方预取消、取消中的 fetch 和内部 deadline 都会中止底层请求', async () => {
        const preCancelled = new AbortController();
        preCancelled.abort();
        const preRequest = vi.fn(async () => response());
        await expect(fetchRemoteImageForOcr(
            'https://pbs.twimg.com/media/pre-cancel.png', preRequest, preCancelled.signal,
        )).rejects.toMatchObject({name: 'AbortError'});
        expect(preRequest).not.toHaveBeenCalled();

        const caller = new AbortController();
        let callerSignal!: AbortSignal;
        let resolveCaller!: (value: RemoteImageResponse) => void;
        const lateCallerCancel = vi.fn(async () => undefined);
        const callerBody = {cancel: lateCallerCancel} as never;
        const callerRequest = vi.fn((_url: string, init: {signal: AbortSignal}) => {
            callerSignal = init.signal;
            return new Promise<RemoteImageResponse>(resolve => { resolveCaller = resolve; });
        });
        const callerPending = fetchRemoteImageForOcr(
            'https://pbs.twimg.com/media/caller-cancel.png', callerRequest, caller.signal,
        );
        caller.abort();
        await expect(callerPending).rejects.toMatchObject({name: 'AbortError'});
        expect(callerSignal.aborted).toBe(true);
        resolveCaller(response({body: callerBody}));
        await Promise.resolve();
        expect(lateCallerCancel).toHaveBeenCalledOnce();

        let notifyCallerAbort!: () => void;
        const repeatedCallerSignal = {
            aborted: false,
            addEventListener: vi.fn((_type: string, listener: EventListener) => {
                notifyCallerAbort = listener as unknown as () => void;
            }),
            removeEventListener: vi.fn(),
        } as unknown as AbortSignal;
        const repeatedCallerPending = fetchRemoteImageForOcr(
            'https://pbs.twimg.com/media/repeated-cancel.png',
            () => new Promise<RemoteImageResponse>(() => undefined),
            repeatedCallerSignal,
        );
        notifyCallerAbort();
        notifyCallerAbort();
        await expect(repeatedCallerPending).rejects.toMatchObject({name: 'AbortError'});

        vi.useFakeTimers();
        let timeoutSignal!: AbortSignal;
        let resolveTimeout!: (value: RemoteImageResponse) => void;
        const lateTimeoutCancel = vi.fn(async () => undefined);
        const timeoutRequest = vi.fn((_url: string, init: {signal: AbortSignal}) => {
            timeoutSignal = init.signal;
            return new Promise<RemoteImageResponse>(resolve => { resolveTimeout = resolve; });
        });
        const timeoutPending = fetchRemoteImageForOcr(
            'https://pbs.twimg.com/media/timeout.png', timeoutRequest,
        );
        const timeoutRejection = expect(timeoutPending).rejects.toThrow('远程图片读取超时');
        await vi.advanceTimersByTimeAsync(REMOTE_IMAGE_TIMEOUT_MS);
        await timeoutRejection;
        expect(timeoutSignal.aborted).toBe(true);
        resolveTimeout(response({body: {cancel: lateTimeoutCancel} as never}));
        await Promise.resolve();
        expect(lateTimeoutCancel).toHaveBeenCalledOnce();
    });

    it('响应体读取悬挂时也遵守 deadline，并覆盖同步 request 错误和大 buffer', async () => {
        vi.useFakeTimers();
        const reader = {
            read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined)),
            cancel: vi.fn(async () => undefined),
            releaseLock: vi.fn(),
        };
        let signal!: AbortSignal;
        const body = {getReader: () => reader} as unknown as ReadableStream<Uint8Array>;
        const request = vi.fn(async (_url: string, init: {signal: AbortSignal}) => {
            signal = init.signal;
            return response({contentLength: null, body});
        });
        const pending = fetchRemoteImageForOcr('https://pbs.twimg.com/media/hanging.png', request);
        const rejection = expect(pending).rejects.toThrow('远程图片读取超时');
        await vi.advanceTimersByTimeAsync(REMOTE_IMAGE_TIMEOUT_MS);
        await rejection;
        expect(signal.aborted).toBe(true);
        expect(reader.cancel).toHaveBeenCalledOnce();

        await expect(fetchRemoteImageForOcr(
            'https://pbs.twimg.com/media/request-error.png',
            () => { throw new Error('request failed'); },
        )).rejects.toThrow('request failed');
        await expect(fetchRemoteImageForOcr(
            'https://pbs.twimg.com/media/array-large.png',
            async () => response({contentLength: null, body: null, arrayBuffer: async () => new ArrayBuffer(MAX_REMOTE_IMAGE_BYTES + 1)}),
        )).rejects.toThrow('图片文件过大');
    });

    it('Offscreen 网络端口委托真实 fetch，并保留 signal', async () => {
        const fetchMock = vi.fn(async () => response({contentLength: null, bytes: [1]}));
        vi.stubGlobal('fetch', fetchMock);
        const controller = new AbortController();
        await expect(fetchImageInOffscreen('https://pbs.twimg.com/media/wrapper.png', controller.signal))
            .resolves.toBe('data:image/png;base64,AQ==');
        expect(fetchMock).toHaveBeenCalledWith(
            'https://pbs.twimg.com/media/wrapper.png',
            expect.objectContaining({credentials: 'omit', redirect: 'error', signal: expect.any(AbortSignal)}),
        );
    });
});
