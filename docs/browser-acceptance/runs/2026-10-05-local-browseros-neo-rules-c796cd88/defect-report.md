# FluentRead — BrowserOS Neo 本地验收结果与阻断报告（规则修订轮 c796cd88）

**交接文档**：`ArietidsZ/FluentRead` @ `review/browser-acceptance-20261005`
**交接材料版本**：`8ab2fda4` 首轮 → `a8728f79` 修复轮 → `cf541253` 续跑轮（`resume.md` + 焦点守卫 + GPU 事件绑定）→ **`c796cd88f2a2804c9e05da98be949ae4fa6298fd`**（`fix: dispatch focus guard through canonical CLI paths`，本文件所对应的规则修订）
**验证的 source commit**：`c68a53af300b33109375665197951331e45ae18a`（tree 实测 = `50e12ecc7f4c72448f03e714a585814eb9476622` ✓，**三轮都未变，故未重建扩展**）
**运行时间**：2026-10-05
**总体结论**：`blocked`（22/22 用例 blocked；`validate` 与 `self-check` 均通过）

---

## 一、结论摘要

| 项目 | 结果 |
|---|---|
| `resume.md` 第 1 步：新 tools worktree | ✅ `git worktree add --detach ../fluentread-acceptance-tools cf541253` |
| `resume.md` 第 2 步：独立结果目录 + 保留旧证据 | ✅ 新目录 `run-resume/`，复制旧 `result.json`、`counterfactual-pass.json`、`defect-report.md` 与脱敏 artifacts |
| `resume.md` 第 3 步：原始 GPU 证据规范化 | ✅ `normalize-gpu` 绑定成功；`validate` 通过 |
| `resume.md` 第 4 步：新建临时实例 + 焦点守卫 | ⛔ **焦点守卫无法成立**（DEFECT-06，本规则修订未触及该断言），22 个用例在此处全部停住 |
| `resume.md` 第 5 步：task-scoped Neo stdio 控制面 | ✅ 通过（22 工具，server `browseros-neo` 0.0.66，协议 2025-06-18）——**DEFECT-05 因此在 stdio 路径上解除** |
| `resume.md` 第 6 步：按实际能力推进用例 | ⛔ 0 个可执行：守卫未成立时交接禁止启动任何浏览器操作 |
| `browser-acceptance.mjs validate result.json` | ✅ `{"valid":true,"overall":"blocked","cases":22}` |
| `browser-acceptance.mjs self-check` | ✅ 通过（含原生语言回归与新的 GPU/守卫负向回归） |
| `browser-focus-guard.mjs --self-check` | ✅ 通过（纯逻辑契约检查） |
| **新规则回归** `browser-focus-guard-entry-selfcheck.mjs` | ✅ 通过（10 项 CLI 入口身份检查，含文件/目录符号链接、`--preserve-symlinks-main`、eval/stdin 导入） |
| **DEFECT-07 复核**：旧版 vs 新版守卫经 `/tmp` 别名调用 | ✅ 修复确认（旧版静默空转 exit 0；新版输出 `{"ok":true,…}`） |
| 真实模型 | ⛔ 未下载、未执行（0 字节），原因见第四节 |

---

## 二、本轮实际完成的五件事

### 1. 原始 GPU 证据按新契约绑定（成功）

`resume.md` 要求把结果元数据绑定到「原始文件 SHA-256 + eventIndex + context + at」同一次成功探测。先读原始文件再选索引：

```
$ python3 -c "…gpu-log.json events…"
0 os-gpu-discovery       | system_profiler SPDisplaysDataType | 2026-10-05T04:46:48.197Z
1 webgpu-adapter-request | normal-page                        | 2026-10-05T04:47:18.299Z
2 webgpu-adapter-request | extension-offscreen                | 2026-10-05T04:47:18.299Z   ← 选它
3 webgpu-adapter-request | extension-worker                   | 2026-10-05T04:47:18.299Z   error: worker timeout
4 webgpu-adapter-request | incognito-page                     | 2026-10-05T04:47:18.299Z

$ node scripts/testing/browser-acceptance.mjs normalize-gpu \
    result.snapshot-previous.json artifacts/env01/gpu-log.json 2 > result.normalized.json
$ node scripts/testing/browser-acceptance.mjs validate result.normalized.json
{"valid":true,"overall":"blocked","cases":22}
   # 随后把 environment / cases / limitations 更新为本轮实际情况，得到交付的 result.json
```

