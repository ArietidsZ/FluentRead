import {commonMsgTemplate} from "../utils/template";
import {method} from "../utils/constant";
import {services} from "@/entrypoints/utils/option";
import {config} from "@/entrypoints/utils/config";
import {contentPostHandler} from "@/entrypoints/utils/check";
import {appendOptionalBearer} from './auth';
import {createHttpStatusError, readJsonResponse} from '@/entrypoints/utils/httpError';

async function custom(message: any) {
    const service = message.serviceOverride || services.custom;
    const url = config.proxy[service] || config.custom;

    if (!url?.trim()) {
        throw new Error('自定义接口地址未配置');
    }

    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    appendOptionalBearer(headers, config.token[service]);

    const resp = await fetch(url, {
        method: method.POST,
        headers: headers,
        body: commonMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage)
    });

    if (resp.ok) {
        const result = await readJsonResponse<any>(resp, '自定义接口返回的不是有效 JSON');
        return  contentPostHandler(result.choices[0].message.content);
    } else {
        throw createHttpStatusError(resp, '翻译失败');
    }
}

export default custom;
