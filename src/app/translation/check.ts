/**
 * @file src/app/translation/check.ts
 * 文件职责：在内容侧翻译调用前执行最小配置可用性检查，并对模型输出做统一后处理，向页面用户反馈可操作错误。
 * 主要内容：根据服务类型验证自定义模型和必需模型选择，使用 page-notice 发送中文提示；contentPostHandler 调用 stripTranslationReasoning 去除推理标记后返回净化文本。
 * 模块边界：本文件不验证受保护凭据、不发起请求，也不决定 provider endpoint；可信凭据检查在后台或 extension page，网络与重试由 translation/client 负责。
 */
import {customModelString, services, servicesType} from '@/src/core/config/catalog';
import {stripTranslationReasoning} from '@/src/core/translation/prompts';
import {config} from '@/src/services/config/store';
import {sendErrorMessage} from '@/src/features/page-notice/public';

// Check configuration before translation
export function checkConfig(): boolean {
    // 1. Check if the plugin is enabled
    if (!config.on) return false;

    // Credentials live in extension session storage and are intentionally not
    // exposed to content scripts. The background validates them at the request
    // boundary before calling a provider.

    // Check if a model is selected for AI services (except specific services like Coze)
    if (servicesType.isAI(config.service) && ![services.cozecn, services.cozecom].includes(config.service)) {
        const model = config.model[config.service];
        const customModel = config.customModel[config.service];
        if (!model || (model === customModelString && !customModel)) {
            sendErrorMessage("模型尚未配置，请前往设置页配置");
            return false;
        }
    }

    // Some translation services require "bilingual mode" to be enabled
    if (config.display === 0 && config.service === services.google) {
        sendErrorMessage("「谷歌翻译」仅支持双语模式，请切换翻译服务");
        return false;
    }

    return true;
}

export function contentPostHandler(text: string) {
    return stripTranslationReasoning(text);
}
