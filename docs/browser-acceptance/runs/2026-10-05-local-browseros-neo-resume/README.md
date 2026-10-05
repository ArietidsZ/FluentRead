# 本地 BrowserOS Neo 验收 · 续跑轮（2026-10-05）

本目录是从 [`docs/browser-acceptance/resume.md`](../../resume.md)（交接材料 `cf54125302be2beebb3ba8860798f3cb053a3dac`）继续验收得到的**新一轮结果记录**。上一轮的 blocked 快照保存在另一分支的 `runs/2026-10-05-local-browseros-neo/`，本目录**不覆盖**它。

## 结论

- **总体 `blocked`：22/22 用例 blocked。**`{"valid":true,"overall":"blocked","cases":22}`。
- 全部 22 个用例停在**同一个新门禁**上：`scripts/testing/browser-focus-guard.mjs` 要求临时浏览器窗口与**所有**活动屏幕都不相交，而单屏 macOS 上 WindowServer 必然把普通窗口夹在屏幕内（40 px / 284 px 的最小可见边缘），因此守卫永远报 `guard-violation`、到不了 `running`，而 `resume.md` 规定守卫未 running 时不得启动浏览器操作。此项记为 **DEFECT-06**。
- 本轮**真实做成**的两件事：原始 GPU 证据按「文件 SHA-256 + eventIndex + context + at」重新绑定并通过校验；task-scoped Neo **stdio** 控制面验证通过（`browseros-neo` 0.0.66、22 工具），**DEFECT-05 因此在该路径上解除**。
- 产品源码与扩展**未变、未重建**：source commit `c68a53af300b33109375665197951331e45ae18a`，tree `50e12ecc7f4c72448f03e714a585814eb9476622`，构建清单 401 文件 / `e70a1b9d…`。

## 怎么复现

```bash
git fetch https://github.com/ArietidsZ/FluentRead.git review/browser-acceptance-20261005
git worktree add --detach ../fluentread-acceptance-tools FETCH_HEAD
cd ../fluentread-acceptance-tools && pnpm install --frozen-lockfile   # self-check 会调用真实语言生成器，需要依赖

# 1) 原始 GPU 证据绑定（输入与输出必须是不同文件）
node scripts/testing/browser-acceptance.mjs normalize-gpu \
  result.snapshot-previous.json artifacts/env01/gpu-log.json 2 > result.json

# 2) 契约自检
node scripts/testing/browser-acceptance.mjs self-check
node scripts/testing/browser-focus-guard.mjs --self-check

# 3) 结果校验
node scripts/testing/browser-acceptance.mjs validate result.json
# -> {"valid":true,"overall":"blocked","cases":22}

# 4) 反证：仅把 ENV-01 改成 pass，看契约停在哪一条断言（$RUN = 本目录，$TOOLS = tools worktree 根）
node "$RUN/harness/counterfactual.mjs" "$RUN" "$TOOLS"
# -> rejected: "Pass requires a completed continuous focus guard bound to the actual browser/profile"
```

焦点守卫与窗口摆放的证据是**本机实机运行**得到的，不是回放：

```bash
open -g -n -a "/Applications/BrowserOS neo.app" --args \
  --user-data-dir=/tmp/fluentread-resume-<id> --remote-debugging-port=<port> \
  --remote-allow-origins=http://127.0.0.1:<port> \
  --window-position=2700,120 --window-size=1200,900 \
  --no-first-run --no-default-browser-check --enable-unsafe-extension-debugging

node harness/window-placement-probe.mjs <port> <browserPid>          # CDP + AX 双路径摆放矩阵
node scripts/testing/browser-focus-guard.mjs \
  --profile /tmp/fluentread-resume-<id> --pid <browserPid> --port <port> \
  --output artifacts/focus/focus-preflight.json --once               # -> guard-violation

BROWSERCLAW_DIR=<run>/neo-state "$FR_NEO_SERVER" --config neo-sidecar.json --stdio
node harness/neo-stdio-probe.mjs "$FR_NEO_SERVER" neo-sidecar.json neo-state   # MCP initialize + tools/list
```

## 目录内容

| 路径 | 说明 |
|---|---|
| `result.json` | 本轮结果记录（22 用例全 blocked，20 个已登记 artifact） |
| `result.snapshot-previous.json` | 上一轮快照的规范化输入（`normalize-gpu` 的输入，未被覆盖） |
| `defect-report.md` | 完整阻断报告（DEFECT-01 ✅ / 02 ⛔ / 03 ⛔ / 04 ⚠️ / 05 ✅ / 06 ⛔ / 07 ⚠️） |
| `counterfactual-pass.json` | 反证件：仅将 ENV-01 改为 pass |
| `neo-sidecar.json` | 一次性 sidecar 配置（`ports.cdp` + `directories.resources`），路径已脱敏 |
| `artifacts/build/` | 扩展构建清单（401 文件）与生成语言清单（480 文件 + `inlineChineseSources`） |
| `artifacts/source.json` | 两个 commit、tree、锁文件哈希、生成前清洁状态 |
| `artifacts/env01/` | capabilities / gpu-log / browser-log / worker-context / 4 张 PNG 截图（首轮采集，本轮重新登记哈希） |
| `artifacts/focus/` | 焦点守卫单次观察、窗口摆放矩阵、临时实例启动记录 |
| `artifacts/neo/` | stdio 控制面的结构化能力记录与原始握手输出 |
| `tools-evidence/` | Neo server 路径与 SHA-256、`--version` / `--help` 原始输出 |
| `harness/` | 本轮实际使用的探针（`window-placement-probe.mjs`、`neo-stdio-probe.mjs`、`counterfactual.mjs`）与首轮 CDP 采集脚本（`legacy-*`） |

> 用 `git archive` 校验已提交字节时另外发现 **DEFECT-07**：`browser-focus-guard.mjs` 经 `/tmp/...`（符号链接）路径调用会**静默空转并以 0 退出**——主程序判定用 `import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href` 且无 `else` 分支，而 Node 已把 `import.meta.url` 解析为 `/private/tmp/...`。包装脚本会误以为守卫已运行。复现与建议见 `defect-report.md` DEFECT-07。

## 需要上游决策的一点

`browser-focus-guard.mjs` 的 offscreen 断言在单屏 macOS 上**物理不可达**，等于让 `pass` 永远无法产生。要恢复可满足性，需要二选一：把判定改成「非前台显示器的正常尺寸窗口 + 前台 PID 未变」，或显式接受被 WindowServer 夹取的最小可见边缘并给出对应的证据语义。详见 `defect-report.md` 第七节。

## 范围声明

本目录**不是**浏览器功能、GPU 推理或真实模型的通过报告。GPU 部分是 **adapter 发现**（含 `shader-f16`，四个执行上下文）并已重新绑定到单次原始事件，**没有任何模型被下载或执行**，`models[]` 为空。所有绝对路径已脱敏为 `<HOME>` / `<WORKSPACE>`；`/Users/thinkstu/…` 是仓库源码中既有的硬编码值，作为缺陷证据保留。未包含密钥、Cookie、token、账号数据或模型权重。
