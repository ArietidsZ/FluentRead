/**
 * @file src/app/background/handlers/translationCache.ts
 * 文件职责：把清空翻译缓存能力封装为类型化后台消息处理器，为 popup 和旧 content 消息提供一致响应。
 * 主要内容：声明 clearTranslationCache 请求与清理完成广播，并在底层清理成功后通知所有活动 content 会话失效内存结果。
 * 模块边界：本文件不直接访问 IndexedDB、内存缓存或页面 localStorage，也不决定清理代次；缓存一致性和旧写入排空由 translation cache 服务负责。
 */
import type {BackgroundMessageHandler} from '../messageRouter';

export const CLEAR_TRANSLATION_CACHE_MESSAGE = 'clearTranslationCache' as const;
export const TRANSLATION_CACHE_CLEARED_MESSAGE = 'translationCacheCleared' as const;

export interface ClearTranslationCacheMessage {
    type: typeof CLEAR_TRANSLATION_CACHE_MESSAGE;
}
export interface ClearTranslationCacheResponse {
    success: true;
}

export interface TranslationCacheInvalidationBroadcastAdapter {
    queryTabs(): Promise<Array<{id?: number}>>;
    sendTabMessage(tabId: number, message: {type: typeof TRANSLATION_CACHE_CLEARED_MESSAGE}): Promise<unknown>;
    warn(message: string, error: unknown): void;
}

/** 逐标签页通知 content；受限页面或已关闭 tab 不回滚已完成的缓存清理。 */
export function createTranslationCacheInvalidationBroadcaster(
    adapter: TranslationCacheInvalidationBroadcastAdapter,
): () => Promise<void> {
    return async () => {
        try {
            const tabs = await adapter.queryTabs();
            await Promise.allSettled(tabs
                .filter((tab): tab is {id: number} => typeof tab.id === 'number')
                .map((tab) => adapter.sendTabMessage(tab.id, {type: TRANSLATION_CACHE_CLEARED_MESSAGE})));
        } catch (error) {
            adapter.warn('[FluentRead] 翻译缓存清理完成广播失败', error);
        }
    };
}

/** 创建翻译缓存清理 handler；具体缓存实现由 composition root 注入。 */
export function createTranslationCacheHandler(
    clearTranslationCache: () => Promise<void>,
    broadcastInvalidation: () => Promise<void>,
): BackgroundMessageHandler<unknown, ClearTranslationCacheMessage, ClearTranslationCacheResponse> {
    return {
        type: CLEAR_TRANSLATION_CACHE_MESSAGE,
        async handle() {
            // 步骤 1：同时清理持久译文缓存和 broker 的页面摘要缓存。
            await clearTranslationCache();
            // 步骤 2：底层成功后再失效 content 会话缓存，清理失败时保留当前会话。
            await broadcastInvalidation();
            return {success: true};
        },
    };
}
