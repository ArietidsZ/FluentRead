# Greasy Fork · TinyColor 单项与资源一致性

候选分支 perf/gf-tinycolor-vendor-20261009 从已审性能 head 9b563da892ea6d6c836166e7ee54c9c468c47c9e 分出；性能分支保持该 head，#906仍18e0490/draft。没有创建PR，也未加入Noble、统计仓库隔离或Unicode外置。

生产只在 vendorEntry 导入 TinyColor 并按既有方式导出 tinycolor={TinyColor}，在 vendorGlobals 增加 @ctrl/tinycolor→FluentReadUserscriptVendor.tinycolor。现有 external 集合只在 GF 使用该映射；translationAppearance算法、版本3.6.1、依赖、构建插件、执行代码可读性与预算均未改变。[源码补丁](./source-only.patch)。

## 实测与独立归因

| 出口 | 原UTF-8字节 | 正式候选字节 | 合计减少 | 原门禁 |
| --- | ---: | ---: | ---: | --- |
| standard | 1959993 | 1959993 | 0 | 通过，余7 |
| standalone | 3589291 | 3589291 | 0 | 通过，余10709 |
| GF | 2322749 | 2288891 | 33858 | 仍超288891 |

standard、standalone完整SHA和模块均不变。GF合计33858中，**TinyColor单项仅27092字节**；资源刷新使规则补丁正文另减少6766。为消融先执行原prepare生成只刷新资源的基线，再在相同127.0.0.1临时URL下对比登记TinyColor，两者metadata完全相同。临时URL比正式metadata另少178字节，正式绑定后已加回，不算收益。仅刷新基线2315805、临时TinyColor候选2288713均为中间量测，不是发布产物。

GF原SHA256：71212a32ad6c707e6659c4cb5db7d1bf6ab0e2b86d95c03e02f34a0dd32026f5；正式候选：179375379ffe19cb8cf351ae09b2477bf50c25137dfab0d9f7d250924e67da44。全部实际JS/CSS ID差异、各阶段metadata/body SHA及资源归因见 [三出口比较](./three-mode-comparison.json)。真实图中TinyColor五模块36431 renderedLength被外置，GF entry385→380，无CSS ID差异；该归因数不是收益承诺。[五模块详情](./tinycolor-module-attribution.json)。original、refreshed、candidate、formal完整entry.modules与module-proof均提供。只读观察器未修改bundle，正式观察器产物与原CLI正式构建字节完全相同。

## 实际颜色接口与资源刷新

[color-and-resource-audit.mjs](./color-and-resource-audit.mjs)求值实际生成的vendor IIFE，比较其TinyColor与已安装原实现的172组命名色、RGB/HSL/HSV、alpha、越界和无效/非字符串输入；包括原实现对null的异常。未改动的实际translationAppearance源码经现有TypeScript转译，只将TinyColor依赖后端资格化，172组归一化与外观CSS逐项一致，没有替换函数体。实际TinyColor、完整MIT许可、数据/颜色输出均通过：[API全结果](./color-api-compatibility.json)。不把这些合成接口比较称为实际Chrome浏览器交互。

原固定数据668108字节、SHA2c14c754…，刷新后898082、SHA34bcb22e…；TinyColor登记前后此数据逐字节完全相同。此次原prepare刷新有3935处数据叶路径差异，包括74个原缺失的document.pdfReading英文/中文键；整份英文与中文消息逐值等于当前源码。站点规则17→19及CSS/其他文案同步由既有数据生产者生成，未手改数据，未归给TinyColor。[完整资源差异与PDF清单](./resource-refresh-difference.json)。vendor纯刷新580546→580586另增40字节；TinyColor再使vendor增15462字节至596048，完整MIT仍在vendor中。

41项颜色核心/Vite契约通过。刷新使原Vite夹具依赖旧资源的前提消失，显式构造old-asset和重排场景后原缺规则异常、资产不可变与权威数据断言保持；shipped资源静态计数快照17改19。9项选定vendor/资源回归初次8通过、计数项失败，修正计数后只重放该1项并通过；未重跑8项，也不声称整文件35项全跑。类型、测试归类、standard/standalone verifier通过。历史失败结果单列，null最初未捕获的夹具错误也保留；产品算法未为这些失败改动。

## 原资源流程与交付范围

源码/测试维护提交：d9abfc98b8dd2df77ab5516f2e168e08ddd0e0df。两个生成资源单独提交：323d3cb11f0e7dde655e5919d5558167e57499b5。原 scripts/build-userscript-greasyfork.mjs --prepare-resources 生成vendor/data；随后无参数正式流程核验vendor源与锁文件、Git资源字节、tracked与built资源字节一致。两个HTTPS @require都绑定资源提交323d3cb11f0e7dde655e5919d5558167e57499b5，原CDN仓库路径不变。正式脚本退出1仅因原2MB预算断言；未放宽预算或修改verifier。资源固定与数据一致性已在此候选分支闭合，GF整体体积仍未闭合。

复用9b原三出口/模块基线，没有重跑既有Options导航或扩展构建。本批只做CW现有依赖、CPU60%、单worker、并发1；没有新环境、权限、真实模型/搜索调用或Recovery操作。未安装脚本、开放127端口、操作用户profile或声称WebGPU验证。阶段命令、退出码、源码/资源SHA、固定commit元数据见 [candidate-manifest.json](./candidate-manifest.json)。
