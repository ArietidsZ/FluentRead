import {translateWithOpenAICompatibleAiSdk} from '@/entrypoints/service/ai-sdk/openai-compatible';

async function newapi(message: any) {
    return translateWithOpenAICompatibleAiSdk(message);
}

export default newapi;
