import {config} from "@/entrypoints/utils/config";
import {isApiKeyRequired} from "@/entrypoints/utils/configValidation";
import {translateWithOpenAICompatibleAiSdk} from '@/entrypoints/service/ai-sdk/openai-compatible';

async function azureOpenai(message: any) {
    const service = message.serviceOverride || config.service;
    const apiKey = config.token[service];
    if ((!apiKey || apiKey.trim() === '') && isApiKeyRequired(service, config)) {
        throw new Error('Azure OpenAI API Key 未配置，请在设置中输入有效的 API Key');
    }

    const endpoint = config.azureOpenaiEndpoint;
    if (!endpoint || endpoint.trim() === '') {
        throw new Error('Azure OpenAI 端点地址未配置，请在设置中输入完整的端点地址');
    }

    if (!endpoint.includes('openai.azure.com') || !endpoint.includes('/chat/completions')) {
        throw new Error('Azure OpenAI 端点地址格式不正确，请确保包含正确的域名和路径');
    }

    return translateWithOpenAICompatibleAiSdk({...message, serviceOverride: service});
}

export default azureOpenai;
