/**
 * @file src/features/local-tts/background/handlers.ts
 * 文件职责：为设置页提供本地 TTS 模型的状态、下载和清除后台消息 handler。
 * 主要内容：解析状态查询、预下载与移除请求，调用注入的 Offscreen 适配器并把下载状态写入扩展本地存储，统一返回成功或错误结构。
 * 模块边界：不执行语音合成；实际模型缓存和 Worker 初始化由 Offscreen 适配器完成，存储与适配器均由 runtime 注入。
 */

import type {BackgroundMessageHandler} from '@/src/app/background/messageRouter';
import {LOCAL_TTS_MODEL, LOCAL_TTS_MODEL_ID, LOCAL_TTS_MODEL_STATE_KEY} from '@/src/core/config/localTts';

type Context = unknown;
type Store = {
    get(key: string): Promise<Record<string, unknown>>;
    set(value: Record<string, unknown>): Promise<void>;
};

export const LOCAL_TTS_MODEL_STATE_MESSAGE = 'fluentReadGetLocalTtsModelState' as const;
export const LOCAL_TTS_MODEL_PREPARE_MESSAGE = 'fluentReadPrepareLocalTtsModel' as const;
export const LOCAL_TTS_MODEL_REMOVE_MESSAGE = 'fluentReadRemoveLocalTtsModel' as const;

interface LocalTtsModelState {
    model: typeof LOCAL_TTS_MODEL_ID;
    downloaded: boolean;
    downloadSizeMb: number;
    dtype?: string;
    revision?: string;
}

export interface LocalTtsBackgroundDependencies {
    readonly offscreen: {
        prepare(keepWarm?: boolean): Promise<Record<string, unknown>>;
        status(): Promise<Record<string, unknown>>;
        remove(): Promise<void>;
    };
    readonly storage: Store;
}

function modelState(value: unknown): LocalTtsModelState | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    return item.model === LOCAL_TTS_MODEL_ID && typeof item.downloaded === 'boolean'
        ? item as unknown as LocalTtsModelState
        : null;
}

export function createLocalTtsBackgroundHandlers(
    dependencies: LocalTtsBackgroundDependencies,
): readonly BackgroundMessageHandler<Context>[] {
    let stateWriteQueue: Promise<void> = Promise.resolve();
    let removing = false;

    const writeState = (state: LocalTtsModelState): Promise<void> => {
        const write = stateWriteQueue.then(() => dependencies.storage.set({[LOCAL_TTS_MODEL_STATE_KEY]: state}));
        stateWriteQueue = write.then(() => undefined, () => undefined);
        return write;
    };

    const state: BackgroundMessageHandler<Context> = {
        type: LOCAL_TTS_MODEL_STATE_MESSAGE,
        async handle() {
            const response = await dependencies.offscreen.status();
            const raw = Array.isArray(response.models) ? response.models[0] : undefined;
            const reported = modelState(raw);
            const stored = await dependencies.storage.get(LOCAL_TTS_MODEL_STATE_KEY);
            const saved = modelState(stored[LOCAL_TTS_MODEL_STATE_KEY]);
            const current = reported || saved || {
                model: LOCAL_TTS_MODEL_ID,
                downloaded: false,
                downloadSizeMb: LOCAL_TTS_MODEL.downloadSizeMb,
            };
            await writeState(current);
            return {success: true, model: current.model, downloaded: current.downloaded, models: [current]};
        },
    };

    const prepare: BackgroundMessageHandler<Context> = {
        type: LOCAL_TTS_MODEL_PREPARE_MESSAGE,
        async handle() {
            if (removing) throw new Error('正在清除本地 TTS 模型，请稍后重试');
            const response = await dependencies.offscreen.prepare(false);
            const reported = Array.isArray(response.models) ? response.models[0] : undefined;
            const current = modelState(reported) || {
                model: LOCAL_TTS_MODEL_ID,
                downloaded: true,
                downloadSizeMb: LOCAL_TTS_MODEL.downloadSizeMb,
                dtype: typeof response.dtype === 'string' ? response.dtype : undefined,
                revision: typeof response.revision === 'string' ? response.revision : undefined,
            };
            await writeState({...current, downloaded: true});
            return {success: true, ...response, model: LOCAL_TTS_MODEL_ID, downloaded: true, models: [{...current, downloaded: true}]};
        },
    };

    const remove: BackgroundMessageHandler<Context> = {
        type: LOCAL_TTS_MODEL_REMOVE_MESSAGE,
        async handle() {
            if (removing) throw new Error('正在清除本地 TTS 模型，请稍后重试');
            removing = true;
            try {
                await dependencies.offscreen.remove();
                const current: LocalTtsModelState = {
                    model: LOCAL_TTS_MODEL_ID,
                    downloaded: false,
                    downloadSizeMb: LOCAL_TTS_MODEL.downloadSizeMb,
                };
                await writeState(current);
                return {success: true, model: LOCAL_TTS_MODEL_ID, downloaded: false, models: [current]};
            } finally {
                removing = false;
            }
        },
    };

    return [state, prepare, remove];
}
