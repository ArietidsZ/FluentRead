# 上游修复后的浏览器失败归因与修复

> 用例精简更新：后续按用户要求移除了已经失效的 Steam 原讨论样本（悬浮、全文共 2 项）。当前执行矩阵为 39 页、78 项：62 项必测及 16 项观察用例。下文 80 项、18 项未通过是精简前的真实执行记录；移除的 2 项没有计为通过，退役依据见“用例精简决定”。

本次继续检查上一轮未通过的 14 项真实站点用例和 1 项划词触发用例，并处理用户截图中 GitHub 技术标签被误译的问题。起点为任务分支 `2a22ee1`；以修改前的 `4d1d9e5` 产物作为必要的归因对照。此前的 42/56 结果来自探索过程，不作为本次最终版本通过的证据。

已修复 Scribble 代码表格、GitHub 仓库技术元数据以及 Ubuntu 手册命令误译。按照“完成所有测试”的要求，本轮继续执行七组标准浏览器套件、三组上游专项，以及原先的所有联网观察用例；对测试脚本失配和真实产品缺陷分别归因。最终源码的 2,895 项分组测试全部通过，严格覆盖率套件 2,177 项通过且四维 100%。最终同份产物完成 62/62 项必测站点、7/7 组标准浏览器套件和 3/3 组专项；另外 18 项观察用例受网站或能力边界限制，未计为通过，逐项证据见下文。

## 验证原则

- 产品缺陷必须通过实际 DOM、请求或最小回归复现确认；不能由一个超时直接推断。
- 页面改版导致的测试失配要恢复同等语义覆盖，不能删除保护断言或把失败随意移入 quarantine。
- 使用独立生产构建副本进行浏览器验证，构建过程不改写正在加载的产物。
- 使用临时 Edge 配置和 focus-safe helper，保持窗口可见但不抢前台焦点。

## 逐项归因

| 原失败 | 已确认的原因 | 修复与专项验证 |
| --- | --- | --- |
| Brown Racket 代码被翻译 | `table.RktBlk` 是 Scribble 生成的代码块，通用边界没有保护它；修改前基线也出现 23 个代码内译文节点 | 修复产品保护边界。精确保护代码表格，普通表格和相邻正文仍可译；旧实现单测失败，修复后真实 hover/full 均通过 |
| Shift 划词与悬浮冲突 | 上一 Alt 悬浮用例留下译文；测试重建同 ID、同正文节点，触发正常的译文重挂载恢复。Shift 前后译文数量均为 1，请求数量均为 6，按键没有新增悬浮翻译 | 每次悬浮回退后用真实快捷键恢复原文，并断言下一项初始无译文。原 `2a22ee1` 与修改前 `4d1d9e5` 产物均 37/37 通过，无需修改产品仲裁 |
| LearnOpenGL 恢复结构差异 | 测试在宿主 MathJax 尚未排版完成时采集基线。无扩展对照也会从预览节点变为两个 `MathJax_Error` | 等待既有 `Hub.Queue` 完成后才采集快照，不触发额外排版，不忽略结构差异。真实 hover/full 均通过，恢复结构零差异；本次成功执行宿主公式 errors=[] |
| SQLite 全文断言失败 | 原选择器依赖 `>b:first-child`，翻译插入包装后匹配发生变化，误选语法标签 `select-stmt：` 并要求产生中文 | 使用稳定的后代语义关系排除语法标签，同时保留正文中的普通语法链接；真实 hover/full 通过 |
| GitHub Microsoft | TypeScript 描述仍存在，但网站已移除 `itemprop=description` | 更新同一条目的描述选择器，真实 hover/full 通过 |
| GitHub 技术标签误译（用户截图补充） | 仓库列表的新组件结构未被现有元数据规则覆盖，导致 Python、Java、Go 等被当作正文，Public 等字段还会出现在双语副本中；相关适配器在 `4d1d9e5` 与 `2a22ee1` 间没有变更 | 按 TopicsList、LabelsContainer 和可见性徽标的组件结构保护，排除翻译请求与双语副本中的这些字段；新增必须存在的真实页面保护断言，最新 GitHub hover/full 专项 10/10 通过 |
| MkDocs | runner 先等祖先 `hidden` 消失再滚动，但入场动画需要先滚入视口；旧契约还强制要求首页不存在的代码块 | 先滚动有布局的候选，再等语义可见；实际 SVG 必须保护，代码出现时仍必须检查。补上祖先解除 hidden 后的动态后代覆盖；首轮与重译均覆盖 6 个 h1、13 个 h2、22 段正文 |
| Roadmap | 网站导航不再使用 `header`，旧 logo SVG 选择器为空 | 改为实际 logo 的语义选择器，真实 hover/full 通过 |
| example.com | 正文为 `body > div`，没有旧契约要求的 `main` | 更新标题和段落区域，保留两个段落的覆盖要求；真实 hover/full 通过 |
| Pro Git | 原章节没有测试要求必须存在的代码块 | 使用包含实际代码的 Recording Changes 章节，保留多级标题、正文及强制代码保护要求；真实 hover/full 通过 |
| Wikipedia 全文等待 | 上轮 150 秒总预算过短。按默认预算重跑后，210 秒的固定整批等待仍会在队列持续完成时提前失败；连续记录显示译文数 636→694→750→803→862，正在处理的目标与请求持续变化 | 改为连续没有完成进展才超时，并保留 3 倍阶段硬上限和矩阵总 watchdog；补充 11 条行为测试。真实 hover/full 通过；全文首轮及重译各 1,467 个译文节点，父节点无重复，标题和 139 段正文全覆盖，恢复结构零差异 |

