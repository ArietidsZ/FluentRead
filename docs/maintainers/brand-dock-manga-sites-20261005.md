# 常驻品牌与漫画阅读页适配

右侧工具默认常驻：网页翻译在上，流畅阅读 / FluentRead 品牌在中，漫画按钮和设置在下。离开鼠标、闲置与 Escape 不收回默认工具。已保存的关闭或显式悬停偏好继续保留；品牌可拖到任一边缘，窄屏保持在视口内。独立漫画入口同样默认常驻。

完整名称与访问状态见[235 项清单](./manga-sites-20261003)。阅读器目录增加 Issue 中确认的域名和当前公开重定向别名；纠正 KLMANGA、Manga4u、Syosetu 等名称映射。JinMangas 尚缺可确认的现用链接，保留待确认标签。其余登记表示自动检测范围，不能据此宣布所有章节通过。

WeebCentral 使用 `#chapter-images img`，Dynasty 使用 `#reader #image img`，避免复数章节路径和缩略图容器导致正文被漏掉。Rawkuma、Uzaki、Kaiji 等按实页结构限制正文选择器。GigaViewer 系列仅匹配正文页，不翻译推荐封面。其画布，以及 YanMaga 和 Televi-Kun 的分片阅读器提供圈选入口，沿用已有圈选翻译和权限开关，不声称自动连续翻译画布。

适配根据用户清单、公开 Issue 链接和阅读页 DOM 独立实现；没有使用 read-frog 或 kiss-translator 的代码，也未修改这些参考项目。模型、译图算法、翻译服务和版本号沿用现有实现。

## 验证范围

- 10 个相关测试文件覆盖配置、位置、网站匹配、阅读器生命周期、入口端口、i18n 和架构边界；共 1121 项通过。
- 新增 `mangaReaderProfiles.ts` 的 statements、branches、functions、lines 覆盖率均为 100%。
- 隔离 Edge 使用 `macos-background-cdp` 和 `launchservices-no-foreground`，正常可见窗口位于第二屏；使用临时 profile，结束后关闭专属浏览器并删除 profile。
- 22 个入口场景通过，验证常驻品牌、显式悬停、拖动、窄屏、多语言、235 名称搜索、规则保存、圈选按钮、总开关及明确指定的六个实页入口。宿主脚本异常单独记录；Uzaki 的无来源语法异常在不加载扩展的同一章节复现，按精确 URL 与错误匹配基线，扩展来源异常仍使测试失败。
- 用户指定 MANGA Plus `/viewer/1028732`：真实生产 PaddleOCR 和在线 Google 翻译核对两页，验证开启、译图、原图恢复、缓存复用与滚动续译。约 19 秒首张、84 秒第二张；仅为当前设备的样本，质量和耗时不能推广至所有章节。模型从本地文件导入并由扩展校验，无需重复下载。
- Chrome、Firefox 与油猴生产构建通过，manifest 和油猴产物校验通过；Firefox 和油猴仅验证构建，未做运行时实页测试。文档构建通过。

原始临时证据位于 `/private/tmp/fluentread-brand-manga-sites-20261005`。仓库保留的状态摘要位于 `scripts/testing/evidence/manga-site-checks-20261005.json`，不包含章节图片或原始网页 HTML。

## 复现入口

`scripts/testing/probe-manga-sites.py` 可显式传入 `--hosts` 核对公开首页。`inspect-manga-readers.cjs` 要求 `--urls-file`；`--headless-research` 仅做不加载扩展的 DOM 调查，不作为扩展运行时验证。

`run-manga-entry-ui-test.cjs` 用 `--site-url` 指定主实页，用 `--reader-sites` 的 JSON 数组明确限定额外阅读页，例如 `{ "url": "https://dynasty-scans.com/chapters/the_nth_encore", "mode": "images" }`；画布站的 mode 为 `area`。不传该文件不额外扫描网站。

`run-manga-translation-test.cjs` 的 `--reader-smoke --live-site --live-translation --quality-pages 2` 只验阅读链路；需 Node 22 以上的内置 WebSocket、Playwright、focus-safe helper、已构建扩展及可访问的模型文件。运行时模型检查仍验证本地导入文件的尺寸和哈希。

可用 `--host-baseline` 提供不加载扩展的 DOM 调查报告，以核对没有栈信息的站点异常；脚本要求报告 purpose 明确为无扩展调查，并按精确页面地址与错误匹配，不忽略扩展栈。
