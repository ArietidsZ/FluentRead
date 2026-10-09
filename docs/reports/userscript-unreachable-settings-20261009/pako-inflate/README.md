# pako inflate 入口 · b7f88830 后的独立消融

> 历史基线：本目录记录旧18e→9b性能批次，原始数字和证据保留。新main175c5951上的产物、失败及浏览器未测状态见[新精确head报告](../../userscript-performance-clean-main-20261009/README.md)。这些历史产物不代表新独立PR的实测。

基线为独立性能分支 `b7f88830e3d47f595cb287f3833d5d001adcffc6`，包含前两项不可达设置裁剪。本次生产只将 `userscript/pakoBundled.ts` 的运行时导入从 `pako` 改成 `pako/lib/inflate.js`，并在既有 ambient 类型文件增加同签名声明。函数体、pako 2.1.0、解压格式与算法不变；未增加包装、插件、依赖或环境。另在原压缩测试中增加偏移 Uint8Array 和错误头/校验和两个契约。[完整单项补丁](./candidate.patch)。

官方 2.1.0 [package.json](https://github.com/nodeca/pako/blob/2.1.0/package.json) 的 exports 开放 `./lib/*`，[lib/inflate.js](https://github.com/nodeca/pako/blob/2.1.0/lib/inflate.js) 导出 `ungzip=inflate`，不依赖 deflate 编码器。本机安装清单、exports 和实际源码已经核对。本改动仅让构建选择该官方入口，构建期 `createRequire('pako').gzip` 和 standard/GF 的现有 pakoRuntime 全局入口保持原样。

| 出口 | 单项前 UTF-8 字节 | 单项后 UTF-8 字节 | 本次减少 | 原门禁 |
| --- | ---: | ---: | ---: | --- |
| standard | 1959993 | 1959993 | 0 | 通过，余7 |
| standalone | 3615583 | 3589291 | 26292 | 通过，余10709 |
| GreasyFork | 2322749 | 2322749 | 0 | 仍超322749 |

standalone 前 SHA256 `2be11ea60a6fd9f8bdc1d0c56d54ac0b3813346acae090c0af3bd626b7d23e82`；后 SHA256 `c05f02f3c907b575ec3e8ec4544872e830e050ccfaa56e401f60ef83e48db5a8`。本项关闭剩余15583字节缺口；三项从18e0490的3797330合计减少208039字节。standard/GF 完整产物SHA不变。每个出口的完整前后SHA、实际 JS/CSS ID 差异见 [三出口比较](./three-mode-comparison.json)，完整实际模块映射与 module-proof 文件均已提交。

真实 entry.moduleIds/entry.modules 显示移除 `dist/pako.esm.mjs`（223573 renderedLength），改由15个 inflate 所需模块及 CommonJS 包装组成（合计104020 renderedLength），没有 deflate 或旧 ESM 入口。总 entry 模块1172→1186，不能用模块数量下降代替字节量测，也不把 renderedLength 差额作为 minified 产物收益。完整实际产物减少26292字节，[pako 全部模块归因](./pako-module-attribution.json)可复核。CSS payload字节/SHA完全不变，完整pako许可仍保留。

## 七份实际 gzip 与输入契约

[gzip-fixtures.json](./gzip-fixtures.json)保存从原 b7 standalone 生产产物准确提取的七份现有非代码gzip数据；每份压缩字节SHA绑定原产物SHA，不重新编码数据。候选生产产物中的七个gzip字符串集合逐项与原数据相同。没有压缩或重新封装可执行代码。

[gzip-compatibility.mjs](./gzip-compatibility.mjs)只将实际 before/after TypeScript 包装器的 import specifier 资格化到已安装库路径，函数体不替换；经现有 TypeScript 转译执行真实包装器，分别调用原 ESM ungzip 与新官方入口。每份数据验证 Uint8Array、Buffer、非零偏移 Uint8Array 三种输入，共21组；两个真实库的原始输出 bytes、两个实际包装器的 UTF-8 bytes均逐字节等于 Node zlib gunzip结果，输入数据未被改写。[完整结果](./gzip-compatibility.json)包含逐份压缩与解压SHA。

错误头、损坏CRC、空输入、截断头、截断尾五组实际包装器结果与基线完全相同，包括原pako对不完整流返回undefined后原包装器转换成字符串的既有行为。本次没有改为新的验证或异常语义。既有浏览器DecompressionStream、管理器全局fallback、无管理器bundled fallback与新增typed/error契约，连同Vite配置和userscript隐私测试共44/44通过，[测试结果](./related-tests.json)。类型检查、测试归类、standard及原standalone verifier通过。

## 范围与尚未完成

本项没有修改 SettingsSections、OptionsApp、组件、CSS或扩展入口；相关真实根setup/模板与KeepAlive合成导航、Chrome/Firefox构建与原SFC保留证据复用 [b7阶段](../context-menu/README.md)。本次不重跑未变的设置导航或扩展构建，且不把合成导航表述为实际Chrome浏览器交互验收。真实浏览器、Windows与RTX5090 WebGPU均未新增验证。

GF的385个实际模块、完整产物SHA、固定生成数据SHA `34bcb22e60894c88d3b45f4b23c3c6e1c03d1e21614a23caf896ad7333140951`保持不变，既有GF体积/固定数据阻塞与“CPU 和内存”文案断言仍未闭合。GF后续归因由独立审计继续。本项没有换资源URL、更新固定资源、修改预算或压缩业务可执行代码。

基线量测直接复用已独审 b7 的同SHA产物和真实模块图，没有重建旧基线。CPU目标60%、单worker、并发1、已安装pnpm9和依赖；真实模型/搜索API0、新权限/依赖/环境0、Recovery操作0。观察器仅记录实际generateBundle图，未改写bundle。源码SHA、安装源码SHA和阶段命令/退出码见 [candidate-manifest.json](./candidate-manifest.json)。按本项独立commit普通推送同性能分支；#906仍是18e0490/draft，尚不创建性能PR，等待独审。
