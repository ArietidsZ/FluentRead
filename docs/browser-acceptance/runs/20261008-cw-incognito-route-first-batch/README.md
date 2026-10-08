# CW 私密来源专用路由首批与 DeepSeek 审查修正

当前代码 **`4868aabe3393cdbf99df5edbdce1166acfc34583`**，tree **`f13710bd6d6945d0a22748c3379969ff92621757`**。基线 `89fd0580`；初版 `1fd6b064` 的历史证据保留在 `INITIAL-VALIDATION.json` 与原始记录中。初版通过的旧测试没有覆盖下述模型身份缺口，不能据旧结果宣称该缺口已验证。

审查修正：已保存的 `deepseek-chat` / `deepseek-reasoner` 在私密路由锁定后保持精确 ID，Chat 与 Responses 的实际传输 payload 必须与缓存模型身份一致。用提交后的相同回归文件复现旧版，**34 项通过、4 项失败**；保存两份实现 SHA256、测试 SHA256 和字节级恢复证明。修正的相关测试 **256/256**，普通 alias 迁移规则继续通过。

最终全量 **9,641/9,641**，396 个文件，零失败、零跳过；statements/lines **65,484/65,484**、functions **4,540/4,540**、branches **33,174/33,174**，四项门槛保持 100%。架构 **1,368/1,368**，类型、审计、Chrome/Firefox/文档构建和 manifest 核验通过。油猴 **1,954,938 bytes**，通过未修改的 **1,955,000 bytes** 预算；扩展权限与 `89fd0580` 构建相同。

`VALIDATION.json` 为当前汇总；`records/DEEPSEEK-*` 与 `records/deepseek-*` 是修正的源码/产物绑定、旧版红测、完整 coverage 和检查日志。旧日志未删除，公开副本仅替换本机绝对路径和日志行尾空白。原始记录在 CW 本地保留，目录内容用 `RECORDS-SHA256.json` 校验。

[首批实现边界](../../../incognito-route-first-batch.md)仍适用：未完成设置 UI、独立阅读/写作、输入/文档、图片/两个视频运行时、缓存失效/取消、精确 documentId 和对比页面语义。真实供应商 API、私密浏览器完整功能和 RTX5090 WebGPU 未运行。

[Neo 批准后的技术前提](neo-after-approval/README.md)单独使用 **`89fd0580` Port 修复构建**，不混用当前无痕修正。临时 profile 的批准已经记录；未满足不激活窗口与独立显示/会话前提，所以实际扩展 GUI 用例仍为 **0**。
