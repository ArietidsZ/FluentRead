# GF Noble 同步摘要 vendor 候选

基线 `3bf04b23181baec4ae0d1596d948e715974d86bf`；生产源码 `964cedecc4932c363f017e1c82e86d973b9869da`；固定资源 `9c2780d84ab885d6723d591b109bcba895f78bf3`；补齐输入不变测试 `5f975fa7f2557109ed121b49a018fc79378f17d4`。同一 `perf/gf-statistics-repositories-20261009` 分支普通推送，无新 PR；前批 CSS/语言/许可证记录留在提交历史。

确认现有同步 helper 实际导入 `@noble/hashes/sha2.sha256` 和 `@noble/hashes/utils.bytesToHex`，锁文件及精确安装源均为 **1.8.0**。仅在已有 vendorEntry 添加这两函数的 `nobleHashes` 分组，并把两个进口加入既有 GF external 映射；保留 CryptoJS 顶层 `sha256`，无名称冲突。未改为 CryptoJS/WebCrypto，未改消费者、其他算法、依赖、版本或标准/独立版策略。

| 产物 | 基线实际 UTF-8 字节 | 最终实际 UTF-8 字节 | 实际变化 |
| --- | ---: | ---: | ---: |
| GF 主文件 | 2,148,481 | **2,139,535** | **-8,946** |
| vendor | 610,343 | 616,497 | +6,154 |
| data | 964,406 | 964,406 | 完整字节及 SHA 相同 |
| 主文件 + 两资源 | 3,723,230 | 3,720,438 | **-2,792** |
| standard | 1,957,868 | 1,957,868 | 完整字节及 SHA 相同 |
| standalone | 3,590,688 | 3,590,688 | 完整字节及 SHA 相同 |

收益只用独立控制与最终实际完整主文件计量；旧 13,445 renderedLength 仅定位。真实 GF entry 只移除 utils/_md/sha2 三模块，shared hash、翻译 cache/broker 和 glossary 消费者转换代码 SHA 不变。最终原构建与独立候选仅两个等长 40 字符资源提交号不同，URL 长度 135/133 不变。最终 GF SHA `bf0365985376f8588be04a280138921900e259592f81944ea0cd900af4e48cc6`。

复用原许可采集器，从精确安装源携带 **完整 Noble 1.8.0 MIT（Paul Miller 2022）**，原 LICENSE 1,109 字节、SHA `4f221aee6e072336700c408c68ab3b96a3fc09f6aebe6f48f1bd99e5ef13faec`；按采集器已有空白处理进入注释。新 vendor 17 个许可块，原 16 块逐字节不变，未添加 URL/SPDX 占位。data 原字节保留。

红契约 16 项：14 预期失败、2 通过；绿契约 **16/16**。真实 shipped vendor 的空、ASCII、Unicode UTF-8、55/56/63/64/65/127/128/129 边界及 offset typed array 共 12 向量与原包和 Node 固定结果相等；同步 Uint8Array32、lowercase hex string 和 sha/hex 输入不变均核对。追加输入不变断言后的 13 项再次通过。原 SHA 与翻译缓存 identity 契约通过实际 vendor 端口运行 **14/14**，两端口加载计数各 1；首轮辅助 mock 未命中而加载计数失败，改为精确安装文件路径后通过，原日志保留。原契约源码未改。类型、测试归类通过，文档结果见收据。

standard/standalone 各仅一次原构建与原 verifier，完整 SHA 均等于基线，本批无自动包装波动、无择取重建。原 prepare 仅一次，固定新 vendor 提交后原正式流程通过 built/tracked/Git；两精确 CDN URL 均首次 HTTP 200，tracked/built/固定 Git/远端 blob/CDN 字节与 SHA 全等。执行服务短暂断连后只确认同一 CW 状态并补交测试，未重建或重新准备资源。

原 GF 第 15 行 **2 MB 预算仍失败，超 139,535**；后续正式断言未执行。每个未改原 assertion 的独立诊断 18 中 17 通过、仅预算失败，后续 16 项诊断通过，不代表正式 GF 通过。未运行浏览器/最终 IIFE、未新增权限或真实模型/搜索 API。#912、cb07 等受保护引用未改。

[小型收据](./verification-receipt.json)保存精确向量、许可/产物/阶段 SHA 和资源绑定；大日志及图仅留 CW。
