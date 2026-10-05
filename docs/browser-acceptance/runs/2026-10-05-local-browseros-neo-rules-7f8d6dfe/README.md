# 本地 BrowserOS Neo 验收 · 新规则轮（2026-10-05）

本目录是依据 [`docs/browser-acceptance/resume.md`](../../resume.md) 与 [README](../../README.md) 在**上游规则修订 `7f8d6dfe`**（`test: add explicitly approved partial-visibility acceptance mode`）下得到的**新一轮结果记录**。上一轮的 blocked 快照保存在其它分支的 `runs/2026-10-05-local-browseros-neo/`、`…-resume/`、`…-rules-c796cd88/`，本目录**不覆盖**它们。

## 结论

- **总体 `blocked`：21/22 用例 blocked，ENV-01 首次 `pass`。** 校验输出：`{"valid":true,"overall":"blocked","cases":22}`。
- **焦点门禁（DEFECT-06）在本轮被用户批准的例外绕过，不再是任何用例的阻断原因。** 按 `7f8d6dfe` 新增的 `--allow-partial-visibility` / 策略 `temporary-partial-visibility-20261005`，守卫第一次完整跑完整个取证过程并干净结束：
  - `status=stopped`、`mode=continuous`、`policy=temporary-partial-visibility-20261005`
  - **51 次** `focus-window-observation`，区间 `2026-10-05T08:42:05.776Z … 2026-10-05T08:42:32.780Z`，**0 次** `guard-violation`
  - 几何：单一 2560×1440 屏，窗口 `left=2400 top=120 1200x900`，可见 144000 / 1080000 px² → `partially-visible`
  - 全程前台 PID 恒为 `19141`（与本浏览器无关的用户应用），自有浏览器从未成为前台；窗口在启动后未被移动、缩放、最小化或抬升
  - 全部 8 条 browser-log 事件都落在首末观测之间（用户规则要求「首个 running 观测之后才操作，最后一个操作之后等待新观测再停止 guard」）
- **ENV-01 为什么可以 pass**：扩展在**本次运行、guard 已 running 之后**才用 CDP `Extensions.loadUnpacked` 载入已构建的 unpacked 目录；扩展身份从它自己的 service worker 用 `chrome.runtime.getManifest()` 读出；回环夹具经真实 MCP 控制面驱动；原始 WebGPU adapter 观测在**四个执行上下文**中分别采集；可见几何、GPU 绑定、源码/构建/语言清单证据全部由校验器重算通过。
  - 原始 WebGPU 观测：`normal-page`、`extension-offscreen`、`extension-options-page` 三处均为 `vendor=apple architecture=metal-3 isFallbackAdapter=false`，22 个特性含 `shader-f16`，`maxBufferSize = maxStorageBufferBindingSize = 4294967292`。
  - `extension-worker`（扩展同源 Blob Worker）仍然 **12 秒超时**，作为失败事件如实保留在 gpu log 中，不计为成功（**DEFECT-09**）。
- **扩展未重建、产品源码未改**：product commit `c68a53af300b33109375665197951331e45ae18a`，tree `50e12ecc7f4c72448f03e714a585814eb9476622`，构建清单 401 文件 / `e70a1b9d…`，语言清单 480 文件 / `abc11522…`。这些 provenance 证据**有意沿用上一轮**（构建没变，正是契约要求的「被加载扩展的精确构建身份」）；本轮**新采集**的是 guard 记录、browser log、GPU log、能力证据、worker 上下文、扩展身份与三张 UI 截图。

## 与上一轮相比的实际变化

| 项目 | 上一轮（cf541253 / c796cd88） | 本轮（7f8d6dfe） |
| --- | --- | --- |
| focus guard | 只能 `--once`，必报 `guard-violation`，到不了 `running` | **完整 continuous 运行并 `stopped`，0 违规，51 次观测** |
| ENV-01 | blocked | **pass**，且通过契约的通过路径逐条重算 |
| UI-01 / OCR-UI-01 | 未执行 | **部分执行**：popup 与 options 在自有实例中真实渲染并截图（guard 区间内） |
| 阻断原因 | 全部是焦点门禁 | 焦点门禁已解除；剩下 DEFECT-02 / DEFECT-03（缺 `focus-safe-browser.cjs` 与 Playwright）与未下载的模型资产 |
| 反证 | `pass` 被拒于「缺少完整连续 guard」 | **两个反例**：guard 未 `stopped` → 拒；撤销部分可见例外（严格策略）→ 拒 |

## 反证（`counterfactual-pass.json`）

在同一个真实记录上做最小改动、走同一条校验路径：

1. `baseline`（原样）→ `{"valid":true,"overall":"blocked","cases":22}`（接受）
2. guard `status` 改回 `running` → 拒绝：`Pass requires a completed continuous focus guard bound to the actual browser/profile`
3. 撤销已获批的部分可见例外（删掉 guard 与报告的 `visibilityPolicy`，按严格策略解释）→ 拒绝：`Test window intersects an active display; stop and restore approved offscreen placement`
4. 撤回 ENV-01 的 pass 声明 → 接受，仍为 `blocked`（说明 blocked 不是靠「免检」得到的）

