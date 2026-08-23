import {method, urls} from "../utils/constant";
import {commonMsgTemplate} from "../utils/template";
import {config} from "@/entrypoints/utils/config";
import {contentPostHandler} from "@/entrypoints/utils/check";
import { appendOptionalBearer } from './auth';
import {createHttpStatusError, readJsonResponse} from '@/entrypoints/utils/httpError';
import {runtimeFetch} from '@/entrypoints/utils/http';

/**
 * Grok 服务实现
 * 使用 X.AI API，兼容 OpenAI 接口
 * 当前预设模型：grok-4.5、grok-4.3；也支持用户输入自定义模型编号。
 */
async function grok(message: any) {
    try {
        const service = message.serviceOverride || config.service;
        const headers = new Headers({'Content-Type': 'application/json'});
        appendOptionalBearer(headers, config.token[service]);

        const url = config.proxy[service] || urls[service];

        const resp = await runtimeFetch(url, {
            method: method.POST,
            headers,
            body: commonMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage, message.modelOverride)
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
