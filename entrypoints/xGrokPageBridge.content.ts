/**
 * @file entrypoints/xGrokPageBridge.content.ts
 * 文件职责：在 X/Twitter 页面 MAIN world 的 document_start 预装默认未激活的 Grok 时间线请求桥。
 * 主要内容：仅匹配 X/Twitter 主域及子域，调用 startXGrokPageBridgeApp，并关闭 WXT 全局包装。
 * 模块边界：入口本身不读取配置；后台动态激活器和 isolated content 事件共同决定桥是否改写请求。
 */

import {startXGrokPageBridgeApp} from '@/src/app/content/xGrokPageBridge';

export default defineContentScript({
    matches: [
        '*://x.com/*',
        '*://*.x.com/*',
        '*://twitter.com/*',
        '*://*.twitter.com/*',
    ],
    runAt: 'document_start',
    world: 'MAIN',
    globalName: false,
    main: startXGrokPageBridgeApp,
});
