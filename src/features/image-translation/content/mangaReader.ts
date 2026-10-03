/**
 * @file src/features/image-translation/content/mangaReader.ts
 * 文件职责：把漫画站点的正文图片、可见区域和页面生命周期接入连续翻译会话。
 * 主要内容：精确识别 MANGA Plus 阅读器，观察图片加载、资源替换和视口变化；合并 DOM 扫描，在换章、页面隐藏和卸载时暂停任务并清理监听器。
 * 模块边界：只读取站点已展示的 img，不抓取章节、不读取站点私有数据或绕过访问限制；单图翻译、缓存与原图恢复通过注入端口复用既有运行时。
 */
import {createMangaSession, type MangaTranslationStatus} from './mangaSession';
import {isImageHoverEligible} from './hoverEligibility';

/** 站点目录只声明已核对的阅读器结构，首页、封面和其他域名不会进入批量翻译。 */
export function mangaReaderSelector(href: string): string | null {
    try {
        const url = new URL(href);
        return url.protocol === 'https:' && url.hostname === 'mangaplus.shueisha.co.jp'
            && /^\/viewer\/\d+\/?$/.test(url.pathname) ? '.zao-image-container img.zao-image' : null;
    } catch { return null; }
}

export function createMangaReader(ports: {
    enabled: () => boolean;
    identity: (image: HTMLImageElement) => string;
    translate: (image: HTMLImageElement) => Promise<void>;
    restore: (image: HTMLImageElement) => void;
    release: (image: HTMLImageElement) => void;
    failed: (image: HTMLImageElement) => boolean;
    changed: (status: MangaTranslationStatus) => void;
}) {
    const session = createMangaSession(ports);
    let disposed = false;
    let frame: number | null = null;
    const observed = new Set<HTMLImageElement>();
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
        const selector = mangaReaderSelector(url.href);
        const available = ports.enabled() && selector !== null;
        if (available) observeReader();
        else {
            intersection?.disconnect(); mutation?.disconnect();
            intersection = null; mutation = null;
            observed.clear(); intersecting.clear();
        }
        const images = available ? Array.from(document.querySelectorAll<HTMLImageElement>(selector!))
            .filter(image => !image.closest('[data-fluent-read-ui]')) : [];
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
        session.refresh({
            route: `${url.origin}${url.pathname}${url.search}`, available,
            pages: images.map(image => {
                const rect = image.getBoundingClientRect();
                const style = getComputedStyle(image);
                return {image, identity: ports.identity(image), visible: !document.hidden
                    && image.complete && image.naturalWidth > 0 && isImageHoverEligible(image)
                    && (!intersection || intersecting.has(image))
                    && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth
                    && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.display !== 'none'};
            }),
        });
    }

    function schedule(): void {
        if (disposed || frame !== null) return;
        if (!session.status().available && !mangaReaderSelector(window.location?.href || 'about:blank')) return;
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
