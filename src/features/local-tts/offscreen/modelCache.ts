/**
 * @file src/features/local-tts/offscreen/modelCache.ts
 * 文件职责：下载、检查和清除 Kokoro 本地 TTS 模型及少量默认音色文件。
 * 主要内容：固定模型版本与文件清单，只向固定版本键流式写入模型，按来源或流式 SHA-256 恢复旧缓存，并把模型下载和音色下载分开管理；下载与清除互斥，等待全部删除落定后释放所有权，避免迟到读写恢复或删除新文件。
 * 模块边界：只负责缓存文件，不初始化推理 Worker，不决定朗读策略，也不访问网页。
 */

import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
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
export const LOCAL_TTS_MODEL_SOURCE_HEADER = 'X-FluentRead-Model-Source';

/** @remarks fp32 模型的实际推理只需要这组文件；README 和其他量化版本不进入缓存。 */
export const LOCAL_TTS_MODEL_FILES = [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/model.onnx',
] as const;

const MODEL_INTEGRITY = {
    'config.json': {size: 44, sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f'},
    'tokenizer.json': {size: 4944, sha256: '5715a60b09d5e4b9074435d68c6ccd5675b9d48b220e109fdea3cda681e23d15'},
    'tokenizer_config.json': {size: 113, sha256: 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20'},
    'onnx/model.onnx': {size: 339369442, sha256: '94b973941b1852754f979be5d5e20be666d5c81d9bb886b88ae1dc85c9b895ca'},
} as const;

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
let removing = false;
let pendingStatus: Promise<boolean> | undefined;

export function getLocalTtsModelFileUrl(file: string): string {
    return `${LOCAL_TTS_MODEL_REMOTE_HOST}${LOCAL_TTS_MODEL_REPOSITORY}/resolve/${LOCAL_TTS_MODEL_REVISION}/${file}`;
}

/** 旧版 Transformers.js 的 main 别名，仅用于可信迁移和显式清除。 */
export function getLocalTtsModelLoaderUrl(file: string): string {
    return `${LOCAL_TTS_MODEL_REMOTE_HOST}${LOCAL_TTS_MODEL_REPOSITORY}/resolve/main/${file}`;
}

export function getLocalTtsVoiceRemoteUrl(voice: LocalTtsVoiceId): string {
    return `${LOCAL_TTS_VOICE_PATH}/${voice}.bin`;
}

export function getLocalTtsVoiceCacheUrl(voice: LocalTtsVoiceId): string {
    return getLocalTtsVoiceRemoteUrl(voice);
}

/** 校验流只被一个消费者读取；不 tee/clone 大模型，校验失败不能提交 canonical 文件。 */
export function verifyLocalTtsModelResponse(url: string, response: Response) {
    const file = LOCAL_TTS_MODEL_FILES.find(file => getLocalTtsModelFileUrl(file) === url);
    if (!file || !response.ok || !response.body) return undefined;
    const expected = MODEL_INTEGRITY[file];
    const digest = sha256.create();
    const controller = new AbortController();
    let received = 0;
    let verified = false;
    let streamController!: TransformStreamDefaultController<Uint8Array>;
    const verifier = new TransformStream<Uint8Array, Uint8Array>({
        start(controller) {streamController = controller;},
        transform(chunk, output) {
            received += chunk.byteLength;
            if (received > expected.size) throw new Error('LOCAL_TTS_CACHE_INTEGRITY');
            digest.update(chunk);
            output.enqueue(chunk);
        },
        flush() {
            if (received !== expected.size || bytesToHex(digest.digest()) !== expected.sha256) throw new Error('LOCAL_TTS_CACHE_INTEGRITY');
            verified = true;
        },
    });
    const abort = () => {
        controller.abort();
        // Error the stream even if its readable is locked by a stalled consumer.
        streamController.error(controller.signal.reason);
    };
    const timer = setTimeout(abort, MODEL_FILE_DOWNLOAD_TIMEOUT_MS);
    const completed = response.body.pipeTo(verifier.writable, {signal: controller.signal})
        .finally(() => {clearTimeout(timer); digest.destroy();});
    void completed.catch(() => undefined);
    const headers = new Headers(response.headers);
    headers.set(LOCAL_TTS_MODEL_SOURCE_HEADER, url);
    return {response: new Response(verifier.readable, {headers}), completed,
        verified: () => verified, abort};
}

/** 来源头由本地固定版本下载器写入；不能把未知 main 文件当作当前版本。 */
async function ensureCanonicalModelFile(cache: Cache, file: string, tolerateWriteFailure = false): Promise<boolean> {
    const pinnedUrl = getLocalTtsModelFileUrl(file);
    const loaderUrl = getLocalTtsModelLoaderUrl(file);
    const pinned = await cache.match(pinnedUrl);
    const current = pinned?.ok && pinned.headers.get(LOCAL_TTS_MODEL_SOURCE_HEADER) === pinnedUrl;
    const legacy = current ? undefined : await cache.match(loaderUrl);
    if (current || legacy?.ok && legacy.headers.get(LOCAL_TTS_MODEL_SOURCE_HEADER) === pinnedUrl) {
        try {
            if (!current) await cache.put(pinnedUrl, legacy!);
            await cache.delete(loaderUrl);
        } catch (error) {
            if (!tolerateWriteFailure) throw error;
        }
        return true;
    }
    for (const [candidateUrl, candidate] of [[pinnedUrl, pinned], [loaderUrl, legacy]] as const) {
        if (!candidate) continue;
        const check = verifyLocalTtsModelResponse(pinnedUrl, candidate);
        if (!check) continue;
        let failure: unknown;
        let writeFailed = false;
        try {await cache.put(pinnedUrl, check.response);}
        catch (error) {failure = error; writeFailed = true;}
        finally {check.abort(); await check.completed.catch(() => undefined);}
        if (!check.verified()) {
            // Cache.put may reject before consuming (for example on quota failure).
            // Re-read once without storing or retaining chunks to preserve offline use.
            if (writeFailed) {
                const retry = await cache.match(candidateUrl);
                const verification = retry && verifyLocalTtsModelResponse(pinnedUrl, retry);
                if (verification) {
                    try {
                        await verification.response.body!.pipeTo(new WritableStream({write() {}}));
                    } catch { /* Corrupt or interrupted entries remain unready. */ }
                    finally {verification.abort(); await verification.completed.catch(() => undefined);}
                    if (verification.verified()) {
                        if (!tolerateWriteFailure) throw failure;
                        return true;
                    }
                }
            }
            continue;
        }
        if (writeFailed) {
            if (!tolerateWriteFailure) throw failure;
        } else {
            try {await cache.delete(loaderUrl);}
            catch (error) {if (!tolerateWriteFailure) throw error;}
        }
        return true;
    }
    return false;
}

async function fetchIntoCache(cache: Cache, sourceUrl: string): Promise<void> {
    const controller = new AbortController();
    const timeout = self.setTimeout(() => controller.abort(), MODEL_FILE_DOWNLOAD_TIMEOUT_MS);
    try {
        const response = await fetch(sourceUrl, {signal: controller.signal});
        if (!response.ok) throw new Error(`本地 TTS 模型文件下载失败（${response.status}）：${sourceUrl}`);
        const headers = new Headers(response.headers);
        headers.set(LOCAL_TTS_MODEL_SOURCE_HEADER, sourceUrl);
        await cache.put(sourceUrl, new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        }));
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
        if (await ensureCanonicalModelFile(cache, file)) continue;
        await fetchIntoCache(cache, pinnedUrl);
        await cache.delete(getLocalTtsModelLoaderUrl(file));
    }

    const voiceCache = await caches.open(LOCAL_TTS_VOICE_CACHE_NAME);
    for (const voice of LOCAL_TTS_VOICES) {
        const url = getLocalTtsVoiceCacheUrl(voice);
        if (!(await voiceCache.match(url))) await fetchIntoCache(voiceCache, url);
    }
}

