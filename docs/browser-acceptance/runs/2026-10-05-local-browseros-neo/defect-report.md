# FluentRead — BrowserOS Neo 本地验收结果与阻断报告

**交接文档**：`ArietidsZ/FluentRead` @ `review/browser-acceptance-20261005` → `docs/browser-acceptance/README.md`
**交接材料版本**：`8ab2fda4` 首轮 → **`a8728f79dffde9f0ea2a43d8fca7fa9186c33d88`**（修复语言与 GPU 契约后重跑）
**验证的 source commit**：`c68a53af300b33109375665197951331e45ae18a`（tree 实测 = `50e12ecc7f4c72448f03e714a585814eb9476622` ✓ 与交接要求一致，**更新后未变，故未重建扩展**）
**运行时间**：2026-10-05
**总体结论**：`blocked`（22/22 用例 blocked，`validate` 与 `self-check` 均通过）

---

## 一、结论摘要

| 项目 | 结果 |
|---|---|
| tree 门禁 | ✅ 通过（`git rev-parse c68a53af^{tree}` = `50e12ecc…`） |
| 产品 worktree | ✅ `git worktree add --detach`，生成语言前工作树干净（0 项改动） |
| `pnpm install --frozen-lockfile` | ✅ exit 0（22s） |
| `pnpm generate:userscript-languages` | ✅ exit 0 |
| `pnpm compile` | ✅ exit 0 |
| `pnpm build` | ✅ exit 0（`.output/chrome-mv3`，110.47 MB，401 文件） |
| `verify-emitted-model-workers.mjs` | ✅ exit 0 |
| `browser-acceptance.mjs self-check` | ✅ 通过（更新后含原生语言回归：5 个真实产物、34 项负向回归） |
| `browser-acceptance.mjs validate result.json` | ✅ `{"valid":true,"overall":"blocked","cases":22}` |
| 22 个用例 | ⛔ 全部 `blocked` |
| 真实模型 | ⛔ 未下载、未执行（0 字节） |

**更新后复跑（`a8728f79`）**：语言资源指纹已按新说明重新生成（新增 `inlineChineseSources`），`result.json` 中对应哈希已更新为 `699947f4…`；产品源码与扩展构建未变，**未重建扩展**。`validate` 与 `self-check` 均通过，22 个用例仍全部 `blocked`（原因与语言契约无关，见 DEFECT-02～05）。

**浏览器证据是真做出来的**：扩展在专用临时 profile 中真实加载，并在四个上下文里取得物理 GPU adapter（含 `shader-f16`）。但**无法据此判定任何用例 pass**——原因见下。

---

## 二、阻断项（按严重度）

### DEFECT-01 ✅ 已在上游修复（`a8728f79`）

**原问题**：`validateFileManifest` 的 `generated-locales` 分支硬编码要求六种语言（含 `zh-CN`），而冻结源码永远无法产出 `zh-CN` 文件，导致任何 `pass` 都会被拒绝。本次运行首次提交该问题后，上游以 `a8728f79 fix: align browser acceptance with native locale and GPU contracts` 修复。

**原证据链（保留存档）**：

1. 旧 `browser-acceptance-evidence.mjs` 硬编码六个语言（含 `zh-CN`）。
2. `validatePassEvidence` 只要有**一个** `pass` 就会执行到该检查。
3. 冻结源码 `src/core/i18n/types.ts:28` 是 `export type RegisteredUiLanguage = Exclude<UiLanguage, 'zh-CN'>;`，`bundles.ts` 只注册 `en-US / es-ES / fr-FR / ja-JP / ko-KR / ru-RU`，生成器跳过 `en-US`，故 `userscript/languages` 只有 5 种语言。
4. 实测：冻结 commit 中 `git ls-files userscript/languages` = 480 个文件（96 × 5），zh-CN 零个。

**修复内容（`a8728f79`）**：

