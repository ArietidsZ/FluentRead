# 漫画 GPU 性能专项验证

任务分支：`codex/manga-pipeline-performance-20261004`。任务 worktree：`/Users/thinkstu/Desktop/copy/FluentRead-manga-pipeline-performance-20261004`。

来源 PR #783 精确 head：`22aa69496490a05d5f7907930992ec6c3fca82c8`；基础 `origin/main`：`5ed16bc6c081587622c86563b4a75fc452c697fb`。本任务在独立分支本地合入来源历史，新 PR 包含其静默阅读及滚动交接改动，不更新、关闭或合并来源 PR。没有直接推送 main。

交付前同步主分支 `219439e89de9463cfbaf6f008061bcd37c64653d`，保留本轮期间合入的官网阅读布局与朗读功能；自动合并测试目录。该次主分支更新只涉及官网、验证脚本及测试，没有改变已测的漫画生产运行时代码。性能实现提交：`d74ff61883f5351d14b2c4ff6f94453a3144c1de`。

## 确定性验证

- 15 个受影响测试文件、334 个用例通过：OCR、修补、GPU 探测、GPU 故障回退、异步编码、Offscreen、图片读取/恢复/运行时、模型导入、无损画面及漫画会话。
- WASM 诊断专项另 12 个用例通过；合计 16 文件、346 用例。只运行本任务直接影响范围，没有运行全量回归。
- 严格覆盖率包含 `mangaReader`、`mangaSession`、`mangaOcr`、`mangaInpainting`、`mangaEncoding`、`mangaGpu`、`mangaSessionFallback`、`offscreenRuntime` 和 `shared/onnx/webgpu`；statements / branches / functions / lines 全部 100%，没有新增忽略。
- `pnpm test:audit`、`pnpm compile`、Chrome MV3 与 Firefox MV2 生产构建、双浏览器 manifest 验证通过；两种构建未压缩总大小均为 107.18 MB。模型不随本轮增加。
- userscript 构建与 verifier、文档构建与链接校验通过。首次 userscript 构建发现合并后语言资源缺失，补齐五个生成文件，并将资源固定到 `abaa7c86b49dd8f2b8425437e3c980c8947c17f8` 后通过；没有更改模型或升级依赖。
- 架构专项五文件 800 项检查中 797 项通过、3 项失败。修改前集成提交 `6d4b798d6ae045daad8151f615d17c3ce416248e` 的独立代码快照复现了同样三项：三个既有文档工具未登记验证归属，10 个既有 popup/share-card/i18n 等模块未进入严格覆盖率清单，以及 `src/app/content/runtime.ts` 已有 281 行超过 277 行上限。本轮没有放宽这些检查，也没有增加失败项；新增漫画模块已登记并严格覆盖。基线在临时快照执行 WXT prepare 后运行同样检查，不修改来源 worktree。

## 性能复现

脚本：`scripts/testing/run-manga-translation-test.cjs`。显式性能参数 `--pipeline-inputs <两张原图路径，逗号分隔> --pipeline-rounds 3 --prefetch-pages 0`；Chrome 154 使用 `--extension-debugging` 加载本任务生产扩展。每轮当前图是相同原始 data URL，确认未被夹具的异步 Blob 回调替换；实际点击开启、等待译图接管、核对原图仍是同一资源，然后恢复。

模型准备：`--preload-models-dir /private/tmp/fluentread-manga-ocr-probe/models --blocked-all-model-sources`。设置页导入四个真实文件，CacheStorage 中核对字节数和 SHA-256，两个远端来源都阻断，模型下载请求为 0。ORT 公共会话包装记录每次初始化及推理时间、输入形状、GPUQueue 提交与 Canvas 编码方式；插桩只作用于自有临时扩展 Offscreen，不进入产品代码。

相同浏览器与硬件基线目录：`artifacts/manga-pipeline-performance-20261004/chrome-baseline`。最终性能及逐像素比较摘要：`artifacts/manga-pipeline-performance-20261004/delivery-summary.json`。两个样本每版各三轮；连续两轮取中位数。识别与修补都真实运行，受控文字服务首次请求延迟 250 毫秒并返回固定译文，缓存设置一致，不能把此结果当作真实供应商速度或译文质量证据。