绑定结果（`hardware`）：

- `rawAdapterObservation` = `{artifact: "artifacts/env01/gpu-log.json", sha256: "8a83a63d09d484fc710a57565d2c32e63d5f3e58fc23c3e5919bedcbb8a6f87c", eventIndex: 2, context: "extension-offscreen", at: "2026-10-05T04:47:18.299Z"}`
- `adapterInfo` = `{vendor:"apple", architecture:"metal-3", device:"", description:""}`（**四个原始字符串，允许全空**，未补写）
- `adapterDescription` = `""`（保持原始值）；人类可读说明移到 `adapterLabel`
- `features` 22 项（含 `shader-f16`），`limits` 6 项，`maxBufferSize = maxStorageBufferBindingSize = 4294967292`
- `isFallbackAdapter` = `false`
- 事件 3（`extension-worker` timeout）**仍是失败的探测**，没有被成功掩盖；本轮也没有借用普通页或 Offscreen 的能力

> 旧 `gpu-log.json` 里的 `extension-offscreen` 标签按 `resume.md` 原样保留。它当天是用 `Target.createTarget` 打开扩展来源 `offscreen.html` 入口页取得的，**不证明 `chrome.offscreen` 实际文档生命周期或模型 Worker 执行**——`resume.md` 已就此提出后续要求，本轮因守卫未成立无法补做。

### 2. 新建独立临时实例（成功），焦点守卫（失败）

```
$ open -g -n -a "/Applications/BrowserOS neo.app" --args \
    --user-data-dir=/tmp/fluentread-resume-856178bb \
    --remote-debugging-port=9345 --remote-allow-origins=http://127.0.0.1:9345 \
    --window-position=2700,120 --window-size=1200,900 \
    --no-first-run --no-default-browser-check --enable-unsafe-extension-debugging
```

实际核对到的事实：

| 事实 | 观测值 |
|---|---|
| 临时 profile（realpath） | `/private/tmp/fluentread-resume-856178bb`，`drwx------`，uid 501，**只属于本次任务** |
| 浏览器主进程 PID | `99156`（日志实例 `79648` 全程未触碰） |
| CDP listener | `127.0.0.1:9345`，`lsof -FpFn` 证明 loopback-only 且属该 PID |
| 窗口 | `1200x900`，`windowState: normal`，从未最小化/全屏/换 Space |
| 前台 PID | 探针期间前台始终是别的应用（DeepSeek Harness / Google Chrome），**浏览器从未成为前台** |
| 与日常实例的关系 | 独立 profile、独立 CDP 端口，互不干扰 |

随即运行 `resume.md` 指定的单次观察：

```
$ node scripts/testing/browser-focus-guard.mjs \
    --profile /tmp/fluentread-resume-856178bb --pid 99156 --port 9345 \
    --output focus-preflight.json --once
Test window intersects an active display; stop and restore approved offscreen placement
EXIT=1
```

结果写入 `artifacts/focus/focus-preflight.json`，`status: "blocked"`，事件为 `guard-violation`。

### 3. 焦点守卫在本机为何不可达（DEFECT-06，新）

`browser-focus-guard.mjs` 的断言是**窗口矩形与每一个活动屏幕都不相交**：

```js
assert(displays.every(display=>!intersects(window,display)),'Test window intersects an active display; …');
```

本机只有一块活动显示器（`27GX-Ultra`，UI 分辨率 2560×1440，`NSScreen.screens.count === 1`；MacBook 内建屏处于合盖状态）。用**两条互不相同的路径**实测窗口摆放：

| 请求位置 | CDP `Browser.setWindowBounds` 实际生效 | AX（System Events）实际生效 |
|---|---|---|
| left 2560 / 2600 / 3000 / 4000 | 一律停在 **left = 2520**（右侧仍留 40 px） | 同：停在 2520 |
| left −1200 / −2000 / −5000 / −9000 | 一律停在 **left = −916**（仍留 284 px） | 停在 −916 |
| top 1440 / 3000 | 停在 **top = 1394** | 停在 1394 |
| top −900 / −3000 | 停在 **top = 30** | 停在 30 |

即 macOS WindowServer 会把普通窗口夹在屏幕内，**任何普通窗口都不可能完全离开活动屏幕**。因此：

