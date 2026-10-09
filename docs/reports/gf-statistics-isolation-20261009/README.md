# GF 固定资源完整许可证修复

本批基线 `479402a276c4dcccc761728ac19f8c607fdfd246`；源码 `b8fa9d211d927aa47504c6356cff25c9a9bff218`；固定资源 `f92a1e91a41e8a2a2e9d8c895bb62c756906c9ca`。沿用 `perf/gf-statistics-repositories-20261009`，普通推送，无新 PR。上一批统计隔离/TinyColor 的报告保留在基线历史中；本批只修两个缺根 LICENSE 的精确版本。

`@ai-sdk/provider-utils@4.0.46` 自包含 Vercel 原 Apache 声明、Apache 官方全文和实际进入 vendor 的 zod3-to-json-schema 子库完整 ISC，保留 Stefan Terdell 与 Vercel 版权。`franc-min@6.2.0` 保留完整 MIT 四版权。四份原始文本的版本、官方固定 commit/path、字节及 raw/normalized SHA 见 [许可证出处](../../../userscript/licenses/README.md) 和 [小型收据](./verification-receipt.json)。

真实 `includeVendorLicenses` 仅在这两包缺根 LICENSE 时启用离线 fallback；版本/SPDX 漂移、文件缺失或原始字节哈希不符均失败，沿用 `*/` 防护。其余 14 包的政策和声明逐字节不变。构建不联网、不加依赖、不改 lock，不引入跨包去重。provider-utils 块重复包含约 11 KB Apache 正文；总 vendor 资源实际增加 **14,295** 字节，去许可证注释后的 **551,443** 字节执行代码逐字节及 SHA 相同。

| 产物 | 最终实际 UTF-8 字节 | 与本批基线比较 |
| --- | ---: | --- |
| GF 主文件 | 2,233,395 | 大小不变；仅固定资源 commit 元数据变化 |
| standard | 1,957,868 | 字节及 SHA256 相同 |
| standalone | 3,590,688 | 字节及 SHA256 相同 |
| vendor | 610,343 | +14,295，仅许可证注释 |
| data | 868,136 | 字节及 SHA256 相同 |

按原 `--prepare-resources` 流程生成并提交 vendor，data 原字节不变且在同一固定 tree。两者 tracked/built/Git/远端 GitHub blob/主文件精确 CDN URL 均逐字节及 SHA 一致，各首次 HTTP 200；两个 URL 前后均为 135/133 字节，主文件将 40 字符固定 commit 等长归一后完全相同。

真实插件红回归执行 15 项：1 通过、14 预期失败；绿 **15/15** 通过，30 项无关用例因筛选未运行。覆盖两项完整文本及版权、版本/SPDX 漂移、四文件缺失/坏哈希拒绝、其他 14 声明不变。类型、测试归类、文档构建、standard/standalone 实际构建与原检查器通过；未重跑颜色/统计全套。

GF 正式固定资源检查通过后，原 verifier 第 15 行仍因 2,000,000 预算失败，超 **233,395** 字节；第 16–31 行正式未执行。未改原断言的独立诊断 18 项中 17 通过、仅预算失败；之后 16 项诊断通过。这不代表正式 GF 通过。许可证缺口已闭合；预算与最终 IIFE 浏览器实测仍阻塞。没有启动浏览器或调用真实搜索/模型 API。#912、cb07 和其他受保护分支未改；原日志仅留 CW 工作区。
