/**
 * @file src/features/x-grok-translation/content/pageBridgeCore.ts
 * 文件职责：在 X 页面 MAIN world 中以可卸载方式改写返回帖子内容的 GraphQL 请求的单一 Grok 原生译文 feature flag。
 * 主要内容：精确识别 X 时间线、资料、媒体、收藏和帖子详情 GET，解析 features JSON、仅把 responsive_web_grok_show_grok_translated_post 的 false 改为 true，并管理 Fetch/XHR 包装与启停生命周期。
 * 模块边界：桥不读取请求头、Cookie、变量或响应，不调用 FluentRead provider、不渲染译文，也不点击通用 Grok 操作；X 仍拥有请求、翻译结果和界面渲染。
 */

export const X_GROK_TRANSLATED_POST_FEATURE = 'responsive_web_grok_show_grok_translated_post';
export const X_GROK_PAGE_BRIDGE_ENABLE_EVENT = 'fluentread-x-grok-page-bridge-enable';
export const X_GROK_PAGE_BRIDGE_DISPOSE_EVENT = 'fluentread-x-grok-page-bridge-dispose';
export const X_GROK_PAGE_BRIDGE_STATE_KEY = '__fluentReadXGrokPageBridgeState__';
export const X_GROK_PAGE_BRIDGE_LIFECYCLE_STATE_KEY = '__fluentReadXGrokPageBridgeLifecycleState__';
export const X_GROK_PAGE_BRIDGE_ACTIVATION_KEY = '__fluentReadXGrokPageBridgeActivated__';

export interface XGrokBridgeMethodSlot<T extends (...args: never[]) => unknown> {
    get(): T;
    set(value: T): void;
}

export type XGrokFetchPort = (this: unknown, input: unknown, init?: unknown) => unknown;

export interface XGrokXhrPort {}

export type XGrokXhrOpenPort = (
    this: XGrokXhrPort,
    method: string,
    url: unknown,
    ...rest: unknown[]
) => unknown;

export interface XGrokBridgeEventTarget {
    addEventListener(type: string, listener: (event?: {persisted?: boolean}) => void): void;
    removeEventListener(type: string, listener: (event?: {persisted?: boolean}) => void): void;
}

export interface XGrokPageBridgeEnvironment {
    readonly stateHost: Record<string, unknown>;
    readonly fetch: XGrokBridgeMethodSlot<XGrokFetchPort>;
    readonly xhrOpen: XGrokBridgeMethodSlot<XGrokXhrOpenPort>;
    readonly pageEvents: XGrokBridgeEventTarget;
    readonly documentEvents: XGrokBridgeEventTarget;
    readonly getHref: () => string;
    readonly replaceFetchInputUrl: (input: unknown, nextUrl: string) => unknown;
}

interface XGrokPageBridgeState {
    readonly owner: symbol;
    readonly dispose: () => void;
}

interface XGrokPageBridgeLifecycleState {
    readonly owner: symbol;
    readonly dispose: () => void;
}

function isXHostname(hostname: string): boolean {
    const normalized = hostname.toLocaleLowerCase().replace(/\.$/u, '');
    return normalized === 'x.com'
        || normalized.endsWith('.x.com')
        || normalized === 'twitter.com'
        || normalized.endsWith('.twitter.com');
}

function getRequestUrl(input: unknown): string {
    if (typeof input === 'string') return input;
    if (!input || typeof input !== 'object') return '';
    const record = input as {href?: unknown; url?: unknown};
    if (typeof record.href === 'string') return record.href;
    return typeof record.url === 'string' ? record.url : '';
}

function getRequestMethod(input: unknown, init?: unknown): string {
    const initMethod = init && typeof init === 'object'
        ? (init as {method?: unknown}).method
        : undefined;
    if (typeof initMethod === 'string') return initMethod.toLocaleUpperCase();
    const inputMethod = input && typeof input === 'object'
        ? (input as {method?: unknown}).method
        : undefined;
    return typeof inputMethod === 'string' ? inputMethod.toLocaleUpperCase() : 'GET';
}

function isXPostGraphqlPath(pathname: string): boolean {
    const match = pathname.match(/^\/i\/api\/graphql\/[^/]+\/([^/]+)$/u);
    if (!match?.[1]) return false;
    try {
        return /(?:Timeline(?:V\d+)?|Tweets(?:AndReplies)?|UserMedia|Likes|Bookmarks|TweetDetail|TweetResultByRestId)$/u
            .test(decodeURIComponent(match[1]));
    } catch {
        return false;
    }
}

/** 为 X 返回帖子内容的 GraphQL GET 翻开原生 Grok 译文字段；不匹配时返回 null。 */
export function rewriteXGrokPostUrl(value: string, baseHref: string): string | null {
    try {
        const baseUrl = new URL(baseHref);
        const requestUrl = new URL(value, baseUrl);
        if (!/^https?:$/u.test(requestUrl.protocol)
            || !isXHostname(baseUrl.hostname)
            || !isXHostname(requestUrl.hostname)
            || !isXPostGraphqlPath(requestUrl.pathname)) return null;

        const serializedFeatures = requestUrl.searchParams.get('features');
        if (!serializedFeatures) return null;
        const parsed = JSON.parse(serializedFeatures) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        const features = parsed as Record<string, unknown>;
        if (features[X_GROK_TRANSLATED_POST_FEATURE] !== false) return null;

        features[X_GROK_TRANSLATED_POST_FEATURE] = true;
        requestUrl.searchParams.set('features', JSON.stringify(features));
        return requestUrl.href;
    } catch {
        return null;
    }
}

