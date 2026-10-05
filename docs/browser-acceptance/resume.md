# 从已核对的本地状态继续

Linux 原生报告先按 [Linux 材料补齐与恢复边界](./linux-resume.md) 处理来源和缺失文件；下面的 macOS guard 不能作为 Linux/Wayland 的通过依据。

现有 `0bd32b4a` 证据已核对 401/401 个构建文件，22 项仍为 blocked，尚未运行模型。旧临时 profile 和夹具服务已经清理，旧 PID/端口不能复用。保留这个快照。下面只更新测试交接和新的结果目录，不修改用户的验收分支，不重建扩展，也不把 GPU 探测当成推理通过。

## 取得工具与保留证据

在已验证的 FluentRead 仓库执行；工作区名字可换成未占用目录：

```bash
git fetch https://github.com/ArietidsZ/FluentRead.git review/browser-acceptance-20261005
git worktree add --detach ../fluentread-acceptance-tools FETCH_HEAD
cd ../fluentread-acceptance-tools
```

继续使用已核对的产品目录/扩展和其 source commit。新建独立 `FR_RUN` 目录，复制旧结果 JSON 和需要保留的脱敏 artifacts；不要复制浏览器 profile、凭据或模型权重。`FR_OLD_RUN`、`FR_RUN`、`FR_PROFILE`、`FR_BROWSER_PID`、`FR_CDP_PORT` 均由本地 Agent 从实际路径、启动记录、进程和监听器核对，不能照抄旧 PID/端口。新增结果另存，原快照保持不变。

## 原始 GPU 证据的规范化

