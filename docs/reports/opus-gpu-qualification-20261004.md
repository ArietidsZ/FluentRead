# OPUS WebGPU 配置验证（2026-10-04）

## 决策与边界

保留所有旧模型、Q8 CPU 语言包和默认选择。新增两个**手动选择**的 GPU 配置：

- 中英双向 FP16：459,599,731 字节，使用现有 Transformers.js 4.2.0 别名及 ORT 1.26.0-dev.20260416-b7804b056c 原生 WebGPU；需要硬件 WebGPU 和 shader-f16
- 日语→英语 FP32：434,202,464 字节，使用原有 Transformers.js 3.8.1 / ORT 1.22.0-dev.20250409-89f8206ba4 JSEP；仅此方向，不把原英→日模型包装为已验证 GPU 功能

全部沿用既有 Xenova 仓库、commit、tokenizer 和配置文件。原 Q8 下载分别为约239MB、214MB，新的配置**没有在下载量上支配旧模型**。运行内存标注仍是估算；本报告没有物理 GPU 延迟、p95 或真实浏览器全页性能结论。

## 实际执行证据

运行平台为 Node 24、Dawn `webgpu` 0.6.2、Debian Mesa Vulkan 25.0.7 的 Lavapipe 软件适配器。适配器真实支持 shader-f16，最大 storage binding 为128MiB。未伪造 GPU 能力；派发计数包装器始终转发原生调用。产品正常探测会拒绝软件适配器，因此这不是用户设备的性能验收。

使用未修改的浏览器 Transformers 分发文件，激活其 Worker 串行初始化路径。模型完全离线读取；网络请求被拒绝。日志记录了 encoder、首次 decoder、`use_cache_branch=true` 的后续 decoder 和真实 GPU dispatch。

- 中英 FP16 全部7条短样例有有效结果；三条英文→中文与两条中文→英文结果逐字匹配 Q8，另两条仅有措辞差异
- 日语→英语 FP32 全部3条结果逐字匹配 Q8，3.8和4.2运行时均如此；因此选择原3.8运行时，避免不必要的升级
- 接受的10条样例均非空，三条数字样例的所有指定数字均保留；否定句保持否定和完成更新前的限制。样例规模很小，不等于一般翻译质量不回退的证明
- 中英 FP16 GPU buffer 峰值422,261,680字节；日英 FP32在原运行时峰值840,135,488字节。3.8 session dispose 后仍有214,536,080字节池化buffer未销毁；原有30秒空闲 Worker 终止机制继续作为最终释放边界。4.2释放后为0
- 软件适配器明显慢于 WASM，不能据此推断物理 GPU 快慢，也没有更改默认选择

独立 CPU 归属检查对重复节点名加上所在 graph / If 分支名，仅用于诊断。删除 node.name 后的标准化 protobuf 哈希完全一致，权重、边、属性均未修改。中文 FP16 与日英 FP32分别核对555个 CPU 节点，全部唯一解析：540个形状/常量、3个 token ID 重排、12个掩码/控制路径。611个可达 tensor 常量均为非浮点标量，没有学习权重、隐藏状态或 KV 值运算被归为 CPU。推理仍使用原始固定哈希文件。

因此配置仅登记 WebGPU provider，允许已验证的主机元数据节点；并不声称整个浏览器程序没有 CPU 工作。严格 `disable_cpu_ep_fallback=1` 会拒绝这些合法节点，不能用于此固定图。初始化、推理或设备故障直接失败并回收 Worker，不建立 CPU 替代会话。

## 被拒绝的替代方案（实际对照）

1. 原 ORT1.22运行 Xenova FP16：merged decoder 在 CastFloat16Transformer 阶段失败。更换 onnx-community 导出及关闭优化均未修复，不新增迁移层
2. 现有4.2/ORT1.26运行相同中文 FP16：可执行且通过短样例。因此仅此配置使用已安装的新运行时及对应 asyncify资源
3. 日英 FP16：2/3样例语义严重失败，数字句丢失数字；关闭优化仍失败。两版 tokenizer 输入ID一致，不能归因于 tokenizer 版本切换
4. 相同日英 FP32 GPU：3/3匹配原 Q8。相同4.2 Q8 WASM关闭优化后也匹配；其默认QDQ优化初始化失败。没有将旧Q8迁移到新运行时
5. 英→日旧Q8和FP16均在三条日常样例上失败。按原配置尝试4 beams并去除额外重复惩罚仍没有改善。官方是单目标jap，未要求语言前缀，词表也没有语言标记
6. 英→日 tokenizer 存在另一个独立导出缺陷：unk_id=2指向逗号，而 `<unk>` 为1。精确修正后日期句变了，但仍未保留数字；另外两句输入ID与原生 SentencePiece一致而仍翻译错误。此修正不能被称作英→日质量修复，相关候选单独处理

没有引入自定义 GPU 内核、beam 自实现、句子打包或新的并行调度。保持原解码参数和分句边界；本次 pipeline质量样例不代替完整扩展的取消、格式、占位符、长文本和全页验收。

## 缓存与生命周期

同一仓库的Q8与GPU配置仅选择各自精度的ONNX文件，共享固定 tokenizer/config。删除配置只删除其独占文件；已缓存、排队、下载中、暂停或失败的同仓库配置仍保留共享文件。删除先开始时，新下载等待该共享文件删除结束。共享元数据本身不把另一精度配置误标为部分下载。测试覆盖两个删除顺序、使用中兄弟配置、部分失败、重新安装及双向删除/下载竞争。