## 完整补测发现与修复

| 补测问题 | 已确认的原因 | 处理与验证 |
| --- | --- | --- |
| Ubuntu 手册中的 apt、--help 与命令标签被翻译 | 网站现已从整块 PRE 改成语义 HTML；旧标签修复版能翻译说明，也错误翻译命令元数据 | 新增仅用于 Ubuntu 手册域名及路径的适配器，按章节、字面字体和命令标签结构保留命令，不使用命令词表；说明段继续翻译。独立复核捕获初版规则过宽，补入普通说明反例后收窄；未知命令、动态标签、原 DOM 身份与域名路径反例全部通过，新适配器四维覆盖率 100% |
| MkDocs 重译时悬浮偶发未命中 | 固定元素比例坐标在页面入场动画后落到容器，而非原文字形 | 通过原文 Text Range、可见性和 elementFromPoint 找到稳定命中点，再发送一次真实快捷键；不禁用动画、不重复触发，新增移动、遮挡和永久不可命中行为测试 |
| 文档套件未完成 | 设置标题改名导致旧文本定位失效，新 profile 的语言引导遮住 Popup 文档入口 | 使用现有控件的稳定可访问名称；通过真实 UI 完成语言引导再点击文档入口。保留 12 格式及二进制导出断言，等待新页与点击合并以正确传播失败 |
| 用户脚本 Shadow 内容断言偶发过早 | 主段落完成时，静态或动态 Shadow 段落仍在翻译 | 翻译、恢复、重译均等待标题、主段落及静态/动态 Shadow 内容完成，再执行原有断言；没有增加超时或删除检查 |
| 设置 UI 套件触发焦点保护 | 长矩阵后的新 Target 创建/自动附加使 Edge 原生窗口成为前台；激活发生在 Popup 导航和 helper 定位之前，不是新的 FluentRead Popup 代码引起 | 复用既有隔离页，三项外观检查各执行 about:blank → Popup 的完整导航，销毁旧文档并重读配置；前面的独立关闭/重开测试保留。所有焦点 guard 保留，另用连续 PID 监控验证，未通过“恢复前台”掩盖事件 |
| Pub.dev 与 Hacker News 历史观察用例 | Pub.dev 的旧摘要选择器指向隐藏副本，实际可读区域在 README；Hacker News 本轮已恢复可访问 | Pub.dev 契约覆盖可见摘要、标题、正文及必须存在的 fenced/inline code；可稳定执行的用例恢复为 required，再用最终产物验证 |

