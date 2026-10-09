# 共享 Retry-After 冷却 · 2026-10-09

真实 HTTP 429 和有效 Retry-After 的 503 反馈到既有 requestScheduler，新的 broker 请求与 AI SDK 的真实 HTTP 重试共同等待。SDK 保留重试所有权和次数，provider、model、prompt、batch、token 与总 deadline 保持既有语义。429 缺省/无效头复用首次 2 秒退避；503 无有效头、401、403 不新增共享冷却。支持数字秒、HTTP-date 和 retry-after-ms，极端等待上限 7 天且受原有 deadline 限制。

SDK 外层逻辑任务保留 deadline、取消与额度冷却，不计并发/速率；真实 scheduleAttempt 在同一既有池中各计一次，直到原始 runtimeFetch settle 才释放 counted 槽位，包括传输忽略 abort 的情况。非 SDK 与连接 probe 保持既有外层计数和持槽，没有另建池。summary、single、batch 的 pending 摘要包含有效配置 Key 集合、轮换/恢复设置及隐私；真实 transport 摘要使用本次实际选择的 Key。成功缓存规则保持不变，摘要不输出凭据。

可信 sender.tab.incognito 区分普通与私密来源；无 tab、无明确布尔元数据均保持 unknown。spanning 后台自己的 inIncognitoContext 不能代表发送者，因此不再把它传入消息 context。typed input、图片活跃事务→offscreen 与 area text/vision 都保留该身份，payload 的 sender、隐私和额度字段不能授予权限。没有增加 tab 查询、平台权限或新的元数据框架。

## 本轮两项精确反例

当前批次从 10675d79f0a1f523e609ff48b7a2cca0e045b690 接续。真实 runTranslationServiceConnectionTest→锁定 SDK 与真实 broker 共用 scheduler：cap=1 的 probe 在 0ms 收到429，SDK于2000ms重试，broker真实 counted attempt 在10ms排队。旧 keepWaiting 把 counted attempt 也写进 waitingAttemptKeys，因而挡住已持有外层槽的 probe retry，直到 deadline 才解除。

最小修复仅让 attemptOnly && !countConcurrency 进入该旧重试阻塞集合，counted FIFO 保留。global、service、model+service 三种同桶各测正常完成、队列取消和队列 deadline，共9项；probe的第二个原始传输受控保持未决，settle后健康B才恢复，实际inflight峰值为1，取消/超时B不迟到派发。旧实现有效红例为6失败、取消对照3通过：[红例](./mixed-probe-red.json)。夹具使用允许无Key的custom连接检测；指定非空Key的检查路径会有意禁用SDK重试，最初错误夹具不算有效红例。

真实 installBackgroundMessageRuntime 注册 browser.runtime.onMessage，实际 router→typed input/fallback 接收无tab扩展页面消息：后台普通/私密状态都应保持unknown，反向真实tab状态仍优先于后台和payload。旧实现4个无tab断言失败，4个真实tab对照通过：[红例](./message-runtime-red.json)。新测试不手工调用context factory，只替换无关feature构造器和翻译外部端口。

## Occam 核查与独立 SVG 候选

全仓TypeScript调用点核查确认：provider scheduler context 的第四个lease参数只由broker传入；唯一生产读取者是openai-compatible，其lease分支要求没有quotaScope，而broker SDK都有quotaScope。connectionTest和直调测试只传二/三参数。因此删除该无消费者字段、参数、broker传递和adapter空分支；fetchAttempt直接await原始runtimeFetch再observeResponse。[调用点审计](./provider-lease-call-audit.json)。scheduler/client/broker/probe自己的lease、broker counted attempt的真实传输持槽机制保留，既有取消与忽略abort容量契约继续执行。

复用同一provider attempt中的三次isAiSdk检查。清理前标准产物1961680字节，清理后1961493，组合实测节省**187字节**；不把各处源码字符差当作独立产物收益：[实测](./occam-size.json)。

SVG压缩与冷却没有功能依赖，标准生产图也不引用ServiceIcon或serviceBrandPaths.json。本轮把userscript/vite.config.ts的SVG专项修改与新增专项测试从#906当前diff撤出，保存为CW本地独立候选，没有新建公开PR。原图标、JSON和许可保留。历史一次必要去压缩standalone构建3798107字节，对应10675中包含SVG压缩的3780639，收益**17468字节**仅适用于该独立候选：[历史实测](./svg-size-comparison.json)。它不作为标准包体积方案。

