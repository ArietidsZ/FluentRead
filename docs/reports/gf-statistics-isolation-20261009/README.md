# GF-only 统计仓库隔离候选

基线 `dd2d2e210275e952cb3af9c07640b5878d92c8af`；验证源码 `b4e14534c01f4bf35ca2d2d4225f8dfb0196c3d4`。独立分支 `perf/gf-statistics-repositories-20261009`，只做本项量测，不创建新PR，也不修改 #912 或现有GF分支。

GF的两项统计仓库消费者仅为翻译runtime；真实写入受chrome/moz/safari-extension协议限制。仅GF source模式把两个repository alias到已有 `unsupportedCapabilities.ts` 的最小接口：captureGeneration→0，record无操作，recordMany返回Promise<number>的0。完整独立版、standard和真实后台消费者继续使用原仓库；无通用适配框架、供应商/缓存/取消/计数/DB schema或用户数据改动。

| 出口 | 基线 UTF-8 字节 | 候选 UTF-8 字节 | 实际差值 |
| --- | ---: | ---: | ---: |
| GF | 2,335,647 | **2,267,253** | **-68,394** |
| standard | 1,957,868 | 1,957,868 | 字节及SHA完全一致 |
| standalone | 3,590,688 | 3,590,688 | 字节及SHA完全一致 |

GF SHA256 `38e1b8b9535fb2034aaf33d10bbce36921222fcf3d663975bd858fe56c0fb099`。这只是最小候选收益，仍超原2,000,000预算267,253字节；不调整预算，也不据renderedLength声称收益。

实际loaded/entry图中 modelUsageRepository、model-usage/aggregation、translationStatsRepository、translation-stats/aggregation 四模块全部消失，GF最终源文件不含两项统计数据库名；standard/standalone四模块仍在，standalone platformFull真实消费者保留。GF的broker与翻译缓存模块仍在。

最小红契约执行5项：3通过、2预期失败；实施后两处受影响测试共 **32/32通过**。真实适配器导入及方法调用的Node IndexedDB open/delete guard计数均为0，返回值和Promise契约保持。类型与测试归类通过；这不是浏览器或整个网页的IDB验收。没有运行浏览器或付费API、安装依赖，也没有重跑全套。

原GF正式脚本仍在第79行固定data检查停止，verifier未启动，其预算/可读性/URL/UI/Dexie/许可后续断言均未执行。生成data的868,136字节与SHA `85be944ad2d1f97ae94badf3a8e8f77e282beaf1f217ed472ef2e73050ae0981` 均与基线构建相同；固定vendor/data URL、已提交资源和许可不变，没有prepare资源。单独列此基线阻塞。

[小型机器可读核验收据](./verification-receipt.json)包含源码/产物SHA、消融、红绿结果、模块边界、阶段退出码与原日志SHA。完整图与日志仅留CW现有工作区，不重新加入报告树。