- 单次预检必然 `guard-violation`；
- 持续 guard 永远到不了 `running`；
- `resume.md` 明确规定「guard 失败/blocked 时立即停止浏览器操作」，于是**所有浏览器用例在起点就被拦住**；
- 反证：把真实证据的 `ENV-01` 改成 `pass` 后，校验器报的第一条就是
  `Pass requires a completed continuous focus guard bound to the actual browser/profile`（见 `counterfactual.mjs` / `counterfactual-pass.json`）——不再停在语言或 GPU 断言上。

**这不是权限问题**：本轮已确认 Accessibility/System Events 自动化权限可用（AX 读写窗口成功，`osascript` 返回 0），AX 与 CDP 两条路径给出完全一致的夹取边界。**它也不是"环境不支持"**：`resume.md` 设想的死区摆放需要多屏且屏幕之间有错位空隙，且 WindowServer 仍会夹取；本机为单屏。

> 结论：在当前交接契约下，**单显示器 macOS 主机上任何浏览器用例都无法 pass**。要让该契约可满足，需修改守卫的 offscreen 判定（例如允许「屏幕外的第二显示器」或明确接受被夹取的 40 px），或提供真实的第二块显示器并确认死区摆放确实不被夹取。

### 4. task-scoped Neo stdio 控制面（成功 → DEFECT-05 解除）

按 `resume.md` 第 5 步，先用官方已安装二进制核对参数支持，再生成**一次性**配置：

```
$ browseros-claw-server --version        → 0.0.66
$ browseros-claw-server --help           → --config <CONFIG> / --stdio 均存在
  二进制 SHA-256: 2e98c1a5ef33f4289060783b08b5c9bfc7708ffb65532c3f757cc94d915dc54f
  FR_NEO_SERVER   = <HOME>/Library/Application Support/BrowserClaw/.browseros/BrowserClawServer/versions/0.0.66/resources/bin/browseros-claw-server
  FR_NEO_RESOURCES= …/versions/0.0.66/resources

$ node neo-sidecar.json ≈ {"ports":{"cdp":9345},"directories":{"resources":"<HOME>/…/0.0.66/resources"}}

$ BROWSERCLAW_DIR=<run>/neo-state "$FR_NEO_SERVER" --config <run>/neo-sidecar.json --stdio
```

以一次性 stdio 子进程做**只读握手**（`initialize` + `tools/list`）：

| 事实 | 观测值 |
|---|---|
| server 身份 | `browseros-neo` 0.0.66（`serverInfo`） |
| 协议 | `2025-06-18` |
| 工具数 | **22**（与浏览器内置实例完全一致） |
| 应用状态目录 | `<run>/neo-state`（自建 `browserclaw.sqlite` + 迁移日志，**日常实例未被触碰**） |
| 配置生效 | `ports.cdp = 9345`（本次临时实例的真实端口）、`directories.resources` 取自运行目录内 JSON |
| HTTP 服务 | 未启用；未写任何持久 client 配置、未改 `HOME` |

**这解除了原 DEFECT-05 的核心问题**：控制面不再被单一份额配置绑死，`--config` + `--stdio` 可以让任务专用实例拥有自己的 CDP 接线与状态目录。

> 但按 `resume.md`，**guard 未 running 时不得进行浏览器操作**，因此本轮止步于 `tools/list`，没有通过控制面读取任何页面。`tabs`/夹具标签/实际 FluentRead ID 的只读核对属于**下一步**。

---

### 5. 规则修订 `c796cd88` 的回归复核（成功 → DEFECT-07 解除）

上游在 `cf541253` 之后又推了一个提交，只改两处、不动任何验收文档与用例契约：

| 文件 | 变化 |
|---|---|
| `scripts/testing/browser-focus-guard.mjs` | 入口派发判定由 `import.meta.url === pathToFileURL(path.resolve(argv[1]))` 改为两侧都 `fs.realpath` 比较 |
| `scripts/testing/browser-focus-guard-entry-selfcheck.mjs` | 新增：10 项 CLI 入口身份回归 |

逐字节确认 `resume.md` / `README.md` / `cases.md` / `result.schema.json` 与 `cf541253` 完全相同，因此**上一轮记录仍然有效**，本轮是同一契约在新工具版本下的复核。复核实测：

