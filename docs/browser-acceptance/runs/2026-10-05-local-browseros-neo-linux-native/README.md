# 本地 BrowserOS Neo 验收 · Linux 原生 UI 轮（2026-10-05）

本目录是依据 [`docs/browser-acceptance/resume.md`](../../resume.md)、[`README.md`](../../README.md) 与 [`cases.md`](../../cases.md)，在**本机（Linux）重新采集证据**得到的**新一轮结果记录**。上一轮的 blocked 快照保存在其它分支的 `runs/2026-10-05-local-browseros-neo/`、`…-resume/`、`…-rules-c796cd88/`、`…-rules-7f8d6dfe/`，本目录**不覆盖**它们，也不改判其中任何结论。

- 分支：`acceptance/local-browseros-neo-linux-native-20261005`（基线 `5a07ef49`）
- 规则版本：工具检出 `7f8d6dfe`（`scripts/testing` 与固定修订一致，diff 为空）
- 运行目录：`fluentread-browseros-neo-local-2026-10-05-05-linux-native`

## 结论

- **总体 `blocked`：22/22 用例 blocked，本轮 0 个 pass。**
- 校验输出（原样）：

  ```
  $ node scripts/testing/browser-acceptance.mjs validate docs/browser-acceptance/runs/2026-10-05-local-browseros-neo-linux-native/result.json
  {"valid":true,"overall":"blocked","cases":22}
  ```

- 阻断原因是**平台级**的、可复核的：上游焦点守卫在本机**根本无法产生 guard 报告**，而验收契约要求任何 pass 必须落在完整连续的 guard 区间内（首个 running 观测之后才操作、最后一次操作之后再观测、随后 `stopped`、无 `guard-violation`）。因此本轮的诚实结论是 22 项全部 blocked，而不是「部分通过」。

## 1. 本轮首要阻断：上游守卫是 macOS 专用观察器

文件 `scripts/testing/browser-focus-guard.mjs`，第 **93** 行，`runGuard()` 的**第一条语句**：

```js
assert.equal(process.platform,'darwin','This observer requires macOS; it has not been browser-certified here');
```

它在读取任何参数（`--profile`/`--pid`/`--port`/`--output`/`--allow-partial-visibility`）**之前**就抛出，因此：

- 退出码 1，**不写任何 guard 报告文件**；
- 同一文件还硬编码 `/usr/bin/osascript`（JXA `NSWorkspace` 取前台 PID 与显示器几何，第 75/137/145 行）与 `/usr/sbin/lsof`（监听者校验），本机两者都不存在；
- 入口自检 `browser-focus-guard-entry-selfcheck.mjs` 自身就预期非 darwin 平台报 `/requires macOS/`，说明这是**上游有意**的 macOS 限定。

**原始拒绝记录（本轮真实采集，未做任何修饰）**

| 文件 | 内容 |
| --- | --- |
| `artifacts/focus/guard-attempt-once.txt` | `--once --allow-partial-visibility` 实测：`exit_code: 1`，stderr `This observer requires macOS; it has not been browser-certified here` / `'linux' !== 'darwin'` |
| `artifacts/focus/guard-attempt-continuous.txt` | 连续模式（`timeout 4s` 包裹）实测：同样 `exit_code: 1`、同样 stderr |
| `artifacts/focus/guard-report-status.txt` | `present_after_once: no`、`present_after_continuous: no`、`created_during_attempt: no` |
| `artifacts/focus/guard-block.json` | 结构化记录（`blockingLineNumber: 93`、`reportFileCreated: false`、三个探针结果） |
| `artifacts/focus/guard-block-transcripts.txt` | 三次独立运行的原始 transcript |

**注意：本轮不存在「guard 违规原始 JSON」，因为守卫从未产生过任何报告。** 记录里给出的拒绝文本与退出码就是原始证据本身；本目录**没有**伪造的 `guard-report.json`，`environment.focusGuardEvidence` 也**故意留空**。

**除平台门禁外，守卫的其它前置条件在本机全部可满足**（`artifacts/focus/guard-preconditions.txt`）：

- 专用临时 profile `/tmp/fluentread-linux-native-JcsG10`，`mode=700`、`uid=1000`、位于 `/tmp` 下、目录名以 `fluentread-` 开头；
- 进程命令行含**不带引号的绝对路径** `--user-data-dir=/tmp/fluentread-linux-native-JcsG10`，以及 `--remote-debugging-port=9420`；
- `lsof -nP -iTCP:9420 -sTCP:LISTEN -FpFn` 输出 `p1690606` + `n127.0.0.1:9420`：监听者正是该浏览器 PID，且仅回环。

