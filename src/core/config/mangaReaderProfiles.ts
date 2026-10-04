/**
 * @file src/core/config/mangaReaderProfiles.ts
 * 文件职责：保存经公开阅读页结构核对的正文规则，避免通用图片过滤漏掉正文或误选推荐封面。
 * 主要内容：WeebCentral、Dynasty、MangaDNA、Rawkuma 与单作品站正文图片规则，GigaViewer 和 Comici 正文画布规则、不可读画布和分片的圈选入口；路径与域名均保留边界。
 * 模块边界：纯匹配，不执行站点脚本、不读取私有接口、不截图；可访问的图片由 content 阅读器检测。
 */
const gigaHosts = new Set(['comic-action.com', 'comic-days.com', 'comic-gardo.com', 'comic-trail.com',
    'kuragebunch.com', 'shonenjumpplus.com', 'tonarinoyj.jp', 'comic-zenon.com']);
export const MANGA_AREA_READER_HOSTS = [...gigaHosts, 'yanmaga.jp', 'televikun-super-hero-comics.com'];
export const MANGA_CANVAS_READER_HOSTS = ['championcross.jp', 'comic-ryu.jp', 'comic-growl.com'];
export function resolveMangaReaderProfile(hostname: string, pathname: string): {name: string; selector: string; canvasSelector?: string; canvasInteractionSelector?: string; areaSelector?: string} | null {
    const host = hostname.replace(/^www\./, '');
    if (gigaHosts.has(host) && /^\/episode\/\d+\/?$/.test(pathname)) return {
        name: host, selector: '.page-area img.page-image, .page-area img.js-page-image',
        canvasSelector: '.page-area canvas.page-image, .page-area canvas.js-page-image',
        areaSelector: '.page-area canvas.page-image, .page-area canvas.js-page-image',
    };
    if (MANGA_CANVAS_READER_HOSTS.includes(host) && /^\/episodes\/[a-z0-9]+\/?$/.test(pathname)) return {
        name: host, selector: ':not(*)', canvasSelector: '#comici-viewer .-cv-page-canvas canvas',
        canvasInteractionSelector: '#comici-viewer #xCVLeftNav, #comici-viewer #xCVRightNav, #comici-viewer #xCVNavCenter',
        areaSelector: '#comici-viewer .-cv-page-canvas canvas',
    };
    if (host === 'dynasty-scans.com' && /^\/chapters\/[^/]+\/?$/.test(pathname)) return {
        name: 'Dynasty Scans', selector: '#reader #image img',
    };
    if (host === 'weebcentral.com' && /^\/chapters\/[A-Za-z0-9]+\/?$/.test(pathname)) return {
        name: 'WeebCentral', selector: '#chapter-images img',
    };
    if (host === 'mangadna.com' && /^\/manga\/[^/]+\/chapter-[^/]+\/?$/.test(pathname)) return {
        name: 'MangaDNA', selector: '.read-manga .read-content > img',
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
