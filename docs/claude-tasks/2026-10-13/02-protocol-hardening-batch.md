# Claude Code 第二批：协议可靠性修复与首批验收补齐

## 批次边界

用户于 2026-10-13 批准派发下一批 Claude Code 任务。本批仅包含下列 B2-A、B2-B、B2-C 三项，可独立并行；不包含新增通用协议入口或迁移全部 provider。由用户在自己的 Claude Code 中执行。

- 交付仓库：ArietidsZ/FluentRead
- B2-A/B2-B 实现的共同固定基线：FluentRead/FluentRead@cf52fdd80e2d39ad1f4b1a413c9660d45edddec6
- 本文档所在 handoff 分支只用于交接，不能作为实现基线。
- B2-A/B2-B 分别从固定基线建立独立实现分支，不自动更新 fork 默认分支，不混入第一批搜索修复 0063acfdd3ae512737beadf0622a7ea40c324b12，也不覆盖其他候选补丁。
- 若本地没有基线，可获取该公开上游提交；不得 reset、stash、清理或改写用户现有工作区。使用独立工作目录或 worktree。
- 不调用真实或付费模型，不读真实凭据，不部署，不发布或合并 PR，不推送实现。任务文档的发布授权不等于实现发布授权。
- 复用仓库锁定依赖和现有测试方式，不升级依赖、不改权限或安全配置。遵守基线 AGENTS.md 与 docs/testing.md。
- 本批依据来自 2026-10-13 的源码及官方协议审查；下述反例尚未执行，必须通过红绿测试验证。

## B2-A：阻止写作助手输出原始 SDK 错误

难度：低。建议分支 fix/writing-stream-error-privacy。

### 已确认缺口
src/services/writing/runtime.ts:114–116 调用 streamText 没有设置 onError。阅读助手 src/services/harness/runtime.ts:97 已显式禁用默认原始日志。锁定 ai 6.0.264 默认回调为 console.error(error)；后续 UI 错误脱敏不能撤回已输出的原始日志。

这表明原始 provider 错误可能输出到控制台，不代表已经观察到真实凭据泄漏。

依据：
- https://github.com/FluentRead/FluentRead/blob/cf52fdd80e2d39ad1f4b1a413c9660d45edddec6/src/services/writing/runtime.ts#L114-L132
- https://github.com/FluentRead/FluentRead/blob/cf52fdd80e2d39ad1f4b1a413c9660d45edddec6/tests/harnessModelGateway.test.ts#L70-L93
- https://github.com/vercel/ai/blob/526e8a54d6bf2ef8f0d777375d0156bffc48a48e/packages/ai/src/generate-text/stream-text.ts#L356-L358

### 实现范围
参照阅读入口，为写作 streamText 显式抑制默认原始错误回调，同时保留 fullStream 中 error 的传播、现有统一脱敏、统计失败和取消语义。不要通过全局替换 console、吞掉异常或删除错误事件来实现。

优先只改 writing/runtime.ts 及对应测试、测试分类和必要的局部说明。不重写共享 gateway、日志系统或所有错误处理。

### 必须验证
1. 使用锁定的真实 AI SDK + mock fetch，经实际 writing runtime 触发 HTTP 错误。代理错误消息含假的密钥与原文标记；console.error 不收到原始错误，用户结果不暴露假密钥。
2. 不得用 mock streamText 绕过默认回调，或只查源码是否包含 onError。
3. fullStream error 仍导致失败结果，失败用量事件恰好一次，不产生成功结果。
4. 正常正文/工具流程不受影响；取消仍是取消，不能转换成成功。
5. 保留至少一个旧源码失败、候选通过的相同测试；测试中的 console spy 在 finally/afterEach 恢复。
6. 使用合成文本，不把用户真实内容/凭据写进日志。

不在本项处理截断、EOF 完成状态、未知 SSE 事件、重定向或协议选择。这些独立问题留在总评估中。

