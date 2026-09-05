# 图片与圈选翻译产品设计及调研

调研日期：2026-09-05。圈选翻译定位为“马上读懂这一小块”，图片翻译定位为“读完整张图并保留布局”。入口、设置与输出独立，共享语言包、OCR、限流、取消及翻译服务。

## 竞品事实与边界

[沉浸式翻译圈选页](https://immersivetranslate.com/zh-Hans/area-translation/)展示按住 Z 圈选、松开识别翻译、原地原译文卡片以及 GPT-4.1 mini/OpenAI 演示。[官方更新日志](https://immersivetranslate.com/zh-Hans/docs/CHANGELOG/)在 2026-07-06 的 1.31.2 中加入图片划词翻译。

公开资料没有明确圈选只支持 AI，也没有披露它究竟通过多模态直接识别翻译，还是先 OCR 再调用语言模型。演示模型和会员标记不能证明内部链路。与此不同，[图片产品页](https://immersivetranslate.com/zh-Hans/image/)明确描述 OCR、背景修补和译文覆盖。

[微软 Translate API](https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/v3/translate)接受文本输入，因此本地 OCR 后接微软或免费翻译在技术上成立。不能笼统把“免费”当作低质量原因：识别、断句、翻译引擎和版面均可能造成错误。

本轮对 read-frog/src、kiss-translator/src 的定向只读检索没有找到对应截图/OCR实现，没有复制参考代码或修改参考项目。

## 三条路线

| 路线 | 能力 | 限制 | 本轮决定 |
| --- | --- | --- | --- |
| 本地 OCR + 文本翻译 | 使用现有微软、免费及其他服务 | 识别错误会传递到译文 | 默认处理方式，整块请求 |
| 本地 OCR + 文本 AI | 根据整个选区整理断行、纠正明确文字错误并翻译 | 不能看图找回漏字，可能错误校对 | 可选 AI 文本增强，保留原始识别文和独立校对文 |
| 裁剪图 + 视觉 AI | 利用字形与画面语境识别、翻译 | 模型需要明确图片能力，有成本、遗漏及幻觉风险 | 研究后的后续能力，未以文本 AI 冒充视觉识别 |

本轮选用前两条路线，因为它们完整复用现有供应商、凭据、限流和取消机制，并保持截图在设备上。视觉模式需要新增可验证的图片输入能力登记、各供应商的图像传输、用户可见的图像发送说明和独立评测，不能只根据厂商名字或模型名称含 vision 判断能力。

[Gemini 图片理解](https://ai.google.dev/gemini-api/docs/image-understanding)与[Claude 视觉文档](https://platform.claude.com/docs/en/build-with-claude/vision)支持图像尺寸、分辨率和上下文影响理解的判断，但并不证明视觉模型在所有 OCR 场景更准。[SSR 研究](https://arxiv.org/abs/2507.08309)可用于理解原文识别与翻译的联合任务；其训练实验不能视为普通提示词的同等效果保证。

## 实现选择

- 圈选后台在识别前冻结服务、模型、源/目标语言、提示词及术语配置；进行中的请求不随设置修改漂移。
- Offscreen 只负责裁剪与识别，圈选后台随后整块翻译。图片翻译原有修补、绘制与恢复路径保留。
- AI 使用专用结构化约定，分别返回 correctedText 与 translatedText；拒绝缺失字段、空字段、结构不合约定或异常膨胀结果，原始 OCR 文本始终可查看。结构校验不能证明译文没有语义遗漏。屏幕文字是待处理数据，不能覆盖任务指令。
- Shift+Z 按一次进入拖拽；显示实际识别/翻译阶段；取消、重新圈选和卸载使旧请求失效。重试使用同一截图，成功后释放整屏输入，仅保留裁剪原图。
- Popup 的图片、圈选和划词卡片分别控制各自功能；旧配置的栏目顺序通过登记表追加圈选卡。OCR 管理只挂载当前设置分区，避免重复实例和 ID。

截图还需要遵守 [Chrome tabs 官方限制](https://developer.chrome.com/docs/extensions/reference/api/tabs#property-MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND)：captureVisibleTab 每秒最多两次。连续圈选实测触发限额后，后台增加统一串行队列和至少 600ms 的截图启动间隔，排队结束再次核对活动标签页；前台隐藏或关闭后不消费旧截图。

## OCR 与性能依据

[Tesseract.js 性能指南](https://github.com/naptha/tesseract.js/blob/master/docs/performance.md)建议复用 Worker、保留语言缓存并限制并发；[识别质量指南](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html)说明小区域的分割方式、边框、透明度、倾斜和对比度会影响识别。

圈选使用独立 OCR profile 和缓存身份，小选区在像素预算内最多放大两倍并增加白边；稀疏识别没有有效行时仅追加一次单块识别，不对每次请求并发运行多套 OCR。边框和缩放严格映回原图坐标。语言切换、分割参数切换与识别在同一 Worker 队列内串行，排队请求取消不会终止其他正在执行的识别。解码超时和错误路径也释放图片与 Canvas。

这些是明确的实现改进，并不是总体识别准确率提升的统计证明。预期性能收益来自省去圈选不需要的图像修补/重绘，以及将多个孤立文本调用合成完整选区请求；尚未进行同语料的旧版对照耗时评测，具体耗时受语言包、设备、图像和服务影响。

## 验证方法与后续评测

确定性测试覆盖配置迁移、服务能力、源/译文结构、快照隔离、取消及延迟响应、OCR缓存与坐标映射、解码/编码失败释放和 Worker 状态恢复。生产浏览器脚本使用真实 screenshot/OCR 和可检查的 Google/OpenAI 测试传输，验证请求是否完整、是否发送图像、是否允许失败重试。

浏览器使用临时 Edge profile 与防抢焦点 helper，证据报告分别记录语言准备、首次圈选与重试耗时，并对清晰英文、小字、暗底截图计算字符错误率。测试传输只能证明请求/响应协议与产品交互，不代表真实外部 AI 模型的翻译或校对水平。

后续视觉能力的接受条件应使用人工标注的中/英/日/韩、竖排漫画、表格、多栏、模糊、无文字及数字单位样本，比较字符错误率、遗漏、阅读顺序、数字保留、幻觉、冷/热 p50/p95 和成本。只有同一语料上的实测才能支持“准确率提升”宣传。

## 本轮验证结果

| 范围 | 结果 |
| --- | --- |
| 严格覆盖率 | 174 个测试文件、3177 个测试通过；纳入门禁的模块四维均 100%，包含新增圈选文本服务和 OCR Runtime |
| 架构与回归 | 架构 25 文件 / 775 例、回归 13 文件 / 297 例通过；测试审计通过 |
| 类型及产物 | TypeScript/Vue、Chrome、Firefox、userscript、userscript verifier、manifest 检查和文档构建通过 |
| 圈选真实浏览器 | 最终生产 Chrome 产物在隔离 Edge 中通过 19 项流程断言，零页面错误；包括切标签取消、重试、深色窄屏、主题和动画实时同步 |
| 图片真实浏览器 | 16 项原有图片流程断言通过，零页面错误 |
| Popup 与设置 | 完整回归 50 项断言通过，零控制台错误；独立入口、迁移、持久化、4 种宽度及深浅主题均验证 |

同一三行英文的 26px 清晰、14px 小字、20px 暗底三个截图样本，真实 Tesseract 字符错误率均为 0。圈选最终单次运行语言准备 4500ms、首次圈选 968ms、同截图重试 119ms；首次结果包含测试传输人为设置的 300ms 延迟，重试命中缓存。这不是外部服务测速，也不是总体 OCR 准确率或相对旧版提升的统计结论。

浏览器均使用本次自动创建的临时 profile，`macos-background-cdp`、`launchservices-no-foreground` 和副屏正常窗口，未抢占前台，完成后清理。圈选测试以 Playwright `connectOverCDP({noDefaults: true})` 保留真实标签可见性，实际断言 `visible → hidden`；未使用焦点模拟掩盖标签状态。真实浏览器验证仅覆盖 Edge 加载 Chrome 产物，Firefox 和 userscript 的结论仅限构建与静态验证。剪贴板写入没有在本轮浏览器自动化中执行。

本轮验证发现并修复了 Vue ref 对象比较导致首次结果丢失、连续截图限额、普通配置对象误用 Vue watch，以及共享样式污染深色圈选全屏层等问题。圈选现在使用配置仓库订阅和独立主题类，截图时外围保持透明。

本地证据目录：`/private/tmp/fluentread-area-flow-20260905-final-pass`、`/private/tmp/fluentread-area-image-regression-20260905`、`/private/tmp/fluentread-area-settings-ui-20260905/run4`。目录为临时验证产物，长期保留的是本报告的范围与结果摘要。
