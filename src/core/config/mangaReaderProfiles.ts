/**
 * @file src/core/config/mangaReaderProfiles.ts
 * 文件职责：保存经公开阅读页结构核对的正文规则，避免通用图片过滤漏掉正文或误选推荐封面。
 * 主要内容：WeebCentral、Dynasty、Rawkuma 与单作品站正文图片规则，GigaViewer 画布和 YanMaga、小学馆分片阅读器的圈选入口；路径与域名均保留边界。
 * 模块边界：纯匹配，不执行站点脚本、不读取私有接口、不截图；可访问的图片由 content 阅读器检测。
 */
const gigaHosts = new Set(['comic-action.com', 'comic-days.com', 'comic-gardo.com', 'comic-trail.com',
    'kuragebunch.com', 'shonenjumpplus.com', 'tonarinoyj.jp']);
export const MANGA_AREA_READER_HOSTS = [...gigaHosts, 'yanmaga.jp', 'televikun-super-hero-comics.com'];
export function resolveMangaReaderProfile(hostname: string, pathname: string): {name: string; selector: string; areaSelector?: string} | null {
    const host = hostname.replace(/^www\./, '');
    if (gigaHosts.has(host) && /^\/episode\/\d+\/?$/.test(pathname)) return {
        name: host, selector: '.page-area img.page-image, .page-area img.js-page-image',
        areaSelector: '.page-area canvas.page-image, .page-area canvas.js-page-image',
    };
    if (host === 'dynasty-scans.com' && /^\/chapters\/[^/]+\/?$/.test(pathname)) return {
        name: 'Dynasty Scans', selector: '#reader #image img',
    };
    if (host === 'weebcentral.com' && /^\/chapters\/[A-Za-z0-9]+\/?$/.test(pathname)) return {
        name: 'WeebCentral', selector: '#chapter-images img',
    };
    if (host === 'yanmaga.jp' && /^\/viewer\/comics\//.test(pathname)) return {
        name: 'YanMaga', selector: ':not(*)', areaSelector: '.pt-img img',
    };
    if (host === 'televikun-super-hero-comics.com' && /^\/rensai\/[^/]+\/episode-\d+\/?$/.test(pathname)) return {
        name: 'Televi-Kun Super Hero Comics', selector: ':not(*)', areaSelector: '.pt-img img',
    };
    if (/(?:^|\.)(?:uzakichanmanga|kaijimanga|smokingbehindthesupermarket)\.com$/.test(host)
        && /^\/manga\/[^/]*chapter-[^/]+\/?$/.test(pathname)) return {
        name: host, selector: 'article .entry-content img',
    };
    if (['rawkuma.net','rawkuma.com'].includes(host) && /^\/manga\/[^/]+\/chapter-[^/]+\/?$/.test(pathname)) return {
        name: 'Rawkuma', selector: 'section.mx-auto > section > img',
    };
    return null;
}
