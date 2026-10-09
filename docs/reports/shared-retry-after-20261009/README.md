# 共享 Retry-After 冷却 · 2026-10-09

本分支在现有 requestScheduler 中共享真实 HTTP 响应的冷却时点，供新的 broker 翻译和锁定 AI SDK 的 HTTP 重试共同等待。SDK 保留重试所有权和次数；原有 provider、model、prompt、batch、token 与总 deadline 不变。可信后台冻结配置的摘要隔离服务、端点、有效模型、凭据、请求头及普通/私密来源；页面 payload 不能提供此身份。内存状态到期清理，取消后的真实 transport settle 前保留原有并发 lease。

只处理真实 429 和带有效 Retry-After 的 503。429 缺省/无效头使用原有首次 2 秒退避；503 无有效头、401、403 不新增共享冷却。支持数字秒、HTTP-date 和 retry-after-ms，极端等待上限 7 天且受原有请求 deadline 限制。锁定 SDK 对 >=60 秒的头可能提前回退，实际传输入口仍受共享门控。直接连接探测和其他 provider 协议不在本次共享 scope 内。

## 合成重放

真实客户端、消息 handler、broker、调度器和 AI SDK 6.0.264 连接严格白名单的 setRuntimeFetch；任何未匹配网络立即失败，外部 API 调用为 0。30 个固定种子使用相同到达时序和服务端 2/60/90 秒配额窗口。请求字节数为实际 UTF-8 请求 body 大小，只作为载荷代理，不等同于供应商 token 计费。

| 变体 | 成功任务 / 120 | HTTP attempts | 冷却窗口内额外 A 派发 | 健康 B attempts | 健康 B UTF-8 字节 |
| --- | ---: | ---: | ---: | ---: | ---: |
| B0：未修改的上游 | 60 | 270 | 180 | 30 | 17511 |
| B1-C：候选移除 transport 响应反馈 | 60 | 270 | 180 | 30 | 17511 |
| C：候选 | 120 | 150 | 0 | 30 | 17511 |

B1-C 的全部逐种子记录与 B0 完全相同。C 与 B0 的健康 B 时点、状态、请求字节和次数逐项相同。原始记录：[B0](./replay-B0.json)、[B1-C](./replay-B1-C.json)、[C](./replay-C.json)。这是离线合成结果，不证明真实供应商提速、翻译质量、GPU 或 WebGPU。

## 验证与待解决项

在上游 8467b6757affb4bc895d44fa8fbf12a65bee7479 上执行。新的 37 项契约覆盖格式/边界、重复错误、SDK retry count、deadline、取消、未决 transport lease、健康线路、配置与普通/私密身份隔离、页面伪造字段；其中 1 项使用小型真实 timer。六项独立消融移除私密、端点、模型、凭据、请求头隔离或真实 transport lease 后，各出现 1 项直接断言失败，随后字节一致恢复候选：[消融](./ablations.json)。

51 个受影响测试文件共 1469 项，1468 通过、1 失败。唯一失败为 implementationAudit48A 的“startup removes persisted obsolete request-header rules without an HTTP request”：期待空规则，实际包含既有 Bilibili Origin 移除规则。在未修改的当前上游基线上独立复现，未跳过或修复此无关用例。

既有严格范围中的 requestScheduler、requestSnapshot、broker 和 translation handler 四个模块，语句、分支、函数、行均 100%：[覆盖率](./coverage-summary.json)。SDK 适配器整文件原本不在该严格范围内；此次新增 transport 反馈和 lease 路径已执行，不声称适配器整文件覆盖率 100%。

TypeScript、测试审计、Chrome/Firefox/Userscript 构建与文档构建通过。Userscript verifier **失败**：产物 1,960,956 字节，比既有 1,960,000 字节上限多 956 字节；上限和校验器保持不变。已比较既有 gzip 编码选项，未找到足够的等价空间，也未修改无关构建配置。这项体积问题及上游既有失败必须在合并前处理；本分支适合草稿审查，不能视为全套通过。

所有检查通过现有资源保护器串行运行，CPU 目标 60%、单 worker、并发 1；CPU 目标不是硬限额。具体命令阶段时点、耗时和结果见 [验证记录](./validation.json)。上游变化与本分支的交集只在测试/构建集成和文档，没有改动本次五个生产模块或依赖锁文件，因此保留消融证据；更新基线后重做受影响测试、覆盖率、类型和构建，并重新记录 B0/B1-C/C。