```
$ node scripts/testing/browser-focus-guard-entry-selfcheck.mjs
{"ok":true,"node":"v22.23.3","checks":["direct CLI","file symlink CLI","ancestor-directory symlink CLI",
 "preserved symlink main","ordinary direct/alias invocation rejects unmet prerequisites",
 "direct import without CLI execution","aliased import without CLI execution","eval import without entry argument",
 "stdin import with dash entry argument","unresolvable entry fails nonzero"],"macosRun":false,"browserRun":false}

$ node scripts/testing/browser-focus-guard.mjs --self-check
{"ok":true,"scope":"pure guard contract checks only","macosRun":false,"browserRun":false}
```

以及 A/B 别名探针（同一个 `/tmp` 祖先目录符号链接，分别调用旧版与新版守卫）：

| 版本 | 经 `/tmp` 别名 `--self-check` | 判定 |
|---|---|---|
| 旧版 `cf541253` | 无输出，`exit 0` | **缺陷复现**（静默空转） |
| 新版 `c796cd88` | `{"ok":true,"scope":"pure guard contract checks only",…}`，`exit 0` | **修复确认** |

最后回到真实流程：把新版守卫**经 `/tmp` 别名路径**对着本轮活的临时实例跑一次 `--once`。它不再静默退出，而是真的执行、写入 `guard-violation` 判定并返回 `exit 1`——证明修复覆盖的是 `runGuard` 主路径，而不只是 `--self-check`。

> 注意：**DEFECT-06 未被这个提交触及**。`checkFocusSnapshot` 的 offscreen 断言一字未改，因此本机仍然是 22/22 blocked。

## 三、阻断项（按严重度）

### DEFECT-06 ⛔ 焦点守卫的 offscreen 断言在单屏 macOS 上不可满足（**本轮主要阻断源，阻断全部 22 个用例**）

见第二节第 3 小节。证据：`artifacts/focus/focus-preflight.json`（单次观察 → `guard-violation`）、`artifacts/focus/window-placement-probe.json`（CDP + AX 双路径摆放矩阵，`fullyOffscreenReachable: false`）。

### DEFECT-07 ✅ 已在上游修复（`c796cd88`），并在本轮实机复核

**原问题（cf541253）**：`browser-focus-guard.mjs` 用

```js
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {if(process.argv.includes('--self-check'))await selfCheck();else await runGuard(process.argv.slice(2));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
```

判定是否作为主程序运行，**没有 `else` 分支**。macOS 上 `/tmp` 是指向 `/private/tmp` 的符号链接：Node 已把 `import.meta.url` 解析为 `/private/tmp/...`，而 `path.resolve(process.argv[1])` 保留命令行里的 `/tmp/...` 写法，两者不相等，于是 `runGuard` / `selfCheck` 全部被跳过——**静默空转并以 0 退出**。对一个安全门禁而言，包装脚本会误以为守卫已经运行。

**修复内容（`c796cd88`）**：

```js
try {
  if(process.argv[1]&&process.argv[1]!=='-'&&await fs.realpath(process.argv[1])===await fs.realpath(fileURLToPath(import.meta.url))) {
    if(process.argv.includes('--self-check'))await selfCheck();else await runGuard(process.argv.slice(2));
  }
} catch(error){console.error(error.message);process.exitCode=1;}
```

两侧都改用 `fs.realpath`，并新增 `scripts/testing/browser-focus-guard-entry-selfcheck.mjs` 作为入口身份回归。

**本轮复核（三条独立证据）**：

1. **上游新增回归**：`node scripts/testing/browser-focus-guard-entry-selfcheck.mjs` → `{"ok":true,…,"checks":["direct CLI","file symlink CLI","ancestor-directory symlink CLI","preserved symlink main","ordinary direct/alias invocation rejects unmet prerequisites","direct import without CLI execution","aliased import without CLI execution","eval import without entry argument","stdin import with dash entry argument","unresolvable entry fails nonzero"],…}`，exit 0（`artifacts/rules/guard-entry-selfcheck.txt`）。
2. **A/B 别名探针**（`harness/guard-entry-alias-probe.mjs`，把旧版与新版的守卫文件分别放到同一个 `/tmp` 祖先目录符号链接下调用）：

   | 版本 | 经 `/tmp` 别名调用 `--self-check` | 结论 |
   |---|---|---|
   | 旧版 `cf541253` | `stdout` 为空、`exit 0`（`silentNoOp: true`） | 缺陷复现 |
   | 新版 `c796cd88` | `{"ok":true,"scope":"pure guard contract checks only",…}`、`exit 0` | 修复确认 |

   原始记录：`artifacts/rules/guard-entry-alias-probe.json`。
