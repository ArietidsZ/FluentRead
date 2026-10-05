# 本地 BrowserOS Neo 验收 · 规则修订轮 `c796cd88`（2026-10-05）

本目录是在**修正后的焦点守卫**（`c796cd88f2a2804c9e05da98be949ae4fa6298fd`，*fix: dispatch focus guard through canonical CLI paths*）下对同一份验收契约的复核记录。上一轮（`cf541253`）的 blocked 快照保存在 `runs/2026-10-05-local-browseros-neo-resume/`，本目录**不覆盖**它。

## 结论

- **总体 `blocked`：22/22 用例 blocked。**`{"valid":true,"overall":"blocked","cases":22}`。
- `c796cd88` 只改两处，**不触及任何用例契约**：`resume.md` / `README.md` / `cases.md` / `result.schema.json` 与 `cf541253` **逐字节相同**。产品 source commit `c68a53af300b33109375665197951331e45ae18a`、tree `50e12ecc7f4c72448f03e714a585814eb9476622`、扩展构建（401 文件 / `e70a1b9d…`）**均未变，未重建扩展**。
- **DEFECT-07 已修复并实机复核**（上一轮报告第七节第 8 条的建议）：旧版守卫经 `/tmp` 符号链接路径调用会**静默空转并以 0 退出**；新版两侧改用 `fs.realpath`，同一别名调用现在输出 `{"ok":true,…}`，并且真实 `--once` 流程会真的执行、写入 `guard-violation`、返回 exit 1。
- **DEFECT-06 仍然阻断全部 22 个用例，且此提交未触及它**：守卫的 offscreen 断言一字未改。单屏 macOS 上 WindowServer 必然把普通窗口夹在屏幕内，`checkFocusSnapshot` 因此不可能通过。本轮用**新的临时实例**再次双路径实测：CDP 与 Accessibility API 都停在 `left ≤ 2520`（留 40 px）/ `left ≥ -916`（留 284 px）/ `top ∈ [30, 1394]`，`fullyOffscreenReachable: false`。

## 怎么复现

```bash
git fetch https://github.com/ArietidsZ/FluentRead.git review/browser-acceptance-20261005
git worktree add --detach ../fluentread-acceptance-tools FETCH_HEAD
cd ../fluentread-acceptance-tools && pnpm install --frozen-lockfile   # self-check 会调用真实语言生成器，需要依赖

# 1) 新增的守卫入口身份回归
node scripts/testing/browser-focus-guard-entry-selfcheck.mjs
node scripts/testing/browser-focus-guard.mjs --self-check

# 2) DEFECT-07 的 A/B：同一条 /tmp 别名路径分别调用旧版与新版守卫
node "$RUN/harness/guard-entry-alias-probe.mjs" <old-cf541253-guard.mjs> scripts/testing/browser-focus-guard.mjs /tmp/alias-probe.json

# 3) 结果校验与反证（$RUN = 本目录，$TOOLS = tools worktree 根）
node "$TOOLS/scripts/testing/browser-acceptance.mjs" validate "$RUN/result.json"
node "$RUN/harness/counterfactual.mjs" "$RUN" "$TOOLS"
# -> rejected: "Pass requires a completed continuous focus guard bound to the actual browser/profile"
```

焦点守卫、窗口摆放与 Neo stdio 控制面的证据都是**本机实机运行**得到的（`artifacts/rules/session-log.txt` 是完整运行日志）：

