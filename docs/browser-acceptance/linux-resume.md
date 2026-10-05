# Linux 材料补齐与恢复边界

本页只修正验收材料与来源，不修改产品、不重建扩展，也不把已有 blocked 改为 pass。保留原始报告；在新的修订结果中记录补齐项和实际阻断。

## 从健康 clone 固定产品与工具身份

若当前 clone 缺对象或 worktree 状态损坏，使用未占用的新目录。以下 Bash 片段在同一终端顺序执行，遇错即停并记录原因：

```bash
set -euo pipefail
git clone --branch review/browser-acceptance-20261005 https://github.com/ArietidsZ/FluentRead.git ../fluentread-linux-tools
git -C ../fluentread-linux-tools fetch origin c68a53af300b33109375665197951331e45ae18a
git -C ../fluentread-linux-tools worktree add --detach ../fluentread-linux-product c68a53af300b33109375665197951331e45ae18a
test "$(git -C ../fluentread-linux-product rev-parse 'HEAD^{tree}')" = 50e12ecc7f4c72448f03e714a585814eb9476622
git -C ../fluentread-linux-product diff --exit-code HEAD --
test -z "$(git -C ../fluentread-linux-product status --porcelain=v1 --untracked-files=all)"
test -f ../fluentread-linux-product/pnpm-lock.yaml
git -C ../fluentread-linux-tools rev-parse HEAD
git -C ../fluentread-linux-product rev-parse HEAD
```

产品身份是公开提交 `c68a53af300b33109375665197951331e45ae18a` 和上述 tree；不需要取得历史本地 `7212af1f` 对象。报告中的 `5a…` 工具快照、`7f8d6dfe0d8ebd7a526bf9c654ea7e4926518fa1` 或更新交接提交，只能记为工具身份，不能替换 `publishedSourceCommit`/`checkoutCommit`。记录两边完整 SHA。

新 worktree 只证明当前核对的产品来源，不能倒填为旧构建发生的位置。保留历史构建的真实 checkout、命令与日志；有矛盾或缺失时明确记录证据不足，不伪造已执行的 build、语言生成或来源检查。

只有实际 worktree 的缺失/修改文件检查、清洁状态与锁文件读取成功，才能记录该次 `worktreeCleanBeforeLocaleGeneration`；单独的 `HEAD^{tree}` 不证明工作区文件完整。

使用 Node 22 / pnpm 9.12.1。缺失或版本不符时，先从官方来源准备并校验本次目录内的工具，仅在当前终端选择其 PATH，不替换全局工具，再继续版本检查。在工具 clone 按锁文件安装依赖；这一来源准备步骤无需执行 build：

```bash
FR_TOOLS=$(cd ../fluentread-linux-tools && pwd)
FR_PRODUCT=$(cd ../fluentread-linux-product && pwd)
FR_TOOLS_COMMIT=$(git -C "$FR_TOOLS" rev-parse HEAD)
node --version
pnpm --version
node -e 'if(process.versions.node.split(".")[0]!=="22")throw Error("Node 22 is required")'
test "$(pnpm --version)" = 9.12.1
(cd "$FR_TOOLS" && pnpm install --frozen-lockfile)
node -e 'const fs=require("node:fs"),c=require("node:crypto");console.log(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$FR_PRODUCT/pnpm-lock.yaml"
```

`artifacts/source.json` 的 `lockfileSha256` 必须是上面实际锁文件的 **64 位十六进制字符串**，与 `result.json` 的 `provenance.lockfileSha256` 相同，不能填本次错误使用的 `{product: ..., repo: ...}` 对象。修正来源 JSON 后重新计算它在 `result.json.artifacts` 中登记的文件 SHA-256；不得只改登记值来掩盖不同内容。原始来源记录另存保留。

## 补齐 Git 实际遗漏的三个文件

以下路径相对结果仓库根目录。先确认它们是原运行生成、已脱敏且在 `result.json.artifacts` 登记的 JSON，并逐一核对登记哈希；不要用占位文件补齐：