## 复现和验收状态

- 输入和参考：`tests/fixtures/local-translation/opus-quality.json`
- 完整短样例输出、运行时、时间和buffer指标：`tests/fixtures/local-translation/opus-qualification-results.json`
- 离线诊断：`scripts/testing/run-opus-gpu-audit.mjs ASSETS REPO SOURCE TARGET [webgpu|wasm] [fp16|fp32|q8] [Dawn模块绝对路径]`
- `OPUS_TRANSFORMERS=4.2.0`选择已安装别名；`OPUS_OPTIMIZATION=disabled`、`OPUS_STRICT_GPU=1`用于失败对照；`OPUS_INIT_ONLY=1`仅初始化。环境必须使用相应精确版本的MJS/WASM，不能混搭
- 实际桌面浏览器、扩展端到端、硬件速度/显存与大规模语义质量仍待验收。本次不据此宣布所有旧模型被支配

## 最终编译 Worker 的离线复核

2026-10-04 对 `68c6cafe` 构建产物（集成树 `fb6c0092` 内容相同）执行了真实动态 chunk、固定模型缓存和打包 MJS/WASM 的组合复核。记录位于 `tests/fixtures/local-translation/opus-final-worker-results.json`，包含入口、依赖、资源和原始日志哈希。这次执行的是编译后的 `localTranslationWorker.js`，不是早期直接调用 Transformers 的质量 harness。

Node EventTarget/CacheStorage 适配层替代浏览器传输；没有 document/window 补丁。固定文件以流式 SHA-256 验证后按产品的4MiB缓存块读取。网络全部拒绝，任何未批准的缓存/传输尝试即使被库吞掉也使测试失败。软件适配器被未修改的产品检测正确拒绝。另一个明确获准的测试只放宽软件适配器入场条件，不修改真实 feature、limit、模型或 kernel。

- 未修改路径：Q8 `Save changes` → `保存更改`；FP16/FP32都在模型加载前返回GPU不可用；英→日精确版本 tokenizer读取确认 `<unk>` ID为1，但日期句质量仍失败
- 软件GPU补充：英→中数字句6,592次派发；同配置切换到中→英7,042次派发，12和3.50都保留；dispose后观测到的GPU buffer字节为0
- 独立日→英FP32进程：否定句输出 `Please don't turn off the printer until the update is complete.`，6,468次派发；dispose后保留213,968,448字节ORT池，随后进程正常退出。进程退出不等同于已测量每个GPU buffer销毁
- 三个完成的进程均无意外缓存/网络尝试、缓存miss或模型写入

发现并修复了两个实际组合缺陷：Vite页面预加载包装器访问document，现由Worker专用原生ES library构建避免；Transformers4.2通用pipeline及AutoTokenizer注册表预检丢弃revision，现直接以已验证JSON构造其公开MarianTokenizer，再调用固定版本AutoModel和原生TranslationPipeline。独立已安装库回归检查保留原注册表main路径失败证据，不把main别名到固定缓存。完整模型路径检查也确认两个中文方向的ONNX initializer均内嵌，无遗漏外部权重文件。

一个额外压力进程在同一realm先加载中文4.2、再加载日文3.8时退出137，原因未证明。保留失败日志，不删除或计为通过。产品owner在配置ID改变时终止Worker，所以正式复核按配置隔离进程；中文双向属于同一配置，仍在同一realm实际切换仓库。随后执行实际产品owner源码及依赖的独立生命周期复核：暖启动后在8次新GPU派发时AbortController取消，返回AbortError且旧进程退出；下一请求在注入旧requestId响应和迟到错误后仍正确返回保存更改；配置切换实际终止旧进程并创建日英FP32进程，输出正确否定句。三个子进程全部退出。传输由Node子进程适配，不声称浏览器调度语义或退出时逐buffer销毁均已测量。

这些结果不证明桌面浏览器CSP、原生Worker传输、物理GPU速度或大规模质量。全文件Worker的模拟边界测试按common/Q8/Hunyuan、OPUS精度和Index分别划分。Node22下43条全部通过，语句/函数/行100%、分支99.33%；额外原生V8/source-map捕获证明剩余范围[8756,8757)扣除185字符执行包装后，是生成代码[8571,8572)的一个空格，位于catch闭括号和finally关键字之间；source map将两端都映射到源文件173:49。实际catch范围执行2次。没有遗漏可执行token，但报告数值仍保留99.33%，不宣称四维100%，不添加忽略、缩小分母或改变生产逻辑。精确范围和哈希见 `tests/fixtures/local-translation/opus-worker-v8-range.json`。此前Node24的40条测试和99.3%结果保留。

## 主要来源

- [Transformers.js WebGPU 指南](https://huggingface.co/docs/transformers.js/guides/webgpu)
- [ORT WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)
- [Xenova 英中固定版本](https://huggingface.co/Xenova/opus-mt-en-zh/tree/046f55aec303cdee3e0318604406d4df20f1e8ea)
- [Xenova 中英固定版本](https://huggingface.co/Xenova/opus-mt-zh-en/tree/39d480d52a9ea3065a1f117adfe4dbc55de10e6f)
- [英日原始模型卡](https://huggingface.co/Helsinki-NLP/opus-mt-en-jap)
- [英日原始 OPUS 说明](https://github.com/Helsinki-NLP/OPUS-MT-train/tree/master/models/en-jap)
