# CW YouTube/X video 节点替换窗口

源码 `6aee348618412de212ccad5b73f13072a4aff10b`，基线 `d6781cc3640eefa798b91fb6a828c42c9a61e4d2`；既有分支 `fix/incognito-model-route-20261008`。三个改动文件：runtime.ts、videoPrivacyRoute.test.ts、docs/testing.md；仅一个生产 getter 表达式与中文职责注释改变。platformRuntime、导出控制器、app client、原生来源/Port/registry/broker/scheduler、ASR 源控制和所有预算/阈值/alias/执行列表/矩阵保持基线，未操作 #883。

原生媒体生命周期调用现有 `playerLocator.sync()`，同步按现有可信 DOM 选择规则读取当前节点；不再等 locator MutationObserver 的下一 RAF 才依赖 observedVideo。getter 的 locator 订阅仍通过既有 runtime 更新绑定和源身份，随后生命周期撤销旧译文与独立导出。原用户配置、原标题、原字幕与同媒体节点替换后的合成已恢复 ASR 时间轴保留；不把此修复外推为所有视频或 ASR 推理完成。

追加 **18 项**实际 YT/X 入口控制，视频 suite 共 **93 项**：真实替换 video（同 URL/不同 URL），向实际 locator callback 交付 MutationObserver 变更并保持 RAF **未执行**，只完成原生 Port 微任务，再释放旧实际 broker/provider SDK 的合成响应。分别观察播放 DOM/模型缓存与真实导出控制器的保存边界。基线 **8 项 loadstart 负控失败**：播放迟到缓存/DOM 写入，导出迟到保存；**8 项 loadedmetadata 通过**，既有 timeline handler 本已同步保护它，不误报为缺口；另 **77 项为过滤**。仅恢复一个基线 runtime 文件，随后逐字节恢复；最终测试 SHA 与此负控绑定。

修复后 16 项矩阵全部通过；另 YT/X 各一项控制重复事件、分离节点、重新连接但未被 locator 选中的旧节点、新旧交错与导出独立取消。新播放保持自己的请求身份、取消新导出不伤播放；迟到旧结果不写 DOM/cache/file。实际 scheduler 与 lease.holdUntil spy 都委托原实现，观察 provider operation 最终结算；未窥探私有并发计数，也不声称 SDK 已取消后仍必须等待忽略 abort 的 HTTP 夹具。

初始探针的 X 过早启动、SDK signal 早于 Port 微任务的采样，以及过强的未结算期待均单独保留。修正夹具没有执行 RAF 或放宽生产条件。DOM、MutationObserver/RAF、HTTP、合成配置/ASR 缓存回复及文件保存仍为离线边界；没有真实 API/GUI/GPU/ASR 推理/模型下载验收。

专项 **235/235**（10 文件，含现有 locator/scheduler）；严格回归 **10303/10303**（411 文件）、零失败/跳过/退出 0，S/L **66127/66127**、F **4613/4613**、B **33847/33847**，四项 **100%**。既有五个 owned 视频模块四项 100%；runtime/client glue 不外推数值 100%。架构 **1379/1379**；静态审计 **500 文件/6926 cases**；类型、Chrome/Firefox/userscript 构建、verifier 和文档均退出 0。

最终 userscript **1954998 bytes**，预算 **1,955,000**、余量 **2 bytes**；与实际基线逐字节一致，SHA256 `55aeef43aba4fcba6f4d54a16d9b8c5260f213b70b30fb19b8bd54b148c9febe`。无需等价优化、新 alias 或预算放宽；manifest 安全字段不变，runtime 行数上限保持 1887。

**2914** 冻结输入绑定提交 Git blobs，**797** 产物核对 SHA256，**38** 指定传输/配置/源控制/构建文件保持基线。SOURCE-DIFF 来自源码提交的完整有序 patch；RAW-PUBLIC-BINDING 关联 CW 原始记录与规范化公开副本，SHA256SUMS 覆盖其余归档文件。当前单次门禁的实际请求与返回另存；工具未暴露签名审批决定，历史 loopback 记录缺口未补造。未新增持久权限/MCP/远程端口、额外 Codex/Work 任务或子代理。

settings probe、在线 dictionary 访问和原文缓存隐私隔离仍未迁移。

证据目录加入后再次构建文档，`docs-build-with-evidence` 退出 0；源码和扩展/userscript 产物未改变。