GPU 提交基线六轮均为 0；最终复杂页 1090/314/314，多对白页 566/566/566。前后六批 OCR 文字一致，尺寸均为 784×1145，alpha 相同；复杂页只有 13 像素单色阶差异，多对白页完全一致。没有改变模型、量化、置信度、输入大小或文字蒙版边界。

## 浏览器验证范围

所有浏览器使用临时 profile、`macos-background-cdp`、`launchservices-no-foreground`、第二屏正常可见窗口 `background-visible-no-focus`，`browserFrontmost=false`；结束删除 profile。不连接日常浏览器，不调用前台聚焦。

CPU 兼容专项使用实际 Edge 131，缺少运行时所需 `GPUDevice.adapterInfo`，直接使用 WASM。模型已准备且来源全部阻断，验证当前页、关闭缓存、第二页处理时返页、重复往返、暂停恢复、迟到结果、来源失效、换章和保留窗口以外缓存恢复。

实页限于 MANGA Plus `1024050` 与 Pixiv `150354216#1`，使用在线 Google 文字服务。Pixiv 重测发现并修复了“预译关闭、下页离屏完成后被释放”导致的重复识别；故障前相同原图指纹重复三次，修复后保持原来的两次请求。网页的广告脚本还会触发弃用 API 和匿名 SSP 错误；通过源 URL 或 CDP 默认网页执行上下文归属记录为宿主错误。扩展错误和无法归属的错误仍使测试失败，所有原始错误都保留在本机报告，没有修改或压制网站脚本。

最终浏览器专项 26 项行为检查通过，另有 6 轮性能样本通过：

| 目录 | 结果 | 有效结果返页测量 |
| --- | --- | --- |
| `delivery-final-gpu` | 两张相同原图各三轮；真实 GPU 提交、模型推理、编码及译图显示 | 性能见[摘要 JSON](./summary.json) |
| `delivery-prefetch-verified` | 7 项：当前加后三张、第五/六张不处理、准备页显示、暂停与设置保存 | 不把已准备页当首次处理测量 |
| `delivery-cpu-scroll-verified` | 实际旧 Edge CPU 路径 9 项；无下载与 CPU 厂商告警噪声 | 10 次，0.9–16.5 毫秒 |
| `delivery-mangaplus-verified` | 实际 MANGA Plus / Google 5 项；往返没有新增识别 | 8 次，4.7–22.7 毫秒 |
| `delivery-pixiv-verified` | 实际 Pixiv / Google 5 项；修复后总共两次识别 | 8 次，6.1–344.3 毫秒 |

返页是在页面内从滚动到原图透明、译图接管的首帧，再核对实际译图位置。Pixiv 仍有网站脚本与渲染波动，未单独归因，也没有设置跨设备延迟 SLA。两个实页首张本轮分别约 7.8 / 13.2 秒，含模型、识别和在线文字服务，不能与受控暖启动数字混用。全部最终记录的模型下载请求为 0、扩展和未知页面错误为空，测试浏览器未在前台，临时 profile 已删除。Pixiv 保留三条归属宿主的错误（含匿名广告脚本），没有把它们描述为扩展错误。

初次 Pixiv GPU 检查 `delivery-live-pixiv` 和 `pixiv-diagnosis` 在无新增识别断言失败；`pixiv-retention-fixed` 的五项行为通过，但未知匿名页面错误仍使总状态失败。继续追踪并通过 CDP 默认网页执行上下文归属后，最终通过记录为 `delivery-pixiv-verified`。完整本机目录：`/Users/thinkstu/Desktop/copy/artifacts/manga-pipeline-performance-20261004/`。探索阶段错误和初测保留，不把诊断运行计为最终通过证据。

## 未验证范围

真实 Firefox、Windows/Linux、移动端、低端设备、不同显卡、各国网络和全部漫画网站未覆盖。Firefox 与 userscript 的构建只能证明相应产物可构建，不能证明真实 Firefox WebGPU 运行。两张英文性能样本不构成所有语种识别率或翻译质量保证；Pixiv 实页功能验证也不替代人工日文译文验收。
