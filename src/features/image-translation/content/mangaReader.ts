/**
 * @file src/features/image-translation/content/mangaReader.ts
 * 文件职责：把漫画站点的正文图片、可见区域和页面生命周期接入连续翻译会话。
 * 主要内容：适配 MANGA Plus、Pixiv 和通用图片阅读器，排除推荐/头像；正文发现与上下左右的几何更新分开，按当前位置判断可见页；同地址重载也更新像素版本，避免误复用；当前页优先的有界提前翻译和前后各两张附近页保留共享像素预算，换章、隐藏和卸载时清理监听器。
 * 模块边界：只读取站点已展示的 img，不抓取章节、不读取站点私有数据或绕过访问限制；单图翻译、缓存与原图恢复通过注入端口复用既有运行时。
 */
import {createMangaSession, type MangaTranslationStatus} from './mangaSession';
import {normalizeMangaPrefetchPages, resolveMangaSite, type MangaSiteRule} from '@/src/core/config/manga';
import {imageLoadTracker} from './imageLoads';

/** 精确站点与通用阅读器都需要 DOM 候选检查；网站目录不等同于逐站实测通过。 */
export function mangaReaderSelector(href: string, rules: MangaSiteRule[] = []): string | null {
    return resolveMangaSite(href, rules)?.selector ?? null;
}

