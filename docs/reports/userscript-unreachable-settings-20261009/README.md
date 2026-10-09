# userscript 不可达设置 · 独立性能审计

本目录保留旧性能分支 `perf/userscript-unreachable-settings-20261009` 在 `18e049003bffab6d2bd49220c48b569b0a70856e`→`9b563da8` 上的历史测量。该旧分支祖先包含仍为 draft 的 [#906](https://github.com/FluentRead/FluentRead/pull/906)，不能直接作为独立性能PR基线。本目录公开可复核的补丁、源码文本快照、完整三出口 entry.moduleIds/entry.modules、实际根组件导航和保留行为证据。新独立分支从 upstream/main `175c5951` 仅移植三个性能提交；[新精确head证据与尚存阻塞](../userscript-performance-clean-main-20261009/README.md)为本次PR依据。以下全部数字是历史结果，不能当作新main实测。

[八声明提交](./eight-declarations/README.md) 将既有 userscript 不可达的八个异步设置声明置于现有编译常量分支；standalone 从 3,797,330 降至 3,620,828 UTF-8 字节，减少 176,502。standard 仍为 1,959,993（余 7），GreasyFork 仍为 2,322,749（超 322,749）。该阶段 standalone 仍超 20,828。

[ContextMenu 单独增量](./context-menu/README.md)再减少 5,245 字节，standalone 为 3,615,583，两步共减少 181,747，仍超 15,583。standard 和 GF 字节、SHA 与模块均不变。ContextMenu 保留提示与实际导航另有六次前后回归，Chrome/Firefox 原加载组件全部保留。增量的完整 SHA、JS/CSS ID 差异及 GF 全模块归因分别见 [ContextMenu 比较](./context-menu/three-mode-comparison.json)、[GF before](./context-menu/greasyfork-before-modules.json)、[GF after](./context-menu/greasyfork-after-modules.json)。

[pako inflate 单独消融](./pako-inflate/README.md)在 b7f88830 基线上再减少 26,292 字节，standalone 为 **3,589,291**，原门禁通过、余 **10,709**。三项合计减少 **208,039** 字节。七份真实 gzip 的21组typed输入逐字节比较和五组无效/截断输入契约均与原入口一致；44项相关测试、类型、测试归类和standard/standalone verifier通过。standard/GF字节与SHA保持不变。

完整产物 SHA 和 JS/CSS ID 差异见 [八声明三出口对比](./eight-declarations/three-mode-comparison.json)。GreasyFork 的 [前归因](./eight-declarations/greasyfork-before-modules.json)、[后归因](./eight-declarations/greasyfork-after-modules.json) 为全部实际模块映射；[前实际 ID](./eight-declarations/greasyfork-before-module-proof.json)、[后实际 ID](./eight-declarations/greasyfork-after-module-proof.json) 也完整提供，没有仅用 SVG 标记或摘录替代。

沿用 CPU 目标 60%、单 worker、并发 1、现有依赖和固定资源 URL。未刷新资源或放宽预算。真实根组件合成导航、类型、Chrome/Firefox 构建和 standard verifier 有通过证据；当前 standalone 门禁已通过；GF 门禁/固定数据不匹配、既有“CPU 和内存”文案断言仍未闭合。合成证据不代表真实浏览器、Windows 或 RTX 5090 WebGPU 验收。
