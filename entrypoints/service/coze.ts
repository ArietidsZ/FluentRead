import {method, urls} from "../utils/constant";
import {cozeTemplate} from "@/entrypoints/utils/template";
import {config} from "@/entrypoints/utils/config";
import {appendOptionalBearer} from './auth';
import {createHttpStatusError, createProviderCodeError, readJsonResponse} from '@/entrypoints/utils/httpError';

async function coze( message: any) {
    const service = message.serviceOverride || config.service;
    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    appendOptionalBearer(headers, config.token[service]);

    // 判断是否使用代理
    let url: string = config.proxy[service] ? config.proxy[service] : urls[service];

    // 发起 fetch 请求
    const resp = await runtimeFetch(url, {
        method: method.POST,
        headers: headers,
        body: cozeTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage)
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