## 技术标签的处理方式

这次不内置 Java、Python 等关键词表。GitHub 适配器按仓库列表的实际组件结构识别技术标签组、语言/许可证/统计字段以及 Public/Private 徽标，保留其原始节点和文字，同时从翻译输入及双语副本中排除。新出现的技术名称也会沿用同一规则。

回归测试使用了未内置的 `QuasarLang2027` 和动态添加的 `FutureRuntime`，并检查普通正文、README 中含 Java/Python 的句子、正文中的 topics 链接仍可翻译；不会因为普通元素也叫 TopicsList 就跳过整段正文。真实 Microsoft 仓库列表中，Java、Python、TypeScript、Go 和 Public 保持原文，描述仍正常生成中文，标签下方没有多余译文。

该修复明确覆盖截图中的 GitHub 仓库列表组件，不代表所有网站或 GitHub 所有页面的任意标签都已受保护。本轮不需要通用词表，也没有修改参考仓库或复制其代码。

## 测试可靠性补充

- 产物新鲜度扫描补入迁移后的 `src`，拒绝源码变更后仍使用旧构建。
- 临时 profile 清理增加有限重试，处理浏览器关闭后的写盘尾部竞态，仍只清理本次创建的配置目录。
- 动态覆盖不能仅检查初始可见正文；解除祖先 hidden 后出现的所有契约后代都必须纳入漏译和恢复检查。
- 等待器以真实 DOM owner 身份识别任务，支持多个无 ID、同文本的 unchanged 结果；不因动画、同 owner 的 spinner 重建或宿主同名 class 增加而延长等待。所有成功和失败路径都清理临时状态。

## 最终验证

### 最新源码的确定性验证

命令：`VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 pnpm test:regression:all`，退出码为 0。

| 检查 | 结果 |
| --- | --- |
| 架构测试 | 605/605，23 个文件 |
| 单元测试 | 1,538/1,538，106 个文件 |
| 功能测试 | 446/446，33 个文件 |
| 回归测试 | 306/306，15 个文件 |
| 分组测试合计 | 2,895/2,895，177 个文件 |
| 严格覆盖率套件 | 2,177/2,177；该配置的语句、分支、函数、行覆盖率均为 100% |
| 测试清单审计、WXT prepare、TypeScript 编译 | 通过 |
| Chrome、Firefox 构建、Firefox 打包与清单校验 | 通过 |
| 用户脚本构建与产物校验 | 通过 |
| 文档构建、`git diff --check` | 通过 |

Hacker News、Ubuntu 和 Pub.dev 恢复为 required 后，又执行测试清单审计及完整回归组，306/306 通过；没有降低阈值、删除保护断言或把失败必测转为观察项。

严格覆盖率套件与分组测试有重叠，不额外计入 2,895 项。本轮把 Ubuntu 新适配器加入严格覆盖率清单，并满足原有四维阈值。Firefox 结论仅为构建、打包及清单校验，没有声称实际 Firefox 浏览器运行通过。

### 最终产物与浏览器验证

最终冻结的 Chrome 产物为 `/private/tmp/fr-completion-final-chrome`，230 个文件，逐文件与完成本轮构建的产物校验一致。所有最终浏览器测试使用这个固定副本，避免构建期间加载不完整文件。

- 目录摘要：`84553a264d4edc2dbb2f8f9c16795ce766563fbff5a6510290dbce9264dc24f8`。
- content script SHA-256：`8f45e387f6efe2ea32f22946927a8aaf48f44058c6a007ad43258e4fce18be1b`。
- 同次构建的用户脚本：`/private/tmp/fr-completion-final.user.js`，SHA-256 `d74a20c36e3a805140b339cfa1a6bc459b40860c93a1477f91f751eb6aad76d5`。

最终必测站点矩阵 **62/62 全部通过**：31 个页面、27 个主机，每页均执行 hover/full。相比原 56 项，新增 Ubuntu、Pub.dev 和恢复访问的 Hacker News 六项必测。

