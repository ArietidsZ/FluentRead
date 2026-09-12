/**
 * @file src/features/local-tts/background/offscreenAdapter.ts
 * 文件职责：把本地 TTS 的模型管理和合成请求转换为 Offscreen 消息。
 * 模块边界：不读取配置、不操作网页；模型与 Worker 生命周期归 Offscreen TTS 运行时。
 */

import type {OffscreenClient} from '@/src/platform/offscreen/client';
import {extensionDomClient} from '@/src/platform/offscreen/extensionClient';
import {OFFSCREEN_CANCEL_LOCAL_TTS_MESSAGE_TYPE} from '@/src/platform/offscreen/client';
import type {LocalTtsAudio} from '../offscreen/tts';

function requestId(): string {
    return crypto.randomUUID();
}

function errorMessage(response: {error?: unknown; errorCode?: unknown} | undefined, fallback: string): Error {
    const error = new Error(typeof response?.error === 'string' && response.error ? response.error : fallback);
    if (typeof response?.errorCode === 'string') (error as Error & {code?: string}).code = response.errorCode;
    return error;
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
}

export function createLocalTtsOffscreenAdapter(client: OffscreenClient = extensionDomClient) {
    return {
        async synthesize(
            text: string,
            language: string,
            voice: string,
            signal?: AbortSignal,
        ): Promise<LocalTtsAudio> {
            const id = requestId();
            const response = await client.send<{
                success?: boolean;
                audioBase64?: string;
                contentType?: string;
                voice?: string;
                backend?: 'webgpu' | 'wasm';
                error?: unknown;
                errorCode?: unknown;
            }>({
                type: 'LOCAL_TTS_SYNTHESIZE',
                requestId: id,
                text,
                language,
                voice,
            }, {
                signal,
                timeoutMs: 120_000,
                cancelMessage: {type: OFFSCREEN_CANCEL_LOCAL_TTS_MESSAGE_TYPE, requestId: id},
            });
            if (!response?.success || typeof response.audioBase64 !== 'string' || response.audioBase64.length === 0) {
                throw errorMessage(response, '本地 TTS 合成失败');
            }
            return {
                audio: base64ToArrayBuffer(response.audioBase64),
                contentType: response.contentType === 'audio/wav' ? 'audio/wav' : 'audio/wav',
                voice: typeof response.voice === 'string' && response.voice ? response.voice : voice,
                backend: response.backend,
            };
        },
        async prepare(keepWarm = false): Promise<Record<string, unknown>> {
            const response = await client.send<Record<string, unknown>>({
                type: 'LOCAL_TTS_PREPARE',
                keepWarm,
            }, {timeoutMs: 300_000});
            if (!response?.success) throw errorMessage(response, '本地 TTS 模型下载失败');
            return response;
        },
        async status(): Promise<Record<string, unknown>> {
            const response = await client.send<Record<string, unknown>>({
                type: 'LOCAL_TTS_STATUS',
            }, {timeoutMs: 30_000});
            if (!response?.success) throw errorMessage(response, '无法读取本地 TTS 模型状态');
            return response;
        },
        async remove(): Promise<void> {
            const response = await client.send<Record<string, unknown>>({
                type: 'LOCAL_TTS_REMOVE_MODEL',
            }, {timeoutMs: 30_000});
            if (!response?.success) throw errorMessage(response, '本地 TTS 模型清除失败');
        },
    };
}

export const localTtsOffscreenAdapter = createLocalTtsOffscreenAdapter();
