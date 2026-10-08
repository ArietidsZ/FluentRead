# CW PDF source snapshot and nine strict coverage gaps

执行环境：CW 本机。仅确定性 Node/Vitest 测试；没有启动云环境、额外 Codex/Work 任务、真实搜索/模型 API 或用户浏览器。无权限、凭据、依赖、覆盖率阈值或测试归类变更。

基线 `c7e14e63877985e240ba16c8262cb2227243d177`。本次 ① 分成三个可分别审查的 fork 分支：

| Branch | Exact commit | Scope |
| --- | --- | --- |
| `fix/pdf-export-source-snapshot-20261008` | `ff144f5795e7eef440610a9873b804f20f6ac976` | PDF 根因修复 + 两个真实 PDF 回归 |
| `test/nine-module-coverage-20261008` | `0af5c7c594dabc0dc201bf42c02e6e4638f125ae` | 九个测试文件，18 个新增测试；生产代码不变 |
| `fix/pdf-race-nine-coverage-integration-20261008` | `22116a9caabf42add4ca20063389fc9bd1e6aa7b` | 上述两项组合验证 |

## PDF 根因与验证

`renderPdf` 在首次异步加载前复制所有 segment source；加载期间替换 segment 数组后，原文/译文分类仍与本次导出的来源快照一致。两个回归使用 pdf-lib 创建、实际解析并再次读取的 PDF 字节，分别验证原文相同和译文不同的页面路径。栅格化边界返回公开固定 PNG 测试夹具；本记录不声称真实浏览器像素渲染已验证。

保留原始生产代码上的失败记录 `pdf-source-race-red`（一个回归失败、23 个过滤跳过，0 collection/unhandled error），以及修复提交上的 `pdf-race-two-outcomes-green`（25/25 通过）。最终完整 strict 同时覆盖这两个回归和最终测试补齐。

## 九模块补齐

| Module | Baseline uncovered S/B/F/L | Final S/B/F/L % |
| --- | --- | --- |
| `src/app/background/providerRuntime.ts` | 6/0/1/6 | 100/100/100/100 |
| `src/core/config/model.ts` | 0/3/0/0 | 100/100/100/100 |
| `src/features/area-translation/background/handlers.ts` | 0/1/0/0 | 100/100/100/100 |
| `src/features/document-translation/core/document.ts` | 0/1/0/0 | 100/100/100/100 |
| `src/features/document-translation/services/binary.ts` | 0/3/0/0 | 100/100/100/100 |
| `src/features/full-page-translation/content/liveTextTranslation.ts` | 0/1/0/0 | 100/100/100/100 |
| `src/features/image-translation/services/mangaBubbles.ts` | 0/1/0/0 | 100/100/100/100 |
| `src/services/translation/broker.ts` | 0/1/0/0 | 100/100/100/100 |
| `src/services/translation/requestSnapshot.ts` | 0/1/0/0 | 100/100/100/100 |

测试执行真实处理器组装、冻结配置、消息路由、PDF 解析与导出、DOM 文本应用、气泡排序、glossary retry 编排及数组来源 token 筛选。供应商、浏览器和栅格化仅在既有外部端口使用测试替身。

文档内部复查用例通过 getter 同步使 source 状态失效；PDF 缺失 source 用例故意破坏解析后的 metadata。这两项是防御路径故障注入，不声称是正常 UI 操作。删除文档内部复查、删除 glossary retry 特判的两个负对照均各产生一个预期失败，随后生产文件按 SHA256 恢复。没有导出私有 helper 或修改生产代码来制造测试入口。

## 验证结论与失败记录

最终提交 `22116a9caabf42add4ca20063389fc9bd1e6aa7b`：

- 完整 strict：9429/9429 断言通过，383 个文件，实际 exit 0；0 failed assertion、0 collection error、0 unhandled error。
- 全局 statements/branches/functions/lines 均 100%；完整 coverage JSON 以 gzip 保存，九模块 JSON 与全部模块 summary 单独保存。
- TypeScript/Vue 类型检查、测试审计、git diff whitespace 检查均 exit 0；审计 482 文件、6536 静态测试用例。
- 完整 architecture 32 文件：1330 通过、4 失败。三个失败文件与直接基线复核相同，失败 stderr 字节完全一致，SHA256 `9ca63478ebca1e4505a5c72daa3da2fde66a816632927bc47222044b2fa7eae4`，无新增失败。

四维 100% 指现有 coverage 配置的完整覆盖范围；既有 ownership 缺口仍列为架构阻塞。

架构仍阻塞于：video subtitle runtime 1888 行超过历史预算 1887；微信联系 jpg 缺少源码头；storybook verifier 没有验证归属；18 个既有模块未纳入 coverage ownership。本次没有改动这些无关文件，不能称全部检查绿色。

首轮全局 strict 在前一个未发布组合提交上 9428/9428 断言通过但 exit 1，仅 requestSnapshot 第 100 行数组来源分支缺失，branches 99.99%。补加数组来源测试后在最终提交重跑全部 strict；首轮失败记录和覆盖明细保留。最后的三文件局部诊断 48/48 断言通过，但因其他测试路径不在该子集内，coverage 仍 exit 1；它不是完整 strict 的替代。更早夹具调整和 TypeScript handler 联合类型收窄之前的失败记录也保留。

最终 architecture 的 JSON reporter 因输出路径参数写法而写入 stdout；完整 JSON 行原样提取保存，并验证实际运行的 32 文件与先前完整矩阵完全相同。原始命令、stdout、提取方式及前后 SHA256 全部保留在 `final-head-architecture-results-recovery.json`；没有修改测试结果。

291/291 九文件定向结果对应较早未发布组合提交；它早于只影响类型的 handler 收窄和最后一个数组 token 测试。`validation-bindings.json` 明确每次运行的提交和范围；本报告没有将 291 定向结果改报为 292。

保留四维 100% 阈值、测试矩阵、审计脚本及资源限制脚本的相同 Git blob。没有 `.only`、忽略或新增跳过。未运行构建、真实浏览器或 WebGPU 验证；这些不属于本次 PDF/纯测试补齐范围。

② 已完成的两个 upstream Draft PR：[WXT #882](https://github.com/FluentRead/FluentRead/pull/882) 与 [Popup #883](https://github.com/FluentRead/FluentRead/pull/883)。本次仅补齐 ① 的 fork 提交及记录，没有重建 PR 或合并任何 PR。

## 证据读取

`records/` 保存实际命令、开始时间、时长、exit code、Vitest JSON、stdout/stderr、完整覆盖与负对照；`baseline-c7/` 保存先前 9409/9409 完整 strict 的实际失败记录。路径在 JSON 解码之后脱敏，再重新序列化校验；原始 CW home/workspace/dependency 路径与令牌形态均不发布。未读取或复制任何认证文件。

代码远端确认见 `records/remote-code-confirmation.json`。`evidence-files.json` 是本次发布文件的 SHA256 清单；记录分支自身最终 commit 与远端确认由交付消息给出，避免自引用提交哈希。
