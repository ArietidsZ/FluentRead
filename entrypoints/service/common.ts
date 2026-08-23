import {getMimoEndpoint, method, MINIMAX_ENDPOINTS, urls} from "../utils/constant";
import {commonMsgTemplate} from "../utils/template";
import {config} from "@/entrypoints/utils/config";
import {contentPostHandler} from "@/entrypoints/utils/check";
import { services } from "../utils/option";
import { appendOptionalBearer } from './auth';
import {formatServiceError} from '@/entrypoints/utils/serviceError';
import {createHttpStatusError, readJsonResponse} from '@/entrypoints/utils/httpError';

async function common(message: any) {
    try {
        const service = message.serviceOverride || config.service;

        const headers = new Headers({'Content-Type': 'application/json'});
        appendOptionalBearer(headers, config.token[service]);

        if(service === services.openrouter){
            headers.append('HTTP-Referer', 'https://fluent.thinkstu.com');
            headers.append('X-Title', 'FluentRead');
        }
                
        const url = config.proxy[service]
            || (service === services.minimax
                ? MINIMAX_ENDPOINTS[
                    config.minimaxBillingPlan === 'token-plan' ? 'token-plan' : 'payg'
                ][config.minimaxRegion === 'cn' ? 'cn' : 'global']
                : service === services.mimo
                    ? getMimoEndpoint(config.mimoBillingPlan, config.mimoRegion)
                : urls[service]);

        const resp = await fetch(url, {
            method: method.POST,
            headers,
            body: commonMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage)
        });

        if (!resp.ok) {
            throw new Error(formatServiceError(
                service,
                createHttpStatusError(resp, '翻译失败'),
            ));
        }

        const result = await readJsonResponse<any>(resp);
        return contentPostHandler(result.choices[0].message.content);
    } catch (error) {
        throw error;
    }
}

export default common;
