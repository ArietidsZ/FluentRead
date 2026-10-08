/**
 * @file src/features/image-translation/background/operationRegistry.ts
 * 文件职责：管理图片与区域翻译共享的后台事务身份、发送者归属与取消生命周期。
 * 主要内容：以公开 ID 和可信文档 session／浏览器 sender 键索引不可复用的内部事务，冻结配置和来源，继承绝对截止时间；父结束先撤销恢复权限再中止剩余子工作，限定离屏回传并有界保存归属内预取消。
 * 模块边界：只管理本地事务和信号，不访问浏览器、OCR、供应商、配置存储或消息传输，也不信任消息体自报归属。
 */
import {requestOwnerKey, type BrowserRequestContext} from '@/src/platform/browser/requestOwner';
import type {Config} from '@/src/core/config/model';
import {assertImageDocumentContext, copyImageDocumentSession, getImageDocumentSession} from './documentSession';
export interface ImageProgressContext extends BrowserRequestContext {}
export const IMAGE_OPERATION_TIMEOUT_MS = 180_000;
const MAX_IMAGE_OPERATION_TIMEOUT_MS = 300_000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;

export interface ImageOperationOptions {
    readonly ocrEngine?: 'paddle';
    /** 仅由已复核的消息 sender 提供，不接受消息体自报来源。 */
    readonly documentUrl?: string;
    readonly manga?: true;
    readonly requestId: string;
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
    readonly callerRequestId?: string;
    readonly deadlineAt?: number;
    readonly snapshot?: ImageTransactionSnapshot;
    readonly controller?: AbortController;
}

export interface ImageOperationMessage {
    readonly requestId?: unknown;
    readonly timeoutMs?: unknown;
}

export interface ImageTransactionSnapshot {
    readonly pageUrl?: string;
    readonly sourceLanguage: string;
    readonly glossaryRevision: string;
    readonly config?: Readonly<Config>;
}
export interface ImageTransactionRecord {
    readonly callerRequestId: string;
    readonly ownerKey: string;
    readonly transactionId: string;
    readonly ownerContext: ImageProgressContext;
    readonly snapshot?: ImageTransactionSnapshot;
    readonly deadlineAt: number;
    readonly controller: AbortController;
    readonly terminal: boolean;
    readonly options: ImageOperationOptions;
}
export interface ImageOperationRegistry {
    run<T>(message: ImageOperationMessage, operation: (options: ImageOperationOptions) => Promise<T>,
        context?: ImageProgressContext, snapshot?: () => ImageTransactionSnapshot): Promise<T>;
    cancel(requestId: unknown, context?: ImageProgressContext): {success: true; cancelled: boolean; requestId: string};
    restore(requestId: unknown, context: ImageProgressContext): ImageTransactionRecord;
    bind(context: ImageProgressContext, options: ImageOperationOptions): ImageProgressContext;
    releaseTab(tabId: number): void;
    releaseOwner(context: ImageProgressContext): void;
}

export function parseRequestId(value: unknown): string {
    const requestId = value;
    if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) throw new TypeError('图片翻译 requestId 格式无效');
    return requestId;
}

function parseTimeoutMs(value: unknown): number {
    if (value === undefined) return IMAGE_OPERATION_TIMEOUT_MS;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new TypeError('图片翻译 timeoutMs 必须是正数');
    }
    return Math.min(MAX_IMAGE_OPERATION_TIMEOUT_MS, Math.floor(value));
}

export function imageAbortError(timedOut: boolean): Error {
    const error = new Error(timedOut ? '图片 OCR 请求超时' : '图片 OCR 请求已取消');
    error.name = timedOut ? 'TimeoutError' : 'AbortError';
    return error;
}

