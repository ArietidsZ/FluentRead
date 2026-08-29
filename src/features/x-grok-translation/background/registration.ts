/**
 * @file src/features/x-grok-translation/background/registration.ts
 * 文件职责：把配置存储与 browser.scripting 连接到 X/Grok 动态 document_start 激活器的纯注册协调器。
 * 主要内容：等待配置就绪、订阅跨上下文变更、串行化注册操作，并在 API 缺失或浏览器拒绝时安全降级而不阻断后台启动。
 * 模块边界：适配器不执行页面脚本、不访问 X 页面或凭据；匹配计算和幂等收敛由 registrationCore 严格测试。
 */

import {config, configReady, subscribeConfig} from '@/src/services/config/store';
import {
    getXGrokPageBridgeMatches,
    reconcileXGrokPageBridgeRegistration,
    type XGrokBridgeRegistrationPort,
} from './registrationCore';

/** 后台 worker 每次启动都与持久动态注册对账，随后跟随配置变化串行更新。 */
export function installXGrokPageBridgeRegistration(): void {
    const scripting = (browser as unknown as {scripting?: XGrokBridgeRegistrationPort}).scripting;
    if (!scripting) return;

    let queue = Promise.resolve();
    const reconcile = (nextConfig: typeof config) => {
        const matches = getXGrokPageBridgeMatches(nextConfig);
        queue = queue
            .then(() => reconcileXGrokPageBridgeRegistration(scripting, matches))
            .catch((error) => {
                console.error('[FluentRead] X 原生翻译首屏激活器注册失败', error);
            });
    };

    void configReady.then(() => {
        reconcile(config);
        subscribeConfig(reconcile);
    }).catch((error) => {
        console.error('[FluentRead] X 原生翻译首屏激活器等待配置失败', error);
    });
}
