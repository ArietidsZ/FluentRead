# CW 单词卡 SPA 路由失效与迟到响应

源码 **`26b0e678d5738d52b1567c5d19cc5dff4fb450e5`**，基线 **`4e9c781d8b2f55c2cd0091be40db69ad39e9379f`**；分支 `fix/incognito-model-route-20261008`。本轮只修改 SelectionTranslator.vue、已有 wordCardPrivacyRoute.test.ts 和 docs/testing.md。**#883 未查询、修改或回复。**

最小真实负控先在原实现复现：生产 `installShadowAndRouteBridge` 包装合成 History，pushState/replaceState 实际产生 document `fluentread-route-change`；源 Text 与 Selection/Range 在导航后仍连接且有效，没有触发 selectionchange、popstate 或 hashchange。迟到主/辅助 SDK 均未取消，释放全部响应后主译文和释义/例句进入生产模板 DOM，模型缓存写入 **3 次**。冻结夹具恢复基线 SFC 的负控 **2/2 失败**，另 **46** 是 `-t` 过滤；失败不是实机 API 泄漏证明。仅恢复 SFC，随后逐字节还原当前源码。

修复接入同一 document 路由信号，仅 URL 变化时复用 hideAll 取消主/辅助请求、清空旧内容并隐藏卡片。监听器使用 mounted 内部局部绑定，复用组件现有 disposer 数组；不增加顶层 setup 导出或另一套路由桥。相同 URL History 更新、重复同 href 信号保留当前新代次。关闭卡片中止请求，同时保留已挂载组件的单一监听供未来卡片使用；重复卸载清理监听，重挂载恰好安装一个。

新增 **8** 项：push/replace 延迟主辅助负控、两类相同 URL 正控、重复信号与新代次、关闭/卸载重复清理和重挂载、native false 普通兼容。原 **40** 项保留，词卡 **48/48**；连同旧 lifecycle、原生路由、handler 和 bridge 核心的专项 **231/231**。实际 SFC setup 和生产模板经 Vue renderer 渲染到 linkedom；真实 store/client/Port/registry/handler/broker/SDK/cache 与生产 route bridge 执行，生命周期 hook 用受控回调；布局、DOM Selection/Range/History、非模型 lookup provider 与 HTTP 为合成边界。没有用 popstate/hashchange 替代 push/replace 证明，也不声称真实 GUI 或 numeric SFC 100%。

保留首次 vitest PATH ENOENT 启动失败记录及初版辅助响应释放不足的负控记录；最终夹具释放新产生的辅助 HTTP 响应并修正文本展示子组件边界，冻结负控能同时观察主/辅助 DOM 与缓存。修复后的最终完整门禁没有失败、删用例或降低阈值。

完整严格回归 **10208/10208**、**410 文件**，零失败/跳过、退出 0；S/L **66113/66113**、F **4608/4608**、B **33766/33766**，四项 **100%**。架构 **1379/1379**；审计 **499 文件/6900 cases**；类型、Chrome/Firefox/userscript 构建、manifest/userscript verifier、文档均退出 0。严格执行列表、测试矩阵、覆盖归属、阈值、ignore、所有预算与构建设置保持基线。

基线油猴单独恢复 SFC 重建并与前批绑定 SHA256 核对；最终 **1954998 bytes**，预算 **1,955,000**、余量 **2 bytes**，相对当前基线 **+0 bytes**；逐字节一致 **False**，SHA256 **`55aeef43aba4fcba6f4d54a16d9b8c5260f213b70b30fb19b8bd54b148c9febe`**。此前 commentary 在 hash 核验前误称逐字节一致，实际证明 hash 不同后立即纠正；不推断差异仅为变量重命名。普通兼容由实际 native false 控制与既有 verifier 验证。Chrome/Firefox manifest 安全字段未变。

原生来源三态、文本通道、registry、broker、content composition、route bridge、独立非模型词典及旧 typed lookup、视频都未改。未运行真实模型/搜索 API、浏览器 GUI、GPU/WebGPU、下载或个人 profile 操作；未新增权限、MCP 持续访问、后台常驻、远程端口，未启动子代理或额外 Codex/Work 任务，也未操作 MII/云环境。

历史 loopback 审批元数据缺口继续单列，未重跑或补造历史授权。当前完整门禁在独立单次审核下使用既有临时 127.0.0.1 WebDAV 合成夹具和本地只读 git 子进程；`CURRENT-GATE-EXECUTION-METADATA.json` 记录实际请求与工具返回，工具未暴露签名审批决定。此条件不授予持久网络或产品权限。

`SOURCE-BINDING.json` 将 **2913** 个冻结门禁输入绑定到源码 Git blobs，并核对 **797** 个产物；**27** 个关键授权/通道/注册表/路由桥/词典/门禁及油猴文件保持基线。`RAW-PUBLIC-BINDING.json` 绑定 CW 原始与脱敏归档；`SHA256SUMS` 覆盖其余全部归档文件。

证据目录加入后再次构建文档，`docs-build-with-evidence` 退出 0；源码和扩展/userscript 产物未改变。
