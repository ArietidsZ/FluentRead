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

“识别全部节点”的专项由 `scripts/run-all-nodes-translation-test.cjs` 负责。它在生产扩展的“高级选项 → 页面识别”中操作真实开关，关闭并重新打开设置页确认保存，再通过原有全文翻译入口验证范围。设置从下一次翻译起生效；存量会话保持自己的范围快照，恢复后再次翻译才使用新值。

本地夹具覆盖导航与页脚、工作流工具栏、项目树与标签页、展开内容与动态菜单，以及输入框、编辑器、代码和显式排除区域。断言包含默认正文范围、开启全部节点、动态新增、恢复和再次翻译，以及关闭后回到默认范围，并检查元素身份、原有点击事件和保护内容不进入翻译请求。追加 `--live-epoch --allow-network` 会在真实 Epoch 页面验证导航、图表控件和页脚；两者都使用本地确定性翻译服务，结果用于验证翻译行为，不代表真实供应商的译文质量。

```bash
node scripts/run-all-nodes-translation-test.cjs \
  --extension-dir .output/chrome-mv3 \
  --playwright-root <bundled-node-packages> \
  --focus-safe-helper <browser-translation-test-skill>/scripts/focus-safe-browser.cjs \
  --background \
  --artifacts-dir /private/tmp/fluentread-all-nodes \
  --live-epoch --allow-network
```

## 菜单栏首帧与快速关闭

Popup 必须等待配置服务完成读取或安全降级后再挂载。首个可见界面就应使用保存的皮肤、深浅主题和栏目布局；只有最终截图正确不足以证明没有闪烁。

```bash
node scripts/testing/run-popup-startup-ui-test.cjs \
  --extension-dir .output/chrome-mv3 \
  --playwright-root <path> \
  --focus-safe-helper <path> \
  --skin aurora \
  --artifacts-dir /private/tmp/fluentread-popup-startup
```

该回归在临时 Edge profile 中逐帧记录可见界面，并注入配置读取延迟来放大竞态窗口；报告同时保留正常打开的首个正确帧时间、挂载次数与 DOM 变更计数。对照旧产物时可传 `--expect-flash --skin emoji`，确认用例确实能发现旧版默认界面先绘制的问题。延迟注入数据不能当作正常启动耗时。

快速关闭用例冻结首条保存给 Popup 的回执，让第二次修改确定停留在页面内的队列，再立即关闭。报告必须证明关闭前已向后台交接包含未确认前驱的补丁链，关闭后最终选择仍被保存，且无修改关闭时普通保存与批量交接消息均为零。配置服务和后台处理器另验证前驱在途、已提交去重、字段冲突拒绝及失败后的接续边界。

加载动画另由 `scripts/testing/run-loading-motion-ui-test.cjs` 验证，使用相同的扩展目录、Playwright 与 focus-safe helper 参数。它在测试页面保留 closed ShadowRoot 句柄，检查 15 种动画的真实运动、关闭与系统减少动态效果后的静态反馈，并验证同一文档只解析一份共享样式表。采样窗口覆盖包含停顿的完整动画周期，避免把沙漏停顿误判为失效；跨文档样式隔离与旧浏览器的安全回退也有独立断言。

## 一键回归

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


## 图片翻译完整流程

```bash
node scripts/testing/run-image-translation-flow-test.cjs \
  --extension-dir .output/chrome-mv3 \
  --playwright-root <path> \
  --focus-safe-helper <path> \
  --artifacts-dir /private/tmp/fluentread-image-flow
```

使用独立临时 Edge profile 与 focus-safe helper，第二屏可见且不抢焦点。该测试执行真实 Tesseract 语言包下载与 OCR，以确定性的翻译 transport 排除服务波动，覆盖准备语言、可见阶段、完整文字、恢复和缓存重显、取消后重试、动态换图、祖先裁切与 object-fit 盒模型。报告区分首次语言准备时间和缓存重显时间，后者不应新增翻译请求；不将本地 transport 的通过视为真实翻译服务可用性证明。

图片单元与功能测试另覆盖低置信噪声、坐标回映、语言与图片缓存隔离、取消队列、有限并发保序去重、失败取消同批请求、同步消息异常清理及旧请求迟到清理。像素修补微基准只反映图像处理步骤，不代表 OCR 和网络请求的整体加速倍数。
