/**
 * @file src/core/config/mangaSiteCatalog.ts
 * 文件职责：保存用户要求的漫画网站目录和通用图片阅读器选择器，支持统一入口与后续逐站适配。
 * 主要内容：显式域名与公开网站别名，精确域名/子域匹配；目录只表示可以尝试图片阅读器，不等于全部站点已通过真实章节验收。
 * 模块边界：静态目录和纯匹配，不抓取章节，不绕过登录，不声明画布或分片阅读器可译；没有复制第三方适配源码。
 */
export const MANGA_READER_SELECTORS = '.reading-content img, .reader-area img, .chapter-content img, .page-break img, #reader img, #manga-reader img, #viewer img, [data-manga-reader] img, [class*="Reader"] img, [class*="reader"] img, [class*="viewer"] img';
/** 来源：用户给出的域名清单及其指定的公开 Issue/使用文档中的名称链接；实际能力由页面检测决定。 */
export const MANGA_SITE_DOMAINS = `
mangamillion.shueisha.co.jp mangadna.com rimacomiplus.jp comic-growl.com
younganimal.com animatebookstore.com cmoa.jp jumptoon.com comic-gardo.com manga.bilibili.com page.kakao.com
zebrack-comic.shueisha.co.jp comic-fuz.com mangadex.org yamibo.com shonenjumpplus.com viewer.heros-web.com comic-days.com comic-top.com comic-walker.com web-ace.jp antbyw.com jmanga.org twicomi.com mangaz.com pash-up.jp colamanga.com ganganonline.com asuracomic.net allmanga.to manhwaclan.com corocoro.jp tonarinoyj.jp yymanhua.com manhwatop.com palcy.jp comic-trail.com templetoons.com batocomic.net comic-action.com ac.qq.com sololevelingmangafree.com
rawdevart.art manga-shinchan.com yaoimangaonline.com mangalib.me novelcrow.com cn.twbzmg.com 뉴토끼대피소.com 블랙툰.co happytoon01.com twmanga.com mgeko.cc greentoon.net dynasty-scans.com mangaoi.net rawlazy.io toptoon.com acgmhh.com readcomicsonline.ru vortexscans.org freeonlinehd.site weebrook.com toonily.com mangadistrict2.com manhuaread.com mangaread.org mangaforfree.net bakamh.com yakshascans.com toonclash.com rawdex.net reset-scans.org cultivationmanhua.com manhwaread.com manhwabuddy.com wto.to sukima.me comix.to youngchampion.jp manga-one.com book.dmm.com newmanhwa.com fxfx302.com comic-meteor.jp omegascans.org readallcomics.com ranfren.neocities.org utoon.net manhuapica.com comic-ryu.jp ctccomic.com nyaa.fan mangago.me rinkocomics.com roliascan.com novelpia.com zerobywai.com toongod.cc kingofshojo.com weebcentral.com lrr.tvc-16.science mangarawad.org manga-park.com mangaflame.org manhwa404.com xmanga.org florascans.net comic.mf-fleur.jp komiic.com manhwaus.org tichct.org manhuaplus.org manhuazhan.com blossommanga.com w226.npdn.top komiku.com webtoonraw.com kissmanga.in 02.ikiru.wtf mangahub.ru ezmanga.org magustoon.org violetscans.org publicdiplomacymagazine.com raw1001.net mkissa.to iqiyi.com jcomic.net tapas.io kagane.to soraraw.com gomuraw.biz webtoonscan.com zipcomic.com zerobywzz.com dokusho-ojikan.jp bomtoon.com copymanga.site readcomiconline.li championcross.jp mechacomic.jp kuragebunch.com ichicomi.com rookie.shonenjump.com manhwa-raw.com s1.managall.com manhwato.com kuaikanmanhua.com mangapark.net mangasuika.com firemanga.com lmanga.com manhwahub.net manhuatop.org aedexnox.vxviral.xyz manhuabika.com rawotaku.com pixiv.app speed-manga.com yomonga.com global.manga-up.com mangaball.net yanmaga.jp viewer.bookhodai.jp play.comipo.app arenascan.com luvyaa.my.id toondex.co manwadd.cc saucemanhwa.com mangakoinu.com comicmanga.cc mangajikan.com manhwaden.com dvamh-vzwp7.top comic.pixiv.net comico.jp manhwas.men ridibooks.com sunday-webry.com ynjn.jp mangayun.com manhwaweb.com a-i-manga.com
bookwalker.jp mangafire.to reaperscans.com manhuatop.com dlsite.com shonenmagazine.com comic.naver.com comic-zenon.com webtoons.com lezhin.com beltoon.jp poipiku.com booklive.jp mrblue.com ganma.jp piccoma.com hentaizap.com globalcomix.com syosetu.com comick.io comick.dev comick.fun klz9.com idmzj.com hanimeone.me battwo.com mangabuddy.com readcomic.me
`.trim().split(/\s+/).map(host => new URL(`https://${host}`).hostname);
const domains = new Set(MANGA_SITE_DOMAINS);
export function isCatalogMangaHost(hostname: string): boolean {
    const parts = hostname.split('.');
    for (let index = 0; index < parts.length - 1; index++) if (domains.has(parts.slice(index).join('.'))) return true;
    return false;
}
