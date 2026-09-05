/**
 * @file src/providers/translation/free-translation.ts
 * 文件职责：按冻结的用户设置编排免费翻译，并接入有界请求、取消和跨段冷却。
 * 主要内容：装配按序服务、过滤未配置的免费凭据、冻结批量配置并生成匿名连接身份。
 * 模块边界：只装配已有 provider；健康状态与并发调度由 freeFallback 服务持有。
 */
import sha256 from 'crypto-js/sha256';
import {translateMicrosoftTexts} from './microsoft';
import {translateDeepLXText} from './deeplx';
import {translateGoogleText} from './google';
import myMemory from './mymemory';
import azureTranslator from './azure-translator';
import deepL from './deepl';
import {services} from '@/src/core/config/catalog';
import {urls} from '@/src/core/config/constants';
import {getDeepLXEndpoints} from '@/src/core/config/deeplx';
import {
    DEFAULT_FREE_TRANSLATION_ORDER,
    FREE_TRANSLATION_PROVIDERS,
    normalizeFreeTranslationOrder,
    normalizeFreeTranslationTimeoutMs,
    normalizeFreeTranslationCooldownMs,
} from '@/src/core/config/freeTranslation';
import {config} from '@/src/services/config/store';
import {abortErrorFromSignal} from '@/src/platform/http/runtime';
import {createFreeFallbackRunner, type FreeFallbackCandidate} from '@/src/services/translation/freeFallback';
import {
    attachTranslationProviderConfig,
    createTranslationProviderConfigSnapshot,
    getTranslationProviderConfig,
    type TranslationProviderRequest,
} from '@/src/services/translation/requestSnapshot';
import type {TranslationProviderConfigSnapshot} from '@/src/services/translation/types';

type FreeTranslationRequest = Omit<TranslationProviderRequest<string>, 'origin'>;
const FREE_TRANSLATION_DEADLINE = Symbol('free-translation-deadline');
type PreparedRequest = FreeTranslationRequest & {readonly [FREE_TRANSLATION_DEADLINE]?: number};
type FreeProviderId = typeof FREE_TRANSLATION_PROVIDERS[number]['id'];

export const FREE_TRANSLATION_ORDER = DEFAULT_FREE_TRANSLATION_ORDER.map(id => (
    FREE_TRANSLATION_PROVIDERS.find(provider => provider.id === id)!.label
));
export const FREE_TRANSLATION_BATCH_CONCURRENCY = 3;
const runFallback = createFreeFallbackRunner(FREE_TRANSLATION_BATCH_CONCURRENCY);
const providerTranslators: Record<FreeProviderId, (request: TranslationProviderRequest<string>) => Promise<unknown>> = {
    microsoft: async request => {
        const results = await translateMicrosoftTexts([request.origin], request.sourceLanguage!, request.targetLanguage!, request.abortSignal);
        return results[0];
    },
    deeplx: request => translateDeepLXText(request.origin, services.deeplx, request),
    google: request => translateGoogleText(request.origin, request.sourceLanguage!, request.targetLanguage!, request.abortSignal),
    myMemory,
    azureTranslator,
    deepL,
};

function prepareRequest(message: FreeTranslationRequest): PreparedRequest {
    // provider 直调也在第一次 await 之前冻结；批量中的所有文本共享该副本与截止时间。
    const current = createTranslationProviderConfigSnapshot(getTranslationProviderConfig(message, config));
    const budget = message.requestTimeoutMs;
    return attachTranslationProviderConfig({
        ...message,
        sourceLanguage: message.sourceLanguage || current.from,
        targetLanguage: message.targetLanguage || current.to,
        [FREE_TRANSLATION_DEADLINE]: typeof budget === 'number' && Number.isFinite(budget)
            ? Date.now() + Math.max(0, budget) : undefined,
    }, current);
}

