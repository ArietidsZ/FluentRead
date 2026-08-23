import {services} from "../utils/option";
import {method, urls} from "../utils/constant";
import {claudeMsgTemplate} from "../utils/template";
import {config} from "@/entrypoints/utils/config";
import {appendOptionalHeader} from './auth';
import {createHttpStatusError, readJsonResponse} from '@/entrypoints/utils/httpError';

async function claude(message: any) {
    const service = message.serviceOverride || services.claude;
    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    appendOptionalHeader(headers, 'x-api-key', config.token[service]);
    headers.append('anthropic-version', '2023-06-01');
    headers.append('anthropic-dangerous-direct-browser-access', 'true');

    const url = config.proxy[service] || urls[services.claude];

    try {
        const resp = await fetch(url, {
            method: method.POST,
            headers,
            body: claudeMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage)
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
