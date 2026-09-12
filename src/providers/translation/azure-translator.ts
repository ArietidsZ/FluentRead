/**
 * @file src/providers/translation/azure-translator.ts
 *
 * 文件职责：适配 Azure AI Translator 文本翻译 v3.0，使用资源密钥与区域调用官方接口，与 Edge 免费端点 microsoft.ts 以及 Azure OpenAI 互不依赖。
 * 主要内容：从请求快照读取 token[azureTranslator] 与 serviceRegion[azureTranslator]，在 Ocp-Apim-Subscription-Key/Region 请求头中携带凭据，构造 api-version=3.0 的 to/from 查询参数，解析 translations[0].text 并回显安全错误码。 可核对的公开符号包括 default:azureTranslator。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {resolveCloudRegion, services} from '@/src/core/config/catalog';
import {AZURE_TRANSLATOR_ENDPOINT, method} from '@/src/core/config/constants';
import {config} from '@/src/services/config/store';
import {getTranslationLanguages} from '@/src/services/translation/languages';
import {createHttpStatusError, createProviderCodeError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {getTranslationProviderConfig, type TranslationProviderRequest} from '@/src/services/translation/requestSnapshot';
import {resolveCloudLanguages} from './cloud/languages';

type AzureTranslatorResponse =
    | Array<{translations?: Array<{text?: string}>}>
    | {error?: {code?: unknown; message?: unknown}};

async function azureTranslator(message: TranslationProviderRequest<string>) {
    const current = getTranslationProviderConfig(message, config);
    const apiKey = current.token[services.azureTranslator]?.trim();
    if (!apiKey) {
        throw new Error('Azure 翻译尚未配置密钥，请先在设置中填写');
    }
    const region = resolveCloudRegion(services.azureTranslator, current.serviceRegion?.[services.azureTranslator]);

    const {sourceLanguage, targetLanguage} = getTranslationLanguages(message);
    const {source, target} = resolveCloudLanguages('azureTranslator', sourceLanguage, targetLanguage);

    const url = new URL(AZURE_TRANSLATOR_ENDPOINT);
    url.searchParams.set('api-version', '3.0');
    url.searchParams.set('to', target);
    url.searchParams.set('textType', 'plain');
    if (source) url.searchParams.set('from', source);

    const response = await runtimeFetch(url.toString(), {
        method: method.POST,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Ocp-Apim-Subscription-Key': apiKey,
            // 全球资源不需要区域头；区域资源缺少该头会返回 401。
            ...(region === 'global' ? {} : {'Ocp-Apim-Subscription-Region': region}),
        },
        body: JSON.stringify([{Text: message.origin}]),
        signal: message.abortSignal,
    });

    if (!response.ok) {
        throw createHttpStatusError(response, 'Azure 翻译请求失败');
    }

    const result = await readJsonResponse<AzureTranslatorResponse>(response, 'Azure 翻译返回的不是有效 JSON');
    if (!Array.isArray(result)) {
        throw createProviderCodeError('Azure 翻译错误', result?.error?.code);
    }
    const translated = result[0]?.translations?.[0]?.text;
    if (typeof translated === 'string') return translated;
    throw new Error('Azure 翻译返回格式异常');
}

export default azureTranslator;