- `validateFileManifest` 改為只要求生成器真正产出的五种语言 `es-ES / fr-FR / ja-JP / ko-KR / ru-RU`；
- 新增 `collectInlineChineseSources()`，把中文内联证据纳入语言清单：校验 `src/core/i18n/messages/zh-CN.ts` 与 `src/core/i18n/index.ts` 的路径与 SHA-256；
- `fingerprint ... generated-locales` 现会写入 `inlineChineseSources`；
- 同时放宽 `requireGpu()` 的 `features.length>0` 为 `Array.isArray(features)`（允许 Qwen q4 / OPUS FP32 的可选特性集为空），并加强了 self-check 的语言回归。

**本次复核（按更新后的说明重跑）**：

```
旧校验器 + 旧清单  -> REJECTED: Generated locale missing: zh-CN
新校验器 + 新清单  -> ACCEPTED
```

重新生成的清单：`manifestSha256` 仍为 `abc11522ec049930f8721119422d1808c13549061438fb08b6841fef26f48866`（文件集未变，480 个），新增 `inlineChineseSources` 两项，哈希与固定源码逐字节一致：

| 文件 | SHA-256（实测 = 期望） |
|---|---|
| `src/core/i18n/messages/zh-CN.ts` | `7ae35602395e4432c6678b5d319d6caa55ade65737dcdaf0dbb8b3c08b78edcc` |
| `src/core/i18n/index.ts` | `264fc1cb3c28766731e8ceb7700988bd83674e2cd332f126d77e64dc725e718c` |

清单文件自身哈希由 `abc1…`（旧结构）变为 **`699947f48468e100366cd82089289984d0ba44b74f11b2252f6a57f417629ccb`**，已在 `result.json` 的 `artifacts` 中同步更新。

**反证实验（更新后）**：同一份 `counterfactual-pass.json`（仅将 `ENV-01` 改为 `pass`）**不再**命中 `Generated locale missing: zh-CN`，而是前进到后续断言才失败：

```
$ node scripts/testing/browser-acceptance.mjs validate acceptance/counterfactual-pass.json
ENV-01 requires actual GPU discovery evidence        # 退出码 1
```

即：语言契约已不再是阻断点；`counterfactual-pass.json` 现在保留作为"单点 pass 可通过语言校验"的对照。

**产品源码未变**：`a8728f79` 只改动 `docs/browser-acceptance/README.md` 与三个 `scripts/testing/` 验收脚本，产品 source commit `c68a53af` 及其 tree `50e12ecc…` 不变，**因此无需重建扩展**，构建清单指纹继续有效。

### DEFECT-02 ⛔ 可信 focus-safe helper 不存在（阻断 5 个用例）

`--focus-safe-helper` 指向的 `focus-safe-browser.cjs` **在仓库与本机 `$HOME` 中都不存在**：

```
find . -name "focus-safe-browser*" -not -path "./.git/*"   → 无结果
find ~ -maxdepth 6 -name "focus-safe*"                     → 无结果
ls ~/.codex/skills/  → 仅 hatch-pet, .system
ls ~/.claude/skills/ → 仅 browseros-neo, course-review, paseo, paseo-help
```

三个脚本都必须导出 `launchFocusSafePersistentContext` / `newPageWithoutForeground` / `activateExtensionTabWithoutForeground`（`scripts/run-privacy-boundary-test.cjs:82-95` 显式校验）。`run-popup-actions-service-ui-test.cjs:19` 还硬编码了**别人机器**的默认路径 `/Users/thinkstu/.codex/skills/...`，属顶层 `require`，加载即 `MODULE_NOT_FOUND`。

交接文档自身规定：`缺少任何条件就把相关用例写成 blocked…不要伪造 helper`（README:11）。**因此 UI-01、PRIVATE-01、PRIVATE-02、YT-01、OCR-UI-01 全部 blocked。**

### DEFECT-03 ⛔ Playwright 不是本仓库依赖（阻断同 5 个用例）

`playwright` **不在** `package.json`（依赖与开发依赖均无），**在 `pnpm-lock.yaml` 中出现 0 次**，因此 `--playwright-root` 无法由本 checkout 满足。三个脚本一律 `require('playwright')`（从不使用 `playwright-core`）。

### DEFECT-04 ⚠️ Chromium 151 已忽略 `--load-extension`

