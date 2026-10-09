# ContextMenu · 八声明提交后的独立增量

> 历史基线：本目录记录旧18e→9b性能批次，原始数字和证据保留。新main175c5951上的产物、失败及浏览器未测状态见[新精确head报告](../../userscript-performance-clean-main-20261009/README.md)。这些历史产物不代表新独立PR的实测。

本增量只给 SettingsSections.vue 的 ContextMenuSettings 异步声明添加既有编译常量 `import.meta.env.BROWSER === 'userscript' ? undefined : 原 defineAsyncComponent`；未改变模板。原模板在 userscript 分支明确渲染 `data-userscript-unavailable="context-menu"` 的 SettingsGroup，ContextMenuSettings 在 `v-else` 下，因此 userscript 加载声明不可达。本次不扩大到其他设置、不增加配置或新权限，LocalTts 保持原加载声明。

[context-menu-only.patch](./context-menu-only.patch) 是相对于八声明源码的唯一生产增量。此处 before 是八声明提交，after 才包含 ContextMenu。完整原始基线→八声明证据在 [相邻目录](../eight-declarations/README.md)，没有重跑或混用旧量测。

| 出口 | 增量前字节 | 增量后字节 | 本次减少 | 原预算 | 当前超限 |
| --- | ---: | ---: | ---: | ---: | ---: |
| standard | 1959993 | 1959993 | 0 | 1960000 | 0（余7） |
| standalone | 3620828 | 3615583 | 5245 | 3600000 | 15583 |
| GreasyFork | 2322749 | 2322749 | 0 | 2000000 | 322749 |

standalone 当前 SHA256：`2be11ea60a6fd9f8bdc1d0c56d54ac0b3813346acae090c0af3bd626b7d23e82`。完整前后 SHA、JS/CSS 实际 ID 差异和 CSS payload SHA 见 [三出口比较](./three-mode-comparison.json)。两步合计减少 181747 字节，仍未通过 standalone 门禁。

standalone 实际 entry 模块从1175降至1172：移除 ContextMenu 的两个 JS ID 和一个样式模块；父 SettingsSections 的 scoped CSS ID 重新生成，另列为一删一增。原始 CSS 698500→696217 字节减少2283，不与完整 minified 产物收益相加。LocalTts 的三个模块 ID 完整保留。standard492、GF385模块和完整产物SHA均不变；GF固定生成数据SHA仍为 `34bcb22e60894c88d3b45f4b23c3c6e1c03d1e21614a23caf896ad7333140951`，已有数据不匹配未变。完整 GF [before 模块归因](./greasyfork-before-modules.json)、[after 模块归因](./greasyfork-after-modules.json)与对应 module-proof 中全部 JS/CSS ID 均已提交。

[最小导航验收](./options-shell-audit.mjs)执行真实 OptionsApp、SettingsSections 和 SettingsGroup 的 setup 及客户端模板，保留真实 Vue KeepAlive 和导航解析器。前后各执行 context-menu 面板、context-menu-settings 目标别名和 selectPanel(context-menu)，六次真实入口解析与提示 DOM 文本 trace 相同，ContextMenu 子组件始终未挂载。回到支持的 page/general 保留同一设置实例 UID 与 `to=fr` 草稿；划词区实际 LocalTts 叶子仍挂载。测试使用既有 linkedom、配置/浏览器/外观和无关叶子合成端口，没有替代根、模板、可用性判定或导航。Vite middlewareMode、ws:false、watch:null，无 TCP；外部请求0。[实际结果](./actual-options-shell-before-after.json)包含两阶段完整 trace。

初始夹具的 SettingsGroup 叶子替身不渲染标题/说明，随后相对导入路径仍被替身拦截，两次历史失败均保留。最终加载真实 SettingsGroup、修正夹具相对路径解析后，原提示文本断言全部通过，产品源码未为测试改动。提交的脚本重放使用同 SHA 的 before/candidate 文本快照；其余实际根来自仓库。

类型检查、Chrome/Firefox 构建、现有翻译交互契约、测试归类和 standard verifier 通过。Chrome/Firefox 生成 JS 中实际 ContextMenu、LocalTts 和八个原 SFC 定义全部保留，[各定位产物 SHA](./extension-original-components-retained.json)可复核。既有四文件测试与 CPU 文案阻塞沿用八声明证据；本次仅额外重放一项相关契约，不声称整套或四维覆盖率。standalone/GF 原 verifier 继续因15583/322749字节超限失败，预算未放宽。GF固定数据、既有文案断言和真实浏览器/WebGPU验证仍未闭合；#906继续draft且head未变。

构建观察器只读取实际 generateBundle entry.moduleIds/entry.modules，没有改 bundle。CPU目标60%、单worker、并发1。原固定不可变资源 URL 沿用，未 prepare-resources、换 URL、增依赖或新环境，真实模型/搜索 API0、Recovery操作0。原阶段命令和各退出码见 [candidate-manifest.json](./candidate-manifest.json)。本增量与八声明分别提交，等待独立审计后再决定性能 PR。
