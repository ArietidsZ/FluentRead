/**
 * @file src/providers/translation/claude.ts
 *
 * 文件职责：适配 Anthropic Claude Messages API，将 FluentRead 翻译消息转换为 Claude 请求并解析文本响应。
 * 主要内容：从配置快照选择模型、代理和 x-api-key，使用 claudeMsgTemplate 构建 body，通过 runtimeFetch 发起请求，并统一处理 HTTP 状态及 JSON 数据。 可核对的公开符号包括 default:claude。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {services} from "@/src/core/config/catalog";
import {method, urls} from "@/src/core/config/constants";
import {claudeMsgTemplate} from '@/src/services/translation/templates';
import {config} from "@/src/services/config/store";
import {appendOptionalHeader} from './auth';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';

async function claude(message: any) {
    const current = getTranslationProviderConfig(message, config);
    const service = message.serviceOverride || services.claude;
    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    appendOptionalHeader(headers, 'x-api-key', current.token[service]);
    headers.append('anthropic-version', '2023-06-01');
    headers.append('anthropic-dangerous-direct-browser-access', 'true');

    const url = current.proxy[service] || urls[services.claude];

    try {
        const resp = await runtimeFetch(url, {
            method: method.POST,
            headers,
            body: claudeMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage, message.modelOverride, current)
        });

        if (!resp.ok) {
            throw createHttpStatusError(resp);
        }

        const result = await readJsonResponse<any>(resp, 'Claude 返回的不是有效 JSON');
        return result.content[0].text;
    } catch (error) {
        throw error;
    }
}

export default claude;
