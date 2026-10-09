# Standalone 不可达设置 · 八声明独立提交

> 历史基线：本目录记录旧18e→9b性能批次，原始数字和证据保留。新main175c5951上的产物、失败及浏览器未测状态见[新精确head报告](../../userscript-performance-clean-main-20261009/README.md)。这些历史产物不代表新独立PR的实测。

本候选基于已推送并完成许可修复的18e049003bffab6d2bd49220c48b569b0a70856e，仅给SettingsSections.vue的8个异步组件声明添加既有编译常量 `import.meta.env.BROWSER === 'userscript' ? undefined : 原 defineAsyncComponent`。原OptionsApp已经对图片/圈选/视频/写作/翻译统计/模型用量六个请求入口展示不可用提示；编译分支排除的是此前依然被inlineDynamicImports带入standalone的不可达加载声明。

生产只改8声明与职责注释；LocalTtsSettings、ContextMenuSettings、导航、不可用提示、语言及配置保存逻辑均未改。另适配3处源形状断言，仍精确检查原异步导入路径，并要求LocalTts等支持组件保留无分支原声明。交付[candidate.patch](./candidate.patch)及完整量测证据，作为独立性能分支 `perf/userscript-unreachable-settings-20261009` 的八声明提交；没有并入#906。产物按本目录的八声明补丁源码SHA绑定。本目录保存原始基线与八声明增量，后续 ContextMenu 增量另存，不能混用两个阶段的产物。

## 实际三出口量测

| 产物 | 候选前UTF-8字节 | 候选后UTF-8字节 | 实际减少 | 原上限 | 候选后超限 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 标准 | 1959993 | 1959993 | 0 | 1960000 | 0（余7） |
| standalone | 3797330 | 3620828 | 176502 | 3600000 | 20828 |
| GreasyFork | 2322749 | 2322749 | 0 | 2000000 | 322749 |

完整产物的前后SHA与真实entry.moduleIds/entry.modules见[三出口对比](./three-mode-comparison.json)及各模式before/after-module-proof.json。所有构建顺序执行，CPU目标60%、worker1、并发1。

standalone模块由1216降为1175；实际ID差异为移除34个JS、移除8个CSS并新增1个CSS。新增者是同一settings-sections.css因父SFC源码改变而重新生成scoped哈希，实际额外移除7个样式模块；原始CSS数据由775334降到698500，少76834原始字节，不把它当作可加到minified收益的数字。标准492模块、GF385模块及两者产物SHA、CSS SHA均不变。LocalTtsSettings在standalone前后3个模块完整保留，没有修改或排除ContextMenuSettings。

标准SHA前后均7ee7ff35d769ed383dfe1bfbf9983af1414414748fdb1a0bcaf7f940eac36ec5；GreasyFork前后均71212a32ad6c707e6659c4cb5db7d1bf6ab0e2b86d95c03e02f34a0dd32026f5。GF仍缺322749字节，本候选不解决GF体积；生成数据SHA前后同34bcb22e60894c88d3b45f4b23c3c6e1c03d1e21614a23caf896ad7333140951，既有固定数据不匹配未改变。沿用脚本推导的原不可变资源URL，没有prepare-resources或资源/URL/budget修改。真实GF归因供后续精确分析使用，不重新量测未变旧基线。

## 实际 Options 壳与保留行为

[options-shell-audit.mjs](./options-shell-audit.mjs)执行真实OptionsApp与SettingsSections的setup及客户端模板，保留真实Vue KeepAlive与导航解析器。配置/浏览器/外观传输、几何观察器及无关UI叶子用合成端口；没有替换根组件、不可用判定、路由、模板或KeepAlive，也没有宣称真实浏览器视觉/Windows/GPU验证。Vite只加载SSR模块，middlewareMode、ws:false、watch:null，无TCP监听；DOM是已安装linkedom，未新增环境或依赖。提交版重放脚本从本目录的 before/candidate 文本快照加载同一真实 SFC，避免后续增量改变八声明证据；其余实际根与导航源来自仓库。原运行使用当时工作树中的相同SHA源码。

原始与候选各验证六入口方法导航和hashchange、从各入口返回general、初始URL深链接与返回；包括圈选→图片与用量→统计的既有别名。两轮24方法/hash导航、12初始深链接的解析和实际不可用提示trace完全相同。每次返回均保持同一SettingsSections实例UID及草稿to=fr；支持的划词区仍实际挂载LocalTts叶子，八个不可达叶子均未挂载，网络调用0：[原始/候选实际trace](./actual-options-shell-before-after.json)。

初始夹具缺失MutationObserver/ResizeObserver，DOM元素未markRaw，以及LocalTts异步模块还没完成加载时的断言失败都保留在阶段日志中，不当产品故障；补齐平台端口、遵循既有markRaw模式并有界等待实际模块加载后，全部原断言通过，没有跳过任何断言。两份实际根模板一直执行。

Chrome/Firefox构建通过，各167份JS/CSS产物中实际八个原始SFC定义均保留；通过生成JS的__name标记定位，包括图片public的聚合chunk，而不是误把所有组件都当独立同名chunk。对应产物SHA见[扩展原组件证据](./extension-original-components-retained.json)。父SFC的scoped哈希变化可传播到chunk名称，不声称整个扩展字节不变。

## 验证范围与未通过项

类型检查通过；原标准verifier通过；standalone和GF原verifier分别因20828/322749字节超限失败。未放宽预算。相关4文件初次82用例中79通过、3处声明形状断言失败；三处断言适配后架构文件36/37通过。剩余一项“CPU 和内存”文案断言在未修改18e0490原源码和原测试单项重放同样失败，明确单列为既有阻塞：[单项原基线](./baseline-ownership-test.json)、[适配后架构](./updated-architecture-tests.json)。其余45个相关用例已通过，没有把合并两次结果冒充整套重新运行或四维覆盖率。

stage命令与耗时、源码/补丁SHA见[candidate-manifest.json](./candidate-manifest.json)。本提交有实测收益且上述合成行为无回退，可独立审查；仍未达到standalone门禁，GF门禁/固定数据及既有文案断言未闭合，#906保持draft。真实模型/搜索API0、新权限/依赖/环境0、Recovery操作0。
