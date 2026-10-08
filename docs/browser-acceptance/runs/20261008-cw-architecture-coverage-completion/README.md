# CW policy check and architecture/coverage completion

A 为极小只读差异核验；B 在已有 `22116a9caabf42add4ca20063389fc9bd1e6aa7b` 之上修复剩余四项架构失败。全部执行在 CW 本机，复用既有 worktree/依赖/报告；没有新建 Codex/Work 任务、调用真实搜索或模型 API、操作 MII、创建或合并 PR。

## A：当前配置没有回退证据

当前 Pi MCP `[CW_HOME]/.pi/agent/mcp.json` 的 SHA256 `9a5725517f5a32b11a19402d798c0787b229476e9afdf7326bd353f749dfa84c`、固定 GUI-only Rego 的 SHA256 `99b5606209886bf57e04e3bd456479afc2b24b7965f15dd0667be85a68bb540a`，均与本机 Oct7 `APPLIED.json` / `RESULT.json` 的应用记录相同。这是本机历史记录绑定，不声称恢复了独立的历史发布哈希。

Cua 命令仍为 `/usr/bin/env -u … cua-driver mcp --direct`。实际环境绑定 `CUA_DRIVER_PERMISSION_MODE=standard`、`CUA_DRIVER_POLICY_FILE=[CW_HOME]/.config/cua-driver/policies/pi-gui-only.rego`、`CUA_DRIVER_DISABLE_UNRESTRICTED=1`，Wayland 开启，telemetry 关闭。当前 Rego 是 `default allow := false`，仅允许原 19 个桌面工具，且 `screenshot_out_file` 必须为空/缺失。可执行链接仍指向固定 0.34.0 目录，二进制 SHA256 `5fa60c7ab35194e0e050a337521ca0e0b0ae0a8fe898813b340f65c94e15264c`。

清除旧 manifest/session-policy/bypass/embedded 变量是 Oct7 已验收设计；固定 Rego 通过环境变量加载，不能由 `--direct`、没有 socket 或清除 manifest 推断回退。manifest v3/user socket 是另一后续目标。本轮未观察到活动 Cua 进程，因此没有重新证明活动会话中的策略执行，也未启动新权限会话。

Neo 的 Pi 接入仍为 `http://127.0.0.1:9010/mcp`。既有验收明确代理监听 wildcard，同时 `allow_remote_in_mcp=false` 的官方 loopback peer guard 过滤非本机来源；`0.0.0.0` 不等于允许远程控制。这里使用既有 guard 验收证据，没有新做远端可达性或 guard 探测，也没有改变监听、安全、网络或隐私设置。A 结束时两个配置哈希仍相同。

## B：最小、独立可审阅的两个提交

| Scope | Exact commit |
| --- | --- |
| 注释预算、JPEG 精确登记、Storybook 工具归属 | `7d49235b5394b4e5f5e7675f796c8d9b2642be41` |
| AST 分类、遗漏模块 strict 扩展与有效断言；组合验证 head | `e12faf5e0875297ae970a0de947c9763b5ac21e8` |

分支 `fix/architecture-coverage-completion-20261008`，最终 tree `3ab4c19f688c471f7c7e78190d550b35caa8b816`。

1. runtime 的三行注释重排成两行，保留 `ensurePretranslationTrack()` 与 1887 预算。TypeScript 去注释后的可执行输出完全相同；没有调整计数或回退生产修复。
2. 仅精确登记 `src/app/options/assets/wechat-contact.jpg` 为二进制 JPEG，验证非空、JPEG 签名与 EOI 标记；其他未知扩展/路径仍失败。图片实际是有效 JPEG，Pillow 只读结构校验成功；它有尾随数据，首次把 EOI 错限为文件最后两个字节的断言已纠正。没有往 JPEG 写文本头或修改图片。
3. Storybook verifier 加入 `DOCS_TOOL_SCRIPTS`，继承真正的 `node --check`；断言 `storybook:check` 连接实际入口。脚本与既有 workflow 未变；未运行 Storybook/docs 构建产物验收。
4. 原 18 个 ownership 缺口逐一分类：12 个可执行模块和 4 个小型组装适配均进入 strict；reencounterState 经严格 AST 判为纯类型；onboarding 作为精确静态资源归属，并验证中英文 key parity、非空与完整目录一致。

AST 只允许接口、类型别名及显式 type import/export；值/side-effect import、class、enum、执行初始化、函数、错误语法和空文件均不能冒充 type-only。它额外发现三份原先被 `types.ts` 文件名豁免的值导出模块，也已进入 strict。既有纯类型 sessionTypes 冗余 include 保留，没有删除旧 include；组装根和 barrel 仍受既有清单约束。

