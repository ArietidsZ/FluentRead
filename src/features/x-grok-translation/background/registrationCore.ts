/**
 * @file src/features/x-grok-translation/background/registrationCore.ts
 * 文件职责：计算并协调 X/Grok document_start 激活器的动态内容脚本注册，使已开启配置在页面首个时间线请求前可用。
 * 主要内容：按总开关、功能开关和禁用站点生成精确 X/Twitter match 列表，对 scripting 已有注册执行幂等保留、替换或注销。
 * 模块边界：核心只消费可注入的 scripting 端口，不读取真实存储、不访问标签页，也不持有 X 登录信息；MAIN-world 脚本只发布无数据的激活事件。
 */

import {isExtensionDisabledOnSite} from '@/src/core/site-rules/domain';

export const X_GROK_PAGE_BRIDGE_REGISTRATION_ID = 'fluentread-x-grok-page-bridge-activator';
export const X_GROK_PAGE_BRIDGE_ACTIVATOR_PATH = 'content-scripts/xGrokPageBridgeActivator.js';

const X_MATCHES = ['*://x.com/*', '*://*.x.com/*'] as const;
const TWITTER_MATCHES = ['*://twitter.com/*', '*://*.twitter.com/*'] as const;

export interface XGrokBridgeRegistrationConfig {
    readonly on: boolean;
    readonly xGrokAutoTranslateEnabled: boolean;
    readonly disabledExtensionDomains: readonly string[];
}

export interface XGrokRegisteredContentScript {
    readonly id: string;
    readonly matches?: readonly string[];
}

export interface XGrokBridgeRegistrationPort {
    getRegisteredContentScripts(filter: {ids: string[]}): Promise<readonly XGrokRegisteredContentScript[]>;
    registerContentScripts(scripts: Array<{
        id: string;
        js: string[];
        matches: string[];
        persistAcrossSessions: boolean;
        runAt: 'document_start';
        world: 'MAIN';
    }>): Promise<void>;
    unregisterContentScripts(filter: {ids: string[]}): Promise<void>;
}

/** 只为未被站点规则禁用的 X/Twitter 域注册激活器。 */
export function getXGrokPageBridgeMatches(config: XGrokBridgeRegistrationConfig): string[] {
    if (config.on !== true || config.xGrokAutoTranslateEnabled !== true) return [];
    const matches: string[] = [];
    if (!isExtensionDisabledOnSite('https://x.com/', config.disabledExtensionDomains)) matches.push(...X_MATCHES);
    if (!isExtensionDisabledOnSite('https://twitter.com/', config.disabledExtensionDomains)) {
        matches.push(...TWITTER_MATCHES);
    }
    return matches;
}

function equalMatches(first: readonly string[] | undefined, second: readonly string[]): boolean {
    return Boolean(first)
        && first!.length === second.length
        && first!.every((value) => second.includes(value))
        && second.every((value) => first!.includes(value));
}

/** 将一个动态注册收敛到期望域集合；不存在、不变、缩域和关闭均保持幂等。 */
export async function reconcileXGrokPageBridgeRegistration(
    port: XGrokBridgeRegistrationPort,
    matches: readonly string[],
): Promise<void> {
    const registered = await port.getRegisteredContentScripts({ids: [X_GROK_PAGE_BRIDGE_REGISTRATION_ID]});
    const current = registered.find(({id}) => id === X_GROK_PAGE_BRIDGE_REGISTRATION_ID);
    if (matches.length === 0) {
        if (current) await port.unregisterContentScripts({ids: [X_GROK_PAGE_BRIDGE_REGISTRATION_ID]});
        return;
    }
    if (current && equalMatches(current.matches, matches)) return;
    if (current) await port.unregisterContentScripts({ids: [X_GROK_PAGE_BRIDGE_REGISTRATION_ID]});
    await port.registerContentScripts([{
        id: X_GROK_PAGE_BRIDGE_REGISTRATION_ID,
        js: [X_GROK_PAGE_BRIDGE_ACTIVATOR_PATH],
        matches: [...matches],
        persistAcrossSessions: true,
        runAt: 'document_start',
        world: 'MAIN',
    }]);
}
