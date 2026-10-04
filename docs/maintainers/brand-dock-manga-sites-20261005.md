# 常驻品牌与漫画阅读页适配

右侧工具默认常驻：网页翻译在上，圆形品牌图标在中，漫画按钮和设置在下；不显示品牌名称或文字胶囊。离开鼠标、闲置与 Escape 不收回默认工具。已保存的关闭或显式悬停偏好继续保留；品牌图标可拖到任一边缘，窄屏保持在视口内。独立漫画入口同样默认常驻。

完整名称与访问状态见[235 项清单](./manga-sites-20261003)。阅读器目录增加 Issue 中确认的域名和当前公开重定向别名；纠正 KLMANGA、Manga4u、Syosetu 等名称映射。JinMangas 尚缺可确认的现用链接，保留待确认标签。其余登记表示自动检测范围，不能据此宣布所有章节通过。

WeebCentral 使用 `#chapter-images img`，Dynasty 使用 `#reader #image img`，避免复数章节路径和缩略图容器导致正文被漏掉。Rawkuma、Uzaki、Kaiji 等按实页结构限制正文选择器。MangaDNA 使用 `.read-manga .read-content > img`，排除章节导航外的封面。GigaViewer 系列仅匹配正文页，不翻译推荐封面；Comic Zenon 加入同一正文规则。

后续公开章节调查补齐 Asura Scans、Arenascans、Kingofshojo、Violet Scans、MangaRead、MangaForFree、ManhwaBuddy、Vortex Scans、Jump Rookie、Webtoons、Mgeko、Rolia Scan、MangaDex 和 Twitter Comic 的正文规则；Asura 和 Violet 的当前首页重定向别名一并登记。正文容器外的推广封面不进入连续队列。Ichicomi 的公开章节采用 GigaViewer 受跨域限制画布，加入同一圈选规则。Yaksha 的重定向别名登记为 Ravenscans，但本次没有确认其正文，不能据此宣布实章可译。

Champion Cross、Comic Ryu 和 Comic Growl 的公开可读画布接入现有串行漫画会话，使用独立快照识别与合成，原画布及翻页样式保持不变。画布重绘、翻页、配置变化和卸载取消旧结果；译图跟随正文几何及祖先裁切，透明翻页层继续接收原有交互。压缩图块缓存沿用有界轻量缓存。GigaViewer 的受污染画布，以及 YanMaga 和 Televi-Kun 的分片阅读器仍提供圈选入口，沿用已有圈选翻译和权限开关。

适配根据用户清单、公开 Issue 链接和阅读页 DOM 独立实现；没有使用 read-frog 或 kiss-translator 的代码，也未修改这些参考项目。模型、译图算法、翻译服务和版本号沿用现有实现。

## 验证范围

以下分别记录最初图片/入口轮次和纯图标修正；首页登记、DOM 结构调查、入口测试与实际识别翻译的范围不同。

- 10 个相关测试文件覆盖配置、位置、网站匹配、阅读器生命周期、入口端口、i18n 和架构边界；共 1121 项通过。
- 新增 `mangaReaderProfiles.ts` 的 statements、branches、functions、lines 覆盖率均为 100%。
- 隔离 Edge 使用 `macos-background-cdp` 和 `launchservices-no-foreground`，正常可见窗口位于第二屏；使用临时 profile，结束后关闭专属浏览器并删除 profile。
- 22 个入口场景通过，验证常驻品牌、显式悬停、拖动、窄屏、多语言、235 名称搜索、规则保存、圈选按钮、总开关及明确指定的六个实页入口。宿主脚本异常单独记录；Uzaki 的无来源语法异常在不加载扩展的同一章节复现，按精确 URL 与错误匹配基线，扩展来源异常仍使测试失败。
- 品牌改为纯图标后，重跑 16 个相关入口场景：无可见品牌文字、圆形外观，漫画页 32×32、普通页 40×40，常驻、手动悬停、两侧拖动和 320 像素窄屏通过。专属浏览器始终未处于前台，无扩展异常，截图已更新；此次没有重复 OCR 和在线翻译。
- 用户指定 MANGA Plus `/viewer/1028732`：真实生产 PaddleOCR 和在线 Google 翻译核对两页，验证开启、译图、原图恢复、缓存复用与滚动续译。约 19 秒首张、84 秒第二张；仅为当前设备的样本，质量和耗时不能推广至所有章节。模型从本地文件导入并由扩展校验，无需重复下载。
- Chrome、Firefox 与油猴生产构建通过，manifest 和油猴产物校验通过；Firefox 和油猴仅验证构建，未做运行时实页测试。文档构建通过。

后续画布适配新增验证：

