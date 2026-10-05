import {describe, expect, it} from 'vitest';
import {parseHTML} from 'linkedom';
import {createMangaSiteRule, normalizeMangaSiteRules, normalizeMangaPrefetchPages, resolveMangaSite} from '@/src/core/config/manga';
import {isCatalogMangaHost, MANGA_SITE_DOMAINS, MANGA_SITE_CATALOG} from '@/src/core/config/mangaSiteCatalog';
import {resolveMangaReaderProfile} from '@/src/core/config/mangaReaderProfiles';
import {normalizeConfig} from '@/src/core/config/model';

describe('漫画阅读规则与持久偏好', () => {
    it('哔哩哔哩数字章节只接入内容脚本可读的正文画布，排除二维码与其他容器', () => {
        const site=resolveMangaSite('https://manga.bilibili.com/mc30124/595886')!;
        expect(site).toMatchObject({name:'哔哩哔哩漫画',requireContent:true,selector:':not(*)'});expect(site.areaSelector).toBeUndefined();
        const {document}=parseHTML('<canvas id="qr" class="qr-code"></canvas><div class="images-container double-page"><div class="view-container primary-image"><div class="image-container"><div class="bullet-screen"><div class="bullet-container" id="turn"></div></div><canvas id="body"></canvas><dialog class="bullet-container" id="dialog"></dialog></div><div class="loading-hinter" id="loading"></div></div><div><canvas id="outside"></canvas></div></div><div class="bullet-screen"><div class="bullet-container" id="unrelated"></div></div><div class="loading-hinter" id="unrelated-loading"></div>');
        expect([...document.querySelectorAll(site.canvasSelector!)].map(canvas=>canvas.id)).toEqual(['body']);
        expect([...document.querySelectorAll(site.canvasInteractionSelector!)].map(element=>element.id)).toEqual(['turn']);
        expect([...document.querySelectorAll(site.loadingSelector!)].map(element=>element.id)).toEqual(['loading']);
        for(const path of ['/','/detail/mc30124','/mcword/595886','/mc30124/word','/mc30124/595886/extra'])expect(resolveMangaReaderProfile('manga.bilibili.com',path)).toBeNull();
        expect(resolveMangaReaderProfile('bilibili.com','/mc30124/595886')).toBeNull();expect(resolveMangaReaderProfile('manga.bilibili.com.attacker.test','/mc30124/595886')).toBeNull();
    });
    it('漫画站编号章节正文排除加载图与推荐，src 改为实际正文后加入选择', () => {
        const site=resolveMangaSite('https://www.manhuazhan.com/chapter/235990-51809.html')!;
        const {document}=parseHTML('<img id="banner" class="lazy" src="banner.jpg"><div id="ChapterContent"><p class="chapter chapterpic"><img id="body" class="lazy" src="https://s2.bzcdn.net/scomic/body.jpg"><img id="loading" class="lazy" src="/template/images/lazyload.gif"></p><aside><img id="ad" class="lazy" src="ad.jpg"></aside></div>');
        expect([...document.querySelectorAll(site.selector)].map(image=>image.id)).toEqual(['body']);document.querySelector('#loading')!.setAttribute('src','body-2.jpg');
        expect([...document.querySelectorAll(site.selector)].map(image=>image.id)).toEqual(['body','loading']);
        for(const path of ['/','/comic/235990','/chapter/235990.html','/chapter/word-1.html','/chapter/1-2.html/extra'])expect(resolveMangaReaderProfile('manhuazhan.com',path)).toBeNull();
        expect(resolveMangaReaderProfile('manhuazhan.com.attacker.test','/chapter/1-2.html')).toBeNull();
    });
    it('POIPIKU 数字单帖只接入主图片，推荐、头像和活动图不进入漫画队列', () => {
        const site=resolveMangaSite('https://poipiku.com/2/13202427.html')!;
        const {document}=parseHTML('<img id="avatar" class="IllustItemThumbImg"><section id="IllustItemList"><div class="IllustItem Upload"><a class="IllustItemThumb"><img id="body" class="IllustItemThumbImg"></a></div><div class="RelatedItemList"><a class="IllustItemThumb"><img id="related" class="IllustItemThumbImg"></a></div><div class="IllustItem"><aside><img id="event" class="IllustItemThumbImg"></aside></div></section>');
        expect([...document.querySelectorAll(site.selector)].map(image=>image.id)).toEqual(['body']);
        for(const path of ['/','/2/','/comic/','/word/13202427.html','/2/word.html','/2/13202427.html/extra'])expect(resolveMangaReaderProfile('poipiku.com',path)).toBeNull();
        expect(resolveMangaReaderProfile('poipiku.com.attacker.test','/2/13202427.html')).toBeNull();
    });
    it.each(['/lucid/lucid2/need1','/lucid/lucid22/lucid22thattimei.html','/lucid/lucid24.88/lucid24.88','/lucid/extra/gettingstronger.html'])('Ranfren 静态路径 %s 仅选直接显示的正文，封面和预览链接排除',path=>{
        const site=resolveMangaSite(`https://ranfren.neocities.org${path}`)!;
        const {document}=parseHTML('<table><tr><td><img id="cover" src="https://ranfren.neocities.org/lucid/cover.jpg"></td></tr></table><center><img id="body" src="https://ranfren.neocities.org/lucid/lucid2/lucid2-1.jpg"><a><img id="preview" src="https://ranfren.neocities.org/lucid/lucid2/preview.jpg"></a><img id="logo" src="https://ranfren.neocities.org/art/logo.png"></center>');
        expect([...document.querySelectorAll(site.selector)].map(image=>image.id)).toEqual(['body']);
        for(const invalid of ['/','/comics','/lucid/vol1lucid','/lucid/extra/unconfirmed','/lucid/lucid2/need1/extra','/lucid/lucidword/need1','/lucid/lucid2/need1.png'])expect(resolveMangaReaderProfile('ranfren.neocities.org',invalid)).toBeNull();
        expect(resolveMangaReaderProfile('other.neocities.org',path)).toBeNull();
    });
    it('MANGA Million 语言路径与编号章节仅选择正文页，排除阅读指南、推荐封面与无编号图片', () => {
        const site = resolveMangaSite('https://mangamillion.shueisha.co.jp/zh-CN/title/1/chapter/66193')!;
        expect(site).toMatchObject({name: 'MANGA Million', requireContent: true});
        const {document} = parseHTML('<img id="guide" class="G54Y0W_page" alt="page_0"><div class="eAvsta_slide_container"><div class="-KWKsa_spread"><div class="_b9ZNa_page_container"><div class="__wfZG_placeholder"><img id="body" class="G54Y0W_page" alt="page_1" width="694" height="1080"><img id="ad" class="G54Y0W_page" alt="advertisement"></div><img id="outside" class="G54Y0W_page" alt="page_2"></div></div></div>');
        expect([...document.querySelectorAll(site.selector)].map(image => image.id)).toEqual(['body']);
        expect(resolveMangaReaderProfile('mangamillion.shueisha.co.jp', '/en/title/1/chapter/2/')).toBeTruthy();
        for (const path of ['/', '/zh-CN', '/zh-CN/title/1', '/zh-CN/title/one/chapter/2', '/zh-CN/title/1/chapter/2/extra']) expect(resolveMangaReaderProfile('mangamillion.shueisha.co.jp', path)).toBeNull();
        expect(resolveMangaReaderProfile('mangamillion.shueisha.co.jp.attacker.test', '/zh-CN/title/1/chapter/2')).toBeNull();
    });
    it('PASH UP 仅选择当前屏的公开正文画布，排除离屏缓冲、加载图与交互层', () => {
        const site = resolveMangaSite('https://pash-up.jp/viewer/viewer.html?cid=public-chapter')!;
        expect(site).toMatchObject({name: 'PASH UP', selector: ':not(*)', requireContent: true});
        const {document} = parseHTML('<div id="viewer"><div id="renderer"><canvas id="dummy"></canvas><div id="viewport0"><canvas id="buffer"></canvas></div><div id="viewport1" class="currentScreen"><canvas id="body"></canvas></div><div id="frontScreen"><canvas id="front"></canvas></div></div><img class="loadingImage"></div><div class="currentScreen"><canvas id="outside"></canvas></div>');
        expect([...document.querySelectorAll(site.canvasSelector!)].map(canvas => canvas.id)).toEqual(['body']);
        document.querySelector('#viewport1')!.className = '';document.querySelector('#viewport0')!.className = 'currentScreen';
        expect([...document.querySelectorAll(site.canvasSelector!)].map(canvas => canvas.id)).toEqual(['buffer']);
        expect(site.areaSelector).toBe(site.canvasSelector);expect(document.querySelectorAll(site.selector)).toHaveLength(0);
        for (const path of ['/', '/content/00000001', '/viewer/other.html', '/viewer/viewer.html/extra']) expect(resolveMangaReaderProfile('pash-up.jp', path)).toBeNull();
        expect(resolveMangaReaderProfile('pash-up.jp.attacker.test', '/viewer/viewer.html')).toBeNull();
    });
    it.each(['/', '/comic/000', '/comic/742/'])('Countdown 主页及数字阅读页 %s 只接入正文，排除 logo 与赞助图', path => {
        const site = resolveMangaSite(`https://www.ctccomic.com${path}`)!;
        expect(site).toMatchObject({name: 'Countdown to Countdown', custom: false, requireContent: true});
        const {document} = parseHTML('<header><a id="logo"><img id="site-logo" width="645" height="565"></a></header><div id="middle-left"><div id="cc-comicbody"><a><img id="cc-comic" width="900" height="1331"></a><aside><img id="sponsor"></aside></div></div><img id="other" width="900" height="1331">');
        expect([...document.querySelectorAll(site.selector)].map(image => image.id)).toEqual(['cc-comic']);
        for (const invalid of ['/comic/archive', '/comic/rss', '/about', '/comic/word', '/comic/000/extra']) expect(resolveMangaReaderProfile('ctccomic.com', invalid)).toBeNull();
        for (const fake of ['ctccomic.com.attacker.test', 'fakectccomic.com']) expect(resolveMangaReaderProfile(fake, path)).toBeNull();
    });
    it('Orchisasia 编号章节正文规则排除导航与推荐，保留作者后记与小数章节边界', () => {
        const site = resolveMangaSite('https://www.orchisasia.org/comic/story/0166-chapter-163-5-creators-note/')!;
        expect(site).toMatchObject({name: 'Orchisasia', custom: false, requireContent: true});
        const {document} = parseHTML('<header><img id="logo"></header><div class="read-container"><div class="reading-content"><div class="page-break no-gaps"><img id="body" class="wp-manga-chapter-img" width="720" height="5120"></div><aside><img id="ad" class="wp-manga-chapter-img"></aside></div></div><div class="page-break"><img id="outside" class="wp-manga-chapter-img"></div>');
        expect([...document.querySelectorAll(site.selector)].map(image => image.id)).toEqual(['body']);
        expect(resolveMangaReaderProfile('orchisasia.org', '/comic/story/0001-chapter-1.5')).toBeTruthy();
        for (const path of ['/', '/comic/story', '/comic/story/chapter-1', '/comic/story/0001-chapter-word', '/comic/story/0001-chapter-1/extra']) expect(resolveMangaReaderProfile('orchisasia.org', path)).toBeNull();
        expect(resolveMangaReaderProfile('orchisasia.org.attacker.test', '/comic/story/0001-chapter-1')).toBeNull();
    });
    it.each([
        ['qimanga.com', 'Qi Manga', '<header><img id="logo" class="r-page-img"></header><app-reader><div class="r-strip"><div class="r-page" data-page="1"><img id="body" class="r-page-img" width="800" height="15525"></div><div class="r-page"><img id="placeholder" class="r-page-img"></div><aside><img id="ad" class="r-page-img"></aside></div></app-reader><div class="r-page" data-page="2"><img id="cover" class="r-page-img"></div>'],
        ['nyxscans.com', 'Nyx Scans', '<header><img id="cover"></header><div class="comic-body-container"><div class="comic-images-wrapper reader-mode-strip"><figure class="image-container"><img id="body" width="800" height="10000"></figure><aside><img id="ad"></aside></div></div><figure class="image-container"><img id="outside"></figure>'],
        ['omegascans.org', 'Omega Scans', '<div class="lg:container"><a><img id="banner" class="block object-contain"></a><div class="flex flex-col items-center justify-center overflow-hidden lg:px-0"><div class="relative flex w-full justify-center"><img id="body" class="block object-contain" width="720" height="12565"></div><aside><img id="ad" class="block object-contain"></aside></div></div><div class="relative flex w-full justify-center"><img id="outside" class="block object-contain"></div>'],
    ])('%s 已显示长条正文规则排除广告、外部推荐并限制章节边界', (host, name, html) => {
        const site = resolveMangaSite(`https://${host}/series/work/chapter-96`)!;
        expect(site).toMatchObject({name, requireContent: true, custom: false});
        const {document} = parseHTML(html);
        expect([...document.querySelectorAll(site.selector)].map(image => image.id)).toEqual(['body']);
        expect(resolveMangaReaderProfile(`www.${host}`, '/series/work/chapter-1.5/')).toBeTruthy();
        for (const path of ['/', '/series/work', '/series/work/chapter-one', '/series/work/chapter-96/extra']) expect(resolveMangaReaderProfile(host, path)).toBeNull();
        for (const fake of [`${host}.attacker.test`, `fake${host}`]) expect(resolveMangaReaderProfile(fake, '/series/work/chapter-96')).toBeNull();
    });
    it('MangaLove 已显示不可读画布仅提供圈选，排除商店标识、广告画布和作品封面', () => {
        const site = resolveMangaSite('https://mangalove.me/viewer/79762')!;
        expect(site).toMatchObject({name: 'MangaLove', selector: ':not(*)', requireContent: true, custom: false});
        const {document} = parseHTML('<body id="viewerBody"><div class="topMenu"><canvas id="ad"><img id="logo"></canvas></div><div class="viewer vertical"><div class="imgWrap"><canvas id="body" width="760" height="1100"></canvas></div><aside><canvas id="other"></canvas></aside></div><div class="imgWrap"><canvas id="outside"></canvas></div></body>');
        expect([...document.querySelectorAll(site.areaSelector!)].map(canvas => canvas.id)).toEqual(['body']);
        expect([...document.querySelectorAll(site.selector)]).toEqual([]);
        expect(resolveMangaReaderProfile('www.mangalove.me', '/viewer/79762/')).toBeTruthy();
        for (const path of ['/', '/comic/3333', '/viewer/word', '/viewer/79762/extra']) expect(resolveMangaReaderProfile('mangalove.me', path)).toBeNull();
        expect(resolveMangaReaderProfile('mangalove.me.attacker.test', '/viewer/79762')).toBeNull();
    });
    it('MangaYun 正文排除加载吉祥物、背景搜索封面与章节广告',()=>{
        const site=resolveMangaSite('https://mangayun.com/read/Book_A/Chapter-1')!;
        expect(site).toMatchObject({name:'MangaYun',requireContent:true,custom:false});
        const {document}=parseHTML('<main><img id="search-cover" class="reader-page"></main><div class="reader" role="dialog"><div class="reader-scroll"><div class="reader-page-wrap"><div class="reader-hold"><img id="mascot" class="reader-hold-mascot"></div><img id="body" class="reader-page"></div><aside><img id="ad" class="reader-page"></aside></div></div><div class="reader"><div class="reader-scroll"><div class="reader-page-wrap"><img id="unrelated" class="reader-page"></div></div></div>');
        expect([...document.querySelectorAll(site.selector)].map(e=>e.id)).toEqual(['body']);
        expect(resolveMangaReaderProfile('www.mangayun.com','/read/Book_A/Chapter-1/')).toBeTruthy();
    });
    it('MangaYun 只接受公开阅读路由的两段标识和精确域名',()=>{
        for(const path of ['/','/s/keyword','/read/Book_A','/read/Book_A/Chapter-1/extra','/read/Book.A/Chapter-1'])expect(resolveMangaReaderProfile('mangayun.com',path)).toBeNull();
        for(const host of ['mangayun.com.attacker.test','fakemangayun.com'])expect(resolveMangaReaderProfile(host,'/read/Book_A/Chapter-1')).toBeNull();
    });
    it('Booklive 公开试读分片仅提供圈选并排除说明、广告与商店标识',()=>{
        const url='https://booklive.jp/bviewer/s/';
        const site=resolveMangaSite(url)!;
        expect(site).toMatchObject({name:'Booklive',selector:':not(*)',requireContent:true,custom:false});
        const {document}=parseHTML('<img id="store"><div id="tips"><img id="manual"></div><div id="content" class="pages"><div id="content-p1"><div class="pt-img"><div><img id="slice-1"></div><div><img id="slice-2"></div></div></div><aside><div class="pt-img"><img id="ad"></div></aside></div><div class="pt-img"><img id="cover"></div>');
        expect([...document.querySelectorAll(site.areaSelector!)].map(e=>e.id)).toEqual(['slice-1','slice-2']);
        expect([...document.querySelectorAll(site.selector)]).toEqual([]);
        expect(resolveMangaReaderProfile('www.booklive.jp','/bviewer/s')).toBeTruthy();
        for(const host of ['booklive.jp.attacker.test','fakebooklive.jp'])expect(resolveMangaReaderProfile(host,'/bviewer/s/')).toBeNull();
        for(const path of ['/','/product/index/title_id/20017284/vol_no/001','/bviewer/','/bviewer/s/core/manual.html'])expect(resolveMangaReaderProfile('booklive.jp',path)).toBeNull();
    });
    it.each([
        ['mangahub.ru','/read/962303','reader-viewer reader-scan.reader-viewer-scan > img.reader-viewer-img',
            '<header><img id="logo" class="reader-viewer-img"></header><reader-viewer><reader-scan class="reader-viewer-scan"><img id="body" class="reader-viewer-img"></reader-scan><aside><img id="cover" class="reader-viewer-img"></aside></reader-viewer>',
            ['/','/manga/title','/read/title','/read/962303/extra']],
        ['rinkocomics.com','/chapter/the-crazy-young-masters-daily-life-is-a-scheme-chapter-5/','.chapter-images-section .images-flow > img.chapter-image[data-page]',
            '<header><img id="logo" class="chapter-image" data-page="1"></header><div class="chapter-images-section"><div class="images-flow"><img id="body" class="chapter-image" data-page="1"><img id="ad"><a><img id="linked" class="chapter-image" data-page="2"></a></div></div>',
            ['/','/comic/title','/chapter/title','/chapter/title-chapter-one','/chapter/title-chapter-5/extra']],
        ['rawdex.net','/manga/keep-likes-private/4/','section.rdx-reader .rdx-reader-content img.wp-manga-chapter-img',
            '<header><img id="logo" class="wp-manga-chapter-img"></header><section class="rdx-reader"><div class="rdx-reader-content"><figure><img id="body" class="wp-manga-chapter-img"></figure><img id="ad"></div><aside><img id="cover" class="wp-manga-chapter-img"></aside></section>',
            ['/','/manga/title','/manga/title/latest','/manga/title/4/extra']],
        ['raw1001.net','/manga/zhou-shu-hui-zhan001/di271hua','#chapterContent .separator > a.readImg > img',
            '<header><img id="logo"></header><div id="chapterContent"><div class="separator"><a class="readImg"><img id="body"></a><img id="ad"></div></div><aside><div class="separator"><a class="readImg"><img id="cover"></a></div></aside>',
            ['/','/home','/manga/title','/manga/title/diwordhua','/manga/title/di271hua/extra']],
    ])('%s 已显示正文规则排除封面与广告并限制章节边界', (host,path,selector,html,invalidPaths)=>{
        expect(resolveMangaSite(`https://${host}${path}`)).toMatchObject({selector,requireContent:true,custom:false});
        const {document}=parseHTML(html as string);
        expect([...document.querySelectorAll(selector as string)].map(e=>e.id)).toEqual(['body']);
        for(const invalidPath of invalidPaths as string[])expect(resolveMangaReaderProfile(host as string,invalidPath)).toBeNull();
        for(const invalidHost of [`${host}.attacker.test`,`fake${host}`])expect(resolveMangaReaderProfile(invalidHost,path as string)).toBeNull();
    });
    it('小数章节仍限定已核对阅读路径',()=>{
        expect(resolveMangaReaderProfile('www.mangahub.ru','/read/123/')).toBeTruthy();
        expect(resolveMangaReaderProfile('rinkocomics.com','/chapter/title-chapter-1.5')).toBeTruthy();
        expect(resolveMangaReaderProfile('rawdex.net','/manga/title/1.5')).toBeTruthy();
        expect(resolveMangaReaderProfile('raw1001.net','/manga/title/di1.5hua')).toBeTruthy();
    });
    it.each([
        ['v5.luvyaa.co','/i-shall-master-this-family-chapter-236/','article #readerarea > img.ts-main-image',
            '<article><a><img id="ad" class="ts-main-image"></a><div id="readerarea"><img id="body" class="ts-main-image"><img id="other"></div></article>',
            ['/','/top-reader/','/i-shall-master-this-family/','/title-chapter-one/','/title-chapter-236/extra']],
        ['manhwaweb.com','/leer/el-rey-caballero-de-cabello-negro_1786828095885-1_01','div[class~="md:max-w-3xl"].m-auto > img.w-full',
            '<header><img id="music" class="w-full"></header><div class="md:max-w-3xl m-auto"><img id="body" class="w-full"><a><img id="ad" class="w-full"></a></div><aside><img id="cover" class="w-full"></aside>',
            ['/','/manhwa/title_1786828095885','/leer/title','/leer/title_1786828095885-1','/leer/title_1786828095885-1_01/extra']],
        ['klz9.com','/the-exiled-reincarnated-heavy-knight-is-unrivaled-in-game-knowledge-chapter-181.html','main .select-none div.transition-all > img.max-w-3xl',
            '<header><img id="logo" class="max-w-3xl"></header><main><div class="select-none"><div class="transition-all"><img id="body" class="max-w-3xl"><a><img id="ad" class="max-w-3xl"></a></div></div></main><aside><img id="cover" class="max-w-3xl"></aside>',
            ['/','/title.html','/title-chapter-one.html','/title-chapter-181','/title-chapter-181.html/extra']],
    ])('公开章节 %s 只匹配正文容器并保持域名、章节边界', (host,path,selector,html,invalidPaths) => {
        expect(resolveMangaSite(`https://${host}${path}`)).toMatchObject({selector,requireContent:true,custom:false});
        const {document}=parseHTML(html as string);
        expect([...document.querySelectorAll(selector as string)].map(e=>e.id)).toEqual(['body']);
        for(const invalidPath of invalidPaths as string[])expect(resolveMangaReaderProfile(host as string,invalidPath)).toBeNull();
        for(const invalidHost of [`${host}.attacker.test`,`fake${host}`])expect(resolveMangaReaderProfile(invalidHost,path as string)).toBeNull();
    });
    it('Luvyaa 显式公开阅读链接与正常跳转登记到原目录名称',()=>{
        expect(MANGA_SITE_CATALOG.find(site=>site.name==='luvyaa.my.id')?.hosts).toEqual(['luvyaa.my.id','luvyaa.co','v5.luvyaa.co']);
        expect(isCatalogMangaHost('v5.luvyaa.co')).toBe(true);
        expect(isCatalogMangaHost('luvyaa.co.attacker.test')).toBe(false);
        expect(resolveMangaReaderProfile('v5.luvyaa.co','/title-chapter-1.5')).toBeTruthy();
        expect(resolveMangaReaderProfile('manhwaweb.com','/leer/title_123-1.5_01/')).toBeTruthy();
        expect(resolveMangaReaderProfile('klz9.com','/title-chapter-1.5.html')).toBeTruthy();
    });
    it('GlobalComix 受限图片提供圈选并限定公开章节路径与正文容器', () => {
        const release='be3701bf-70cc-43e8-b16d-3f168abaf799', base=`/read/${release}`;
        for(const path of [base,`${base}/`,`${base}/1`,`${base}/2/`,`${base}/1/2`])expect(resolveMangaSite(`https://www.globalcomix.com${path}`)).toMatchObject({selector:':not(*)',areaSelector:'#readerReleasePages #horizontalReader img.chakra-image',requireContent:true,custom:false});
        const {document}=parseHTML('<img id="cover" class="chakra-image"><div id="readerReleasePages"><div id="horizontalReader"><div><img id="full" class="chakra-image"></div><div id="p2pReader"><div><div><img id="panel" class="chakra-image"></div></div></div></div><img id="recommended" class="chakra-image"></div>');
        expect([...document.querySelectorAll(resolveMangaSite(`https://globalcomix.com${base}`)!.areaSelector!)].map(e=>e.id)).toEqual(['full','panel']);
        expect(resolveMangaReaderProfile('globalcomix.com.attacker.test',`${base}/1`)).toBeNull();
        for(const path of ['/c/title','/read/title',`${base}/0`,`${base}/1/0`,`${base}/1/2/3`,`${base}/extra`])expect(resolveMangaReaderProfile('globalcomix.com',path)).toBeNull();
    });
    it('Manhuaplus 章节正文排除站点标识、关联推荐和非章节路径', () => {
        const href='https://www.manhuaplus.org/manga/apotheosis/chapter-1';
        const profile=resolveMangaSite(href)!;
        expect(profile).toMatchObject({selector:'#chapterContent .separator > a.readImg > img',requireContent:true,custom:false});
        const {document}=parseHTML('<header><img id="logo"></header><div id="chapterContent"><div class="separator"><a class="readImg"><img id="page"></a><img id="ad"></div></div><aside><div class="separator"><a class="readImg"><img id="recommend"></a></div></aside>');
        expect([...document.querySelectorAll(profile.selector)].map(e=>e.id)).toEqual(['page']);
        expect(resolveMangaReaderProfile('manhuaplus.org.attacker.test','/manga/apotheosis/chapter-1')).toBeNull();
        for(const path of ['/manga/apotheosis','/manga/apotheosis/trailer','/manga/apotheosis/chapter-1/extra'])expect(resolveMangaReaderProfile('manhuaplus.org',path)).toBeNull();
    });
    it('MangaBall 正常跳转现用域名保留目录名称且限制域名边界', () => {
        expect(MANGA_SITE_CATALOG.find(site=>site.name==='mangaball.net')?.hosts).toEqual(['mangaball.net','mangaball.com']);
        expect(isCatalogMangaHost('mangaball.com')).toBe(true);
        expect(isCatalogMangaHost('mangaball.com.attacker.test')).toBe(false);
        expect(isCatalogMangaHost('fakemangaball.com')).toBe(false);
    });
    it.each([
        ['https://rawotaku.com/read/%E3%83%96%E3%83%AB%E3%83%BC%E3%83%AD%E3%83%83%E3%82%AF/ja/chapter-1-raw/', '#vertical-content .iv-card > img.image-vertical'],
        ['https://www.manhwaden.com/manga/portrait-of-pride/chapter-15/', '.reading-content .text-left > p > img'],
        ['https://manhwato.com/manhwa/i-want-to-work-quietly-raw/chapter-42-ch282329', '.chapter-content .page-chapter > img'],
        ['https://toondex.co/comics/stop-smoking-frgsok/chapter-1/', '.max-w-5xl > .my-6 > img[id^="row-"]'],
        ['https://mechacomic.jp/viewer/index.html?ver=1&viewer=vertical', '[class*="VerticalViewerstyles__PageList-"] [class*="PageContainer__ImageOrigin-"] > img[class*="PageContainer__Image-"]'],
    ])('新增章节规则在已确认路径限定正文，仍拒绝冒充域名和额外路径 %s',(href,selector)=>{
        expect(resolveMangaSite(href)).toMatchObject({selector,requireContent:true,custom:false});
        const url=new URL(href);
        expect(resolveMangaReaderProfile(`${url.hostname}.attacker.test`,url.pathname,url.search)).toBeNull();
        expect(resolveMangaReaderProfile(url.hostname,`${url.pathname}/extra`,url.search)).toBeNull();
    });
    it.each([
        ['rawotaku.com','/read/title/',''], ['rawotaku.com','/read/title/ja/',''],
        ['rawotaku.com','/read/title/japanese/chapter-1-raw/',''],
        ['manhwaden.com','/manga/title/',''], ['manhwato.com','/manhwa/title/',''],
        ['toondex.co','/comics/title/',''], ['toondex.co','/comics/title/trailer/',''],
        ['mechacomic.jp','/books/245496','?viewer=vertical'],
        ['mechacomic.jp','/viewer/index.html',''], ['mechacomic.jp','/viewer/index.html','?viewer=raster'],
        ['mechacomic.jp','/viewer/','?viewer=vertical'],
    ])('章节目录、其他阅读模式和缺参不套用新正文规则 %s%s%s',(host,path,search)=>{
        expect(resolveMangaReaderProfile(host,path,search)).toBeNull();
    });
    it('新增正文容器排除封面、同容器广告链接、透明交互图和阅读器外的图片',()=>{
        const {document}=parseHTML(`<img id="cover">
            <div id="vertical-content"><div class="iv-card"><img id="raw" class="image-vertical"><a><img id="raw-ad" class="image-vertical"></a></div></div><img class="image-vertical" id="outside-raw">
            <div class="reading-content"><div class="text-left"><p><img id="den"><a><img id="den-ad"></a></p></div><img id="den-cover"></div>
            <div class="chapter-content"><div class="page-chapter"><img id="to"><a><img id="to-ad"></a></div><img id="to-cover"></div>
            <div class="max-w-5xl"><div class="my-6"><img id="row-1"><img id="dex-ad"><a><img id="row-ad"></a></div></div><img id="row-outside">
            <div class="VerticalViewerstyles__PageList-sc-list"><div class="PageContainer__ImageOrigin-sc-origin"><img id="mecha" class="PageContainer__Image-sc-body"><img id="dummy" class="DummyImage__StyledDummyImage-sc-overlay"><a><img id="mecha-ad" class="PageContainer__Image-sc-body"></a></div></div><div class="PageContainer__ImageOrigin-sc-origin"><img id="outside-mecha" class="PageContainer__Image-sc-body"></div>`);
        for(const [href,ids] of [
            ['https://rawotaku.com/read/title/ja/chapter-1-raw/',['raw']],
            ['https://manhwaden.com/manga/title/chapter-1/',['den']],
            ['https://manhwato.com/manhwa/title/chapter-1/',['to']],
            ['https://toondex.co/comics/title/chapter-1/',['row-1']],
            ['https://mechacomic.jp/viewer/index.html?viewer=vertical',['mecha']],
        ] as const)expect([...document.querySelectorAll(resolveMangaSite(href)!.selector)].map(e=>e.id)).toEqual(ids);
    });
    it('两种长条正文规则排除阅读器外的封面与同容器广告链接',()=>{
        const {document}=parseHTML('<img id="cover"><div id="reader-scroll-inner"><div><img id="atsu-page"><a><img id="atsu-ad"></a></div></div><div class="reading-chapter"><div class="reading-img"><div class="reading-content"><p><img id="toon-page"><a><img id="toon-ad"></a></p></div></div></div><div class="reading-content"><p><img id="outside"></p></div>');
        expect([...document.querySelectorAll(resolveMangaSite('https://atsu.moe/read/9x6iM/KAXiwn')!.selector)].map(e=>e.id)).toEqual(['atsu-page']);
        expect([...document.querySelectorAll(resolveMangaSite('https://toongod.cc/webtoon/title/chapter-1/')!.selector)].map(e=>e.id)).toEqual(['toon-page']);
    });
    it.each([
        ['https://atsu.moe/read/9x6iM/KAXiwn', '#reader-scroll-inner > div > img'],
        ['https://toongod.cc/webtoon/chronicles-of-the-demon-faction/chapter-191/', '.reading-chapter .reading-img .reading-content > p > img'],
        ['https://www.animatebookstore.com/viewer/?product_id=2108124', ':not(*)'],
        ['https://www.cmoa.jp/bib/speedreader/?cid=0000068502_jp_0001&u0=1', ':not(*)'],
        ['https://tapas.io/episode/3958118', '[id^="episode-"].episode-unit .viewer__body img.content__img'],
        ['https://tapas.io/series/the-little-spy-who-kidnapped-the-villain/', '[id^="episode-"].episode-unit .viewer__body img.content__img'],
        ['https://page.kakao.com/content/56566288/viewer/56605697/', '.image-container > img[src^="https://page-edge.kakao.com/sdownload/resource?"]'],
        ['https://manhwaclub.net/manga/i-want-to-work-quietly-02/chapter-42-raw/', '.reading-content .page-break > img.wp-manga-chapter-img'],
        ['https://www.twbzmg.com/comic/chapter/title/0_271.html', '.chapter-main .comic-contain amp-img[id^="chapter-img-"] > img'],
        ['https://www.twmanga.com/comic/chapter/title/0_271.html', '.chapter-main .comic-contain amp-img[id^="chapter-img-"] > img'],
        ['https://cn.twbzmg.com/comic/chapter/title/0_271.html', '.chapter-main .comic-contain amp-img[id^="chapter-img-"] > img'],
        ['https://global.manga-up.com/manga/164/14826/', '[data-testid="placeholder"] > img[alt^="page_"]'],
    ])('公开试读和章节匹配正文而非商品封面 %s', (href, selector) => {
        expect(resolveMangaSite(href)).toMatchObject({selector, requireContent:true});
        const url=new URL(href);
        expect(resolveMangaReaderProfile(`${url.hostname}.attacker.test`,url.pathname,url.search)).toBeNull();
        expect(resolveMangaReaderProfile(url.hostname,`${url.pathname}/extra`,url.search)).toBeNull();
    });
    it.each([
        ['atsu.moe','/manga/9x6iM',''], ['atsu.moe','/read/name/',''],
        ['toongod.cc','/webtoon/title/',''], ['toongod.cc','/webtoon/title/trailer/',''],
        ['animatebookstore.com','/viewer/',''], ['animatebookstore.com','/viewer/','?product_id=sample'],
        ['animatebookstore.com','/products/detail.php','?product_id=2108124'],
        ['cmoa.jp','/bib/speedreader/',''], ['cmoa.jp','/bib/speedreader/','?cid=0001_jp_title'],
        ['cmoa.jp','/title/68502/','?cid=0000068502_jp_0001'],
        ['tapas.io','/episode/title',''], ['tapas.io','/series/title/info',''],
        ['page.kakao.com','/content/56566288/',''], ['page.kakao.com','/content/56566288/viewer/trailer/',''],
        ['manhwaclub.net','/manga/title/',''], ['twmanga.com','/comic/title/',''],
        ['twbzmg.com','/comic/chapter/title/0_name.html',''], ['global.manga-up.com','/manga/164/',''],
    ])('不匹配试读缺参、目录及相似章节路径 %s%s%s', (host,path,search) => {
        expect(resolveMangaReaderProfile(host,path,search)).toBeNull();
    });
    it('公开正文选择器排除试读透明占位、推荐封面、广告和无关下载图片', () => {
        const {document}=parseHTML(`<img id="logo"><img class="blank-img" id="placeholder">
          <div class="view-sheet-container"><div class="view-sheet"><div class="content zoomable"><canvas id="animate-body"></canvas><img class="blank-img" id="animate-interaction"></div></div><canvas id="outside-canvas"></canvas></div>
          <div id="content"><div class="pt-img"><img id="fragment"></div></div><div class="pt-img"><img id="ad-fragment"></div>
          <div id="episode-1" class="episode-unit"><article class="viewer__body"><img class="content__img" id="tapas-body"></article><img class="content__img" id="tapas-cover"></div>
          <div class="image-container"><img id="kakao-body" src="https://page-edge.kakao.com/sdownload/resource?filename=public.jpeg"><img id="kakao-ad" src="https://advert.example/promotion.jpeg"></div>
          <div class="reading-content"><div class="page-break"><img id="manhwa-body" class="wp-manga-chapter-img"><img id="manhwa-ad"></div></div>
          <div class="chapter-main"><div class="comic-contain"><amp-img id="chapter-img-0-0"><img id="baozi-body"></amp-img><amp-img id="recommend"><img id="baozi-cover"></amp-img></div></div>
          <div data-testid="placeholder"><img id="manga-up-body" alt="page_0"><img id="manga-up-ad" alt="App promotion"></div>`);
        const matched=(href:string,key:'selector'|'canvasSelector'|'areaSelector'='selector') => [...document.querySelectorAll(resolveMangaSite(href)![key]!)].map(e=>e.id);
        expect(matched('https://www.animatebookstore.com/viewer/?product_id=2108124','canvasSelector')).toEqual(['animate-body']);
        expect([...document.querySelectorAll(resolveMangaSite('https://www.animatebookstore.com/viewer/?product_id=2108124')!.canvasInteractionSelector!)].map(e=>e.id)).toEqual(['animate-interaction']);
        expect(matched('https://www.animatebookstore.com/viewer/?product_id=2108124')).toEqual([]);
        expect(matched('https://www.cmoa.jp/bib/speedreader/?cid=0000068502_jp_0001','areaSelector')).toEqual(['fragment']);
        expect(matched('https://www.cmoa.jp/bib/speedreader/?cid=0000068502_jp_0001')).toEqual([]);
        expect(matched('https://tapas.io/episode/3958118')).toEqual(['tapas-body']);
        expect(matched('https://page.kakao.com/content/56566288/viewer/56605697/')).toEqual(['kakao-body']);
        expect(matched('https://manhwaclub.net/manga/title/chapter-1/')).toEqual(['manhwa-body']);
        expect(matched('https://www.twbzmg.com/comic/chapter/title/0_271.html')).toEqual(['baozi-body']);
        expect(matched('https://global.manga-up.com/manga/164/14826')).toEqual(['manga-up-body']);
        expect(MANGA_SITE_CATALOG.find(site=>site.name==='Lezhin Comics')?.hosts).toContain('lezhinus.com');
        expect(isCatalogMangaHost('www.twbzmg.com')).toBe(true);
    });
    it.each([
        ['https://www.ganganonline.com/title/2322/chapter/132575','img[src^="blob:https://www.ganganonline.com/"]'],
        ['https://zebrack-comic.shueisha.co.jp/title/5554/chapter/75530/viewer', 'img[src^="blob:https://zebrack-comic.shueisha.co.jp/"]'],
        ['https://palcy.jp/comics/554', ':not(*)'],['https://comic.pixiv.net/viewer/stories/249534', ':not(*)'],
        ['https://pocket.shonenmagazine.com/title/01915/episode/360275', ':not(*)'],
        ['https://www.sunday-webry.com/episode/3269754496551508487','.page-area img.page-image, .page-area img.js-page-image'],
    ])('新核对阅读页保持正文范围与路径边界 %s',(href,selector)=>{
        expect(resolveMangaSite(href)).toMatchObject({selector,requireContent:true});
        const url=new URL(href);url.pathname+='/unrelated';expect(resolveMangaReaderProfile(url.hostname,url.pathname)).toBeNull();
        expect(resolveMangaReaderProfile('attacker.test',new URL(href).pathname)).toBeNull();
    });
    it('背景正文和受污染画布排除空白广告、封面及应用推广图',()=>{
        const {document}=parseHTML('<div id="page-0" style="background-image:url(blank.png)"></div><div id="page-1" style="background-image:url(blob:one)"></div><img id="app-icon"><div class="c-viewer__comic-item-image"><canvas id="body"></canvas><img id="ad"></div>');
        const background=resolveMangaSite('https://comic.pixiv.net/viewer/stories/249534')!;
        expect([...document.querySelectorAll(background.backgroundSelector!)].map(e=>e.id)).toEqual(['page-1']);expect(background.selector).toBe(':not(*)');
        const pocket=resolveMangaSite('https://pocket.shonenmagazine.com/title/01915/episode/360275')!;
        expect([...document.querySelectorAll(pocket.areaSelector!)].map(e=>e.id)).toEqual(['body']);expect(pocket.selector).toBe(':not(*)');
    });
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
        ['https://comic-walker.com/detail/KC_020020_S/episodes/KC_0200200000200011_E?episodeType=first', ':not(*)'],
        ['https://www.comic-walker.com/detail/KC_020020_S/episodes/KC_0200200000200011_E/', ':not(*)'],
        ['https://comic.naver.com/webtoon/detail?titleId=855297&no=1&week=mon', '#sectionContWide > img[id^="content_image_"]'],
        ['https://a-i-manga.com/work/45WoWxwi/', 'main img[alt^="Page "][src^="https://images.a-i-manga.com/comics/"]'],
        ['https://mangafire.to/title/ro8ro-all-class-awakening-god-slayer/chapter/9468411/', '.reader__strip > .reader__page > img.reader-img'],
        ['https://kirapo.jp/pt/meteor/currylevel/2022519/viewer/', ':not(*)'],
        ['https://vw.mangaz.com/virgo/view/135831/i:2', '#viewer #book .page_unit.page_image > img.image'],
        ['https://manga-park.com/title/53371/', '.viewer #minobi .manga-page-image > img.manga-image'],
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
        ['comic-walker.com','/detail/KC_020020_S/'], ['comic-walker.com','/detail/KC_020020_S/episodes/KC_0200200000200011_E/extra'],
        ['comic-walker.com','/episodes/abc'], ['comic-walker.com.attacker.test','/detail/KC_020020_S/episodes/KC_0200200000200011_E'],
        ['comic.naver.com','/webtoon/list'], ['comic.naver.com','/webtoon/detail/extra'],
        ['a-i-manga.com','/work/'], ['a-i-manga.com','/work/45WoWxwi/extra'],
        ['mangafire.to','/title/slug'], ['mangafire.to','/title/slug/chapter/name'],
        ['kirapo.jp','/meteor/titles/currylevel'], ['kirapo.jp','/pt/other/currylevel/2022519/viewer'],
        ['kirapo.jp','/pt/meteor/currylevel/2022519/viewer/extra'],
        ['vw.mangaz.com','/navi/135831/i:0'], ['vw.mangaz.com','/virgo/view/135831/i:2/extra'],
        ['vw.mangaz.com','/virgo/view/135831/i:page'], ['mangaz.com','/virgo/view/135831/i:2'],
        ['manga-park.com','/title/53371/extra'], ['manga-park.com','/chapter/494311'], ['manga-park.com','/title/name'],
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
    it('Naver 必须有数字作品和章节查询，不将缺参、目录或相似域名识别成正文', () => {
        expect(resolveMangaReaderProfile('comic.naver.com','/webtoon/detail','?no=1&week=mon&titleId=855297')?.name).toBe('ComicNaver');
        for (const query of ['', '?no=1', '?titleId=855297', '?titleId=story&no=1', '?titleId=855297&no=1/extra']) {
            expect(resolveMangaReaderProfile('comic.naver.com','/webtoon/detail',query)).toBeNull();
        }
        expect(resolveMangaReaderProfile('comic.naver.com.attacker.test','/webtoon/detail','?titleId=855297&no=1')).toBeNull();
    });
    it('ComicWalker 保留首张和后续页两种正文标记，排除结束推荐图、站外画布和非翻页遮罩', () => {
        const site=resolveMangaSite('https://comic-walker.com/detail/KC_020020_S/episodes/KC_0200200000200011_E')!;
        const {document}=parseHTML('<main><canvas id="decoy"></canvas><div data-viewer-full-screen-helper="true"><canvas id="first" data-type="contents"></canvas><div id="first-cover" class="_cover_bx4cr_11"></div><div data-type="contents"><canvas id="second"></canvas><div id="second-cover" class="_cover_bx4cr_11"></div></div><div class="_cover_unrelated"></div><div data-type="end"><canvas id="end"></canvas><img id="promo"></div></div></main>');
        expect([...document.querySelectorAll(site.canvasSelector!)].map(c=>c.id)).toEqual(['first','second']);
        expect([...document.querySelectorAll(site.canvasInteractionSelector!)].map(c=>c.id)).toEqual(['first-cover','second-cover']);
        expect(document.querySelectorAll(site.selector)).toHaveLength(0);
        expect(site.areaSelector).toBe(site.canvasSelector);
    });
    it('新图片正文规则排除年龄提示、导航封面与未标明正文的同源图片', () => {
        const {document}=parseHTML('<div id="sectionContWide"><img id="age"><img id="content_image_0"></div><aside><img id="content_image_1"></aside><main><img id="ai" alt="Page 1" src="https://images.a-i-manga.com/comics/story/000.webp"><img id="cover" alt="Cover" src="https://images.a-i-manga.com/comics/story/cover.webp"><img id="outside" alt="Page 2" src="https://example.com/page.webp"></main><div class="reader__strip"><div class="reader__page"><img id="fire" class="reader-img"></div></div><aside><img class="reader-img"></aside><div id="viewer"><div id="book"><img class="loading-back"><div class="page_unit page_image"><img id="mangaz" class="image protect" src="blob:https://vw.mangaz.com/page"></div></div></div>');
        for (const [url,ids] of [
            ['https://comic.naver.com/webtoon/detail?titleId=855297&no=1',['content_image_0']],
            ['https://a-i-manga.com/work/45WoWxwi',['ai']],
            ['https://mangafire.to/title/story/chapter/123',['fire']],
            ['https://vw.mangaz.com/virgo/view/135831/i:2',['mangaz']],
        ] as const) expect([...document.querySelectorAll(resolveMangaSite(url)!.selector)].map(i=>i.id)).toEqual(ids);
    });
    it('MangaPark 在作品页打开阅读器后仅处理 minobi 正文，不处理试阅片段和作品目录', () => {
        const {document}=parseHTML('<main><div id="chiramiseDiv"><img id="preview"></div><img class="chapterThumb"><div class="viewer"><div id="minobi"><div class="manga-face"><div class="manga-page manga-page-image"><img id="page" class="manga-image" src="blob:https://manga-park.com/page"></div></div></div><img id="promo" class="manga-image"></div></main>');
        const site=resolveMangaSite('https://manga-park.com/title/53371')!;
        expect([...document.querySelectorAll(site.selector)].map(i=>i.id)).toEqual(['page']);
        document.querySelector('.viewer')!.remove();expect(document.querySelectorAll(site.selector)).toHaveLength(0);
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
    it('网站目录精确匹配含国际化域名；除已核对有正文的 Countdown 主页外，不把首页当成阅读页', () => {
        expect(new Set(MANGA_SITE_DOMAINS).size).toBe(MANGA_SITE_DOMAINS.length);
        for (const hostname of MANGA_SITE_DOMAINS) {
            expect(isCatalogMangaHost(hostname)).toBe(true);
            expect(isCatalogMangaHost(`reader.${hostname}`)).toBe(true);
            expect(isCatalogMangaHost(`${hostname}.attacker.test`)).toBe(false);
            if (hostname === 'ctccomic.com') expect(resolveMangaSite(`https://${hostname}/`)).toMatchObject({requireContent: true, selector: '#cc-comicbody > a > img#cc-comic'});
            else expect(resolveMangaSite(`https://${hostname}/`)).toBeNull();
            expect(resolveMangaSite(`https://${hostname}/catalogue/123`)).toMatchObject({generic:true});
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
