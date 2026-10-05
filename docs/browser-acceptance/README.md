# BrowserOS Neo 本地验收交接

已验证的本地产品 HEAD 为 **`7212af1f9da08324963e38973c7f477aabfffb0b`**，其 Git tree 固定为 **`50e12ecc7f4c72448f03e714a585814eb9476622`**。GitHub 发布的 source commit 可能因提交元数据/历史不同而具有不同 SHA，必须验证 tree 相同，不能假定本地 HEAD 可从远程获取。本目录及配套脚本只交接测试，不修改产品。此前云端真实浏览器验收被阻断；本目录不是浏览器、硬件 GPU 或真实模型通过报告。

## 给本地 Agent 的任务

在自己的本地环境读取本文件、[验收矩阵](./cases.md)、仓库根目录 `AGENTS.md` 和 [测试说明](../testing.md)。先检查实际安装的 BrowserOS Neo 版本、可用工具及其说明，再选择支持的操作；本交接不假定任何 Neo API、工具名称或产品选择器。定位控件时检查当前页面和可访问性树，必要时对照固定源码。

只使用为这次验收新建、可清理的临时浏览器 profile，不连接日常 profile。检查 BrowserOS 能否在该 profile 安全控制扩展页面、普通页、无痕窗口及诊断目标。安装 unpacked 扩展、开启无痕访问以及其它权限步骤由用户或其已授权的本地 Agent 按实际界面完成。未获授权的权限请求留给用户；不绕过浏览器、工具、系统或企业策略。

遵守仓库已有 focus-safe 条件：正常尺寸、第二屏或屏幕外的后台窗口，不最小化、不抢焦点、不调用 `bringToFront()`。现有脚本的可信 helper、运行时、操作系统前提必须真实存在。缺少任何条件就把相关用例写成 `blocked`，给出准确原因；不要伪造 helper、关闭保护、发明启动参数或换路线绕过拒绝。前台测试需要另一次明确授权并如实记录，不能默认打开 `--headed`。

先完成无需下载模型的本地夹具。真实模型用例显式选择后执行，下载前说明模型、固定版本、总量与来源，并遵守本地用户授权和资源限制。有受支持的物理 GPU 时必须使用它。没有时报告 `blocked`，不能把 SwiftShader、llvmpipe、Node Dawn、修改后的 adapter feature/limit 或 CPU 结果算作硬件 GPU 通过。故障注入只能独立标注，不能混入正常推理证据。

按矩阵逐项填入 `result.template.json` 的副本，记录实际观测和证据。完成后验证结果，交付简短摘要、结果 JSON 和脱敏证据。只完成部分项目时保持整体 `blocked`；任何实际断言失败使整体为 `fail`。

## 获取与构建