- `docs/browser-acceptance/runs/2026-10-05-local-browseros-neo-linux-native/artifacts/build/commands.json`
- `docs/browser-acceptance/runs/2026-10-05-local-browseros-neo-linux-native/artifacts/build/build-files.json`
- `docs/browser-acceptance/runs/2026-10-05-local-browseros-neo-linux-native/artifacts/build/generated-locales.json`

恢复的原始字节必须匹配已登记 SHA-256。若脱敏改变字节，在新的修订结果中更新相应哈希并保留旧记录；找不到原始文件时保持“证据不可用”，不能重新生成文件冒充历史构建输出。

改动字节或来源元数据的修订应另行打包：把新 `result.json`、相关登记和对应文件一起定向暂存，再导出该次树并验证。下面“恰好三项”仅用于原始字节的补漏，不能拿旧报告哈希验证已改动的文件。

确认文件不含密钥、Cookie、私密内容、本机用户名路径或模型权重后，只对这三项定向强制暂存。本节的暂存区须恰好是这三个路径；必要的已跟踪结果/来源修订单独审阅，不混入这一次暂存：

```bash
git add -f -- \
  docs/browser-acceptance/runs/2026-10-05-local-browseros-neo-linux-native/artifacts/build/commands.json \
  docs/browser-acceptance/runs/2026-10-05-local-browseros-neo-linux-native/artifacts/build/build-files.json \
  docs/browser-acceptance/runs/2026-10-05-local-browseros-neo-linux-native/artifacts/build/generated-locales.json
git diff --cached --name-only
git diff --cached --check
```

不要强制添加整个 ignored 目录。用全新的导出目录验证 Git 将携带的暂存区树，而非只检查当前工作区中仍然存在的 ignored 文件：

```bash
FR_EXPORT_TREE=$(git write-tree)
FR_EXPORT_DIR=$(mktemp -d "${TMPDIR:-/tmp}/fluentread-linux-export.XXXXXX")
git archive "$FR_EXPORT_TREE" | tar -x -C "$FR_EXPORT_DIR"
test "$(git -C "$FR_TOOLS" rev-parse HEAD)" = "$FR_TOOLS_COMMIT"
node "$FR_TOOLS/scripts/testing/browser-acceptance.mjs" validate \
  "$FR_EXPORT_DIR/docs/browser-acceptance/runs/2026-10-05-local-browseros-neo-linux-native/result.json"
```

记录 `FR_TOOLS_COMMIT` 的完整值及原生命令/退出码。这一步不提交或推送。发布结果后，还应从该结果提交的全新 clone 或 `git archive HEAD` 再运行同一原生验证命令。验证结果应如实保留 blocked；`valid: true` 只表示报告结构和登记文件可核验，不是浏览器或模型通过。

## Linux 运行边界

当前 `browser-focus-guard.mjs` 明确只支持 macOS；Linux 上拒绝运行是预期边界。Linux/Wayland 的 Neo 控制握手、持续焦点观察、临时 profile/PID/端点归属，以及已批准的“部分可见但不抢焦点”放置策略尚未验证。在具备有效且受审阅的运行门槛前，停止进一步浏览器操作，不移除平台判断、不用假的 guard 结果继续，也不新增未经验证的框架。可改用先前已打通控制连接的 Mac 路径，但仍需新的临时实例、实际连续 guard 证据和逐项验收；沿用 [恢复指南](./resume.md)。

RTX 5090 是已观察到的物理 GPU，当前没有模型推理证据。该次浏览器探测缺少 `shader-f16`，因此 OPUS FP16、Index 和 Qwen q4f16 仍被能力条件阻断；OPUS FP32、Qwen q4 在原理上不要求该可选特性，但必须先满足控制/焦点门槛，再验证真实运行，不能提前记为 pass。保留原始 adapter/features/limits，不伪装能力、不隐式转为 CPU。

约 28.8/32.6 GiB 显存占用只是当时快照；继续前重新检查可用显存、磁盘与模型需求，逐个运行。不要终止无关进程来腾出资源；不足时记录具体缺口并等待用户决定。材料补齐、GPU 发现和纯自检都不改变尚未完成的推理状态。
