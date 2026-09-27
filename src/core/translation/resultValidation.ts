/**
 * @file src/core/translation/resultValidation.ts
 * 文件职责：识别翻译服务误返原文或明显错语种的响应，避免将其当成成功译文。
 * 主要内容：比较规范化原文与结果，用可信语言识别判断外语正文，补足中文目标下短标签列表和整段日文结果的保守判定。
 * 模块边界：仅做保守的纯文本判定；不读取配置或缓存、不请求服务，也不改写原文与译文。
 */
import {getChineseScript} from '@/src/core/language/chinese';
import {isLanguageCodeMatch} from '@/src/core/language/codes';
import {identifyTextLanguage} from '@/src/core/language/identify';

function comparable(value: string): string {
    return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

/** 标签列表缺少功能词，统计语言识别通常只能给出不可信的猜测。 */
function isLatinKeywordList(value: string): boolean {
    const tags = value.split(',');
    if (tags.length < 6) return false;
    let readableTags = 0;
    let words = 0;
    for (const tag of tags) {
        const trimmed = tag.trim();
        if (!/^[a-z][a-z_ ]{2,}$/u.test(trimmed)) continue;
        const parts = trimmed.match(/[a-z]{3,}/gu) ?? [];
        if (parts.length === 0) continue;
        readableTags += 1;
        words += parts.length;
    }
    return readableTags >= 6 && words >= 6;
}

/** 只拒绝可信外语正文或长英文标签列表的原文回显；短词、代码和名称允许原样返回。 */
export function isLikelyUntranslatedResponse(origin: string, result: string, targetLanguage: string): boolean {
    if (!origin.trim() || comparable(origin) !== comparable(result)) return false;
    const identification = identifyTextLanguage(origin);
    if (identification.status === 'identified') {
        return !identification.languages.some(language => isLanguageCodeMatch(language, targetLanguage));
    }
    return Boolean(getChineseScript(targetLanguage)) && isLatinKeywordList(origin);
}

/** 假名与汉字共同构成日文正文；少量日语名称、短引用和不确定的混合段落照常展示。 */
export function isClearlyWrongLanguageResponse(origin: string, result: string, targetLanguage: string): boolean {
    if (!origin.trim() || !result.trim() || !getChineseScript(targetLanguage)) return false;
    const kanaCount = (result.match(/[\p{Script=Hiragana}\p{Script=Katakana}ーｰ]/gu) ?? []).length;
    if (kanaCount < 16) return false;
    const hanCount = (result.match(/\p{Script=Han}/gu) ?? []).length;
    if (kanaCount * 2 < hanCount) return false;
    const identification = identifyTextLanguage(result);
    return identification.status === 'identified' && identification.languages.includes('ja');
}
