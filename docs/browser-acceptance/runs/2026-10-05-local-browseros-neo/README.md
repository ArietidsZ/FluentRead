# 本地验收运行记录：BrowserOS Neo（2026-10-05）

本目录是一次**真实执行**的 BrowserOS Neo 本地验收运行记录，对应
[`../../README.md`](../../README.md)（交接说明）与 [`../../cases.md`](../../cases.md)（验收矩阵）。

**总体结论：`blocked`** —— 22/22 用例 `blocked`，`validate` 与 `self-check` 均通过。
本记录**不包含任何通过结论**，也不代表浏览器、硬件 GPU 或真实模型的通过报告。

## 1. 运行坐标

| 项目 | 值 |
|---|---|
| 交接材料版本 | `a8728f79dffde9f0ea2a43d8fca7fa9186c33d88`（首轮为 `8ab2fda4`） |
| 产品 source commit | `c68a53af300b33109375665197951331e45ae18a`（未改动） |
| 实测 tree | `50e12ecc7f4c72448f03e714a585814eb9476622` ✓ 与交接要求一致 |
| 扩展 | `FluentRead-流畅阅读` 0.0.35，MV3 |
| 浏览器 | BrowserOS neo 0.50.5.0 / Chromium 151.0.8162.137 |
| 平台 | macOS 27.2 (26B5091g)，arm64，Apple M2 Max（38 GPU 核，Metal 4） |
| Node / pnpm | v22.23.3 / 9.12.1 |
| 真实模型 | **未下载、未执行**（0 字节） |

## 2. 已完成的构建与校验

`pnpm install --frozen-lockfile` → `pnpm generate:userscript-languages` → `pnpm compile` → `pnpm build`
→ `verify-emitted-model-workers.mjs`，全部 exit 0。产物 `.output/chrome-mv3`（110.47 MB，401 文件）。

```bash
node scripts/testing/browser-acceptance.mjs validate <此目录>/result.json
# {"valid":true,"overall":"blocked","cases":22}

node scripts/testing/browser-acceptance.mjs self-check
# {"ok":true,...,"browserRun":false,"modelRun":false}
```

> `self-check` 需要 `node_modules`：语言回归会调用真实生成器，而生成器执行
> `require.resolve('vite')`。请在**已安装锁定依赖**的 worktree 中运行。

## 3. 真实采集到的浏览器证据

在**专用临时 profile** 中加载 MV3 构建（`--user-data-dir` 指向 `mkdtemp` 目录，`mode 700`），
以 `open -g` 后台启动：未抢焦点、未最小化、未调用 `Page.bringToFront()`。

WebGPU adapter 在**四个独立上下文**分别验证（交接明确警告"网页 probe 成功不代表 Worker/Offscreen 成功"）：

| 上下文 | `isFallbackAdapter` | `shader-f16` |
|---|---|---|
| 普通页（回环夹具） | false | ✅ |
| 扩展 offscreen 文档 | false | ✅ |
| 扩展源 Worker | false | ✅ |
| 无痕页 | false | ✅ |

adapter：`vendor=apple`、`architecture=metal-3`、22 项特性、
`maxBufferSize = maxStorageBufferBindingSize = 4294967292`。

> **范围声明**：以上仅为 **adapter 发现**。本次未执行任何模型，**不存在 WebGPU dispatch 或图分区证据**，
> `hardware.status = "physical"` 不得被读作推理已验证。

## 4. 阻断项

详见 [`defect-report.md`](./defect-report.md)。要点：

- **DEFECT-01 ✅ 已修复**（`a8728f79`）：旧校验器要求 `generated-locales` 含 `zh-CN`，
  而冻结源码 `RegisteredUiLanguage` 排除 `zh-CN`，导致任何 `pass` 都被拒。
  现已改为五种真实语言 + `inlineChineseSources` 中文内联证据。本目录的
  `generated-locales.json` 即按新说明重新生成（清单文件哈希 `699947f4…`）。
- **DEFECT-02 ⛔ 主要阻断源**：`--focus-safe-helper` 指向的 `focus-safe-browser.cjs`
  在本机与仓库都不存在；交接禁止伪造。阻断 UI-01、PRIVATE-01/02、YT-01、OCR-UI-01。
- **DEFECT-03 ⛔**：Playwright 不在 `package.json`，`pnpm-lock.yaml` 中 0 次命中。
- **DEFECT-04 ⚠️**：Chromium 151 已忽略 `--load-extension`；本次改用 CDP `Extensions.loadUnpacked`。
- **DEFECT-05 ⚠️**：MCP 控制面绑定单一 profile 目录，第二实例只暴露 CDP，
  与"必须使用 `dedicated-temporary` profile"冲突。

## 5. 目录内容

| 路径 | 说明 |
|---|---|
| `result.json` | 验收结果（22 用例全 `blocked`），`validate` 通过 |
| `defect-report.md` | 详细阻断报告与复验过程 |
| `counterfactual-pass.json` | 对照件：仅将 ENV-01 改为 `pass`。修复前报 `Generated locale missing: zh-CN`；修复后前移至 `ENV-01 requires actual GPU discovery evidence` |
| `artifacts/` | 证据：构建清单、语言清单、能力、GPU 日志、浏览器日志、4 张 PNG 截图、构建日志、来源信息 |
| `harness/` | 本次实际使用的采集与装配脚本（CDP 客户端、ENV-01 采集、Worker 探针、装配、反证件生成） |

`harness/` 中的脚本已做**路径脱敏**：本地绝对路径改为经 `FR_ACCEPTANCE_BASE` 环境变量传入，
再次运行前请指向包含产品 worktree、交接 worktree 与 `acceptance/` 的目录。

## 6. 脱敏与清理

- 报告与证据中所有含本机用户名的绝对路径均已替换为 `<HOME>` / `<WORKSPACE>`；
  未包含密钥、Cookie、token、账号数据、个人网页/音频或模型权重。
- 截图内容为合成夹具页面与全新 profile 下的扩展默认选项页，不含个人数据。
- 临时资源（专用 profile、夹具服务）已在运行结束后清理；**未触碰日常浏览器 profile**。
- 本次为本地验收记录，**不是**商店发布或线上资源发布。
