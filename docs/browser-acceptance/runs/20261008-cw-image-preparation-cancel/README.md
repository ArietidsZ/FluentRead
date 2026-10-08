# CW 图片准备等待取消修复与覆盖说明更正

源码 **`1fb8c69773df0de8fd35ddf723d7c995ed760731`**，tree **`abb4075a9ee4b8e5ce27c634fd8d25ef8fae26fd`**；基线 HEAD **`f6b37c924cc49649fb87c1fdaaf83c53066ace11`**。本批只关闭图片 ready/source 准备等待的取消缺口，并补充上一批新增分支的边界用例；不扩展圈选或 vision 路由。原图片验收档案保留，不将静态或离线测试称为部署、浏览器或 GPU 实测。

旧代码在共享 registry 和配置取消控制器登记前直接等待 ready/getContexts。真实 handler／原生 Port 的 red gate 不释放前，配置变更或断连不能结束后台 dispatch；注册表截止时间尚未生效。修复在这两个等待前沿用原归属、控制器、事务身份和截止时间登记；app 同步拿到该控制器后复用已有文本准备取消 helper。有效快照准备完成并重验原活动记录后一次封入只读 getter，再进入原图片 handler。配置变化、Port 断连、显式取消和截止时间都结束准备等待；迟到 resolve/reject 被消费且不能封入快照或派发 OCR。外层 finally 清理配置控制器，不等待无响应准备 gate。

没有新增 provider 全程 race。共享 registry 原有调用方取消行为保留，broker/provider 传输 lease 继续保留到真实 provider Promise settle。既有忽略 abort 的 provider 回归通过。只读 snapshot getter、execute 的同一 signal 局部引用和三个原 owner 表达式的共享函数消除重复代码；归属算法、随机事务身份、原生租约和 nonce、Offscreen 授权、撤销与 deadline 规则未重建。areaRuntime、图片 feature handler／Port／来源授权、broker／scheduler、配置 store／normalizer、依赖、发布版本、构建配置、权限、默认设置和体积 verifier 的 SHA256 原样核对，见 `records/UNCHANGED-CONTRACTS.json`。原圈选等待与未标来源拒绝范围保持，不把图片修复当作圈选功能完成。

真实基线红测 **46 案例，29 通过／17 预期失败**：新增准备用例 17 个中两个正常控制通过，15 个取消／deadline 用例失败；真实 app 的两个 getContexts 用例也失败，27 个原控制通过。它们在释放 gate 或推进客户端 timeout 前检查后台 dispatch 清理。最终新准备文件 **19 案例**，后补的两个 generic registry 迟到快照用例不冒称红测；实际 app 图片文件 **30 案例**，包括真实保存/订阅与 getContexts 等待取消、旧 provider lease 控制及未标快照 Offscreen 恢复拒绝。两个额外覆盖边界同样不冒称红测。初始补充夹具的异常返回与已完成位图缓存假设被修正；审计所需的静态用例名称通过 describe.each 保留同一测试条件，未降低审计规则。

最终十二文件专项 **427/427**；两个已归属的改动模块 imageGlossaryContext 和 operationRegistry 四项均 **100%**。完整严格检查 **10,010/10,010**，**407 文件**，零失败／跳过；原归属清单 statements/lines **66,090/66,090**、functions **4,606/4,606**、branches **33,684/33,684**，四项 **100%**。覆盖归属 include/exclude、阈值和 ignore 未改，只向原测试矩阵和执行列表添加新测试。架构 **1,379/1,379**，32 文件；审计、类型、Chrome/Firefox/userscript、verifier 与源码文档构建通过。类型包含全部 **799 src、500 tests、15 entrypoint** TS/Vue，没有缩小 tsconfig。

**更正上一份证据：额外三模块诊断的遗漏并非全部既有分支。** `areaRuntime.ts:67` 新 privacy 三元式的未标记分支和前端 `runtime.ts:323–325` 新私密 thinking/system_role/user_role 可选链曾未覆盖。实际允许的 Offscreen 子请求恢复原圈选未标快照后，真实图片 broker adapter 继续拒绝缓存/provider；前端真实挂载与响应式观察覆盖映射缺失及专用自定义模型目录变化，已有位图和在途结果失效。最终相关新增分支位置均有非零计数：area 新增起始行分支 7 个、content 新增起始行分支 8 个，定位及此前/当前计数见 `records/NEW-BRANCH-PROOF.json`。这是覆盖记录的具体定位证据，不以新增语句执行代替分支覆盖。

大型 area/content 两模块不属于原完整覆盖归属，整模块仍有遗漏，故最终额外三模块诊断沿用 100% 阈值并保留预期 **exit 1**；测试断言均通过，诊断全量比例为 statements/lines **97.29%**、functions **85.50%**、branches **91.11%**，不称其整模块 100% 或验收通过。初步诊断曾用 CLI 0 门槛只输出非归属覆盖报告，日志保留；最终诊断和所有验收门禁使用原门槛。旧档案错误文字不回写，以本批更正为准。

冻结 **4,010** 个非归档源码／测试／配置／文档输入，对应提交 Git blob SHA256 全部一致；旧验收档案未改。绑定 **797** 个产物摘要。最终 userscript **1,954,962 bytes**，原 **1,955,000** 门槛保留，余量 **38 bytes**；SHA256 **`d3ba6ae6614d29364823d9742a992b2880d7b571073b241057ff01f1ac653bec`**。本批共享注册表代码也进入 userscript 产物，所以它与此前产物不同，不声称字节一致。初次 **1,955,201** 及中间 **1,955,055** 的超限日志保留；精简本次注册表后最终构建及 verifier 通过。Chrome spanning、Firefox 140.0 和所有既有 manifest 权限逐项未变。

全部原始命令、UTC、耗时、退出码、stdout/stderr、红测输入、失败修正、完整 JSON／覆盖率、源码／产物／权限／类型绑定在 records；公开副本仅替换 CW 绝对路径及清理末尾空白，原始和公开 SHA256 分开保存。只在 CW 本地运行，复用已安装依赖；无云、MII、搜索／模型 API、GUI、GPU、模型下载、依赖安装、凭据或安全设置变更、后台常驻、新 MCP、远程控制端口、额外 Codex/Work 任务、子代理、PR、合并或强推。既有 127.0.0.1 WebDAV 和 spawnSync 是离线全量夹具。圈选／vision／probe、字典／单词卡和其他视频／文档入口的专用路由仍未完成；真实浏览器、供应商与 RTX5090 验收未运行。
