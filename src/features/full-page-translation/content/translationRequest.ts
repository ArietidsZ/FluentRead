/**
 * @file src/features/full-page-translation/content/translationRequest.ts
 * 文件职责：为单次全文翻译会话冻结请求配置，并执行文本槽的批量、分包、回退与会话级结果复用。
 * 主要内容：捕获服务/模型/语言/缓存/展示快照，构造显式 client 参数，按服务选择批译策略，并维护有界的会话槽缓存。
 * 模块边界：本文件不发现候选、不持有 DOM 翻译状态也不渲染译文；runtime 提供会话缓存和取消作用域，client 负责后台协议与队列执行。
 */
import {resolveConfiguredModel, services} from '@/src/core/config/catalog';
import {styles} from '@/src/core/config/constants';
import {parseTranslationSlots, serializeTranslationSlots} from '@/src/core/translation/public';
import {config} from '@/src/services/config/store';
import {translateText, translateTextBatch, type TranslateOptions} from '@/src/app/translation/client';
import {
    cancelTranslationQueueSession,
    type TranslationQueueSession,
} from '@/src/services/translation/queue';

const FULL_PAGE_TRANSLATION_CACHE_LIMIT = 512;

export interface FullPageTranslationConfigSnapshot {
    service: string;
    model: string;
    sourceLanguage: string;
    targetLanguage: string;
    useCache: boolean;
    displayMode: 'bilingual' | 'single';
    style: number;
}

export interface FullPageTranslationCacheEntry {
    promise: Promise<string | undefined>;
    settled: boolean;
}

type SnapshotTranslateExecutionOptions = Pick<
    TranslateOptions,
    'queueSession' | 'signal' | 'skipLanguageDetection' | 'useCache'
>;

interface FullPageTranslationSessionCache {
    active: boolean;
    translationSlotCache: Map<string, FullPageTranslationCacheEntry>;
}

export function captureFullPageTranslationConfig(): FullPageTranslationConfigSnapshot {
    const service = config.service;
    return {
        service,
        model: resolveConfiguredModel(config.model[service], config.customModel[service]),
        sourceLanguage: config.from,
        targetLanguage: config.to,
        useCache: config.useCache,
        displayMode: config.display === styles.bilingualTranslation ? 'bilingual' : 'single',
        style: config.style,
    };
}

function createSnapshotTranslateOptions(
    snapshot: FullPageTranslationConfigSnapshot,
    options: SnapshotTranslateExecutionOptions = {},
): TranslateOptions {
    return {
        ...options,
        serviceOverride: snapshot.service,
        modelOverride: snapshot.model || undefined,
        sourceLanguage: snapshot.sourceLanguage,
        targetLanguage: snapshot.targetLanguage,
        // 非会话 batch 需要显式禁用 broker 缓存；其余调用继续使用冻结的会话值。
        useCache: options.useCache ?? snapshot.useCache,
    };
}

function createAbortError(): Error {
    try {
        return new DOMException('翻译已取消', 'AbortError');
    } catch {
        const error = new Error('翻译已取消');
        error.name = 'AbortError';
        return error;
    }
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw createAbortError();
}

async function translateSlotsIndividually(
    origins: readonly string[],
    snapshot: FullPageTranslationConfigSnapshot,
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
): Promise<string[]> {
    throwIfAborted(signal);
    const translations = new Array<string>(origins.length);
    let nextIndex = 0;
    const workerCount = Math.min(3, origins.length);
    let failed = false;
    let firstError: unknown;
    let hasFirstError = false;
    const siblingController = new AbortController();
    const abortSiblings = () => {
        siblingController.abort();
        if (queueSession) cancelTranslationQueueSession(queueSession, createAbortError());
    };
    signal?.addEventListener('abort', abortSiblings, {once: true});
    const workers = Array.from({length: workerCount}, async () => {
        while (!failed && nextIndex < origins.length) {
            throwIfAborted(siblingController.signal);
            const index = nextIndex++;
            try {
                translations[index] = await translateText(origins[index] ?? '', document.title,
                    createSnapshotTranslateOptions(snapshot, {signal: siblingController.signal, queueSession}));
            } catch (error) {
                if (!hasFirstError) {
                    hasFirstError = true;
                    firstError = error;
                }
                failed = true;
                siblingController.abort();
                if (queueSession) cancelTranslationQueueSession(queueSession, firstError);
                throw error;
            }
        }
    });
    try {
        const outcomes = await Promise.allSettled(workers);
        if (hasFirstError) throw firstError;
        const rejected = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
        if (rejected) throw rejected.reason;
        return translations;
    } finally {
        signal?.removeEventListener('abort', abortSiblings);
    }
}