```bash
open -g -n -a "/Applications/BrowserOS neo.app" --args \
  --user-data-dir=/tmp/fluentread-rules2-<id> --remote-debugging-port=<port> \
  --remote-allow-origins=http://127.0.0.1:<port> \
  --window-position=2700,120 --window-size=1200,900 \
  --no-first-run --no-default-browser-check --enable-unsafe-extension-debugging

# 关键：经 /tmp 祖先目录符号链接调用守卫（就是 DEFECT-07 的形状）
ln -s "$TOOLS/scripts" /tmp/<alias>/scripts
node /tmp/<alias>/scripts/testing/browser-focus-guard.mjs \
  --profile /tmp/fluentread-rules2-<id> --pid <pid> --port <port> \
  --output artifacts/focus/focus-preflight.json --once     # -> guard-violation, exit 1

node "$RUN/harness/window-placement-probe.mjs" <port> <pid>   # CDP + AX 双路径摆放矩阵

BROWSERCLAW_DIR=<run>/neo-state "$FR_NEO_SERVER" --config neo-sidecar.json --stdio
node "$RUN/harness/neo-stdio-probe.mjs" "$FR_NEO_SERVER" neo-sidecar.json neo-state
```

## 目录内容

| 路径 | 说明 |
|---|---|
| `result.json` | 本轮结果记录（22 用例全 blocked，23 个已登记 artifact） |
| `result.snapshot-previous.json` | 上一轮（`cf541253`）记录，保持原样 |
| `defect-report.md` | 完整阻断报告（**DEFECT-01 ✅ / 02 ⛔ / 03 ⛔ / 04 ⚠️ / 05 ✅ / 06 ⛔ / 07 ✅**） |
| `counterfactual-pass.json` | 反证件：仅将 ENV-01 改为 pass |
| `artifacts/rules/guard-entry-selfcheck.txt` | 上游新增入口回归的原始输出 |
| `artifacts/rules/guard-entry-alias-probe.json` | 旧版 vs 新版守卫经 `/tmp` 别名调用的 A/B 记录（`defect07Resolved: true`） |
| `artifacts/rules/session-log.txt` | 本轮三条探针的完整运行日志 |
| `artifacts/focus/focus-preflight.json` | 修复后的守卫经 `/tmp` 别名真实运行 → `guard-violation`（exit 1） |
| `artifacts/focus/window-placement-probe.json` | CDP + AX 双路径摆放矩阵，`fullyOffscreenReachable: false` |
| `artifacts/focus/launch-record.txt` | 临时实例的实际启动参数与时刻 |
| `artifacts/neo/` | stdio 控制面能力记录（22 工具）与原始握手输出 |
| `artifacts/build/`, `artifacts/source.json`, `artifacts/env01/` | 沿用同一验收的构建 / 语言 / 源码 / GPU / 截图证据（产品未变，哈希不变） |
| `tools-evidence/` | Neo server 路径与 SHA-256、`--version` / `--help` 原始输出 |
| `harness/` | 本轮实际使用的探针（`guard-entry-alias-probe.mjs`、`window-placement-probe.mjs`、`neo-stdio-probe.mjs`、`counterfactual.mjs`）与首轮 CDP 采集脚本（`legacy-*`） |

## 仍然需要上游决策的一点

**DEFECT-06 未被本规则修订触及。** `checkFocusSnapshot` 要求测试窗口与**所有**活动屏幕都不相交，这在单屏 macOS 上物理不可达，等于让 `pass` 永远无法产生。要恢复可满足性，需要二选一：把判定改成「非前台显示器的正常尺寸窗口 + 前台 PID 未变」，或显式接受被 WindowServer 夹取的最小可见边缘并给出对应的证据语义。详见 `defect-report.md` 第七节第 1 条。

## 范围声明

本目录**不是**浏览器功能、GPU 推理或真实模型的通过报告。GPU 部分是 **adapter 发现**（含 `shader-f16`，四个执行上下文）并已绑定到单次原始事件，**没有任何模型被下载或执行**，`models[]` 为空，每个真实模型用例记录的都是「未执行，下一步为……」的具体动作。所有绝对路径已脱敏为 `<HOME>` / `<WORKSPACE>`；`/Users/thinkstu/…` 是仓库源码中既有的硬编码值，作为缺陷证据保留。未包含密钥、Cookie、token、账号数据或模型权重。
