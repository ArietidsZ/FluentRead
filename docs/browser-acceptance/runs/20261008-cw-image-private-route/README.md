# CW 图片切片：原生三态来源与专用模型

源码 **`f2381f3cdfe17ddaa33afaadcd0b88657013edd7`**，tree **`0a2a9febf4b99aee837a220e3b21e8aa819f63e9`**；此前 HEAD **`20e10b095e1b37bea62ac02e6d2a1aafadc34131`**，此前应用源码 **`866a1258c645ade6d836ec917a7e549c2028b0d4`**。只闭合图片／漫画共享的 OCR 文本翻译后台切片及译文、译图缓存，不代表隐私功能整体完成。圈选 OCR/vision 转录和必要 capability probe 的来源接线仍未完成，并保持此前未标来源的拒绝边界；字典、单词卡和其余视频/文档入口的路由与缓存审计也未完成。

原 sender/tab 在任何 await 前复制并冻结，原生 Port capability 保留；本扩展 native sender 的三态来源由既有解析器确定，异步解析后重验原连接和配置代次。图片在 OCR 前验证专用 provider/model，把内部来源与现有模型锁冻结到 ImageTransactionSnapshot 的有效配置；Offscreen 只通过现有事务恢复，不接受公开布尔、URL、service/model 自报身份。regular 保持原图片线路，即使专用配置无效也不采纳；unknown 配置了专用对时，在 OCR、译文缓存和 provider 前关闭；两字段均空保持旧线路。

OCR 文本请求沿原 feature 的批量或分段策略到实际 app/broker/provider registry/AI SDK。app 在原对象附着内部来源，保留不可枚举的取消所有权和剩余预算；broker 在缓存 key 前选择专用 provider/model，实际 SDK 使用冻结的专用 model 和 endpoint，普通缓存不能被私密模型复用。模型目录移除、部分配置、高级 body 模型冲突均在 OCR 前拒绝，不回退普通模型。原本地单图 Tesseract/Paddle、漫画 OCR 选择、语言资源检查、prompt、文本行和术语语义不改，专用路线不自动下载模型或改变 OCR 选择。

真实 normalize/save/patch/subscriber 的模型、端点、body、API-key 要求及 recovery 策略、OCR 等变更取消图片事务并拒绝迟到结果。旧 native 文档关闭后，同 URL 新 Port 使用原 registry 身份隔离，迟到输出不回写；source challenge 和图片来源授权原代码不变。provider 忽略 abort 时，现有 broker lease 保留至 provider Promise 实际 settle；单独的合成 provider Promise 案例验证这一点。实际 SDK 已响应取消后的晚到合成 fetch 不等于 provider 未 settle。取消列表在外层 registry 返回取消结果时释放引用，不等待 OCR settle；既有 provider 租约规则未改。

前端译图缓存继续采用原单调配置代次。专用服务、模型、provider 端点与目录、body、prompt、thinking 或自定义模型目录变化使位图失效；配置改回原值也不能接纳旧在途结果。原 feature handler、OCR、Port、registry、source verifier、broker、requestScheduler、配置 normalizer/store、阅读／写作、依赖锁、默认配置和发布版本未改；SHA256 在 `records/UNCHANGED-CONTRACTS.json`。

绑定 red fixture 的基线 **205 案例，184 通过、21 预期失败**：其中新图片路由 **21 案例／2 个兼容控制通过／19 预期失败**，原前台文件的 **2 个新增缓存回归失败**、182 个旧控制通过。修正并保留最初 browser-polyfill mock、保留地址 .test、按分钟归一化的 recovery 以及 SDK/fetch settle 夹具问题；后续 8 案例不冒称红测。本批最终原生图片专项 **29 案例**；十文件针对性 **354/354**。

最终完整严格检查 **9,989/9,989**，**406 文件**，零失败／跳过。既有覆盖清单 statements/lines **66,074/66,074**、functions **4,601/4,601**、branches **33,680/33,680**，四维均 **100%**；其已有归属模块 imageGlossaryContext 四维也均 **100%**。areaRuntime 和大型 content/runtime 原先不在完整覆盖归属清单，额外三模块诊断的旧未覆盖分支保留，**不将其宣称四维 100%**。没有修改 include/exclude 或覆盖率门槛，只新增专项 test 到已有矩阵和覆盖运行列表。架构 **1,379/1,379**、32 文件；最终类型、审计、Chrome/Firefox/userscript 构建、verifier 和文档构建通过。类型输入含全部 **799 src、499 tests、15 entrypoint** TS/Vue，tsconfig 与原验收档案排除未改。

冻结 **4,009** 个源码／测试／配置／文档输入，与提交所有对应 Git blob SHA256 一致；历史验收档案全未修改。绑定 **797** 个产物摘要。最终 userscript **1,954,988 bytes**，与 866a1258 的已接受产物及同机只读基线导出重构建字节一致；原 **1,955,000 bytes** 门槛不变。初版取消列表 cleanup 前的 1,954,944 bytes 产物不是最终产物，其日志与摘要保留。两个浏览器 manifest SHA256、权限、Chrome spanning、Firefox 140.0 最低版本保持一致。首次临时 baseline 构建缺少生成的 WXT tsconfig，复用同机既有生成文件后通过；不安装依赖、不创建 Codex 子任务。

全部命令、UTC、耗时、退出码、stdout/stderr、红测输入、JSON、覆盖率、源码／产物／权限／类型绑定在 records。公开副本只替换 CW 绝对路径及清除末尾空白，原始和公开 SHA256 各自保存。初版完整 gate 通过后，仅因取消列表引用释放修复和一个回归再次执行必要门禁，最终 frozen inputs 重新绑定，没有为状态报告重跑。验证限 CW 本地离线边界；无云、MII、实际搜索／模型 API、GUI、RTX5090、语言包／模型下载、安装／部署、凭据或安全设置变更、远程控制端口、额外 Codex/Work 任务、子代理、PR、合并或强推。临时 127.0.0.1 WebDAV 和 spawnSync 是既有全量测试夹具。此报告不是部署或真实浏览器/GPU 验收通过。