- 31 项 hover 的各契约目标均完成 1→0→1，邻段计数均为 0→0→0。
- 31 项 full 均完成翻译、恢复、再次翻译；恢复后的 owned/changed/missingStatic 计数全部为 0。
- GitHub 五页专项 10/10；Microsoft 列表的技术标签、语言、许可证、统计和可见性徽标保持原文，描述继续翻译。
- Wikipedia 两轮各 1,467 个译文节点，ar5iv 两轮各 325 个译文节点；长页没有通过截短覆盖或放宽等待门槛标绿。
- 所有最终站点报告均为后台正常尺寸隔离窗口、browserFrontmost=false。结束后逐文件复核，230 个 Chrome 文件仍与冻结清单和构建目录一致。

汇总及自动核对结果：`/private/tmp/fr-completion-final-summary.json`。原始站点日志为 `fr-completion-final-network-a.log`、`fr-completion-final-network-b.log`、`fr-completion-final-ubuntu-required.log`、`fr-completion-final-hackernews.log`，均位于 `/private/tmp`。

七组标准浏览器套件 **7/7 全部通过**，每组 runner 退出码均为 0：

| 套件 | 最终验证范围 | 证据目录（均位于 /private/tmp） |
| --- | --- | --- |
| 划词与触发 | 37/37；修饰键、冲突仲裁及恢复状态 | fr-completion-final-selection-trigger |
| 全文翻译 | 翻译/恢复/重译、动态与 Shadow 内容、浮动 UI、加载样式的宿主 CSS 隔离及 reduced-motion | fr-completion-final-full-page-translation |
| 视频字幕 | 重绘、渐进字幕、预取、AI 上下文、下载及跨页配置 | fr-completion-final-video-subtitle-fixture |
| 文档翻译 | 12 种文件加载；PDF/EPUB/DOCX 实际导出及格式签名/结构；模型选择、Popup 语言引导和文档入口 | fr-completion-final-document-translation |
| 隐私边界 | 非可信页面事件、宿主与 Shadow 边界、凭据生命周期、导出恢复 | fr-completion-final-privacy-boundary |
| 用户脚本 | 冻结的同次构建脚本；主段落、标题、静态与动态 Shadow 内容、重注入、跨页计数持久化、bridge 清理 | fr-completion-final-userscript-smoke |
| 设置界面 | 47 项顶层断言、302 张截图、2 组持久化场景；11 次皮肤导航及 3 次清空页面后重载；连续前台监控没有检测到测试 Edge 抢前台 | fr-completion-final-settings-center-ui |

三组上游专项 **3/3 全部通过**：纯文本/X Chat/Discord/HTML 代码边界均完成 hover/full 的 1→0→1→0，并检查请求与副本排除元数据；原生 modal 验证滚动、0.8/2 倍缩放、真实关闭、slot/host 自愈与移除恢复；输入法验证真实 composition 期间不保存中间值、提交中文后持久化。证据分别为 `fr-completion-final-boundaries/report.json`、`fr-completion-final-modal/report.json` 和 `fr-completion-final-ime/report.json`。

七组标准套件的错误记录均为空，全部套件使用后台临时配置；最终 Microsoft 仓库页、modal 词卡和设置窄屏截图已目视检查。标准浏览器汇总为 `/private/tmp/fr-completion-final-browser-summary.json`，设置连续焦点记录为 `/private/tmp/fr-completion-final-settings-center-ui-focus-events.jsonl`。

### 观察用例的明确边界（精简前执行记录）

本轮确实尝试了原先全部 12 个 quarantine 页面的 hover/full，并对失败页面补充真实 DOM/HTTP 诊断。没有因测试失败把 required 用例移入 quarantine。Ubuntu、Pub.dev 和 Hacker News 可测后恢复为 required；剩余 9 个观察页面共 18 项不能计为通过。

