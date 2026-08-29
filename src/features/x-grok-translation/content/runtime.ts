/**
 * @file src/features/x-grok-translation/content/runtime.ts
 * 文件职责：在 X/Twitter 动态时间线中识别尚未翻译的 Grok 原生控件，并在帖子接近视口时为每个帖子幂等触发一次站点翻译。
 * 主要内容：以 documentElement 为动态观察根、IntersectionObserver 为近视口门禁，结合 status ID、DOM 控件结构、有限延迟重试和页面卸载清理管理虚拟列表生命周期。
 * 模块边界：运行时只点击 X 已渲染且可用的原生按钮，不读取按钮文案、不调用 FluentRead provider、不插入译文 DOM；全文翻译互斥由 core 暴露的 document 标记协调。
 */
import {X_GROK_NATIVE_TRANSLATION_ATTRIBUTE} from '@/src/core/translation/public';

const X_TWEET_SELECTOR = 'article[data-testid="tweet"]';
const X_STATUS_PATH_PATTERN = /\/status\/(\d+)/i;
const X_GROK_VIEW_BOX = '0 0 33 32';
const X_GROK_RETRY_DELAYS_MS = [120, 360, 900] as const;
const X_GROK_VIEWPORT_ROOT_MARGIN = '600px 0px';
const X_GROK_MIN_TRIGGER_INTERVAL_MS = 250;
const X_GROK_TRIGGER_VERIFICATION_MS = 8_000;
const X_GROK_MAX_CLICK_ATTEMPTS = 2;

type XGrokTranslationPhase = 'waiting' | 'queued' | 'triggered' | 'translated' | 'cooldown';

interface XGrokTweetState {
    identity: string | null;
    phase: XGrokTranslationPhase;
    visible: boolean;
    observed: boolean;
    retryIndex: number;
    retryTimer: ReturnType<typeof setTimeout> | null;
    clickAttempts: number;
    clickedButton: HTMLButtonElement | null;
}

interface XGrokControl {
    kind: 'translate' | 'translated';
    button: HTMLButtonElement;
}

interface XGrokAutoTranslateRuntime {
    disposed: boolean;
    intersectionObserver: IntersectionObserver;
    mutationObserver: MutationObserver;
    states: WeakMap<HTMLElement, XGrokTweetState>;
    trackedArticles: Set<HTMLElement>;
    triggerQueue: HTMLElement[];
    queuedArticles: Set<HTMLElement>;
    queueTimer: ReturnType<typeof setTimeout> | null;
    lastTriggerAt: number | null;
    pageHideHandler: (event: PageTransitionEvent) => void;
}

let activeRuntime: XGrokAutoTranslateRuntime | null = null;

function isXGrokHost(hostname: string): boolean {
    const normalized = hostname.trim().toLocaleLowerCase().replace(/\.$/, '');
    return normalized === 'x.com'
        || normalized.endsWith('.x.com')
        || normalized === 'twitter.com'
        || normalized.endsWith('.twitter.com');
}

export function isXGrokAutoTranslatePage(href: string): boolean {
    try {
        const pageUrl = new URL(href);
        return (pageUrl.protocol === 'https:' || pageUrl.protocol === 'http:')
            && isXGrokHost(pageUrl.hostname);
    } catch {
        return false;
    }
}

function isElementNode(node: Node): node is Element {
    return node.nodeType === 1;
}

function normalizeViewBox(value: string | null): string {
    return (value || '').trim().replace(/\s+/g, ' ');
}

function containsGrokLogo(element: Element): boolean {
    if (element.localName.toLocaleLowerCase() === 'svg'
        && normalizeViewBox(element.getAttribute('viewBox')) === X_GROK_VIEW_BOX) {
        return true;
    }

    return Array.from(element.querySelectorAll('svg')).some(
        (svg) => normalizeViewBox(svg.getAttribute('viewBox')) === X_GROK_VIEW_BOX,
    );
}

/**
 * X 的未译和已译控件共用 Grok 图标与按钮。已译状态会在图标和“显示原文”按钮之间
 * 插入一个说明来源的直属 span，因此只依据节点关系区分，避免绑定任一界面语言。
 */
