# B3-A：Doubao 两项增量修复的验证与闭合
本批由用户于2026-10-13批准，仅 B3-A/B3-B 两项。由用户启动 Claude Code；本文件不授权启动 Codex/Work、其他代理或第四批。
## 输入与隔离
- 仓库 ArietidsZ/FluentRead；此 handoff 分支仅承载任务和输入，不是实现基线。
- 实现基线为已交付 B2-B b758f218671e07e320fdfae5aee389268e6a3ad6；共同上游 cf52fdd80e2d39ad1f4b1a413c9660d45edddec6。
- 若本地没有交付提交，在独立目录从上游固定基线应用 inputs/b2b-delivery.patch，核对 inputs/b2b-delivery-reconstruction.json 六文件 blob；该重建不等于重建相同提交。不得把交接分支当实现基线。
- 对交付源码应用 inputs/b2b-parent-incremental.patch；先保留未改交付源码作红绿对照。不要 reset/stash/覆盖用户工作区，也不要使用 B3-B 的构建目录。
## 仅限两项实现
1. 失败 observation 不用 configuredModel 覆盖归一化后的 actualModel，保留服务端返回模型与用量。
2. Doubao Seed JSON-only 请求在 custom-body 合并后强制 stream:false，保持其他合法选项。
优先使用父助手现有补丁，只修本范围内实际发现的问题；不重写共享解析、Responses 校验、DeepSeek、调度、错误重试或取消框架。
## 测试契约
- 同一九个新增用例分别用于交付源码和候选：两例 incomplete/failed 模型身份与用量、七例 omitted/JSON true/false/null/string/numeric/raw-object 控制。
- 不要求九例全部旧源码失败；JSON stream:false 是应保持通过的对照。两个修改的现有 exact-body 期望单独计数。
- customBody 合法输入是 JSON 字符串；raw object 是被忽略的控制，不改变共享解析来使它通过。
- 两模型用例须观察错误、一次 observation、去除空白的实际模型及 input12/output3/total15。
- mock 仅 boolean true 返回 SSE；其他 stream 值由显式最终 stream===false 断言捕获，不把模拟行为说成真实服务器行为。
- 先执行九例红绿、受影响 Doubao/DeepSeek 组合；再按固定基线 docs/testing.md/package.json 做类型、必要测试分类审计及受影响构建。复用无关现有结果，不反复全扫；全局失败必须单独保留与同基线对照。
- 原交付59例通过是旧源码历史结果，不能作为本候选通过；旧全局 unit/functional/coverage 退出1，不可覆盖或改称全绿。
## 交付
准确基础/最终 commit 或重建 blob、独立补丁、改动列表、每条实际命令的UTC起止/退出码/输入与日志哈希、红绿原始日志、明确未执行项。临时 shim/环境 workaround 必须披露。
可存现有 Dropbox Workspace/Temp/fluentread-batch03/B3-A；不得推送实现、发布/合并PR、部署、真实或付费模型调用、读取真实凭据、改权限/安全设置、新建云环境或永久删除。仅合成文本与 mock 网络。
实现、源码审查、构建、模拟测试、真实验收分别报告。记录有效工作段和等待，不用会话寿命算有效工时。
