# CW Firefox 文本文档生命周期：固定源码离线验证

源码 **`469ce1991f00fd69b09faaac492d76e567171421`**，tree **`5fcda7cd61bda17c60cd27051b81fd96cc54ea04`**，以已接受的 `ed89ab895fbb0a8a1bf0d6204f1aa603d6b2d74e` 为应用基线，工作分支此前 HEAD 为 `9f934d8f815332d350e043701bb27ce455c72796`。本批仅在 CW 本地执行，不启动额外 Codex/Work 任务或子代理，不安装依赖、不访问真实模型/搜索 API、不调整凭据、权限或浏览器安全设置、不运行 GUI。

Firefox/Thunderbird 的文本、批量和输入框调用通过独立原生文本 Port 转发到原生产 router/handler。后台冻结真实 sender，并为每次真实连接创建服务器身份；私有 symbol/WeakSet 租约只能来自这个实际连接，不能由 URL、客户端 nonce、字符串或布尔值授予。生产 start/cancel 必须具备 native documentId 或有效 Port 租约；Chrome 继续使用原 documentId 直连。图片 Port 没有改动；userscript 保持原协议，产物与 ed89 **字节完全相同**。

原生断连先撤销身份，再中止两个独立注册表中的所属请求。ready/source 永不返回时，handler 的准备等待仍及时结束，迟到 resolve/reject 被消费且不分派 provider。客户端 pending 绑定实际 peer，旧 cancel 不建立新连接，不重试断开的旧请求；同 URL/tab/frame 的新连接拥有新身份，旧 context、回复及取消不能作用于它。真实 pagehide、BFCache 暂停/恢复和失效清理由现有 content 生命周期接线。

Provider 的 abort 信号与传输 lease 是两个边界：调用方可以及时结束等待，真实 broker 中忽略 abort 的 provider 仍占据传输槽直到实际 settle。两个真实 handler→availability→broker→捕获 provider 用例证明新连接的第二个请求在第一份底层传输 settle 前不分派。未对整个已分派 operation 做 Promise.race。公开请求 ID 只定位同连接同协议请求，原有两个 512 条历史上限保留。

最初固定 red 输入 **2/2 预期失败**，绑定基线 Git blob 及保存的测试源码。最终完整测试 **9,885/9,885**，**402 文件**，零失败、零跳过；statements/lines **66,007/66,007**、functions **4,599/4,599**、branches **33,584/33,584**，四项均为 **100%**。新增租约、文本协议、文本客户端也分别四项 100%。架构 **1,378/1,378**、**32 文件**；类型、审计、Chrome/Firefox/userscript/文档构建及两个产物 verifier 均通过。userscript **1,954,988 bytes**，原 **1,955,000 bytes** 上限未改。

冻结 **4,005** 个源码/测试/配置/文档输入（明确排除已经发布的 browser-acceptance run 数据），提交中对应路径及每个 Git blob SHA256 与冻结清单一致，既有验收存档未改。**797** 个本地产物保存 SHA256。两份 manifest 的 permissions、optional_permissions、host_permissions、optional_host_permissions 和 incognito 与 ed89 及已接受的 `89fd0580` 基线一致；Chrome 仍是 spanning，Firefox 最低版本仍为 **140.0**。最后一次类型清理只删除测试文件中一个未使用 import，没有改变已构建的应用输入；前后差异单独记录。

类型检查最初因历史验收目录中的 red-test `.ts` 数据快照缺少相邻 helper 而失败。唯一新增排除项是 **`docs/browser-acceptance/runs/**`**，既有四项排除未变，精确 diff 位于 `records/tsconfig-exact.diff`。[完整 vue-tsc 文件清单](records/typecheck-file-list.stdout.txt) 与 [范围核验](records/TYPECHECK-SCOPE-PROOF.json) 证明全部 **799 src、495 tests、15 entrypoint** TS/Vue 文件仍列入检查，缺失数均为零，存档列入数为零。没有提高覆盖率阈值、Firefox 版本或债务行数上限。

原始失败和中间检查均保留：初轮 Vitest cache 对只读依赖目录的写入失败后统一 `--no-cache`；旧 sender 测试依赖注入、input 拒绝断言及负控默认参数的夹具错误已修正；首次 composition 行数增长检查失败后收拢装配；完整架构首轮的 Node spawnSync EPERM 与完整测试首轮 5 项既有 WebDAV 127.0.0.1 合成 HTTP 夹具 listen EPERM，经同机解除执行沙箱后重跑通过；最终类型发现并删除未使用测试 import；绑定脚本误读既有 manifest 元数据字段也保留首轮失败记录。证据文档初轮把 `.diff` 当作 VitePress 资源链接导致 dead-link，已改为精确文件名引用，未关闭 dead-link 检查。解除执行沙箱仅用于这些本机离线检查及 Git 共享元数据写入，不是浏览器安全设置变更或远程控制监听。

完整 command/UTC 时间/耗时/退出码、stdout/stderr、JSON 结果与覆盖率、固定 red 输入、类型范围和源码/产物/权限绑定均在 `records/`。公开副本只替换 CW 绝对路径并清除行尾空白，原始和公开 SHA256 分别保存。本批确定性原生事件对夹具不能声称真实 Firefox 文档导航、GUI、供应商或 GPU 验收通过；先前 `89fd0580` Neo 场景也不能计入此源码。Port 提供文档所有权，没有伪造 documentId 或补充 getContexts 的私密来源证据；无 tab 扩展页的既有来源限制、reader/writer/字典和其他 feature 接线、真实 Firefox GUI 与 RTX5090 WebGPU 验收仍分别待办。
