/**
 * @file src/platform/http/runtime.ts
 *
 * 文件职责：抽象运行时 fetch 边界，使 provider 请求在扩展、userscript 和测试环境中使用可替换的网络实现。
 * 主要内容：定义 RuntimeFetch，setRuntimeFetch 安装或恢复覆盖实现，runtimeFetch 始终通过当前端口发起请求并默认委托 globalThis.fetch。 可核对的公开符号包括 RuntimeFetch、setRuntimeFetch、runtimeFetch。
 * 模块边界：本文件属于 platform 基础设施边界，只封装浏览器、网络、存储上下文或 Shadow DOM 机制；不决定翻译业务策略，不直接实现 feature，业务层通过类型化端口消费这里的能力。
 */

/**
 * 可按运行环境替换的 HTTP transport。
 *
 * 浏览器扩展默认使用原生 Fetch；userscript 等运行环境可以在 provider 请求前
 * 注入兼容 transport，从而复用同一套 provider adapter，而不改变扩展网络边界。
 */
export type RuntimeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const nativeFetch: RuntimeFetch = (input, init) => globalThis.fetch(input, init);
let activeFetch: RuntimeFetch = nativeFetch;

export function setRuntimeFetch(nextFetch?: RuntimeFetch): void {
    activeFetch = nextFetch || nativeFetch;
}

export function runtimeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return activeFetch(input, init);
}