| 观察页面 | 本轮证据与结论 |
| --- | --- |
| DarkLyrics | 导航 ERR_CONNECTION_CLOSED，未取得正文 |
| Reddit | 返回 “Reddit - Prove your humanity” 人机验证页，未取得评论；没有绕过验证 |
| TalkClassical | HTTP 202 空白响应，正文目标为零 |
| Steam 原始讨论 | 网站明确显示该物品不存在，原始讨论已删除 |
| W3C | HTTP 403 Cloudflare 安全验证页，未取得正文 |
| ScienceDirect | HTTP 403 人机验证页，未取得文章 |
| Kaggle | HTTP 200 教程外壳，等待后 main/article 段落仍为零；未观察到登录墙或验证码，不能将其推断为登录限制 |
| RFC 4251 | 30 个 HTML PRE 仍受通用代码保护；格式化纯文本的专用语义分段尚未实现，不能靠放开所有 PRE 来满足正文翻译断言 |
| 小众软件 | 页面是中文，旧标题选择器也已失配；当前矩阵要求必须产生译文，缺少该用例需要的同语种 no-op/布局模式。失败发生在翻译前置契约，不能声称同语种功能已失败或已通过 |

以上 18 项属于外部访问/内容限制或尚未覆盖的专用测试与产品能力，完整记录而不标绿；因此“所有必测通过”不等于“全部 80 个观察与必测用例都通过”。外部访问与契约失配项未进入有效正文翻译；RFC 属于明确记录的 PRE 产品能力边界。诊断来自本轮标签版本，不拿它们替代最终构建的功能通过证据。

### 用例精简决定

从执行矩阵移除 `steam-workshop-discussion-3246316298` 的 hover/full。它来源于 FluentRead Issue #49，原 URL 为 `https://steamcommunity.com/workshop/filedetails/discussion/3246316298/4334231305373971730/`。本轮诊断收到 HTTP 200 错误页，明确显示“该物品不存在。可能是已被其作者移除”，原帖 `.forum_op .content` 和回复 `.commentthread_comment_text` 均为零；这个 URL 已不能验证原定行为。

保留 `steam-changelog` 的同站正文、Hacker News 的评论以及标准全文套件的动态插入覆盖。它们不等价于 Steam 论坛 DOM；Issue #49 的原帖、动态回复需求继续留在本记录中，今后取得可用样本或等价夹具后再补验证。

其余八个观察页保留，包括 RFC 分段能力、小众软件同语种布局测试缺口，以及尚不能取得正文的六个站点。31 个 required 页面及全部配置逐项保持一致，仍为已通过的 62 项；严格覆盖率和矩阵覆盖门槛未改。当前 16 项观察用例仍未通过，不能把退役样本解释成修复完成。

### 证据与交付

- 完整本地流水线：`/private/tmp/fr-completion-final-regression.log`。
- 最终产物逐文件清单：`/private/tmp/fr-completion-final-artifact.json`。
- 原先全部观察用例执行日志：`/private/tmp/fr-complete-tests-05d86c8-network-a.log`、`/private/tmp/fr-complete-tests-05d86c8-network-b.log`。
- 观察页面诊断：`/private/tmp/fr-complete-tests-05d86c8-network-b-diagnostics/summary.json`。
- Ubuntu 旧产物误译对照：`/private/tmp/fr-complete-tests-05d86c8-ubuntu-current.log`；普通说明反例先失败后通过：`/private/tmp/fr-complete-tests-manpage-prose-red.log`、`/private/tmp/fr-complete-tests-manpage-prose-green.log`。
- 此前标签产物的 56/56 补验汇总：`/private/tmp/fr-complete-tests-05d86c8-required-summary.json`，仅保留为历史证据，不与最终构建混算。

上一条报告中“审批额度耗尽导致 37 项未启动”的限制已在本轮解除，原缺口已实际补测。所有浏览器使用临时隔离配置和后台焦点保护；X Chat/Discord、弹窗、输入法等专项为真实浏览器内的等价夹具，不冒充已登录真实网站验证。

以上 `/private/tmp` 文件是本机证据，可能随系统清理消失；本报告保留归因、测试数量、摘要及验证边界。修改保存在独立工作树的本地分支，未上传或合并 PR。FluentRead 主工作树和两个参考仓库未被修改。
