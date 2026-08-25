/**
 * @file src/providers/translation/free-translation.ts
 *
 * 文件职责：编排无需用户密钥的微软、DeepLX 与谷歌翻译作为有序回退链，提高免费翻译路径的可用性。
 * 主要内容：声明 FREE_TRANSLATION_ORDER，按请求级语言依次调用 translateMicrosoftTexts、translateDeepLXText、translateGoogleText，记录失败并在全部不可用时汇总错误。 可核对的公开符号包括 FREE_TRANSLATION_ORDER、translateFreeText、default:freeTranslation。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {translateMicrosoftTexts} from "./microsoft";
import {translateDeepLXText} from "./deeplx";
import {translateGoogleText} from "./google";
import {services} from "@/src/core/config/catalog";
import {getTranslationLanguages, type TranslationLanguageOverride} from '@/src/services/translation/languages';
import type {TranslationProviderRequestContext} from '@/src/services/translation/requestSnapshot';

type FreeTranslationRequest = TranslationLanguageOverride & TranslationProviderRequestContext;

type FreeTranslationProvider = {
    label: string;
    translate: (text: string, languages: FreeTranslationRequest) => Promise<string>;
};

export const FREE_TRANSLATION_ORDER = [
    "微软翻译",
    "DeepLX",
    "谷歌翻译",
] as const;

function requireTranslation(text: string, label: string): string {
    if (typeof text !== "string" || text.trim().length === 0) {
        throw new Error(`${label}未返回有效译文`);
    }
    return text;
}

const providers: FreeTranslationProvider[] = [
    {
        label: FREE_TRANSLATION_ORDER[0],
        translate: async (text, languages) => {
            const {sourceLanguage, targetLanguage} = getTranslationLanguages(languages);
            const translations = await translateMicrosoftTexts([text], sourceLanguage, targetLanguage);
            return requireTranslation(translations[0] || "", FREE_TRANSLATION_ORDER[0]);
        },
    },
    {
        label: FREE_TRANSLATION_ORDER[1],
        translate: (text, languages) => languages.sourceLanguage || languages.targetLanguage
            ? translateDeepLXText(text, services.deeplx, languages)
            : translateDeepLXText(text, services.deeplx),
    },
    {
        label: FREE_TRANSLATION_ORDER[2],
        translate: (text, languages) => {
            const {sourceLanguage, targetLanguage} = getTranslationLanguages(languages);
            return translateGoogleText(text, sourceLanguage, targetLanguage);
        },
    },
];

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function translateFreeText(text: string, languages: FreeTranslationRequest = {}): Promise<string> {
    if (typeof text !== "string") {
        throw new Error("免费翻译服务仅支持文本输入");
    }

    const failures: string[] = [];
    for (const provider of providers) {
        try {
            return requireTranslation(await provider.translate(text, languages), provider.label);
        } catch (error) {
            failures.push(`${provider.label}: ${getErrorMessage(error)}`);
        }
    }

    throw new Error(`免费翻译服务均不可用（${FREE_TRANSLATION_ORDER.join(" → ")}）：${failures.join("；")}`);
}

async function freeTranslation(message: {
    origin: string | string[];
    sourceLanguage?: string;
    targetLanguage?: string;
} & TranslationProviderRequestContext) {
    if (typeof message.origin === "string") {
        return translateFreeText(message.origin, message);
    }

    if (Array.isArray(message.origin)) {
        return Promise.all(message.origin.map(text => translateFreeText(text, message)));
    }

    throw new Error("免费翻译服务仅支持文本输入");
}

export default freeTranslation;
