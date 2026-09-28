type ShadowRootUiOptions<T> = {
    name: string;
    position?: string;
    alignment?: string;
    zIndex?: number;
    mode?: ShadowRootMode;
    inheritStyles?: boolean;
    isolateEvents?: string[];
    css?: string;
    viewport?: boolean;
    scopeRoot?: boolean;
    onMount(container: HTMLElement): T;
    onRemove?(mounted?: T): void;
};

export interface ShadowRootContentScriptUi<T> {
    shadowHost: HTMLElement;
    shadow: ShadowRoot;
    uiContainer: HTMLElement;
    mounted?: T;
    mount(): void;
    remove(): void;
}

/** 在 userscript 启动阶段恢复构建时 gzip 的共享样式，保持完整页面样式不占用上传体积。 */
export async function prepareUserscriptCss(): Promise<void> {
    if (globalThis.__fluentReadUserscriptCss || !globalThis.__fluentReadUserscriptCssCompressed) return;

    const encoded = globalThis.__fluentReadUserscriptCssCompressed;
    const binary = atob(encoded);
    const compressed = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        compressed[index] = binary.charCodeAt(index);
    }
    if (typeof DecompressionStream === 'function') {
        const decompressed = new Blob([compressed])
            .stream()
            .pipeThrough(new DecompressionStream('gzip'));
        globalThis.__fluentReadUserscriptCss = await new Response(decompressed).text();
        return;
    }

    // Safari 14/15 and older embedded WebViews do not provide
    // DecompressionStream. pako is an external @require fallback so the full
    // settings stylesheet remains compressed in the Greasy Fork upload.
    const gzip = (globalThis as typeof globalThis & {
        pako?: {ungzip(data: Uint8Array, options?: {to?: string}): string | Uint8Array};
    }).pako;
    if (!gzip || typeof gzip.ungzip !== 'function') {
        throw new Error('当前浏览器缺少 CSS gzip 解压能力，请更新浏览器或重新保存 userscript 的 @require 依赖');
    }
    const text = gzip.ungzip(compressed, {to: 'string'});
    globalThis.__fluentReadUserscriptCss = typeof text === 'string'
        ? text
        : new TextDecoder().decode(text);
}

function installStyles(shadow: ShadowRoot, localCss = '', scopeRoot = false): void {
    // 构建时汇总的全局 CSS 与当前组件 CSS 只写入 ShadowRoot，避免污染宿主网页样式。
    const css = [globalThis.__fluentReadUserscriptCss || '', localCss].filter(Boolean).join('\n');
    if (!css) return;
    const style = document.createElement('style');
    style.setAttribute('data-fluent-read-userscript-styles', 'true');
    // Options 的共享样式以 :root / :root.dark 为页面根选择器；在 ShadowRoot 中需要
    // 映射到 host，才能保留同一套皮肤变量和暗色选择器，同时不触碰宿主 document。
    style.textContent = scopeRoot
        ? css.replace(/:root((?:(?:\.[\w-]+)|(?:\[[^\]]+\]))*)/gu, (_match, suffix: string) => (
            suffix ? `:host(${suffix})` : ':host'
        ))
        : css;
    shadow.appendChild(style);
}

/** 为单页 userscript runtime 提供兼容 WXT 契约的最小 Shadow UI 宿主。 */
export async function createShadowRootUi<T>(
    _ctx: unknown,
    options: ShadowRootUiOptions<T>,
): Promise<ShadowRootContentScriptUi<T>> {
    const shadowHost = document.createElement('div');
    shadowHost.setAttribute('data-fluent-read-userscript-host', options.name);
    // 用零尺寸固定宿主隔离网页布局；实际浮层由 ShadowRoot 子节点定位并接收事件。
    shadowHost.style.cssText = [
        'all: initial !important',
        'display: block !important',
        'position: fixed !important',
        'left: 0 !important',
        'top: 0 !important',
        options.viewport ? 'width: 100vw !important' : 'width: 0 !important',
        options.viewport ? 'height: 100vh !important' : 'height: 0 !important',
        options.viewport ? 'overflow: hidden !important' : 'overflow: visible !important',
        'pointer-events: auto !important',
        `z-index: ${options.zIndex ?? 2_147_483_647} !important`,
    ].join(';');

    const shadow = shadowHost.attachShadow({mode: options.mode || 'open'});
    installStyles(shadow, options.css, options.scopeRoot);
    const container = document.createElement('div');
    container.setAttribute('data-fluent-read-userscript-container', options.name);
    container.style.cssText = options.viewport
        ? 'all: initial; width: 100%; height: 100%; overflow: hidden; pointer-events: auto;'
        : 'all: initial; width: 0; height: 0; overflow: visible; pointer-events: auto;';
    shadow.appendChild(container);

    // 在 ShadowRoot 冒泡阶段阻断明确要求隔离的事件：先让内部控件（例如
    // Element Plus select）完成自己的键盘处理，再阻止事件穿过 Shadow DOM
    // 边界影响宿主页面。若在捕获阶段拦截，事件会在到达内部控件前就被截断。
    for (const eventName of options.isolateEvents || []) {
        shadow.addEventListener(eventName, (event) => event.stopPropagation());
    }

    let isMounted = false;
    const ui: ShadowRootContentScriptUi<T> = {
        shadowHost,
        shadow,
        uiContainer: container,
        mount() {
            if (isMounted) return;
            isMounted = true;
            (document.documentElement || document.body).appendChild(shadowHost);
            ui.mounted = options.onMount(container);
        },
        remove() {
            if (!isMounted) return;
            isMounted = false;
            options.onRemove?.(ui.mounted);
            ui.mounted = undefined;
            shadowHost.remove();
        },
    };
    return ui;
}