/** 图片与圈选复用一张事务表，公开 ID 只在原 sender 归属内有效。 */
export function createImageOperationRegistry(legacyPrefix = 'image',
    isOffscreenSender: (context: ImageProgressContext) => boolean = () => false, now: () => number = Date.now,
    requireDocumentOwner = false): ImageOperationRegistry {
    const active = new Map<string, ImageTransactionRecord>();
    const byOwner = new Map<string, ImageTransactionRecord>();
    const executions = new WeakMap<ImageTransactionRecord, number>();
    const preCancelled = new Map<string, true>();
    const transactionContext = Symbol('image-transaction');
    const namespace = crypto.randomUUID();
    let sequence = 0;
    const key = (owner: string, id: string) => `${owner.length}:${owner}:${id}`;
    const fromOffscreen = (context: ImageProgressContext) => context.sender?.tab === undefined && isOffscreenSender(context);
    const revoke = (record: ImageTransactionRecord) => {
        if (active.get(record.transactionId) === record) active.delete(record.transactionId);
        const ownerId = key(record.ownerKey, record.callerRequestId);
        if (byOwner.get(ownerId) === record) byOwner.delete(ownerId);
    };
    const assertActive = (record: ImageTransactionRecord | undefined): ImageTransactionRecord => {
        if (!record || record.terminal || active.get(record.transactionId) !== record) throw new Error('图片翻译上下文已失效，请重新翻译');
        assertImageDocumentContext(record.ownerContext);
        if (record.deadlineAt <= now()) {
            revoke(record);
            record.controller.abort(imageAbortError(true));
            throw imageAbortError(true);
        }
        return record;
    };
    const execute = <T>(record: ImageTransactionRecord, operation: (options: ImageOperationOptions) => Promise<T>,
        terminate: (failed: boolean) => void): Promise<T> => new Promise<T>((resolve, reject) => {
        executions.set(record, (executions.get(record) ?? 0) + 1);
        let settled = false;
        const finish = (callback: () => void, failed: boolean) => {
            if (settled) return;
            settled = true;
            const remaining = executions.get(record)! - 1;
            if (remaining) executions.set(record, remaining); else executions.delete(record);
            terminate(failed);
            record.controller.signal.removeEventListener('abort', handleAbort);
            callback();
        };
        const handleAbort = () => finish(() => reject(record.controller.signal.reason instanceof Error
            ? record.controller.signal.reason : imageAbortError(false)), true);
        record.controller.signal.addEventListener('abort', handleAbort, {once: true});
        const pending = Promise.resolve().then(() => operation(assertActive(record).options));
        void pending.then(result => finish(() => resolve(result), false), error => finish(() => reject(error), true));
    });
    return {
        async run<T>(message: ImageOperationMessage, operation: (options: ImageOperationOptions) => Promise<T>,
            context: ImageProgressContext = {}, snapshot?: () => ImageTransactionSnapshot): Promise<T> {
            const borrowed = (context as ImageProgressContext & {[transactionContext]?: ImageTransactionRecord})[transactionContext];
            if (borrowed || fromOffscreen(context)) {
                const record = assertActive(borrowed ?? active.get(parseRequestId(message.requestId)));
                return execute(record, operation, () => {});
            }
            const callerRequestId = message.requestId === undefined ? `legacy-${legacyPrefix}-${++sequence}` : parseRequestId(message.requestId);
            assertImageDocumentContext(context, requireDocumentOwner);
            const ownerKey = getImageDocumentSession(context)?.ownerKey ?? requestOwnerKey(context);
            const ownerId = key(ownerKey, callerRequestId);
            if (preCancelled.delete(ownerId)) throw imageAbortError(false);
            if (byOwner.has(ownerId)) throw new Error('图片 OCR requestId 正在执行');
            const timeoutMs = parseTimeoutMs(message.timeoutMs);
            const deadlineAt = now() + timeoutMs;
            const transactionId = `image-transaction:${namespace}:${++sequence}`;
            const controller = new AbortController();
            let terminal = false;
            const sender = context.sender;
            const ownerContext = Object.freeze(copyImageDocumentSession(context, {...(sender ? {sender: Object.freeze({...sender,
                ...(sender.tab ? {tab: Object.freeze({...sender.tab})} : {})})} : {})}));
            const frozen = snapshot?.();
            const options = Object.freeze({requestId: transactionId, callerRequestId, signal: controller.signal, controller,
                deadlineAt, ...(frozen ? {snapshot: frozen} : {}), get timeoutMs() {return Math.max(0, Math.floor(deadlineAt - now()));}});
            const record: ImageTransactionRecord = Object.freeze({callerRequestId, ownerKey, transactionId, ownerContext,
                snapshot: frozen, deadlineAt, controller, options, get terminal() {return terminal;}});
            active.set(transactionId, record); byOwner.set(ownerId, record);
            const timer = setTimeout(() => {revoke(record); controller.abort(imageAbortError(true));}, timeoutMs);
            try {
                return await execute(record, operation, failed => {
                    terminal = true; revoke(record);
                    if (failed || executions.has(record)) controller.abort(imageAbortError(false));
                });
            } finally {clearTimeout(timer); revoke(record);}
        },
        cancel(value, context = {}) {
            const requestId = parseRequestId(value);
            const offscreen = fromOffscreen(context);
            if (!offscreen) assertImageDocumentContext(context, requireDocumentOwner);
            const ownerId = key(getImageDocumentSession(context)?.ownerKey ?? requestOwnerKey(context), requestId);
            const record = offscreen ? active.get(requestId) : byOwner.get(ownerId);
            if (record) {revoke(record); record.controller.abort(imageAbortError(false));}
            else if (!offscreen) {
                preCancelled.set(ownerId, true);
                if (preCancelled.size > 512) preCancelled.delete(preCancelled.keys().next().value!);
            }
            return {success: true, cancelled: Boolean(record), requestId};
        },
        restore(value, context) {
            if (!fromOffscreen(context)) throw new Error('图片翻译 Offscreen 来源未授权');
            return assertActive(active.get(parseRequestId(value)));
        },
        bind(context, options) {
            const record = assertActive(active.get(options.requestId));
            return {...context, ...record.ownerContext, [transactionContext]: record};
        },
        releaseTab(tabId) {
            for (const record of active.values()) if (record.ownerContext.sender?.tab?.id === tabId) {
                revoke(record); record.controller.abort(imageAbortError(false));
            }
        },
        releaseOwner(context) {
            const owner = getImageDocumentSession(context)?.ownerKey ?? requestOwnerKey(context);
            for (const id of preCancelled.keys()) if (id.startsWith(`${owner.length}:${owner}:`)) preCancelled.delete(id);
            const records = [...active.values()].filter(record => record.ownerKey === owner);
            for (const record of records) revoke(record);
            for (const record of records) record.controller.abort(imageAbortError(false));
        },
    };
}
