# B3-B：原生弹窗缺 documentId 回退验收
本批仅 B3-A/B3-B，由用户在自己的 Claude Code 执行；不授权启动 Codex/Work或额外代理。
## 输入与基线
- inputs/run-real-tabless.mjs：已交付候选 SHA256 f70b660fa61b38ec15630bc70725010a4b0433f3172ce2e64bd6beab60060ddc。
- inputs/owned-neo-session.mjs：此前已审查隔离 Neo 辅助脚本，保留归属、独立临时profile、X11/D-Bus隔离、沙箱和清理保护；不是安装器。
- 在 CW 已有验收目录与依赖中工作；脚本原相对路径指向 FluentRead-pr906-tabless-vocabulary-candidate-20261013/.output/chrome-mv3。明确解析路径而非把新证据目录下不存在的路径当构建。
- 复用先前实际 background.js SHA256 d0b1b04cfe2ca287629eec0442149394cf1fda3e0f981e4d2ccf71f449dd7566；记录其源码/manifest/runtime身份。不要以 B3-A 构建替换。
- 原浏览器证据ZIP为 pr906-tabless-vocabulary-privacy-audit-20261013.zip，SHA256 435afc784fe2d22d1e9867ed8a94ea7ff335389730165c2df545636985ab424b；原结果为前置失败，正式场景NOT_RUN。
## 先修明确的验收脚本缺口
1. 旧硬编码截止2026-10-13T07:00:00Z且提前4分钟拒绝启动，已经过期。为本批单次启动使用明确记录的最多10分钟预算/绝对截止，校验参数；保留watchdog、预留清理和租约保护，不删除截止检查或无限重试。
2. 早期失败不能将初始化 paidOrRealProviderCalls:0 表述为实测；未知写 UNKNOWN/NOT_MEASURED，区分局部fetch观测与全局网络计量。
3. 清理失败或退出码1时，总状态不可保留无条件PASS；新运行使用新目录/run ID，启动前参数失败也不能误读旧RESULTS。
4. 为这些报告/截止分支增加离线针对性用例；未运行的原先documentId正向、取消/deadline用例继续独立NOT_RUN，不降低原契约。
## 单次原生验收
- 显式 FLUENT_TABLESS_ACCEPTANCE_MODE=missing-document-cache-fallback，默认模式不是本项。
- 核对已有网络控制能阻止真实供应商流量后才启动；worker fetch hook在启动后安装且不覆盖全局，不能拿它保证全部无外连。缺失必要隔离/构建/依赖时停该运行，完成独立离线修复并说明精确缺口，不改安全设置或使用日常profile。
- 使用四个顺序合成翻译请求；后两项含伪造payload隐私/文档声明。
- 每次真实sender必须为自己的扩展ID、无tab、无documentId；不伪造native身份，不按URL猜身份或修改生产信任规则。
- 四次成功回复、逐次mock dispatch增量[1,1,1,1]且总计4、context查询0、已观测blocked fetch0、翻译缓存条目无净增长；核对被计数数据库/store与固定构建一致。
- 仅证明条目净增长，不能称零原始读写；不证明私有/本地模型选择、在途去重、page summary、取消/期限行为或原documentId正向验收。
- 保留原4,811字节正向case主体（SHA256 d1e2dcdaa8afd6303ff740ae7e1e29ad736c21cbe3a989717512e6918124510c）；无相关改动不重跑旧广泛测试/构建。
## 交付与边界
脚本增量补丁、离线测试原始日志、一次运行的完整报告（含失败）、源/辅助脚本/构建哈希、UTC起止与退出码、实际owned进程/监听器清理和租约释放证据。可存现有 Dropbox Workspace/Temp/fluentread-batch03/B3-B。
不改产品源码/权限/凭据/日常profile，不安装软件或新建云环境，不调用真实/付费模型，不推送实现/发布PR/部署/永久删除；清理仅限已证明属于本次的临时进程，保留证据。
缺少浏览器前置时仍交付已完成离线结果，但真实验收必须保持NOT_RUN。各阶段和有效工作/等待分开，不能用会话存续替代工时。
