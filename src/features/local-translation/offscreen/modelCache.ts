/**
 * @file src/features/local-translation/offscreen/modelCache.ts
 *
 * 文件职责：下载、检查和清除本地翻译模型的 Transformers.js 文件。
 * 主要内容：固定 q8 文件清单，使用 Transformers.js 共用的 Cache Storage，避免把模型仓库的无关文件带入扩展。
 * 模块边界：只负责模型文件缓存，不初始化 ONNX session，也不持有 Worker 或页面状态。
 */
import {
    LOCAL_TRANSLATION_DTYPE,
    LOCAL_TRANSLATION_MODEL_REMOTE_HOST,
    LOCAL_TRANSLATION_MODEL_REVISION,
    normalizeLocalTranslationModel,
    type LocalTranslationModelId,
} from '@/src/core/config/localTranslation';

export const LOCAL_TRANSLATION_MODEL_CACHE_NAME = 'transformers-cache';
export const LOCAL_TRANSLATION_MODEL_FILES = [
    'config.json',
    'generation_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'special_tokens_map.json',
    'onnx/encoder_model_quantized.onnx',
    'onnx/decoder_model_merged_quantized.onnx',
] as const;

const MODEL_FILE_DOWNLOAD_TIMEOUT_MS = 300_000;
const pendingDownloads = new Map<string, Promise<void>>();

export function getLocalTranslationModelFileUrl(modelValue: unknown, file: string): string {
    const model = normalizeLocalTranslationModel(modelValue);
    return `${LOCAL_TRANSLATION_MODEL_REMOTE_HOST}${model}/resolve/${LOCAL_TRANSLATION_MODEL_REVISION}/${file}`;
}

function cacheKey(model: LocalTranslationModelId): string {
    return `${model}:${LOCAL_TRANSLATION_DTYPE}`;
}

async function cacheModelFilesNow(model: LocalTranslationModelId): Promise<void> {
    if (typeof caches === 'undefined') throw new Error('当前浏览器不支持本地模型缓存');
    const cache = await caches.open(LOCAL_TRANSLATION_MODEL_CACHE_NAME);

    for (const file of LOCAL_TRANSLATION_MODEL_FILES) {
        const url = getLocalTranslationModelFileUrl(model, file);
        if (await cache.match(url)) continue;

        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), MODEL_FILE_DOWNLOAD_TIMEOUT_MS);
        try {
            const response = await fetch(url, {signal: controller.signal});
            if (!response.ok) throw new Error(`本地翻译模型文件下载失败（${response.status}）：${file}`);
            await cache.put(url, response);
        } catch (error) {
            if (controller.signal.aborted) {
                throw new Error(`本地翻译模型文件下载超过 ${MODEL_FILE_DOWNLOAD_TIMEOUT_MS / 1000} 秒：${file}`);
            }
            throw error;
        } finally {
            window.clearTimeout(timeout);
        }
    }
}

/** 对同一模型的并发下载只保留一个网络任务。 */
export function cacheLocalTranslationModelFiles(modelValue: unknown): Promise<void> {
    const model = normalizeLocalTranslationModel(modelValue);
    const key = cacheKey(model);
    const existing = pendingDownloads.get(key);
    if (existing) return existing;

    const pending = cacheModelFilesNow(model).finally(() => {
        if (pendingDownloads.get(key) === pending) pendingDownloads.delete(key);
    });
    pendingDownloads.set(key, pending);
    return pending;
}

export async function isLocalTranslationModelCached(modelValue: unknown): Promise<boolean> {
    if (typeof caches === 'undefined') return false;
    const model = normalizeLocalTranslationModel(modelValue);
    const cache = await caches.open(LOCAL_TRANSLATION_MODEL_CACHE_NAME);
    const matches = await Promise.all(LOCAL_TRANSLATION_MODEL_FILES.map((file) => (
        cache.match(getLocalTranslationModelFileUrl(model, file))
    )));
    return matches.every(Boolean);
}

export async function getLocalTranslationModelCacheState(): Promise<Record<string, boolean>> {
    const {LOCAL_TRANSLATION_MODELS} = await import('@/src/core/config/localTranslation');
    const entries = await Promise.all(LOCAL_TRANSLATION_MODELS.map(async (model) => [
        model.value,
        await isLocalTranslationModelCached(model.value),
    ] as const));
    return Object.fromEntries(entries);
}

/** 只删除指定模型的文件，保留视频 Whisper 等其他 Transformers.js 缓存。 */
export async function removeLocalTranslationModelFiles(modelValue: unknown): Promise<void> {
    if (typeof caches === 'undefined') throw new Error('当前浏览器不支持本地模型缓存');
    const model = normalizeLocalTranslationModel(modelValue);
    const cache = await caches.open(LOCAL_TRANSLATION_MODEL_CACHE_NAME);
    await Promise.all(LOCAL_TRANSLATION_MODEL_FILES.map((file) => (
        cache.delete(getLocalTranslationModelFileUrl(model, file))
    )));
}