即 ENV-01 的 pass **同时**依赖「完整连续的 guard」和「用户明确批准的部分可见例外」两项，缺一即被拒。

## 怎么复现

```bash
git fetch https://github.com/ArietidsZ/FluentRead.git review/browser-acceptance-20261005
git worktree add --detach ../fluentread-acceptance-tools 7f8d6dfe0d8ebd7a526bf9c654ea7e4926518fa1
cd ../fluentread-acceptance-tools
pnpm install --frozen-lockfile        # 自检会调用真实语言生成器，需要依赖

# 工具自检（本轮输出见 tools-evidence/self-checks.txt）
node scripts/testing/browser-acceptance.mjs self-check
node scripts/testing/browser-focus-guard.mjs --self-check
node scripts/testing/browser-focus-visibility-selfcheck.mjs      # 26 条反例
node scripts/testing/browser-focus-guard-entry-selfcheck.mjs     # 10 条入口检查（c796cd88 的修复）

# 结果校验（在记录目录内）
node scripts/testing/browser-acceptance.mjs validate <本目录>/result.json
# -> {"valid":true,"overall":"blocked","cases":22}

# 反证
node <本目录>/harness/counterfactual.mjs <本目录> <tools worktree 根>
```

实机取证流程（本轮真正跑过的顺序，harness 已随记录提交）：

```bash
# 1) 后台、不激活地启动专用临时实例，窗口启动即部分可见（用户批准的例外）
open -g -n -a "/Applications/BrowserOS neo.app" --args \
  --user-data-dir=<TMP>/fluentread-partial4-<id> --remote-debugging-port=<port> \
  --remote-allow-origins=http://127.0.0.1:<port> \
  --window-position=2400,120 --window-size=1200,900 \
  --no-first-run --no-default-browser-check --enable-unsafe-extension-debugging

# 2) 编排：先起 task-scoped stdio 服务（guard 绑定它的 pid）→ 起持续 guard → 等 running
#    → 单一取证驱动做完所有浏览器操作 → 写 done 哨兵 → guard 干净停止
bash <本目录>/harness/run-all.sh

# 3) 组装可校验记录（artifact 摘要全部由磁盘真实文件计算，写盘前做路径脱敏）
node <本目录>/harness/assemble.mjs <本目录> <本轮运行目录> <上一轮 result.json>
```

## 目录内容

- `result.json` — 可校验结果（22 用例；ENV-01 pass，其余 blocked 并写明精确阻断原因）
- `result.snapshot-previous.json` — 上一轮的 blocked 记录，便于对比
- `counterfactual-pass.json` — 上节两个反例的实际输出
- `artifacts/focus/focus-guard.json` — **本轮**完整连续 guard 记录（`environment.focusGuardEvidence`）
- `artifacts/focus/launch-record.txt`、`artifacts/focus/window-placement-probe.json` — 启动参数与 guard 记录的原始几何
- `artifacts/env01/browser-log.json` — **本轮**12 条已观测浏览器事件（全部在 guard 区间内）
- `artifacts/env01/gpu-log.json`、`artifacts/env01/worker-context.json` — **本轮**原始 GPU 观测与 Worker 上下文（含失败事件）
- `artifacts/env01/{extension-popup,extension-options-page,extension-offscreen}.png` — **本轮**扩展 UI 真实截图
- `artifacts/env01/capabilities.json`、`artifacts/neo/capabilities-neo-stdio.json` — **本轮** CDP 与 MCP stdio 能力证据
- `artifacts/build/*`、`artifacts/source.json` — 沿用（构建未重建）
- `defects/` — 本轮真实故障证据：`Target.createTarget` 抢前台（guard-violation）与随后的浏览器 SIGSEGV 崩溃、早前一版 guard 的端口不匹配违规、以及第一轮的部分 guard 记录
- `harness/` — 本轮取证驱动、编排脚本、组装脚本与反证脚本
- `tools-evidence/` — 上游 revision、工具自检输出、guard CLI 与策略源码位置
- `defect-report.md` — 缺陷清单与上游修复建议

## 诚实边界

- 本轮**没有**下载任何模型资产，**没有**跑任何真实模型推理；十个 real-model / fault-injection 用例因此仍 blocked。
- `defects/browser-crash-21853.json` 是一次真实崩溃（`EXC_BAD_ACCESS`/SIGSEGV，incident `5FB01192-4184-4923-9D85-60269D13FED8`），发生在新浏览器上下文里 `Target.createTarget` 之后的约 1 秒；该调用也同时触发 `guard-violation "Owned browser became foreground"`，两次独立复现。本轮把它记为 **DEFECT-08** 并归档证据，**没有**再重复触发。
- 本记录只覆盖单屏单机情形，不把「部分可见」例外推广到其它机器。
