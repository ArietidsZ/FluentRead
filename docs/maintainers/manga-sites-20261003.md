# 漫画网站清单与访问核对

2026-10-05 核对，保留用户要求的 **235 个去重名称**。已登记的域名会自动检测正文图片；Pixiv、MANGA Plus、WeebCentral、Dynasty、MangaDNA、Rawkuma 与单作品站使用专用正文规则。Champion Cross、Comic Ryu 和 Comic Growl 的公开可读画布接入连续翻译；不可读画布和已核对的分片站提供圈选入口。网站停服、验证、登录与付费条件不会因登记而消失。

域名来源包括[用户指定 Issue](https://github.com/immersive-translate/immersive-translate/issues/1809)、其中[历史清单](https://github.com/immersive-translate/immersive-translate/issues/1809#issuecomment-3047801980)、[小学馆官网](https://televikun-super-hero-comics.com/rensai/ultramanblazar/)及公开站点名称核对。`comemh8` 对应旧清单 Omemh8；JinMangas 仍缺少可确认的现用阅读链接。Syosetu 与 KLMANGA 已纠正为旧清单中的漫画域名，首页重定向确认的 Syosetu 新域名一并登记。

“首页 HTML 可访问”只证明本次收到页面，不证明章节、模型识别、服务翻译或全部设备通过。首页失败也可能是本地网络、站点验证或区域限制，不推断永久停服。停服和域名停放单独标注。原始 HTML 留在临时证据目录；仓库只保存地址、状态、哈希与结构摘要，见 `scripts/testing/evidence/manga-site-checks-20261005.json`。

| 编号 | 名称 | 域名 | 阅读器方式 | 本次访问核对 |
| --- | --- | --- | --- | --- |
| 1 | Pixiv | pixiv.net | 专用正文图片 | 未做首页探测；见章节验证 |
| 2 | MANGA Plus by SHUEISHA | mangaplus.shueisha.co.jp | 专用正文图片 | 未做首页探测；见章节验证 |
| 3 | Zebrack by SHUEISHA | zebrack-comic.shueisha.co.jp | 专用正文图片规则 | 公开章节正文已核对 |
| 4 | MANGA Million by SHUEISHA | mangamillion.shueisha.co.jp | 专用编号正文图片检测 | 公开免费首话 66193 显示 3 张 694×1080 正文；指南图片排除，实页入口通过 |
| 5 | COMIC FUZ | comic-fuz.com | 专用正文图片 | 公开章节正文结构已核对 |
| 6 | MangaDex | mangadex.org | 专用正文图片 | 公开章节正文结构已核对 |
| 7 | MangaDNA | mangadna.com | 专用正文图片 | 公开章节正文结构已核对 |
| 8 | Yamibo | yamibo.com | 通用正文图片检测 | 样本明确要求付费订阅，正文未显示 |
| 9 | ShonenJumpPlus | shonenjumpplus.com | 画布/分片：圈选入口 | 首页 HTML 可访问 |
| 10 | Rimacomiplus | rimacomiplus.jp | 可读画布连续翻译 | 公开章节画布已核对 |
| 11 | Heros Web | viewer.heros-web.com、heros-web.com | 可读画布连续翻译 | 公开章节画布已核对 |
| 12 | Comic Days | comic-days.com | 画布/分片：圈选入口 | 首页 HTML 可访问 |
| 13 | Comic Top | comic-top.com | 通用正文图片检测 | 域名停放页，正文未确认 |
| 14 | ComicWalker | comic-walker.com | 正文可读画布 · 连续翻译 | 公开章节 HTTP 200；两种正文标记已核对 |
| 15 | Web Ace | web-ace.jp | 通用正文图片检测 | 公开作品列表链接到已适配的 ComicWalker；本站独立正文未确认 |
| 16 | Antbyw | antbyw.com | 专用正文图片 | 公开章节正文结构已核对 |
| 17 | Jmanga | jmanga.org | 通用正文图片检测 | 连接失败 |
| 18 | Twitter Comic | twicomi.com | 专用正文图片 | 公开章节正文结构已核对 |
| 19 | MangaZ | mangaz.com | 专用正文图片检测 | 公开 vw 阅读器 HTTP 200；翻页后正文已显示 |
| 20 | PASH UP | pash-up.jp | 专用当前屏可读画布 | 免费首话当前屏入口、译图与正常点击翻页续译通过；首屏描边字未识别，质量未验收 |
| 21 | BOOK☆WALKER | bookwalker.jp | 通用正文图片检测 | 公开试读直开超时、弹出阅读器忙碌；正文未确认 |
| 22 | COLAMANGA | colamanga.com | 通用正文图片检测 | 连接失败 |
| 23 | GANGAN ONLINE | ganganonline.com | 专用正文图片规则 | 公开章节正文已核对 |
| 24 | Asura Scans | asuracomic.net、asurascans.com | 专用正文图片 | 公开章节正文结构已核对 |
| 25 | All Manga | allmanga.to | 通用正文图片检测 | 目录与作品 HTTP 200；Start Reading 未呈现章节正文 |
| 26 | Manhwaclan | manhwaclan.com | 通用正文图片检测 | 访问受限 |
| 27 | CoroCoro | corocoro.jp | 专用正文图片 | 公开章节正文结构已核对 |
| 28 | tonarinoyj | tonarinoyj.jp | 画布/分片：圈选入口 | 首页 HTML 可访问 |
| 29 | Yymanhua | yymanhua.com | 专用正文图片 | 公开章节正文结构已核对 |
| 30 | Manhwatop | manhwatop.com | 通用正文图片检测 | 访问受限 |
| 31 | Palcy | palcy.jp | 公开背景正文 · 连续翻译 | 同源背景完整页可读 |
| 32 | Comic-Trail | comic-trail.com | 画布/分片：圈选入口 | 首页 HTML 可访问 |
| 33 | Templetoons | templetoons.com | 通用正文图片检测 | 正常章节显示 14 个加载占位；正文未确认 |
| 34 | Batocomic | batocomic.net | 通用正文图片检测 | 当前首页是分类停放页；未推断替代域名 |
| 35 | Comic-action | comic-action.com | 画布/分片：圈选入口 | 首页 HTML 可访问 |
| 36 | 腾讯动漫 | ac.qq.com | 专用正文图片 | 公开章节正文结构已核对 |
| 37 | Sololevelingmangafree | sololevelingmangafree.com | 通用正文图片检测 | 连接失败 |
| 38 | Syosetu | syosetu.si / syosetu.cheap | 通用正文图片检测 | 公开章节与正常查看章节菜单可访问；没有显示正文图片，未计为实章通过 |
| 39 | Comick | comick.io / comick.dev / comick.fun | 通用正文图片检测 | 当前官方公告称已改为追踪与社区、停止漫画阅读；新域名实测 403 |
| 40 | YoungAnimal | younganimal.com | 可读画布连续翻译 | 公开章节画布已核对 |
| 41 | Piccoma | piccoma.com | 通用正文图片检测 | 公开作品/章节列表显示仅限日本；未验正文 |
| 42 | Hentaizap | hentaizap.com | 通用正文图片检测 | 首页 HTML 可访问 |
| 43 | Hanime1 | hanime1.me | 通用正文图片检测 | 访问受限 |
| 44 | Globalcomix | globalcomix.com | 正文圈选入口 | 免费正文已显示；扩展抓图 HTTP 401，保留圈选 |
| 45 | KL | klz9.com | 已核对正文图片 | 普通后台浏览器显示 14 张 1127×1600 正文，实际两页链路通过；竖排错识别、误译和排版仍可见 |
| 46 | comemh8 | omemh8.com | 通用正文图片检测 | 连接失败 |
| 47 | Mangaraw | mangarawjp.me / mangaraw.ac / mangaraw.best | 专用正文图片 | 公开章节正文结构已核对 |
| 48 | Bilibili-Manga | manga.bilibili.com | 通用正文图片检测 | 章节画布结构已核对；正文可读性待验证 |
| 49 | Kaijimanga | kaijimanga.com | 专用正文图片 | 首页 HTML 可访问 |
| 50 | Idmzj | idmzj.com | 通用正文图片检测 | 连接失败 |
| 51 | Manga4u | mn4u.net | 专用正文图片 | 公开章节正文结构已核对 |
| 52 | Animatebookstore | animatebookstore.com | 可读画布连续翻译 | www 免费试读 HTTP 200；正文与透明交互层已核对 |
| 53 | GANMA | ganma.jp | 通用正文图片检测 | 连接失败 |
| 54 | Mangafire | mangafire.to | 专用正文图片检测 | 公开章节 HTTP 200；首张正文已加载，后续懒加载 |
| 55 | Reaperscans | reaperscans.com | 通用正文图片检测 | 连接失败 |
| 56 | Manhuatop | manhuatop.com | 通用正文图片检测 | 当前重定向到域名停放页，正文未确认 |
| 57 | Dlsite | dlsite.com | 通用正文图片检测 | 首页 HTML 可访问 |
| 58 | uzakichanmanga | uzakichanmanga.com | 专用正文图片 | 连接失败 |
| 59 | Shonenmagazine | shonenmagazine.com · pocket.shonenmagazine.com | 正文画布 · 圈选翻译 | 公开章节画布不可直接读取 |
| 60 | ComicNaver | comic.naver.com | 专用正文图片检测 | 公开章节 HTTP 200；数字作品及章节查询 |
| 61 | comic-zenon | comic-zenon.com | 不可读画布：圈选入口 | 公开章节结构已核对；画布受污染 |
| 62 | Webtoons | webtoons.com | 专用正文图片 | 公开章节正文结构已核对 |
| 63 | Lezhin Comics | lezhin.com、lezhinus.com | 通用正文图片检测 | 英语站公开免费章节仍转至登录；正文未确认 |
| 64 | BeLTOON | beltoon.jp | 通用正文图片检测 | 公开首页只确认作品封面；实际正文未确认 |
| 65 | ManhwaClub | manhwaclub.net | 专用正文图片 | 公开章节正文已核对；未验 OCR |
| 66 | JinMangas | 待确认 | 待确认 | 缺少可确认地址 |
| 67 | Atsumaru | atsu.moe | 专用正文图片，长图分段 | 800×15744 原图的两段翻译链路通过；整条未验 |
| 68 | Comic CMOA | cmoa.jp | 分片正文：圈选入口 | www 免费试读 HTTP 200；正常关闭操作提示，分片已核对 |
| 69 | Televi-Kun Super Hero Comics | televikun-super-hero-comics.com | 画布/分片：圈选入口 | 首页 HTML 可访问 |
| 70 | KLMANGA | klmanga.my | 通用正文图片检测 | 连接失败 |
| 71 | SoloLevelingFree | sololevelingfree.vip | 通用正文图片检测 | 连接失败 |
| 72 | Rawkuma | rawkuma.net / rawkuma.com | 专用正文图片 | 首页 HTML 可访问 |
| 73 | Kakao | page.kakao.com | 专用正文图片 | 公开免费章节 HTTP 200；未验韩文 OCR 质量 |
| 74 | TopReadManga | topreadmanga.com | 通用正文图片检测 | 连接失败 |
| 75 | Revenge of the Iron Blooded Swordhound | revengeoftheiron-bloodedswordhound.one | 通用正文图片检测 | 连接失败 |
| 76 | Poipiku | poipiku.com | 通用正文图片检测 | 首页 HTML 可访问 |
| 77 | Manhuaus | manhuaus.com / manhuaus.org | 通用正文图片检测 | 访问受限 |
| 78 | HMTTMH | hmttmh.com | 通用正文图片检测 | 连接失败 |
| 79 | Smoking Behind the Supermarket | smokingbehindthesupermarket.com | 专用正文图片 | 公开章节正文结构已核对 |
| 80 | Comic Growl | comic-growl.com | 可读画布连续翻译 | 公开章节画布已核对 |
| 81 | Jumptoon | jumptoon.com | 受跨域限制画布：圈选入口 | 公开章节正文画布已核对 |
| 82 | Fenoxo | fenoxo.com | 通用正文图片检测 | 首页 HTML 可访问 |
| 83 | MangaFreak | mangafreak.net / mangafreak.me | 专用正文图片 | 公开章节正文结构已核对 |
| 84 | ComicGardo | comic-gardo.com | 画布/分片：圈选入口 | 首页 HTML 可访问 |
| 85 | Booklive | booklive.jp | 分片正文：圈选入口 | 正常免费试读、关闭说明及翻页已显示分片正文；圈选入口通过 |
| 86 | MrBlue | mrblue.com | 通用正文图片检测 | 公开免费作品与章节列表可访问；正常点击尚未显示正文 |
| 87 | MangaLove | mangalove.me | 正文画布圈选入口 | 免费 viewer 正文画布受跨域限制；不读取像素或启动连续图片翻译 |
| 88 | rawdevart.art | rawdevart.art | 通用正文图片检测 | 首页可找到章节；有界面与无界面均只见空正文容器，未确认正文 |
| 89 | manga-shinchan.com | manga-shinchan.com | 通用正文图片检测 | 章节样本仅见宣传图；正文待确认 |
| 90 | yaoimangaonline.com | yaoimangaonline.com | 通用正文图片检测 | 首页 HTML 可访问 |
| 91 | nhentaiyaoi | nhentaiyaoi.net | 通用正文图片检测 | 首页 HTML 可访问 |
| 92 | orchisasia | orchisasia.org | 专用正文图片，长图分段 | 公开作者后记有 5 张 720 像素宽长图；实页入口通过，翻译质量未验 |
| 93 | mangalib | mangalib.me | 通用正文图片检测 | 公开实章两种窗口未显示正文；正常截图字体等待超时 |
| 94 | novelcrow | novelcrow.com | 通用正文图片检测 | 访问受限 |
| 95 | cn.twbzmg.com | cn.twbzmg.com | 包子漫画正文规则族 | 首页 HTML 可访问；本轮未验此域名章节 |
| 96 | Nyx Scans | nyxscans.com | 专用长条正文图片 | 免费章节与入口已核对；复用既有分段链路 |
| 97 | Qi Manga | qimanga.com | 专用长条正文图片 | 正常后台浏览器可打开免费章节；无界面模式的 403 记录保留 |
| 98 | MG Read | mgread.io | 专用正文图片 | 公开章节正文结构已核对 |
| 99 | 뉴토끼대피소.com | 뉴토끼대피소.com | 通用正文图片检测 | 首页 HTML 可访问 |
| 100 | 블랙툰.co | 블랙툰.co | 通用正文图片检测 | 首页 HTML 可访问 |
| 101 | happytoon01.com | happytoon01.com | 通用正文图片检测 | 连接失败 |
| 102 | twmanga.com | twmanga.com、twbzmg.com | 专用正文图片 | 公开阅读链接转至 www.twbzmg.com；AMP 正文已核对 |
| 103 | mgeko.cc | mgeko.cc | 专用正文图片 | 公开章节正文结构已核对 |
| 104 | greentoon.net | greentoon.net | 通用正文图片检测 | 当前 HTTP 429；正文未确认 |
| 105 | dynasty-scans.com | dynasty-scans.com | 专用正文图片 | 首页 HTML 可访问 |
| 106 | mangaoi.net | mangaoi.net | 通用正文图片检测 | 章节样本返回 200，但显示 404 |
| 107 | rawlazy.io | rawlazy.io | 通用正文图片检测 | 公开实章仍显示图片加载提示；正文未确认 |
| 108 | toptoon.com | toptoon.com | 通用正文图片检测 | 首页 HTML 可访问 |
| 109 | acgmhh.com | acgmhh.com | 通用正文图片检测 | 首页 HTML 可访问 |
| 110 | readcomicsonline.ru | readcomicsonline.ru | 通用正文图片检测 | 访问受限 |
| 111 | vortexscans.org | vortexscans.org | 专用正文图片 | 公开章节正文结构已核对 |
| 112 | freeonlinehd.site | freeonlinehd.site | 通用正文图片检测 | 首页 HTML 可访问 |
| 113 | weebrook.com | weebrook.com | 通用正文图片检测 | 连接失败 |
| 114 | toonily.com | toonily.com | 通用正文图片检测 | 访问受限 |
| 115 | mangadistrict2.com | mangadistrict2.com | 通用正文图片检测 | 连接失败 |
| 116 | manhuaread.com | manhuaread.com | 通用正文图片检测 | 当前首页为 PLAYBOOK88 博彩品牌，正文未确认 |
| 117 | mangaread.org | mangaread.org | 专用正文图片 | 公开章节正文结构已核对 |
| 118 | mangaforfree.net | mangaforfree.net | 专用正文图片 | 公开章节正文结构已核对 |
| 119 | bakamh.com | bakamh.com | 通用正文图片检测 | 访问受限 |
| 120 | yakshascans.com | yakshascans.com、ravenscans.org | 通用正文图片检测 | 重定向已确认；正文待确认 |
| 121 | toonclash.com | toonclash.com | 通用正文图片检测 | 连接失败 |
| 122 | rawdex.net | rawdex.net | 专用正文图片 | 公开纵向章节正文和入口已核对；未验 OCR 或分页模式 |
| 123 | reset-scans.org | reset-scans.org | 通用正文图片检测 | 连接失败 |
| 124 | cultivationmanhua.com | cultivationmanhua.com | 通用正文图片检测 | HTTP 错误 |
| 125 | manhwaread.com | manhwaread.com | 通用正文图片检测 | 连接失败 |
| 126 | manhwabuddy.com | manhwabuddy.com | 专用正文图片 | 公开章节正文结构已核对 |
| 127 | wto.to | wto.to | 通用正文图片检测 | 停服或域名停放 |
| 128 | sukima.me | sukima.me | 通用正文图片检测 | 连接失败 |
| 129 | comix.to | comix.to | 通用正文图片检测 | 访问受限 |
| 130 | youngchampion.jp | youngchampion.jp | 可读画布连续翻译 | 公开章节画布已核对 |
| 131 | manga-one.com | manga-one.com | 专用正文图片 | 公开章节正文结构已核对 |
| 132 | book.dmm.com | book.dmm.com | 通用正文图片检测 | 首页 HTML 可访问 |
| 133 | newmanhwa.com | newmanhwa.com | 通用正文图片检测 | 连接失败 |
| 134 | fxfx302.com | fxfx302.com | 通用正文图片检测 | 连接失败 |
| 135 | comic-meteor.jp | comic-meteor.jp · kirapo.jp | 分片阅读器 · 圈选翻译 | 公开章节 HTTP 200；旧站重定向 Kirapo |
| 136 | omegascans.org | omegascans.org | 专用长条正文图片 | 公开章节与入口已核对；排除上方横幅和外部推荐 |
| 137 | readallcomics.com | readallcomics.com | 通用正文图片检测 | 当前 HTTP 522 连接超时 |
| 138 | ranfren.neocities.org | ranfren.neocities.org | 通用正文图片检测 | 连接失败 |
| 139 | utoon.net | utoon.net | 通用检测；漫画正文未确认 | 当前首页为浏览器游戏；历史漫画归档返回 404 |
| 140 | manhuapica.com | manhuapica.com | 通用正文图片检测 | 首页 HTML 可访问 |
| 141 | comic-ryu.jp | comic-ryu.jp | 可读画布连续翻译 | 公开章节画布已核对 |
| 142 | ctccomic.com | ctccomic.com | 专用单页正文，含主页阅读 | 主页 900×1331、首话 900×1279 正文和实页入口通过；742 单独地址本次未加载正文 |
| 143 | nyaa.fan | nyaa.fan | 通用正文图片检测 | 连接失败 |
| 144 | mangago.me | mangago.me | 通用正文图片检测 | 访问受限 |
| 145 | rinkocomics.com | rinkocomics.com | 专用正文图片 · 长条分段 | 公开章节完整长图和入口已核对；本轮未验 OCR |
| 146 | roliascan.com | roliascan.com | 专用正文图片 | 公开章节正文结构已核对 |
| 147 | novelpia.com | novelpia.com | 通用正文图片检测 | 首页 HTML 可访问 |
| 148 | zerobywai.com | zerobywai.com | 通用正文图片检测 | 首页 HTML 可访问 |
| 149 | toongod.cc | toongod.cc | 专用正文图片，长图分段 | 900×16006 原图的两段翻译链路通过；整条未验 |
| 150 | kingofshojo.com | kingofshojo.com | 专用正文图片 | 公开章节正文结构已核对 |
| 151 | weebcentral.com | weebcentral.com | 专用正文图片 | 首页 HTML 可访问 |
| 152 | lrr.tvc-16.science | lrr.tvc-16.science | 通用正文图片检测 | 首页 HTML 可访问 |
| 153 | mangarawad.org | mangarawad.org | 通用正文图片检测 | 连接失败 |
| 154 | manga-park.com | manga-park.com | 专用正文图片检测 | 作品页免费按钮已显示正文；直接章节地址 HTTP 404 |
| 155 | mangaflame.org | mangaflame.org | 通用检测；漫画正文未确认 | 当前跳转域名停放页，未将停放子域登记为漫画别名 |
| 156 | manhwa404.com | manhwa404.com | 通用正文图片检测 | 连接失败 |
| 157 | xmanga.org | xmanga.org | 通用正文图片检测 | 连接失败 |
| 158 | florascans.net | florascans.net | 通用正文图片检测 | 连接失败 |
| 159 | comic.mf-fleur.jp | comic.mf-fleur.jp | 专用正文图片 | 公开章节正文结构已核对 |
| 160 | komiic.com | komiic.com | 通用正文图片检测 | 根地址转向登录；正文未确认 |
| 161 | manhwaus.org | manhwaus.org | 通用正文图片检测 | 连接失败 |
| 162 | tichct.org | tichct.org | 通用正文图片检测 | 连接失败 |
| 163 | manhuaplus.org | manhuaplus.org | 专用正文图片 | 公开章节 20 张完整正文；两张开头场景/SFX 阅读链路通过 |
| 164 | manhuazhan.com | manhuazhan.com | 通用正文图片检测 | 章节 DOM 存在，正文图片未确认加载 |
| 165 | blossommanga.com | blossommanga.com | 通用正文图片检测 | 连接失败 |
| 166 | w226.npdn.top | w226.npdn.top | 通用正文图片检测 | 首页 HTML 可访问 |
| 167 | komiku.com | komiku.com | 通用正文图片检测 | 连接失败 |
| 168 | webtoonraw.com | webtoonraw.com | 通用正文图片检测 | 连接失败 |
| 169 | kissmanga.in | kissmanga.in | 通用正文图片检测 | 访问受限 |
| 170 | 02.ikiru.wtf | 02.ikiru.wtf | 通用正文图片检测 | 连接失败 |
| 171 | mangahub.ru | mangahub.ru | 专用正文图片 | 正文和入口已核对；当前漫画 OCR 缺少俄语字符 |
| 172 | ezmanga.org | ezmanga.org | 通用正文图片检测 | 访问受限 |
| 173 | magustoon.org | magustoon.org | 通用正文图片检测 | 访问受限 |
| 174 | violetscans.org | violetscans.org、violetmanga.com | 专用正文图片 | 公开章节正文结构已核对 |
| 175 | publicdiplomacymagazine.com | publicdiplomacymagazine.com | 通用正文图片检测 | 访问受限 |
| 176 | raw1001.net | raw1001.net | 专用正文图片 | 正文和入口通过；开头页 OCR 链路通过，质量有明显限制 |
| 177 | mkissa.to | mkissa.to | 通用正文图片检测 | 公开作品有章节链接；实章 HTTP 403 验证页，正文未确认 |
| 178 | iqiyi.com | iqiyi.com | 通用正文图片检测 | 首页 HTML 可访问 |
| 179 | jcomic.net | jcomic.net | 通用正文图片检测 | 公开最新更新分类只确认封面；正文未确认 |
| 180 | tapas.io | tapas.io | 专用正文图片 | 公开章节 HTTP 200；两张实际对白翻译链路已核对 |
| 181 | kagane.to | kagane.to | 通用正文图片检测 | 访问受限 |
| 182 | soraraw.com | soraraw.com | 通用正文图片检测 | 正常窗口缩放提示持续遮住阅读器，正文未验收 |
| 183 | gomuraw.biz | gomuraw.biz | 通用正文图片检测 | 连接失败 |
| 184 | webtoonscan.com | webtoonscan.com | 通用正文图片检测 | 访问受限 |
| 185 | zipcomic.com | zipcomic.com | 通用正文图片检测 | 当前 HTTP 403 验证页 |
| 186 | zerobywzz.com | zerobywzz.com | 通用正文图片检测 | 连接失败 |
| 187 | dokusho-ojikan.jp | dokusho-ojikan.jp | 通用正文图片检测 | 公开试读报处理失败；未验证 |
| 188 | bomtoon.com | bomtoon.com | 通用正文图片检测 | 首页 HTML 可访问 |
| 189 | copymanga.site | copymanga.site | 通用正文图片检测 | 首页 HTML 可访问 |
| 190 | readcomiconline.li | readcomiconline.li | 通用正文图片检测 | 连接失败 |
| 191 | championcross.jp | championcross.jp | 可读画布连续翻译 | 公开章节画布已核对 |
| 192 | mechacomic.jp | mechacomic.jp | 纵向完整正文图片 | 正常免费入口及两幅对白 OCR 链路通过；竖排漏识别/错译仍在 |
| 193 | kuragebunch.com | kuragebunch.com | 画布/分片：圈选入口 | 首页 HTML 可访问 |
| 194 | ichicomi.com | ichicomi.com | 受跨域限制画布：圈选入口 | 公开章节画布结构已核对 |
| 195 | rookie.shonenjump.com | rookie.shonenjump.com | 专用正文图片 | 公开章节正文结构已核对 |
| 196 | manhwa-raw.com | manhwa-raw.com | 通用正文图片检测 | 访问受限 |
| 197 | s1.managall.com | s1.managall.com | 通用正文图片检测 | 连接失败 |
| 198 | manhwato.com | manhwato.com | 专用正文图片 | 公开章节正文及扩展入口已核对；无 OCR 验收 |
| 199 | kuaikanmanhua.com | kuaikanmanhua.com | 通用正文图片检测 | 公开章节样本转向登录；正文未显示 |
| 200 | mangapark.net | mangapark.net | 通用正文图片检测 | 连接失败 |
| 201 | mangasuika.com | mangasuika.com | 通用正文图片检测 | 连接失败 |
| 202 | firemanga.com | firemanga.com | 通用正文图片检测 | 连接失败 |
| 203 | lmanga.com | lmanga.com | 通用正文图片检测 | 当前跳转 /lander；正文未确认 |
| 204 | manhwahub.net | manhwahub.net | 通用正文图片检测 | 连接失败 |
| 205 | manhuatop.org | manhuatop.org | 通用正文图片检测 | 访问受限 |
| 206 | aedexnox.vxviral.xyz | aedexnox.vxviral.xyz | 通用正文图片检测 | 连接失败 |
| 207 | manhuabika.com | manhuabika.com | 通用正文图片检测 | PicaWeb 首页可访问；未找到可确认的公开章节正文 |
| 208 | rawotaku.com | rawotaku.com | 专用正文图片 | 公开章节入口与两页 OCR 链路通过；识别翻译质量仍有缺陷 |
| 209 | pixiv.app | pixiv.app | 通用正文图片检测 | 连接失败 |
| 210 | speed-manga.com | speed-manga.com / speed-manga.net | 专用正文图片 | 公开章节正文结构已核对 |
| 211 | yomonga.com | yomonga.com | 通用正文图片检测 | 当前维护页 HTTP 503；未验证 |
| 212 | global.manga-up.com | global.manga-up.com | 专用正文图片 | 公开章节 HTTP 200；正文与 Cookie 提示已核对 |
| 213 | mangaball.net | mangaball.net、mangaball.com | 通用正文图片检测 | 跳转现用 .com；正文图片受浏览器响应来源限制 |
| 214 | yanmaga.jp | yanmaga.jp | 画布/分片：圈选入口 | 首页 HTML 可访问 |
| 215 | viewer.bookhodai.jp | viewer.bookhodai.jp | 通用正文图片检测 | 根地址正常转至订阅与登录首页，未发现公开正文 |
| 216 | play.comipo.app | play.comipo.app | 通用正文图片检测 | 正常跳转至 comipo 登录页时 DOM 调查被导航中断；未验证正文 |
| 217 | arenascan.com | arenascan.com | 专用正文图片 | 公开章节正文结构已核对 |
| 218 | luvyaa.my.id | luvyaa.my.id / luvyaa.co / v5.luvyaa.co | 已核对正文图片 | 原域名落地页显式链接与正常跳转确认现用域名，readerarea 中完整长图复用分段链路；排除上方广告 |
| 219 | toondex.co | toondex.co | 专用正文图片 | 编号正文及扩展入口已核对；无 OCR 验收 |
| 220 | manwadd.cc | manwadd.cc | 通用正文图片检测 | 连接失败 |
| 221 | saucemanhwa.com | saucemanhwa.com | 通用正文图片检测 | 当前重定向到域名停放页，正文未确认 |
| 222 | mangakoinu.com | mangakoinu.com | 通用正文图片检测 | 连接失败 |
| 223 | comicmanga.cc | comicmanga.cc | 通用正文图片检测 | 连接失败 |
| 224 | mangajikan.com | mangajikan.com | 通用正文图片检测 | 连接失败 |
| 225 | manhwaden.com | manhwaden.com | 专用长图正文 | 完整长图及扩展入口已核对；共用分段，无本轮 OCR 验收 |
| 226 | dvamh-vzwp7.top | dvamh-vzwp7.top | 通用正文图片检测 | 首页 HTML 可访问 |
| 227 | comic.pixiv.net | comic.pixiv.net | 公开背景正文 · 连续翻译 | 同源背景完整页可读 |
| 228 | comico.jp | comico.jp | 通用正文图片检测 | 公开销售与租阅已结束；本轮首页与搜索页没有正文，已购书架需账户，未验证 |
| 229 | manhwas.men | manhwas.men | 通用正文图片检测 | 连接失败 |
| 230 | ridibooks.com | ridibooks.com | 通用正文图片检测 | 本轮公开漫画目录返回 403，无正文验收 |
| 231 | sunday-webry.com | sunday-webry.com | 正文画布 · 圈选翻译 | 公开章节画布不可直接读取 |
| 232 | ynjn.jp | ynjn.jp | 通用正文图片检测 | 公开阅读器停在加载状态，未验证正文 |
| 233 | mangayun.com | mangayun.com | 专用正文图片 | 如漫画来源首话完整正文和入口通过；第一来源 403 保留 |
| 234 | manhwaweb.com | manhwaweb.com | 已核对正文图片 | /leer/ 公开章节限定正文直系图片，完整长图复用分段链路；排除音乐按钮图片和封面 |
| 235 | a-i-manga.com | a-i-manga.com | 专用正文图片检测 | 公开作品阅读页 HTTP 200；24 张编号正文图片 |
