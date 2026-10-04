/**
 * @file src/core/config/mangaReaderProfiles.ts
 * 文件职责：保存经公开阅读页结构核对的正文规则，避免通用图片过滤漏掉正文或误选推荐封面。
 * 主要内容：已核对章节站的正文图片规则，Antbyw 和 Naver 查询参数章节边界，GigaViewer、Comici 和 ComicWalker 正文画布规则、不可读画布和分片的圈选入口；路径与域名均保留边界。
 * 模块边界：纯匹配，不执行站点脚本、不读取私有接口、不截图；可访问的图片由 content 阅读器检测。
 */
const gigaHosts = new Set(['comic-action.com', 'comic-days.com', 'comic-gardo.com', 'comic-trail.com',
    'kuragebunch.com', 'shonenjumpplus.com', 'tonarinoyj.jp', 'comic-zenon.com', 'ichicomi.com']);
export const MANGA_AREA_READER_HOSTS = [...gigaHosts, 'yanmaga.jp', 'televikun-super-hero-comics.com', 'jumptoon.com', 'comic-meteor.jp', 'kirapo.jp'];
const comiciHosts = ['championcross.jp', 'comic-ryu.jp', 'comic-growl.com',
    'rimacomiplus.jp', 'heros-web.com', 'younganimal.com', 'youngchampion.jp'];
