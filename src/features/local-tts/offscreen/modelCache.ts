/**
 * @file src/features/local-tts/offscreen/modelCache.ts
 * 文件职责：下载、检查和清除 Kokoro 本地 TTS 模型及少量默认音色文件。
 * 主要内容：固定模型版本与文件清单，复用 Transformers.js Cache Storage，并把模型下载和音色下载分开管理。
 * 模块边界：只负责缓存文件，不初始化推理 Worker，不决定朗读策略，也不访问网页。
 */

import {
    LOCAL_TTS_MODEL_CACHE_NAME,
    LOCAL_TTS_MODEL_ID,
    LOCAL_TTS_MODEL_REPOSITORY,
    LOCAL_TTS_MODEL_REVISION,
    LOCAL_TTS_MODEL_STATE_KEY,
    LOCAL_TTS_VOICE_CACHE_NAME,
    LOCAL_TTS_VOICE_PATH,
    type LocalTtsVoiceId,
} from '@/src/core/config/localTts';

export const LOCAL_TTS_MODEL_REMOTE_HOST = 'https://huggingface.co/' as const;

/** @remarks fp32 模型的实际推理只需要这组文件；README 和其他量化版本不进入缓存。 */
export const LOCAL_TTS_MODEL_FILES = [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/model.onnx',
] as const;

/** 早期版本的缓存文件只在显式清除时处理，避免升级检查误删用户资源。 */
export const LOCAL_TTS_LEGACY_MODEL_FILES = [
    'onnx/model_q4f16.onnx',
] as const;

export const LOCAL_TTS_VOICES: readonly LocalTtsVoiceId[] = [
    'zf_001',
    'zm_009',
    'af_maple',
    'bf_vale',
];

const MODEL_FILE_DOWNLOAD_TIMEOUT_MS = 300_000;
const pendingDownloads = new Map<string, Promise<void>>();

export function getLocalTtsModelFileUrl(file: string): string {
    return `${LOCAL_TTS_MODEL_REMOTE_HOST}${LOCAL_TTS_MODEL_REPOSITORY}/resolve/${LOCAL_TTS_MODEL_REVISION}/${file}`;
}

/** Transformers.js 默认用 main 作为 Cache Storage key；固定版本仍作为真实下载源。 */
export function getLocalTtsModelLoaderUrl(file: string): string {
    return `${LOCAL_TTS_MODEL_REMOTE_HOST}${LOCAL_TTS_MODEL_REPOSITORY}/resolve/main/${file}`;
}

export function getLocalTtsVoiceRemoteUrl(voice: LocalTtsVoiceId): string {
    return `${LOCAL_TTS_VOICE_PATH}/${voice}.bin`;
}

export function getLocalTtsVoiceCacheUrl(voice: LocalTtsVoiceId): string {
    return getLocalTtsVoiceRemoteUrl(voice);
}

async function fetchIntoCache(
    cache: Cache,
    sourceUrl: string,
    cacheUrls: readonly string[],
): Promise<void> {
    const existing = await (async (): Promise<Response | undefined> => {
        for (const cacheUrl of cacheUrls) {
            const response = await cache.match(cacheUrl);
            if (response) return response;
        }
        return undefined;
    })();
    if (existing) {
        for (const cacheUrl of cacheUrls) {
            if (!(await cache.match(cacheUrl))) await cache.put(cacheUrl, existing.clone());
        }
        return;
    }

    const controller = new AbortController();
    const timeout = self.setTimeout(() => controller.abort(), MODEL_FILE_DOWNLOAD_TIMEOUT_MS);
    try {
        const response = await fetch(sourceUrl, {signal: controller.signal});
        if (!response.ok) throw new Error(`本地 TTS 模型文件下载失败（${response.status}）：${sourceUrl}`);
        const headers = new Headers(response.headers);
        headers.set('X-FluentRead-Model-Source', sourceUrl);
        const body = await response.arrayBuffer();
        for (const cacheUrl of cacheUrls) {
            await cache.put(cacheUrl, new Response(body.slice(0), {
                status: response.status,
                statusText: response.statusText,
                headers,
            }));
        }
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error(`本地 TTS 模型文件下载超过 ${MODEL_FILE_DOWNLOAD_TIMEOUT_MS / 1000} 秒`);
        }
        if (error instanceof Error && error.message.startsWith('本地 TTS 模型文件下载失败')) throw error;
        throw new Error(`本地 TTS 模型文件下载失败：${sourceUrl}：${error instanceof Error ? error.message : String(error)}`, {cause: error});
    } finally {
        self.clearTimeout(timeout);
    }
}