也就是说：**本机唯一缺的条件就是「平台是 macOS」**。这不是搭台方式的问题。

## 2. 启动方式、焦点策略与窗口摆放

| 项目 | 实测值 |
| --- | --- |
| 启动方式 | `setsid nohup /usr/lib/browseros/browseros …` 后台启动，不激活、不抬升、不置顶（`artifacts/build/commands.json`） |
| 启动参数 | 仅批准的 7 项：`--user-data-dir`、`--remote-debugging-port=9420`、`--remote-allow-origins=http://127.0.0.1:9420`、`--window-position=2400,120`、`--window-size=1200,900`、`--no-first-run`、`--no-default-browser-check` |
| 额外参数 | **无**。上一台需要 `--enable-unsafe-extension-debugging`，本机不需要：`Extensions.loadUnpacked` 仅用批准参数即成功 |
| 焦点策略 | 全程未激活、未移动、未缩放、未最小化、未全屏、未抬升；从未调用 `Page.bringToFront()`；未创建任何无痕/非默认上下文 target |
| 浏览器 PID | `1690606`（启动前后命令行一致，teardown 记录在案） |
| profile 路径 SHA-256 | `5c6a1969d6881d7e6eb65ddc8d1109cf53c1f00aa1e1a9a4776af65e2e79fb91` |
| 窗口摆放（请求值） | `left=2400, top=120, 1200x900`（按本机 2560×1440 显示器点宽算出的部分可见位置） |
| 窗口摆放（实际值） | 浏览器自己的 CDP 回读（`Browser.getWindowBounds`）报告 **`left=0, top=0, 1200x900, windowState=normal`** —— 请求值**未被采纳**（`artifacts/focus/window-bounds.json`） |
| 前台 PID | **不可得**。本机没有任何可用的前台探针；按规则**不自行造替代探针**，因此不给出前台 PID，也不给出 guard 派生的可见性结论 |

**可见性派生值：不可得。** `visibleArea`/`windowArea`/`classification` 只能由守卫的 `checkFocusSnapshot` 从真实 `windows`/`displays` 派生，而本机没有守卫观测。本记录只登记**宿主几何事实**（`xrandr`：单一 `HDMI-1 2560x1440+0+0`）与**浏览器回读的窗口矩形**。

关于窗口矩形的权威性，必须说明清楚：`left=0,top=0` 是**浏览器自己报告**的边界，**不是独立的合成器/系统测量**。本机在 Wayland 下没有任何 OS 级窗口几何探针，而验收契约自带的几何探针只存在于 macOS 专用守卫里，所以 CDP 回读是本轮唯一可得的摆放观测，其权威性仅限于「浏览器如此报告」。按已批准策略，**若**该报告准确，`left=0,top=0` 落在 2560×1440 屏内就属于完全可见——但本记录**不把该分类当作 guard 派生事实**，只把它当作「请求未被采纳」的证据。即使守卫能在 Linux 运行，本轮摆放**也**不满足部分可见要求（见 DEFECT-11）。绝不把宿主几何算术冒充成 guard 派生值。

## 3. 逐用例结论与证据目录

22 项全部 `blocked`，`result.json` 中每项都写明「轮次级阻断 + 该用例自己的下一步」。三项有本轮真实旁证：

| 用例 | 结论 | 本轮旁证 |
| --- | --- | --- |
| ENV-01 | blocked | 浏览器身份、扩展自身 service worker 读出的身份、专用临时 profile、三上下文 WebGPU、构建/语言清单、清理证明 |
| UI-01 | blocked（部分旁证） | 真实 options 页 DOM：16 个 `data-section` 路由、导航分组、`配置服务`/9×`配置连接`/`搜索所有设置`、供应商下拉真实选项列表、暗色与 390px 截图 |
| OCR-UI-01 | blocked（部分旁证） | `#settings-image-translation` 路由、引擎下拉中出现的 `通用文字 · Tesseract` 与 `漫画文字 · PaddleOCR`、`漫画连续翻译` 开关、暗色与 390px 截图。**注意**：捕获到的下拉快照是该文档中**所有已展开** Element Plus 下拉的并集（94 项，绝大部分是逐功能服务列表），因此它**不**证明引擎选择器只提供这两项 |
| 其余 19 项 | blocked | 无执行；原因见 `result.json`，模型资产未下载、Playwright 与 focus-safe helper 不存在 |

