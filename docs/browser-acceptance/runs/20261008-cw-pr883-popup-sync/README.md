# CW Draft PR #883：最新 main 适配及版本绑定验收

源码为 `1d196af45b5e15ae9261790e40204f17c16b49bc`，同步 main `9ce9d7b5b4bf9b29617b847c49a1c441d986ee12`。原 PR 分支保持普通合并历史，原始 `6268b171` 为祖先；未合入隐私/图片取消大分支，未 cherry-pick 已合入 main 的 #882，未 force push、创建新 PR 或转为 ready。

相对 main 仅五文件差异：PopupServices 的有效模型展示、原 PR 真实 Vue 回归测试、现有生命周期测试翻译夹具、唯一矩阵注册和测试文档。生产 SFC 9 行新增、5 行删除；默认/继承/独立模型复用既有解析函数，机器行无模型，使用既有本地化 modelScope，aria-label 保留原服务说明并追加模型，title 保留完整模型。main 的 credential-model 参数、selectionMatches、capture/revision、PickerSession、viewRevision、ownsSession/ownView、旧事件与供应商删除检查、连接/用户焦点复验均保留；哈希与逐字比较见 MAIN-PRESERVATION。

## 最终源码的验证

- 15 个相关测试文件 **224/224**，零失败/跳过；包含 Popup 生命周期、KeepAlive/卸载、配置替换、跨功能旧事件、用户焦点移动与新 main 目录/配置适配。
- 测试审计、TypeScript/Vue 类型检查、Chrome/Firefox production 构建、manifest verifier、文档构建均退出 0。未安装新依赖，使用 CW 已有 Node_modules；没有为旧夹具削弱产品保护。
- **真实工具栏 Popup 四项通过**：默认/继承/自定义/功能覆盖模型、完整 title/aria-label 与溢出截断、搜索保持模型、机器翻译行不显示模型及所属行焦点返回。通过生产 chrome.action.openPopup 和 chrome.extension.getViews({type:'popup'}) 确认，未打开普通 popup.html tab 代替。
- 架构组不是全绿：两项失败与独立最新 main 基线完全一致，分别为 wxt excludeSources 字面断言和 userscript 固定资源提交缺少新语言文件。文档 verifier 同样在 main 基线失败：设计系统英文页缺少预期 Storybook link。原始退出码、完整 JSON 与日志保留；没有修改断言、覆盖率阈值、ignore 或构建排除。
- 未运行本 PR 的全量回归或 userscript 构建；未宣称该 app SFC 为四维严格覆盖率所有权模块。具体架构总数见 SUMMARY。

## 浏览器运行边界

官方 Neo 已装版本 Chrome/155.0.8309.26。仅复用获批 CW Linux 隔离 headed X11 方法：独立临时 HOME/XDG/profile、私有 D-Bus、带认证 Xvfb，正常 1280×900 窗口位于 1440×1000 隔离显示的 (60,40)。没有窗口进入日常 GNOME 桌面，没有 bringToFront、最小化、headless、no-sandbox、非回环控制端口。仅单个获批 BrowserOS loopback CDP，进程的 BrowserOS server 禁用，不新增持续访问。

临时配置只指定 Ollama 的合成模型名与机器服务，走生产 persistConfig；没有凭据字段或 API-key 开关变更，没有实际 Ollama/供应商/搜索 API、模型下载、GPU 执行或 RTX5090 WebGPU 验收。所有 browser HTTP(S) 在测试边界禁止，DNS 同样限制；本次被拦 HTTP(S) 请求数 0。仅验证生产 Popup UI 与本地选择行为，不代表完整翻译/产品验收或 Firefox 实机 UI。

应用 SHA、manifest/background SHA、源码输入及两种产物文件 SHA 固定于 records；所有权 helper 只更新原方法中的三个 literal pins。测试后本次 PID、监听和 X socket 均为零，浏览器二进制和 Cua GUI-only policy SHA 未改变；日常浏览器未关闭。隔离 profile 留在本机供复核，认证文件、数据库、Xauthority 和临时 cookie 没有上传。

## 记录说明

records/latest-*、driver-final、gui-final 为最终 1d196af4；其余记录是同步过程的真实历史：第一轮 156/157 的唯一夹具失败是在配置变更后未等待 Vue rerender，补 nextTick 后通过，产品保护未改。随后 d6b3a203 + f6aa main 的 178/178 与四项真实弹窗结果保留，但不冒充最终源码结果。独立 main 初次缺少 WXT 生成 tsconfig 的尝试也保留，prepared/最新基线运行才是失败来源对照。

证据分支独立于原 PR，避免审计记录扩张其五文件差异。公开文本中的应用日志 query token 参数已脱敏，见 PUBLIC-REDACTIONS；原始记录仅留 CW 本机。