function classifyGrokButton(button: HTMLButtonElement): XGrokControl | null {
    const parent = button.parentElement!;

    const siblings = Array.from(parent.children);
    const buttonIndex = siblings.indexOf(button);

    const logoIndex = siblings.findIndex((element, index) => index < buttonIndex && containsGrokLogo(element));
    if (logoIndex < 0) return null;

    const hasTranslatedFromSpan = siblings
        .slice(logoIndex + 1, buttonIndex)
        .some((element) => element.localName.toLocaleLowerCase() === 'span');

    return {
        button,
        kind: hasTranslatedFromSpan ? 'translated' : 'translate',
    };
}

function getDescendantDepth(ancestor: Element, descendant: Element): number {
    let depth = 0;
    let current: Element = descendant;
    while (current !== ancestor) {
        depth += 1;
        current = current.parentElement!;
    }
    return depth;
}

function getCommonAncestorDepth(article: HTMLElement, first: Element, second: Element): number {
    let current: Element | null = first;
    while (current && current !== article) {
        if (current.contains(second)) return getDescendantDepth(article, current);
        current = current.parentElement;
    }
    return 0;
}

function findGrokControl(article: HTMLElement): XGrokControl | null {
    const tweetTexts = Array.from(article.querySelectorAll<HTMLElement>('[data-testid="tweetText"]'));
    if (tweetTexts.length === 0) return null;
    const primaryTweetText = tweetTexts.reduce((preferred, candidate) => (
        getDescendantDepth(article, candidate) < getDescendantDepth(article, preferred)
            ? candidate
            : preferred
    ));

    const controls: Array<{control: XGrokControl; scopeDepth: number}> = [];
    for (const element of Array.from(article.querySelectorAll('button'))) {
        const control = classifyGrokButton(element as HTMLButtonElement);
        if (!control) continue;
        controls.push({
            control,
            scopeDepth: getCommonAncestorDepth(article, primaryTweetText, control.button.parentElement!),
        });
    }
    if (controls.length === 0) return null;

    const closestScopeDepth = Math.max(...controls.map(({scopeDepth}) => scopeDepth));
    // 多个 tweetText 表示文章内含引用帖；若所有控件都只在 article 层与主帖相交，
    // 无法证明控件属于主帖，宁可等待 X 重绘出更明确的结构也不误点引用帖。
    if (tweetTexts.length > 1 && closestScopeDepth <= 0) return null;

    let translatedControl: XGrokControl | null = null;
    for (const item of controls) {
        if (item.scopeDepth !== closestScopeDepth) continue;
        if (item.control.kind === 'translate') return item.control;
        translatedControl = item.control;
    }
    return translatedControl;
}

function isButtonActionable(button: HTMLButtonElement): boolean {
    return !button.matches('[disabled], [aria-disabled="true"], [aria-hidden="true"], [hidden]');
}

function extractStatusIdentity(href: string | null): string | null {
    const match = href?.match(X_STATUS_PATH_PATTERN);
    return match?.[1] ? `status:${match[1]}` : null;
}

function getTweetIdentity(article: HTMLElement): string | null {
    const timedStatusAnchor = article.querySelector('time')?.closest('a[href*="/status/"]');
    const timedIdentity = extractStatusIdentity(timedStatusAnchor?.getAttribute('href') || null);
    if (timedIdentity) return timedIdentity;

    for (const anchor of Array.from(article.querySelectorAll('a[href*="/status/"]'))) {
        const identity = extractStatusIdentity(anchor.getAttribute('href'));
        if (identity) return identity;
    }
    return null;
}

function clearRetry(state: XGrokTweetState): void {
    if (state.retryTimer === null) return;
    clearTimeout(state.retryTimer);
    state.retryTimer = null;
}

function removeQueuedArticle(runtime: XGrokAutoTranslateRuntime, article: HTMLElement): void {
    if (!runtime.queuedArticles.delete(article)) return;
    runtime.triggerQueue = runtime.triggerQueue.filter((queuedArticle) => queuedArticle !== article);
}