证据目录：`artifacts/focus/`（守卫与摆放）、`artifacts/env01/`（浏览器/扩展/GPU/DOM/截图）、`artifacts/build/`（构建与语言清单、命令清单）、`artifacts/host/`（宿主与 GPU 事实）、`artifacts/tools/`（自检）、`artifacts/neo/`（控制面探测）、`artifacts/hygiene/`（清理证明）、`artifacts/source.json`（来源结构化证据）。

## 4. 缺陷清单

- **DEFECT-10（本轮新增，首要）**：`browser-focus-guard.mjs` 是 macOS 专用观察器，第 93 行硬断言 `process.platform==='darwin'`，并硬编码 `/usr/bin/osascript` 与 `/usr/sbin/lsof`。本机无法运行 ⇒ 22 项全部无法 pass。
- **DEFECT-11（本轮新增）**：已批准的部分可见摆放**在本机不可达**。请求 `left=2400,top=120`，实际被合成器放在 `left=0,top=0`。Chromium 在 Wayland 下无法设置绝对窗口坐标，因此未来 Linux 轮次需要「合成器感知」的摆放步骤，否则任何可见性断言都不成立。
- **DEFECT-12（本轮新增）**：交接文档点名的 `browseros-claw-server` 在本机**不存在**。等价物是打包的 `browseros_server`（0.0.157，`/usr/lib/browseros/BrowserOSServer/default/resources/bin/browseros_server`；另有用户级 0.0.162）。其 `--help` 只列 `--version`/`--config`/`--help`，但**二进制内含 `--stdio` 字面量**（两个副本都是 2 处），说明 stdio 传输可能存在但未文档化。本轮**未**spawn 它，因此「task-scoped stdio 控制面能力核对」是**未执行**而非失败。另：浏览器会自动拉起该 helper（`--config=<临时 profile>/.browseros/config.json`），它随浏览器退出，最终无残留。
- **DEFECT-13（本轮新增）**：schema 把 `testedLocalHead` 固定为 `7212af1f9da08324963e38973c7f477aabfffb0b`，但该提交在本 clone 与 `origin` **都不存在**（origin 只有 `main`、四个 acceptance 分支与 review 分支）。该字段仅因 schema 常量而填写，本机无法佐证。
- **来源限制（非产品缺陷）**：本机 product worktree 相对 `c68a53af` **不完整**：3172 条在范围内路径中缺 41 条（含 `tsconfig.json`、`wxt.config.ts`、`vitest.config.ts` 与整个 `userscript/`）。扩展产物可被 fingerprint，但其源码树在本机无法完整核对。**本轮未重建扩展**（重建不在范围内）。
- **能力限制（非产品缺陷）**：本机 WebGPU 适配器在页面、options 页、扩展同源 Blob Worker 三个上下文中**都没有 `shader-f16`**，因此 MT-01 的 FP16/Index 档位即使有守卫也过不了准入。这是**如实记录的能力拒绝**，未改写。
- **本地工具限制**：本轮 agent harness 的 auto-mode 分类器多次拒绝工具调用；受影响步骤重试后均完成，**唯一**因此未执行的是控制面 stdio spawn。本记录不依赖任何被拒绝的调用。
- **沿用上一轮、本轮同样成立**：`scripts/testing/focus-safe-browser.cjs` 缺失（且多处硬编码某个历史开发者的 macOS 家目录绝对路径，已按脱敏规则不在此复写）；`package.json`/`pnpm-lock.json` 内无 Playwright；`--load-extension` 在 Chromium 151 上不可靠（本轮改用 CDP `Extensions.loadUnpacked`，成功）。
- **工具自检限制**：`browser-acceptance.mjs self-check` 在本机 **exit 1**，因为其语言回归步骤调用 `scripts/generate-userscript-language-data.mjs`，而该脚本 `require('vite')` 失败（本机无 pnpm、未安装锁定依赖）。其余三项自检全部通过：guard `--self-check` exit 0、可见性自检 `negativeChecks: 26`、入口自检 10 项。

## 5. 旁证清单：它们**不**证明什么

