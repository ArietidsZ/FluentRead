import {translateWithOpenAICompatibleAiSdk} from '@/entrypoints/service/ai-sdk/openai-compatible';

async function common(message: any) {
    return translateWithOpenAICompatibleAiSdk(message);
}

export default common;
