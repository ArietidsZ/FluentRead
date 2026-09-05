/**
 * @file src/app/background/harnessRuntime.ts
 * 文件职责：把阅读卡后台处理器组装到扩展配置、Harness 服务和浏览器标签页生命周期。
 * 主要内容：注入发送者资格与配置就绪，配置停用、网站禁用及标签导航时取消请求，向主消息路由返回一个静态 handler。
 * 模块边界：这是应用组合根，不实现选区、消息校验、会话或模型协议；对应规则和异步所有权由 reading-assistant/background 及 services/harness 验证。
 */
import browser from 'webextension-polyfill';
import {config, configReady, subscribeConfig} from '@/src/services/config/store';
import {createReadingAssistantHandler} from '@/src/features/reading-assistant/background';
import {createHarnessRuntime} from '@/src/services/harness/runtime';
import {modelUsageRepository} from '@/src/platform/storage/modelUsageRepository';
import {isExtensionDisabledOnSite} from '@/src/core/site-rules/domain';
import type {BackgroundMessageHandler} from './messageRouter';
import type {ReadingSender} from '@/src/features/reading-assistant/background';

export function installHarnessBackgroundRuntime(): BackgroundMessageHandler<{sender?: ReadingSender}> {
    const runtime = createHarnessRuntime(() => config, () => {
        const generation = modelUsageRepository.captureGeneration();
        return event => { void modelUsageRepository.recordMany([event], generation).catch(() => undefined); };
    });
    const handler = createReadingAssistantHandler({
        extensionId: browser.runtime.id,
        ready: configReady,
        eligibility: sender => {
            if (!config.on || !config.harness.enabled) return '阅读理解已停用';
            if (isExtensionDisabledOnSite(sender.url || '', config.disabledExtensionDomains)
                || isExtensionDisabledOnSite(sender.tab?.url || '', config.disabledExtensionDomains)) return '当前网站已禁用扩展';
            return undefined;
        },
        run: (request, signal) => runtime.run(request, signal),
    });
    let preferencesKey = JSON.stringify(config.harness);
    subscribeConfig(next => {
        const nextKey = JSON.stringify(next.harness);
        if (nextKey !== preferencesKey) handler.cancelAll();
        preferencesKey = nextKey;
        handler.cancelDisallowed();
    });
    browser.tabs.onRemoved.addListener(tabId => handler.cancelTab(tabId));
    browser.tabs.onUpdated.addListener((tabId, change) => {
        if (change.status === 'loading' || change.url) handler.cancelTab(tabId);
    });
    return {type: 'fluentReadHarness', handle: (message, context) => handler.handle(message, context.sender ?? {})};
}