| Newly included module | Final S/B/F/L % |
| --- | --- |
| `src/core/config/shareCard.ts` | 100/100/100/100 |
| `src/core/i18n/messages/siteRules.ts` | 100/100/100/100 |
| `src/features/full-page-translation/content/excerpt.ts` | 100/100/100/100 |
| `src/features/share-card/core.ts` | 100/100/100/100 |
| `src/features/share-card/export.ts` | 100/100/100/100 |
| `src/features/share-card/render.ts` | 100/100/100/100 |
| `src/features/share-card/themes.ts` | 100/100/100/100 |
| `src/features/vocabulary/content/readingText.ts` | 100/100/100/100 |
| `src/features/vocabulary/content/scanner.ts` | 100/100/100/100 |
| `src/features/vocabulary/domain/reencounter.ts` | 100/100/100/100 |
| `src/platform/webdav/properties.ts` | 100/100/100/100 |
| `src/providers/translation/free-official-web.ts` | 100/100/100/100 |
| `src/app/popup/mount.ts` | 100/100/100/100 |
| `src/app/content/learningFeatures.ts` | 100/100/100/100 |
| `src/features/share-card/content/runtime.ts` | 100/100/100/100 |
| `src/features/vocabulary/content/reencounter.ts` | 100/100/100/100 |
| `src/services/translation-stats/types.ts` | 100/100/100/100 |
| `src/services/model-usage/types.ts` | 100/100/100/100 |
| `src/services/translation/types.ts` | 100/100/100/100 |

新 Popup 测试执行真正 mount 模块，覆盖 setup/main root、配置等待和语言准备失败，不复用仅 mock mount 的可见性测试。learningFeatures 覆盖 userscript、总开关、writing 开关与站点 eligibility，并核对生命周期端口。既有 shareCardRuntime/vocabularyReencounterLifecycle 和真实 scanner/parser/request 编排被复用。

V8 明细驱动新增字号、Unicode 回退、溢出空白、UTC 文件名、非法摘录拒绝、RTL 与完整页脚断言。DOM textContent getter 失效及 context 缺失明确属于防御故障注入，不宣称正常 UI 行为。Canvas、Clipboard、Vue/DOM 与 fetch 使用既有外部端口替身；没有宣称真实像素、剪贴板权限或真实供应商服务通过。

WebDAV URL、namespace、DTD/entity、歧义、深度、size、ETag 保护与免费供应商实现保持原 Git blob。JPEG、预算规则、依赖、package scripts 和 CI 文件也保持原内容。所有旧模块/测试 include 保留，四维阈值仍为 100%，没有 ignore/only/skip。

## 最终验证

- 完整 architecture：32 文件，1357/1357 断言通过，exit 0；基线四项失败全部消除。
- 扩大后的完整 strict：393 文件，9529/9529 断言通过，exit 0；全局与新纳入 19 模块的 S/B/F/L 均为 100%。
- 两项均 0 failed assertion、0 collection error、0 unhandled error。
- 类型检查 exit 0；其运行发生于提交前，相同最终输入逐项以 SHA256 对照，绑定最终 tree，没有重复消费同一已过类型批次。审计与 diff 在最终提交运行，均 exit 0；审计 483 文件、6553 静态用例。

最终完整测试明确绑定 `e12faf5e0875297ae970a0de947c9763b5ac21e8`。299/299 的 19 模块局部 strict 先于测试调用签名纠正，不冒称它在最终 SHA 上运行；完整 strict 再次覆盖最终输入。原 PDF/九模块已过的独立批次未重复，旧回归由本次要求的完整 strict 保留。

保留首轮诊断两个断言失败与一个因 readiness mock 缓存引出的测试清理 unhandled error、首次类型签名失败，以及局部 coverage 未达 100% 的真实记录。修正后最终 unhandled 为零。两个负对照分别临时移除 Popup 配置等待和放宽 AST 值导入；产生 1 与 2 个预期失败，均 0 unhandled，并按 SHA256 恢复到最终文件。没有把错误产品行为固化为断言。

`records/` 包含实际命令/时长/exit、Vitest JSON、覆盖 summary、19 模块完整映射及完整覆盖 gzip；`baseline-22116/` 复用原架构失败证据。[既有 PDF/九模块报告](https://github.com/ArietidsZ/FluentRead/blob/4c2d0d02a298fc179910b7e5edb470e8ab0a27cc/docs/browser-acceptance/runs/20261008-cw-pdf-race-nine-coverage/README.md) 保持原提交。

JSON 在解码后递归脱敏再序列化/解析；本机路径与令牌形态不发布，不读取/复制认证文件。`evidence-files.json` 列出发布文件 SHA256；代码远端确认见 `records/remote-code-confirmation.json`。证据分支自身 SHA 由最终交付给出，避免自引用。

B 无剩余门禁阻塞。A 没有配置回退证据；当前活动会话与 Neo 远端可达性不属于本轮重新验证范围。无需为本轮只读 A 增加安全权限；若后续变更策略、socket 或网络设置，仍需要原有逐项批准。