function createCacheKey(origin: string, snapshot: FullPageTranslationConfigSnapshot): string {
    return JSON.stringify({
        service: snapshot.service,
        model: snapshot.model,
        from: snapshot.sourceLanguage,
        to: snapshot.targetLanguage,
        origin,
    });
}

function rememberTranslation(
    session: FullPageTranslationSessionCache,
    key: string,
    result: Promise<string | undefined>,
): void {
    const entry: FullPageTranslationCacheEntry = {promise: result, settled: false};
    session.translationSlotCache.delete(key);
    session.translationSlotCache.set(key, entry);
    while (session.translationSlotCache.size > FULL_PAGE_TRANSLATION_CACHE_LIMIT) {
        const oldestKey = session.translationSlotCache.keys().next().value as string;
        session.translationSlotCache.delete(oldestKey);
    }
    void result.then(
        () => {
            if (session.translationSlotCache.get(key) === entry) entry.settled = true;
        },
        () => {
            if (session.translationSlotCache.get(key) === entry) session.translationSlotCache.delete(key);
        },
    );
}

export async function translateTextSlots(
    origins: readonly string[],
    snapshot: FullPageTranslationConfigSnapshot,
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
    fullPageSession?: FullPageTranslationSessionCache,
): Promise<string[]> {
    if (origins.length === 0) return [];
    throwIfAborted(signal);
    const batchFriendly = snapshot.service === services.microsoft
        || snapshot.service === services.freeTranslation;
    if (batchFriendly) {
        if (!fullPageSession?.active) {
            return translateTextBatch([...origins], document.title,
                createSnapshotTranslateOptions(snapshot, {useCache: false, signal, queueSession}));
        }

        const resultPromises = new Array<Promise<string | undefined>>(origins.length);
        const missing = new Map<string, {origin: string; indexes: number[]}>();
        for (const [index, origin] of origins.entries()) {
            const key = createCacheKey(origin, snapshot);
            const cached = fullPageSession.translationSlotCache.get(key);
            if (cached?.settled) {
                resultPromises[index] = cached.promise;
                continue;
            }
            const entry = missing.get(key);
            if (entry) entry.indexes.push(index);
            else missing.set(key, {origin, indexes: [index]});
        }

        if (missing.size > 0) {
            const entries = [...missing.values()];
            const providerRequest = translateTextBatch(
                entries.map(({origin}) => origin),
                document.title,
                createSnapshotTranslateOptions(snapshot, {signal, queueSession}),
            ).then((translations) =>
                Array.isArray(translations) && translations.length === entries.length
                && translations.every((translation) => typeof translation === 'string')
                    ? translations
                    : null,
            );
            entries.forEach(({origin, indexes}, entryIndex) => {
                const key = createCacheKey(origin, snapshot);
                const result = providerRequest.then((translations) => translations?.[entryIndex]);
                rememberTranslation(fullPageSession, key, result);
                indexes.forEach((index) => {
                    resultPromises[index] = result;
                });
            });
        }

        const translations = await Promise.all(resultPromises);
        if (translations.some((translation) => typeof translation !== 'string')) {
            fullPageSession.translationSlotCache.clear();
            return [];
        }
        return translations as string[];
    }
    if (origins.length === 1) {
        return [await translateText(origins[0] ?? '', document.title,
            createSnapshotTranslateOptions(snapshot, {signal, queueSession}))];
    }

    const packet = serializeTranslationSlots(origins);
    const combined = await translateText(packet.payload, document.title, createSnapshotTranslateOptions(snapshot, {
        skipLanguageDetection: true,
        signal,
        queueSession,
    }));
    const parsed = parseTranslationSlots(packet, combined);
    if (parsed?.length === origins.length) return parsed;
    return translateSlotsIndividually(origins, snapshot, signal, queueSession);
}
