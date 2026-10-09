# GF TinyColor 与固定资源最小候选

本批基线 `353e87939e2c3ab59f3a9a405f2b83695098c41c`，源码 `b23b6e4cbb2d20ba63ae67570a7bf3bec7d6341b`，固定资源 `d11862b4268e21598607bebc793e61f8a53782ff`。沿用独立分支 `perf/gf-statistics-repositories-20261009`；复用已审计 `d9abfc98b8dd2df77ab5516f2e168e08ddd0e0df` 的 TinyColor 外置源码，没有复制旧报告或测量。前一批统计隔离记录保留在基线提交历史中。

仅 GF source 将 `@ctrl/tinycolor` 指向 vendor 的 TinyColor；standard/standalone 保持真实统计仓库及原有构建路径，standalone 的 platformFull 消费者保留。GF 四个统计模块继续不在 loaded/entry 图中，broker/cache 保留。按项目原 `--prepare-resources` 流程生成、单独提交 vendor/data；原构建脚本、vendor 许可证插件、锁文件和所有预算均未改。

| 出口 | 基线实际 UTF-8 字节 | 本批最终实际 UTF-8 字节 | 主文件减量 |
| --- | ---: | ---: | ---: |
| GF | 2,267,253 | **2,233,395** | **33,858** |
| standard | 1,957,868 | 1,957,868 | 0；SHA256 相同 |
| standalone | 3,590,688 | 3,590,688 | 0；SHA256 相同 |

GF 最终 SHA256 `be4924732d06323a927cdc9b4cf260e83ccd8606e2590805d9258ab33026ef90`。本批重新构建的 TinyColor-only 中间产物为 2,240,161 字节，贡献 **27,092**；随后资源刷新贡献 **6,766**。前后两个固定 URL 长度均为 135/133 UTF-8 字节，用等长 40 字符占位 commit 再比较，URL 长度差为 0。准备流程的 localhost 元数据产物仅用于生成资源，未参与减量比较，也未作为发布产物。

vendor **596,048** 字节，SHA256 `3e7a86f3566595d37610bbb48901ac4911a75b6ad4dbcdada4c932a04fd7b248`；data **868,136** 字节，SHA256 `85be944ad2d1f97ae94badf3a8e8f77e282beaf1f217ed472ef2e73050ae0981`。两者 tracked、built、固定提交 Git blob、远端 GitHub blob 和最终主文件中的精确 CDN URL 均逐字节一致；CDN 各首次 HTTP 200。资源分别增加 15,502/200,028 字节；主文件加两资源合计增加 **181,672** 字节。

刷新前配置契约 **30/30** 通过；刷新后的受影响筛选 **27/27** 通过（41 项因筛选未运行）。历史资源夹具显式同时包含缺规则与同 ID 的非 ID 字段过期，另有字段过期单独用例；校验权威 19 条规则、原资源不变和未变规则对象复用。真实 shipped vendor 的全部颜色名及边界输入在 Node VM 中与安装包对照；未调用真实模型 API。类型、测试归类和 standard/standalone 原检查器通过。文档构建通过；额外 docs:check 在第 113 行缺失 Storybook 链接对应产物处停止，本批未构建 Storybook，未声称整站核验通过。

GF 原正式流程已通过固定资源一致性检查，然后在 verifier 第 15 行原 2,000,000 字节预算停止，仍超 **233,395** 字节；正式第 16–31 行可读性、固定 URL、UI、Dexie、许可与 data 断言均未执行。以同一 VM realm 逐条独立执行未改原断言，18 项中 17 通过、仅预算失败；预算后的 16 项诊断通过。首次诊断的跨 realm 数组比较误差及修正日志均保留。这些诊断未改变正式失败结论。

完整许可证核验仍有既有缺口：16 个 vendor 包中 14 个完整文本与本机安装源一致，新增 TinyColor 3.6.1 完整 MIT 文本及哈希已核验；`@ai-sdk/provider-utils@4.0.46`、`franc-min@6.2.0` 的发行包未带 LICENSE，原插件继续仅输出上游链接。两链接在基线已存在；本批不扩展修改该插件，整体完整许可证检查保持失败。

未启动浏览器、模拟 GPU、安装依赖或调用搜索/模型 API。浏览器创建路径已由父任务停止，最终 IIFE 的浏览器验收仍未运行。普通推送现有候选分支，无新 PR；#912、cb07 及其他受保护分支未修改。当前仍阻塞于 GF 预算、两项完整许可证缺口和浏览器实测。

[小型核验收据](./verification-receipt.json)记录三种产物 SHA、分项归因、资源 Git/CDN 绑定、未执行断言和阶段日志 SHA；原始日志/模块图仅保留 CW 工作区。
