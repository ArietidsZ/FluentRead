# CW popup 有效模型：限定范围验收记录

本目录公开已有验收证据的最小子集。整理时没有改动产品源码、重跑测试或构建、操作浏览器、创建 PR。完整回归门禁仍失败；这些记录不能作为全量验收通过的声明。

## 提交与范围

| 对象 | 提交 | 相对基线的改动 |
| --- | --- | --- |
| 上游基线 | `5420bbc819264a7415d8a7d213dff569191356b6` | 本次代码和证据分支的共同基线 |
| 独立 UI | `6268b171bdbef73986f5e0427051e1f9ee0fedf0` | 3 文件，+367/-5；有效模型显示、可访问描述和回归测试 |
| 独立构建前置 | `dccb0bd1c749c7030df590c2512e2b55fb0a5b74` | 2 文件，+42/-3；WXT 0.20.18 TTS 入口元数据加载修复和测试 |
| 实际构建及浏览器验收组合 | `812aa425b8381833aeb32f49f724bd4e6a487ae9` | 5 文件，+409/-8；UI 提交加同一前置补丁 |

组合提交直接父节点是独立 UI 提交；独立前置和 UI 提交各自直接基于上游基线。组合中的前置补丁经 cherry-pick 产生不同提交 SHA。没有把旧 17 文件分支或其语言资源带入这两个最小改动。