仓库浏览器专项仍传 `--load-extension` / `--disable-extensions-except`。实测首次以 `--load-extension` 启动后目标列表**无任何 `chrome-extension://`**；改用 CDP `Extensions.loadUnpacked` 才成功加载。这使既有专项在该浏览器版本上即便补齐 helper 也会失效。

### DEFECT-05 ⚠️ MCP 控制面无法指向专用临时 profile

`browseros` MCP 端点为 `http://127.0.0.1:9010/mcp`，由 `~/Library/Application Support/BrowserClaw/.browseros/config.json` 的单一份额配置驱动。以 `--user-data-dir=<临时目录>` 启动第二个实例后，它**只监听自己的 CDP 端口（9111）**，不另起 BrowserClawServer/proxy（9012/9211 均无监听）。

而交接要求 `profileKind` 必须是 `dedicated-temporary`。**结论：不能用 MCP 工具驱动符合交接要求的临时 profile**；本报告的浏览器证据全部通过原生 CDP 采集。

---

## 三、真实完成的浏览器证据（ENV-01 部分执行）

专用临时 profile：`/tmp/fluentread-neo-acceptance-******`（`mkdtemp` 创建，mode 700，本 run 独占；`open -g` 后台启动，未抢焦点、未最小化、未调用 `bringToFront()`）。

| 事实 | 观测值 |
|---|---|
| BrowserOS neo | `0.50.5.0`（bundle 0.50.5） |
| Chromium | `151.0.8162.137`（revision `@8f5d36bc16f57115aeeff34baf4ad6aa964d509c`） |
| 主可执行文件 SHA-256 | `b65e8c83ff0568b4f082a8c91c4f8cf13807c415519b32f78ca14cd7080445d5` |
| 扩展身份（`chrome.runtime.getManifest()`） | **FluentRead-流畅阅读 0.0.35, MV3, id `djnlaiohfaaifbibleebjggkghlmcpcj`** |
| 同时存在的其他扩展 | BrowserOS Feedback 57.0.0.0、BrowserOS neo 0.2.22.0（用于区分，避免误认身份） |
| OS GPU | Apple M2 Max（38 GPU 核，Metal 4） |
| WebGPU adapter | vendor=`apple`, architecture=`metal-3`, **`isFallbackAdapter=false`**, 22 features, **`shader-f16` 存在** |
| `maxBufferSize` / `maxStorageBufferBindingSize` | 4294967292 / 4294967292 |
| MCP 工具面（只读枚举） | `browseros-neo` 0.0.66，**22 个工具**（tabs, act, run, evaluate, snapshot, …） |

**WebGPU 在四个独立执行上下文分别验证**（交接明确警告"网页 probe 成功不代表 Worker/Offscreen 成功"）：

| 上下文 | isFallbackAdapter | shader-f16 |
|---|---|---|
| 普通页（回环夹具） | false | ✅ |
| **扩展 offscreen 文档** | false | ✅ |
| **扩展源 Worker** | false | ✅ |
| **无痕页** | false | ✅ |

无痕可达性：`Target.createBrowserContext` 成功创建并加载页面，随后已 dispose。

回环夹具实测渲染（截图为证）：标题 `FluentRead local acceptance`；4 个 `<h2>`；两张 Canvas 图片 `single-image:900x280`、`manga-image:900x620`；TTS 文本 1081 字符。

> **范围声明**：以上仅为 **adapter 发现**。本次**未执行任何模型**，因此不存在 WebGPU dispatch / 图分区证据；`hardware.status='physical'` 不得被读作推理已验证。

---

## 四、真实模型：未下载、未执行

按操作者决定，本次**不下载** `model-catalog.json` 的 8 个 profile（合计 ≈ 5.03 GiB / 46 个 `repo@revision:path`）。`models[]` 因此**留空**，而不是填入未经验证的元数据（交接要求 `每个模型/方向缺证据都使本项 blocked`）。

补充结构性发现：**仓库不存在任何可预热模型缓存的脚本**。

