# 本地沉浸式翻译源码与 FluentRead 核心行为对照

审阅日期：2026-09-15。范围是网页翻译的发现、分段、选取、请求时效、动态变化、插入与恢复。本报告记录可追溯的源码行为及 FluentRead 小夹具验证，不能当作三款扩展的线上运行效果排名。

## 样本与证据边界

- 扩展目录：`/Users/thinkstu/Desktop/copy/沉浸式翻译-1.31.6/`。`manifest.json` 的版本是 **1.31.6**；核心代码在 `content_main.js`，不是仅检查配置导出。
- 油猴源码：`/Users/thinkstu/Desktop/copy/沉浸式翻译油猴脚本.js`。文件头的版本实际是 **1.33.1**，与扩展不是同一个版本。
- 只读取这两份用户提供的分发源码和扩展内置 `default_config.json` / `default_config.content.json` 的规则字段；没有读取用户配置导出文件，没有运行参考扩展，没有复制其实现到 FluentRead，没有引入跨仓库依赖。
- 压缩文件一行可以包含多个函数。下表同时提供原始行号和压缩函数名；偏移以 JavaScript 字符串索引为准，供复核定位，不是编译前源码位置。
- 参考机制依据是当前文件静态审阅；浏览器最终显示、服务质量与竞品在 Issue #1029 上的实际结果均未由本子任务验证。

| 样本 | SHA-256 |
| --- | --- |
| 扩展 `content_main.js` | `12b72a55df97a846074cd5e836eb2ac7b4bfefb8a2fdafaec07cfc376c49bff2` |
| 扩展 `default_config.json` | `a2245f1c2d534ec4589fcf993264fbfed061ca1ebb6879d491be89c28f6c6f86` |
| 油猴源码 | `9ec40a25e5fd479a4c4a460905ba0bc25b888469f781c74df5e90016bec4ac81` |

## 关键结论

沉浸的 GitHub `selectors` 包含 `.markdown-body`，表示进入该区域继续遍历；它不等价于 FluentRead 的 `force-target + atomic`。沉浸 GitHub 内置 `atomicBlockSelectors` 仅包含仓库描述 `[itemprop=description]`，默认 `atomicBlockTags` 为空。把整片 Markdown、嵌套 LI、blockquote 或单元格默认当成原子翻译对象，会失去后代段落边界。这是这次对照最有用的规则语义差异。

沉浸 1.31.6 的 `su` 和油猴 1.33.1 的 `op` 都逐个遍历元素和文本；遇块边界先提交当前段落，再进入后代。它们保存 `flatNodes`、`rootNodes`、`commonAncestorContainer`，分别表示被提取的内容、待展示/恢复的来源节点和段落上下文。正文区域和真正段落是两个不同概念。

FluentRead 已经有对应的后序发现、内联 run、所有权屏障、分帧扫描、generation、源节点时效检查、恢复和重挂机制。本轮发现的通用缺陷是：悬浮探测知道包裹层内已有独立候选，但未命中 run 时丢掉这个信息，继续 `inspect()` 回退为整个祖先。新补丁保留屏障结果，禁止这种回退；不取消用户显式配置的原子目标。

截图末尾 dnd 辅助说明还揭示另一条独立路径：请求文本被过滤，并不保证同一隐藏节点已从译文 DOM 骨架移除。保护原文的 code/math 与不应显示在译文中的隐藏辅助内容必须分开处理。这项实现和最终渲染验证由本轮快照与最终渲染专项覆盖。

## 可核查行为矩阵

下表“已有”表示当前源码中存在对应机制，并不自动代表本轮把该机制的全部测试重新运行过。“本轮实证”单独列出。

