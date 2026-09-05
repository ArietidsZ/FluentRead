# 阅读蛙与简约翻译修复对照（2026-09-05）

> 本文保留首轮审查记录。最终整合与交付见[PR #447 验证报告](https://github.com/FluentRead/FluentRead/blob/main/docs/reports/upstream-integration-20260905.md)。随后对未通过用例的逐项归因、产品修复与最终验证见[浏览器失败跟进报告](./upstream-regression-followup-20260905.md)。

本轮以 FluentRead `4d1d9e5`（含 PR #430）为基线，检查阅读蛙近期 60 条标题含 fix 的已合并 PR，以及简约翻译的修复记录。参考目录只读；所有实现均按 FluentRead 的 Vue/WXT/TypeScript 架构独立编写。上游已修复不等于 FluentRead 也有同样缺陷，只有当前代码或回归复现支持的问题才进入实施。

## 逐项计划

| 顺序 | 问题与上游依据 | FluentRead 判定 | 实施与验证 |
| --- | --- | --- | --- |
| 1 | 图标字体连字误译：[阅读蛙 #1986](https://github.com/mengxi-ream/read-frog/pull/1986) | 已修复 | 按实时主字体保护 Google Symbols、Material Icons/Symbols、Font Awesome；原图标保留，连字不进入请求或双语副本，普通文字的 fallback 图标字体不受影响 |
| 2 | 纯文本页漏译：[阅读蛙 #2087](https://github.com/mengxi-ream/read-frog/pull/2087) | 已修复 | 仅放行 text/plain 的正文 pre；生产 Edge 验证悬浮/全文均为 1→0→1→0，HTML 代码保护保持有效 |
| 3 | X Chat 时间与回执误译：[阅读蛙 #2040](https://github.com/mengxi-ream/read-frog/pull/2040) | 已修复 | 限定 chat.x.com 的消息页脚；正文、长消息和主站隔离回归通过；元数据既不发给服务，也不复制进双语译文 |
| 4 | Discord 编辑时间戳误译：[阅读蛙 #1930](https://github.com/mengxi-ream/read-frog/pull/1930) | 已修复 | 仅保护消息容器直属编辑时间戳；支持旧新类名，原始 edited/日期节点保留，双语副本排除 |
| 5 | 输入法与自动保存冲突：[阅读蛙 #2156](https://github.com/mengxi-ream/read-frog/pull/2156) | 已修复 | 提示词 textarea 在 composition 期间不发出更新，提交后仅发最终值；设置页独立复制嵌套配置，避免编辑提前污染全局差分基线、导致保存被误判为空补丁 |
| 6 | 原生 modal 中划词层不可交互：[阅读蛙 #1924](https://github.com/mengxi-ream/read-frog/pull/1924) | 已修复 | 根据真实选区把 Shadow host 临时放入共同 dialog:modal；生产浏览器验证滚动 600px、0.8/2 倍缩放、关闭点击、slot/host 删除自愈、dialog 删除后恢复 |

## 已排除的重复修复

| 上游问题 | 当前实现与判定 |
| --- | --- |
| [阅读蛙 #2155：行内公式丢失](https://github.com/mengxi-ream/read-frog/pull/2155) | 当前基线已包含 FluentRead PR #430 的公式保护实现，本轮不重复移植 |
| [阅读蛙 #1992：body 外阅读模式漏扫](https://github.com/mengxi-ream/read-frog/pull/1992) | `runtime.ts` 已从 `document.documentElement` 扫描并监听，根范围已覆盖 |
| [阅读蛙 #2015：手动关闭后切标签又自动开启](https://github.com/mengxi-ream/read-frog/pull/2015) | `pageAvailability.ts` 仅在自动翻译条件 false→true 时启动；没有上游每次标签激活重新自动开启的路径 |
| [阅读蛙 #2030：Google 多行文本换行丢失](https://github.com/mengxi-ream/read-frog/pull/2030) | 当前 batchexecute 与备用 single 接口真实探测均保留换行；增加请求形状回归，不改 provider |
| [阅读蛙 #2103：空闲划词层拦截](https://github.com/mengxi-ream/read-frog/pull/2103) | 当前 Vue 根节点已由 v-show 在空闲时设置 display:none，不存在相同的空闲遮挡路径；活动 modal 另列第 6 项 |
| [简约翻译 #998：内部空白](https://github.com/fishjar/kiss-translator/commit/e7b64c2) | 实际请求来自 `TranslationTextSlot.source`，保留内部 tab/newline；`normalizeTranslationText` 用于比较，不能据此判定请求丢空白 |
| [简约翻译 #1010：模型目录旧响应](https://github.com/fishjar/kiss-translator/commit/86660e3) | 当前模型选项由本地 catalog/config 同步派生，没有异步目录请求竞态 |
| [简约翻译 #941：重复模型](https://github.com/fishjar/kiss-translator/commit/fd2c673) | `modelOptions.ts` 已去重并过滤内置项 |
| [简约翻译 #849：重复 wrapper](https://github.com/fishjar/kiss-translator/commit/0017cc1)、[#899：在途悬浮重触发](https://github.com/fishjar/kiss-translator/commit/f77d3a1) | 已有 session、generation、请求取消与双语工件接管机制 |
| [简约翻译 #943：字幕 track 缓存](https://github.com/fishjar/kiss-translator/commit/2898bbe) | 预翻译已有 in-flight 复用和导航清理；下载与预翻译并发属于额外性能候选，尚未以复现证明本轮必修 |
| [简约翻译 #997：partial JSON](https://github.com/fishjar/kiss-translator/commit/678be09)、[#918：CSSStyleSheet 回退](https://github.com/fishjar/kiss-translator/commit/a7e6ead) | 当前没有对应流式 JSON/构造样式表路径，不适用 |

## 验证记录

- 安装使用冻结锁文件，未升级依赖；WXT 0.20.18 prepare 完成。
- `pnpm test:regression:all` 完整通过：176 个测试文件、2,866 个分组用例；严格覆盖率组 132 文件、2,171 用例通过，语句/分支/函数/行均 100%。类型检查、Chrome/Firefox 构建、Firefox 发布包及 manifest 校验、油猴版构建及校验、文档构建均通过。日志：`/private/tmp/fr-upstream-final-regression.log`。
- 图标保护回归先在旧实现失败：独立图标进入全文候选；修复后回归通过。
- 图标保护在生产 Edge 本地服务夹具中通过全文翻译、恢复、重译；原图标保留，译文不泄露连字，21 次 fixture 请求均无图标连字。
- 图标浏览器报告：`/private/tmp/fr-upstream-final-fullpage/report.json`，`macos-background-cdp` / `launchservices-no-foreground`，第二屏正常窗口、`browserFrontmost=false`；不是实际 X Chat/Discord 登录页面验证。
- X Chat/Discord 测试在旧实现分别捕获时间回执和 edited/日期污染，修复后 2 项通过。
- 纯文本、X Chat、Discord、HTML 代码隔离夹具覆盖悬浮/全文 1→0→1→0；请求内容和双语副本分别断言。站点适配器新增 `omitFromTranslation`，只从副本排除元数据，原始节点不改动。最终报告：`/private/tmp/fr-upstream-boundaries-browser/report.json`，`ok=true`，8 次夹具请求、零运行时错误。
- Google 真实接口探测摘要保存在 `/private/tmp/fr-upstream-google-probe.md`。
- 原生弹窗生产报告：`/private/tmp/fluentread-modal-evidence-production-3/report.json`，`ok=true`；两档缩放下词卡截图均已检查，DOM 边界和真实关闭点击分别断言，测试窗口保持非前台。
- 输入法生产报告：`/private/tmp/fr-ime-final/report.json`，`ok=true`。未注入调试代码的生产 Edge 扩展通过真实 CDP `Input.imeSetComposition`/`Input.insertText`：拼音组合期间后台值不变，结束后保存最终中文，关闭并重开同一服务仍保持；其他服务提示词不变，无 console error。Element Plus 输入框已有 composition 保护，无需重复修改。
- 额外的原有划词触发矩阵通过 29 项，最后的 Shift 冲突检查失败（选区翻译时同时产生悬浮译文）。相同脚本和未修改的 `4d1d9e5` 基线得到相同失败，确认不是本轮引入；整组不能标为通过。证据：`/private/tmp/fr-upstream-final-selection/report.json`、`/private/tmp/fr-upstream-baseline-selection/report.json`。测试前置配置补齐语言引导已完成状态并重载 Popup，避免新 profile 的首次引导遮挡待测控件。
- 真实网站探索矩阵运行了 28 个页面（24 个 hostname）的 hover/full 共 56 项。首轮 31 项通过；其中 14 项受重建时产物暂时缺失影响，已用固定产物补跑，11 项通过。合并有效执行结果为 **42/56 通过**，不能视为完整矩阵通过。
- 剩余失败：GitHub Microsoft 列表缺少目标；MkDocs、Roadmap、example.com、Git Book 页面契约超时；Wikipedia 全文 watchdog；LearnOpenGL 恢复结构、Brown 代码保护、SQLite 全文滚动断言。Git Book 当前页没有契约要求存在的代码块，已由真实 DOM 诊断确认；LearnOpenGL 的相同两节点恢复断言已在未修改的 `4d1d9e5` 基线复现。其他失败需继续归因，不能统称产品回归或网络失败。
- Brown 与 SQLite 已另建未修改的 `4d1d9e5` 基线、冻结依赖并构建生产扩展，复跑得到与本轮相同的代码保护和滚动断言失败，确认先于本轮变更存在。证据：`/private/tmp/fr-upstream-baseline-extra-sites.log`；原基线产物保存在 `/private/tmp/fr-upstream-baseline-4d1d9e5-chrome`，临时基线 worktree 已清理。
- 原始矩阵日志：`/private/tmp/fr-upstream-sites.log`；固定产物补跑：`/private/tmp/fr-upstream-sites-retry.log`。矩阵跨越本轮增量构建，仅用于发现风险；针对本轮缺陷的最终生产夹具另行验证，不用探索矩阵冒充最终版本整体通过。
