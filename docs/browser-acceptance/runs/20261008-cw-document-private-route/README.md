# CW 文档翻译有效隐私路由与源文件保留

源码 **`0d955d590d5aa781a372c7e84e3c01aef8d5dc54`**，基线 **`d8e4091beb9113451cedf8052f54c22edc5ca80f`**；独立分支 `fix/incognito-model-route-20261008`。生产改动仅 DocumentApp.vue、index.ts、runtime.ts。本批先完成文档页；全页翻译架构不同，未纳入本切片。设置页独立 probe、字典单词卡、视频仍待接入。**#883 未改动或回复。**

文档页的原生扩展上下文提示统一专用服务/模型显示、选项、凭据与模型能力预检。runtime 在现有 feature 的 batch、文件上下文和客户端 credential/modelThinking 选择前解析有效 pair；普通线路缺凭据或不支持上下文不再误挡合法专用线路。提示不构成执行授权，不增加可信来源字段或自建 RPC。最终执行仍由既有文本 Port/registry/handler/broker 的 native sender/getContexts 三态判定；unknown + 已配置 pair 拒绝，regular 和 pair 两字段全空兼容。传输 ID、私密标记和本地配置摘要不进入 provider JSON 或持久缓存身份。

真实配置保存、禁用、pagehide、关闭/unmount 撤销翻译/下载代次，实际 SDK AbortSignal 中止，迟到结果不写回/缓存/导出。路由、连接、prompt/context/cache 等摘要变化清除译文、校订状态、译文 PDF URL 和导出代次；**已解析源文件对象、导入失败信息、在途解析与原 PDF URL 保留**。摘要保守比较整份相关映射，所以普通模型或其他服务连接变化也会清除当前私密文档译文。语言/术语变化取消在途代次，已校订结果沿用原显式重译确认流程；计数/UI 设置不作废结果。

新增 **53 项**通过实际编译的 DocumentApp setup → 文档 runtime/解析/分段编排 → 客户端 → 原生 Port/registry/handler → broker → fake-indexeddb 缓存 → provider/AI SDK；只在配置持久端口、浏览器原生边界、延迟导出和合成 HTTP 处使用夹具。覆盖有效凭据及文件上下文、私密 AI 的 18 条与机器的 16/2 拆批、普通/专用缓存及 endpoint 身份、未知与伪造来源、原生 getContexts、九类实际保存、待准备/关闭/导航取消、源队列保留、单文件与 ZIP 的迟到进度/下载点击阻断。

基线负控 **11/11 失败**，另 34 pending 是 `-t` 过滤，不是验收跳过；展示旧前端/编排/取消差异，不是实际外发泄漏证明。初轮 **71/80** 的九项失败来自浏览器 mock 缓存和 null/空值断言，后续修复记录完整保留。额外 runtime 初诊 F **7/8=87.5%**，补上真实 both-empty 默认服务/术语回调兼容控制后，最终诊断 **98 项全通过**，runtime S/L **56/56**、F **8/8**、B **19/19**，四项 **100%**；该模块不在原严格覆盖归属中，SFC setup 控制也不冒充 numeric SFC 覆盖或真实 UI 验收。

第一轮全量退出 **1**：**10,093/10,099**，零跳过；5 项既有 WebDAV 测试被沙箱 `listen EPERM 127.0.0.1` 阻止，1 项本地化检查失败，另旧文档格式示例文件因浏览器/目录边界 mock 缺失无法加载。WebDAV 既有五项在已授权的本地临时 loopback 执行中 **5/5**；复用既有七语言扩展文案并修复示例边界，原 12 个格式导出检查保留。其后文档/示例/i18n 专项 **168/168**。未降低阈值、跳过测试、扩大产品权限或改变系统设置。

最终完整严格回归 **10111/10111**，**408 文件**，零失败/跳过，退出 **0**；S/L **66090/66090**，F **4606/4606**，B **33706/33706**，四项 **100%**。架构 **1,379/1,379**，唯一归类审计 **497 文件/6,853 cases**，类型、Chrome/Firefox、manifest verifier、userscript build/verifier、文档构建均通过。只向 functional matrix 和 strict 执行列表各加入新文件；原覆盖归属、阈值、ignore、既有条目、16 个传输/授权/注册表/依赖/构建门禁文件不变。

Userscript 完整产物与前批本机基线**逐字节一致**：**1,954,981 bytes**，SHA256 **`b744392b363cd909bbedd7e1c7ba7415c604f3f29435f2bbac623b91941bf453`**，差值 **0**；上限 **1,955,000**，余量 **19 bytes**。未增加预算或更换依赖/压缩。Chrome/Firefox manifest 的权限、主机权限、incognito、CSP、Gecko 设置与基线一致。

`records/SOURCE-BINDING.json` 将 **2911** 个冻结输入 SHA256 与源码 Git blob 对齐，绑定 **797** 个构建产物；最终门禁在提交前运行，字节与提交完全相同，未伪写命令 HEAD。早期失败/修复轮次有独立作用域。records 保留命令、UTC、耗时、退出码、stdout/stderr、完整结果与覆盖率；RAW-PUBLIC-BINDING 单列本机原始/公开摘要，SHA256SUMS 校验公开档案。

仅在 arietids-cw 使用现有依赖和离线夹具；未调用真实模型/搜索 API、打开浏览器 GUI、下载模型或实际文件、运行 RTX5090/WebGPU 验收、启动额外 Codex/Work 或子代理、改凭据/默认项/权限/安全设置、建常驻/MCP/远程控制端口或操作 MII。本批是源码及确定性离线验证，不是部署或实机浏览器验收。
