# GF 纯语言字符串固定资源候选

本批基线 `01d532056d44ecd6fc9e78b5fbb35befe435215e`；源码 `ee7655b36d75069e3f0f61c344529232e736b1e1`；固定资源 `3b347c40f7a928fffe562043049a514a67a876fe`。同一 `perf/gf-statistics-repositories-20261009` 分支，仅本候选，无新 PR。前批 TinyColor/统计/许可证审查记录留在基线提交历史中。

复用 characterDataPlugin 原 AST 白名单及导出名，将 chineseVariants 的 3 个、functionWordData 的 45 个纯字符串加入现有固定 data JSON。GF 模块同步读具名字符串，缺对象/字段或非 string 值明确失败；不排序、trim 或规范化数据，不引入 gzip、eval、实时网络或异步初始化。标准/独立版原压缩路径保留。chinese/lexicon 的 RegExp、Set、split 与判定代码继续在主文件；GF entry 模块集合不变，两算法转换后代码 SHA 与基线相同，48 个完整字符串正文均不再在最终主文件中。

| 产物 | 基线实际 UTF-8 字节 | 最终实际 UTF-8 字节 | 实际变化 |
| --- | ---: | ---: | ---: |
| GF 主文件 | 2,233,395 | **2,180,182** | **-53,213** |
| standard | 1,957,868 | 1,957,868 | 字节及 SHA 相同 |
| standalone | 3,590,688 | 3,590,688 | 字节及 SHA 相同 |
| data | 868,136 | 930,496 | +62,360 |
| vendor | 610,343 | 610,343 | 字节及 SHA 相同 |
| 主文件 + 两资源 | 3,711,874 | 3,721,021 | **+9,147** |

独立 control/candidate 构建使用相同固定 URL；正式最终源文件与 candidate 仅两个等长 40 字符资源 commit 元数据不同，URL 字节长度均 135/133。实际主文件减量为 53,213；48 原字符串合计 57,926 仅为数据计数，renderedLength 同样未用于收益结论。最终 GF SHA `34910ca6ca32751a3a036bd2c1cb3424604503682c170ec643f4c63ee6547d4c`。

独立转译并求值原 TS 导出，再与真实固定 data 逐项比较，**48/48** 精确字符串、UTF-8 字节和 SHA 相等。补充平面汉字、重复字符、空格顺序、空字符串和孤立 surrogate 夹具保留；真实 Chinese patterns 与词集从 GF 模块立即同步初始化。Unicode 17 来源 URL、两个上游数据 SHA、原数据文件及完整 Unicode License V3 均保留，并随新 data 资源携带；原 english/zhCNMessages/siteCatalogs/css 字段内容不变。

红契约 13 项：2 通过、11 预期失败；GF 同步与原压缩契约 **20/20** 通过。首轮绿测试仅有 CJS 导出键枚举顺序的无关断言失败，已改为键集合及逐个值核对，原证据保留。六份指定语言/相关语料 **1,161/1,161**，真实 shipped data realm 1 项通过。类型、测试归类、文档构建、standard/standalone 实际构建和原检查器通过；没有重跑未变许可证/颜色/统计全套。

原 prepare 已执行。该次重建 vendor 在输入完全未变、16 许可块不变的情况下多 44 字节，原输出 SHA `5773982c241575f22a1f35d9efd4d2f65314c68f0fdecda371a79f72e9f06a69` 留 CW，不推测成因、不采用无关变更；保留先前独审固定 vendor，正式原脚本按既有流程把 tracked vendor 拷贝为 built。仅新 data 提交。两资源 tracked/built/Git/远端 GitHub blob/最终主文件精确 CDN 均逐字节及 SHA 一致，各首次 HTTP 200。

原 GF 正式固定资源检查通过后，第 15 行预算仍失败，超 **180,182**；第 16–31 行正式未执行。未改原断言的独立诊断 18 项中 17 通过、仅预算失败，后续 16 项诊断通过。这不代表 GF 正式通过。未运行浏览器、安装依赖、增加权限或调用真实搜索/模型 API；预算与最终 IIFE 浏览器实测仍阻塞。#912、cb07 和其他受保护分支未改。

[小型收据](./verification-receipt.json)保留本候选 48 项 SHA、源码/产物/阶段哈希与原失败状态；完整图、原输出及日志只留 CW。
