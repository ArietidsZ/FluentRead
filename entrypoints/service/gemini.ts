import {method} from "../utils/constant";
import {geminiMsgTemplate} from "../utils/template";
import {customModelString} from "../utils/option";
import {config} from "@/entrypoints/utils/config";
import {appendOptionalHeader} from './auth';
import {createHttpStatusError, readJsonResponse} from '@/entrypoints/utils/httpError';


async function gemini(message: any) {
    const service = message.serviceOverride || config.service;

    const model = config.model[service] === customModelString ? config.customModel[service] : config.model[service];
    const proxyUrl = config.proxy[service]?.trim();
    const usesOfficialEndpoint = !proxyUrl;
    const url = proxyUrl
        || `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const headers = new Headers({'Content-Type': 'application/json'});
    // Google documents x-goog-api-key for direct Gemini REST requests. Never
    // forward the Google credential to a user-configured proxy.
    if (usesOfficialEndpoint) {
        appendOptionalHeader(headers, 'x-goog-api-key', config.token[service]);
    }

    const resp = await runtimeFetch(url, {
        method: method.POST,
        headers,
        body: geminiMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage),
    });
    if (resp.ok) {
        const result = await readJsonResponse<any>(resp, 'Gemini 返回的不是有效 JSON');
        return result.candidates[0].content.parts[0].text;
    } else {
        throw createHttpStatusError(resp, '翻译失败');
    }
}

export default gemini;