function resetTweetState(
    runtime: XGrokAutoTranslateRuntime,
    article: HTMLElement,
    state: XGrokTweetState,
    identity: string | null,
): void {
    clearRetry(state);
    removeQueuedArticle(runtime, article);
    state.identity = identity;
    state.phase = 'waiting';
    state.retryIndex = 0;
    state.clickAttempts = 0;
    state.clickedButton = null;
    if (!state.observed) {
        runtime.intersectionObserver.observe(article);
        state.observed = true;
    }
}

function scheduleRetry(
    runtime: XGrokAutoTranslateRuntime,
    article: HTMLElement,
    state: XGrokTweetState,
): void {
    if (state.retryTimer !== null || state.retryIndex >= X_GROK_RETRY_DELAYS_MS.length) return;
    const delay = X_GROK_RETRY_DELAYS_MS[state.retryIndex];
    state.retryIndex += 1;
    state.retryTimer = setTimeout(() => {
        state.retryTimer = null;
        attemptGrokTranslation(runtime, article);
    }, delay);
}

function finishTweet(
    runtime: XGrokAutoTranslateRuntime,
    article: HTMLElement,
    state: XGrokTweetState,
    phase: 'triggered' | 'translated' | 'cooldown',
): void {
    clearRetry(state);
    state.phase = phase;
    if (state.observed) {
        runtime.intersectionObserver.unobserve(article);
        state.observed = false;
    }
}

function scheduleClickVerification(
    runtime: XGrokAutoTranslateRuntime,
    article: HTMLElement,
    state: XGrokTweetState,
): void {
    clearRetry(state);
    state.retryTimer = setTimeout(() => {
        state.retryTimer = null;
        // phase 变化、节点回收和卸载都会同步清除此 timer；这里仅需防宿主未投递 removal record。
        if (!article.isConnected) return;

        const identity = getTweetIdentity(article);
        if (identity !== state.identity) {
            resetTweetState(runtime, article, state, identity);
            // 只有近视口帖子才会进入 triggered，且点击后已 unobserve，visible 在此期间保持为真。
            attemptGrokTranslation(runtime, article);
            return;
        }

        const control = findGrokControl(article);
        if (control?.kind === 'translated') {
            finishTweet(runtime, article, state, 'translated');
            return;
        }
        if (control?.kind === 'translate'
            && control.button === state.clickedButton
            && state.clickAttempts < X_GROK_MAX_CLICK_ATTEMPTS) {
            state.phase = 'waiting';
            state.clickedButton = null;
            if (!state.observed) {
                runtime.intersectionObserver.observe(article);
                state.observed = true;
            }
            enqueueTrigger(runtime, article, state);
            return;
        }

        // 第二次点击仍无响应、控件被替换或结果结构不明确时停止本帖，避免与 X 循环争抢。
        state.clickedButton = null;
        finishTweet(runtime, article, state, 'cooldown');
    }, X_GROK_TRIGGER_VERIFICATION_MS);
}

function performQueuedTrigger(runtime: XGrokAutoTranslateRuntime, article: HTMLElement): boolean {
    // triggerQueue 与 states/queuedArticles 同步增删，出队时必然仍有 queued 状态。
    const state = runtime.states.get(article)!;
    if (!state.visible || !article.isConnected) {
        state.phase = 'waiting';
        return false;
    }

    const identity = getTweetIdentity(article);
    if (identity !== state.identity) {
        resetTweetState(runtime, article, state, identity);
        attemptGrokTranslation(runtime, article);
        return false;
    }

    const control = findGrokControl(article);
    if (control?.kind === 'translated') {
        finishTweet(runtime, article, state, 'translated');
        return false;
    }
    if (!control || !isButtonActionable(control.button)) {
        state.phase = 'waiting';
        scheduleRetry(runtime, article, state);
        return false;
    }

    state.clickAttempts += 1;
    state.clickedButton = control.button;
    finishTweet(runtime, article, state, 'triggered');
    try {
        control.button.click();
        runtime.lastTriggerAt = Date.now();
        scheduleClickVerification(runtime, article, state);
        return true;
    } catch {
        state.phase = 'waiting';
        state.clickedButton = null;
        runtime.intersectionObserver.observe(article);
        state.observed = true;
        if (state.clickAttempts >= X_GROK_MAX_CLICK_ATTEMPTS) {
            finishTweet(runtime, article, state, 'cooldown');
        } else {
            scheduleRetry(runtime, article, state);
        }
        return false;
    }
}

