# CW 识图缓存准备取消

源码 `ba450ef270b9df420847608efe595468931ecf9d`，基线 `1dd97226dfb67fac5b4b43fd6625407ce155f06b`；现有分支 `fix/incognito-model-route-20261008`。生产仅修改共享 `visionProbe.ts`，为原生缓存读取前的准备等待加取消与有界超时；复用已有 preparation helper，独立结束订阅者等待，不中止共用的 `storage.load`。handler、registry、原生 Port、broker、scheduler 和已分派 provider 生命周期保持原样。

最小负控 **6 项全部失败**：真实 storage adapter 经未释放的本地读取 gate，显式取消、原生 Port 断连和 30s deadline 都仍有 **1 个后台请求和 1 个配置订阅**。取消/断连另留 **1 个计时器**；deadline 计时器已触发但请求未结束。provider lease 和 HTTP 均为 **0**。仅回退该服务文件到基线，用最终测试字节重新复现，随后逐字节恢复。

修复后的 6 项在 gate **仍未释放**时已完成后台 handler 和真实 registry.run，配置订阅、计时器均为 **0**，仍无 provider lease/HTTP。释放或拒绝迟到读取之后保持清理；真实 cancel 对仍有效的已完成 owner 返回 cancelled:false，断连 owner 已撤销，依据真实 run 的 finally 完成证明清理。原始观测见 CACHE-PREPARATION-OBSERVATIONS 和对应 JSONL。

另有共享读取保留其他有效文档：取消一个等待者后另一个仍等待，同一 load 只执行一次；释放后只取得 1 个 lease、发出 1 次合成 HTTP 并成功。独立准备超时消费两种迟到结果并允许重试；已取消调用不启动读取。缓存等待使用既有 timeoutMs 与 30s 上限；既有 active probe timeout 和手动外层 deadline 不变，不声称重新定义独立调用的总 deadline。

现有设置 suite **66/66**，新增 **10** 项；相关原生链路 **175/175**，聚焦 **108/108**、四维覆盖率 **100%**。全量严格回归 **10369/10369**（412 文件），零失败/跳过/todo；S/L **66212/66212**、F **4619/4619**、B **33938/33938**，均 **100%**。架构 **1379/1379**，静态审计 **501 文件/6965 cases**；类型、双浏览器构建、manifest、油猴/verifier、文档均退出 0。ownership、执行列表、阈值、ignore、预算、alias 和依赖不变。

userscript **1,954,998 bytes**，SHA256 `55aeef43aba4fcba6f4d54a16d9b8c5260f213b70b30fb19b8bd54b148c9febe` 与基线逐字节一致；预算 **1,955,000**，余量 **2 bytes**。manifest 安全字段不变。**2915** 输入绑定源码 Git blobs，**801** 构建产物核验 SHA256。

这些是 CW 离线实入口测试：真实原生 Port/client/server/router、typed handler、registry、配置订阅、storage adapter、shared probe、broker/provider registry/SDK；浏览器、存储、统计和 HTTP 是合成边界。本组 Port 资源测试先卸载 UI，避免成功缓存反馈的刷新计时器混入；最初的错误断言记录保留。没有真实 API、GUI、GPU、模型下载、额外代理/Work 任务或持久产品权限变更。现有本地子进程/loopback 门禁按单次执行申请并观察成功，工具未提供签名审批决定。

未操作 #883；dictionary 访问和原文缓存隐私隔离仍留在独立审查范围。

证据目录加入后再次构建文档，`docs-build-with-evidence` 退出 0；源码及扩展/油猴产物未改变。