- 权重的唯一取用路径是产品自身：`src/platform/storage/modelArtifacts.ts` → Cache Storage `fluent-read-local-models-v2`，4 MiB 分块 + 校验 receipt；Kokoro 走 `transformers-cache`，Paddle/LaMa 走 `fluent-read-manga-ocr-v1`。
- 取源 origin：`huggingface.co`；翻译与 Qwen ASR 可回退 `hf-mirror.com`；漫画另有 `hf-mirror.net`；Whisper 走 `modelscope.cn`。
- 现有脚本中**没有**能填充上述缓存的：`inspect-translation-artifacts.mjs` 只生成清单（不落权重）；`run-local-audio-gpu-test.cjs` 只覆盖 Kokoro + Whisper tiny，且自建临时扩展副本（新 origin）；`measure-kokoro-cache.mjs` 全是合成假 fetch。
- 结论：OCR/TTS/MT 的真实模型用例除下载外，还需**经产品设置界面驱动下载**，无法离线预置。

**离线用例的精确阻断清单**（供后续执行）：`TTS-04` 只需阻断 `huggingface.co`；`MT-04` 必须**同时**阻断 `huggingface.co` 与 `hf-mirror.com`（`modelArtifacts.ts:181-194` 会在首个 origin 失败后改走镜像，且 `navigator.language` 以 `zh` 开头时**镜像优先**）；漫画离线另需 `hf-mirror.net`。

---

## 五、交付物

| 文件 | 说明 |
|---|---|
| `result.json` | 22 用例全 blocked；`validate` 通过 |
| `counterfactual-pass.json` | 对照件：仅将 ENV-01 改为 pass。修复前报 `Generated locale missing: zh-CN`；修复后该错误消失，改为在后续断言 `ENV-01 requires actual GPU discovery evidence` 处失败 |
| `artifacts/build/build-files.json` | 扩展构建清单（401 文件，含真实 manifest 文本）；**未重建，哈希不变** |
| `artifacts/build/generated-locales.json` | 生成语言清单（480 文件，5 种语言 + `inlineChineseSources`），按 `a8728f79` 重新生成 |
| `artifacts/build/commands.json` | 构建命令与退出码事件日志 |
| `artifacts/source.json` | 两个 commit、tree、锁文件哈希、清洁状态 |
| `artifacts/env01/*` | capabilities / gpu-log / browser-log / 4 张 PNG 截图 |
| `defect-report.md` | 本文件 |
| `cdp.mjs`, `env01-recon.mjs`, `worker-probe.mjs`, `assemble.mjs`, `counterfactual.mjs` | 本次实际使用的 CDP 采集与装配脚本 |

**脱敏**：报告中所有含本机用户名的绝对路径已替换为 `<HOME>` / `<WORKSPACE>`；未包含任何密钥、Cookie、token、账号数据或模型权重。

---

## 六、给上游的修正建议

1. ~~**必修**：`validateFileManifest` 的 `generated-locales` 分支应依据源码真实的 `RegisteredUiLanguage` 取语言集。~~ ✅ **已在 `a8728f79` 修复并复验**（改为五种真实语言 + `inlineChineseSources` 中文内联证据）。
2. **必修**：`docs/browser-acceptance/README.md` 引用的 `--focus-safe-helper` 应在交接中一并提供，或明确声明该前置条件由使用者自备并据此全部 blocked（当前措辞已如此，但没有任何地方给出该文件）。这是当前**剩下的主要阻断源**。
3. **建议**：`self-check` 现在需要 `node_modules`（语言回归会调用真实生成器，生成器 `require.resolve('vite')`）。README 的"结果格式与交付"一节建议注明：`self-check` 需在**已安装锁定依赖**的 worktree 中运行；本次在交接 worktree 内补跑 `pnpm install --frozen-lockfile` 后通过。
4. 建议：`run-popup-actions-service-ui-test.cjs:19` 的 `/Users/thinkstu/...` 硬编码默认值应改为必填参数，避免在他人机器上以 `MODULE_NOT_FOUND` 形式失败。
5. 建议：浏览器专项需适配 Chromium ≥137 移除 `--load-extension` 的现实，改用 `Extensions.loadUnpacked`（并加 `--enable-unsafe-extension-debugging`）。
6. 建议：若要求 `profileKind=dedicated-temporary`，需说明如何让 MCP 控制面指向第二个实例，或明确允许 CDP 直连。