function drainTriggerQueue(runtime: XGrokAutoTranslateRuntime): void {
    if (runtime.queueTimer !== null) return;

    while (runtime.triggerQueue.length > 0) {
        const article = runtime.triggerQueue[0]!;
        const elapsed = runtime.lastTriggerAt === null
            ? X_GROK_MIN_TRIGGER_INTERVAL_MS
            : Date.now() - runtime.lastTriggerAt;
        const remaining = X_GROK_MIN_TRIGGER_INTERVAL_MS - elapsed;
        if (remaining > 0) {
            runtime.queueTimer = setTimeout(() => {
                runtime.queueTimer = null;
                drainTriggerQueue(runtime);
            }, remaining);
            return;
        }

        runtime.triggerQueue.shift();
        runtime.queuedArticles.delete(article);
        performQueuedTrigger(runtime, article);
    }
}

function enqueueTrigger(
    runtime: XGrokAutoTranslateRuntime,
    article: HTMLElement,
    state: XGrokTweetState,
): void {
    clearRetry(state);
    state.phase = 'queued';
    runtime.queuedArticles.add(article);
    runtime.triggerQueue.push(article);
    drainTriggerQueue(runtime);
}

function attemptGrokTranslation(runtime: XGrokAutoTranslateRuntime, article: HTMLElement): void {
    const state = runtime.states.get(article)!;
    // 只有可见回调、可见状态下的 DOM 更新或尚未被取消的 retry timer 会进入这里。
    if (!article.isConnected) return;

    const identity = getTweetIdentity(article);
    if (identity !== state.identity) resetTweetState(runtime, article, state, identity);

    if (state.phase === 'translated' || state.phase === 'cooldown' || state.phase === 'queued') return;

    const control = findGrokControl(article);
    if (control?.kind === 'translated') {
        finishTweet(runtime, article, state, 'translated');
        return;
    }
    if (state.phase === 'triggered') return;

    if (!control || !isButtonActionable(control.button)) {
        scheduleRetry(runtime, article, state);
        return;
    }

    enqueueTrigger(runtime, article, state);
}

function registerOrRefreshArticle(runtime: XGrokAutoTranslateRuntime, article: HTMLElement): void {
    if (!article.isConnected) return;

    const identity = getTweetIdentity(article);
    let state = runtime.states.get(article);
    if (!state) {
        state = {
            identity,
            phase: 'waiting',
            visible: false,
            observed: true,
            retryIndex: 0,
            retryTimer: null,
            clickAttempts: 0,
            clickedButton: null,
        };
        runtime.states.set(article, state);
        runtime.trackedArticles.add(article);
        runtime.intersectionObserver.observe(article);
    } else if (identity !== state.identity) {
        resetTweetState(runtime, article, state, identity);
    }

    if (state.visible) attemptGrokTranslation(runtime, article);
}

function collectArticles(node: Node, output: Set<HTMLElement>): void {
    if (!isElementNode(node)) return;
    if (node.matches(X_TWEET_SELECTOR)) output.add(node as HTMLElement);

    const ancestor = node.closest(X_TWEET_SELECTOR);
    if (ancestor) output.add(ancestor as HTMLElement);

    node.querySelectorAll(X_TWEET_SELECTOR).forEach((article) => output.add(article as HTMLElement));
}

