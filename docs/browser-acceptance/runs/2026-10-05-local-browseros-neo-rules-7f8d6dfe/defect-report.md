# 缺陷清单与上游修复建议（本轮：上游 `7f8d6dfe`，策略 `temporary-partial-visibility-20261005`）

本文件只记录**本轮实测确认**的事实、每一项的当前状态与建议的上游修复。所有结论都能在 `artifacts/`、`defects/` 与 `tools-evidence/` 中对应的原始文件里核对。

## 本轮状态汇总

| 编号 | 主题 | 本轮状态 | 影响的用例 |
| --- | --- | --- | --- |
| DEFECT-01 | 语言清单契约与冻结源码不一致 | 上游 `a8728f79` 已修，本轮仍然有效 | 无 |
| DEFECT-02 | 缺少受信任的 focus-safe helper | **仍阻断**（未修复） | UI-01、PRIVATE-01、PRIVATE-02、YT-01、OCR-UI-01 |
| DEFECT-03 | 仓库内没有 Playwright | **仍阻断**（未修复） | 同上 5 个 |
| DEFECT-04 | Chromium 151 忽略 `--load-extension` | **仍存在**（已用 CDP 绕过） | 不影响判定，影响复现方式 |
| DEFECT-05 | 控制面被锁死在日常 profile | 在 stdio 路径上已解除 | 无 |
| DEFECT-06 | 单屏 macOS 无法把正常窗口完全移出屏幕 | **本轮被用户批准的部分可见例外绕过，未修复** | 原为全部 22 个 |
| DEFECT-07 | 通过 `/tmp` 别名调用 guard 时静默 no-op | 上游 `c796cd88` 已修 | 无 |
| DEFECT-08 | `Target.createTarget` 抢前台，随后浏览器 SIGSEGV | **本轮新发现**（已归档证据，未再触发） | 不影响判定 |
| DEFECT-09 | 扩展同源 Blob Worker 的 WebGPU 探测超时 | **本轮仍未通过** | 影响 ENV-01 的 worker 上下文那条观测 |

---

## DEFECT-06 · 焦点门禁在单屏 macOS 上不可达（本轮以获批例外绕过）

**事实。** `checkFocusSnapshot` 在默认的 `fully-offscreen` 策略下要求自有窗口与**所有**活动显示都不相交。本机只有一个活动显示（27GX-Ultra，UI 2560×1440，笔记本盖合上），macOS 的 WindowServer 会把普通窗口夹在屏幕内：本轮实测窗口 `left` 被夹在 **≤2520**（仍有 40 px 可见）、`top` 夹在 **≥30**、底边 **≤1394**，与上一轮用 CDP 和 Accessibility API 两种方式测得的结论一致。因此默认策略下 continuous guard 永远到不了 `running`，而 `resume.md` 规定守卫未 running 时不得启动任何浏览器操作。

**本轮的处置。** 用户在 2026-10-05 明确批准了一个有限例外：专用临时窗口可以部分可见，但仍不得成为前台、不得使用日常 profile。本轮据此用 `--allow-partial-visibility` 选择策略 `temporary-partial-visibility-20261005`，窗口由启动参数放在 `left=2400, top=120, 1200x900`（可见 144000 / 1080000 px²），guard 首次完整跑完：`status=stopped`、`mode=continuous`、51 次观测、0 次违规、前台 PID 全程为 19141。

**建议的上游修复（仍然成立）。** 把断言改为表达它真正想保证的性质，而不是一次几何特例：

1. 「正常尺寸窗口 + 从未成为前台 + 前台 PID 前后不变」，把可见性交给策略参数决定；或
2. 为 WindowServer 夹取出的最小可见边缘定义明确的证据语义（例如允许 ≤1% 面积或 ≤1 px 边缘可见），并在报告中如实记录实测面积。

无论采用哪种，都不要引入「40 px 上限」这类把旧机器现象写死的常量：本轮实测可见 160 px 宽，说明该数值依赖窗口尺寸与夹取位置。

## DEFECT-08 · `Target.createTarget` 抢前台并伴随浏览器崩溃（本轮新发现）

**事实。** 在新建的浏览器上下文里调用 `Target.createTarget` 时：

- guard 两次独立记录到 `guard-violation: Owned browser became foreground; stop test operations`（证据：`defects/focus-guard-violation-incognito-createTarget.json`，以及上一轮同路径的记录）；
- 第二次复现时，BrowserOS neo 浏览器进程在约 1 秒后以 `EXC_BAD_ACCESS (SIGSEGV)` 崩在主线程，incident `5FB01192-4184-4923-9D85-60269D13FED8`，崩溃报告摘要见 `defects/browser-crash-21853.json`。