function canUseProvider(id: string, current: TranslationProviderConfigSnapshot): boolean {
    if (id === services.azureTranslator) return Boolean(current.token[id]?.trim());
    if (id !== services.deepL) return true;
    const endpoint = current.proxy[id]?.trim();
    // 明确的 Free 密钥和官方免费端点才进入免费链，避免误用付费方案/自定义代理。
    return Boolean(current.token[id]?.trim().endsWith(':fx'))
        && (!endpoint || endpoint === 'https://api-free.deepl.com/v2/translate');
}

function providerIdentity(id: string, current: TranslationProviderConfigSnapshot): string {
    // 只哈希该 provider 实际读取的连接配置；更换其他服务不应解除已知配额冷却。
    const connection = id === services.deeplx
        ? [getDeepLXEndpoints(current.deeplx, current.proxy[id], current.token[id]?.trim()), current.token[id]]
        : id === services.azureTranslator
            ? [urls[id], current.token[id], current.azureTranslatorRegion]
            : id === services.myMemory
                ? [urls[id], current.myMemoryEmail]
                : id === services.deepL
                    ? [current.proxy[id] || urls[id], current.token[id]]
                    : [id];
    return `${id}:${sha256(JSON.stringify(connection)).toString()}`;
}

function candidatesFor(text: string, message: PreparedRequest): FreeFallbackCandidate[] {
    const current = getTranslationProviderConfig(message, config);
    return normalizeFreeTranslationOrder(current.freeTranslationOrder).flatMap(id => {
        const provider = FREE_TRANSLATION_PROVIDERS.find(item => item.id === id);
        if (!provider || !canUseProvider(id, current)) return [];
        return [{
            identity: providerIdentity(id, current),
            label: provider.label,
            translate: (signal: AbortSignal) => providerTranslators[provider.id]({
                ...message, origin: text, serviceOverride: id, abortSignal: signal,
            }),
        }];
    });
}

async function translatePreparedText(text: string, message: PreparedRequest): Promise<string> {
    if (typeof text !== 'string') throw new Error('免费翻译服务仅支持文本输入');
    const current = getTranslationProviderConfig(message, config);
    return runFallback(candidatesFor(text, message), {
        signal: message.abortSignal,
        timeoutMs: normalizeFreeTranslationTimeoutMs(current.freeTranslationTimeoutMs),
        cooldownMs: normalizeFreeTranslationCooldownMs(current.freeTranslationCooldownMs),
        deadline: message[FREE_TRANSLATION_DEADLINE],
    });
}

export async function translateFreeText(text: string, message: FreeTranslationRequest = {}): Promise<string> {
    return translatePreparedText(text, prepareRequest(message));
}

async function translateFreeBatch(texts: string[], message: PreparedRequest): Promise<string[]> {
    const translations = new Array<string>(texts.length);
    const batchController = new AbortController();
    const onCallerAbort = () => batchController.abort(message.abortSignal?.reason);
    if (message.abortSignal?.aborted) onCallerAbort();
    else message.abortSignal?.addEventListener('abort', onCallerAbort, {once: true});
    const batchMessage = {...message, abortSignal: batchController.signal};
    let nextIndex = 0;
    let stopped = false;

    const worker = async () => {
        while (!stopped) {
            if (batchController.signal.aborted) throw abortErrorFromSignal(batchController.signal);
            const index = nextIndex++;
            if (index >= texts.length) return;
            try {
                translations[index] = await translatePreparedText(texts[index], batchMessage);
            } catch (error) {
                stopped = true;
                if (!batchController.signal.aborted) batchController.abort(error);
                throw error;
            }
        }
    };
    try {
        await Promise.all(Array.from({length: Math.min(FREE_TRANSLATION_BATCH_CONCURRENCY, texts.length)}, () => worker()));
        return translations;
    } finally {
        message.abortSignal?.removeEventListener('abort', onCallerAbort);
    }
}

export default async function freeTranslation(message: TranslationProviderRequest) {
    const prepared = prepareRequest(message);
    if (typeof message.origin === 'string') return translatePreparedText(message.origin, prepared);
    if (Array.isArray(message.origin)) return translateFreeBatch(message.origin, prepared);
    throw new Error('免费翻译服务仅支持文本输入');
}