本轮真实采集的旁证。**大部分**带内联 `sideEvidenceOnly: true` 与「本机无连续 guard 区间，故不支持任何 pass」的显式标注；六个逐字节原样保留的捕获件不带内联字段，它们的标注状态列在 `artifacts/env01/side-evidence-manifest.json`：

- **扩展身份**：从扩展**自己的 service worker** 读出 `FluentRead-流畅阅读` `0.0.35`，id `djnlaiohfaaifbibleebjggkghlmcpcj`。id 与上一轮相同是因为构建 manifest 带 `key` 字段固定了 id；这是**本轮现采**，不是照抄。
- **WebGPU 原始观测**：三上下文 `vendor=nvidia`、`architecture=blackwell`、`device=""`、`description=""`、`isFallbackAdapter=false`、18 个特性、**无 `shader-f16`**。数值 `limits`（`maxBufferSize=4294967292`、`maxStorageBufferBindingSize=2147483644`）来自**两个页面上下文**；同源 Blob Worker 返回相同的 vendor/architecture/fallback/特性，但 `limits` 为**空对象**，因此这些数值**不得**归到 worker 上下文。`hardware.rawAdapterObservation` 绑定到 `artifacts/env01/webgpu-fixture-page.json` 的事件 0。
- **真实 DOM 侦察**：options 页路由/文案/控件路径、供应商下拉真实选项、`跟随默认 · 免费翻译服务` 的逐功能下拉、OCR 引擎两项选项、暗色与 390px 状态。**这些不是 UI-01/OCR-UI-01 的通过证据**：本轮没有执行「创建自定义服务 → 检查连接 → 空搜索 → 重开保存」这条流程，也没有执行「显式选 PaddleOCR → 仅选择不下载 → 重开仍保存」。
- **夹具契约**：`POST /v1/chat/completions`（`fixture-normal` + `Bearer fixture-not-secret`）使 `/metrics` 计数 0→1。该请求由 harness 直连回环夹具发出，**不是扩展发出的**，只证明夹具工作。
- **清理证明**：浏览器/夹具 PID 已死、9420 与 57280 无监听、临时 profile 已删、无残留 helper、日常实例 PID 98229 仍存活（`artifacts/hygiene/cleanup-proof.json`）。

**旁证不得写成 pass**：本轮 `result.json` 中 0 个 pass，`overall` 为派生值 `blocked`。

## 6. 范围声明

- 本轮**未**执行：任何真实模型推理、任何模型下载、任何 GPU 推理用例、任何故障注入、任何 YouTube 用例、任何无痕上下文用例、任何 Playwright 驱动的 runner、task-scoped stdio 控制面 spawn。
- 本轮**未**修改：产品源码、`scripts/` 下任何工具文件、任何既有分支引用（提交前/后各记录一次 ref 表）、日常 BrowserOS 实例。
- 本轮**未**重建扩展（红线）。扩展产物为工作区内既有构建，本轮只对它**重新计算** 401 个文件的 SHA-256（`manifestSha256=e70a1b9da10b0e2b79c0cf3142affb5bf1fad060e7ff1fac15fd626e71ee2247`）。
- 内容寻址的哈希与上一轮相同属**正常**：`pnpm-lock.yaml` = `5b251fb80b9a…`、构建清单 = `e70a1b9d…`、语言清单（480 文件）= `abc11522…`。机器相关的值全部不同：浏览器二进制 = `23cdb86278d0581838abf7bca4079a30150c38d76ce783430f882254671514f0`、浏览器版本 `151.0.8160.137`（上一台是 `…8162.137`）、GPU 为 NVIDIA 而非 Apple。
- `startedAt` = **`2026-10-05T10:58:06Z`**，即本轮第一次真实观测（守卫阻断探针 transcript 的时间戳，见 `artifacts/focus/guard-block-transcripts.txt`）；`finishedAt` 为记录落盘时间。（初版曾把 BLOCKER-BRIEF 的 fold 时间戳 `11:12:56Z` 误当自检日志时间，已在第 2 版修正。）
- **旁证标注粒度**：六个原始捕获件（`artifacts/env01/cdp-version.json`、`dom-options.json`、`dom-popup.json`、`dom-fixture-page.json`、`webgpu-fixture-page.json`、`webgpu-options-page.json`）是**逐字节原样**保留的捕获，因此**不带**内联 `sideEvidenceOnly` 字段；它们的标注状态逐条列在 `artifacts/env01/side-evidence-manifest.json`，全局声明在 `result.json` 的 `limitations` 里。任何旁证都未被表述为产品行为。
- **Git 状态审计**：轮次前后的本地/远端 ref 全表与推送证据见 `artifacts/git/ref-audit.json`；所有既有 ref 前后逐字节一致，唯一 ref 变化是新增本轮分支。
- **校验器逐字记录**：`artifacts/tools/validator-run.txt`。
- **全记录索引**：`record-index.json` 为记录内**每个文件**（含未登记到 `artifacts` 的文档/工具）提供 SHA-256。