## B2-B：Responses 终态校验与失败用量保留

难度：中。建议分支 fix/responses-result-integrity。

### 已确认缺口
DeepSeek 与 Doubao Seed 的非流式 Responses 路径只检查 HTTP ok，再抽取文本；HTTP 200 + status=incomplete + 非空 output_text 会被返回为成功。DeepSeek 还在归一化 usage 前抽取文本，空输出、refusal、仅 reasoning 会先抛错，导致已有实际 usage 被降为 unreported。

依据：
- https://github.com/FluentRead/FluentRead/blob/cf52fdd80e2d39ad1f4b1a413c9660d45edddec6/src/providers/translation/responses-api.ts#L41-L51
- https://github.com/FluentRead/FluentRead/blob/cf52fdd80e2d39ad1f4b1a413c9660d45edddec6/src/providers/translation/deepseek.ts#L63-L91
- https://github.com/FluentRead/FluentRead/blob/cf52fdd80e2d39ad1f4b1a413c9660d45edddec6/src/providers/translation/doubao-seed-translation.ts#L95-L116
- https://api-docs.deepseek.com/api/create-response/
- https://developers.openai.com/api/docs/guides/reasoning#allocating-space-for-reasoning

### 实现范围及兼容契约
1. 在已有 Responses 共享模块中复用一套小型完成性校验，不另建 transport、调度器或通用状态框架。
2. 显式 completed 才按完整响应继续；显式 incomplete、failed、cancelled、queued、in_progress 以及未知/错误类型的显式 status 不得按成功处理。存在非空 error 也不能因有文本而成功。
3. 为保留旧代理兼容性，缺省/undefined status 可沿用原有文本读取规则，但必须无 error，且不能包含显式非成功的 message 状态或 refusal。null、空串、数字不视为省略。兼容判断写入测试和说明，不能默认所有非标准数据成功。
4. 存在 refusal 或显式 incomplete 的消息/输出时，不交付完整成功结果，即使同时存在部分 text。不要把 reasoning/tool item 当正文。纯函数不回显上游正文或完整 error 对象。
5. 错误使用项目已有安全 kind/code/retryable 机制；max_output_tokens、content_filter、拒绝与无效响应不应按原参数盲目重试。不要把远端 cancelled 直接伪装为用户主动取消。
6. JSON 解析成功后先保留 actualModel 和归一化 usage；完成性校验、文本抽取失败或成功，均保证每个 HTTP 尝试仅上报一次实际 observation。失败但有 usage 记 error + 实际用量，不再写第二条 unreported。解析前失败继续走原有兜底。
7. DeepSeek Chat 路径、Doubao 非 Seed 路径保持原行为。取消/timeout 优先级、数组顺序、语言选项和图片契约不得变化。

预期改动集中在 responses-api.ts、deepseek.ts、doubao-seed-translation.ts 和相关测试；如需范围外改动，先说明必要性，勿顺手修复其他问题。

### 必须验证
- completed + 多 message/text + reasoning：只返回最终文本，usage 正确且一次。
- HTTP 200 + incomplete + 部分文本 + usage：拒绝成功，保留实际用量。
- failed/error、cancelled、queued/in_progress、未知显式 status：安全错误，不返回部分译文。
- refusal 与 text 并存、只有 reasoning、空输出但 usage 非空：不丢用量、不重复上报。
- 缺省 status 的旧代理成功夹具继续通过；null/非字符串/空 status 不被误当缺省。
- 两个真实 provider 函数均经过 mock runtimeFetch；不能只测试共享 helper。
- DeepSeek Chat 回归；Doubao 数组中的一项失败不返回成功的部分数组。
- 请求前/响应读取后取消不交付迟到成功；测试无真实网络。
- 保留旧源码反例失败和候选通过记录；如修改 usage 观察顺序，验证 catch 不产生第二次 observation。