| 维度 | 沉浸 1.31.6 / 油猴 1.33.1 的可核查行为 | FluentRead 当前对应机制 | 判断与小夹具验收条件 |
| --- | --- | --- | --- |
| 翻译范围与段落 | 扩展 `default_config.json` 的 GitHub 规则以 `.markdown-body` 等为范围；`su` 内的选择器匹配控制进入范围，后代仍执行块边界遍历。油猴同类规则在 150 行、`op` 在 5872 行。 | `site-adaptation` 编译规则与 `TranslationCandidateCore.discoverSteps()`；force-target 可以原子或非原子。 | 范围容器必须非原子，叶正文仍可明确命中。验收不仅比译文文字，要比 owner 数、节点集合和层级。 |
| 块/内联识别 | 扩展 `Ai`（4880 行，偏移 838105）先看 extraInline，再看 extraBlock 与 BR/INPUT，然后处理父 inline-flex 和计算 display，最后排除 atomicBlock。默认 extraBlock 包含 `ul > li`，allBlockTags 含 LI/UL/OL。 | `layout.ts:isBlockBoundary()` 保留语义块与重挂边界；列表不能因 display:inline/contents 被随意移入 span。 | 规则覆盖与自然布局要分开。不要只加某网站 class 来掩盖通用祖先回退。 |
| 自定义透明包裹层 | `su` / `op` 继续遍历未知元素后代，遇真正块元素时提交段落；不是依据外壳 textContent 把所有后代合并。 | 后序发现可从 custom/span 后代产生独立 LI；悬浮也探测子树所有权。 | **本轮实证：旧实现全文正确而悬浮错误。** 新 ownership 测试验证 custom/span 包 LI，正文与全部节点范围都不得返回整个 shell。 |
| 混合直接正文 | `flatNodes` 累积连续文本/内联原子，遇块/范围变化时 flush；`Ume`（5016 行）计算公共祖先和 rootNodes。 | `getDirectInlineRuns()` 与 `candidateChildBarriers` 隔离正文前后 run。 | **本轮实证：** intro + custom list 时，点击 intro 只选 intro；命中 custom 空壳不能 fallback 成 intro 加整份列表。 |
| 原子内容 | `stayOriginalSelectors` 的内联命中被加入变量；匹配且为块时跳过整个子树。`Dd`（5051 行，偏移 1442409）把保留节点映射为变量/富文本标记。 | `dom.ts` 的保护分类、`text.ts` 文本提取、`serialization.ts` 来源槽和本地骨架。 | 原文保留、跳过翻译、从输出省略是不同语义。code/math 应保留；脚本、隐藏辅助说明不应在副本暴露。 |
| 隐藏内容 | 扩展 `JB/wT`（5016 行）按规则、缓存样式的 display:none / opacity:0 跳过；TEXT 分支还在父元素有正尺寸但某维小于 4px 时拒绝。油猴 `zD/op`（5872 行）可见相同机制。 | `getPresentationProtection()` 已有 hidden/inert、常见屏幕阅读器 class、display/visibility 保护，本轮扩展视觉隐藏与输出省略。 | 不机械照搬“小于 4px 就过滤”：细小但真实可读内容需要反例。1px + clip/overflow 等视觉隐藏组合更适合保守识别。最终副本必须不含隐藏英文。 |
| aria-hidden | 扩展 1.31.6 的已读通用规则列表中没有全局 `[aria-hidden=true]`；油猴 1.33.1 在 150 行通用附加排除中出现它。 | FluentRead 已有 aria-hidden 全局保护。 | 两个沉浸版本本身不同；不能把某一版本等同普遍正确。aria-hidden 只说明辅助技术语义，是否应排除可见正文需单独反例验证，本次不擅自改变既有契约。 |
| 换行与长段 | `aO/iO`（5016 行）按配置把 PRE 换行、长文本改成 BR/HR；默认与高级模式分支不同，高级模式逐 Text 拆分，另一分支可写 innerHTML。 | `lineBreak.ts`、站点 `splitOnBr` 和合成内联段；宿主 BR 留在原位。 | 保留已明确的用户换行，不为展示方便重建宿主大块 HTML。需断言恢复后原节点、空白与链接 identity。 |
| 悬浮坐标与入口 | `MI`（4877 行）走 caretPositionFromPoint 或 caretRangeFromPoint；`s5` 的 shadow 命中递归有 100 次上限。`V1e`（5562 行）校验命中文本的 rect，再把选中容器交给同一个 `su`。 | `engine.ts:resolveAtPoint()`、`dom.ts` 坐标命中、`visual.ts` 视觉文本范围；hover feature 只负责手势入口。 | 两条路径都应使用相同段落所有权。**本轮实证修复** resolve 与 discover 的 shell 差异；真实坐标/行间留白需要浏览器层。 |
| 用户划词 | 扩展 12450 行 `Dwe/cX` 从开放 shadow/文档 selection 收集非空范围，输入框则读取 selectionStart/End；保留选区和显示位置。 | selection-translation 独立 feature，`selectionTranslatorCore.test.ts` 覆盖选取策略。 | 划词是用户明确选中内容，不能直接等同全文块候选；本轮未重跑整套划词触发和输入框浏览器测试。 |
| 分帧扫描 | 扩展 `HB/u3`（4988 行）按 16ms 预算让出；可用 scheduler.postTask，否则根据优先级使用 setTimeout / requestIdleCallback。`su` 每步检查 `An()`。油猴 `Yne/op` 同样有 16ms。 | `runtime.ts:flushMutationRescans()` 每 8ms 让出，核心 generator 每访问元素产一步；hover 探测共享 256 步预算。 | 8ms/16ms 是不同调度取舍，不能直接宣布性能更好。**本轮实证：** 300 层未知包裹预算不足时不授予 whole-shell 候选；未做双产品 CPU/帧耗时基准。 |
| 请求/视口批处理 | 扩展 `xC/q3`（5222 行）区分立即容量和 IntersectionObserver；未达到立即条件时加入 observeParagraphs，随后排 paragraphQueue。 | `eagerTranslation.ts`、`fullPageQueue.ts`、`fullPagePriority.ts`、`translationRequest.ts` 使用可见/阅读方向优先、在途请求与独立取消。 | 已有对应机制。验收应包括滚动后优先翻新可见内容、在途请求不过度重启、离开预取区域的待派发任务撤回。参考版本未跑联网压测。 |
| 动态变化合并 | 扩展 `nhe`（5222 行，偏移 1672271）分 pending/dirty roots，重叠根去重，50ms tick；同一 active root 的重入延后补扫；稳定窗口可延迟约 1100ms 后重试。油猴 `Nze`（6064 行）有对应结构。 | `runtime.ts:enqueueFullPageRescan()` 合并 dirty roots；大量 roots 转 broad 模式和冷却；增量 generator 继续扫描。 | 不需要另建观察器系统。把 host 重挂、实时文本改变、hidden->visible 作为独立事件测试，确认既不自激也不永久漏译。 |
| 过滤自身写入 | 扩展 `Z3/ahe`（5222 行）查看自身 immersive/formatHtml/译文 class 和最多 20 层祖先；`ou/GB`（4988 行）另以短时更新序号标记写入。 | `mutationObservation.ts` 及 `translationStability.ts` 对来源节点、generation、工件和实际旧属性值做核验。 | 名字相同的宿主属性/class 不能自动算扩展所有权。FluentRead 的精确状态核验应保留；需宿主伪造 marker 的负例。 |
| 重复插入与时效 | 扩展 `xC` 捕获 `imtExpectedVersion`；`Y3/s0e`（5222 行）由当前 DOM 中 rootNodes/targetNodes 的实际存在状态推导模式；DOM 已被宿主清空时返回 dom_cleared，不复活旧段。`bu` 检查相邻重复 wrapper。 | `state.ts` generation/controller、`translationStability.ts` 源节点/顺序/内容检查；`bilingualRemount.ts` 与 replay 处理等价重挂。 | 不只检查 owner.isConnected，还要检查来源是否仍是同一代。本轮生命周期回归验证迟到结果与最终副本。 |
| 原文/双语/仅译文 | 扩展 `l0e/Y3`（5222 行）明确六种状态转移；仅译文优先文本备份映射，失败回退经典节点替换；恢复时移回保存的 rootNodes 并删除 targetNodes。油猴 `_je` 同样有转移表。 | `state.ts`、`liveTextRender.ts`、`renderer.ts`、原文槽恢复和宿主节点保留。 | 宿主事件、选中状态、复选框、链接 identity 与用户动态修改都是契约。不能仅判断文字看起来恢复了。 |
| 取消和清理 | 扩展 `ns`（5222 行，偏移 1666825）先设全局取消，再断开动态/可见/标题/body 替换观察器、清重启 timer，清预览/loading，切回 original，最后清 context。 | `requestSession.ts:disposeFullPageRequestSession()` 与 `runtime.ts:disposeFullPageSession()` 清 controllers、timers、observers、队列和 activeDiscovery；状态 generation 拒绝迟到回写。 | 已有明确机制；恢复后到达的响应必须没有任何新 DOM 写入。全局取消标志本身不足以替代每请求/每节点 generation。 |
| PRE 恢复边界 | 扩展 `ns` 对 `[data-imt-pre]` 可直接以 `imtRawHtml` 写回 innerHTML。 | FluentRead 默认保护网页 PRE/code；纯文本文档 PRE 是明确例外。 | 这不是应复制的实现。宿主若在翻译期间改了 PRE，旧 HTML 写回可能覆盖新内容；此为静态风险推断，未运行沉浸验证。 |

