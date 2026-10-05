# Kokoro 固定版本单份缓存

模型、revision、精度、音色与推理参数不变。本改动只减少下载和缓存边界的重复数据。

## 写入与兼容

- 模型只写入固定 revision URL。原生 Cache.put 消费响应流，不再先读取完整 ArrayBuffer，再为 main 与固定地址分别复制。
- 老 main 或 pinned 文件具有精确来源头时直接复用；无来源头或来源不同的文件必须通过当前固定版本的字节数与 SHA-256 校验后才能复用。损坏、短文件与超长文件均拒绝。
- 来源头是扩展此前下载的版本来源记录，不是对任意缓存字节的密码学完整性证明。实际模型验收仍需独立核对上游固定版本文件哈希。
- 迁移先成功保存 pinned，再删除 main，期间可能需要临时存储空间；状态查询在写入失败时保留已验证旧文件的离线可用性，显式准备仍报告迁移失败。Worker 优先读取 pinned，必要时只读回退到 main；未知来源的离线响应先进行一次有界预校验，以便损坏 pinned 不遮蔽有效 main；选定文件重新读取时仍逐块校验，防止两次读取之间内容变化。
- 音色继续使用独立缓存中的固定 URL。移除仍清理本模型的历史键，不影响其他模型；下载、状态迁移和删除沿用现有所有权及失败等待规则。

Kokoro 1.2.4 与直接导入的 Transformers.js 别名解析到同一份 4.2.0 安装。核对该版本 src/utils/cache.js、src/utils/hub.js 与 src/env.js 后，使用其原生 useBrowserCache=false，避免 SDK 在离线 fetch 返回后重新写入 main；不另建生产缓存框架。[官方环境配置](https://huggingface.co/docs/transformers.js/api/env)说明该开关与 fetch 端口，[Cache.put 标准](https://w3c.github.io/ServiceWorker/#cache-put)定义响应流的消费。

## 无来源旧文件恢复

复用现有 @noble/hashes 的增量 SHA-256。一个响应流经过 TransformStream 校验后由原生 Cache.put 消费，成功读完且摘要匹配才提交。没有 Response.clone、tee 或完整模型 ArrayBuffer。失败取消读取并释放源 reader；300 秒上限也包含流读取，锁定但不读取的消费者也会被错误信号解除。Cache.put 提前拒绝时，最多重新读取一次缓存并逐块丢弃；状态查询保留有效旧文件的离线可用性，显式准备则报告原始写入错误，不重复下载已验证文件；该路径不保留整文件，不写入第二份副本。

固定版本元数据来自 [Hugging Face 模型 API](https://huggingface.co/api/models/onnx-community/Kokoro-82M-v1.1-zh-ONNX/revision/6cc0f0d2ebe369a68b0df87c2b65c1af8c0ac3e3?blobs=true)。ONNX 摘要直接取该 revision 的 LFS SHA-256；三个小 JSON 的 Git blob ID 与下载字节独立核对后计算 SHA-256。测试使用真实 44 字节 config.json 验证恢复，无须分配大模型。

测试 Cache 替身在完整消费响应后才保存，用于模拟原生原子提交合同；它不是浏览器 Cache Storage 的实现验证。来源头仍只是此前固定 URL 下载的来源记录，不能证明任意外部修改过的缓存未被篡改。

## 有界对照

运行 node scripts/testing/measure-kokoro-cache.mjs；可传旧版 modelCache.ts 的本地路径作为对照。脚本只使用内存 Cache 替身与合成流，不联网或加载推理模型。

固定夹具包含 1 MiB 图文件、三个 128 字节配置文件、四个 256 字节音色：

| 指标 | 旧版 | 单份缓存 |
|---|---:|---:|
| 模型响应条目 | 8 | 4 |
| 模型响应有效载荷字节 | 2,097,920 | 1,048,960 |
| 音色条目 / 字节 | 4 / 1,024 | 4 / 1,024 |
| 下载响应 arrayBuffer 调用 | 8 | 0 |
| 显式 ArrayBuffer.slice 累计字节 | 2,098,944 | 0 |
| 整文件源缓冲与传入 Response 副本的最大并存字节 | 2,097,152 | 0 |

四个 canonical 有效载荷的 SHA-256 全部一致。字节数不含数据库元数据或底层去重；缓冲指标只度量本模块显式整文件缓冲，不代表浏览器 RSS、原生 Cache 内部内存或推理延迟。

直接调用已安装 4.2.0 SDK 的有界对照也确认：关闭原生浏览器缓存时不产生 main，重新开启后恢复该重复写入，返回字节相同。

定向测试覆盖 canonical 优先、URL/Request 输入、未知来源哈希恢复及损坏拒绝、旧缓存迁移及配额失败、响应流失败/超时与重试、清除竞态。恢复双别名或完整缓冲路径会触发回归；恢复 SDK 浏览器缓存开关也会使策略测试失败。真实权重、浏览器 Cache Storage 和推理结果需在独立验收中验证。

真实固定权重的独立 Node 流式验收：四个文件全部通过，图文件 339,369,442 字节、最大块 65,536 字节、源 reader 释放，单次耗时 2.255 秒；采样 RSS 从 47.7 MB 到 78.0 MB，ArrayBuffers 从 0.61 MB 到 26.95 MB。该结果仅证明生产校验函数的 Node 流处理，不是浏览器存储或推理延迟测量。配额失败后的多次校验增加读取成本，不宣称加速这一恢复路径。
