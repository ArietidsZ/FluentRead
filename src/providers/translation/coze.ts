/**
 * @file src/providers/translation/coze.ts
 *
 * 文件职责：适配 Coze 服务的聊天翻译协议，处理 Bearer 鉴权、代理地址、模板请求和 provider 业务错误码。
 * 主要内容：读取请求级配置，借助 cozeTemplate 生成 payload，通过 runtimeFetch 发起请求，并用 HTTP/JSON 错误助手校验响应后提取译文。 可核对的公开符号包括 default:coze。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {method, urls} from "@/src/core/config/constants";
import {cozeTemplate} from '@/src/services/translation/templates';
import {config} from "@/src/services/config/store";
import {appendOptionalBearer} from './auth';
import {createHttpStatusError, createProviderCodeError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';

async function coze( message: any) {
    const current = getTranslationProviderConfig(message, config);
    const service = message.serviceOverride || current.service;
    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    appendOptionalBearer(headers, current.token[service]);

    // 判断是否使用代理
    let url: string = current.proxy[service] ? current.proxy[service] : urls[service];

    // 发起 fetch 请求
    const resp = await runtimeFetch(url, {
        method: method.POST,
        headers: headers,
        body: cozeTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage, current)
    });

    if (resp.ok) {
        const result = await readJsonResponse<any>(resp, 'Coze 返回的不是有效 JSON');
        if (result.code === 0 && result.msg === "success") {
            return result.messages[0].content;
        } else {
            throw createProviderCodeError('请求失败', result.code);
        }
    } else {
        throw createHttpStatusError(resp);
    }
}

export default coze;
