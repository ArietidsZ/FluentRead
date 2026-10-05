/**
 * @file src/platform/storage/modelArtifacts.ts
 * 文件职责：保存固定版本本地模型的分块文件，复用翻译与语音模型的数据下载机制。
 * 主要内容：4 MiB 分块、Range 续传、多来源下载、SHA-256 完整性校验、离线 Blob 读取与按文件清除；保留原有缓存键和错误标识以兼容已下载翻译模型。
 * 模块边界：只访问 Cache Storage 和固定模型数据地址，不选择业务模型、不初始化推理会话、不上传用户输入。
 */
import {sha256} from '@noble/hashes/sha256';

export interface ModelArtifact {
    repo: string;
    revision: string;
    path: string;
    size: number;
    sha256: string;
}
export const LOCAL_MODEL_CACHE = 'fluent-read-local-models-v2';
export const MODEL_CHUNK_SIZE = 4 * 1024 * 1024;
const origins = ['https://huggingface.co', 'https://hf-mirror.com'];

export function artifactUrl(file: ModelArtifact): string {
    return `${origins[0]}/${file.repo}/resolve/${file.revision}/${file.path}`;
}
function chunkKey(file: ModelArtifact, index: number): string {
    return `${artifactUrl(file)}?fluent-read-part=${index}`;
}
function receiptKey(file: ModelArtifact): string {
    return `${artifactUrl(file)}?fluent-read-verified=${file.sha256}`;
}
function abortIfNeeded(signal?: AbortSignal): void {
    if (signal?.aborted) throw new DOMException('Download paused', 'AbortError');
}

export async function artifactComplete(file: ModelArtifact): Promise<boolean> {
    const cache = await caches.open(LOCAL_MODEL_CACHE);
    return Boolean(await cache.match(receiptKey(file)));
}

export async function artifactDownloadedBytes(file: ModelArtifact): Promise<number> {
    const cache = await caches.open(LOCAL_MODEL_CACHE);
    let bytes = 0;
    for (let index = 0; bytes < file.size; index++) {
        const part = await cache.match(chunkKey(file, index));
        const size = Number(part?.headers.get('Content-Length'));
        if (!part || size !== Math.min(MODEL_CHUNK_SIZE, file.size - bytes)) break;
        bytes += size;
    }
    return bytes;
}

export async function removeModelArtifact(file: ModelArtifact): Promise<void> {
    const cache = await caches.open(LOCAL_MODEL_CACHE);
    await cache.delete(receiptKey(file));
    for (let index = 0; index < Math.ceil(file.size / MODEL_CHUNK_SIZE); index++) {
        await cache.delete(chunkKey(file, index));
    }
}

/** Reconstruct a file from disk-backed blobs, avoiding a model-sized JS buffer. */
export async function modelArtifactBlob(file: ModelArtifact): Promise<Blob> {
    const cache = await caches.open(LOCAL_MODEL_CACHE);
    if (!await cache.match(receiptKey(file))) throw new Error('LOCAL_TRANSLATION_NOT_DOWNLOADED');
    const parts: Blob[] = [];
    for (let index = 0; index < Math.ceil(file.size / MODEL_CHUNK_SIZE); index++) {
        const part = await cache.match(chunkKey(file, index));
        if (!part) throw new Error('LOCAL_TRANSLATION_NOT_DOWNLOADED');
        parts.push(await part.blob());
    }
    const blob = new Blob(parts, {type: file.path.endsWith('.json') ? 'application/json' : 'application/octet-stream'});
    if (blob.size !== file.size) throw new Error('LOCAL_TRANSLATION_INTEGRITY');
    return blob;
}

async function verifyArtifact(file: ModelArtifact, signal: AbortSignal): Promise<void> {
    const cache = await caches.open(LOCAL_MODEL_CACHE);
    const digest = sha256.create();
    for (let index = 0; index < Math.ceil(file.size / MODEL_CHUNK_SIZE); index++) {
        abortIfNeeded(signal);
        const part = await cache.match(chunkKey(file, index));
        if (!part) throw new Error('LOCAL_TRANSLATION_INTEGRITY');
        digest.update(new Uint8Array(await part.arrayBuffer()));
    }
    const hash = Array.from(digest.digest(), (value) => value.toString(16).padStart(2, '0')).join('');
    if (hash !== file.sha256) {
        await removeModelArtifact(file);
        throw new Error('LOCAL_TRANSLATION_INTEGRITY');
    }
    abortIfNeeded(signal);
    await cache.put(receiptKey(file), new Response(JSON.stringify({size: file.size, sha256: file.sha256})));
}

