# 新 main 上的独立 userscript 性能 PR

新分支 `perf/userscript-clean-main-20261009` 从精确 upstream/main `175c59514b9ce4242b34b9f6bed1ac6a2ceb3545` 建立。三个已审提交依次移植为 `7175204b`、`0a50dab9`、`a9193cb4`；#906 的五个提交及 GF TinyColor 候选不在新分支祖先中。原有分支历史保持不变。生产与测试恰好五个文件，完整映射和 SHA 见 [manifest](./candidate-manifest.json) 与 [源码补丁](./source-only.patch)。

保留九个编译条件内的既有不可达异步设置声明，pako 2.1.0 改用原包的 `pako/lib/inflate.js`，未改变解压函数体。依赖声明和锁文件与 main 完全一致；复用 CW 现有安装，未升级、下载模型或修改资源/预算。原历史报告的 3,589,291 字节属于 18e→9b 基线，不能作为本次新 main 的测量。

## 新精确产物与阻塞

| 出口 | 精确 main | 精确性能候选 | 原门禁 |
| --- | ---: | ---: | --- |
| standard | 1,963,967 | 1,964,011 | **候选回归：增加44，超过1,964,000预算11字节** |
| standalone | 构建失败，未产生可比产物 | 3,595,173 | 通过，余4,827 |
| GF | 2,336,321 | 2,336,321 | 两侧原正式流程均在固定数据资源检查失败；门禁verifier未启动 |

standard 的 main 门禁通过，候选失败不是基线错误。原正式构建复现相同 SHA；只读观察器实际多一个 crypto-js/md5 CommonJS import proxy ID，完整模块图保留，不据此声称已定位44字节增长的根因，也未压缩代码、调整预算或添加其他修复。standalone 的 main 因 `VideoLocalModelSettings` 引用别名目标未导出的 `VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE` 而失败；本候选的既有不可达声明保护使其构建成功。没有以历史产物代替失败基线，无法计算本次相对 main 的 standalone 节省量。

正式候选 standard SHA256：`e30fc1031c2feea9dd242883272009225ca251b0c5fd17e733e7c64f5f46bf61`；standalone：`6f28435bf48d43a35c51b65ea661784e83b6c6f99b362c28bea38cf4af0b77e7`。两者原 CLI 构建与观察器产物逐字节一致。GF 的完整 SHA 两侧均为 `b2b1b254ac5e16afe2ecc7818da4b2666510ea6b87dbfd4164c95980e8715f42`；生成的数据同 SHA，均不匹配既有固定资源提交 `af81332f`，未刷新或使用另一个分支资源。这些 GF 文件不是已通过分发绑定的发布产物。原正式脚本在第79行固定数据检查停止，GF verifier未启动，所以其预算、可读性、URL、UI、Dexie和许可断言均未执行；本报告的文件大小和SVG许可存在字段只是独立静态记录，不等同这些门禁通过。各出口完整 JS/CSS ID、entry.modules 和字节/预算归因见 [三出口比较](./three-mode-comparison.json) 及相应 module-proof/modules 文件。

## 实际执行证据

类型、测试归类、Chrome/Firefox 正式构建和 manifest 检查通过。两份实际扩展产物保留全部九个原 SFC 定义，使用内嵌 `__name` 标记定位包括聚合 public chunk 的定义；不能仅用文件名判断。[扩展定义与 SHA](./extension-components-retained.json)。

受影响的八个测试文件执行121项，120通过、1项失败：`settingsUiArchitecture` 的既有“CPU 和内存”断言。精确 main 只重放该项也失败，另36项未选；不把基线重放说成完整37项测试。[候选结果](./affected-tests.json)、[基线个案](./baseline-copy-failure.json)。没有修改该文案或扩展修复范围。

[实际根组件审计](./options-shell-audit.mjs) 执行新 main/候选真实 OptionsApp、SettingsSections、SettingsGroup setup 和客户端模板，以及实际 Vue KeepAlive/路由；配置、浏览器端口与无关叶组件使用合成边界。36次不支持路由/深链与6次ContextMenu导航逐项一致，返回支持页面保留同一编辑实例和草稿，LocalTts支持入口仍加载，不支持叶组件不挂载；外部调用0。[完整结果](./actual-options-shell-before-after.json)。这不是实际 Chrome UI 验收。

当前 standalone 实际包含**八份**gzip字符串，已从该精确产物捕获。实际 main/候选解压wrapper只资格化其原库导入 URL，函数体不改；原 pako ESM、新原包CommonJS入口、Node zlib逐字节比较，24组typed输入（含offset view）和5组无效/截断输入契约一致，输入不变。[完整解压结果](./gzip-compatibility.json)、[可复核脚本](./gzip-compatibility.mjs)、[当前生产夹具](./gzip-fixtures.json)。不沿用旧报告“七份gzip”的数量。

**最终 standalone IIFE 的真实浏览器 CommonJS 解压绑定未测。** 当前没有可调用的限定浏览器工具；现有 Neo helper 的归属检查包含全局 `/proc` 扫描和 WinRects 全桌面盘点，Recovery HOLD 明确禁止。未运行该 helper、连接未知浏览器 socket、启动新浏览器/扩展或更改权限；Node入口/库契约不能代替浏览器生产 IIFE 证据。[具体限制与产物绑定](./browser-iife-runtime-not-run.json)。

本批命令采用 CPU目标60%、单worker、并发1，逐阶段命令、精确head、耗时、退出码和日志路径全部记录。新 checkout 首次缺少 `.wxt/tsconfig.json`，执行原锁定 WXT prepare 后只重试失败阶段；初始日志被后续成功重放覆盖，manifest对此明确披露并保留已捕获的错误摘要。所有其他成功阶段未为状态汇报重跑；standard的原命令重复是为了核实新发现的回归。报告后续提交不改变已验证生产源码。PR保持draft，standard预算回归和浏览器解压证据缺口仍阻止合并；基线GF/文案问题另列。
