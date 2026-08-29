/**
 * @file src/providers/translation/tongyi.ts
 *
 * 文件职责：适配阿里云通义千问 OpenAI 兼容接口，并根据模型选择常规或 token-plan 计费端点。
 * 主要内容：从配置快照解析服务、模型、proxy 和 token，使用 tongyiMsgTemplate 生成 payload，通过 runtimeFetch 请求并读取 choices 译文。 可核对的公开符号包括 default:tongyi。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {currentModelIds, services} from "@/src/core/config/catalog";
import {method, tongyiTokenPlanUrl, urls} from "@/src/core/config/constants";
import {tongyiMsgTemplate} from '@/src/services/translation/templates';
import {config} from "@/src/services/config/store";
import {appendOptionalBearer} from './auth';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {
    getTranslationProviderConfig,
    type TranslationProviderRequest,
} from '@/src/services/translation/requestSnapshot';

// 文档：https://help.aliyun.com/zh/dashscope/developer-reference/tongyi-thousand-questions-metering-and-billing
async function tongyi(message: TranslationProviderRequest<string>) {
    const current = getTranslationProviderConfig(message, config);
    const service = message.serviceOverride || services.tongyi;
    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    appendOptionalBearer(headers, current.token[service]);

    // 判断是否使用代理
    const selectedModel = message.modelOverride || current.model[service];
    const officialUrl = selectedModel === currentModelIds.tongyiTokenPlan
        ? tongyiTokenPlanUrl
        : urls[services.tongyi];
    const url: string = current.proxy[service] || officialUrl;

    const resp = await runtimeFetch(url, {
        method: method.POST,
        headers: headers,
        body: tongyiMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage, message.modelOverride, current),
        signal: message.abortSignal,
    });

    if (resp.ok) {
        const result = await readJsonResponse<any>(resp, '通义千问返回的不是有效 JSON');
        return result.choices[0].message.content;
    } else {
        throw createHttpStatusError(resp, '翻译失败');
    }
}

export default tongyi;


//
