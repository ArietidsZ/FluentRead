# CW 写作配置取消：真实保存可达性复核

源码 **`7fb7fc44f5ebb36ffaf531b07a277c63caea3415`**，tree **`06ab162a6bbf0779b1339eb786a598ef440b4d15`**；此前 HEAD **`99d982b8539c76b2d50aeb10ee29f8abbc9c7677`**，此前应用源码 **`dd6f2bce476de15f1c6d0a8bfa447568d1c89798`**。本批只处理写作取消策略，**未开始阅读路由切片**。

明确撤回 `configurationKey` 缺少 `next.custom` 就构成生产端点变更遗漏的判断。真实 config store 初始化和每次保存、订阅通知都会 normalize：legacy custom 的空 provider.endpoint 会由 custom 补入 customOpenAIProviders。真实保存单改 custom 而保留已补齐 endpoint 时，有效端点保持旧值，延迟 SDK 请求有效完成；将空 endpoint 和新 custom 一起提交时，save 与 patch 都补齐新 provider.endpoint，已有取消键取消一次旧请求并抑制迟到正文，下一次实际 SDK wire 使用新端点。本批没有用裸 Object.assign 制造生产红测，也没有增加防御性 custom 取消字段。轮询 scope 另读 legacy custom 兼容字段，这不等于有效端点变化。

实际复现并仅修复两个可达取消遗漏：`requireApiKey` 的真实 patch 使当前私密模型无凭据时变为 not ready，原先仍继续在途生成；`apiKeyRecoveryMs` 的真实 patch 改变恢复策略，原先仍继续多 Key 生成。后者运行实际 modelGateway、轮询和 SDK，合成 429 触发第二个 Key，并延迟第二次 fetch；非替换 spy 核验旧恢复时间确实进入轮询。两项字段仅加入已有写作 configurationKey，保留冻结模型与端点、handler 单次完成和取消信号边界；取消后迟到 SSE 不产生正文 progress 或第二个 result。未改 normalize、保存流程、提示词、路由、权限、凭据、默认设置或依赖。

静态决策依赖核对见 `records/DEPENDENCY-AUDIT.json`。其他有效端点、模型、凭据和已有私密校验字段已在取消键中；serviceRegion 经 normalize 仅保留三个机器翻译服务，均被 Harness 拒绝，未增加不可达 writer 字段。requestHeaderRules 不由本 modelGateway/runtimeFetch 读取，浏览器 DNR 是另一个边界；本批不宣称对它进行了真实浏览器网络策略验收。

固定 baseline 与红测 fixture SHA256 见 `records/BASE-SOURCE-BINDING.json`。最终修正夹具后的基线 **5 测试：3 个 custom 控制通过、2 个策略取消预期失败**；`records/red-fixture.ts` 与 baseline-writingRuntime.ts 保留。早期恢复夹具的空 token 清除 Key 池和未显式开启轮询，以及一次审计命令路径错误，其原始日志也保留，明确不算生产红测。修复后五文件针对性 **177/177**。

完整严格检查 **9,921/9,921**，**404 文件**，零失败/零跳过。statements/lines **66,024/66,024**、functions **4,599/4,599**、branches **33,616/33,616**，全部四维 **100%**；唯一改动的可执行模块 writingRuntime 四维也全部 100%。架构 **1,379/1,379**、32 文件。类型、审计、Chrome/Firefox/userscript 构建、manifest/userscript verifier 和文档构建全部通过；编译输入覆盖所有 **799 src、497 tests、15 entrypoint** TS/Vue 文件，tsconfig 和原有档案排除未改。

冻结 **4,007** 个源码/测试/配置/文档输入，明确排除旧验收档案；对应 Git tree 路径和每个 blob SHA256 全匹配。绑定 **797** 个产物 SHA256。userscript **1,954,988 bytes**，1,955,000 bytes 上限不变，与 dd6f2bce/469ce199/ed89 字节一致。权限、Chrome spanning、Firefox 140.0 最低版本、历史验收记录、依赖锁和现有发布版本未改。

所有 command/UTC 时间/耗时/退出码、stdout/stderr、JSON、覆盖率、源码/产物和权限绑定均在 records。公开副本仅替换 CW 绝对路径并清除行尾/末尾空白，原始和公开 SHA256 分别记录。只在 CW 本地执行，没有真实搜索/模型 API、GUI、GPU、系统部署、安全设置变更、日常浏览器/profile 操作、额外 Codex/Work 任务、子代理或 PR；测试凭据仅为内存合成 sentinels，未读改实际凭据。完整离线 gate 解除执行沙箱仅用于既有只读 spawnSync 和临时 127.0.0.1 WebDAV 夹具。此为离线真实代码链路证据，不代表部署或真实浏览器/供应商/RTX5090 验收通过。