/** 对同一版本的并发下载只保留一个网络任务。 */
export function cacheLocalTtsModelFiles(): Promise<void> {
    if (removing) return Promise.reject(new Error('正在清除本地 TTS 模型，请稍后重试'));
    const existing = pendingDownloads.get(LOCAL_TTS_MODEL_ID);
    if (existing) return existing;
    const pending = cacheLocalTtsModelNow().finally(() => {
        if (pendingDownloads.get(LOCAL_TTS_MODEL_ID) === pending) pendingDownloads.delete(LOCAL_TTS_MODEL_ID);
    });
    pendingDownloads.set(LOCAL_TTS_MODEL_ID, pending);
    return pending;
}

export function isLocalTtsModelCached(): Promise<boolean> {
    if (removing) return Promise.resolve(false);
    return pendingStatus ??= inspectLocalTtsModelCache().finally(() => { pendingStatus = undefined; });
}

async function inspectLocalTtsModelCache(): Promise<boolean> {
    if (typeof caches === 'undefined') return false;
    const modelCache = await caches.open(LOCAL_TTS_MODEL_CACHE_NAME);
    const voiceCache = await caches.open(LOCAL_TTS_VOICE_CACHE_NAME);
    const checkedFiles = await Promise.allSettled(LOCAL_TTS_MODEL_FILES.map(file => ensureCanonicalModelFile(modelCache, file, true)));
    const modelFiles = checkedFiles.map(result => {
        if (result.status === 'rejected') throw result.reason;
        return result.value;
    });
    const voiceFiles = await Promise.all(LOCAL_TTS_VOICES.map((voice) => voiceCache.match(getLocalTtsVoiceCacheUrl(voice))));
    return modelFiles.every(Boolean) && voiceFiles.every(Boolean);
}

export async function removeLocalTtsModelFiles(): Promise<void> {
    if (pendingDownloads.has(LOCAL_TTS_MODEL_ID)) throw new Error('本地 TTS 模型正在下载，请完成后再清除模型');
    if (removing) throw new Error('正在清除本地 TTS 模型，请稍后重试');
    if (typeof caches === 'undefined') throw new Error('当前浏览器不支持本地 TTS 模型缓存');
    removing = true;
    try {
        await pendingStatus?.catch(() => undefined);
        const modelCache = await caches.open(LOCAL_TTS_MODEL_CACHE_NAME);
        const voiceCache = await caches.open(LOCAL_TTS_VOICE_CACHE_NAME);
        const removableModelFiles = [...LOCAL_TTS_MODEL_FILES, ...LOCAL_TTS_LEGACY_MODEL_FILES];
        const results = await Promise.allSettled([
            ...removableModelFiles.flatMap((file) => [
                modelCache.delete(getLocalTtsModelFileUrl(file)),
                modelCache.delete(getLocalTtsModelLoaderUrl(file)),
            ]),
            ...LOCAL_TTS_VOICES.map((voice) => voiceCache.delete(getLocalTtsVoiceCacheUrl(voice))),
        ]);
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
    } finally {
        removing = false;
    }
}

export {LOCAL_TTS_MODEL_STATE_KEY};
