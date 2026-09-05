/**
 * @file src/providers/translation/azure-translator.ts
 *
 * 文件职责：适配 Azure Translator 官方文本翻译 API，为用户自行配置的 F0 免费资源提供认证翻译入口。
 * 主要内容：从请求快照读取密钥、地域和语言，构造官方 v3 请求，按 1000 项及 50000 字符合并上限分批，验证每项非空译文并响应取消。
 * 模块边界：本文件属于供应商协议适配层，不创建云资源、不切换计费层级、不持有共享密钥；免费回退的启用、顺序和总预算由翻译服务编排层控制。
 */

import {services} from '@/src/core/config/catalog';
import {resolveTranslationLanguages, type TranslationLanguageOverride} from '@/src/core/translation/languages';
import {config} from '@/src/services/config/store';
import {
    getTranslationProviderConfig,
    type TranslationProviderRequest,
    type TranslationProviderRequestContext,
} from '@/src/services/translation/requestSnapshot';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {abortErrorFromSignal, runtimeFetch} from '@/src/platform/http/runtime';

const AZURE_TRANSLATOR_URL = 'https://api.cognitive.microsofttranslator.com/translate';
export const AZURE_TRANSLATOR_MAX_CHARACTERS = 50_000;
export const AZURE_TRANSLATOR_MAX_ITEMS = 1_000;
type AzureTranslatorRequest = TranslationLanguageOverride & TranslationProviderRequestContext;
interface AzureTranslationResponse {
    translations?: Array<{text?: unknown}>;
}

export async function translateAzureTranslatorTexts(
    texts: string[],
    request: AzureTranslatorRequest = {},
): Promise<string[]> {
    if (request.abortSignal?.aborted) throw abortErrorFromSignal(request.abortSignal);
    if (!Array.isArray(texts) || texts.some(text => typeof text !== 'string')) {
        throw Object.assign(new Error('Azure Translator 仅支持文本输入'), {statusCode: 400});
    }
    if (texts.length === 0) return [];
    const current = getTranslationProviderConfig(request, config);
    const key = current.token[services.azureTranslator]?.trim();
    if (!key) throw Object.assign(new Error('请先配置 Azure Translator API Key'), {statusCode: 400});
    const region = current.azureTranslatorRegion?.trim();
    const languages = resolveTranslationLanguages(request, {sourceLanguage: current.from, targetLanguage: current.to});
    const url = new URL(AZURE_TRANSLATOR_URL);
    url.searchParams.set('api-version', '3.0');
    url.searchParams.set('to', languages.targetLanguage);
    if (languages.sourceLanguage === 'auto') url.searchParams.delete('from');
    else url.searchParams.set('from', languages.sourceLanguage);
    const headers: Record<string, string> = {'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': key};
    if (region && region.toLowerCase() !== 'global') headers['Ocp-Apim-Subscription-Region'] = region;

    // UTF-16 长度比 Unicode 码点计数更保守，保证即便输入含 emoji 也不会越界。
    const batches: string[][] = [];
    let batch: string[] = [];
    let characters = 0;
    for (const text of texts) {
        if (text.length > AZURE_TRANSLATOR_MAX_CHARACTERS) {
            throw Object.assign(new Error('Azure Translator 单条文本不能超过 50000 字符'), {statusCode: 400});
        }
        if (batch.length >= AZURE_TRANSLATOR_MAX_ITEMS || characters + text.length > AZURE_TRANSLATOR_MAX_CHARACTERS) {
            batches.push(batch);
            batch = [];
            characters = 0;
        }
        batch.push(text);
        characters += text.length;
    }
    batches.push(batch);

    const translations: string[] = [];
    for (const values of batches) {
        if (request.abortSignal?.aborted) throw abortErrorFromSignal(request.abortSignal);
        const response = await runtimeFetch(url, {
            method: 'POST', headers,
            body: JSON.stringify(values.map(Text => ({Text}))),
            signal: request.abortSignal,
        });
        if (request.abortSignal?.aborted) throw abortErrorFromSignal(request.abortSignal);
        if (!response.ok) throw createHttpStatusError(response, 'Azure Translator 翻译失败');
        const result = await readJsonResponse<AzureTranslationResponse[]>(response, 'Azure Translator 返回的不是有效 JSON');
        if (request.abortSignal?.aborted) throw abortErrorFromSignal(request.abortSignal);
        if (!Array.isArray(result) || result.length !== values.length) {
            throw new Error('Azure Translator 返回的译文数量异常');
        }
        for (const item of result) {
            const translated = item?.translations?.[0]?.text;
            if (typeof translated !== 'string' || !translated.trim()) throw new Error('Azure Translator 未返回有效译文');
            translations.push(translated);
        }
    }
    return translations;
}

export default async function azureTranslator(message: TranslationProviderRequest): Promise<string | string[]> {
    const isSingle = typeof message.origin === 'string';
    const texts = isSingle ? [message.origin as string] : message.origin as string[];
    const translated = await translateAzureTranslatorTexts(texts, message);
    return isSingle ? translated[0]! : translated;
}
