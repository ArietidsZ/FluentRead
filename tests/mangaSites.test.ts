import {describe, expect, it} from 'vitest';
import {createMangaSiteRule, normalizeMangaSiteRules, normalizeMangaPrefetchPages, resolveMangaSite} from '@/src/core/config/manga';
import {isCatalogMangaHost, MANGA_SITE_DOMAINS, MANGA_SITE_CATALOG} from '@/src/core/config/mangaSiteCatalog';
import {resolveMangaReaderProfile} from '@/src/core/config/mangaReaderProfiles';
import {normalizeConfig} from '@/src/core/config/model';

describe('漫画阅读规则与持久偏好', () => {
    it('完整清单保留全部名称，已确认的别名进入域名匹配，未确认名称不虚构地址', () => {
        expect(MANGA_SITE_CATALOG).toHaveLength(235);
        expect(new Set(MANGA_SITE_CATALOG.map(site => site.name)).size).toBe(235);
        for (const site of MANGA_SITE_CATALOG) for (const host of site.hosts) {
            if (['pixiv.net','mangaplus.shueisha.co.jp'].includes(host)) continue;
            expect(isCatalogMangaHost(new URL(`https://${host}`).hostname)).toBe(true);
        }
        expect(MANGA_SITE_CATALOG.find(site => site.name === 'JinMangas')?.hosts).toEqual([]);
        expect(MANGA_SITE_CATALOG.find(site => site.name === 'KLMANGA')?.hosts).toContain('klmanga.my');
        expect(MANGA_SITE_CATALOG.find(site => site.name === 'Manga4u')?.hosts).toContain('mn4u.net');
    });
    it('核对后的图片和画布结构使用正文规则，复数章节路径也可自动检测', () => {
        expect(resolveMangaSite('https://weebcentral.com/chapters/01M43Q7CFX4XXN7WBVZH1MTEFS')).toMatchObject({selector:'#chapter-images img', requireContent:true});
        expect(resolveMangaSite('https://dynasty-scans.com/chapters/the_nth_encore')).toMatchObject({selector:'#reader #image img', requireContent:true});
        expect(resolveMangaSite('https://comic-days.com/episode/10834108156634732370')?.areaSelector).toContain('canvas.js-page-image');
        expect(resolveMangaSite('https://yanmaga.jp/viewer/comics/title')?.selector).toBe(':not(*)');
        expect(resolveMangaSite('https://unknown.example/chapters/2')?.selector).toContain('main img');
        expect(resolveMangaSite('https://comic-days.com.attacker.test/episode/2')?.areaSelector).not.toContain('.page-area');
    });
    it.each([
        ['https://www.comic-days.com/episode/10834108156634732370/', '.page-area img.page-image, .page-area img.js-page-image'],
        ['https://televikun-super-hero-comics.com/rensai/gokumonnadeshiko/episode-001', ':not(*)'],
        ['https://ww2.uzakichanmanga.com/manga/uzaki-chan-wa-asobitai-chapter-1/', 'article .entry-content img'],
        ['https://w9.kaijimanga.com/manga/kaiji-chapter-461/', 'article .entry-content img'],
        ['https://w9.smokingbehindthesupermarket.com/manga/title-chapter-1/', 'article #content .separator > img'],
        ['https://rawkuma.net/manga/bad-boys/chapter-13.413433/', 'section.mx-auto > section > img'],
        ['https://rawkuma.com/manga/bad-boys/chapter-1/', 'section.mx-auto > section > img'],
        ['https://mangadna.com/manga/omniscient-readers-viewpoint/chapter-311', '.read-manga .read-content > img'],
        ['https://comic-zenon.com/episode/12207421983509986288', '.page-area img.page-image, .page-area img.js-page-image'],
        ['https://championcross.jp/episodes/0a8f0118f1839', ':not(*)'],
        ['https://comic-ryu.jp/episodes/877cb803dd415', ':not(*)'],
        ['https://comic-growl.com/episodes/59451af9ac2bf', ':not(*)'],
        ['https://ichicomi.com/episode/2551460909671541131', '.page-area img.page-image, .page-area img.js-page-image'],
        ['https://asurascans.com/comics/copying-skills-with-affinity-3ec3b16f/chapter/8', '.select-none [data-page] > img'],
        ['https://asuracomic.net/comics/copying-skills-with-affinity-3ec3b16f/chapter/8/', '.select-none [data-page] > img'],
        ['https://arenascan.com/like-a-fiery-flame-chapter-98/', 'article #readerarea img'],
        ['https://kingofshojo.com/ill-save-a-decent-family-chapter-199/', 'article #readerarea img'],
        ['https://violetmanga.com/a-portrait-of-pride-chapter-12/', 'article #readerarea img'],
        ['https://violetscans.org/a-portrait-of-pride-chapter-12/', 'article #readerarea img'],
        ['https://www.mangaread.org/manga/title/chapter-17/', '.reading-content .page-break > img'],
        ['https://mangaforfree.net/manga/the-hero-is-the-secretary/chapter-14-raw/', '.reading-content .page-break > img'],
        ['https://manhwabuddy.com/manhwa/title/chapter-157/', '.reading-chapter .reading-content img'],
        ['https://vortexscans.org/series/got-a-gallery-in-the-wild/chapter-7', '.comic-images-wrapper > .image-container img'],
        ['https://rookie.shonenjump.com/series/TWpXKpYkRIE/TWpXKpYkRIM', '.page-area img.js-page-image'],
        ['https://www.webtoons.com/en/romance/chocolate-snow/s2-episode-58/viewer?title_no=6022&episode_no=58', '#_imageList > img._images'],
        ['https://www.mgeko.cc/reader/en/3qcf-title-chapter-1-eng-li/', '#chapter-reader > img'],
        ['https://roliascan.com/read/one-day-i-became-a-hatchling/ch28-327187/', '#chapter-images-container .comic-image-container img.comic-image'],
        ['https://mangadex.org/chapter/80da5ab1-b615-4564-9a19-0f1502dbde05', '.md--reader-pages .md--page img'],
        ['https://twicomi.com/manga/ngnchiikawa/2077704742067904960', '.tweet-images .image img'],
        ['https://rimacomiplus.jp/digitalmargaret/episodes/4a895d1d5884a', ':not(*)'],
        ['https://rimacomiplus.jp/episodes/fb291b54b795b', ':not(*)'],
        ['https://heros-web.com/episodes/a806742880560', ':not(*)'],
        ['https://younganimal.com/episodes/ff98f6eba590d', ':not(*)'],
        ['https://comic-fuz.com/manga/4018', '[data-testid="placeholder"] > img[alt^="page_"]'],
        ['https://manga-one.com/manga/28579/chapter/360007', '[data-testid="placeholder"] > img[alt^="page_"]'],
        ['https://comic.mf-fleur.jp/manga/cb245_01.html', '.manga-content .manga-content__image img'],
        ['https://ac.qq.com/ComicView/index/id/656723/cid/105748', '#comicContain > li > img'],
        ['https://jumptoon.com/series/JT00064/episodes/14436/', ':not(*)'],
        ['https://www.corocoro.jp/chapter/10580/viewer', '[data-testid="placeholder"] > img[alt^="page_"]'],
        ['https://youngchampion.jp/episodes/c35433f99f53d', ':not(*)'],
        ['https://www.antbyw.com/plugin.php?id=jameson_manhua&a=read&kuid=189309&zjid=1435867', '#img_list > div > img[id^="img_"]'],
        ['https://ww3.mangafreak.me/Read1_One_Piece_1', '.slideshow-container .mySlides img'],
        ['https://mangafreak.net/Read2_One_Piece_1/', '.slideshow-container .mySlides img'],
        ['https://mn4u.net/2360/296144/', '.chapter-content #list-imga > img.chapter-img'],
        ['https://mgread.io/manga/revenge-of-the-iron-blooded-sword-hound/chapter-1/', '#init-manga-single-chapter #chapter-content > img'],
        ['https://yymanhua.com/m7261/', '#showimage #cp_img > img#cp_image'],
        ['https://mangarawjp.me/manga/blue-lock/363-wa', '#TopPage.ImageGallery img.img-fluid'],
        ['https://mangarawjp.me/manga/blue-lock/346-5-wa/', '#TopPage.ImageGallery img.img-fluid'],
        ['https://speed-manga.net/the-mirror-legacy-0/', 'article #readerarea img.ts-main-image'],
        ['https://speed-manga.com/the-mirror-legacy-0-5/', 'article #readerarea img.ts-main-image'],
    ])('新增公开样本限定正文选择器 %s', (href, selector) => {
        expect(resolveMangaSite(href)).toMatchObject({selector,custom:false,requireContent:true});
    });
    it.each([
        ['asurascans.com','/comics/title'], ['asurascans.com','/comics/title/chapter/8/extra'],
        ['arenascan.com','/series/title'], ['kingofshojo.com','/title-chapter-1/extra'],
        ['mangaread.org','/manga/title'], ['mangaforfree.net','/manga/title/chapter-1/extra'],
        ['manhwabuddy.com','/manhwa/title'], ['vortexscans.org','/series/title'], ['ichicomi.com','/episode/123/extra'],
        ['asurascans.com.attacker.test','/comics/title/chapter/8'],
        ['rookie.shonenjump.com','/series/TWpXKpYkRIE'], ['webtoons.com','/en/romance/chocolate-snow/list'],
        ['mgeko.cc','/manga/title/'], ['roliascan.com','/read/title/ch28/extra'],
        ['mangadex.org','/chapter/name'], ['twicomi.com','/manga/author'],
        ['rimacomiplus.jp','/digitalmargaret/episodes/abc/extra'], ['younganimal.com','/magazine/episodes/abc'],
        ['comic-fuz.com','/manga/4018/extra'], ['manga-one.com','/manga/28579'],
        ['comic.mf-fleur.jp','/lineup_comic/'], ['ac.qq.com','/Comic/ComicInfo/id/656723'],
        ['jumptoon.com','/series/JT00064/'],
        ['corocoro.jp','/title/62'],
        ['youngchampion.jp','/episodes/c35433f99f53d/extra'],
        ['antbyw.com','/plugin.php'], ['antbyw.com','/other.php'],
        ['mangafreak.me','/Manga/One_Piece'], ['mangafreak.me.attacker.test','/Read1_One_Piece_1'],
        ['mn4u.net','/2360/'], ['mn4u.net','/2360/296144/extra'],
        ['mgread.io','/manga/title/'], ['yymanhua.com','/38yy/'], ['yymanhua.com','/m7261/extra'],
        ['mangarawjp.me','/manga/blue-lock'], ['mangarawjp.me','/manga/blue-lock/363-wa/extra'],
        ['speed-manga.net','/manga/the-mirror-legacy/'], ['speed-manga.net.attacker.test','/the-mirror-legacy-0/'],
        ['smokingbehindthesupermarket.com','/manga/title/'],
    ])('正文规则不将目录、相似域名和额外路径识别成章节 %s%s', (host,path) => {
        expect(resolveMangaReaderProfile(host,path)).toBeNull();
    });
    it('Antbyw 仅将指定漫画插件的数字章节查询识别成阅读页，参数次序和额外分页不影响匹配', () => {
        const query='?zjid=1435867&kuid=189309&a=read&id=jameson_manhua&page=2';
        expect(resolveMangaReaderProfile('antbyw.com','/plugin.php',query)?.name).toBe('Antbyw');
        for(const search of ['?id=other&a=read&kuid=1&zjid=2','?id=jameson_manhua&a=bofang&kuid=1&zjid=2',
            '?id=jameson_manhua&a=read&zjid=2','?id=jameson_manhua&a=read&kuid=1',
            '?id=jameson_manhua&a=read&kuid=title&zjid=2','?id=jameson_manhua&a=read&kuid=1&zjid=2/extra']) {
            expect(resolveMangaReaderProfile('antbyw.com','/plugin.php',search)).toBeNull();
        }
        expect(resolveMangaReaderProfile('antbyw.com.attacker.test','/plugin.php',query)).toBeNull();
    });
    it('提前翻译默认三页，显式零保留，限制窗口并拒绝损坏或旧类型', () => {
        for (const invalid of [undefined, null, '3', NaN, Infinity, {}, true]) expect(normalizeMangaPrefetchPages(invalid)).toBe(3);
        for (const [input, output] of [[0,0],[-1,0],[2.9,2],[5,5],[100,5]]) {
            expect(normalizeMangaPrefetchPages(input)).toBe(output);
            expect(normalizeConfig({imageTranslationMangaPrefetchPages:input}).imageTranslationMangaPrefetchPages).toBe(output);
        }
        expect(normalizeConfig({}).imageTranslationMangaPrefetchPages).toBe(3);
    });
    it('快速容量默认十二张且导入配置按一至二十四规范化',()=>{
        expect(normalizeConfig({}).imageTranslationMangaCachePages).toBe(12);
        for(const [input,output] of [[0,1],[3.9,3],[24,24],[999,24]])expect(normalizeConfig({imageTranslationMangaCachePages:input}).imageTranslationMangaCachePages).toBe(output);
    });
    it('网站目录精确匹配含国际化域名；目录表示检测范围，不把首页当成阅读页', () => {
        expect(new Set(MANGA_SITE_DOMAINS).size).toBe(MANGA_SITE_DOMAINS.length);
        for (const hostname of MANGA_SITE_DOMAINS) {
            expect(isCatalogMangaHost(hostname)).toBe(true);
            expect(isCatalogMangaHost(`reader.${hostname}`)).toBe(true);
            expect(isCatalogMangaHost(`${hostname}.attacker.test`)).toBe(false);
            expect(resolveMangaSite(`https://${hostname}/`)).toBeNull();
            expect(resolveMangaSite(`https://${hostname}/title/123`)).toMatchObject({generic:true});
        }
        expect(isCatalogMangaHost('localhost')).toBe(false);
        expect(isCatalogMangaHost('unrelated.example')).toBe(false);
    });
    it('Pixiv 作品 ID 限定正文图，支持语言路径与页码 hash；通用阅读页不需要手动配置', () => {
        for (const href of ['https://www.pixiv.net/artworks/150354216#1','https://pixiv.net/en/artworks/150354216/']) {
            const site=resolveMangaSite(href)!;expect(site.name).toBe('Pixiv');
            expect(site.selector).toContain('/150354216_p');expect(site.selector).not.toContain('img-thumbnail');
        }
        for (const href of ['https://pixiv.net/','http://pixiv.net/artworks/1','https://www.pixiv.net/artworks/name','https://pixiv.net.attacker.test/chapter/1']) expect(resolveMangaSite(href)).toBeNull();
        expect(resolveMangaSite('https://new-manga.example/chapter/123')?.selector).toContain('main img');
        expect(resolveMangaSite('https://example.com/article/123')).toBeNull();
    });
    it('旧配置保留普通图片关闭，同时启用漫画提示；永久关闭不会被归一化重开', () => {
        const old = normalizeConfig({});
        expect(old.disableImageTranslator).toBe(true);
        expect(old.imageTranslationMangaEnabled).toBe(true);
        expect(old.imageTranslationMangaPromptEnabled).toBe(true);
        expect(old.imageTranslationMangaDownloadConfirmed).toBe(false);
        expect(old.imageTranslationMangaSites).toEqual([]);
        expect(normalizeConfig({imageTranslationMangaPromptEnabled: false, imageTranslationMangaDownloadConfirmed: true})).toMatchObject({imageTranslationMangaPromptEnabled: false, imageTranslationMangaDownloadConfirmed: true});
        expect(normalizeConfig({imageTranslationMangaPromptEnabled: 'false', imageTranslationMangaDownloadConfirmed: 'true'} as never)).toMatchObject({imageTranslationMangaPromptEnabled: true, imageTranslationMangaDownloadConfirmed: false});
    });
    it.each(['https://mangaplus.shueisha.co.jp/viewer/1024050', 'https://mangaplus.shueisha.co.jp/viewer/1/?lang=en'])('内置阅读页识别 %s', href => {
        expect(resolveMangaSite(href)).toMatchObject({name: 'MANGA Plus', custom: false});
    });
    it.each(['invalid', 'file:///viewer/1', 'http://mangaplus.shueisha.co.jp/viewer/1', 'https://mangaplus.shueisha.co.jp/', 'https://u@mg.example/read', 'https://:p@mg.example/read', 'https://mangaplus.shueisha.co.jp:8888/viewer/1', 'https://mangaplus.shueisha.co.jp.attacker.test/viewer/1'])('拒绝无关地址 %s', href => expect(resolveMangaSite(href)).toBeNull());
    it.each(['invalid', 'file:///chapter/', 'https://u:p@example.com/chapter/', 'https://example.com:4321/chapter/'])('规则拒绝非网页或含凭据与端口 %s', href => expect(createMangaSiteRule(href, 'main img')).toBeNull());
    it.each(['', ' '.repeat(3), 'img'.repeat(100), 'div:has(img)'])('拒绝空或过重选择器 %s', selector => expect(createMangaSiteRule('https://example.com/read/', selector)).toBeNull());
    it('保留精确路径边界，允许手动 HTTP 阅读页，拒绝相似域名和路径', () => {
        const rule = createMangaSiteRule('https://example.com/read?lang=en#page2', ' main img ' )!;
        expect(rule).toEqual({hostname: 'example.com', pathPrefix: '/read', selector: 'main img'});
        expect(resolveMangaSite('https://example.com/read', [rule])?.custom).toBe(true);
        expect(resolveMangaSite('http://example.com/read/123', [rule])?.selector).toBe('main img');
        expect(resolveMangaSite('https://example.com/reader', [rule])).toBeNull();
        expect(resolveMangaSite('https://example.com.attacker/read', [rule])).toBeNull();
        const prefix = {...rule, pathPrefix: '/read/'};
        expect(resolveMangaSite('https://example.com/read/4', [prefix])?.custom).toBe(true);
    });
    it('过滤损坏规则、限定二十项、同域同路径去重并保留显式选择器覆盖', () => {
        const rule = {hostname: 'example.com', pathPrefix: '/read/', selector: 'article img'};
        expect(normalizeMangaSiteRules(null)).toEqual([]);
        expect(normalizeMangaSiteRules([null, 1, {}, {...rule, hostname: 2}, {...rule, pathPrefix: 2}, {...rule, pathPrefix: 'read'}, {...rule, selector: 2}, {...rule, hostname: 'example.com/evil'}, {...rule,pathPrefix:'/read/../evil/'}, {...rule, selector: ':has(img)'}, rule, rule])).toEqual([rule]);
        expect(normalizeMangaSiteRules(Array.from({length: 21}, (_, i) => ({...rule, pathPrefix: `/chapter/${i}/`})))).toHaveLength(20);
        const override = {hostname: 'mangaplus.shueisha.co.jp', pathPrefix: '/viewer/', selector: 'main img'};
        expect(resolveMangaSite('https://mangaplus.shueisha.co.jp/viewer/1024050', [override])).toMatchObject({custom: true, selector: 'main img'});
    });
});
