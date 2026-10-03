# 漫画网站完整需求清单

[返回实施报告](./manga-prefetch-compatibility-20261003)。此表逐项保留用户给出的全部名称，去掉重复的 Asura Scans、Comick、Jmanga 等，并把转义的点归一化。共 **235 项**：141 个显式域名，2 个专用适配实页样本，209 项通用图片检测范围，24 个名称仍待域名确认。运行时目录含 213 个域名，与品牌名/别名数量不同。

通用检测只处理 DOM 中可访问的正文图片；画布、分片、受保护资源及特殊页序仍需适配。已登记域名不等于域名当前存活、网站所有章节已通过或翻译质量合格。品牌域名是候选映射，公开链接参考[原产品文档](https://immersivetranslate.com/docs/features/manga/)及[用户指定 Issue](https://github.com/immersive-translate/immersive-translate/issues/1809)，MANGA Million、MangaDNA、Rimacomiplus、Comic Growl 及表中七个带官网链接的新映射另核对其公开站点；Animate Bookstore 当前返回拥挤提示，仅确认品牌域名；没有链接证明的候选不作逐站支持声明。用户显式域名全部进入目录，未臆造 nhentaiyaoi、orchisasia 等仅名称条目的域名。

| 编号 | 用户名称 | 域名或候选 | 当前状态 | 下一项验收 |
| --- | --- | --- | --- | --- |
| 1 | Pixiv | pixiv.net | 专用适配；用户提供实页已验证 | 更多章节、设备和识别质量样本 |
| 2 | MANGA Plus by SHUEISHA | mangaplus.shueisha.co.jp | 专用适配；用户提供实页已验证 | 更多章节、设备和识别质量样本 |
| 3 | Zebrack by SHUEISHA | zebrack-comic.shueisha.co.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 4 | MANGA Million by SHUEISHA | mangamillion.shueisha.co.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 5 | COMIC FUZ | comic-fuz.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 6 | MangaDex | mangadex.org | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 7 | MangaDNA | mangadna.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 8 | Yamibo | yamibo.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 9 | ShonenJumpPlus | shonenjumpplus.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 10 | Rimacomiplus | rimacomiplus.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 11 | Heros Web | viewer.heros-web.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 12 | Comic Days | comic-days.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 13 | Comic Top | comic-top.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 14 | ComicWalker | comic-walker.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 15 | Web Ace | web-ace.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 16 | Antbyw | antbyw.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 17 | Jmanga | jmanga.org | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 18 | Twitter Comic | twicomi.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 19 | MangaZ | mangaz.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 20 | PASH UP | pash-up.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 21 | BOOK☆WALKER | bookwalker.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 22 | COLAMANGA | colamanga.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 23 | GANGAN ONLINE | ganganonline.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 24 | Asura Scans | asuracomic.net | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 25 | All Manga | allmanga.to | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 26 | Manhwaclan | manhwaclan.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 27 | CoroCoro | corocoro.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 28 | tonarinoyj | tonarinoyj.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 29 | Yymanhua | yymanhua.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 30 | Manhwatop | manhwatop.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 31 | Palcy | palcy.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 32 | Comic-Trail | comic-trail.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 33 | Templetoons | templetoons.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 34 | Batocomic | batocomic.net | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 35 | Comic-action | comic-action.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 36 | 腾讯动漫 | ac.qq.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 37 | Sololevelingmangafree | sololevelingmangafree.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 38 | Syosetu | syosetu.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 39 | Comick | comick.io / comick.dev / comick.fun | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 40 | YoungAnimal | [younganimal.com](https://younganimal.com/) | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 41 | Piccoma | piccoma.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 42 | Hentaizap | hentaizap.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 43 | Hanime1 | hanimeone.me | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 44 | Globalcomix | globalcomix.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 45 | KL | klz9.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 46 | comemh8 | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 47 | Mangaraw | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 48 | Bilibili-Manga | [manga.bilibili.com](https://manga.bilibili.com/) | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 49 | Kaijimanga | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 50 | Idmzj | idmzj.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 51 | Manga4u | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 52 | Animatebookstore | [animatebookstore.com](https://animatebookstore.com/) | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 53 | GANMA | ganma.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 54 | Mangafire | mangafire.to | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 55 | Reaperscans | reaperscans.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 56 | Manhuatop | manhuatop.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 57 | Dlsite | dlsite.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 58 | uzakichanmanga | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 59 | Shonenmagazine | shonenmagazine.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 60 | ComicNaver | comic.naver.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 61 | comic-zenon | comic-zenon.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 62 | Webtoons | webtoons.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 63 | Lezhin Comics | lezhin.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 64 | BeLTOON | beltoon.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 65 | ManhwaClub | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 66 | JinMangas | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 67 | Atsumaru | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 68 | Comic CMOA | [cmoa.jp](https://cmoa.jp/) | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 69 | Televi-Kun Super Hero Comics | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 70 | KLMANGA | klz9.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 71 | SoloLevelingFree | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 72 | Rawkuma | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 73 | Kakao | [page.kakao.com](https://page.kakao.com/) | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 74 | TopReadManga | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 75 | Revenge of the Iron Blooded Swordhound | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 76 | Poipiku | poipiku.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 77 | Manhuaus | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 78 | HMTTMH | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 79 | Smoking Behind the Supermarket | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 80 | Comic Growl | comic-growl.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 81 | Jumptoon | [jumptoon.com](https://jumptoon.com/) | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 82 | Fenoxo | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 83 | MangaFreak | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 84 | ComicGardo | [comic-gardo.com](https://comic-gardo.com/) | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 85 | Booklive | booklive.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 86 | MrBlue | mrblue.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 87 | MangaLove | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 88 | rawdevart.art | rawdevart.art | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 89 | manga-shinchan.com | manga-shinchan.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 90 | yaoimangaonline.com | yaoimangaonline.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 91 | nhentaiyaoi | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 92 | orchisasia | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 93 | mangalib | mangalib.me | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 94 | novelcrow | novelcrow.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 95 | cn.twbzmg.com | cn.twbzmg.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 96 | Nyx Scans | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 97 | Qi Manga | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 98 | MG Read | 待确认 | 名称待确认域名；未作专用支持声明 | 明确域名与可访问章节，再检查图片/画布/分片类型 |
| 99 | 뉴토끼대피소.com | 뉴토끼대피소.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 100 | 블랙툰.co | 블랙툰.co | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 101 | happytoon01.com | happytoon01.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 102 | twmanga.com | twmanga.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 103 | mgeko.cc | mgeko.cc | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 104 | greentoon.net | greentoon.net | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 105 | dynasty-scans.com | dynasty-scans.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 106 | mangaoi.net | mangaoi.net | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 107 | rawlazy.io | rawlazy.io | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 108 | toptoon.com | toptoon.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 109 | acgmhh.com | acgmhh.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 110 | readcomicsonline.ru | readcomicsonline.ru | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 111 | vortexscans.org | vortexscans.org | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 112 | freeonlinehd.site | freeonlinehd.site | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 113 | weebrook.com | weebrook.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 114 | toonily.com | toonily.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 115 | mangadistrict2.com | mangadistrict2.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 116 | manhuaread.com | manhuaread.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 117 | mangaread.org | mangaread.org | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 118 | mangaforfree.net | mangaforfree.net | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 119 | bakamh.com | bakamh.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 120 | yakshascans.com | yakshascans.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 121 | toonclash.com | toonclash.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 122 | rawdex.net | rawdex.net | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 123 | reset-scans.org | reset-scans.org | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 124 | cultivationmanhua.com | cultivationmanhua.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 125 | manhwaread.com | manhwaread.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 126 | manhwabuddy.com | manhwabuddy.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 127 | wto.to | wto.to | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 128 | sukima.me | sukima.me | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 129 | comix.to | comix.to | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 130 | youngchampion.jp | youngchampion.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 131 | manga-one.com | manga-one.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 132 | book.dmm.com | book.dmm.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 133 | newmanhwa.com | newmanhwa.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 134 | fxfx302.com | fxfx302.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 135 | comic-meteor.jp | comic-meteor.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 136 | omegascans.org | omegascans.org | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 137 | readallcomics.com | readallcomics.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 138 | ranfren.neocities.org | ranfren.neocities.org | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 139 | utoon.net | utoon.net | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 140 | manhuapica.com | manhuapica.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 141 | comic-ryu.jp | comic-ryu.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 142 | ctccomic.com | ctccomic.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 143 | nyaa.fan | nyaa.fan | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 144 | mangago.me | mangago.me | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 145 | rinkocomics.com | rinkocomics.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 146 | roliascan.com | roliascan.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 147 | novelpia.com | novelpia.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 148 | zerobywai.com | zerobywai.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 149 | toongod.cc | toongod.cc | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 150 | kingofshojo.com | kingofshojo.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 151 | weebcentral.com | weebcentral.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 152 | lrr.tvc-16.science | lrr.tvc-16.science | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 153 | mangarawad.org | mangarawad.org | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 154 | manga-park.com | manga-park.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 155 | mangaflame.org | mangaflame.org | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 156 | manhwa404.com | manhwa404.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 157 | xmanga.org | xmanga.org | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 158 | florascans.net | florascans.net | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 159 | comic.mf-fleur.jp | comic.mf-fleur.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 160 | komiic.com | komiic.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 161 | manhwaus.org | manhwaus.org | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 162 | tichct.org | tichct.org | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 163 | manhuaplus.org | manhuaplus.org | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 164 | manhuazhan.com | manhuazhan.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 165 | blossommanga.com | blossommanga.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 166 | w226.npdn.top | w226.npdn.top | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 167 | komiku.com | komiku.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 168 | webtoonraw.com | webtoonraw.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 169 | kissmanga.in | kissmanga.in | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 170 | 02.ikiru.wtf | 02.ikiru.wtf | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 171 | mangahub.ru | mangahub.ru | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 172 | ezmanga.org | ezmanga.org | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 173 | magustoon.org | magustoon.org | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 174 | violetscans.org | violetscans.org | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 175 | publicdiplomacymagazine.com | publicdiplomacymagazine.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 176 | raw1001.net | raw1001.net | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 177 | mkissa.to | mkissa.to | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 178 | iqiyi.com | iqiyi.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 179 | jcomic.net | jcomic.net | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 180 | tapas.io | tapas.io | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 181 | kagane.to | kagane.to | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 182 | soraraw.com | soraraw.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 183 | gomuraw.biz | gomuraw.biz | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 184 | webtoonscan.com | webtoonscan.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 185 | zipcomic.com | zipcomic.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 186 | zerobywzz.com | zerobywzz.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 187 | dokusho-ojikan.jp | dokusho-ojikan.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 188 | bomtoon.com | bomtoon.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 189 | copymanga.site | copymanga.site | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 190 | readcomiconline.li | readcomiconline.li | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 191 | championcross.jp | championcross.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 192 | mechacomic.jp | mechacomic.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 193 | kuragebunch.com | kuragebunch.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 194 | ichicomi.com | ichicomi.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 195 | rookie.shonenjump.com | rookie.shonenjump.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 196 | manhwa-raw.com | manhwa-raw.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 197 | s1.managall.com | s1.managall.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 198 | manhwato.com | manhwato.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 199 | kuaikanmanhua.com | kuaikanmanhua.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 200 | mangapark.net | mangapark.net | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 201 | mangasuika.com | mangasuika.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 202 | firemanga.com | firemanga.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 203 | lmanga.com | lmanga.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 204 | manhwahub.net | manhwahub.net | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 205 | manhuatop.org | manhuatop.org | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 206 | aedexnox.vxviral.xyz | aedexnox.vxviral.xyz | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 207 | manhuabika.com | manhuabika.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 208 | rawotaku.com | rawotaku.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 209 | pixiv.app | pixiv.app | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 210 | speed-manga.com | speed-manga.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 211 | yomonga.com | yomonga.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 212 | global.manga-up.com | global.manga-up.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 213 | mangaball.net | mangaball.net | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 214 | yanmaga.jp | yanmaga.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 215 | viewer.bookhodai.jp | viewer.bookhodai.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 216 | play.comipo.app | play.comipo.app | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 217 | arenascan.com | arenascan.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 218 | luvyaa.my.id | luvyaa.my.id | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 219 | toondex.co | toondex.co | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 220 | manwadd.cc | manwadd.cc | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 221 | saucemanhwa.com | saucemanhwa.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 222 | mangakoinu.com | mangakoinu.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 223 | comicmanga.cc | comicmanga.cc | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 224 | mangajikan.com | mangajikan.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 225 | manhwaden.com | manhwaden.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 226 | dvamh-vzwp7.top | dvamh-vzwp7.top | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 227 | comic.pixiv.net | comic.pixiv.net | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 228 | comico.jp | comico.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 229 | manhwas.men | manhwas.men | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 230 | ridibooks.com | ridibooks.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 231 | sunday-webry.com | sunday-webry.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 232 | ynjn.jp | ynjn.jp | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 233 | mangayun.com | mangayun.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 234 | manhwaweb.com | manhwaweb.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
| 235 | a-i-manga.com | a-i-manga.com | 通用图片阅读器检测范围；未逐站实测 | 确认正文选择器、访问条件、页序和原图恢复 |
