/**
 * @file entrypoints/xGrokPageBridgeActivator.content.ts
 * 文件职责：定义仅在用户启用 X 原生翻译时由后台动态注册的 MAIN-world document_start 激活器。
 * 主要内容：使用 runtime registration 产出独立脚本，并在匹配的 X/Twitter 页面首个站点脚本前发布桥激活状态。
 * 模块边界：入口不读取存储、不修改网络方法；后台配置协调器负责注册范围，常驻页面桥负责实际改写与恢复。
 */

import {startXGrokPageBridgeActivatorApp} from '@/src/app/content/xGrokPageBridge';

export default defineContentScript({
    matches: [
        '*://x.com/*',
        '*://*.x.com/*',
        '*://twitter.com/*',
        '*://*.twitter.com/*',
    ],
    runAt: 'document_start',
    world: 'MAIN',
    registration: 'runtime',
    globalName: false,
    main: startXGrokPageBridgeActivatorApp,
});