## 7. 复现

```bash
# 工具与产品（同一个仓库；工具在 scripts/testing）
cd <WORKSPACE>/FluentRead
git rev-parse HEAD                      # 5a07ef494aee42cc2bf4c8dd945ee7c43b5c4576
git rev-parse c68a53af^{tree}           # 50e12ecc7f4c72448f03e714a585814eb9476622

# 工具自检
node scripts/testing/browser-focus-guard.mjs --self-check            # exit 0
node scripts/testing/browser-focus-visibility-selfcheck.mjs          # negativeChecks: 26
node scripts/testing/browser-focus-guard-entry-selfcheck.mjs         # 10 checks

# 守卫在本机的真实行为（不会创建报告文件）
node scripts/testing/browser-focus-guard.mjs --once --allow-partial-visibility \
  --profile /tmp/fluentread-linux-native-JcsG10 --pid 1690606 --port 9420 \
  --output /tmp/guard-report.json     # exit 1: This observer requires macOS

# 结果校验
node scripts/testing/browser-acceptance.mjs validate <本目录>/result.json
# -> {"valid":true,"overall":"blocked","cases":22}

# 反证
node <本目录>/harness/C-counterfactual.mjs
```

实机取证顺序（本轮真正跑过的）：创建 mode 700 的 `/tmp/fluentread-*` 临时 profile → 起回环夹具 → 按批准参数后台启动浏览器 → 读 CDP `/json/version` → 回读窗口矩形 → **尝试守卫** → `Extensions.loadUnpacked` → 从扩展自身 service worker 读身份 → 打开夹具页/options/popup（仅默认上下文）→ DOM 抓取 + 截图 + 暗色 + 390px → 三上下文 WebGPU 探针 → 夹具 metrics 前后对比 → teardown + 清理证明。

## 8. 目录内容

```
result.json                 本轮结果（22 项，0 pass，overall=blocked）
README.md                   本文件
counterfactual-pass.json    反证：真实校验器对变异副本的拒绝信息
defects/                    原始拒绝 transcript 与逐缺陷 JSON
artifacts/focus/            守卫尝试、前置条件、窗口回读、profile 记录
artifacts/env01/            浏览器/扩展身份、GPU 原始探针、DOM 侦察、6 张截图、夹具 metrics
artifacts/build/            构建清单（401 文件）、语言清单（480 文件）、命令清单
artifacts/host/             宿主、GPU、卫生事实
artifacts/tools/            四项自检原始输出
artifacts/neo/              控制面探测
artifacts/hygiene/          清理证明
artifacts/source.json       来源结构化证据
harness/                    本轮实际使用的 harness（Linux 适配）
```

`harness/` 中的脚本是本轮为本机**新写**的 Linux 适配版本：`fixture-server.mjs`、`cdp.mjs`、`load-extension.mjs`、`capture-dom.mjs`、`window-bounds.mjs`、`ext-session.mjs`、`ui-states.mjs`、`dropdown-recon.mjs`、`select-by-text.mjs`、`webgpu-probe.mjs`、`worker-probe.mjs`、`guard-attempt.sh`、`teardown.sh`、`A1-collect.mjs`、`A2-derived.mjs`、`B1-build.mjs`、`C-counterfactual.mjs`、`facts.mjs`、`sanitization-check.mjs`。其中不含任何其它机器的哈希、PID、端口或观测值。

**脱敏注意**：`harness/`、`defects/` 与 `sanitization-report.json` 中的本机路径已按规则替换为 `<HOME>`/`<WORKSPACE>`，直接运行这些脚本前需先还原这两个占位符；`harness/sanitization-check.mjs` 的两个路径常量同样被替换，因此权威扫描是用「运行时推导路径」的工作副本完成的（见 `sanitization-report.json`）。`artifacts/**` 是**先脱敏再算哈希**，所以每个已登记摘要都与磁盘上的脱敏字节一致。