function installMethod<T extends (...args: never[]) => unknown>(
    slot: XGrokBridgeMethodSlot<T>,
    wrapper: T,
): boolean {
    try {
        slot.set(wrapper);
        return slot.get() === wrapper;
    } catch {
        return false;
    }
}

function restoreMethod<T extends (...args: never[]) => unknown>(
    slot: XGrokBridgeMethodSlot<T>,
    wrapper: T,
    original: T,
): void {
    try {
        if (slot.get() === wrapper) slot.set(original);
    } catch {
        // 宿主或其他扩展在运行期间锁定方法时，只停用闭包，不覆盖后来所有者。
    }
}

/** 安装一层精确、可恢复的 X 帖子请求包装。 */
export function installXGrokPageBridgeCore(environment: XGrokPageBridgeEnvironment): () => void {
    const previous = environment.stateHost[X_GROK_PAGE_BRIDGE_STATE_KEY] as XGrokPageBridgeState | undefined;
    previous?.dispose?.();

    const owner = Symbol('fluentread-x-grok-page-bridge');
    const originalFetch = environment.fetch.get();
    const originalOpen = environment.xhrOpen.get();
    let active = true;

    const fetchWrapper: XGrokFetchPort = function fetch(input, init) {
        let nextInput = input;
        if (active && getRequestMethod(input, init) === 'GET') {
            const rewritten = rewriteXGrokPostUrl(getRequestUrl(input), environment.getHref());
            if (rewritten) {
                try {
                    nextInput = environment.replaceFetchInputUrl(input, rewritten);
                } catch {
                    nextInput = input;
                }
            }
        }
        return Reflect.apply(originalFetch, this, [nextInput, init]);
    };
    const openWrapper: XGrokXhrOpenPort = function open(method, url, ...rest) {
        const rewritten = active && method.toLocaleUpperCase() === 'GET'
            ? rewriteXGrokPostUrl(getRequestUrl(url), environment.getHref())
            : null;
        return Reflect.apply(originalOpen, this, [method, rewritten ?? url, ...rest]);
    };
    const dispose = () => {
        const current = environment.stateHost[X_GROK_PAGE_BRIDGE_STATE_KEY] as XGrokPageBridgeState | undefined;
        if (current?.owner !== owner) return;
        active = false;
        restoreMethod(environment.fetch, fetchWrapper, originalFetch);
        restoreMethod(environment.xhrOpen, openWrapper, originalOpen);
        delete environment.stateHost[X_GROK_PAGE_BRIDGE_STATE_KEY];
    };

    installMethod(environment.fetch, fetchWrapper);
    installMethod(environment.xhrOpen, openWrapper);
    environment.stateHost[X_GROK_PAGE_BRIDGE_STATE_KEY] = {owner, dispose};
    return dispose;
}

/** MAIN world 入口始终监听启停，但只有动态激活标记存在时才包装页面网络方法。 */
export function installXGrokPageBridgeLifecycleCore(
    environment: XGrokPageBridgeEnvironment,
): () => void {
    const previous = environment.stateHost[X_GROK_PAGE_BRIDGE_LIFECYCLE_STATE_KEY] as
        XGrokPageBridgeLifecycleState | undefined;
    previous?.dispose?.();

    const owner = Symbol('fluentread-x-grok-page-bridge-lifecycle');
    let disposeBridge: (() => void) | null = null;
    const enable = () => {
        environment.stateHost[X_GROK_PAGE_BRIDGE_ACTIVATION_KEY] = true;
        if (environment.stateHost[X_GROK_PAGE_BRIDGE_STATE_KEY]) return;
        disposeBridge = installXGrokPageBridgeCore(environment);
    };
    const disable = () => {
        environment.stateHost[X_GROK_PAGE_BRIDGE_ACTIVATION_KEY] = false;
        disposeBridge?.();
        disposeBridge = null;
    };
    const dispose = () => {
        const current = environment.stateHost[X_GROK_PAGE_BRIDGE_LIFECYCLE_STATE_KEY] as
            XGrokPageBridgeLifecycleState | undefined;
        if (current?.owner !== owner) return;
        environment.documentEvents.removeEventListener(X_GROK_PAGE_BRIDGE_ENABLE_EVENT, enable);
        environment.documentEvents.removeEventListener(X_GROK_PAGE_BRIDGE_DISPOSE_EVENT, disable);
        environment.pageEvents.removeEventListener('pagehide', handlePageHide);
        disable();
        delete environment.stateHost[X_GROK_PAGE_BRIDGE_ACTIVATION_KEY];
        delete environment.stateHost[X_GROK_PAGE_BRIDGE_LIFECYCLE_STATE_KEY];
    };
    const handlePageHide = (event?: {persisted?: boolean}) => {
        if (event?.persisted !== true) dispose();
    };

    environment.documentEvents.addEventListener(X_GROK_PAGE_BRIDGE_ENABLE_EVENT, enable);
    environment.documentEvents.addEventListener(X_GROK_PAGE_BRIDGE_DISPOSE_EVENT, disable);
    environment.pageEvents.addEventListener('pagehide', handlePageHide);
    environment.stateHost[X_GROK_PAGE_BRIDGE_LIFECYCLE_STATE_KEY] = {owner, dispose};
    if (environment.stateHost[X_GROK_PAGE_BRIDGE_ACTIVATION_KEY] === true) enable();
    return dispose;
}