## 行为验收与覆盖定位

所有权专项先在旧实现上复现 6 条失败，再扩展为 12 条通过，覆盖透明包裹、两种范围、直接正文、显式原子目标、动态增删、深树预算及已有合成段的重新命中。
最终快照专项 25 条通过，检查最终 renderer 和状态恢复，包含 hidden-visible-hidden、readonly 控件被宿主更新、SSR 行在 hydration 后按新任务行恢复与重译。全部最终验证与产物摘要见 [核心审查结果](./README.md)。

| 参考行为 | 主要验收位置 |
| --- | --- |
| 范围与段落边界、任务列表、混合直接正文 | `translationGitHubTaskList.test.ts`、`translationOwnershipBoundaries.test.ts`、真实任务清单与嵌套列表专项 |
| clip 辅助文本、普通裁切正文、动态可见性 | `translationVisualProtection.test.ts`、`translationSnapshotProtection.test.ts`、`fullPageVisibilityScheduling.test.ts` |
| 恢复后迟到响应与新一代重译 | `fullPageVisibilityScheduling.test.ts`、`translationStability.test.ts`、`bilingualReplay.test.ts` |
| 原子规则、blockquote/dd/td 内多段与嵌套列表 | `translationGitHubTaskList.test.ts`、`translationOwnershipBoundaries.test.ts`、`siteAdaptationCore.test.ts` |
| 短文本、链接、ruby、控件标签与 inline-flex | `translationCore.test.ts`、`translationControlOwnership.test.ts`、按钮浏览器专项 |
| 大量动态根、开放 Shadow DOM、删除、恢复清理 | `fullPageVisibilityScheduling.test.ts`、`translationCore.test.ts`、`bilingualRemount.test.ts`、`syntheticRemount.test.ts` |
| 逐行换行、字体与译文位置 | `pageTranslationAdvanced.test.ts`、`translationFont.test.ts`、`translationTruncation.test.ts` |
| 供应商槽边界与非法/重复标记 | `translationPrompts.test.ts`、`translationCore.test.ts` |