function forgetDetachedArticles(runtime: XGrokAutoTranslateRuntime, node: Node): void {
    const articles = new Set<HTMLElement>();
    collectArticles(node, articles);
    articles.forEach((article) => {
        if (article.isConnected) return;
        const state = runtime.states.get(article);
        if (state) clearRetry(state);
        runtime.intersectionObserver.unobserve(article);
        removeQueuedArticle(runtime, article);
        runtime.states.delete(article);
        runtime.trackedArticles.delete(article);
    });
}

function handleMutations(runtime: XGrokAutoTranslateRuntime, records: MutationRecord[]): void {
    if (runtime.disposed) return;
    const touchedArticles = new Set<HTMLElement>();

    records.forEach((record) => {
        if (record.type === 'childList') {
            record.removedNodes.forEach((node) => forgetDetachedArticles(runtime, node));
            record.addedNodes.forEach((node) => collectArticles(node, touchedArticles));
        }
        collectArticles(record.target, touchedArticles);
    });

    touchedArticles.forEach((article) => registerOrRefreshArticle(runtime, article));
}

function createRuntime(): XGrokAutoTranslateRuntime {
    const runtime = {} as XGrokAutoTranslateRuntime;
    runtime.disposed = false;
    runtime.states = new WeakMap();
    runtime.trackedArticles = new Set();
    runtime.triggerQueue = [];
    runtime.queuedArticles = new Set();
    runtime.queueTimer = null;
    runtime.lastTriggerAt = null;
    runtime.pageHideHandler = (event) => {
        // BFCache 会保留 document 与 content runtime；返回时入口不会重跑，不能提前丢失观察器和互斥标记。
        if (event.persisted !== true) unmountXGrokAutoTranslate();
    };
    runtime.intersectionObserver = new IntersectionObserver((entries) => {
        if (runtime.disposed) return;
        entries.forEach((entry) => {
            if (!isElementNode(entry.target) || !entry.target.matches(X_TWEET_SELECTOR)) return;
            const article = entry.target as HTMLElement;
            const state = runtime.states.get(article);
            if (!state || !state.observed) return;
            state.visible = entry.isIntersecting;
            if (entry.isIntersecting) attemptGrokTranslation(runtime, article);
            else clearRetry(state);
        });
    }, {
        root: null,
        rootMargin: X_GROK_VIEWPORT_ROOT_MARGIN,
        threshold: 0.01,
    });
    runtime.mutationObserver = new MutationObserver((records) => handleMutations(runtime, records));
    return runtime;
}

export function isXGrokAutoTranslateMounted(): boolean {
    return activeRuntime !== null;
}

export function mountXGrokAutoTranslate(): void {
    if (activeRuntime || typeof window === 'undefined' || typeof document === 'undefined') return;
    if (!isXGrokAutoTranslatePage(window.location.href)) return;

    const root = document.documentElement;

    const runtime = createRuntime();
    activeRuntime = runtime;
    root.setAttribute(X_GROK_NATIVE_TRANSLATION_ATTRIBUTE, '');
    runtime.mutationObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'disabled', 'aria-disabled', 'aria-hidden', 'hidden', 'viewBox'],
    });
    window.addEventListener('pagehide', runtime.pageHideHandler);

    const articles = new Set<HTMLElement>();
    collectArticles(root, articles);
    articles.forEach((article) => registerOrRefreshArticle(runtime, article));
}

export function unmountXGrokAutoTranslate(): void {
    const runtime = activeRuntime;
    activeRuntime = null;

    if (runtime) {
        runtime.disposed = true;
        window.removeEventListener('pagehide', runtime.pageHideHandler);
        runtime.mutationObserver.disconnect();
        runtime.intersectionObserver.disconnect();
        if (runtime.queueTimer !== null) clearTimeout(runtime.queueTimer);
        runtime.queueTimer = null;
        runtime.triggerQueue.length = 0;
        runtime.queuedArticles.clear();
        runtime.trackedArticles.forEach((article) => {
            clearRetry(runtime.states.get(article)!);
        });
        runtime.trackedArticles.clear();
    }

    if (typeof document !== 'undefined') {
        document.documentElement.removeAttribute(X_GROK_NATIVE_TRANSLATION_ATTRIBUTE);
    }
}