WebGPU 允许 adapter 的 vendor、architecture、device、description 全部为空字符串。保留这些原始值；友好名称放在可选 `adapterLabel`，不能补写到原始 description。[GPUAdapterInfo 规范](https://www.w3.org/TR/webgpu/#gpuadapterinfo)

新工具以“原始文件 SHA-256 + eventIndex + context + at”绑定一次成功探测，把该事件自己的 adapter/features/limits 一起写到结果元数据。示例中，旧 `gpu-log.json` 的事件 2 是成功的 extension-offscreen 探测；先检查实际文件再选索引：

```bash
node scripts/testing/browser-acceptance.mjs normalize-gpu \
  "$FR_RUN/result.pending.json" artifacts/env01/gpu-log.json 2 \
  > "$FR_RUN/result.normalized.json"
node scripts/testing/browser-acceptance.mjs validate "$FR_RUN/result.normalized.json"
```

输入与输出必须是不同文件，不能把输出重定向回输入。工具不改原始日志、不改变用例状态，也不自动把 hardware.status 改为 physical。旧记录中 extension-worker 的 timeout 仍是失败的探测；后来成功的 worker 探测使用新的原始文件、时间和事件绑定，不能覆盖旧记录，也不能借用普通页面或 Offscreen 的 features/limits。缺字段/失败事件/哈希或上下文不一致会被拒绝。

旧事件 2 的原始 `extension-offscreen` 标签保持不变，但当时是用 Target.createTarget 打开扩展来源的 offscreen.html 入口页，不证明 chrome.offscreen 创建的实际文档生命周期或模型 Worker 执行。后续产品路径需在已授权扩展上下文中核对 `runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})`，并保留实际上下文证据。[Chrome Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)

## 创建新的临时实例，再检查焦点边界

`browser-focus-guard.mjs` 是本地 Agent 运行的 macOS 只读观察器，不是浏览器启动器，不实现个人 Playwright helper 的 API。它检查进程 UID、临时 profile 的实际路径与私有权限、所有权标记、loopback CDP listener、正常尺寸窗口的实际可见几何，以及前台 PID。默认策略仍要求完全位于活动屏幕之外。`/tmp` 和 `/private/tmp` 用 realpath 比较；模糊路径或不同 profile 会失败。

本次用户于 2026-10-05 明确批准一个有限例外：专用临时窗口可部分可见，但仍不得成为前台，不能使用日常 profile。使用显式参数 `--allow-partial-visibility` 选择稳定策略 `temporary-partial-visibility-20261005`；不传参数时是 `fully-offscreen`，旧证据缺少该字段也只按严格默认解释。新策略允许完全离屏或部分可见，拒绝完全可见（包括被多个屏幕合计完全覆盖）、最小化、全屏、尺寸不足或前台窗口。约 40 像素是旧机器的实测现象，不是新的上限或保证。

先通过本地 Agent 已支持、已授权且能够保持后台并满足所选可见性策略的方式新建独立临时浏览器实例，并重新启动回环夹具。保留实际 profile、PID、CDP 端口和启动记录。guard 不启动浏览器；如果本地没有符合所选策略的已验证启动方式，这就是准确的剩余阻断，不能伪造成功或改用会抢焦点的启动。

本交接只做过纯逻辑自检，尚未在 macOS/BrowserOS 实机认证。不要把自检成功当作焦点验收。对新建且明确属于本次任务的临时实例先执行单次观察：

```bash
node scripts/testing/browser-focus-guard.mjs \
  --profile "$FR_PROFILE" --pid "$FR_BROWSER_PID" --port "$FR_CDP_PORT" \
  --output "$FR_RUN/focus-preflight.json" --once --allow-partial-visibility
```

profile 必须位于系统临时目录中，名称以 `fluentread-` 开头，属于当前用户且没有组/其他用户权限。guard 只在验证通过后创建该临时目录内的所有权标记；不 chmod、不打开窗口、不移动/最小化窗口、不抢焦点、不接受任何权限提示。条件不满足时准确记录 blocked，按实际缺项处理；不能关闭保护继续。

单次观察仅证明观察时刻。实际操作期间必须持续运行下面的 guard；记录采样时间和间隔，操作前后查看运行状态和新鲜观测。退出、blocked、读不到状态、权限错误或明显停更时，立即停止浏览器操作。guard 的成功不直接使任何用例 pass。报告中把完成的 guard JSON 登记为 focus-guard artifact，并将路径填入 environment.focusGuardEvidence，同时从同一记录填写 browserPid/profilePathSha256。新 guard 在根记录及每个观测中写入 visibilityPolicy，并保留原始 windows/displays 和派生 visibleArea/windowArea/classification。将同一策略填入 environment.visibilityPolicy，windowPlacement 如实写“部分可见”及实际位置，不能伪称完全离屏。验证器会要求报告、guard 和观测策略一致，从原始几何复算可见面积，并重新检查正常尺寸和前台 PID，要求 continuous 模式至少两次观测，并将通过项所引用 browser-log 事件时间限制在首末观测之间。首个 running 观测后才操作，最后一个操作之后等待新的观测再停止 guard；单次预检、事后观察、缺失、违规或未结束的 guard 都不能支撑 pass。

## 验证 task-scoped Neo stdio 控制面

原记录说明已安装的 MCP 控制面使用既有 BrowserClaw 配置；另一个 `--user-data-dir` 并不会自动改变 MCP 的目标。不要编辑持久 MCP/client 配置来修复它。

官方 BrowserOS v0.50.5 对应提交为 `96ff75aa8f3f023c526308df32cdd299331a3ec9`。该版本支持 `--config`、`--stdio`，sidecar 的 `ports.cdp` 指向浏览器 CDP，`directories.resources` 指向资源目录；`BROWSERCLAW_DIR` 决定状态目录。[配置源码](https://github.com/browseros-ai/BrowserOS/blob/96ff75aa8f3f023c526308df32cdd299331a3ec9/packages/browseros-agent/apps/claw-server-rust/src/config.rs)

1. 找到实际已安装、官方来源的 server 可执行文件与配套资源目录，分别记为 `FR_NEO_SERVER`、`FR_NEO_RESOURCES`。运行其 `--version`、`--help`，保存输出，确认本地二进制支持上述参数。浏览器版本、Neo 扩展版本和 MCP server 版本分别记录，不能因为浏览器显示 0.50.5 就假定服务端完全匹配。
2. 在 `FR_RUN` 内生成一次性 JSON；`FR_CDP_PORT` 必须是已验证临时实例的实际数字端口，不能使用默认端口回退：

```bash
node -e 'const fs=require("node:fs");const [out,port,resources]=process.argv.slice(1);const cdp=Number(port);if(!Number.isInteger(cdp)||cdp<1024||cdp>65535)throw Error("Invalid verified CDP port");fs.writeFileSync(out,JSON.stringify({ports:{cdp},directories:{resources}},null,2),{mode:0o600});' \
  "$FR_RUN/neo-sidecar.json" "$FR_CDP_PORT" "$FR_NEO_RESOURCES"
```

3. 仅使用本地 Agent 已支持的一次性 stdio 子进程连接方式，传入以下子进程环境和命令；不要写入永久 client 配置，不改变 HOME，不启用 HTTP server。记录该子进程真实 PID 为 `FR_NEO_PID`：

```bash
BROWSERCLAW_DIR="$FR_RUN/neo-state" "$FR_NEO_SERVER" \
  --config "$FR_RUN/neo-sidecar.json" --stdio
```

官方 main 先分流至 stdio；HTTP 路径才执行 endpoint/client 配置修复。应用状态仍会写入 BROWSERCLAW_DIR，所以必须使用本次独立目录。[启动分支](https://github.com/browseros-ai/BrowserOS/blob/96ff75aa8f3f023c526308df32cdd299331a3ec9/packages/browseros-agent/apps/claw-server-rust/src/main.rs)、[应用状态与 CDP 接线](https://github.com/browseros-ai/BrowserOS/blob/96ff75aa8f3f023c526308df32cdd299331a3ec9/packages/browseros-agent/apps/claw-server-rust/src/app.rs)

4. 在任何浏览器操作前，让另一个本地终端持续运行 guard。它只在 UID、进程启动身份、`--stdio` 和准确的本次配置文件及 ports.cdp 都匹配时管理这个 Neo 子进程；guard 失败或结束会终止该已核对的子进程，避免自动重连到被复用的端口。它不会终止浏览器或不同/复用的 PID。

```bash
node scripts/testing/browser-focus-guard.mjs \
  --profile "$FR_PROFILE" --pid "$FR_BROWSER_PID" --port "$FR_CDP_PORT" \
  --server-pid "$FR_NEO_PID" --server-config "$FR_RUN/neo-sidecar.json" \
  --output "$FR_RUN/focus-guard.json" --allow-partial-visibility
```

guard 输出 running 且观测新鲜后，通过实际工具清单做只读能力核对，确认看到本次夹具标签和实际 FluentRead ID。没有支持的一次性 stdio 连接方式、版本/资源不匹配、页面不可访问或权限被拒绝，都应写明具体阻断，不自动安装新软件，不回退 HTTP，也不通过直接 CDP 绕过 Neo 已拒绝的动作。CDP loopback 的只读身份/窗口检查不等于启动 Neo HTTP 服务。[连接目标与重连行为](https://github.com/browseros-ai/BrowserOS/blob/96ff75aa8f3f023c526308df32cdd299331a3ec9/packages/browseros-agent/apps/claw-server-rust/src/services/browser/connection.rs)

## 按实际能力继续用例

原生 Neo UI 用例不依赖 Playwright。安全控制面与 guard 成立后，用真实已发现的工具检查 UI-01、OCR-UI-01 和原生支持的隐私/字幕界面；选择器以实际页面为准。缺少 Playwright 只阻断依赖它的旧 runner，不能自动阻断所有原生 UI 用例。完整 pass 仍须满足 [矩阵](./cases.md) 的所有断言和证据。

如果本机已经有受信任的 Playwright 与旧 helper，现有 Popup runner 支持 `--load-via-cdp`，避免把不再生效的 `--load-extension` 当成成功；必须按其返回的扩展 ID 核对名称/版本。扩展安装、无痕访问和未预料权限继续由用户或已授权本地 Agent 按实际界面完成；不要替用户接受新的权限。

请求的完整 GPU 验收已经涵盖必要的固定模型下载。检查磁盘空间，按目录中的确定版本、尺寸和 SHA 顺序准备模型，一次一个，通过已有产品下载/验证路径使用它们，不一次下载全部，不要求重复授权。Paddle/LaMa 可走现有已验证文件导入，分别保留原文件哈希及导入后的真实推理证据。只有遇到额外权限、收费服务或磁盘不足等新决策时才提出具体问题。

用新结果目录逐项记进度：真实能力/权限缺失写具体 blocked 原因；尚未执行的项目写“未执行，下一步为……”而不是虚构环境不支持。22 项旧快照保持原样。来源与构建字节已经核对，更新本交接、元数据绑定或重跑 fixture 不要求重建扩展；任何未来产品改动才需要新的构建/来源验收。

本次策略仅用于新的运行记录；不修改旧 blocked 快照或既有失败事件，不以 guard 通过替代任何 UI/模型断言。只需更新交接脚本和元数据，产品源码与已核对构建不变，无需重建扩展。
