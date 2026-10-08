# CW 图片准备的同轮取消异常消费

源码 **`61d6641c3ef527de3ef6eeca753da3c18b7a1cef`**，tree **`f55b76078e2f58f9c5d9a3e2b1f801c1f2cd4c7b`**；基线 HEAD **`5faab19409097241618515ea5ecad4a026ce8c06`**，上一批应用源码 **`1fb8c69773df0de8fd35ddf723d7c995ed760731`**。只关闭同步取消与 execute 首个微任务之间的准备异常消费窗口，保留前批验收档案，不扩展 area/vision 或其他入口。

基线 run 同步创建 prepared，execute 的下一微任务先 assertActive，再调用等待 prepared 的操作。run 返回后同一轮 cancel/releaseOwner，或原生 Port receive 返回后同轮配置取消/断连，会先撤销记录；assertActive 在 await prepared 前抛错，prepared 的取消或迟到拒绝没有消费者。新增用例在 run/receive、取消及 gate.reject 之间没有 await/drain：两个真实 registry cancel/releaseOwner，两个真实 wrapper／handler／原生 Port receive 的配置取消/断连。监听真实 Node process unhandledRejection，两个 setImmediate 通知阶段后检查零异常、零 operation、快照未封入、dispatch/归属及配置控制器清理；不移除或替换 Vitest 的异常监听。

真实负控 **24 个，20 通过／4 失败**：19 个旧控制和新增未取消错误控制通过，四个同轮用例各捕获实际准备拒绝并失败。负控源码、原模块 Git blob、JSON 和日志保留。修复在 prepared 创建后立即 `if (prepared) void prepared.catch(() => {})`，原 prepared Promise 不被替换，原 await 仍返回真实准备错误。新增未取消控制核对返回同一 Error 实例；正常准备、显式取消和 deadline、迟到结果、原生文档与既有 provider 忽略 abort 的 lease 控制继续通过。没有新增 provider 全程 race，没有重建 owner/nonce/事务/截止时间或修改 app、来源授权、Offscreen、broker、scheduler、store、配置和依赖。

Green **24/24**；十二文件严格专项 **432/432**，两个原归属模块 imageGlossaryContext／operationRegistry 四项 **100%**。最终完整严格检查 **10,015/10,015**、**407 文件**、零失败／跳过：statements/lines **66,091/66,091**、functions **4,606/4,606**、branches **33,690/33,690**，四项 **100%**。原 include/exclude、阈值、ignore、测试矩阵和执行列表未改。架构 **1,379/1,379**／32 文件；审计、类型、Chrome/Firefox/userscript、verifier、源码文档构建通过。类型覆盖全部 **799 src、500 tests、15 entrypoint** TS/Vue，未缩小 tsconfig。

上一批 userscript 少 **26 字节**的原因有具体产物定位：同机基线产物 **1,954,988 bytes** 的 registry 工厂 **3,081 bytes**；1fb8c697 产物 **1,954,962 bytes** 的该工厂 **3,055 bytes**，工厂差值 **−26**，其余产物的字节数差值 **0**。源码在本次准备扩展中使用一次只读 snapshot getter，去除 spread／条件 defineProperty／二次 freeze；execute 复用同一个 controller.signal；晚到封入快照重用原 assertActive；三个相同 owner 表达式提取为 ownerFor，身份语义保持。中间产物 1,955,201 → 1,955,055 → 1,954,962 的观察记录与最终两版工厂源码、哈希在 `records/USERSCRIPT-26-BYTE-PROOF.json` 及对应 `.js`。这是工厂和整文件字节数定位，**不把其余内容字节数相同称为内容相同**，也不归因于修改构建参数、压缩器、权限或预算。

本批立即拒绝消费在实际 registry 工厂和整产物中各增加 **19 字节**，其余字节数差值 **0**；最终 **1,954,981 bytes**，原 **1,955,000** 上限未变、余量 **19 bytes**；SHA256 **`b744392b363cd909bbedd7e1c7ba7415c604f3f29435f2bbac623b91941bf453`**，见 `records/USERSCRIPT-CATCH-BYTE-PROOF.json`。冻结 **4,010** 个非归档输入，提交 Git blob SHA256 全匹配；绑定 **797** 个产物摘要。Chrome spanning、Firefox 140.0 和全部既有权限逐项未变；历史验收档案未改。

所有命令、UTC、耗时、退出码、stdout/stderr、red/green、完整 JSON/覆盖率、源码/产物/权限/类型绑定在 records；公开副本仅替换 CW 绝对路径及清理末尾空白，原始与公开 SHA256 分开。只在 CW 本地，复用既有依赖与离线夹具，没有云、MII、真实搜索/模型 API、GUI/GPU、模型下载、依赖安装、凭据/安全设置/权限/常驻/MCP/远程端口变更、额外 Codex/Work 任务、子代理、PR、合并或强推。既有 127.0.0.1 WebDAV/spawnSync 为全量测试夹具。本批不代表部署、浏览器或 RTX5090 验收。
