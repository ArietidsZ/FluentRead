/**
 * @file src/providers/translation/grok.ts
 *
 * 文件职责：适配 xAI Grok 的 OpenAI 兼容聊天接口，支持预设或自定义模型、代理与 Bearer 鉴权。
 * 主要内容：读取冻结配置，借助 commonMsgTemplate 构造消息，通过 runtimeFetch 调用并校验 choices 内容，最后去除 reasoning 包裹。 可核对的公开符号包括 default:grok。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {method, urls} from "@/src/core/config/constants";
import {commonMsgTemplate} from '@/src/services/translation/templates';
import {config} from "@/src/services/config/store";
import {stripTranslationReasoning as contentPostHandler} from '@/src/core/translation/prompts';
import { appendOptionalBearer } from './auth';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';

/**
 * Grok 服务实现
 * 使用 X.AI API，兼容 OpenAI 接口
 * 当前预设模型：grok-4.5、grok-4.3；也支持用户输入自定义模型编号。
 */
async function grok(message: any) {
    try {
        const current = getTranslationProviderConfig(message, config);
        const service = message.serviceOverride || current.service;
        const headers = new Headers({'Content-Type': 'application/json'});
        appendOptionalBearer(headers, current.token[service]);

        const url = current.proxy[service] || urls[service];

        const resp = await runtimeFetch(url, {
            method: method.POST,
            headers,
            body: commonMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage, message.modelOverride, current)
        });

        if (!resp.ok) {
            throw createHttpStatusError(resp, '翻译失败');
        }

        const result = await readJsonResponse<any>(resp, 'Grok 返回的不是有效 JSON');
        return contentPostHandler(result.choices[0].message.content);
    } catch (error) {
        throw error;
    }
}

export default grok;
