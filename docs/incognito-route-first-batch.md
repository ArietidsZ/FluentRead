# 私密来源专用路由：已实现边界

独立配置字段为 `incognitoService` 与 `incognitoModel`，默认均为空。两个字段均空时沿用原有翻译行为。通用设置的功能服务分配页新增专用路线控件，复用服务和已有模型列表，通过原有配置草稿与自动保存机制持久化。选择服务不会替换或清空模型；失效服务、已删除模型和错误类型保留可理解的错误状态。清空按钮显式清空两个字段，不删除已有自定义模型或凭据。

以上专用路由仅用于浏览器扩展。油猴构建没有可核验的原生 runtime sender，因此保持普通路由，不初始化或启用专用配置；导入的字段按原有机制保留，回传扩展后仍由扩展验证。构建适配器排除扩展专用路由代码，产物继续接受既有体积校验。

配置专用服务时，AI 和本地模型必须填写实际模型编号，且编号必须存在于服务目录或该服务已保存的模型列表。自定义服务必须仍存在于 `customOpenAIProviders`，模型必须属于该服务。真正不使用模型的翻译服务可以只填写服务。自定义模型占位符、已删除的服务、未知模型、错误字段类型和不完整配置会拒绝私密请求；本地未知模型不会进入默认模型回退。

当前接入通用无 `type` 后台翻译消息入口与 typed `inputBoxTranslation` 输入框消息入口。来源分为 `regular`、`private`、`unknown`。本扩展原生 `sender.tab.incognito` 的严格布尔值优先；原生 tab 存在但布尔值缺失或格式异常时保持未知。客户端布尔值不会提升身份，代码不查询活动标签页。

无 tab 的扩展页每次执行独立使用原始 `sender.documentId` 查询 `runtime.getContexts({documentIds: [originalDocumentId]})`。返回必须是数组，精确匹配唯一记录，并校验合法用户页面 contextType、严格布尔值、非空 contextId 和本扩展 documentOrigin/documentUrl；原生 sender 提供 URL、origin 或 frameId 时还必须一致。扩展 origin 从 `runtime.getURL('/')` 派生，Firefox 的 runtime ID 不必是 URL host。URL 只确认扩展归属，不能证明私密身份。记录缺失、歧义、异常、过期或 API 抛错均保持未知，不能按同 URL 或新标签页重新绑定。来源是一次请求的快照，不承诺文档之后仍存活。参见 [MDN getContexts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/getContexts) 和 [documentId 生命周期](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Work_with_documentId)。

跨浏览器保守规则只接受 `TAB` 的 `incognito:false` 为普通来源；精确匹配的 `TAB`、`POPUP`、`SIDE_PANEL` 的 `true` 才可成为私密来源。Chrome spanning 的私密 popup/side panel 可以使用普通 profile，其 `false` 不能证明用户来自普通窗口，且官方测试里的 tabId/windowId 为 -1，因此不会用 windows.get 或当前活动窗口解除闭锁。BACKGROUND、OFFSCREEN 和 DEVTOOLS 不能认证用户操作来源。此规则是对 [Chromium 官方上下文测试](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/extensions/api/runtime/runtime_interactive_apitest.cc) 的保守实现边界，尚未实机验收。

代码对 getContexts 和 documentId 做特性检测。Firefox 140 虽有 getContexts，但缺少 sender/context documentId，因此无 tab 页面无法精确绑定；Firefox 153 以上仍须拿到完整匹配证据。没有提高 Firefox 最低版本，也没有新增权限。兼容版本依据 [MDN 浏览器兼容数据](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/runtime.json)。

broker 等待水合后同时检查当前配置与请求快照。任一方专用字段非空或畸形时，未标记来源按未知处理，在缓存键、缓存和 provider 之前以非重试 `TRANSLATION_SOURCE_UNKNOWN` 拒绝。旧空快照不能绕过后来启用的策略，当前清空不能放行旧受保护快照；双方真正未设置才保留旧行为。明确标记为普通的请求不受无效私密配置影响，已标记请求保留捕获策略。来源未知的翻译拒绝时，给出可理解错误，绝不退回普通模型。两个字段全空时保留现有行为。该闭锁只作用于翻译执行，不拦截设置读取、保存或其他 typed UI 消息。

broker 等待配置水合后，在缓存及 provider 异步工作之前复制配置、验证专用路由并冻结服务与模型。功能层的服务或模型 override 不会替换已选私密路由；在途请求也不受后来配置编辑影响。快照保留并冻结 `customModels` 和自定义服务模型列表。

保存为自定义模型的 `deepseek-chat` 或 `deepseek-reasoner` 在私密路由锁定后保持精确 ID；Chat 与 Responses 的实际请求模型必须等于缓存身份。普通请求继续使用原有旧 alias 迁移规则。真实供应商是否仍接受某个保存 ID 不属于离线验证，失败也不会自动改用别的模型。

高级请求体中的 `model` 或 `Model` 必须与专用模型完全相同，否则在缓存及传输之前拒绝。该规则覆盖普通 OpenAI 请求体、Hunyuan 的大写 `Model`、Qwen MT 和 Doubao 合并请求体。显式 Gemini URL 模型或 Azure deployment 与专用模型冲突时拒绝，不修改端点或凭据。普通请求原有高级请求体规则保持。

翻译中心对比请求显式携带 `requestPurpose: 'comparison'`。普通来源及专用字段全空的请求保留各卡片原有服务和模型；可信私密来源启用专用路线时明确拒绝对比，不把所有卡片静默改成同一模型。该字段只约束执行语义，不能提供或提升来源身份。

manifest 保持 spanning。Chrome spanning 下私密窗口是否能打开扩展文档页由浏览器决定；没有改成 split 来绕过，也没有把旧 profile 或私密数据移交给新浏览器。

输入框入口等待水合和原生来源解析后一次读取配置，在输入专属服务、模型与提示词能力判断之前验证并锁定私密路线。私密服务和模型优先于输入 override；通用 AI 保留输入专属提示词，机器翻译与原生 MT 保留原协议规则。实际 availability 包装保留来源与快照 symbol 的属性描述符，broker 与最终 provider 使用同一捕获身份。内容页配置指纹包括私密字段、模型登记与候选连接哈希，并复用既有请求 ID、编辑代次、配置 generation 和 signal 的晚到提交防护。配置变化会作废结果，不能写回旧输入框；这不等于后台请求已取消。

图片／漫画、圈选文字与视觉转录、单词卡翻译以及真实视觉能力探测仍未携带可信来源。启用专用路线后它们到达 broker 时会暂时闭锁，普通页面也受影响；不会人为标记 regular 绕过。关闭策略仅能放行双方均为空的新请求，旧受保护快照继续拒绝。此行为是暂时的准入隔离，不代表这些运行时完成私密路线接线。视觉探测可能已执行本地能力缓存准备，但不会因此调用 provider；已有本地规则或缓存无需网络时不经过 broker。

阅读与写作独立 modelGateway、字典查词绕过该 broker，仍未受此路线保护。两套视频和文档等全部入口与缓存仍待逐项核验。输入框后台取消协议和 cancellation ID 是后续依赖，本批不扩展事务注册表、Port 或 ABA 修复，也不把随机 ID 当授权。设置界面用七种语言说明已接入和临时受限范围；选择成功不代表所有运行时已支持。

测试使用固定夹具和 mock 传输；不读取真实配置或认证文件、不调用真实模型或搜索 API。浏览器加载、开发者模式和真实 RTX5090 WebGPU 验证仍未执行。
