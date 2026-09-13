/**
 * @file tests/imageTranslationClientRecovery.test.ts
 * 文件职责：验证图片翻译客户端在运行时消息通道短暂断开时的单次恢复协议。
 * 主要内容：覆盖断线响应重试、新 requestId、旧请求取消、共享截止时间、取消与进度隔离，以及不可重试错误。
 * 模块边界：本文件只测试 services/client 的消息客户端，不启动浏览器、不触碰 Offscreen 或 provider 实现。
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {IMAGE_PROGRESS_MESSAGE_TYPE} from '@/src/features/image-translation/progress';
import {translateImageInExtension} from '@/src/features/image-translation/services/client';

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
    return {promise, resolve, reject};
};

describe('图片翻译客户端断线恢复', () => {
    let listeners: Set<(value: unknown) => void>;
    let sendMessage: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        listeners = new Set();
        sendMessage = vi.fn();
        vi.stubGlobal('browser', {
            runtime: {
                sendMessage,
                onMessage: {
                    addListener: vi.fn((listener: (value: unknown) => void) => listeners.add(listener)),
                    removeListener: vi.fn((listener: (value: unknown) => void) => listeners.delete(listener)),
                },
            },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('嵌套 Offscreen 断线响应只重试一次，保留首个 ID 并为重试生成新 ID', async () => {
        sendMessage
            .mockResolvedValueOnce({success: false, error: 'The message port closed before a response was received.'})
            .mockResolvedValueOnce({success: true, cancelled: true})
            .mockResolvedValueOnce({success: true, image: 'translated', lines: []});

        await expect(translateImageInExtension('source', 'en', 'Page', {
            requestId: 'image-original', timeoutMs: 5_000,
        })).resolves.toEqual({image: 'translated', lines: []});

        expect(sendMessage).toHaveBeenCalledTimes(3);
        expect(sendMessage.mock.calls[0][0]).toMatchObject({type: 'fluentReadImageTranslate', requestId: 'image-original'});
        expect(sendMessage.mock.calls[1][0]).toEqual({type: 'fluentReadImageCancel', requestId: 'image-original'});
        expect(sendMessage.mock.calls[2][0]).toMatchObject({type: 'fluentReadImageTranslate'});
        expect(sendMessage.mock.calls[2][0].requestId).not.toBe('image-original');
    });

    it('第二次仍断线时返回可操作错误，provider 错误不触发重试', async () => {
        sendMessage
            .mockResolvedValueOnce({success: false, error: 'Receiving end does not exist.'})
            .mockResolvedValueOnce({success: true, cancelled: true})
            .mockResolvedValueOnce({success: false, error: 'Could not establish connection. Receiving end does not exist.'});
        await expect(translateImageInExtension('source', 'en', 'Page', {requestId: 'retry'}))
            .rejects.toThrow('图片翻译连接中断，请重试；如果仍然失败，请刷新页面后再试');
        expect(sendMessage).toHaveBeenCalledTimes(3);

        sendMessage.mockReset().mockResolvedValue({success: false, error: 'provider rejected request'});
        await expect(translateImageInExtension('source', 'en', 'Page')).rejects.toThrow('provider rejected request');
        expect(sendMessage).toHaveBeenCalledOnce();
    });

    it('上下文失效、AbortError 和预取消都不重试', async () => {
        sendMessage.mockRejectedValueOnce(new Error('Extension context invalidated.'));
        await expect(translateImageInExtension('source', 'en', 'Page', {requestId: 'context'}))
            .rejects.toThrow('扩展上下文已失效，请刷新页面后再试');
        expect(sendMessage).toHaveBeenCalledOnce();

        sendMessage.mockReset().mockRejectedValueOnce(Object.assign(new Error('aborted'), {name: 'AbortError'}));
        await expect(translateImageInExtension('source', 'en', 'Page', {requestId: 'abort'})).rejects.toThrow('aborted');
        expect(sendMessage).toHaveBeenCalledOnce();

        sendMessage.mockReset();
        const controller = new AbortController();
        controller.abort();
        await expect(translateImageInExtension('source', 'en', 'Page', {signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('拒绝型 runtime 断线后可以恢复，结构化上下文失效直接提示刷新', async () => {
        sendMessage
            .mockRejectedValueOnce(new Error('The message channel closed before a response was received.'))
            .mockRejectedValueOnce(new Error('cancel unavailable'))
            .mockResolvedValueOnce({success: true, image: 'translated', lines: []});
        await expect(translateImageInExtension('source', 'en', 'Page', {requestId: 'rejected'}))
            .resolves.toEqual({image: 'translated', lines: []});
        expect(sendMessage).toHaveBeenCalledTimes(3);

        sendMessage.mockReset().mockResolvedValue({success: false, error: 'Extension context invalidated.'});
        await expect(translateImageInExtension('source', 'en', 'Page', {requestId: 'structured-context'}))
            .rejects.toThrow('扩展上下文已失效，请刷新页面后再试');
        expect(sendMessage).toHaveBeenCalledOnce();
    });

    it('第二次请求等待期间取消时清理监听，并使用当前重试 ID 发送取消', async () => {
        const second = deferred<unknown>();
        sendMessage
            .mockResolvedValueOnce({success: false, error: 'Receiving end does not exist'})
            .mockResolvedValueOnce({success: true, cancelled: true})
            .mockReturnValueOnce(second.promise)
            .mockResolvedValueOnce({success: true, cancelled: true});
        const controller = new AbortController();
        const pending = translateImageInExtension('source', 'en', 'Page', {
            requestId: 'first-id', signal: controller.signal, onProgress: vi.fn(), timeoutMs: 5_000,
        });
        await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(3));
        const retryId = sendMessage.mock.calls[2][0].requestId;
        controller.abort();
        await expect(pending).rejects.toMatchObject({name: 'AbortError'});
        expect(sendMessage).toHaveBeenNthCalledWith(4, {type: 'fluentReadImageCancel', requestId: retryId});
        expect(listeners.size).toBe(0);
        second.resolve({success: true, image: 'late', lines: []});
    });

    it('旧请求取消通知同步触发取消时不再启动重试', async () => {
        const controller = new AbortController();
        sendMessage
            .mockResolvedValueOnce({success: false, error: 'Receiving end does not exist'})
            .mockImplementationOnce(() => { controller.abort(); throw new Error('cancel unavailable'); });
        await expect(translateImageInExtension('source', 'en', 'Page', {
            requestId: 'sync-cancel', signal: controller.signal,
        })).rejects.toMatchObject({name: 'AbortError'});
        expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    it('截止时间在恢复前耗尽时不发送第二次业务请求', async () => {
        vi.useFakeTimers();
        sendMessage.mockImplementationOnce(async () => {
            vi.setSystemTime(Date.now() + 20);
            throw new Error('Receiving end does not exist');
        });
        const pending = translateImageInExtension('source', 'en', 'Page', {requestId: 'expired', timeoutMs: 10});
        const rejected = expect(pending).rejects.toMatchObject({name: 'TimeoutError'});
        await rejected;
        expect(sendMessage).toHaveBeenCalledOnce();
    });

    it('TimeoutError 即使错误文本包含 channel closed 也不重试', async () => {
        sendMessage.mockRejectedValueOnce(Object.assign(new Error('message channel closed'), {name: 'TimeoutError'}));
        await expect(translateImageInExtension('source', 'en', 'Page', {requestId: 'timeout-name'}))
            .rejects.toThrow('message channel closed');
        expect(sendMessage).toHaveBeenCalledOnce();
    });

    it('旧任务清理消耗完剩余预算后不再启动恢复请求', async () => {
        vi.useFakeTimers();
        sendMessage.mockRejectedValueOnce(new Error('The message channel closed'))
            .mockImplementationOnce(async () => { vi.setSystemTime(Date.now() + 20); });
        await expect(translateImageInExtension('source', 'en', 'Page', {timeoutMs: 10}))
            .rejects.toMatchObject({name: 'TimeoutError'});
        expect(sendMessage.mock.calls.map(([message]) => message.type))
            .toEqual(['fluentReadImageTranslate', 'fluentReadImageCancel']);
    });

    it('通道回复断开与用户取消同时发生时优先取消', async () => {
        const first = deferred<unknown>();
        const controller = new AbortController();
        sendMessage.mockReturnValueOnce(first.promise);
        const pending = translateImageInExtension('source', 'en', 'Page', {signal: controller.signal});
        const rejected = expect(pending).rejects.toMatchObject({name: 'AbortError'});
        first.reject(new Error('The message channel closed'));
        queueMicrotask(() => controller.abort());
        await rejected;
        expect(sendMessage).toHaveBeenCalledOnce();
    });

    it('迟到的旧进度不会污染重试请求', async () => {
        vi.useFakeTimers();
        const first = deferred<unknown>();
        const second = deferred<unknown>();
        sendMessage.mockReturnValueOnce(first.promise)
            .mockResolvedValueOnce({success: true, cancelled: true})
            .mockReturnValueOnce(second.promise);
        const progress = vi.fn();
        const pending = translateImageInExtension('source', 'en', 'Page', {
            requestId: 'progress-old', timeoutMs: 20, onProgress: progress,
        });
        expect(listeners.size).toBe(1);
        setTimeout(() => first.reject(new Error('Receiving end does not exist')), 15);
        await vi.advanceTimersByTimeAsync(15);
        expect(sendMessage).toHaveBeenCalledTimes(3);
        for (const listener of listeners) listener({type: IMAGE_PROGRESS_MESSAGE_TYPE, requestId: 'progress-old', stage: 'rendering'});
        expect(progress).not.toHaveBeenCalled();
        const rejected = expect(pending).rejects.toMatchObject({name: 'TimeoutError'});
        await vi.advanceTimersByTimeAsync(5);
        await rejected;
        second.resolve({success: true, image: 'late', lines: []});
        expect(progress).not.toHaveBeenCalled();
        expect(listeners.size).toBe(0);
    });
});
