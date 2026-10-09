# 共享 Retry-After 冷却 · 2026-10-09

真实 HTTP 429 和有效 Retry-After 的 503 现在反馈到既有 requestScheduler，新的 broker 请求与 AI SDK 的真实 HTTP 重试共同等待。SDK 保留重试所有权和次数，provider、model、prompt、batch、token 与总 deadline 保持既有语义。

本轮修复饱和容量下健康线路被冷却任务阻塞的问题：SDK 的外层逻辑任务只保留 deadline、取消与额度冷却，不计并发或速率；实际 scheduleAttempt 在同一既有池中计并发与速率，直到原始 runtimeFetch settle 才释放槽位，包括传输忽略 abort 的情况。非 SDK 和直接连接探测保持原有默认计数；实际尝试继续遵守 FIFO，没有另建资源池。

可信后台元数据区分普通、私密与未知来源。typed input、图片活跃事务→offscreen 和 area 文字/识图都保留该身份；扩展自有无 tab 页面使用平台元数据，payload 中的隐私、sender 和额度字段不能提供权限。summary、single、batch 三类内存 pending 身份包含有效配置凭据集合、轮换/恢复设置及隐私摘要；真实 transport 摘要使用本次实际选择的 Key。成功缓存的共享规则保持不变，摘要不输出凭据。

只处理真实 429 和带有效 Retry-After 的 503。429 缺省/无效头复用首次 2 秒退避；503 无有效头、401、403 不新增共享冷却。支持数字秒、HTTP-date 和 retry-after-ms，极端等待上限 7 天且受原有请求 deadline 限制。锁定 SDK 对 >=60 秒的头可能提前回退，实际传输入口仍受共享门控。

## 合成重放与反例

真实客户端、消息 handler、broker、调度器和锁定 AI SDK 6.0.264 连接严格白名单的 setRuntimeFetch；未匹配网络立即失败，外部模型/搜索 API 调用为 0。30 个固定种子使用相同到达时序和服务端 2/60/90 秒配额窗口。请求字节数为实际 UTF-8 body 大小，只作为载荷代理，不等同于供应商 token 计费。

| 变体 | 成功任务 / 120 | HTTP attempts | 冷却窗口内额外 A 派发 | 健康 B attempts | 健康 B UTF-8 字节 |
| --- | ---: | ---: | ---: | ---: | ---: |
| B0：未修改的上游 | 60 | 270 | 180 | 30 | 17511 |
| B1-C：本轮候选只移除响应反馈 | 60 | 270 | 180 | 30 | 17511 |
| C：本轮候选 | 120 | 150 | 0 | 30 | 17511 |

复用已记录的上游 8467b6757affb4bc895d44fa8fbf12a65bee7479 B0，不重复未变基线。重新执行本轮 C 和 B1-C；B1-C 全部逐种子记录与 B0 相同，C 的健康 B 时点、状态、请求字节和次数也逐项相同：[对比](./replay-comparison.json)、[B0](./replay-B0.json)、[B1-C](./replay-B1-C.json)、[C](./replay-C.json)。这是离线合成结果，不证明真实供应商性能、翻译质量或 GPU/WebGPU。

74 项新契约覆盖原有格式、SDK retry count 和身份隔离，以及 max=1/max=3 饱和、90 秒冷却、健康 B 在 10ms 到达/40 秒 deadline、raw-inflight 上限、取消/超时后无迟到派发、速率与 FIFO、三个 pending 入口的隐私/Key/Key 集合/轮换变化、typed input、图片 offscreen、area text/vision 正反方向和伪造事务借用。其中 1 项使用小型真实 timer。饱和反例从独立页面的真实消息边界注入，未把多页面共用一个客户端队列；在原 #906 实现上 max=1/max=3 都直接断言失败：[有效红例](./saturation-red.json)。早期无效 PNG、过小区域和缺少 fixture 字段导致的失败已纠正，不计作有效红例。

九项必要消融分别移除逻辑/实际容量分离、实际 transport 计数、typed input 隐私、图片事务隐私、area 隐私、pending 摘要、有效 Key 集合、轮换配置和 SVG 压缩，依次产生 2/2/3/2/4/12/6/3/1 项直接断言失败；每次随后字节一致恢复候选：[消融](./ablations.json)。旧候选中的外层 transport lease 消融不能替代本轮实际尝试容量证据。

## 验证与阻塞

56 个相关测试文件共 **1654/1654 通过**。既有严格范围中的 8 个改变模块，statements/branches/functions/lines 均 **100%**：[范围与测试](./affected-tests.json)、[覆盖率](./coverage-summary.json)、[源码 SHA256](./source-sha256.json)。SDK adapter、areaRuntime 和 messageRuntime 整文件原本不在该严格范围内；本次改变的传输和实际 composition 路径已执行，不声称这些整文件覆盖率 100%。

implementationAudit48A 只修正过时断言：启动后恰有既有 Bilibili Origin 移除规则 id 2763000 / priority 2，匹配既定域名、initiatorDomains 和 xmlhttprequest；removeRuleIds 仅 2763000，外部规则 42 保留。hydration 前不读取、hydration 后同步和无 fetch 断言继续通过，DNR 生产实现未改。

TypeScript、测试审计和 Chrome/Firefox 构建通过。标准、standalone 的构建生成产物，但 verifier 因既有体积上限失败。GreasyFork 的 Vite 构建生成产物，外层固定资源检查失败，verifier 也因体积失败：

| 产物 | 实际字节 | 既有上限 | 超限字节 |
| --- | ---: | ---: | ---: |
| 标准 userscript | 1961932 | 1960000 | 1932 |
| standalone userscript | 3780639 | 3600000 | 180639 |
| GreasyFork source | 2325042 | 2000000 | 325042 |

SVG 只将精确白名单 src/ui/assets/serviceBrandPaths.json 接入已有 gzip/base64→inflateWithPako→JSON.parse，非 GreasyFork 生效；其他 JSON 不被拦截，站点目录和固定资源不改。真实 Vue ServiceIcon 的 @ 别名导入、绝对路径和生产构建经真实 pako 逐项还原，对象/数组顺序保持。GreasyFork 真实组件构建使用原生 JSON，许可声明保留。

一次必要的 standalone 去压缩构建为 3798107 字节，候选减少 **17468 字节**，仍不足以通过上限：[体积消融](./svg-size-comparison.json)。标准 userscript 使用精简设置界面，生产依赖图根本不含 ServiceIcon 或 SVG 表，因此此方案不降低标准体积：[真实依赖图](./standard-svg-dependency.json)。GreasyFork 另报固定资源 userscript/resources/fluentread-data.v1.js 与 af81332fb598f78b1199d103e0943e4e521a7f96 不一致；没有执行 --prepare-resources、改固定资源、提高上限或引入新的构建库。

PR 保持草稿：三类体积、GreasyFork 固定数据资源检查和独立审计仍阻塞 ready。文档构建及阶段时点/耗时以 [验证记录](./validation.json) 为准。所有检查使用现有资源保护器串行运行，CPU 目标 60%、单 worker、并发 1；CPU 目标是协作式限制。未执行真实供应商测试、GPU/WebGPU 或新增浏览器权限操作。
