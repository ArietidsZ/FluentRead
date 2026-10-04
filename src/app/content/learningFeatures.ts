/**
 * @file src/app/content/learningFeatures.ts
 * 文件职责：组装页面内句子听读与写作入口的静态功能定义。
 * 主要内容：将当前配置、浏览器能力和 WXT context 接入两项功能的启用判断与挂载所有权。
 * 模块边界：只组织 feature 公开生命周期，不处理句子定位、编辑器或学习数据。
 */
import type {ContentScriptContext} from 'wxt/utils/content-script-context';
import type {Config} from '@/src/core/config/model';
import type {BrowserCapabilities} from '@/src/platform/browser/capabilities';
import {isWritingPage} from '@/src/core/config/writing';
import {mountWritingAssistant, unmountWritingAssistant, isWritingAssistantMounted} from '@/src/features/writing-assistant/public';
import {mountSentenceActions, unmountSentenceActions, isSentenceActionsMounted} from '@/src/features/vocabulary/content/public';
import type {ContentFeatureDefinition} from './featureRegistry';

export function createLearningContentFeatures(ctx: ContentScriptContext, config: Config, capabilities: BrowserCapabilities): ContentFeatureDefinition[] {
    return [
        {id: 'sentence-actions', isEnabled: () => capabilities.browser !== 'userscript' && config.on && config.bilingualSentenceHighlightEnabled === true,
            mount: () => mountSentenceActions(ctx), unmount: unmountSentenceActions, isMounted: isSentenceActionsMounted},
        {id: 'writing-assistant', isEnabled: () => capabilities.browser !== 'userscript' && config.on && config.writing.enabled && isWritingPage(window.location.href),
            mount: () => mountWritingAssistant(ctx), unmount: unmountWritingAssistant, isMounted: isWritingAssistantMounted},
    ];
}
