/**
 * @file src/core/config/manga.ts
 * 文件职责：定义漫画阅读页的内置匹配与用户扩展规则，使网站识别独立于普通图片和悬浮球开关。
 * 主要内容：校验精确域名、阅读路径和图片选择器，限制规则数量并去重；按阅读页地址返回网站名称与选择器，明确拒绝首页、相似域名和非网页协议。
 * 模块边界：纯配置领域规则，不读取 DOM、不保存配置、不请求图片；正文图片是否可处理由漫画阅读器判断。
 */
export interface MangaSiteRule {hostname: string; pathPrefix: string; selector: string}
export interface MangaSite {name: string; selector: string; custom: boolean}

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
        return url.protocol === 'https:' && url.hostname === 'mangaplus.shueisha.co.jp'
            && /^\/viewer\/\d+\/?$/.test(url.pathname)
            ? {name: 'MANGA Plus', selector: '.zao-image-container img.zao-image', custom: false} : null;
    } catch { return null; }
}