3. **真实守卫流程（不只是 self-check）**：本轮把守卫经 `/tmp` 别名路径对着**活的临时实例**跑了一次真实 `--once` 探测。修复前该调用会静默退出 0；现在它真的执行了 `runGuard`，写入 `artifacts/focus/focus-preflight.json` 并返回 **exit 1**，判定为 `guard-violation`。

> 这一项从提出到修复都是本轮验收的产物：上一轮报告第七节第 8 条给出的建议，`c796cd88` 已按其方向实现。

### DEFECT-02 ⛔ 可信 focus-safe helper 不存在（阻断 5 个用例）

`--focus-safe-helper` 指向的 `focus-safe-browser.cjs` **在仓库与本机 `$HOME` 中都不存在**：

```
find . -name "focus-safe-browser*" -not -path "./.git/*"   → 无结果
find ~ -maxdepth 6 -name "focus-safe*"                     → 无结果
ls ~/.codex/skills/  → 仅 hatch-pet, .system
ls ~/.claude/skills/ → 仅 browseros-neo, course-review, paseo, paseo-help
```

三个脚本都必须导出 `launchFocusSafePersistentContext` / `newPageWithoutForeground` / `activateExtensionTabWithoutForeground`（`scripts/run-privacy-boundary-test.cjs:82-95` 显式校验）。`run-popup-actions-service-ui-test.cjs:19` 还硬编码了**别人机器**的路径 `/Users/thinkstu/.codex/skills/…`，属顶层 `require`，加载即 `MODULE_NOT_FOUND`。

交接自身规定「缺少任何条件就写成 blocked…不要伪造 helper」。**因此 UI-01、PRIVATE-01、PRIVATE-02、YT-01、OCR-UI-01 全部 blocked。**

### DEFECT-03 ⛔ Playwright 不是本仓库依赖（阻断同 5 个用例）

`playwright` 不在 `package.json`，在 `pnpm-lock.yaml` 中出现 0 次，`--playwright-root` 无法由本 checkout 满足。

### DEFECT-04 ⚠️ Chromium 151 已忽略 `--load-extension`

仓库浏览器专项仍传 `--load-extension`；首轮实测该参数下目标列表**无任何 `chrome-extension://`**，改用 CDP `Extensions.loadUnpacked`（配 `--enable-unsafe-extension-debugging`）才成功。

### DEFECT-05 ✅ 已在 stdio 路径上解除（本轮）

原问题：MCP 控制面绑死单一份额 `~/Library/Application Support/BrowserClaw/.browseros/config.json`，第二个 `--user-data-dir` 实例只暴露 CDP。**本轮以 `--config` + `--stdio` + 独立 `BROWSERCLAW_DIR` 复验成功**（见第二节第 4 小节）。仍未验证的是 HTTP 路径；`resume.md` 明确要求不要修改持久 MCP/client 配置，故未触碰。

### DEFECT-01 ✅ 已在上游修复（`a8728f79`）

原问题：`validateFileManifest` 的 `generated-locales` 分支硬编码要求六种语言（含 `zh-CN`），而冻结源码永远无法产出 `zh-CN`（`src/core/i18n/types.ts:28`：`export type RegisteredUiLanguage = Exclude<UiLanguage, 'zh-CN'>;`）。

修复内容：改为只要求生成器真正产出的 `es-ES / fr-FR / ja-JP / ko-KR / ru-RU`，并新增 `collectInlineChineseSources()` 校验中文内联证据。

本轮回合复核（`cf541253` 校验器 + 本目录清单）：**ACCEPTED**。清单 `manifestSha256` 仍为 `abc11522ec049930f8721119422d1808c13549061438fb08b6841fef26f48866`（文件集未变，480 个），新增：

| 文件 | SHA-256（实测 = 期望） |
|---|---|
| `src/core/i18n/messages/zh-CN.ts` | `7ae35602395e4432c6678b5d319d6caa55ade65737dcdaf0dbb8b3c08b78edcc` |
| `src/core/i18n/index.ts` | `264fc1cb3c28766731e8ceb7700988bd83674e2cd332f126d77e64dc725e718c` |

清单文件自身 SHA-256：`699947f48468e100366cd82089289984d0ba44b74f11b2252f6a57f417629ccb`。