async function cacheLocalTtsModelNow(): Promise<void> {
    if (typeof caches === 'undefined') throw new Error('当前浏览器不支持本地 TTS 模型缓存');
    const cache = await caches.open(LOCAL_TTS_MODEL_CACHE_NAME);
    for (const file of LOCAL_TTS_MODEL_FILES) {
        const pinnedUrl = getLocalTtsModelFileUrl(file);
        await fetchIntoCache(cache, pinnedUrl, [pinnedUrl, getLocalTtsModelLoaderUrl(file)]);
    }

    const voiceCache = await caches.open(LOCAL_TTS_VOICE_CACHE_NAME);
    for (const voice of LOCAL_TTS_VOICES) {
        await fetchIntoCache(voiceCache, getLocalTtsVoiceRemoteUrl(voice), [getLocalTtsVoiceCacheUrl(voice)]);
    }
}

/** 对同一版本的并发下载只保留一个网络任务。 */
export function cacheLocalTtsModelFiles(): Promise<void> {
    const existing = pendingDownloads.get(LOCAL_TTS_MODEL_ID);
    if (existing) return existing;
    const pending = cacheLocalTtsModelNow().finally(() => {
        if (pendingDownloads.get(LOCAL_TTS_MODEL_ID) === pending) pendingDownloads.delete(LOCAL_TTS_MODEL_ID);
    });
    pendingDownloads.set(LOCAL_TTS_MODEL_ID, pending);
    return pending;
}

export async function isLocalTtsModelCached(): Promise<boolean> {
    if (typeof caches === 'undefined') return false;
    const modelCache = await caches.open(LOCAL_TTS_MODEL_CACHE_NAME);
    const voiceCache = await caches.open(LOCAL_TTS_VOICE_CACHE_NAME);
    const modelFiles = await Promise.all(LOCAL_TTS_MODEL_FILES.map(async (file) => {
        const pinnedUrl = getLocalTtsModelFileUrl(file);
        const loaderUrl = getLocalTtsModelLoaderUrl(file);
        const pinned = await modelCache.match(pinnedUrl);
        const loader = await modelCache.match(loaderUrl);
        if (!loader && pinned) await modelCache.put(loaderUrl, pinned.clone());
        return loader || pinned;
    }));
    const voiceFiles = await Promise.all(LOCAL_TTS_VOICES.map((voice) => voiceCache.match(getLocalTtsVoiceCacheUrl(voice))));
    return modelFiles.every(Boolean) && voiceFiles.every(Boolean);
}

export async function removeLocalTtsModelFiles(): Promise<void> {
    if (typeof caches === 'undefined') throw new Error('当前浏览器不支持本地 TTS 模型缓存');
    const modelCache = await caches.open(LOCAL_TTS_MODEL_CACHE_NAME);
    const voiceCache = await caches.open(LOCAL_TTS_VOICE_CACHE_NAME);
    const removableModelFiles = [...LOCAL_TTS_MODEL_FILES, ...LOCAL_TTS_LEGACY_MODEL_FILES];
    await Promise.all([
        ...removableModelFiles.flatMap((file) => [
            modelCache.delete(getLocalTtsModelFileUrl(file)),
            modelCache.delete(getLocalTtsModelLoaderUrl(file)),
        ]),
        ...LOCAL_TTS_VOICES.map((voice) => voiceCache.delete(getLocalTtsVoiceCacheUrl(voice))),
    ]);
}

export {LOCAL_TTS_MODEL_STATE_KEY};