从 `ArietidsZ/FluentRead` 的 `review/browser-acceptance-20261005` 分支取得这些文件。已验证的产品 [source commit](https://github.com/ArietidsZ/FluentRead/commit/c68a53af300b33109375665197951331e45ae18a) 是 `c68a53af300b33109375665197951331e45ae18a`（不是包含这些文档的最终提交）。在同一仓库先验证其 tree，再创建单独产品 worktree：

```bash
FR_SOURCE_COMMIT=c68a53af300b33109375665197951331e45ae18a
git rev-parse "$FR_SOURCE_COMMIT^{tree}"
# 必须等于 50e12ecc7f4c72448f03e714a585814eb9476622，否则停止
git worktree add --detach ../fluentread-acceptance-product "$FR_SOURCE_COMMIT"
cd ../fluentread-acceptance-product
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm generate:userscript-languages
pnpm compile
pnpm build
node scripts/testing/verify-emitted-model-workers.mjs --extension-dir .output/chrome-mv3
```

使用 **Node 22 / pnpm 9.12.1**。如果工具未安装，按本地环境的安装授权规则处理，不静默安装或升级浏览器。保存命令、版本、退出码和构建日志。生成语言文件是必要的本地步骤；记录生成的 `userscript/languages` 文件及哈希，不将它们误报为原提交中已存在。扩展构建输出为 `.output/chrome-mv3`。

本次以 Chromium 扩展为验收目标。Firefox 或 userscript 如需验证，分别构建并单列结果，不能继承 Chromium 的通过。生成的语言资源已包含在上述公开 source commit 中；**产品配置的 userscript 远程 pin 保持原值，其资源 URL 和运行时尚未针对此次发布验证**。本交接不更改 pin、不发布新版 userscript。扩展验收仍使用构建内的语言资源并记录本地生成结果。

返回包含本交接的 worktree，启动无依赖、仅监听回环地址的夹具：

```bash
node scripts/testing/browser-acceptance.mjs serve
```

终端打印实际端口和 URL；在隔离测试 profile 中打开该 URL。它复用仓库的 HTML 夹具，首页另提供合成文本、普通单图和漫画图片。图片由本地 Canvas 生成，实际像素和浏览器字体需随证据保留。它不伪装成 YouTube，也不运行模型。

服务提供 `/v1/chat/completions` 的确定性 OpenAI 兼容响应、`/slow/v1/chat/completions` 的 2.2 秒延迟及 `/fail/v1/chat/completions` 的显式 503 故障。自定义服务只填虚构密钥 `fixture-not-secret`，模型名限 `fixture-normal`、`fixture-private`，关闭流式输出。响应是带标记的固定测试译文，只验证路由和界面，不评价译文质量。`/metrics` 仅记录请求序号、模型、故障类型与计数，不记录正文或鉴权。不要向夹具输入真实私密文本、密钥或账号数据。

## 复用现有浏览器专项

这些脚本自己启动隔离浏览器，不能假定可附着到 BrowserOS 已有窗口。使用前读取脚本，验证已安装的 Playwright、可信 focus-safe helper、浏览器扩展加载支持及操作系统工具；显式提供所有路径，避免使用历史机器的默认值。Neo 不能满足时保留 `blocked`，可以继续完成其实际支持的独立 UI 用例。

```bash
node scripts/testing/run-popup-actions-service-ui-test.cjs \
  --extension-dir "$FR_EXTENSION" --browser-path "$FR_BROWSER" \
  --playwright-root "$FR_PLAYWRIGHT" --focus-safe-helper "$FR_FOCUS_HELPER" \
  --artifacts-dir "$FR_EVIDENCE/provider"

node scripts/run-privacy-boundary-test.cjs \
  --extension-dir "$FR_EXTENSION" --browser-path "$FR_BROWSER" \
  --playwright-root "$FR_PLAYWRIGHT" --focus-safe-helper "$FR_FOCUS_HELPER" \
  --artifacts-dir "$FR_EVIDENCE/privacy"

node scripts/run-youtube-subtitle-sync-test.cjs \
  --extension-dir "$FR_EXTENSION" --browser-path "$FR_BROWSER" --ffmpeg "$FR_FFMPEG" \
  --playwright-root "$FR_PLAYWRIGHT" --focus-safe-helper "$FR_FOCUS_HELPER" \
  --artifacts-dir "$FR_EVIDENCE/youtube-native"
```

这里的变量须由本地 Agent 填入已验证的本地路径，不是安装说明。第三个专项将已有 YouTube DOM、媒体时间轴和翻译响应夹具路由到自己的测试浏览器；不代表在线 YouTube 或真实 ASR。隐私专项不覆盖新增无痕专用配置的全部隔离行为，仍须执行矩阵中的两项无痕用例。

`scripts/testing/run-image-recognition-settings-test.cjs` 可补充单图 Paddle 设置验证；`scripts/testing/run-manga-translation-test.cjs --page-feedback` 包含实际模型的单图路径，须另满足其 macOS、资源和可信 helper 前提。不要默认运行完整旧 `run-local-audio-gpu-test.cjs`：其缺省故障预期仍包含 WASM 重建，不能据此认证当前默认 GPU TTS 模式。`local-model-browser-session.cjs` 是交互诊断脚本，含历史首个 worker 推断，不能用来证明 BrowserOS 中扩展身份。Node OPUS GPU audit 也不是扩展验收。

## 硬件、来源与证据

1. 先取得操作系统可用 GPU 清单、驱动信息以及浏览器 GPU 诊断，再在实际扩展执行上下文记录 `navigator.gpu.requestAdapter` 的原始 info、`isFallbackAdapter`、features 和 limits。两层证据相互核对；网页 probe 成功不代表 Worker/Offscreen 成功。缺少 `shader-f16` 等必要能力时保持明确拒绝，不能改写它。
2. 记录 BrowserOS 和浏览器版本、浏览器二进制 SHA-256、完整启动参数（先脱敏）、启动方式、临时 profile 所有权标记、扩展真实 ID/名称/版本、正常窗口和无痕窗口上下文、焦点策略和窗口位置。只能操作该测试实例的目标。
3. 分别记录已测试本地 HEAD、已发布 source commit、实际 checkout、Git tree、工作树状态、锁文件、构建产物清单 SHA-256。source commit 与 checkout 必须相同且 tree 必须匹配上述值。以下命令只计算哈希，不上传文件，也不启动浏览器：

```bash
node scripts/testing/browser-acceptance.mjs fingerprint ../fluentread-acceptance-product/.output/chrome-mv3 extension-build > build-files.json
node scripts/testing/browser-acceptance.mjs fingerprint ../fluentread-acceptance-product/userscript/languages generated-locales > generated-locales.json
```

4. 每个真实模型记录 ID、不可变 revision、模型文件预期/实测尺寸与 SHA-256、实际运行时 JS/MJS/WASM 哈希和观察到的执行后端。参考 `src/core/config/localTranslationArtifacts.json`、`src/features/local-tts/offscreen/modelCache.ts`、`src/features/video-subtitle/offscreen/qwen/artifacts.json`、图片模型资源定义；从实际源码读取，不能沿用旧报告值。只提交哈希，不提交模型权重。
5. GPU 通过须有真实输出、会话/Worker 日志及可获得的 WebGPU dispatch 或图分区证据。只看到 `backend: webgpu` 不够。无法观察关键事实则 `blocked`。Paddle/LaMa 的允许形状控制节点及 Kokoro 的实际 CPU 运算必须如实披露，不声称所有节点纯 GPU；参见 [GPU 边界](../maintainers/browser-gpu-local-models.md)。普通 Tesseract、原 OPUS Q8 或显式兼容模式单列，不是严格 GPU 模式的回退通过。
6. 各项保存操作前后截图、控制台/Worker 日志、必要的网络计数及带时钟的观测。1800 ms 字幕期限应保存帧或采样序列，不能仅靠截图。网络证据覆盖 content、background、Offscreen 和 Worker，不能只看普通页。故障注入记录注入点、时间、目标、变更哈希和恢复，另存证据。

## 结果格式与交付

```bash
cp docs/browser-acceptance/result.template.json result.json
node scripts/testing/browser-acceptance.mjs validate result.json
node scripts/testing/browser-acceptance.mjs self-check
```

`result.schema.json` v2 是严格结构；验证器另检查用例完整、总体状态、通过证据、文件哈希与真实模型来源。填好的证据使用相对路径并放在结果旁边。用例 `pass` 表示该项的全部断言确已观察到，`fail` 表示实际行为违反断言，`blocked` 表示未执行、未选择真实模型、能力不足或证据不足；未执行不能写成通过。可以在 `observations` 保留已完成子步骤，但不能覆盖剩余阻断。

证据必须在 `artifacts` 登记真实 SHA-256、媒体类型和 `role`。每个通过项至少引用实际 PNG `screenshot` 与结构化 `browser-log`；能力、源码、构建和语言清单不能用 README 代替。`capabilities` JSON 记录 `browserosVersion`、实际工具名 `tools` 和已观察能力 `operations`。`source` JSON 与 `provenance` 中的两个提交、tree、锁文件哈希和生成前清洁状态一致。构建/语言清单使用上面的带 kind 的 fingerprint 命令，构建清单保留实际 manifest 文本并校验名称、版本和摘要，语言清单覆盖六种按需语言。

所有日志角色使用 `{ "events": [{ "event": "实际事件", "at": "ISO 时间", "context": "实际执行上下文" }] }`，在事件中保留相关测量字段。GPU 日志还包含 `osGpuDescription` 和原始 `adapter`（`description`、`isFallbackAdapter`、`features`、`limits`），与报告一致；执行事件使用实际 `dispatch` + `count`，或 Index 的 `offload` + `loadedLayers`、`totalLayers`、`gpuModelBufferBytes`，并标明 `model`、`variant`。隐私和离线项目另需 network/storage，时序项目另需 timing 角色，要求以验证器错误和矩阵为准。

`model-catalog.json` 从固定源码提取，并记录来源文件哈希；本次仅接受其中的模型 ID、变体、全部必要仓库文件、不可变 revision、尺寸和 SHA-256。`models.files` 每个文件均填写 `repo`、`revision`、`path` 及预期/实测尺寸和哈希；`runtimeFiles` 必须匹配实际构建清单中的执行入口及 JS/MJS/WASM。OPUS 中英 FP16 两个方向、日→英 FP32 以及 Index 中英两个方向分别记录；MT-03 至少有两个不同模型的真实运行。未准备完整模型资产就保持 blocked。

每次真实运行写入用例 `runs`：固定 `model`/`variant`、目录中的 `direction`、输入 SHA-256、输出和 GPU 日志引用、后端、完成状态及输出摘要。`inference-output` 是 JSON，包含同一 model/variant/direction/inputSha256、`completed: true` 和真实 `text`；Kokoro/LaMa 则引用 `payloadArtifact`，指向 `inference-payload` 中的合成测试 WAV/输出 PNG，Kokoro 另记录实际听检 `audible`。`outputBytes` 是这个 JSON 的实际字节数。不能用模型准备成功或空输出代替运行。

负向项在 `faults` 分别记录每个模型的不可用、初始化失败和 device-loss；视频用其三种媒体拒绝条件，Paddle 另含识别错误。保留 injectionPoint、target、起止时间、changeArtifact/changeSha256、日志、恢复证据、错误、cpuRebuilds、资源释放和恢复结果。`injection` JSON 中 `change` 写出实际注入差异，同时保留 events；对应 browser-log 事件明确 mode、model、target、injectionPoint，恢复事件为 recovery。device-loss 必须同时具备物理 GPU 诊断和实际 deviceLossObserved，不能靠命名一个测试取得通过。

验证器拒绝缺失和自相矛盾的证据，但不能证明人为编造记录的真实性；最终仍须复核截图、日志、输出以及矩阵中的全部行为。`self-check` 的正向样本只是临时生成的验证器测试数据，明确不属于浏览器或模型验收结果。

模板默认全部 `blocked`，不预填任何测试成功。报告中不得包含真实密钥、Cookie、token、个人网页/音频、完整 profile、账号导出、模型权重或本机用户名路径。保留模型/产物哈希、合成夹具和脱敏日志即可。公开前人工检查截图与日志；清理仅限自己创建的临时资源，不清除日常浏览器数据。不要把本次本地测试自动升级为商店发布或线上资源发布。
