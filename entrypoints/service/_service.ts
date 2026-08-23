import {services} from "../utils/option";
import {AI_SDK_SERVICE_IDS} from './ai-sdk/endpoints';
import microsoft from "./microsoft";
import freeTranslation from "./free-translation";
import deepl from "./deepl";
import deeplx from "./deeplx";
import {translateWithOpenAICompatibleAiSdk} from './ai-sdk/openai-compatible';
import tongyi from "./tongyi";
import zhipu from "./zhipu";
import gemini from "./gemini";
import google from "./google";
import xiaoniu from "./xiaoniu";
import youdao from "./youdao";
import tencent from "./tencent";
import claude from "./claude";
import coze from "@/entrypoints/service/coze";
import deepseek from "./deepseek";
import azureOpenai from "./azure-openai";
import chromeTranslator from "./chrome-translator";
import hunyuanTranslation from "./hunyuan-translation";

type ServiceFunction = (message: any) => Promise<any>;
type ServiceMap = {[key: string]: ServiceFunction;};

const legacyServices: ServiceMap = {
    // 机器翻译
    [services.microsoft]: microsoft,
    [services.freeTranslation]: freeTranslation,
    [services.deepL]: deepl,
    [services.deeplx]: deeplx,
    [services.google]: google,
    [services.xiaoniu]: xiaoniu,
    [services.youdao]: youdao,
    [services.tencent]: tencent,
    [services.chromeTranslator]: chromeTranslator,

    // 大模型翻译
    [services.tongyi]: tongyi,
    [services.zhipu]: zhipu,
    [services.gemini]: gemini,
    [services.claude]: claude,
    [services.cozecom]: coze,
    [services.cozecn]: coze,
    [services.deepseek]: deepseek,
    [services.huanYuanTranslation]: hunyuanTranslation,
};

const aiSdkServices: ServiceMap = Object.fromEntries(
    AI_SDK_SERVICE_IDS.map((service) => [service, translateWithOpenAICompatibleAiSdk]),
);

export const _service: ServiceMap = {
    ...legacyServices,
    ...aiSdkServices,
    // Azure keeps its endpoint/key validation before entering the shared transport.
    [services.azureOpenai]: azureOpenai,
};