**处置。** 本轮把该探测移到所有取证之后，并在两次复现后**停止重复触发**；最终记录里没有任何无痕探测的「成功」声明。上一轮曾有 `incognitoReachable: true` 的成功观测，说明该行为与具体调用时序/上下文状态有关，不能一概而论。

**建议。** 上游若要在验收里继续使用无痕上下文，需要一条不新建窗口的路径（例如复用已有 context、或在报告中把「抢前台」作为已知副作用显式记录并允许跳过），并且不应把它放在需要 focus 契约的用例路径上。当前建议：**在焦点契约下不要调用 `Target.createTarget`**。

## DEFECT-09 · 扩展同源 Blob Worker 的 WebGPU 探测超时

**事实。** 从扩展 offscreen 文档派生同源 Blob Worker 并请求 WebGPU adapter，本轮与上一轮均在 12 秒后超时；原始失败事件保留在 `artifacts/env01/gpu-log.json`（`context=extension-worker`、`error="Error: worker timeout"`）与 `artifacts/env01/worker-context.json`。

**影响。** ENV-01 中「四个执行上下文」的观测实际只有三个拿到 adapter（`normal-page`、`extension-offscreen`、`extension-options-page`）。记录如实标注，未把超时当作成功。

**建议。** 若该上下文对打包模型 worker 是必需的，需要给出可复现的 worker 启动方式（例如改用 MV3 的 module worker、或在 offscreen 文档里通过 `importScripts`/`new Worker(chrome.runtime.getURL(...))` 指向打包文件），并把超时时间与失败语义写进契约。

## DEFECT-02 / DEFECT-03 · 缺失的 helper 与 Playwright（仍然阻断 5 个用例）

**事实。**

- `scripts/testing/focus-safe-browser.cjs` 在仓库中不存在，`$HOME` 下也找不到；`--focus-safe-helper` 要求它导出 `launchFocusSafePersistentContext` / `newPageWithoutForegrounding`。多个 runner 还硬编码了 `/Users/thinkstu/...` 路径（例如 `scripts/run-request-limits-ui-test.cjs:22`）。
- `package.json` 与 `pnpm-lock.yaml` 中都没有 Playwright，`--playwright-root` 无法从本检出满足。

**处置。** 按交接要求**没有**伪造 helper，也没有引入 Playwright。UI-01 / OCR-UI-01 只做到「在自有实例中真实打开并截图」，其余断言按缺依赖如实记为 blocked。

**建议。** 要么把 helper 与 Playwright 依赖正式纳入仓库（附带它自己的 focus 契约自检），要么把依赖它的 runner 标注为「需要外部 helper，不在本轮范围」，避免验收结果被同一原因反复阻断。

## DEFECT-04 · Chromium 151 忽略 `--load-extension`

**事实。** 仓库的浏览器 specials 仍传 `--load-extension`，但本版本 Chromium 忽略它。本轮与上一轮都只能通过 CDP `Extensions.loadUnpacked` 载入已构建的 `chrome-mv3` 目录（还需要 `--enable-unsafe-extension-debugging`）。

**建议。** 在启动脚本中改用 CDP 载入路径，或显式声明最低 Chromium 版本要求。

---

## 不受影响、但值得记录的既有结论

- **DEFECT-01** 在 `a8728f79` 已修：校验器只要求 userscript 生成器真正写出的五种语言，并校验 `inlineChineseSources`。本轮 `browser-acceptance.mjs self-check` 通过，未有用例因语言清单被拒。
- **DEFECT-05** 在 stdio 路径上已解除：`browseros-claw-server 0.0.66` 接受 `--config` 与 `--stdio`，能读 run-local 的 `ports.cdp` 与 `directories.resources`。本轮全部 MCP 调用都指向自有实例（CDP 端口见 `tools-evidence/` 与 `artifacts/focus/focus-guard.json`），没有连日常 profile。
- **DEFECT-07** 在 `c796cd88` 已修：入口分派改为 `realpath(process.argv[1])` 与自身模块 URL 比较。本轮 `browser-focus-guard-entry-selfcheck.mjs` 的 10 条检查全部通过，且真实 continuous 运行正常。

## 本轮未做的事（诚实边界）

- 没有下载任何模型资产（约 5 GiB）；十个 real-model / fault-injection 用例的阻断原因已从「焦点门禁」改写为「未获取固定 revision 的模型资产 / 缺少 runner」。
- 没有重建扩展、没有改产品源码、没有改上游 `review/browser-acceptance-20261005` 分支、没有修改全局或日常配置。
- 没有把「部分可见」例外推广到其它机器或其它显示配置。
