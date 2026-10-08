# CW 全页翻译有效隐私路由与取消

源码 **`1c2ad69d1bfd62725b927ec6350b4915fd63823e`**，基线 **`37c12c63e9797aaced0ec35a5126324f051e98b0`**；分支 `fix/incognito-model-route-20261008`。六个生产文件复用文档规则和既有原生通道；DocumentApp 和文档编排不重做。设置页独立 probe、字典单词卡、视频仍待接入。**#883 未改动或回复。**

原生全页入口在 checkConfig、modelThinking、prompt/context、文本槽分包、跨候选 AI batch 与会话缓存决策前确定有效专用服务/模型。私密机器服务的空模型也保留。前端只返回 pair，不附加可信来源；最终执行仍由未改动的 native sender/getContexts 三态、文本 Port/registry/handler 与 broker 授权。unknown + 已配置 pair 拒绝；普通上下文和 pair 全空兼容。传输 ID、来源标记和本地配置摘要不进入 provider JSON 或持久缓存身份。

实际配置保存/订阅和原生导航立即恢复原文、结束标题/正文旧会话，真实 SDK AbortSignal 中止，迟到结果不写回 DOM/缓存。保留宿主源 Text 及宿主编辑。配置摘要保守比较整个相关公开映射，因此普通模型或其他服务 endpoint 变化也结束私密代次；计数和 UI 保存保持会话。content 不读取敏感凭据，摘要仅在内存比较。

新增 **49 项**启动真实 content composition、save/subscribe、全页候选/请求/renderer/state、客户端、原生文本 Port/handler/registry、broker/provider/AI SDK 和 fake-indexeddb 缓存。只替换其他 feature、浏览器/持久存储/布局、上下文提取及合成 HTTP；没有真实 API、GUI、模型调用或下载。控制涵盖有效能力/凭据、summary 与 translation 两阶段、富文本保护槽拆批及四候选合批、普通/专用缓存与 endpoint、frontend/native unknown、十一类保存、路由/关闭/pagehide/BFCache/禁用/Port 断连和标题/正文迟到结果。Chrome 控制中模块 API 存在而 global browser 缺失，实际直连 broker/SDK/cache/DOM 仍使用有效 pair。native capability false 控制运行实际普通会话和原路由失效函数，另由 userscript 构建验证平台隔离；不等同于真实 userscript GUI 验收。

折行前专项 **404/404**；恢复六个生产文件为基线后，**17 项选定负控全部失败**，其余 32 是 `-t` 过滤。随后逐字节恢复当前源码；此负控证明旧编排/取消差异，不是实际外发泄漏证明。各中间失败保留，包含 API/配置 mock 边界、context 两阶段和 fake Date、sidebar patch 断言重复求值；没有删用例、降低阈值或扩大覆盖 ignore。

第一轮全量 **10,158/10,158** 用例通过但退出 **1**，严格覆盖有两项既有函数/五行未命中；通过实际 native-false 普通会话及原路由复位补齐。第二轮记录观察到 **10,159/10,159** 与四项 100%，但工具连接中断，无法验证 CLI 退出码及后续门禁；不称其完整通过。之后修复浏览器模块绑定并补齐三个旧测试的普通原生 API 夹具，其后首轮冻结全量 **10,160/10,160**、退出 0 与四项 100%；架构 **1,378/1,379**，全页 runtime 计 2,200 行超过既有 2,196 上限。仅等效折叠四行新增编排，未改上限；该轮原记录保留。重新冻结后的最终全量 **10160/10160**、**409 文件**，零失败/跳过，退出 **0**。S/L **66113/66113**、F **4608/4608**、B **33762/33762**，四项 **100%**。requestPrivacy 与 translationRequest 两个既有严格归属模块也四项 100%；该数字不外推到 content/app DOM glue 或真实 UI。

架构 **1379/1379**、唯一归类审计 **498 文件/6,878 cases**、类型、Chrome/Firefox/userscript 构建及 verifier、文档构建均退出 0。functional matrix 和 strict 执行列表各只增加一个新文件，原覆盖归属、阈值和 ignore 不变；16 个传输/授权/注册表/依赖/构建门禁文件保持基线。userscript **1954981 bytes**，预算 **1,955,000**，较基线 **+0 bytes**，余量 **19 bytes**；是否字节一致为 **False**，未增加预算。Chrome/Firefox manifest 权限、host、incognito、CSP 和 browser-specific security 字段不变。

历史 `existing-loopback-control` 原记录可复核 UTC、命令、目录、退出 0 及 5/5；可用本地会话记录没有匹配的原始 sandbox request/审批条目。**历史审批元数据仍不可恢复**，不得从测试成功或摘要声称已获批，也没有重跑来证明历史。`HISTORICAL-LOOPBACK-CONTEXT.json` 补充执行上下文并明确缺口。当前完整回归的实际独立请求与即时返回在 `CURRENT-GATE-EXECUTION-METADATA-fourth.json`，未暴露签名审批决定；它不替代历史审批，不授权持久网络或产品权限变更。

`SOURCE-BINDING.json` 将 **2912** 个冻结输入的 SHA256 绑定到本源码 Git blobs，另核对 **797** 个构建产物。`RAW-PUBLIC-BINDING.json` 对应 CW 原始记录和脱敏公开记录；`SHA256SUMS` 覆盖本目录其他全部文件。未启动额外任务/子代理、模型或搜索 API、GUI、GPU、真实下载、安装/权限修改、远程控制端口或 MII/云执行。

证据目录加入后再次构建文档，`docs-build-with-evidence` 退出 0；源码和扩展/userscript 产物未改变。
