/**
 * @file src/features/image-translation/content/mangaReader.ts
 * 文件职责：把漫画站点的正文图片、可见区域和页面生命周期接入连续翻译会话。
 * 主要内容：适配 MANGA Plus、Pixiv 和通用图片阅读器，排除推荐/头像；合并扫描和可见页优先的有界提前翻译，在换章、隐藏和卸载时暂停新任务并清理监听器。
 * 模块边界：只读取站点已展示的 img，不抓取章节、不读取站点私有数据或绕过访问限制；单图翻译、缓存与原图恢复通过注入端口复用既有运行时。
 */
import {createMangaSession, type MangaTranslationStatus} from './mangaSession';
import {normalizeMangaPrefetchPages, resolveMangaSite, type MangaSiteRule} from '@/src/core/config/manga';

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
    restore: (image: HTMLImageElement) => void;
    release: (image: HTMLImageElement) => void;
    failed: (image: HTMLImageElement) => boolean;
    changed: (status: MangaTranslationStatus) => void;
}) {
    let disposed = false;
    let frame: number | null = null;
    const observed = new Set<HTMLImageElement>();
    const session = createMangaSession({...ports, changed: status => ports.changed({...status, pageCount: observed.size})});
    const intersecting = new Set<HTMLImageElement>();
    let intersection: IntersectionObserver | null = null;
    let mutation: MutationObserver | null = null;

    function observeReader(): void {
        if (mutation) return;
        intersection = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(records => {
            records.forEach(record => {
                const image = record.target as HTMLImageElement;
                if (record.isIntersecting) intersecting.add(image);
                else intersecting.delete(image);
            });
            schedule();
        });
        mutation = new MutationObserver(records => {
            if (records.some(record => !(record.target instanceof Element && record.target.closest('[data-fluent-read-ui]')))) schedule();
        });
        mutation.observe(document.documentElement, {subtree: true, childList: true, attributes: true,
            attributeFilter: ['src', 'srcset', 'sizes', 'class', 'hidden', 'aria-hidden']});
    }

    function refresh(): void {
        if (disposed) return;
        const url = new URL(window.location?.href || 'about:blank');
        const site = resolveMangaSite(url.href, ports.siteRules?.());
        const selector = site?.selector ?? null;
        const available = ports.enabled() && selector !== null;
        if (available) observeReader();
        else {
            intersection?.disconnect(); mutation?.disconnect();
            intersection = null; mutation = null;
            observed.clear(); intersecting.clear();
        }
        let images: HTMLImageElement[] = [];
        if (available) {
            try { images = Array.from(document.querySelectorAll(selector!))
                .filter((image): image is HTMLImageElement => image.tagName === 'IMG' && !image.closest('[data-fluent-read-ui]')); }
            catch { /* 无效用户选择器保持原图，不中断站点或生命周期。 */ }
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
            intersecting.delete(image);
        });
        images.forEach(image => {
            if (observed.has(image)) return;
            observed.add(image);
            intersection?.observe(image);
        });
        const candidates = images.map(image => {
            const rect = image.getBoundingClientRect();
            const style = getComputedStyle(image);
            // 明确阅读器内的正文允许可点击图片和 presentation 角色，不能复用普通悬浮图标的装饰图排除。
            const ready = image.complete && image.naturalWidth >= 80 && image.naturalHeight >= 40
                && rect.width >= 80 && rect.height >= 40 && style.visibility !== 'hidden'
                && style.visibility !== 'collapse' && style.display !== 'none';
            return {image, identity: ports.identity(image), ready, visible: ready
                && (!intersection || intersecting.has(image))
                && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth};
        });
        const anchor = candidates.reduce((last, page, index) => page.visible ? index : last, -1);
        const ahead = ports.prefetchPages ? normalizeMangaPrefetchPages(ports.prefetchPages()) : 0;
        session.refresh({
            route: `${url.origin}${url.pathname}${url.search}`, available: available && (!site?.generic || images.length > 0),
            suspended: document.hidden,
            pages: candidates.map((page, index) => ({image: page.image, identity: page.identity,
                visible: page.visible && !document.hidden,
                prefetch: page.ready && anchor >= 0 && ((index > anchor && index <= anchor + ahead) || (document.hidden && page.visible))})),
        });
    }

    function schedule(): void {
        if (disposed || frame !== null) return;
        if (!session.status().available && !mangaReaderSelector(window.location?.href || 'about:blank', ports.siteRules?.())) return;
        frame = window.requestAnimationFrame(() => { frame = null; refresh(); });
    }
    document.addEventListener('load', schedule, true);
    document.addEventListener('visibilitychange', schedule);
    document.addEventListener('fluentread-route-change', schedule);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    refresh();
    return {
        status: session.status,
        schedule,
        toggle() { refresh(); const toggled = session.toggle(); refresh(); return toggled; },
        dispose() {
            disposed = true;
            if (frame !== null) window.cancelAnimationFrame(frame);
            intersection?.disconnect();
            mutation?.disconnect();
            observed.clear(); intersecting.clear();
            document.removeEventListener('load', schedule, true);
            document.removeEventListener('visibilitychange', schedule);
            document.removeEventListener('fluentread-route-change', schedule);
            window.removeEventListener('scroll', schedule, true);
            window.removeEventListener('resize', schedule);
            session.dispose();
        },
    };
}