---

## 四、真实模型：本轮仍未下载（原因已变）

`resume.md` 与更新后的 README **已授权**本轮执行 `model-catalog.json` 的固定模型下载（≈5.03 GiB / 46 个 `repo@revision:path`）。本轮仍**未下载**，原因不是「操作者未授权」，而是：

1. 焦点守卫未成立 → 交接禁止启动任何浏览器操作 → 下载后**没有任何可执行的推理路径**；
2. 在无可运行路径时落盘 ≈5 GiB 属于无人要求的本地状态，与「不遗留计划外修改」相冲突。

`models[]` 因此保持为空，而不是填入未经验证的元数据。每个真实模型用例在 `result.json` 里都写成了**「未执行，下一步为……」**的具体动作，而不是声称环境不支持。

补充结构性发现（沿用首轮）：**仓库不存在可预热模型缓存的脚本**，权重唯一取用路径是产品自身（`src/platform/storage/modelArtifacts.ts` → Cache Storage `fluent-read-local-models-v2`，4 MiB 分块 + receipt；Kokoro 走 `transformers-cache`，Paddle/LaMa 走 `fluent-read-manga-ocr-v1`）。离线用例的精确阻断清单：`TTS-04` 只需阻断 `huggingface.co`；`MT-04` 必须**同时**阻断 `huggingface.co` 与 `hf-mirror.com`（`modelArtifacts.ts:181-194` 首个 origin 失败后改走镜像，且 `navigator.language` 以 `zh` 开头时镜像优先）；漫画离线另需 `hf-mirror.net`。

---

## 五、交接材料与产品源码的对应关系

| 项 | 值 |
|---|---|
| 交接材料版本 | `c796cd88f2a2804c9e05da98be949ae4fa6298fd` |
| `c796cd88` 新增/改动（仅验收侧） | `scripts/testing/browser-focus-guard.mjs`（入口派发改 `fs.realpath`）、`scripts/testing/browser-focus-guard-entry-selfcheck.mjs`（新）。**验收文档与用例契约未变**：`resume.md` / `README.md` / `cases.md` / `result.schema.json` 逐字节相同。 |
| `cf541253` 引入（沿用） | `docs/browser-acceptance/resume.md`、`scripts/testing/browser-focus-guard.mjs`（新）、`scripts/testing/browser-acceptance-gpu.mjs`（新）、`docs/browser-acceptance/fixtures/gpu-empty-description.json`（新）、`result.schema.json`（新增 `browserPid` / `profilePathSha256` / `focusGuardEvidence` / `adapterInfo` / `adapterLabel` / `rawAdapterObservation`，`adapterDescription` 允许空串，artifact role 增加 `focus-guard`）、`browser-acceptance-evidence.mjs`、`browser-acceptance-selfcheck.mjs`、`browser-acceptance.mjs`、`README.md`、`cases.md`、`result.template.json` |
| 产品 source commit | `c68a53af300b33109375665197951331e45ae18a` |
| 产品 tree（实测） | `50e12ecc7f4c72448f03e714a585814eb9476622` |
| 锁文件 SHA-256 | `5b251fb80b9a89991ef226fe19e24e249c48963c520945c9a0ef5851ebddb619` |
| 扩展构建清单 | 401 文件，`manifestSha256 = e70a1b9d…`（**未重建**） |
| 浏览器主可执行文件 SHA-256 | `b65e8c83ff0568b4f082a8c91c4f8cf13807c415519b32f78ca14cd7080445d5`（本轮重算未变） |
| Node / pnpm | `v22.23.3` / `9.12.1` |

产品源码未变 → **未重建扩展**；`resume.md` 明确说明「更新本交接、元数据绑定或重跑 fixture 不要求重建扩展」。

---

## 六、交付物

