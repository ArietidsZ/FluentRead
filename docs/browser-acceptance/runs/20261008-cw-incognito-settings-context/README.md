# CW 私密路线设置与可信扩展页来源：离线验证

源码 **`7c15ac5bfe613d6e4523f4a7fb2d8ae17852f708`**，tree **`12c609c1826c938e8cbb8509b2f9e7db81712fd1`**；父提交 `15c933d4`，权限基线 `89fd0580`。所有最终验证期间 4,308 个源码/测试/配置及既有文档输入的 SHA256 均未改变；后续只添加本证据目录。此目录是离线源码与构建记录，不是浏览器验收通过记录。

设置页复用既有服务、模型列表与自动保存草稿，新增独立私密服务/模型控件。两字段全空保持现有行为；不默认填模型，保留失效状态，可显式清空，已有模型与凭据不受清空影响。七种界面语言沿用全局语言选择，扩展专用文案与控件在油猴构建排除。编译后的实际 Vue 控件、设置父组件、后台装配工厂/原生消息 router，以及真实配置 store 的字段 patch、重载与清空均有夹具测试；持久化端口使用测试存储，未接触用户配置。

每次执行独立解析 regular/private/unknown。本扩展原生 tab.incognito 严格布尔值优先；无 tab 时仅绑定原始 sender.documentId 的唯一 getContexts 记录，校验本扩展 origin、URL、contextType、布尔值及原生 frameId。Firefox origin 来自 getURL('/')，不把 runtime.id 当 URL host。客户端身份字段、当前活动标签页与同 URL 的新文档不能提供来源证据。缺失、歧义、异常、消失和旧 Firefox API 路径均为 unknown。

Chrome spanning 的无 tab POPUP/SIDE_PANEL 即使匹配 incognito:false 仍保持 unknown；仅 TAB 的 false 可认证普通来源，TAB/POPUP/SIDE_PANEL 的 true 才可认证私密来源。配置专用字段时 unknown 在缓存/provider 前明确拒绝；两字段全空保持原有行为。设置读取/保存等 typed UI 消息不受翻译闭锁影响。多模型对比的普通/未启用路线保持各卡片模型；私密专用路线明确拒绝，不把各卡片改成同一模型。

最终全量 **9,703/9,703**，398 文件，零失败、零跳过。statements/lines **65,633/65,633**、functions **4,547/4,547**、branches **33,258/33,258**，四维门槛保持 **100%**。相关回归 **350/350**；架构 **1,370/1,370**。类型、审计、Chrome/Firefox/文档构建和 manifest verifier 通过。油猴 **1,954,978 bytes**，通过未修改的 **1,955,000 bytes** 预算；797 个本地产物保存 SHA256，不将构建当成安装或运行通过。

生成 manifest 的 permissions、optional_permissions、host_permissions、optional_host_permissions 和 incognito 与接受的 `89fd0580` 本地构建逐项一致。incognito 字段仍省略，即 Chrome 默认 spanning；Firefox strict_min_version 保持 140.0。没有新增权限、改 split、改凭据、创建 PR 或调用真实搜索/模型 API。

`VALIDATION.json` 汇总最终结果；`records/SOURCE-BEFORE.json`、`SOURCE-COMMIT.json`、`ARTIFACT-SHA256.json`、`PERMISSIONS-COMPARISON.json` 和完整测试/coverage JSON 绑定输入与产物。`RAW-RECORDS-SHA256.json` 为 CW 原始记录哈希，`RECORDS-SHA256.json` 为公开副本哈希。公开副本仅替换本机绝对路径及日志行尾空白，原始记录保存在 CW 本地。

初轮 UI 断言属性名、测试数组参数形状、类型检查、Git 子进程沙箱限制、本地化扫描以及油猴预算失败记录全部保留。首次完整回归运行期间发生源码修正，其 9,699/9,701 结果仅用于问题定位，不能绑定当前源码；最终回归固定输入后完整通过。

[实现与兼容边界](../../../incognito-route-first-batch.md)说明尚未完整接线的阅读/写作/输入、独立图片与两个视频运行时，以及配置变更缓存失效/取消和更多功能入口语义。真实浏览器原生行为、完整私密功能、供应商 API 和 RTX5090 WebGPU 未运行。Xvfb 安装仍等待另项批准，本批没有安装或重复显示环境探测。

来源契约依据 [MDN getContexts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/getContexts)、[documentId 生命周期](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Work_with_documentId)、[兼容版本数据](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/runtime.json) 和 [Chromium 官方上下文测试](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/extensions/api/runtime/runtime_interactive_apitest.cc)。这些静态依据与 mock 组合测试没有替代 CW 实机验收。
