/**
 * @file src/services/translation/requestRegistry.ts
 * 文件职责：为不同原生文本协议提供可独立实例化的请求注册表，以真实发送者和有限 ID 绑定后台取消。
 * 主要内容：严格解析公开 ID、同步捕获 sender、管理活动 AbortController，以及各自最多 512 条的乱序取消和已完成历史。
 * 模块边界：不监听 runtime、不读取配置或凭据、不选择 provider；消息处理器必须在任何 await 前注册，并在等待后检查 signal。documentId 缺失时仅沿用 tab/frame 或页面 URL 范围，不能替代文档生命周期授权。
 */
import {requestOwnerKey} from '@/src/platform/browser/requestOwner';
import type {TranslationCancelResponse} from './types';
export interface TranslationRequestContext {
    sender?: {
        id?: string;
        url?: string;
        frameId?: number;
        documentId?: string;
        origin?: string;
        tab?: {id?: number; incognito?: boolean};
    };
}

export interface TranslationRequestRegistry {
    run<T>(clientRequestId: string, context: TranslationRequestContext, operation: (
        signal: AbortSignal,
        ownershipKey: string,
    ) => Promise<T>): Promise<T>;
    cancel(clientRequestId: unknown, context: TranslationRequestContext): TranslationCancelResponse;
}

const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const REQUEST_HISTORY_LIMIT = 512;

export function parseClientRequestId(value: unknown, optional = false): string | undefined {
    if (value === undefined && optional) return undefined;
    if (typeof value !== 'string' || !CLIENT_REQUEST_ID_PATTERN.test(value)) {
        throw new TypeError('翻译请求 clientRequestId 格式无效');
    }
    return value;
}


function translationAbortError(): Error {
    const error = new Error('翻译请求已取消');
    error.name = 'AbortError';
    return error;
}

/** 有界保存 cancel-before-start/已用 ID，同时用 sender scope 防止跨页面误取消。 */
export function createTranslationRequestRegistry(): TranslationRequestRegistry {
    const active = new Map<string, AbortController>();
    const cancelledBeforeStart = new Set<string>();
    const completed = new Set<string>();
    const cancellationOrder: string[] = [];
    const completionOrder: string[] = [];
    const remember = (set: Set<string>, order: string[], key: string) => {
        if (set.has(key)) return;
        set.add(key);
        order.push(key);
        if (order.length > REQUEST_HISTORY_LIMIT) set.delete(order.shift()!);
    };

    return {
        async run(clientRequestId, context, operation) {
            const owner = requestOwnerKey(context);
            const key = `${owner.length}:${owner}:${clientRequestId}`;
            if (cancelledBeforeStart.delete(key)) {
                remember(completed, completionOrder, key);
                throw translationAbortError();
            }
            if (active.has(key) || completed.has(key)) {
                throw new Error('翻译请求 clientRequestId 已在使用');
            }
            const controller = new AbortController();
            active.set(key, controller);
            try {
                return await operation(controller.signal, key);
            } finally {
                if (active.get(key) === controller) active.delete(key);
                remember(completed, completionOrder, key);
            }
        },
        cancel(clientRequestIdValue, context) {
            const clientRequestId = parseClientRequestId(clientRequestIdValue)!;
            const owner = requestOwnerKey(context);
            const key = `${owner.length}:${owner}:${clientRequestId}`;
            const controller = active.get(key);
            if (controller) controller.abort();
            else if (!completed.has(key)) remember(cancelledBeforeStart, cancellationOrder, key);
            return {success: true, cancelled: Boolean(controller), clientRequestId};
        },
    };
}


/** 异步等待之前固定原生身份和页面 URL，避免后续复用的上下文改变归属。 */
export function captureTranslationRequestContext(context?: TranslationRequestContext): TranslationRequestContext {
    const sender = context?.sender;
    return {sender: sender ? {...sender, tab: sender.tab ? {...sender.tab} : undefined} : undefined};
}

export function throwIfTranslationRequestAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw translationAbortError();
}
