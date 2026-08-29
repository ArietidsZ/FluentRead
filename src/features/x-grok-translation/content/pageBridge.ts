/**
 * @file src/features/x-grok-translation/content/pageBridge.ts
 * 文件职责：把 X/Grok 时间线请求桥核心连接到页面 MAIN world 的 Fetch、XMLHttpRequest、URL、Request 与生命周期事件。
 * 主要内容：安装可启停的页面桥，并提供动态 document_start 激活器，使已开启配置在 X 首个 Timeline 请求前生效。
 * 模块边界：本文件运行在页面世界且无扩展 API 权限；配置权威仍在后台动态注册与 isolated content 生命周期中。
 */

import {
    installXGrokPageBridgeLifecycleCore,
    X_GROK_PAGE_BRIDGE_ACTIVATION_KEY,
    X_GROK_PAGE_BRIDGE_ENABLE_EVENT,
    type XGrokFetchPort,
    type XGrokXhrOpenPort,
} from './pageBridgeCore';

/** 安装常驻但默认未激活的 X 页面桥生命周期。 */
export function installXGrokPageBridge(): () => void {
    const pageWindow = window as typeof window & Record<string, unknown>;
    return installXGrokPageBridgeLifecycleCore({
        stateHost: pageWindow,
        fetch: {
            get: () => window.fetch as unknown as XGrokFetchPort,
            set: (value) => { window.fetch = value as typeof window.fetch; },
        },
        xhrOpen: {
            get: () => XMLHttpRequest.prototype.open as unknown as XGrokXhrOpenPort,
            set: (value) => { XMLHttpRequest.prototype.open = value as typeof XMLHttpRequest.prototype.open; },
        },
        pageEvents: window,
        documentEvents: document,
        getHref: () => location.href,
        replaceFetchInputUrl: (input, nextUrl) => {
            if (typeof input === 'string') return nextUrl;
            if (input instanceof URL) return new URL(nextUrl);
            if (typeof Request !== 'undefined' && input instanceof Request) return new Request(nextUrl, input);
            return input;
        },
    });
}

/** 动态注册脚本只发布激活意图；常驻桥无论先后执行都能收到同一 document_start 状态。 */
export function activateXGrokPageBridge(): void {
    const pageWindow = window as typeof window & Record<string, unknown>;
    pageWindow[X_GROK_PAGE_BRIDGE_ACTIVATION_KEY] = true;
    document.dispatchEvent(new CustomEvent(X_GROK_PAGE_BRIDGE_ENABLE_EVENT));
}
