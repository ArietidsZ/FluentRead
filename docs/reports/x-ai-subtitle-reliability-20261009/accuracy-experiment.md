# X AI 字幕：decoder q8 准确率实验准备记录

日期：2026-10-09。结论：固定 q4 encoder、仅切换 q4/q8 decoder 的 A/B 产物、公开权重与固定样本已经准备；唯一一次运行在浏览器启动层超时，尚未进入原生 GPU 检查或模型推理。**没有这项实验的转写、CER、速度或内存结果，生产模型与默认配置未改变。**

## 已完成的生产对照

[生产 Worker 普通话对照](./browser-evidence.md#普通话原音)使用同 SHA 的三条 macOS 合成普通话，Tiny/Base 分别测 `zh-Hans` 与 `auto`。旧、新 Worker 的输出逐字相同；修复可靠性和交互不能据此宣称提升了字词准确率。原始 CER 包含简繁差异，不能当作纯内容错字率。

原始记录：[基线 Tiny 已完成子运行](./baseline-tiny-asr/report.json)、[基线 Base](./baseline-base-asr/report.json)、[fixed Tiny](./fixed-tiny-asr/report.json)、[fixed Base](./fixed-base-asr/report.json)。Tiny 基线的整轮因后续准备 Base 时关闭上下文而失败，只有已完成的 Tiny 子运行用于文本对照。样本与 PCM 摘要见 [samples/manifest.json](./samples/manifest.json)。

## A/B 控制与版本

| 实验臂 | encoder_model | decoder_model_merged | Worker 诊断 dtype |
| --- | --- | --- | --- |
| A | q4 | q4 | `encoder:q4,decoder:q4` |
| B | q4 | q8 | `encoder:q4,decoder:q8` |

锁定运行库为 `@huggingface/transformers 3.8.1` 和 `onnxruntime-web 1.23.2`。Transformers.js 的 [3.8.1 getSession 源码](https://github.com/huggingface/transformers.js/blob/3.8.1/src/models.js#L193-L202)按 session 文件名读取 `dtype` 对象；[同版本 dtype 映射](https://github.com/huggingface/transformers.js/blob/3.8.1/src/utils/dtypes.js#L49-L64)将 q8 对应到 `_quantized.onnx`。这是参数支持的源码证据，不是本实验组合已成功运行的证据。

两臂都设置 `session_options.extra.optimization.disable_specified_optimizers = 'QDQSelectorActionTransformer'`，避免把优化器差异混入 decoder 精度对照。两臂使用同一份现有 encoder/config 缓存、预处理、固定 PCM、`zh-Hans`、token 预算、停止条件及运行库；A 的实际输出还需先与生产 q4 对照核对。没有把 Python Whisper 的参数直接套到浏览器实现。

**待核对的来源控制：**当前 q4 encoder/config/decoder 来自已有 Modelscope 缓存，新 q8 decoder 来自下表固定 HF commit。尚未比较该 HF commit 的 q4 encoder/config/decoder 与已有 Modelscope 文件是否逐字节一致，也未确认两种导出属于同一模型快照。复跑前需完成摘要核对；在此之前，即使输出不同，也不能把 decoder 的差异唯一归因为量化精度。

计划必须核对两臂实际使用相同原生 WebGPU adapter/vendor，禁止软件 GPU 或 CPU 恢复结果进入 GPU 对比。纯 Worker 直接返回混合 dtype 诊断，不把 B 标为“全 q8”。实验不通过 offscreen 的自动 CPU 回退；模型、配置和样本由带 SHA 的本地缓存提供，浏览器中的公网请求被阻断。

## 公开权重与摘要

仅新增两个 decoder 文件，合计 **84,412,556 bytes**。固定 Hugging Face commit 下载；导入时沿用生产登记的 Modelscope Cache Storage key。源 URL、缓存 key、完整 SHA 和 A/B Worker 摘要见 [小型实验清单](./accuracy-experiment/manifest.json)。权重二进制未加入仓库。

| 模型 | 固定 HF commit | `decoder_model_merged_quantized.onnx` bytes | SHA-256 |
| --- | --- | --- | --- |
| Tiny | `ff4177021cc41f7db950912b73ea4fdf7d01d8e7` | 30,719,241 | `25e807a962b6349356d0ea5d0dfe530b7e5bf0e2a484aeca0359d03143faddd3` |
| Base | `1846881b6b3a3024392c1eea3ad983695bc23925` | 53,693,315 | `fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b` |

公开文件来源：[Tiny 固定版本](https://huggingface.co/onnx-community/whisper-tiny/blob/ff4177021cc41f7db950912b73ea4fdf7d01d8e7/onnx/decoder_model_merged_quantized.onnx)、[Base 固定版本](https://huggingface.co/onnx-community/whisper-base/blob/1846881b6b3a3024392c1eea3ad983695bc23925/onnx/decoder_model_merged_quantized.onnx)。原 q4 文件继续使用生产对照的相同摘要。

## 唯一运行与限制

显式启动方式为 `launchMode=headless-worker-benchmark`，使用新建临时 profile、localhost 静态资源和纯 Dedicated Worker。这不是扩展 UI 或 Service Worker 验收，不接用户日常浏览器，也不激活前台。

命令明确以 `require_escalated` 执行。Chrome `launchPersistentContext` 在 30,000 ms 超时，没有返回 context；原生 GPU 检查和 A/B 两臂均未开始。保留的 [精简启动报告](./accuracy-experiment/launch-report.json)记录 `checks=[]`、`arms=[]`，没有完整环境、启动参数或 stack。

日志给出的本次 PID 随后精确只读查询已不存在；没有 CDP ownership 或 guarded-close 收据，临时 profile 按约定保留，未猜测 PID 发送信号。未追加浏览器实例。不能由这一启动失败判断 q8 精度或兼容性，也尚未确定启动失败原因。

## 本机复跑指针

以下内容只在本机 `/private/tmp` 保存；未验证的 harness 与 staged Worker 不进入生产仓库，也不作为已经完成的验收。临时目录被清理后需要重新准备。

| 内容 | 本机位置 |
| --- | --- |
| 纯 Worker headless harness | `/private/tmp/fluentread-x-ai-decoder-q8-experiment-20261009/run-headless-worker-ab.cjs` |
| A staged extension assets | `/private/tmp/fluentread-x-ai-decoder-q8-experiment-20261009/encoder-q4-decoder-q4/chrome-mv3` |
| B staged extension assets | `/private/tmp/fluentread-x-ai-decoder-q8-experiment-20261009/encoder-q4-decoder-q8/chrome-mv3` |
| 公开 q4/q8 模型缓存 | `/private/tmp/fluentread-x-ai-decoder-q8-model-cache-20261009` |
| 完整产物与文件摘要 | `/private/tmp/fluentread-x-ai-decoder-q8-experiment-20261009/artifact-manifest.json` |
| 原始启动失败报告 | `/private/tmp/fluentread-x-ai-decoder-q8-experiment-20261009/headless-worker-ab/report.json` |

harness 已做 Node 语法检查，但没有完成浏览器推理验证。当前准备版移除了 Playwright 默认的 `--enable-unsafe-swiftshader`；它与唯一已尝试版的 SHA 不同，且尚未复跑。两份摘要在小型清单与启动报告中分别记录，不能把准备版当成已执行版。

在启动限制恢复后，通过工作区依赖工具解析 Node/Playwright 路径，先核对清单中的权重、样本和 Worker SHA，再用对应 Node 执行该临时 harness。它仍须通过相同原生 adapter、实际 backend/dtype 和 CPU 回退门禁，才可比较结果；启动失败立即保留证据并停止。

下一阶段最值得做的是固定用户实际失败视频中的授权真人音频和人工转写，覆盖口音、背景音乐及句尾，先完成 decoder-only q8 对照，再在同一语料上试 [Small q4](https://huggingface.co/onnx-community/whisper-small/tree/main/onnx)，按内容错字、漏句、首句等待和峰值内存决定是否引入，保持浏览器本地推理且不增加服务依赖。
