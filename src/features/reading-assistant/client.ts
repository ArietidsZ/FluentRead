/**
 * @file src/features/reading-assistant/client.ts
 * 文件职责：封装阅读助手的流式 runtime port 与本机会话查询协议，向 UI 提供稳定的异步边界。
 * 主要内容：发送 run 请求、消费 model/text/session 进度、取消当前请求，以及分页读取、删除和清空最近会话。
 * 模块边界：本文件不解析提示词、不保存 DOM 或密钥；后台负责模型调用与会话持久化，组件负责展示和生命周期。
 */
import browser from 'webextension-polyfill';
import type {ReadingProgress, ReadingRequest, ReadingResponse, ReadingStreamMessage} from './types';
import type {HarnessSession, HarnessSessionSummary} from '@/src/services/harness/sessionTypes';

export type HarnessStreamHandlers = {
    progress?: (progress: ReadingProgress) => void;
    result?: (response: ReadingResponse) => void;
    error?: (error: Error) => void;
};

export function streamReading(request: ReadingRequest, handlers: HarnessStreamHandlers): {cancel: () => void} {
    const port = browser.runtime.connect({name: 'fluentReadHarnessStream'});
    let closed = false;
    const cancel = () => {
        if (closed) return;
        closed = true;
        try { port.disconnect(); } catch { /* port 已断开。 */ }
        void browser.runtime.sendMessage({type: 'fluentReadHarness', action: 'cancel', requestId: request.requestId}).catch(() => undefined);
    };
    const handleMessage = (rawMessage: unknown) => {
        if (closed) return;
        const message = rawMessage as ReadingStreamMessage;
        if (message.requestId !== request.requestId) return;
        if (message.type === 'progress') handlers.progress?.(message.progress);
        else { closed = true; handlers.result?.(message.response); try { port.disconnect(); } catch { /* 已断开。 */ } }
    };
    const handleDisconnect = () => {
        if (closed) return;
        closed = true;
        handlers.error?.(new Error('阅读助手连接已断开，请重试。'));
    };
    port.onMessage.addListener(handleMessage);
    port.onDisconnect.addListener(handleDisconnect);
    try { port.postMessage(request); } catch { handleDisconnect(); }
    return {cancel};
}

async function sessionMessage<T>(message: Record<string, unknown>): Promise<T> {
    const response = await browser.runtime.sendMessage({type: 'fluentReadHarness', ...message}) as T & {success?: boolean; error?: string};
    if (response?.success !== true) throw new Error(response?.error || '会话操作失败');
    return response;
}

export async function listHarnessSessions(offset = 0): Promise<{sessions: HarnessSessionSummary[]; hasMore: boolean}> {
    return sessionMessage({action: 'sessions-list', offset});
}
export async function getHarnessSession(sessionId: string): Promise<HarnessSession | null> {
    const response = await sessionMessage<{session: HarnessSession | null}>({action: 'sessions-get', sessionId});
    return response.session;
}
export async function deleteHarnessSession(sessionId: string): Promise<void> { await sessionMessage({action: 'sessions-delete', sessionId}); }
export async function clearHarnessSessions(): Promise<void> { await sessionMessage({action: 'sessions-clear'}); }