async function receiveArtifact(
    file: ModelArtifact,
    origin: string,
    signal: AbortSignal,
    progress: (bytes: number, verifying: boolean) => void,
): Promise<void> {
    const cache = await caches.open(LOCAL_MODEL_CACHE);
    let offset = await artifactDownloadedBytes(file);
    if (offset === file.size) {
        progress(offset, true);
        await verifyArtifact(file, signal);
        return;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, {once: true});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const armTimeout = (ms: number) => {
        clearTimeout(timer);
        timer = setTimeout(abort, ms);
    };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
        abortIfNeeded(signal);
        armTimeout(15_000);
        const response = await fetch(artifactUrl(file).replace(origins[0]!, origin), {
            signal: controller.signal,
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            headers: offset ? {Range: `bytes=${offset}-`} : {},
        });
        if (!response.ok || !response.body) throw new Error('LOCAL_TRANSLATION_NETWORK');
        if (response.status === 206) {
            const range = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(response.headers.get('Content-Range') || '');
            if (!range || Number(range[1]) !== offset || Number(range[2]) !== file.size - 1 || Number(range[3]) !== file.size) {
                throw new Error('LOCAL_TRANSLATION_INTEGRITY');
            }
        } else if (response.status === 200 && offset) {
            // Some sources ignore Range. Replacing chunks from zero keeps the cache coherent.
            await removeModelArtifact(file);
            offset = 0;
        } else if (response.status !== 200) {
            throw new Error('LOCAL_TRANSLATION_NETWORK');
        }
        reader = response.body.getReader();
        let buffer = new Uint8Array(Math.min(MODEL_CHUNK_SIZE, file.size - offset));
        let filled = 0;
        let index = offset / MODEL_CHUNK_SIZE;
        while (true) {
            abortIfNeeded(signal);
            armTimeout(45_000);
            const {done, value} = await reader.read();
            clearTimeout(timer);
            if (done) break;
            if (offset + filled + value.byteLength > file.size) throw new Error('LOCAL_TRANSLATION_INTEGRITY');
            let cursor = 0;
            while (cursor < value.byteLength) {
                const count = Math.min(buffer.byteLength - filled, value.byteLength - cursor);
                buffer.set(value.subarray(cursor, cursor + count), filled);
                cursor += count;
                filled += count;
                if (filled === buffer.byteLength) {
                    abortIfNeeded(signal);
                    await cache.put(chunkKey(file, index++), new Response(buffer, {
                        headers: {'Content-Length': String(filled)},
                    }));
                    offset += filled;
                    filled = 0;
                    buffer = new Uint8Array(Math.min(MODEL_CHUNK_SIZE, file.size - offset));
                }
            }
            progress(offset + filled, false);
        }
        if (offset !== file.size) throw new Error('LOCAL_TRANSLATION_NETWORK');
        progress(offset, true);
        await verifyArtifact(file, signal);
    } finally {
        clearTimeout(timer);
        controller.abort();
        await reader?.cancel().catch(() => undefined);
        signal.removeEventListener('abort', abort);
    }
}

export async function downloadModelArtifact(
    file: ModelArtifact,
    signal: AbortSignal,
    progress: (bytes: number, verifying: boolean) => void,
): Promise<void> {
    if (await artifactComplete(file)) { progress(file.size, false); return; }
    const prefersChina = typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh');
    const sources = prefersChina ? [...origins].reverse() : origins;
    let lastError: unknown;
    for (const origin of sources) {
        abortIfNeeded(signal);
        try {
            await receiveArtifact(file, origin, signal, progress);
            return;
        } catch (error) {
            abortIfNeeded(signal);
            if (error instanceof Error && error.name === 'QuotaExceededError') throw error;
            lastError = error;
        }
    }
    throw lastError;
}