本轮所选 33 个测试文件、1,149 个用例全部通过，修改的 5 个核心模块四维覆盖率均为 100%。浏览器另验证真实 GitHub hydration、恢复后 DOM 相等、原生节点身份和失败重试。核心行为契约具备明确测试依据；仍没有双产品同时运行的 CPU/帧耗时或全站漏译率排名，不以预算常数或测试数量宣称全面优于竞品。

## 原始源码索引

| 源码 | 原始位置与定位提示 |
| --- | --- |
| 扩展版本 | `/Users/thinkstu/Desktop/copy/沉浸式翻译-1.31.6/manifest.json` 的 version 字段 |
| 扩展边界/坐标 | `content_main.js:4877`：`MI`、`s5`；`content_main.js:4880`：`Ai`、`O1` |
| 扩展调度/自写 | `content_main.js:4988`：`u3`、`HB`、`ou`、`GB` |
| 扩展遍历/过滤/分段 | `content_main.js:5016`：`d3`、`wT`、`JB`、`su`、`Ume`、`aO`、`iO` |
| 扩展抽取/富文本 | `content_main.js:5051`：`Dd`、`h3`、`IO` |
| 扩展状态/动态/恢复 | `content_main.js:5222`：`s0e`、`l0e`、`Y3`、`xC`、`nhe`、`IC`、`ns` |
| 扩展悬浮 | `content_main.js:5562`：`V1e`，以及调用 `su` 并将规则替换为 mouseHoverExcludeSelectors 的入口 |
| 扩展划词 | `content_main.js:12450`：`Dwe`、`cX` |
| 油猴版本/内置规则 | `沉浸式翻译油猴脚本.js:4`：version 1.33.1；150 行：内置 JSON 规则 |
| 油猴遍历 | `沉浸式翻译油猴脚本.js:5872`：`op`、`zD`；walker 偏移 2729108 |
| 油猴状态/动态 | `沉浸式翻译油猴脚本.js:6064`：`_je`、`Nze`；observer 偏移 2994690 |
