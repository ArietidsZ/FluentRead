/**
 * @file src/features/full-page-translation/content/viewportStability.ts
 * 文件职责：隔离全文翻译对页面滚动稳定性的辅助逻辑，避免动态页面在插入译文时发生视觉跳动或重复重排。
 * 主要内容：提供视口锚点补偿和滚动空闲门控；不参与候选发现、翻译请求或节点状态机。
 * 模块边界：本文件只管理可逆的浏览器视口状态与延迟回调，具体重启目标仍由全文 runtime 决定。
 */

const TRANSLATION_ARTIFACT_SELECTOR = [
    '[data-fr-translation-segment="true"]',
    '[data-fr-translation-owned="true"]',
    '.fluent-read-bilingual-content',
].join(',');

const FULL_PAGE_SCROLL_IDLE_MS = 220;

function isElementNode(node: Node | null | undefined): node is Element {
    return Boolean(node && node.nodeType === 1 && typeof (node as Element).matches === 'function');
}

function asHTMLElement(node: unknown): HTMLElement | null {
    if (!node || typeof node !== 'object' || (node as Node).nodeType !== 1) return null;
    const element = node as HTMLElement;
    return typeof element.tagName === 'string' && typeof element.style === 'object' ? element : null;
}

interface FullPageViewportAnchor {
    element: HTMLElement;
    top: number;
    scrollContainer: HTMLElement | null;
}

function isExcluded(element: HTMLElement, excludedNodes: readonly Node[]): boolean {
    return excludedNodes.some((excluded) => excluded === element ||
        (isElementNode(excluded) && (excluded.contains(element) || element.contains(excluded))));
}

function findScrollableAncestor(element: HTMLElement): HTMLElement | null {
    let current = element.parentElement;
    while (current && current !== document.body) {
        try {
            const style = document.defaultView?.getComputedStyle(current);
            if (style && /(auto|scroll|overlay)/u.test(style.overflowY) &&
                current.scrollHeight > current.clientHeight) return current;
        } catch {
            // Host custom elements can throw while their layout is being rebuilt.
        }
        current = current.parentElement;
    }
    return null;
}

function captureViewportAnchor(excludedNodes: readonly Node[] = []): FullPageViewportAnchor | null {
    if (typeof document === 'undefined' || typeof window === 'undefined' ||
        typeof document.elementFromPoint !== 'function') return null;

    for (const ratio of [0.5, 0.33, 0.66]) {
        const x = Math.max(0, Math.floor((window.innerWidth || 0) / 2));
        const y = Math.max(0, Math.min((window.innerHeight || 1) - 1,
            Math.floor((window.innerHeight || 1) * ratio)));
        let element = asHTMLElement(document.elementFromPoint(x, y));
        while (element && isExcluded(element, excludedNodes)) element = element.parentElement;
        if (!element || element.matches(TRANSLATION_ARTIFACT_SELECTOR)) continue;
        try {
            const rect = element.getBoundingClientRect();
            if (!(rect.width || rect.height)) continue;
            return {element, top: rect.top, scrollContainer: findScrollableAncestor(element)};
        } catch {
            // The page may detach the candidate between hit testing and layout.
        }
    }
    return null;
}

function restoreViewportAnchor(anchor: FullPageViewportAnchor | null): void {
    if (!anchor?.element.isConnected) return;
    try {
        const offset = anchor.element.getBoundingClientRect().top - anchor.top;
        if (Math.abs(offset) <= 0.5) return;
        if (anchor.scrollContainer?.isConnected) anchor.scrollContainer.scrollTop += offset;
        else if (typeof window.scrollBy === 'function') window.scrollBy(0, offset);
    } catch {
        // Scroll anchoring is a best-effort visual safeguard and must not break translation.
    }
}

export function withFullPageViewportAnchor<T>(callback: () => T, excludedNodes: readonly Node[] = []): T {
    const anchor = captureViewportAnchor(excludedNodes);
    try {
        return callback();
    } finally {
        restoreViewportAnchor(anchor);
    }
}

export interface FullPageScrollController {
    readonly isScrolling: boolean;
    note(): void;
    defer(target: HTMLElement): boolean;
    dispose(): void;
}

export function createFullPageScrollController(options: {
    isActive: () => boolean;
    onIdle: (targets: readonly HTMLElement[]) => void;
    afterIdle: () => void;
}): FullPageScrollController {
    let scrolling = false;
    let idleTimer: number | null = null;
    const deferredTargets = new Set<HTMLElement>();

    const settle = (): void => {
        idleTimer = null;
        if (!options.isActive()) return;
        scrolling = false;
        const targets = [...deferredTargets];
        deferredTargets.clear();
        options.onIdle(targets);
        options.afterIdle();
    };

    return {
        get isScrolling(): boolean { return scrolling; },
        note(): void {
            if (!options.isActive()) return;
            scrolling = true;
            if (idleTimer !== null) window.clearTimeout(idleTimer);
            idleTimer = window.setTimeout(settle, FULL_PAGE_SCROLL_IDLE_MS);
        },
        defer(target: HTMLElement): boolean {
            if (!scrolling || !target.isConnected) return false;
            deferredTargets.add(target);
            return true;
        },
        dispose(): void {
            if (idleTimer !== null) window.clearTimeout(idleTimer);
            idleTimer = null;
            scrolling = false;
            deferredTargets.clear();
        },
    };
}