export const MANGA_CANVAS_READER_HOSTS = [...comiciHosts, 'comic-walker.com'];
export function resolveMangaReaderProfile(hostname: string, pathname: string, search = ''): {name: string; selector: string; canvasSelector?: string; canvasInteractionSelector?: string; areaSelector?: string} | null {
    const host = hostname.replace(/^www\./, '');
    if (gigaHosts.has(host) && /^\/episode\/\d+\/?$/.test(pathname)) return {
        name: host, selector: '.page-area img.page-image, .page-area img.js-page-image',
        canvasSelector: '.page-area canvas.page-image, .page-area canvas.js-page-image',
        areaSelector: '.page-area canvas.page-image, .page-area canvas.js-page-image',
    };
    if (host === 'comic-walker.com' && /^\/detail\/KC_\d+_S\/episodes\/KC_\d+_E\/?$/.test(pathname)) return {
        name: 'ComicWalker', selector: ':not(*)',
        canvasSelector: '[data-viewer-full-screen-helper] canvas[data-type="contents"], [data-viewer-full-screen-helper] [data-type="contents"] > canvas',
        canvasInteractionSelector: '[data-viewer-full-screen-helper] canvas + div[class^="_cover_"]',
        areaSelector: '[data-viewer-full-screen-helper] canvas[data-type="contents"], [data-viewer-full-screen-helper] [data-type="contents"] > canvas',
    };
    if (comiciHosts.includes(host) && (/^\/episodes\/[a-z0-9]+\/?$/.test(pathname)
        || host === 'rimacomiplus.jp' && /^\/[^/]+\/episodes\/[a-z0-9]+\/?$/.test(pathname))) return {
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
    if (['asuracomic.net', 'asurascans.com'].includes(host) && /^\/comics\/[^/]+\/chapter\/\d+\/?$/.test(pathname)) return {
        name: 'Asura Scans', selector: '.select-none [data-page] > img',
    };
    if (['arenascan.com', 'kingofshojo.com', 'violetscans.org', 'violetmanga.com'].includes(host)
        && /^\/[^/]+-chapter-[^/]+\/?$/.test(pathname)) return {
        name: host, selector: 'article #readerarea img',
    };
    if (['mangaread.org', 'mangaforfree.net'].includes(host) && /^\/manga\/[^/]+\/chapter-[^/]+\/?$/.test(pathname)) return {
        name: host, selector: '.reading-content .page-break > img',
    };
    if (host === 'manhwabuddy.com' && /^\/manhwa\/[^/]+\/chapter-[^/]+\/?$/.test(pathname)) return {
        name: 'ManhwaBuddy', selector: '.reading-chapter .reading-content img',
    };
    if (host === 'vortexscans.org' && /^\/series\/[^/]+\/chapter-[^/]+\/?$/.test(pathname)) return {
        name: 'Vortex Scans', selector: '.comic-images-wrapper > .image-container img',
    };
    if (host === 'rookie.shonenjump.com' && /^\/series\/[\w-]+\/[\w-]+\/?$/.test(pathname)) return {
        name: 'Jump Rookie', selector: '.page-area img.js-page-image',
    };
    if (host === 'webtoons.com' && /^\/[^/]+\/[^/]+\/[^/]+\/[^/]+\/viewer\/?$/.test(pathname)) return {
        name: 'Webtoons', selector: '#_imageList > img._images',
    };
    if (host === 'comic.naver.com' && pathname === '/webtoon/detail') {
        const query = new URLSearchParams(search);
        if (/^\d+$/.test(query.get('titleId') ?? '') && /^\d+$/.test(query.get('no') ?? '')) return {
            name: 'ComicNaver', selector: '#sectionContWide > img[id^="content_image_"]',
        };
    }
    if (host === 'a-i-manga.com' && /^\/work\/[A-Za-z0-9]+\/?$/.test(pathname)) return {
        name: 'AIManga', selector: 'main img[alt^="Page "][src^="https://images.a-i-manga.com/comics/"]',
    };
    if (host === 'mangafire.to' && /^\/title\/[^/]+\/chapter\/\d+\/?$/.test(pathname)) return {
        name: 'MangaFire', selector: '.reader__strip > .reader__page > img.reader-img',
    };
    if (host === 'vw.mangaz.com' && /^\/virgo\/view\/\d+\/i:\d+\/?$/.test(pathname)) return {
        name: 'MangaZ', selector: '#viewer #book .page_unit.page_image > img.image',
    };
    if (host === 'manga-park.com' && /^\/title\/\d+\/?$/.test(pathname)) return {
        name: 'MangaPark', selector: '.viewer #minobi .manga-page-image > img.manga-image',
    };
    if (host === 'mgeko.cc' && /^\/reader\/[a-z]{2}\/[^/]+-chapter-[^/]+\/?$/.test(pathname)) return {
        name: 'Mgeko', selector: '#chapter-reader > img',
    };
    if (host === 'roliascan.com' && /^\/read\/[^/]+\/[^/]+\/?$/.test(pathname)) return {
        name: 'Rolia Scan', selector: '#chapter-images-container .comic-image-container img.comic-image',
    };
    if (host === 'mangadex.org' && /^\/chapter\/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}\/?$/.test(pathname)) return {
        name: 'MangaDex', selector: '.md--reader-pages .md--page img',
    };
    if (host === 'twicomi.com' && /^\/manga\/[^/]+\/\d+\/?$/.test(pathname)) return {
        name: 'Twitter Comic', selector: '.tweet-images .image img',
    };
    if (host === 'comic-fuz.com' && /^\/manga\/\d+\/?$/.test(pathname)
        || host === 'manga-one.com' && /^\/manga\/\d+\/chapter\/\d+\/?$/.test(pathname)
        || host === 'corocoro.jp' && /^\/chapter\/\d+\/viewer\/?$/.test(pathname)) return {
        name: host, selector: '[data-testid="placeholder"] > img[alt^="page_"]',
    };
    if (host === 'comic.mf-fleur.jp' && /^\/manga\/[^/]+\.html$/.test(pathname)) return {
        name: 'COMIC Fleur', selector: '.manga-content .manga-content__image img',
    };
    if (host === 'ac.qq.com' && /^\/ComicView\/index\/id\/\d+\/cid\/\d+\/?$/.test(pathname)) return {
        name: '腾讯动漫', selector: '#comicContain > li > img',
    };
    if (host === 'antbyw.com' && pathname === '/plugin.php') {
        const query = new URLSearchParams(search);
        if (query.get('id') === 'jameson_manhua' && query.get('a') === 'read'
            && /^\d+$/.test(query.get('kuid') ?? '') && /^\d+$/.test(query.get('zjid') ?? '')) return {
            name: 'Antbyw', selector: '#img_list > div > img[id^="img_"]',
        };
    }
    if (/(?:^|\.)mangafreak\.(?:net|me)$/.test(host) && /^\/Read\d+_[\w-]+_\d+\/?$/.test(pathname)) return {
        name: 'MangaFreak', selector: '.slideshow-container .mySlides img',
    };
    if (host === 'mn4u.net' && /^\/\d+\/\d+\/?$/.test(pathname)) return {
        name: 'Manga4u', selector: '.chapter-content #list-imga > img.chapter-img',
    };
    if (host === 'mgread.io' && /^\/manga\/[^/]+\/chapter-[^/]+\/?$/.test(pathname)) return {
        name: 'MG Read', selector: '#init-manga-single-chapter #chapter-content > img',
    };
    if (host === 'yymanhua.com' && /^\/m\d+\/?$/.test(pathname)) return {
        name: 'Yymanhua', selector: '#showimage #cp_img > img#cp_image',
    };
    if (host === 'mangarawjp.me' && /^\/manga\/[^/]+\/\d+(?:-\d+)?-wa\/?$/.test(pathname)) return {
        name: 'Mangaraw', selector: '#TopPage.ImageGallery img.img-fluid',
    };
    if (['speed-manga.com', 'speed-manga.net'].includes(host) && /^\/[^/]+-\d+(?:-\d+)?\/?$/.test(pathname)) return {
        name: 'Speed Manga', selector: 'article #readerarea img.ts-main-image',
    };
    if (host === 'jumptoon.com' && /^\/series\/[A-Z\d]+\/episodes\/\d+\/?$/.test(pathname)) return {
        name: 'Jumptoon', selector: ':not(*)', areaSelector: 'div[id] > canvas',
    };
    if (host === 'yanmaga.jp' && /^\/viewer\/comics\//.test(pathname)) return {
        name: 'YanMaga', selector: ':not(*)', areaSelector: '.pt-img img',
    };
    if (host === 'televikun-super-hero-comics.com' && /^\/rensai\/[^/]+\/episode-\d+\/?$/.test(pathname)) return {
        name: 'Televi-Kun Super Hero Comics', selector: ':not(*)', areaSelector: '.pt-img img',
    };
    if (host === 'kirapo.jp' && /^\/pt\/meteor\/[^/]+\/\d+\/viewer\/?$/.test(pathname)) return {
        name: 'Comic Meteor', selector: ':not(*)', areaSelector: '#content .pt-img img',
    };
    if (/(?:^|\.)smokingbehindthesupermarket\.com$/.test(host) && /^\/manga\/[^/]*chapter-[^/]+\/?$/.test(pathname)) return {
        name: 'Smoking Behind the Supermarket', selector: 'article #content .separator > img',
    };
    if (/(?:^|\.)(?:uzakichanmanga|kaijimanga)\.com$/.test(host)
        && /^\/manga\/[^/]*chapter-[^/]+\/?$/.test(pathname)) return {
        name: host, selector: 'article .entry-content img',
    };
    if (['rawkuma.net','rawkuma.com'].includes(host) && /^\/manga\/[^/]+\/chapter-[^/]+\/?$/.test(pathname)) return {
        name: 'Rawkuma', selector: 'section.mx-auto > section > img',
    };
    return null;
}