本项排除：stream 参数覆盖问题、完整 SSE 支持、通用 OpenAI Responses 入口、Anthropic stop_reason、协议配置/缓存迁移、store 策略、Doubao 调度与重试分类修复。不得为完成本项直接删掉 doubao 的 SDK 服务分类。

## B2-C：补齐首批搜索任务的重开验证与原始证据

难度：低；与 B2-A/B2-B 不共享生产改动。

- 独立基线：第一批本地提交 0063acfdd3ae512737beadf0622a7ea40c324b12，原基线 0652ce2309c76a09310868acb45e71990533b500。不能切到 B2-A/B2-B 的上游基线后宣称第一批已验收。
- 已交付补丁：Workspace/Temp/fluentread-search-parity-0063acfd.patch。父助手通过 Dropbox 静态核对了 6 文件 +520/−16 及与原基线的上下文；未发现明确生产逻辑缺陷。
- 首批任务要求关闭后重开，但 tests/serviceSearchComponent.test.ts 的 ElPopover 替身始终渲染内容且忽略 visible，11 个组件用例没有执行打开→关闭→重开；最后一例只测选择后清空及 props 替换。因此这一条尚无测试证据。

### 最小补齐
1. 保持真实 SFC 的脚本、模板与绑定，采用能遵守 visible 生命周期的边界替身，驱动打开、输入搜索、关闭、重新打开；检查实际产品约定的筛选重置/保留行为和当前选项。不得用总是渲染两套 slot 的替身代替重开行为。
2. 如检查表明这项生命周期要求不适用于某个组件，具体解释并对实际有该生命周期的入口验证；不要制造并不存在的 UI 契约。
3. 只运行新增/受影响的窄范围测试，复用已有 63 条结果和构建证据。没有相关改动时不要重跑完整扫描或所有构建。
4. 从原运行目录补交已有 red/green、基线对照、每项命令及退出码、coverage 结果、unify-onnx.cjs 与实际 NODE_OPTIONS 命令。先检查现有文件；缺失如实标注，不重建虚假的旧日志。
5. 修正交付表：pnpm test:coverage 原退出码为 1，目标 serviceCatalog.ts 四维100%仅为局部覆盖率；build/Firefox 是据报告使用临时 shim 后通过，不能写成原依赖环境无条件通过。
6. 给出更新补丁和准确新提交。首批源码仍不推送、不合并。无需修正原有无关 22 项及4项失败。

以上原始日志尚未由父助手读取；作者报告的 63/63、构建及局部覆盖率不等于父助手独立运行验证。

## 共同验证及交付

- 先读基线 docs/testing.md 与 package.json，复用真实函数/SDK的现有 mock 方式。
- 新测试在 tests/test-matrix.json 中唯一归类；两分支若同时改该索引，最终集成时仅合并各自条目，不覆盖另一项。
- 执行受影响测试、pnpm test:audit、pnpm compile、相关架构/分组及覆盖率门禁。共享 provider 变更按仓库要求验证 Chrome/Firefox/userscript 构建与 verifier。
- 不为凑数量重复完整扫描或相同测试。无关既有失败须给同一固定基线的对照证据，不能复用第一批不同基线的结论。
- 环境 workaround 必须记录命令、影响范围和验证限制。若需新增 shim/依赖变更才能运行，先报告；不得静默把替换依赖后的构建描述为原环境无条件通过。
- 交付每项准确完整 commit、独立补丁、修改清单、红绿原始日志、命令/退出码、开始结束时间及未执行项。可放用户现有 Dropbox Workspace/Temp 下的新批次目录，勿覆盖第一批补丁。
- 对 coverage 区分“目标模块覆盖率”和“整个 coverage 命令退出码”；任何失败的全局门禁不得标为通过。
- 组件/模拟协议测试、构建与真实浏览器/真实供应商验收分别报告。未调用真实供应商，不得宣称生产端到端通过。
- 原始失败日志保留，后续修复新增记录，不覆盖失败证据。
