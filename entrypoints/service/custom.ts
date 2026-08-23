import {translateWithOpenAICompatibleAiSdk} from '@/entrypoints/service/ai-sdk/openai-compatible';

async function custom(message: any) {
    return translateWithOpenAICompatibleAiSdk(message);
}

export default custom;
