# 免费翻译接口与自动降级

核对日期：2026-09-05。以下额度来自供应商官方文档或定价页；以后申请服务时，以供应商当时的控制台和条款为准。

本次补充 **MyMemory** 和 **Azure Translator** 两个正式公开 API。小额度服务可以在其他服务不可用时接续，但每家服务自己的额度、语言和请求大小限制仍然生效。扩展不包含供所有用户共用的云服务密钥。

## 新增官方接口

| 服务 | 官方免费额度 | 申请与计费条件 | 在 FluentRead 中的用途 |
| --- | --- | --- | --- |
| MyMemory | 匿名每天 5,000 字符；提供有效联系邮箱后每天 50,000 字符 | 匿名调用无需注册、密钥或绑卡；邮箱为可选项 | 可直接使用的小额后备服务 |
| Azure Translator F0 | 每月 2,000,000 字符，标准翻译与自定义翻译训练共享这部分免费额度 | 需要自己的 Azure 订阅、Translator 资源和密钥；必须在 Azure 控制台选择 F0 免费层 | 用户配置后可启用的官方后备服务 |

额度来源：[MyMemory 使用限制](https://mymemory.translated.net/doc/usagelimits.php)、[Azure Translator 定价](https://azure.microsoft.com/en-us/pricing/details/translator/)。

### MyMemory

MyMemory 提供公开的 `GET https://api.mymemory.translated.net/get` 查询接口。必填参数为 `q` 和 `langpair=源语言|目标语言`；单次 `q` 最多 **500 UTF-8 字节**，不是 500 个中文字符。`de` 是可选联系邮箱，`key` 对公开查询并非必需。[官方接口规范](https://mymemory.translated.net/doc/spec.php)

FluentRead 会保留换行和分段边缘空白，优先在空白或标点处拆分超长文本，并保护全文翻译的内部文本槽标记。自动源语言先由现有本地算法保守推断；短英文单词、无法区分的共享汉字等不确定输入会跳过 MyMemory，继续尝试其他服务。也可以在翻译设置中明确选择源语言。

填写联系邮箱后，邮箱会作为 `de` 参数传给 MyMemory 官方服务。调用只使用 `get` 查询端点，不调用 `set` 或导入接口，不上传翻译贡献。匿名查询遇到额度不足会失败并触发后续降级，扩展不会自动购买更高额度。[接口规范](https://mymemory.translated.net/doc/spec.php)、[使用限制](https://mymemory.translated.net/doc/usagelimits.php)

2026-09-05 实际检查：以通用示例 `Hello world.`、语言对 `en|zh-CN` 调用官方端点，收到 HTTP 200、`responseStatus: 200`、`quotaFinished: false` 和译文“你好世界”；响应包含 `Access-Control-Allow-Origin: *`。这是单次公开接口可用性证据，不代表所有地区和后续时间都可用。

### Azure Translator

1. 在 Azure 创建 **Translator** 单服务资源，并在定价层中选择 **F0**。建议使用 `global` 资源。
2. 将该资源的 API Key 填入 FluentRead 的 Azure Translator 服务设置。
3. 若资源属于具体地域，填写控制台显示的地域标识，例如 `eastasia`；`global` 资源可留空。

官方快速入门明确区分 global 与 regional 资源：前者可以只发送密钥，后者还必须发送地域。[Azure Translator 快速入门](https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/quickstart/rest-api)

注册一般需要手机号、Microsoft 或 GitHub 账户，以及非预付信用卡或借记卡；具体地区有不同要求。免费 Azure 账户与 Translator 的 F0 定价层是两个概念：使用免费翻译时，应核实资源本身选择了 F0。S1 等付费层不能因为填写在 FluentRead 中就变成免费，扩展也无法从密钥识别订阅的计费层级。[Azure 开户说明](https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account)、[Translator 定价](https://azure.microsoft.com/en-us/pricing/details/translator/)

适配器使用 `POST https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=...`，通过 `Ocp-Apim-Subscription-Key` 认证；具体地域通过 `Ocp-Apim-Subscription-Region` 传递。自动源语言省略 `from`，明确选择源语言时发送 `from`。[认证文档](https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/authentication)、[Translate 接口](https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/v3/translate)

Azure Translate 单次最多 1,000 项、合计 50,000 字符；FluentRead 对批量输入按这两个上限分批，超出单项上限则在发送前返回错误。服务还有按小时及滑动时间窗控制的吞吐限制，不能把“每月免费额度”当成瞬时并发承诺。[官方服务限制](https://learn.microsoft.com/en-us/azure/ai-services/translator/service-limits)

本次没有创建 Azure 资源，也没有用户的 F0 密钥，因此验证的是官方协议、认证头、冻结配置、批量上限和取消行为的确定性测试，未声称完成真实 Azure 翻译请求。

## 其他已核实候选

| 官方 API | 免费部分 | 本次未加入的原因 |
| --- | --- | --- |
| 百度通用文本翻译 | 标准版每月 5 万字符；个人认证后的高级版每月 100 万字符 | 需 APPID 和密钥；标准版 1 QPS、单次 1,000 字符，高级版 10 QPS、单次 6,000 字符；超额按 49 元/百万字符收费，需要额外的计费与限速设计 |
| 阿里云机器翻译通用版 | 每月 100 万字符 | 需 AccessKey 认证，免费额度和资源包用尽后自动转后付费，不能直接当作无费用后备 |
| Google Cloud Translation NMT | 每月前 50 万字符，以每月 10 美元抵扣额形式提供 | 超额进入付费计费；与现有 Google 网页翻译接口是不同服务，不能混用其免费承诺 |
| DeepL API Free | 官方文档当前列明每月 50 万字符 | FluentRead 已有 DeepL 官方 API 适配器，本次不重复新增服务 |
| LibreTranslate | 开源软件可以自行部署 | 官方托管服务需要申请付费 API Key；自建实例需用户承担部署和运行成本，不能把第三方公共实例列为官方免费托管 API |

对应官方来源：[百度申请与版本限制](https://fanyi-api.baidu.com/doc/13)、[百度定价](https://fanyi-api.baidu.com/access/0)、[百度接口与签名](https://fanyi-api.baidu.com/product/113)、[阿里云定价](https://help.aliyun.com/zh/machine-translation/product-overview/pricing-of-machine-translation)、[阿里云认证与调用](https://help.aliyun.com/zh/machine-translation/support/faq-about-api-calls)、[Google Cloud 定价](https://cloud.google.com/products/translate/pricing)、[DeepL 官方额度](https://developers.deepl.com/docs/resources/usage-limits)、[LibreTranslate 官方文档](https://docs.libretranslate.com/)。

现有 Edge 微软翻译、Google 网页 RPC 与 DeepLX 路径不因此获得“正式公开官方 API”的标签。它们原有的兼容路径与此次新增的供应商正式 API 应分别说明，不能把网页内部接口的可调用性等同于官方额度或服务承诺。

## 自动降级设置

在“完整设置 → 翻译服务 → 免费翻译服务”中调整启用列表和顺序。默认顺序为微软 → DeepLX → 谷歌 → MyMemory；Azure Translator 与 DeepL API Free 需要填写自己的密钥后手动启用。如果只使用官方公开 API，可关闭前三项。详细操作见 [翻译服务设置](/config/translation-engines#免费翻译与自动降级)。

每路默认等待 5 秒，故障后休息 60 秒，均可调整。冷却期间其他段落跳过该服务，到期只放行一个探测请求，成功后恢复；队列和批量请求受同一总时间预算及并发限制约束。用户取消后不再转发到其他服务。语言不支持、文本过长等请求自身的问题只影响本次翻译，不使其他文本停止尝试该服务。

后备顺序和实际连接地址参与缓存身份；使用 DeepL 后备时，上下文也参与缓存与并发去重。服务状态以连接配置的摘要隔离，修改端点或密钥不会沿用旧配置的故障记录。此状态只在当前后台运行期保留，后台重启后重新探测，不把重启视作服务额度恢复。

## 实现边界与验证

两个新增适配器只访问各自固定的官方 HTTPS 端点，忽略残留的代理字段；用户的 Azure 密钥和 MyMemory 可选邮箱不会因其他代理配置而转发到第三方地址。设置、请求快照与网络调用保持同一份配置，取消后的迟到响应不能成为成功译文。

适配器测试位于 `tests/myMemoryProvider.test.ts` 与 `tests/azureTranslatorProvider.test.ts`。它们覆盖请求格式、语言隔离、字节与批量限制、内部槽标记、额度响应、空译文、错误正文保密及取消边界。网络验证使用通用示例文本，不读取用户浏览的网页或真实凭据。


这次实现依据官方 API 文档和 FluentRead 现有架构独立完成，没有复制或修改参考仓库。确定性验证包括配置迁移与导入导出、不可变快照、跨服务取消/超时/冷却、真实适配器组合、DeepL 上下文缓存与显式源语言、Google/DeepLX 参数错误分类。新增及纳入覆盖率的业务模块按项目四维 100% 门禁验证；Chrome、Firefox 和 userscript 产物分别构建，并核验清单及 userscript 元数据。


生产浏览器专项使用临时 Edge profile，在第二块显示器以不抢焦点模式运行（`macos-background-cdp`、`browserFrontmost=false`）。设置顺序/启停、两处邮箱逐字输入、立即关闭后重开保存，以及 1440/820/390 宽度与深色模式均通过；控制台错误为 0。通过本地故障注入验证：两次翻译中，返回 429 的微软服务只请求一次，MyMemory 接续两次；挂起的 Google 请求在设定的 1 秒后取消，MyMemory 接续成功。这部分使用受控响应，没有外发供应商流量，与上文 MyMemory 单次官方实测分开记录。

验证限制：旧版完整 UI 技能脚本依赖已变更的导航选择器，未能跑完整套，不计为通过；本次功能由当前生产包的专项验证覆盖。Firefox 与 userscript 完成构建及产物校验，未把 Edge 专项结果等同于两者的运行时验证。Azure 和 DeepL 没有使用真实账号密钥调用。
