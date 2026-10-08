# CW 圈选翻译的原生隐私路由与必要 vision/probe

源码 **`14812674bcbcf0b06dbcde0ecb1c8b4c365d44b3`**，基线 **`3714c1fb1fed58d53fd2ce3ec42943bbb7853a3a`**；同一独立分支 `fix/incognito-model-route-20261008`。本批只扩展圈选/区域翻译及其必要的 vision/probe，生产改动三个文件；沿用原生可信来源三态、ImageTransactionSnapshot、单个 operation registry、既有 owner/Port/Offscreen 授权与 deadline。**operationRegistry 源码、测试矩阵、原覆盖率归属/阈值/ignore、依赖和构建预算均未改。#883 未改动或回复。**

区域请求现在在 registry 的既有准备阶段等待配置与原生来源，再封入完整冻结配置；专用 service/model 同时成为 area 与 image 的有效路由，发生在任何能力身份、能力缓存、probe、vision 或 OCR 文本翻译之前。areaRuntime 将同一可信来源标记恢复到已有翻译 request 上，保留不可枚举的取消与时间预算描述符；visionProbe 在原生平台 guard 内转交冻结来源。配置了专用二元组时 unknown 来源、非法路由和不兼容 custom body 均在 probe、OCR、翻译缓存与 SDK 前失败；regular 与二元组全空继续兼容。保存专用模型/endpoint 或区域设置通过实际配置订阅取消在途操作，迟到输出不能返回或写入缓存。

离线集成测试走实际 background handler → native session/server/client/registry → translation broker → provider → AI SDK；边界仅模拟 Config/vision 持久层、浏览器原生 sender/getContexts、Offscreen OCR/crop、usage 和返回合成 HTTP 的 runtimeFetch。覆盖 private unknown 模型的 probe→vision→text、有效模型/endpoint/能力缓存身份、普通缓存隔离与专用缓存复用、手动能力 true/false、显式不支持与 unknown 的 OCR 回退、鉴权/网络错误、未知来源及伪造前端字段、准备 deadline、同轮取消与真实 unhandledRejection、断连和同 URL replacement owner。probe/vision/text 各阶段分别保存模型和 endpoint，以实际 SDK AbortSignal 与迟到结果验证取消；另以不触发 save 的内存变化独立证明冻结快照。旧的区域无标记负控更新为已授权 Offscreen 子请求恢复专用来源，授权边界未放宽。

基线负控只选新 area 用例：**23 项，1 通过/22 失败**；JSON 的另 **30 pending** 是 `-t` 过滤的原 image 用例，非验收跳过。基线暴露先选普通能力路径、后由 broker 拒绝缺失可信来源的行为；不是实际网络泄漏的证明。初次 green **52/53**，唯一失败为测试使用普通保存模型计算能力身份，已改为有效冻结 pair。后续专项 **105/105**、扩大专项 **267/267**，均保留各轮记录与边界；这些早期数字不冒充最终源码全量结果。

最终完整严格检查 **10,058/10,058**、**407 测试文件**、零失败/跳过，退出码 **0**：statements/lines **66,090/66,090**、functions **4,606/4,606**、branches **33,691/33,691**，四项 **100%**。第一次全量虽 **10,057/10,057**，因旧 registry 的第四参数同步 snapshot callback 未命中而退出 **1**；补上真实 legacy API 同对象、封入/撤销控制后最终通过，未改 registry。两个已归属改动模块 imageGlossaryContext/visionProbe 的专项四项也 **100%**（193 S/L、18 F、140 B）。架构 **1,379/1,379**；唯一归类审计 **496 文件/6,824 cases**；类型、Chrome、Firefox、manifest verifier、userscript build/verifier、文档构建通过。

**额外 app glue 诊断不能称为四项 100%。** areaRuntime 不在原严格覆盖率归属中；主动增加诊断的测试 **156/156**，S/L **68/68 = 100%**、F **16/21 = 76.19%**、B **28/29 = 96.55%**，诊断四项 100 阈值仍使退出码为 **1**。新增隐私转交 true/false 两条可达路径均覆盖；余下为未改的 missing-handler throw，以及实际冻结 snapshot 绕过的 getSourceLanguage/getGlossaryRevision/getTranslationService/getGlossaryConfig/getImageOcrEngine callbacks。保留两次原始诊断与完整分支位置，不降阈值、不添加 ignore、不把原严格 gate 的 100% 外推到整个 app。

Userscript 完整产物与前批源码 `61d6641c3ef527de3ef6eeca753da3c18b7a1cef` 的本机基线**逐字节一致**：**1,954,981 bytes**，SHA256 **`b744392b363cd909bbedd7e1c7ba7415c604f3f29435f2bbac623b91941bf453`**，差值 **0**；既有 **1,955,000 bytes** 上限和 **19 bytes** 余量不变。使用原生平台 guard 与用户脚本依赖树隔离，无额外压缩优化或预算增加；见 `records/USERSCRIPT-IDENTICAL-PROOF.json`。

`records/SOURCE-BINDING.json` 将 **2,910** 个非验收归档输入的逐文件 SHA256 与源码提交 Git blob 对齐，并绑定 **797** 个 Chrome/Firefox/userscript 产物。最终 gates 在源码提交之前运行，冻结输入字节与提交完全相同；没有把命令的旧 HEAD 伪写成新 commit。records 保留命令、UTC、耗时、退出码、stdout/stderr、red/green、完整结果和覆盖率 JSON；`RAW-PUBLIC-BINDING.json` 单列 CW 原始摘要与公开摘要，公开副本仅替换工作区路径前缀及行末空白。`SHA256SUMS.json` 校验全部公开档案。

本批明确未接入**设置页独立 vision probe handler、文档翻译、视频翻译及其他独立直接翻译入口**。只在 `arietids-cw` 本地复用已有依赖与离线夹具；未调用真实搜索/模型 API，未进行浏览器 GUI/RTX5090/GPU 验收、模型下载、额外 Codex/Work 任务或子代理，也未安装依赖、改凭据/安全设置/权限、建立常驻/MCP/远程控制端口或操作 MII。既有测试的本地 loopback 夹具不代表产品部署。本批是源码与确定性离线验证，不是部署或真实浏览器验收。
