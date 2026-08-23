import {method, urls} from "../utils/constant";
import {services} from "../utils/option";
import {config} from "@/entrypoints/utils/config";
import {getTranslationLanguages} from "@/entrypoints/utils/translationLanguage";
import {createHttpStatusError, readJsonResponse} from '@/entrypoints/utils/httpError';

async function deepl(message: any) {
    const service = message.serviceOverride || config.service;
    // deepl 不支持 zh-Hans，需要转换为 zh
    const {targetLanguage} = getTranslationLanguages(message);
    let targetLang = targetLanguage === 'zh-Hans' ? 'zh' : targetLanguage;

    // 判断是否使用代理
    let url: string = config.proxy[service] ? config.proxy[service] : urls[services.deepL]

    const resp = await fetch(url, {
        method: method.POST,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'DeepL-Auth-Key ' + config.token[service]
        },
        body: JSON.stringify({
            text: [message.origin],
            target_lang: targetLang,
            tag_handling: 'html',
            context: message.context,  // 添加上下文辅助信息
            preserve_formatting: true
        })
    });

    if (resp.ok) {
        const result = await readJsonResponse<any>(resp, 'DeepL 返回的不是有效 JSON');
        return result.translations[0].text
    } else {
        throw createHttpStatusError(resp, '翻译失败');
    }
}

export default deepl;