## 验证

57个相关测试文件 **1669/1669通过**，包含83个scheduler/retry契约和8个真实安装messageRuntime隐私契约；8个既有严格模块statements/branches/functions/lines均**100%**：[范围与测试](./affected-tests.json)、[覆盖率](./coverage-summary.json)、[源码SHA256](./source-sha256.json)。SDK adapter、areaRuntime和messageRuntime整文件原本不在该严格范围，实际改变的传输和composition路径已执行，不声称这些整文件100%。TypeScript、测试审计、Chrome/Firefox构建通过，文档构建以[阶段记录](./validation.json)为准。

既有implementationAudit48A仅在上一批修正过时Bilibili DNR规则断言，生产实现未改；精确规则、保留外部42、hydration前后和无fetch检查继续通过。原broker取消/超时、raw-inflight max1/max3、纯broker速率/FIFO、pending凭据集合与普通/私密隔离等契约全部保留。

原30种子白名单setRuntimeFetch重放证据来自10675，并随本轮相关套件复验同一契约；没有重复未变B0基线或另跑30次构建。历史B0/B1-C为60/120成功、270 HTTP attempts、180次冷却内额外A派发；C为120/120、150、0。健康B时序/状态/17511实际UTF-8 body字节逐项一致：[B0](./replay-B0.json)、[B1-C](./replay-B1-C.json)、[C](./replay-C.json)。body字节是载荷代理，不等同供应商token计费，不证明真实供应商/GPU/WebGPU性能。

此前九项消融2/2/3/2/4/12/6/3/1失败及饱和消息边界红例仍保留为**10675历史证据**：[消融](./ablations.json)、[饱和红例](./saturation-red.json)。其中SVG已经拆出、provider context lease已经清理，不把旧消融冒充当前源码独立审计。

## 同工具链体积基线归因与阻塞

在同一CW checkout、同一Node26.7.0/pnpm9.12.1/Vite5.4.19及原锁文件上，暂时恢复全部未修改的8467b6757affb4bc895d44fa8fbf12a65bee7479 tracked tree并验证无diff，各测一次标准/standalone/GreasyFork与原verifier，随后逐字节恢复候选。原标准入口复核与只读module归因hook产物SHA256完全一致。当前标准基线为1959494字节，余506；历史1959450记录单列，差44字节，未用历史数替代本次测量。[基线/候选原始字节与SHA](./size-attribution.json)。

| 产物 | 未修改基线字节 | 当前候选字节 | 新增字节 | 既有上限 | 基线超限 | 候选超限 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 标准 userscript | 1959494 | 1961493 | 1999 | 1960000 | 0 | 1493 |
| standalone | 3795702 | 3797668 | 1966 | 3600000 | 195702 | 197668 |
| GreasyFork source | 2320196 | 2324257 | 4061 | 2000000 | 320196 | 324257 |

标准verifier基线通过、候选因体积失败。standalone体积失败和GreasyFork体积/固定资源失败在未修改基线已经存在，候选的额外字节分开列出。GreasyFork的Vite阶段生成产物，外层构建因固定fluentread-data.v1.js不一致返回失败；候选生成数据SHA与本次未修改基线完全相同，证明本批没有新增这项资源差异。基线已有document.pdfReading词条而固定数据缺少对应键：[资源差异](./baseline-resource-diff.json)。未执行--prepare-resources、发布/替换固定URL、修改资源或提高budget。

标准bundle没有新增module ID。Rollup未压缩tree-shaken renderedLength增量定位为requestScheduler+1924、broker+812、SDK adapter+308、requestSnapshot+171、typed input+79；这些是模块归因代理，不能相加当作最终minified字节。最终产物增量以表格为准：[模块归因](./standard-module-attribution.json)。本批未进行广泛压缩或框架调整。

#906保持draft：标准新增体积回归、standalone/GreasyFork原有失败及新增字节、固定资源失败和当前独立审计仍阻塞ready。所有命令使用原资源保护器串行运行，CPU目标60%、worker1、并发1；CPU目标为协作式限制。外部模型/搜索API调用0，未新增依赖/权限/环境，Recovery全部窗口和进程未操作。真实供应商、GPU/WebGPU测试未运行。
