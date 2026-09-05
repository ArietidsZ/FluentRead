# 测试与回归

FluentRead 把测试按意图分组，而不是把所有文件塞进一个难以诊断的命令。每个 `tests/**/*.test.ts` 必须且只能出现在 `tests/test-matrix.json` 的一个分组中；测试审计会拒绝漏归类、重复归类、重复用例名、`.only`、无原因 `.skip` 和覆盖率忽略指令。

## 按需运行

```bash
pnpm test:audit          # 测试矩阵、重复和禁用项审计
pnpm test:architecture   # 分层、依赖方向与验证归属
pnpm test:unit           # 纯函数、状态机、parser、cache、handler
pnpm test:functional     # 多模块协作，替换网络/浏览器等外部边界
pnpm test:regression     # 历史缺陷的最小复现
pnpm test:coverage       # 已迁移可执行业务模块的四维 100% 门禁
pnpm test:document       # 文档格式、导出、取消、边界与历史回归
pnpm verify:extension-manifests  # fresh Chrome/Firefox 产物的权限、Offscreen 与 runtime marker
node scripts/verify-userscript-build.mjs  # userscript 元数据与产物边界
```

新增测试时应选择唯一分组：

- `unit` 只验证一个可隔离模块；不要再次复制同一功能的集成路径。
- `functional` 验证真实模块协作，mock 只放在网络、浏览器、时间或存储边界。
- `regression` 的用例名要写出历史失败条件，并保留能使旧实现失败的最小输入。
- `architecture` 验证目录、依赖、协议、安全运行方式和流水线归属，不替代行为断言。

`tests/architecture/sourceFileHeaders.test.ts` 会枚举 `src/` 下所有 TypeScript、Vue、CSS 与 Markdown 文件，检查首字符处的长注释、精确 `@file` 路径以及职责、内容、边界三个非空语义段。新增或移动源码时必须同步书写文件级说明，不能只让旧文件一次性通过。

## 覆盖率定义

项目使用两道互补门禁，不能把“构建成功”和“代码行为已经覆盖”混为一谈：

1. `vitest.coverage.config.ts` 中列出的已迁移 TypeScript 业务模块，V8 statements、branches、functions、lines 必须同时达到 100%。
2. `tests/architecture/verificationOwnership.test.ts` 审计其余 WXT entrypoint、Vue、CSS、HTML、browser runner、userscript 和文档文件，保证每个文件都由编译、双浏览器构建、静态契约、文档构建或隔离浏览器回归负责。

新增 `src` 可执行模块默认必须进入第一道门禁。只有纯类型文件、纯 re-export barrel 和列明理由的静态 composition root 可以由第二道门禁负责。禁止使用 `v8 ignore`、扩大 exclude 或无断言执行来制造 100%。

文档翻译的 parser、预览生成、二进制格式服务、翻译编排和展示模型全部进入第一道门禁；PDF.js worker 与真实 Canvas 像素采样适配由双浏览器构建及屏幕外文档浏览器回归负责。

配置计数测试需要同时覆盖：扩展后台 mutation 串行化、operationId 在提交后重启时去重、失败批次
复用同一标识、普通配置保存不能回滚 count，以及 userscript 多副本并发、提交后响应丢失和新页面聚合恢复。

## 翻译核心稳定性回归

排查重复翻译、鼠标经过闪切或原文恢复异常时，先运行以下确定性测试：

```bash
pnpm exec vitest run tests/hoverTranslationContentFeature.test.ts tests/fullPageVisibilityScheduling.test.ts tests/translationStability.test.ts tests/translationState.test.ts tests/translationBroker.test.ts tests/bilingualRemount.test.ts tests/bilingualReplay.test.ts tests/syntheticRemount.test.ts
```

这些用例覆盖组合键取消后的连续移动、同值属性写入、后代保护资格变化、在途 Text 重建、分槽来源变化、共享等待者取消、双语重挂和恢复，以及仅译文槽被宿主克隆后的原文保全。新增竞态用例应证明旧实现失败，且包含用户下一次正常翻译或恢复的断言，避免用永久禁用翻译掩盖循环。

生产 Chrome 产物另由 `scripts/run-full-page-translation-test.cjs` 验证真实键鼠事件、DOM 工件身份、请求数及连续帧可见性。使用浏览器技能提供的 focus-safe helper 与临时 profile，窗口在第二块屏幕可见但不抢前台。报告必须区分本地确定性服务夹具和真实网站、真实翻译服务的结果。

## 一键回归

### X 本地 AI 字幕同步

`scripts/run-x-subtitle-sync-test.cjs` 使用生产扩展、真实 Whisper Tiny/Base 与确定性语音验证完整识别。它要求 macOS 的 `say`（Samantha 声音）、`/opt/homebrew/bin/ffmpeg`、`ffprobe`、独立 Playwright runtime 和 focus-safe helper；首次运行会下载所选模型。

```bash
pnpm test:video:x-fixture -- \
  --extension-dir .output/chrome-mv3 \
  --playwright-root <path> \
  --focus-safe-helper <path> \
  --artifacts-dir /private/tmp/fluentread-x-subtitle-proof \
  --long true --native-track true
```

使用 `--early-hls true --background-generation true --owner-handoff true --display-mode bilingual` 验证首屏早到清单、切换标签页后继续生成、完成后另一标签页可用和慢翻译；`--media-source direct` 验证独立媒体解码。双语测试仅替换翻译供应商为固定延迟响应，不替换本地音频识别。

报告分别记录模型准备与字幕生成耗时，校验完整句子、SRT 非重叠区间、相对独立音频停顿检测的 250 ms 边界预算、暂停/seek/停止和原生字幕恢复。测试窗口保持正常尺寸、位于第二块屏幕且不抢前台。该语音夹具证明指定音轨的行为，不能代替真实 X 网络、任意口音或背景音乐的识别验证。

### 完整流水线

本地确定性回归负责测试审计、WXT prepare、类型检查、严格覆盖率、四组 Vitest、Chrome/Firefox/userscript 构建及文档构建：

```bash
pnpm test:regression:all
pnpm test:regression:all -- --browser \
  --playwright-root <path> \
  --browser-path <path> \
  --focus-safe-helper <path>
```

真实浏览器层必须使用临时 profile、屏幕外正常尺寸窗口和 focus-safe helper；不会连接用户日常 profile，也不会静默退化成抢焦点的普通 Playwright 启动。`--browser` 同时覆盖设置中心的导航、配置管理、响应式与控制台错误回归；真实网络站点矩阵还需要单独的网络许可。具体参数以 `node scripts/testing/run-full-regression.mjs --help` 为准。

CI 或本地报告必须分别说明：确定性回归、隔离浏览器回归、真实网络矩阵是否执行。任何未执行层都不能写成“全量回归已通过”。
