# CW 视频有效隐私路由、取消与字幕导出

源码 **`69649c3c07c2a0b2b779ccc65f68d441ed7833b9`**，基线 **`1d73d1ef084ac8f5de20f62695ffec1da931ef41`**；分支 `fix/incognito-model-route-20261008`。六个生产文件为 app translation/client.ts 和 video-subtitle/content 的 runtime.ts、platformRuntime.ts、downloads.ts、subtitleLogic.ts、pretranslationController.ts；共十三个源码/测试/文档文件。**#883 未查询、修改或回复。**

先读两个运行时与真实导出调用。范围为 **YouTube/X 与会议/Udemy/Disney+ 两运行时的模型播放翻译，以及已有 YouTube/X 译文/双语导出**。platform runtime 没有导出入口，本轮不新增；不将此范围外推为所有视频/ASR 推理工作完成。独立 settings probe、在线 dictionary 访问与原文缓存隔离仍未迁移。

文本客户端在 Thinking、上下文能力、provider prompt、后台 chunk/模型能力与缓存决策前解析有效专用 pair；前端只传 provider/model，不附加可信来源，native sender/getContexts 三态、文本 Port/registry/handler 与 broker 继续最终授权。unknown + 已配置 pair 拒绝；regular、pair 全空和 native false 保留普通兼容。有效服务还用于 YouTube/X 标签与预翻译窗口；无效 UI 提示可回退标签，实际请求继续拒绝。

原生配置键保守比较完整相关公开映射与视频专用字段，普通模型/其他服务变化也撤销当前译文；计数/UI 保存不取消。实际 route bridge 的 document 信号、媒体加载身份变化、pagehide/卸载立即取消旧 SDK，迟到结果不能写新视频 DOM、模型缓存或导出文件。相同 URL/媒体信号去重，监听随卸载释放，运行时行数上限仍 **1887**。

原生导出使用自己的 clientRequestId 与 signal，经过同一原生文本通道，不加入播放的前端等待任务。取消导出保留同源播放，切换仅原文取消播放而独立导出继续；新导出代次保护反馈，避免旧完成覆盖当前状态。此策略在同时缓存未命中时可能增加上游工作，已有持久模型缓存仍可复用。配置保存保留当前原字幕与已恢复 ASR 源时间轴；切换视频隔离当前源视图，既有持久 ASR 源缓存未改或删除。

**75 项**新控制从实际 root 进入两个运行时，实际播放器菜单调用实际 downloads 控制器；工厂 spy 只捕获真实实例，不替代请求逻辑。运行真实 store save/subscribe、text client/Port/registry/handler、broker/cache/provider/AI SDK，仅浏览器/DOM/布局/History、合成配置存储、源缓存回复、部分上下文捕获、HTTP 与文件保存使用边界；菜单的 trusted click 标志是离线手势边界。X 从合成已完成 ASR 缓存恢复，比较原缓存与完整恢复后时间轴保存前后相同；不做推理、音频采集或模型下载。辅助 lifecycle 新增 **2 项**实际事件所有权控制。

专项 **163/163**。冻结夹具只恢复六个基线生产文件，最终选定负控 **16/16 失败**，另 **59** 是过滤；六文件随后逐字节恢复。基线前端仍选普通 pair，后台专用 SDK 本来能成功，所以负控检查实际前端 message、Thinking/context 与立即撤销/独立取消，不把后台 SDK 单独通过当修复。不是实际 API 泄漏证明。

保留初始 HTMLStyleElement/TextTrackList、错误 DOM id/控件容器、渲染时序、ASR 已有附加元数据和跨原生文档切换夹具的失败记录。跨 regular/private 缓存控制使用不同 native documents，先关闭合成旧 Port，未通过前端标记改写已绑定原生来源。旧算法/导出合同显式 native false；新入口与导出控制同时覆盖 native true/false。未删用例、降低覆盖阈值或增加权限。

首轮全量 **10284/10284** 测试通过，但分支 **33846/33847（99.99%）** 导致退出 1；缺初始化 `currentSrc` 空而 `src` 已知的分支。第二轮仍 **10284/10284** 测试通过，但分支 **33844/33845（99.99%）**、退出 1：替换初始夹具时丢失了无视频空来源分支。现将既有控制参数化，保留两种初始状态，无生产改动；单模块诊断 **5/5**、四项 100% 后再跑完整门禁。两轮失败的输入、结果与单次审核记录分别保留于 `full-strict-first`、`full-strict-second`；原始 command 保留实际执行时的路径，未改写历史命令。诊断结果不代替全量门禁。第三轮全量 **10285/10285**、四项 100%、退出 0，随后等待工具被中断，整体退出码未暴露；核实无剩余进程或后续完成记录，仅续跑未完成项。续跑静态审计退出 1：六组插值标题被识别为重复 `<dynamic>`。改为字面量格式标题与笛卡尔参数表，保留同样 **75 项**控制和全部生产字节；重跑对应最终夹具负控与专项，重新冻结测试 SHA，再执行最终十项门禁。第三轮完整通过和审计失败均保留，未将旧 SHA 结果冒充最终证据。

完整严格回归 **10285/10285**、**411 文件**，零失败/跳过、退出 0；S/L **66127/66127**、F **4613/4613**、B **33846/33846**，四项 **100%**。五个既有 owned 视频模块也四项 100%；runtime/platformRuntime/app client 是原有 glue 验证归属，不外推 numeric 100%。架构 **1379/1379**；审计 **500 文件/6924 cases**；类型、Chrome/Firefox/userscript 构建、verifier 和文档全部退出 0。执行列表/矩阵仅加一文件，归属、阈值、ignore 和所有预算保持基线。

油猴原生路径由既有平台 alias 与 native false guard 排除，未增加 alias 或做等价优化；最终 **1954998 bytes**、预算 **1,955,000**、余量 **2 bytes**，相对当前基线 **+0 bytes**。逐字节一致 **True**，SHA256 **`55aeef43aba4fcba6f4d54a16d9b8c5260f213b70b30fb19b8bd54b148c9febe`**；完整字节证明与普通实际控制分别核对。Chrome/Firefox manifest 安全字段未变。

冻结 **2914** 个输入绑定至源码 Git blobs，核对 **797** 个产物；**31** 个原生来源/通道/registry/broker/字幕缓存与 ASR 源控制/平台/构建文件保持基线。最终 SOURCE-DIFF 是提交生成的完整有序 patch，首次工作区 patch 单列；所有源码字节由冻结 SHA 证明。原始与脱敏归档由 RAW-PUBLIC-BINDING 关联，SHA256SUMS 覆盖其余所有文件。

未运行真实 API/搜索、ASR 模型下载、GUI/GPU/WebGPU、用户 profile 或真实下载；未启动子代理/额外 Codex/Work 任务，不操作 MII/云环境，不新增后台常驻、MCP、持久权限或远程端口。历史 loopback 审批元数据缺口仍单列，未补造；各轮完整门禁、审计续跑与最终执行的独立请求及实际工具观察另存；第三轮全量通过后的等待中断和审计失败保持原记录，最终执行绑定修正标题后的测试 SHA，工具未暴露签名审批决定，不授予持久网络/产品权限。

证据目录加入后再次构建文档，`docs-build-with-evidence` 退出 0；源码和扩展/userscript 产物未改变。