- [UI 最小 diff](https://github.com/ArietidsZ/FluentRead/compare/5420bbc819264a7415d8a7d213dff569191356b6...6268b171bdbef73986f5e0427051e1f9ee0fedf0)
- [构建前置最小 diff](https://github.com/ArietidsZ/FluentRead/compare/5420bbc819264a7415d8a7d213dff569191356b6...dccb0bd1c749c7030df590c2512e2b55fb0a5b74)
- [组合验收分支](https://github.com/ArietidsZ/FluentRead/tree/acceptance/integration-popup-effective-model-20261007)

实际加载的是组合提交的 `.output/chrome-mv3`，版本 `0.0.35`，扩展 ID `djnlaiohfaaifbibleebjggkghlmcpcj`，action 为 `popup.html`。manifest SHA256 为 `54223343e496a19bae001b835811ed037e46aa77012702140286f1947b814844`。独立 UI 提交没有单独完成构建及真实浏览器验收。

## 已有自动检查

以下结果来自已有日志，均记录实际对象；整理本目录未重复执行。

| 检查 | 结果 | 对象与限制 |
| --- | --- | --- |
| 独立 UI 相关测试、audit/diff | PASS | UI SHA；6 文件、61/61 测试 |
| 独立前置标准 prepare 和相关测试 | PASS | 前置 SHA；2 文件、40/40 测试；未修入口的实际 WXT 转换先出现 1 failed / 19 passed |
| 组合 prepare、相关测试、compile | PASS | 组合 SHA；8 文件、101/101 测试 |
| Chrome、Firefox、Firefox zip、manifest 校验 | PASS | 组合 SHA；manifest 校验带 `--require-firefox-archives` |
| userscript 构建及 verifier | PASS | 组合 SHA |
| docs build/check/typecheck | PASS | 组合 SHA；发生于添加本证据目录之前 |
| `pnpm test:regression:all` | FAIL | audit/prepare/compile 通过，在 strict coverage 处退出；6 failed / 376 passed files，9 failed / 9369 passed tests，1 error；四维 100% 未建立 |
| `pnpm test:architecture` | FAIL | 3 failed / 29 passed files，3 failed / 1328 passed tests |
| 完整流水线 coverage 后的分组和构建阶段 | NOT_RUN | 前面已失败；表中的构建成功来自同 SHA 独立命令 |
| 重复单独 coverage | STOPPED | 已有完整流水线执行同一检查，重复项被中断；不声明完成 |
| 新证据目录的 docs 构建 | NOT_RUN | 本次仅整理和发布已有证据，未重跑 |

Coverage 失败涉及 `contentFeatureMounting` 2、`harnessConversation` 1、`translationStatsI18n` 1、`imageGlossaryContext` 2、`settingsCompositionAutosave` 3 个断言，另有 `imageTranslationPageRead` suite collection failure 和 OCR unhandled error。架构失败涉及既有 verification ownership、字幕文件 1888 行超过 1887 行限制，以及既有 `wechat-contact.jpg` 的源文件头检查。已有未改基线复现记录保持私有；本次未修这些无关项，也未声称其他此前失败的分组在组合 SHA 上重跑通过。

新增 UI 测试覆盖有效默认/继承/显式模型、原有服务搜索与自定义 OpenAI 模型搜索、读写覆盖、已移除 provider、键盘焦点、关闭重开、模型映射和切换时的重置规则，以及现有七语言 `modelScope` 模板。这些单元层结果与下面的真实浏览器范围分别记录。

## 真实浏览器结果

验收于 CW 本机 GNOME Wayland 完成。使用一个临时 Neo 窗口和专用 profile/HOME/XDG/BROWSERCLAW_DIR，正常 GUI、原生 Wayland、保留 sandbox；未使用 headless、软件 GPU 参数或日常 profile。Cua 的限定能力指向该窗口，实际前台按键/点击会聚焦此临时窗口；截图只捕获该窗口。没有将页面 `document.hasFocus` 当作 OS 焦点证据，也没有将 `popup.html` 标签页当作 action popup。

| 实际步骤 | 结果 | 证据 |
| --- | --- | --- |
| 通过扩展菜单打开 toolbar popup，并完成语言引导 | PASS | [原始 popup 截图](cua-real-popup-rendered-2.png)；原报告记录实际 extension popup target |
| 默认/继承模型及独立 input/document 模型显示 | PASS | [有效模型截图](cua-effective-models-2.png)；合成值 `cw-default-model`、`cw-input-explicit`、`cw-document-explicit` |
| 自定义读写 provider 搜索、Down/Return、输入与选项焦点、返回功能行 | PASS | [读写覆盖截图](cua-custom-read-write-correct-2.png)；原报告及私有 DOM/配置读回 |
| 显式读写模型描述和切换写作 provider 时的模型清空 | PASS | 私有配置读回；reading 保留，writing 使用新 provider 的有效模型 |
| 无 key 的 OpenAI 警告、机器翻译无虚构模型 | PASS | 私有 DOM/配置断言；未调用翻译 API |
| Escape 和外侧 blur 真正关闭 popup | PASS | [Escape 读回](popup-close-escape-check.json)、[blur 读回](popup-blur-check.json)：popup target 数为 0 |
| 真实 toolbar 重开后配置及模型持久化 | PASS | [原始重开截图](cua-final-persistence-panel-2.png)、[配置读回](config-final-reopen-persistence.json) |
| 本机 Neo MCP tabs/snapshot/screenshot | PASS | 原报告记载 HTTP 200、`isError=false`；使用本地合成 fixture |
| RTX 5090 WebGPU 基础 compute | PASS | [原始 compute 读回](webgpu-real-compute-result.json)：非 fallback adapter，GPU 输出 `[3,5,7,9]`，无 JS compute fallback |
| Firefox 真实 UI、独立 UI SHA 原生验收、七语言逐一原生截图、provider 移除及 model-only 搜索的原生专项验收 | NOT_RUN | 不把单元测试或组合浏览器结果归为这些项的通过 |
| 真实翻译 API、AI 模型推理、GPU benchmark、持续长任务或全产品浏览器回归 | NOT_RUN | 本次使用无 key、无账号的合成数据和 inert 本地 endpoint |

最终重开读回：reading 为 `custom:cw-test-b` / `cw-reading-explicit`；writing 为 `custom:cw-test-b` / 空 feature model，显示有效 `cw-b-model`；hover 为 Microsoft Translator。最初把未知模型直接写入 model 的测试数据被产品正常规范化，随后改用正确的 `customModel` / `documentCustomModel` 字段；没有把这个数据错误写成产品缺陷。

## 版本、隔离与收尾

已有验收记录的版本为 Neo release `browserclaw/v0.51.0`、Chromium package `155.0.8309.26`、MCP `browseros-neo 0.0.65`（22 是工具数，不是通过用例数）、Cua `0.34.0`、WinRects version 8 ACTIVE。GPU 记录为 NVIDIA GeForce RTX 5090、driver `595.91.07`、GPU sandboxed、WebGPU enabled；只证明基础 compute。

启动记录、sidecar 六项隔离环境和 117 个打开文件路径支持隔离；Chromium 主进程 `/proc/environ` 的六项字段未能直接读回，因此不宣称主进程环境已直接确认。真实配置只做过元数据比较，不把它描述为全盘内容哈希证明。本次证据整理没有访问认证正文、完整 runtime/session 文件或日常配置。

Neo MCP 曾监听 `0.0.0.0:9010/9011`，不能称为 loopback bind；原记录中 `allow_remote_in_mcp=false`，真实非 loopback 连接被重置且无 HTTP 字节，CDP/sidecar 为 loopback。Cua 清单限定临时窗口，不能据此宣称所有 GNOME/portal 能力都只限该窗口。此前 portal/capture/background/key-name、测试表达式、SSE、session/manifest expiry 等失败保留在私有原始记录，经过有限修复后才完成上述步骤。

既有 cleanup 记录确认任务专用 Neo、sidecar、Cua 和 fixture 已退出，相关端口无监听；隔离 profile 和原证据保留。已安装的工具、GNOME 设置及 portal 操作效果未在 cleanup 中撤销；本次没有重新部署或更改这些设置。

## 公开子集与完整性

四张 PNG 已逐张查看，均为临时浏览器窗口、合成内容，无账号、凭证或无关桌面。它们按原始字节复制，没有裁剪、编辑或重制。五个小 JSON 也按原始字节复制，内容仅为构建标识、popup 计数、合成配置读回及基础 compute 结果。

`fluentread-build-identity.json` 是加载扩展之前的身份快照，其中 `extension_loaded=false`、`popup_tested=false` 是当时状态；后续实际 popup 验收见本报告所引用的原始截图、读回和私有 `RESUMED-REPORT.txt`。不修改旧快照字段来模拟最终状态。

[manifest.json](manifest.json) 列出每个公开文件的原始文件名、字节数和 SHA256，以及仍为私有的相关报告/断言/日志的 SHA256。完整报告、DOM/system-info/隔离日志、profile、runtime/session/认证材料均未上传；本目录不是全日志备份。私有报告包含范围外信息，因此只发布本次聚焦摘要。manifest 对报告本身的哈希不构成独立第三方证明。