| 文件 | 说明 |
|---|---|
| `result.json` | 本轮结果记录：22 用例全 `blocked`，23 个已登记 artifact；`validate` 通过 |
| `result.snapshot-previous.json` | 规范化后的上一轮快照（原快照保持不变） |
| `counterfactual-pass.json` | 对照件：仅将 ENV-01 改为 `pass`；现在失败于 `Pass requires a completed continuous focus guard bound to the actual browser/profile` |
| `artifacts/focus/focus-preflight.json` | 单次焦点观察 = `guard-violation`；本轮**经 `/tmp` 别名路径**由修复后的守卫真实产出（exit 1） |
| `artifacts/rules/guard-entry-selfcheck.txt` | 上游新增入口回归的原始输出 |
| `artifacts/rules/guard-entry-alias-probe.json` | 旧版 vs 新版守卫经 `/tmp` 别名调用的 A/B 记录，`defect07Resolved: true` |
| `artifacts/rules/session-log.txt` | 本轮三条探针（守卫 / 窗口摆放 / stdio 控制面）的完整运行日志 |
| `artifacts/focus/window-placement-probe.json` | CDP + AX 双路径窗口摆放矩阵，`fullyOffscreenReachable: false` |
| `artifacts/focus/launch-record.txt` | 临时实例的实际启动参数与启动时刻 |
| `artifacts/neo/capabilities-neo-stdio.json` | stdio 控制面的结构化能力记录（22 工具） |
| `artifacts/neo/neo-stdio-capabilities.json` | 原始 stdio 握手输出 |
| `tools-evidence/neo-paths.txt`, `tools-evidence/neo-server-cli.txt` | server 路径与 SHA-256、`--version` / `--help` 原始输出 |
| `neo-sidecar.json` | 一次性 sidecar 配置（`ports.cdp=9345` + 本次 resources） |
| `artifacts/build/*`, `artifacts/source.json`, `artifacts/env01/*` | 沿用首轮、已重新绑定哈希的构建/语言/源码/GPU/截图证据 |
| `window-placement-probe.mjs`, `neo-stdio-probe.mjs`, `guard-entry-alias-probe.mjs`, `counterfactual.mjs` | 本轮实际使用的本地探针与反证脚本 |
| `defect-report.md` | 本文件 |

**脱敏**：本目录内所有含本机用户名的绝对路径已替换为 `<HOME>` / `<WORKSPACE>`；`/Users/thinkstu/…` 是仓库源码里既有的硬编码值，作为缺陷证据保留。未包含任何密钥、Cookie、token、账号数据或模型权重。

**清理**：临时 profile `/private/tmp/fluentread-resume-856178bb` 与临时浏览器实例在本轮结束后销毁；日常 BrowserOS neo 实例（PID `79648`）全程未被触碰。

---

## 七、给上游的修正建议

1. **必修（本轮新增）**：`browser-focus-guard.mjs` 的 offscreen 断言应改为可达的判定。当前实现要求窗口与**所有**活动屏幕都不相交，这在单屏 macOS 上物理不可达（WindowServer 必然夹取），等于让 `pass` 永远无法产生。建议二选一：允许窗口位于「非前台显示器的正常尺寸窗口」并改用前台 PID + 非遮挡判定，或显式接受「被夹取的最小可见边缘」并提供对应的证据语义。
2. **必修**：`--focus-safe-helper` 指向的 `focus-safe-browser.cjs` 应在交接中一并提供，或明确声明该前置条件由使用者自备并据此全部 blocked（当前措辞已如此，但没有任何地方给出该文件）。
3. ~~**必修**：MCP 控制面无法指向专用临时 profile。~~ ✅ 本轮已用 `--config` + `--stdio` + 独立 `BROWSERCLAW_DIR` 复验成功；建议把这条路径写进 README 的浏览器专项说明。
4. **建议**：`self-check` 需要 `node_modules`（语言回归调用真实生成器，生成器 `require.resolve('vite')`）。README 的「结果格式与交付」一节宜注明：`self-check` 需在**已安装锁定依赖**的 worktree 中运行。
5. **建议**：`run-popup-actions-service-ui-test.cjs:19` 的 `/Users/thinkstu/...` 硬编码默认值应改为必填参数。
6. **建议**：浏览器专项需适配 Chromium ≥137 移除 `--load-extension` 的现实，改用 `Extensions.loadUnpacked`（并加 `--enable-unsafe-extension-debugging`）。
7. **建议**：`resume.md` 第 3 节可补充说明：`extension-offscreen` 标签来自 `Target.createTarget` 打开扩展入口页，若要在产品路径上证明 `chrome.offscreen` 文档生命周期，需要另取真实上下文证据（本轮因守卫未成立未能补做）。
8. ~~**建议**：`browser-focus-guard.mjs` 的主程序判定应改用 `fs.realpath` 比较，或在未命中主程序分支时显式报错退出。~~ ✅ **已在 `c796cd88` 修复并实机复核**（见第三节 DEFECT-07）。
