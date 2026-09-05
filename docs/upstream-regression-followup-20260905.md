# 上游修复后的浏览器失败归因与修复

本次继续检查上一轮未通过的 14 项真实站点用例和 1 项划词触发用例，并处理用户截图中 GitHub 技术标签被误译的问题。起点为任务分支 `2a22ee1`；以修改前的 `4d1d9e5` 产物作为必要的归因对照。此前的 42/56 结果来自探索过程，不作为本次最终版本通过的证据。

已修复两处既有产品缺陷：Scribble 代码表格缺少保护、GitHub 仓库列表的技术标签等字段缺少保护。其余已复现失败来自测试隔离、页面改版、宿主异步排版或测试等待预算；本次没有发现这些失败是上一轮六项产品修改引入的回归。修正后的完整站点矩阵为 56/56，随后加入 GitHub 标签修复的最新版本完成 GitHub 专项 10/10 和自动化测试 2,885/2,885。两个浏览器验证版本的范围和未执行项见下文，不能合并表述为最新产物已完成全部浏览器补验。

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

命令：`VITEST_MAX_FORKS=4 VITEST_MIN_FORKS=1 pnpm test:regression:all`，退出码为 0。

| 检查 | 结果 |
| --- | --- |
| 架构测试 | 604/604，23 个文件 |
| 单元测试 | 1,534/1,534，106 个文件 |
| 功能测试 | 446/446，33 个文件 |
| 回归测试 | 301/301，15 个文件 |
| 分组测试合计 | 2,885/2,885，177 个文件 |
| 严格覆盖率套件 | 2,173/2,173；该配置的语句、分支、函数、行覆盖率均为 100% |
| 测试清单审计、WXT prepare、TypeScript 编译 | 通过 |
| Chrome、Firefox 构建、Firefox 打包与清单校验 | 通过 |
| 用户脚本构建与产物校验 | 通过 |
| 文档构建、`git diff --check` | 通过 |

严格覆盖率套件与分组测试有重叠，不额外计入 2,885 项。首次默认并发运行与浏览器矩阵竞争资源时，出现一次文档二进制测试的 5 秒超时；同一文件单独执行通过，随后限制 Vitest 为最多 4 个 worker，完整流水线通过。没有为此修改产品代码、放宽单测超时或跳过断言。Firefox 和用户脚本在此处的结论仅为构建及产物校验，不是实际 Firefox 浏览器运行验证。

### 真实浏览器验证与产物对应关系

| 产物 | 已完成验证 | 范围说明 |
| --- | --- | --- |
| `/private/tmp/fr-followup-final-chrome` | 56/56 个站点用例；37/37 个划词及触发用例 | 包含 Brown 修复；尚未加入随后提出的 GitHub 标签修复。站点矩阵覆盖 28 个页面、24 个主机的 hover/full，恢复断言全部通过 |
| `/private/tmp/fr-followup-tags-final-chrome` | 10/10 个 GitHub 用例 | 最新标签修复版；5 个 GitHub 页面各执行 hover/full，包含仓库列表、Issue 列表、PR 列表及详情，恢复结构零差异；所有记录的浏览器前台状态均为 false |

两个独立副本各有 230 个文件，测试期间不随重新构建而变化。目录摘要分别为：

- 首轮完整矩阵版：`b99346acb84ddace275c842b89e1755df10dad12b69c8c180154c058fb6214f4`。
- 最新标签修复版：`fb60b5b3cc88172b3fd806401bc66b11303bdef87a2510464d3649b5c5f2622a`；content script 摘要为 `42a163ca9cc58aefee7c64732ab83084d3e01e5c3beaf62b2b84f66c85243474`。

### 证据位置

- 全量自动化日志：`/private/tmp/fr-followup-final-regression-verified.log`。
- 56 项站点结果汇总：`/private/tmp/fr-followup-browser-summary.json`。
- 37 项划词报告：`/private/tmp/fr-followup-final-selection/report.json`。
- 最新 GitHub 10 项结果：`/private/tmp/fr-followup-tags-github-summary.json`；原始日志：`/private/tmp/fr-followup-tags-github-matrix.log`。
- 最新 Microsoft 全文截图：`/private/tmp/fr-followup-tags-github-matrix/github-microsoft-repositories/full/full-final-translation.png`。
- Wikipedia 长页最终日志：`/private/tmp/fr-followup-wikipedia-final.log`。
- Shift 修改前对照：`/private/tmp/fr-selection-conflict-fixed-baseline/report.json`；上一轮产物对照：`/private/tmp/fr-selection-conflict-fixed-2a22ee1/report.json`。
- 无扩展 MathJax 对照：`/private/tmp/fr-learnopengl-no-extension-control.json`。

以上 `/private/tmp` 文件为本机验证证据，可能随系统清理而消失；本报告保留归因、测试数量、版本摘要及验证边界。

### 未执行项与交付范围

最新标签版本的 37 项划词补验未启动：自动审批服务以额度耗尽为由拒绝新隔离浏览器启动。该项是未执行，不是测试失败，也不能用前一产物的 37/37 替代。已获准启动的 GitHub 矩阵正常完成，没有绕过拒绝去启动新的浏览器测试。

修改保存在独立工作树的本地分支，未上传或合并 PR。FluentRead 主工作树和两个参考仓库未被修改。