- 可读画布、混合图片/画布串行调度、原文恢复、重绘失效、缓存与裁切，以及五个新地址匹配：4 文件共 131 用例通过。画布控制器、阅读器、会话、合成器和站点规则四维覆盖率均为 100%。
- 模块边界、794 项源文件头检查、图片翻译、漫画入口和压缩图块：5 文件共 869 用例通过；没有执行全量架构回归。
- 新一轮 21 个隔离入口场景通过，包含原有 16 个纯图标场景，以及 MangaDNA、Comic Zenon、Champion Cross、Comic Ryu 和 Comic Growl 的五个实章入口，均收到 HTTP 200。此轮入口测试不执行 OCR。新增 DOM 调查后共有 24 个阅读页样本，调查均不加载扩展。
- 画布真实运行额外核对采样稳定性：公开章节无扩展对照的 12 次读取中，整页缩小的平滑和最近点采样都出现不同哈希，原画布完整像素保持一致；整数坐标一比一像素网格抽样保持稳定。控制器改用该网格抽样，实际浏览器检查完整像素回读、鼠标离开和译图持续显示，不能只以合成结果或按钮状态判断屏幕显示。

Champion Cross `/episodes/0a8f0118f1839` 使用生产 PaddleOCR 和在线 Google：四个场景通过，核对首组译图、暂停复用、正常翻页及总开关清理；原画布像素与样式保持一致。整数网格抽样修正后，原页不再出现重复 OCR；首组约 42.5 秒，仅为本机样本。截图显示初始页和后续页的部分中文译文，注音和艺术字仍有漏识别及原文残留。六次图片操作包含空白和翻页取消等情况，不等同于六页成功译完。隔离浏览器始终未处于前台，扩展与页面异常均为零，profile 已删除。

一次鼠标移开后的截图出现黑帧；后续相同条件补查确认译图像素、几何和页面 surface 截图正常，未复现持续产品问题。窗口级 CDP 截图方式不可用，该补充诊断报告因此失败，不计入四个通过场景；仍保留黑帧和诊断证据，不把单次截图结果外推为全部设备显示保证。

后续正文规则验证：

- 两个相关测试文件共 143 用例通过，覆盖正文发现、推广封面排除、暂停恢复与域名/路径边界；站点规则模块四维覆盖率均为 100%。
- 新增 18 个公开章节 DOM 调查样本，累计 42 个；另外七个目录/作品页仅用于发现公开链接，不计入章节样本。Mangaoi 的章节链接返回 HTTP 200 但页面显示 404；Shinchan 的样本只呈现宣传图和账户/offer 框架；Ravenscans 未确认显示正文。这三个样本均保留未验证状态。
- 第二屏隔离 Edge 的 31 个入口场景通过，包含原有 16 个纯图标场景和明确指定的 15 个新实页入口，全部 HTTP 200。14 页显示漫画入口，Ichicomi 显示圈选入口。无扩展或扩展控制台异常，临时 profile 已删除；宿主的四个脚本异常在无扩展对照中复现并单独记录。
- 此轮没有执行新增站点的 OCR 或在线翻译。正文规则、DOM 调查与入口通过不代表长条漫画识别、完整章节翻译或质量通过。

全部 235 项逐站实章、登录和付费阅读器、Firefox/油猴运行时，以及漫画全文识别和翻译质量仍未完成。日文注音、艺术字与背景修补有漏识别、错识别和原文残留，不能把结构适配和链路通过当作质量保证。

原始临时证据位于 `/private/tmp/fluentread-brand-manga-sites-20261005`。仓库保留的状态摘要位于 `scripts/testing/evidence/manga-site-checks-20261005.json`，不包含章节图片或原始网页 HTML。

## 复现入口

`scripts/testing/probe-manga-sites.py` 可显式传入 `--hosts` 核对公开首页。`inspect-manga-readers.cjs` 要求 `--urls-file`；`--headless-research` 仅做不加载扩展的 DOM 调查，不作为扩展运行时验证。

`run-manga-entry-ui-test.cjs` 用 `--site-url` 指定主实页，用 `--reader-sites` 的 JSON 数组明确限定额外阅读页，例如 `{ "url": "https://dynasty-scans.com/chapters/the_nth_encore", "mode": "images" }`；不可读画布站的 mode 为 `area`；公开可读画布站为 `canvas`，可同时提供 `openSelector`、`pageKey` 和 `pageKeyTurns`，只执行已核对的阅读器操作。不传该文件不额外扫描网站。

`run-manga-translation-test.cjs` 的 `--reader-smoke --live-site --live-translation --quality-pages 2` 只验阅读链路；需 Node 22 以上的内置 WebSocket、Playwright、focus-safe helper、已构建扩展及可访问的模型文件。运行时模型检查仍验证本地导入文件的尺寸和哈希。Comici 画布用 `--canvas-reader --live-site --live-translation --site-url <公开章节>`，检查原画布像素及样式、译图、暂停复用、正常翻页与总开关清理。

可用 `--host-baseline` 提供不加载扩展的 DOM 调查报告，以核对没有栈信息的站点异常；脚本要求报告 purpose 明确为无扩展调查，并按精确页面地址与错误匹配，不忽略扩展栈。
