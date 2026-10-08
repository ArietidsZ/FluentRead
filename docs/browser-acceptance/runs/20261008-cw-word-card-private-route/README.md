# CW 原生单词卡有效隐私路由与取消

源码 **`95a4fdf1672185bd42c98bd2930f17611b8f6bda`**，基线 **`6320ebe17e3e0cde43286c11793a74f9194d5907`**；分支 `fix/incognito-model-route-20261008`。三个生产文件为 SelectionTranslator.vue、userscript/incognitoRoute.ts、userscript/vite.config.ts。只向测试矩阵 regression 组与 strict 执行列表加入一个新测试文件；覆盖归属、阈值和 ignore 不变。**#883 未改动或回复。**

原生主译文在客户端模型能力、Thinking、retry/context 决策前解析有效 pair；辅助释义复用既有前四组、去重、目标语言清洗、失败保留原文与 2.5 秒预算，通过既有文本 client/Port/registry/handler 进入 broker。辅助保持空标题/页面上下文且关闭网页 AI context，保留实际服务的 prompt、Thinking 和词卡语义；最后预算结束也 abort SDK，避免只隐藏迟到结果。content 沿用公开配置边界，不读取敏感凭据；权威凭据校验在后台。前端只传服务/模型，不附加可信来源；native sender/getContexts 三态仍为最终授权。unknown + 已配置 pair 闭锁；regular 和 pair 全空兼容。

真实 store 保存/订阅同步撤销旧主/辅助代次，关闭、卸载、pagehide/popstate/hashchange 中止 SDK，迟到结果不更新旧词卡或模型缓存；保存保留选中源文本和 snapshot。公开配置摘要保守比较完整相关映射与独立 selection 服务，因此普通模型/其他 endpoint 变化也会取消；计数/UI 保存不取消。迟到原文 lookup 回复也不能重新打开旧词卡。词典 provider 原数据不被辅助结果修改。

**独立非模型 dictionary lookup 未迁移。** ECDICT 本地优先，未命中可向有道、Free Dictionary、Datamuse、Wiktionary REST、WiktApi 发送单词；后台现有共享原文内存缓存不作私密隔离，也未增加其页面关闭后的缓存撤销。专用模型 pair 只约束本切片模型翻译，不能据此声称所有词典访问保密。旧 typed `selectionWordLookup translateFields:true` 的模型补充仍直接 broker、缺可信来源，配置 pair 时继续 unknown 闭锁；新原生 UI 只调用原文 lookup，模型补充改走既有文本通道。非模型词典没有改成 LLM。设置页独立 probe、视频仍未纳入。

新增 **40 项**编译真实 SelectionTranslator setup，执行真实 store save/subscribe、词典 handler/lookup 缓存、文本客户端、原生 Port/registry/handler、broker/fake-indexeddb/provider/AI SDK；仅非模型词典 provider、浏览器/存储/布局及合成 HTTP 使用边界。覆盖前端 pair、prompt/Thinking、frontend/native unknown、regular/both-empty、专用凭据要求、普通/专用/endpoint 缓存、十一类保存、并发主/辅助 SDK、期限、关闭/卸载/导航及迟到词典原文。Chrome 控制无 global browser、模块 API 与实际 native sender 存在；native false 控制保留 legacy typed 路径。原 lifecycle 51 项夹具显式使用 false，保留旧适配语义；没有替代新原生控制。SFC 不属于原有数值严格覆盖，setup 控制不等于 numeric SFC 100% 或真实 GUI。

最终新控制 **40/40**；相关专项 **198/198**。首轮基线负控 **15 失败/1 通过**，通过项只查后台 SDK，而后台本来已选专用模型；补上真实前端 message pair 后，最终选定负控 **16/16 失败**，其余 **24** 是 `-t` 过滤。恢复基线只替换 SFC，之后逐字节恢复当前源码。保留首次 window/layout 夹具与 pageContext undefined/空字符串断言、取消跨消息调度的失败；也保留 userscript 检查的受限 `spawnSync git EPERM`。这不是实际外发泄漏证明。最终门禁使用当前独立审核请求，没有降低阈值、删用例或新增持久权限。

最终严格回归 **10200/10200**、**410 文件**，零失败/跳过、退出 0；S/L **66113/66113**、F **4608/4608**、B **33761/33761**，四项 **100%**。既有 wordLookupHandler/wordDictionary 严格归属也四项 100%，不外推到 SFC。架构 **1379/1379**、审计 **499 文件/6895 cases**、类型、Chrome/Firefox/userscript 构建与 verifier、文档构建均退出 0。

初次引入原生辅助函数，userscript 达 **1,956,427 bytes** 超限；增加一个原生 helper 平台 alias 与现有 unavailable 适配后，最终 **1954998 bytes**，预算 **1,955,000**、余量 **2 bytes**、比基线 **+17 bytes**；hash 是否一致 **False**。Vite 除这一个 alias 外与基线逐字节相同，预算/压缩策略未改。不同 hash 不推断成仅 rename；普通兼容依靠实际 native-false 前端控制和已有 userscript verifier。Chrome/Firefox manifest 安全字段未变。

**历史 loopback 审批缺口单列：** 原 `existing-loopback-control` UTC/命令/退出 0 与 5/5 可恢复，原始 sandbox request/审批元数据未找到；本批仅保留已确定缺口，没有重跑来证明历史或补造授权。当前完整门禁的请求、理由和工具返回见 `CURRENT-GATE-EXECUTION-METADATA.json`，仅为本轮既有临时 loopback/只读 git 测试条件独立审核，不是历史审批证明，不授予持久网络或产品权限；工具未暴露签名审批决定。

`SOURCE-BINDING.json` 将 **2913** 个门禁输入 SHA256 绑定到源码 Git blobs，核对 **797** 个产物；**19** 个原生授权/通道/注册表/依赖/构建及词典/旧 userscript 平台文件保持基线。`RAW-PUBLIC-BINDING.json` 绑定 CW 原始与脱敏记录，`SHA256SUMS` 覆盖其他全部归档文件。未使用真实 API/模型/搜索、GUI/GPU/真实下载、其他任务/子代理、新增权限或 MII/云环境。

证据目录加入后再次构建文档，`docs-build-with-evidence` 退出 0；源码和扩展/userscript 产物未改变。