## 9. 对抗性审查修正（第 2 版）

本记录第 1 版（提交 `46877c8a`）经独立对抗性审查后，审查者提出了若干**可复现**的问题。以下是逐条处置。审查者同时确认：**blocked 结论本身真实**（校验器返回 `{"valid":true,"overall":"blocked","cases":22}`，守卫第 93 行确实是 darwin 硬断言，零 pass 且结构上不可能有 pass）。

| # | 审查发现 | 处置 |
| --- | --- | --- |
| 1 | 随记录交付的 `harness/C-counterfactual.mjs` 不是产生 `counterfactual-pass.json` 的脚本（缺少 4 处 checkout 门禁变异），所以 §7 的复现命令会得到不同结果并覆盖已提交产物 | 随记录副本已同步为**实际生产者**，`counterfactual-pass.json` 已由该脚本**重新生成**（已核 `diff` 与 sha256） |
| 2 | 六个已登记浏览器捕获件缺少内联 `sideEvidenceOnly`，而 §5 声称「全部带」 | 新增 `artifacts/env01/side-evidence-manifest.json` 逐条列出标注状态；§5 措辞已改为「大部分带内联标注」并说明六个原样捕获件由全局声明覆盖 |
| 3 | `artifacts/host/hygiene.json` 写的是任务提示里的 `Ubuntu 24.04.4`，与实测 `26.04.1` 不符，且声称不会推送 | 已用**实测值**重写（`revision: 2`，并写明被取代的错值）；推送事实改由 `artifacts/git/ref-audit.json` 记载 |
| 4 | `sanitization-report.json` 的结论不可复现；其 caveat 关于「工作副本运行时推导路径」是**假的** | 随记录交付的 checker 已重写为**运行时推导路径**且可原地运行（exit 0，0 违规）；报告升为 `revision: 2`，并列出**已撤回的主张** |
| 5 | §2/DEFECT-11 把 CDP 回读当作合成器实测并断言「完全可见」 | §2 已明确：CDP 值是**浏览器自己报告**的边界，本机无 OS 级几何探针，该分类**不作为 guard 派生事实**；DEFECT-11 同步降级措辞 |
| 6 | `environment.focusPolicy` 断言「从未激活」，但本机没有前台探针 | 已改写为只声称**可验证的部分**（后台 detached 启动、未调用任何激活/置顶 API、未移动/缩放），并明确写明**前台状态在本机不可验证** |
| 7 | `startedAt` 归因错误（误用 BLOCKER-BRIEF 的 fold 时间戳） | 已改为 **`2026-10-05T10:58:06Z`**（首次真实观测，即守卫阻断探针 transcript 时间戳） |
| 8 | §5 把数值 `limits` 归到三个上下文，但 worker 上下文的 `limits` 为空对象 | 已改为「数值 limits 来自两个页面上下文，worker 返回空 limits，不得归到 worker」 |
| 9 | OCR-UI-01 声称下拉「恰好」两项，实际捕获是 94 项并集 | 已加入 caveat，明确该快照**不**证明引擎选择器只提供两项 |
| 10 | DEFECT-12 的 helper `--config=…` 属推断、无原始捕获 | 已标注为 teardown 清单里观察到的命令行，并说明未作为原始 artifact 保留 |
| 11 | 记录里没有校验器逐字运行记录 | 新增 `artifacts/tools/validator-run.txt`（已登记） |
| 12 | 33/73 文件无摘要 | 新增 `record-index.json`，为**每个**文件（含未登记的文档/工具）提供 SHA-256 |
| 13 | 无轮次后 git/推送审计 | 新增 `artifacts/git/ref-audit.json`（前后本地/远端 ref 全表 + 推送证据） |

未处置：审查者建议「把每个 case 的 evidence/observation 做成带标注字段的结构」，本轮未改 `result.json` 的 case 结构（该结构由 `result.schema.json` v2 固定为字符串数组），改为在 `limitations` 与 `side-evidence-manifest.json` 中给出全局与逐件声明。

审查者其余确认事项（blocked 结论、零 pass、守卫拒绝、无伪造 guard 报告、40 个已登记 artifact 摘要全部可重算、既有分支未动）本轮保持成立。
