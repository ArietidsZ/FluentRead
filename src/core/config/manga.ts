/**
 * @file src/core/config/manga.ts
 * 文件职责：定义漫画阅读页的内置匹配与用户扩展规则，使网站识别独立于普通图片和悬浮球开关。
 * 主要内容：精确适配 MANGA Plus、Pixiv；网站目录与通用阅读路径配合 DOM 检测；校验用户规则与提前翻译窗口，拒绝首页、冒充内置站点的域名和非网页协议。
 * 模块边界：纯配置领域规则，不读取 DOM、不保存配置、不请求图片；正文图片是否可处理由漫画阅读器判断。
 */
import {isCatalogMangaHost, MANGA_READER_SELECTORS} from './mangaSiteCatalog';
export interface MangaSiteRule {hostname: string; pathPrefix: string; selector: string}
export interface MangaSite {name: string; selector: string; custom: boolean; generic?: boolean}

/** 旧配置默认提前三页；限制窗口，避免整章推理、内存和服务请求失控。 */
export function normalizeMangaPrefetchPages(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(5, Math.max(0, Math.floor(value))) : 3;
}

export function createMangaSiteRule(href: string, selector: string): MangaSiteRule | null {
    try {
        const url = new URL(href);
        const query = selector.trim();
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port
            || !query || query.length > 256 || query.includes(':has(')) return null;
        return {hostname: url.hostname, pathPrefix: url.pathname, selector: query};
    } catch { return null; }
}

export function normalizeMangaSiteRules(value: unknown): MangaSiteRule[] {
    if (!Array.isArray(value)) return [];
    const result: MangaSiteRule[] = [];
    const seen = new Set<string>();
    for (const item of value.slice(0, 20)) {
        if (!item || typeof item !== 'object' || typeof item.hostname !== 'string'
            || typeof item.pathPrefix !== 'string' || !item.pathPrefix.startsWith('/')
            || typeof item.selector !== 'string') continue;
        const rule = createMangaSiteRule(`https://${item.hostname}${item.pathPrefix}`, item.selector);
        if (!rule || rule.hostname !== item.hostname || rule.pathPrefix !== item.pathPrefix) continue;
        const key = `${rule.hostname}${rule.pathPrefix}`;
        if (seen.has(key)) continue;
        seen.add(key); result.push(rule);
    }
    return result;
}

export function resolveMangaSite(href: string, rules: MangaSiteRule[] = []): MangaSite | null {
    try {
        const url = new URL(href);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
        const custom = normalizeMangaSiteRules(rules).find(rule => rule.hostname === url.hostname
            && (url.pathname === rule.pathPrefix || url.pathname.startsWith(rule.pathPrefix.endsWith('/') ? rule.pathPrefix : `${rule.pathPrefix}/`)));
        if (custom) return {name: url.hostname, selector: custom.selector, custom: true};
        if (/^(?:mangaplus\.shueisha\.co\.jp|(?:www\.)?pixiv\.net)\./.test(url.hostname)) return null;
        if (url.hostname === 'mangaplus.shueisha.co.jp') return url.protocol === 'https:' && /^\/viewer\/\d+\/?$/.test(url.pathname)
            ? {name: 'MANGA Plus', selector: '.zao-image-container img.zao-image', custom: false} : null;
        if (['pixiv.net','www.pixiv.net'].includes(url.hostname)) {
            const id = /^\/(?:[a-z]{2}\/)?artworks\/(\d+)\/?$/.exec(url.pathname)?.[1];
            return url.protocol === 'https:' && id ? {name:'Pixiv',custom:false,
                selector:`img[src*="/img-master/"][src*="/${id}_p"], img[src*="/img-original/"][src*="/${id}_p"]`} : null;
        }
        const readingPath = /(?:^|[\/-])(?:read(?:er)?|viewer|chapter|episode|comic)(?:[\/-]|\d)/i.test(url.pathname);
        if (url.pathname !== '/' && (isCatalogMangaHost(url.hostname) || readingPath)) return {name:url.hostname,custom:false,generic:true,
            selector:MANGA_READER_SELECTORS + (readingPath ? ', main img, article img' : '')};
        return null;
    } catch { return null; }
}

/** 正常页快速复用的容量；总像素预算另行约束超长、超大图片。 */
export function normalizeMangaCachePages(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(24, Math.floor(value))) : 12;
}
export function mangaCachePixelBudget(value: unknown): number {
    return normalizeMangaCachePages(value) * 2_000_000;
}
