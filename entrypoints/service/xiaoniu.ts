import {method, urls} from "../utils/constant";
import {services} from "../utils/option";
import {config} from "@/entrypoints/utils/config";
import {getTranslationLanguages} from "@/entrypoints/utils/translationLanguage";
import {createHttpStatusError, readJsonResponse} from '@/entrypoints/utils/httpError';

async function xiaoniu(message: any) {
    const service = message.serviceOverride || config.service;
    // 根据需要调整目标语言
    const {targetLanguage} = getTranslationLanguages(message);
    let targetLang = targetLanguage === 'zh-Hans' ? 'zh' : targetLanguage;

    // 判断是否使用代理
    let url: string = config.proxy[service] ? config.proxy[service] : urls[services.xiaoniu]

    const resp = await fetch(url, {
        method: method.POST,
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: `from=auto&to=${targetLang}&apikey=${config.token[service]}&src_text=${encodeURIComponent(message.origin)}`
    });

    if (resp.ok) {
        const result = await readJsonResponse<any>(resp, '小牛翻译返回的不是有效 JSON');
        return result.tgt_text
    } else {
        throw createHttpStatusError(resp, '翻译失败');
    }
}

export default xiaoniu;