export function createMangaReader(ports: {
    enabled: () => boolean;
    siteRules?: () => MangaSiteRule[];
    prefetchPages?: () => number;
    identity: (image: HTMLImageElement) => string;
    translate: (image: HTMLImageElement) => Promise<void>;
    reuse?: (image: HTMLImageElement) => boolean;
    restore: (image: HTMLImageElement) => void;
    release: (image: HTMLImageElement) => void;
    failed: (image: HTMLImageElement) => boolean;
    changed: (status: MangaTranslationStatus) => void;
}) {
    let disposed = false;
    let frame: number | null = null;
    const observed = new Set<HTMLImageElement>();
    let discovered: HTMLImageElement[] = [];
    let discoveryDirty = true;
    let discoverySelector: string | null = null;
    const session = createMangaSession({...ports, changed: status => ports.changed({...status, pageCount: observed.size})});
    let intersection: IntersectionObserver | null = null;
    let mutation: MutationObserver | null = null;

    function observeReader(): void {
        if (mutation) return;
        intersection = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(scheduleLayout);
        mutation = new MutationObserver(records => {
            if (records.some(record => !(record.target instanceof Element && record.target.closest('[data-fluent-read-ui]')))) schedule();
        });
        mutation.observe(document.documentElement, {subtree: true, childList: true, attributes: true,
            attributeFilter: ['src', 'srcset', 'sizes', 'media', 'type', 'class', 'id', 'data-manga-reader', 'hidden', 'aria-hidden']});
    }

    function refresh(): void {
        if (disposed) return;
        const url = new URL(window.location?.href || 'about:blank');
        const site = resolveMangaSite(url.href, ports.siteRules?.());
        const selector = site?.selector ?? null;
        const custom = site?.custom === true;
        const available = ports.enabled() && selector !== null;
        if (available) observeReader();
        else {
            intersection?.disconnect(); mutation?.disconnect();
            intersection = null; mutation = null;
            observed.clear();
            discovered = [];
            discoveryDirty = true;
        }
        let images: HTMLImageElement[] = [];
        if (available) {
            // 自定义 CSS 选择器可能依赖任意属性或状态，保留动态查询；已知站点复用正文发现结果。
            if (custom || discoveryDirty || discoverySelector !== selector) {
                discoveryDirty = false;
                discoverySelector = selector;
                discovered = [];
                try { discovered = Array.from(document.querySelectorAll(selector!))
                    .filter((image): image is HTMLImageElement => image.tagName === 'IMG' && !image.closest('[data-fluent-read-ui]')); }
                catch { /* 无效用户选择器保持原图，不中断站点或生命周期。 */ }
            }
            images = discovered;
        }
        if (site?.generic) images = images.filter(image => {
            const rect = image.getBoundingClientRect();
            return rect.width >= 240 && rect.height >= 240 && !image.closest('nav, header, footer, aside, [data-ad], [class*="recommend"], [class*="thumbnail"], [class*="avatar"]');
        });
        if (site?.name === 'Pixiv') {
            const expanded = images.filter(image => image.closest('.gtm-expand-full-size-illust') && image.getBoundingClientRect().width > 0);
            if (expanded.length) images = expanded;
        }
        const current = new Set(images);
        observed.forEach(image => {
            if (current.has(image)) return;
            intersection?.unobserve(image);
            observed.delete(image);
        });
        images.forEach(image => {
            if (observed.has(image)) return;
            observed.add(image);
            intersection?.observe(image);
        });
        // 同一帧共享祖先样式，避免连续图片在滚动时重复读取阅读器容器。
        const ancestorStyles = new Map<Element, CSSStyleDeclaration>();
        const inViewport = (image: HTMLImageElement, rect: DOMRect) => {
            let left=Math.max(0,rect.left),right=Math.min(window.innerWidth,rect.right);
            let top=Math.max(0,rect.top),bottom=Math.min(window.innerHeight,rect.bottom);
            if (right<=left || bottom<=top) return false;
            for (let parent=image.parentElement;parent;parent=parent.parentElement) {
                let style=ancestorStyles.get(parent);
                if (!style) {style=getComputedStyle(parent);ancestorStyles.set(parent,style);}
                if (style.display==='none' || style.visibility==='hidden' || style.visibility==='collapse' || style.opacity==='0') return false;
                if (parent===document.documentElement || parent===document.scrollingElement) continue;
                const x=/^(hidden|clip|auto|scroll)$/.test(style.overflowX),y=/^(hidden|clip|auto|scroll)$/.test(style.overflowY);
                if (!x && !y) continue;
                const clip=parent.getBoundingClientRect();
                if (x) {left=Math.max(left,clip.left);right=Math.min(right,clip.right);}
                if (y) {top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom);}
            }
            return right>left && bottom>top;
        };
        const candidates = images.map(image => {
            const rect = image.getBoundingClientRect();
            const style = getComputedStyle(image);
            // 明确阅读器内的正文允许可点击图片和 presentation 角色，不能复用普通悬浮图标的装饰图排除。
            const ready = image.complete && image.naturalWidth >= 80 && image.naturalHeight >= 40
                && rect.width >= 80 && rect.height >= 40 && style.visibility !== 'hidden'
                && style.visibility !== 'collapse' && style.display !== 'none';
            return {image, identity: `${ports.identity(image)}:${imageLoadTracker.revision(image)}`, ready, visible: ready
                && inViewport(image,rect)};
        });
        const anchor = candidates.reduce((last, page, index) => page.visible ? index : last, -1);
        const ahead = ports.prefetchPages ? normalizeMangaPrefetchPages(ports.prefetchPages()) : 0;
        const firstVisible=candidates.findIndex(page=>page.visible);
        const nearby=new Set<HTMLImageElement>(),upcoming=new Set<HTMLImageElement>();let retainedPixels=0;
        // 关闭预译也保留附近已完成结果：GPU 较快时，下页可能在返页期间完成，不能立刻释放并重复识别。
        // 提前页和前后各两张共享像素预算；先准备最近下页，历史项仅保留不调度。
        const retain=(index:number)=>{
            const page=candidates[index];
            if (nearby.has(page.image)) return true;
            const pixels=page.image.naturalWidth*page.image.naturalHeight;
            if (!page.ready || retainedPixels+pixels>8_000_000) return false;
            nearby.add(page.image);retainedPixels+=pixels;return true;
        };
        if(anchor>=0)for(let index=anchor+1;index<candidates.length && index<=anchor+ahead;index++) {
            if (!candidates[index].ready) continue;
            if (!retain(index)) break;
            upcoming.add(candidates[index].image);
        }
        for (let index=firstVisible-1;index>=0 && index>=firstVisible-2;index--) retain(index);
        if(anchor>=0)for(let index=anchor+1;index<candidates.length && index<=anchor+2;index++)retain(index);
        session.refresh({
            route: `${url.origin}${url.pathname}${url.search}`, available: available && (!site?.generic || images.length > 0),
            suspended: document.hidden,
            pages: candidates.map(page => ({image: page.image, identity: page.identity,
                visible: page.visible && !document.hidden, retain: nearby.has(page.image),
                prefetch: upcoming.has(page.image) || (document.hidden && page.visible)})),
        });
    }

    function scheduleLayout(): void {
        if (disposed || frame !== null) return;
        if (!session.status().available && !mangaReaderSelector(window.location?.href || 'about:blank', ports.siteRules?.())) return;
        frame = window.requestAnimationFrame(() => { frame = null; refresh(); });
    }
    function schedule(): void { discoveryDirty = true; scheduleLayout(); }
    function loaded(event: Event): void {
        const image = event.target as HTMLImageElement;
        if (observed.has(image)) imageLoadTracker.loaded(event);
        schedule();
    }
    document.addEventListener('load', loaded, true);
    document.addEventListener('visibilitychange', scheduleLayout);
    document.addEventListener('fluentread-route-change', schedule);
    window.addEventListener('scroll', scheduleLayout, true);
    window.addEventListener('resize', scheduleLayout);
    refresh();
    return {
        status: session.status,
        schedule,
        toggle() { discoveryDirty = true; refresh(); const toggled = session.toggle(); refresh(); return toggled; },
        dispose() {
            disposed = true;
            if (frame !== null) window.cancelAnimationFrame(frame);
            intersection?.disconnect();
            mutation?.disconnect();
            observed.clear();
            discovered = [];
            document.removeEventListener('load', loaded, true);
            document.removeEventListener('visibilitychange', scheduleLayout);
            document.removeEventListener('fluentread-route-change', schedule);
            window.removeEventListener('scroll', scheduleLayout, true);
            window.removeEventListener('resize', scheduleLayout);
            session.dispose();
        },
    };
}
