# #912 精简验证说明

基线 upstream/main `175c59514b9ce4242b34b9f6bed1ac6a2ceb3545`；验证源码 `a9193cb40e809664b3f84ca3204876538e625cfa`。仅移植 f76f6aa、b7f88830、9b563da8，五个源码/测试文件。后续仅精简报告，源码与已验证树逐字节相同。#912 保持 draft。

完整历史源码审查、三出口模块图、构建/测试原始证据固定保留于 [19f2ac4f](https://github.com/ArietidsZ/FluentRead/tree/19f2ac4ffe587868ef2f73c52b3cdea32941920f/docs/reports/userscript-performance-clean-main-20261009)。删除只影响本分支新引入的报告文件，用普通后续提交完成；没有重写历史或改其他分支。旧3,589,291字节仍是18e→9b的历史测量。

| 实际出口 | main | 性能候选 | 结果 |
| --- | ---: | ---: | --- |
| standard | 1,963,967 | 1,964,011 | 原1,964,000预算超11；main通过 |
| standalone | 缺少既有别名导出，构建失败 | 3,595,173 | 原门禁通过，余4,827 |
| GF | 2,336,321 | 2,336,321 | 相同SHA；固定数据检查失败 |

standard SHA256 `e30fc1031c2feea9dd242883272009225ca251b0c5fd17e733e7c64f5f46bf61`；standalone `6f28435bf48d43a35c51b65ea661784e83b6c6f99b362c28bea38cf4af0b77e7`。类型、Chrome/Firefox构建、manifest、测试归类、42次实际根组件合成导航通过；当前八份gzip的24组typed输入与5组失败契约通过。受影响测试120/121通过，唯一“CPU 和内存”文案断言在main单项重放也失败。生产源码未改，未重跑这些完整验证。

GF原正式脚本在第79行固定数据检查停止，verifier未启动；其预算、可读性、URL、UI、Dexie和许可断言均未执行。此项及文案失败另列为基线问题，不混入修复。

## 44字节最终归因与实证

比较保留的最终JS，而非先重复全量构建。CSS相同；实际UTF-8语句区间的精确账目如下，renderedLength不作为最终收益：

| 最终JS变化区间 | 净字节 |
| --- | ---: |
| MD5初始化区由hoist改为缓存require函数 | +10 |
| AES从MD5值改为require调用 | +2 |
| CommonJS互操作绑定 | +28 |
| 其余对应AST仅局部标识符长度变化 | +4 |
| 合计 | **+44** |

本机使用现有Vite内嵌CommonJS插件和同一真实CryptoJS 4.2.0源码，只改变两个导入分支的到达顺序：`auto`得到95,520/95,886字节小图，MD5分别导出`default/__moduleExports`与`__require`；MD5与固定盐AES结果两侧完全一致。另一个四模块同源微型复现也得到相同分类切换。这证实当前已安装转换器存在加载顺序竞态，不能把44字节未经控制实验归为性能源码的语义回归。[官方26.0.1说明](https://raw.githubusercontent.com/rollup/plugins/commonjs-v26.0.1/packages/commonjs/README.md)也明确记录`auto`的混合require竞态。

安全选项`strictRequires:true`在真实CryptoJS小图两种顺序下SHA完全一致。仅一次standard诊断构建实测 **1,964,355字节**、超预算355，SHA256 `9d88be157cba5832995af1ade47cc27ef3a11042845ee7e44ad5b9ff007b8c80`；它未通过体积约束，未采用、未改变生产配置或原产物，也未宣称该诊断产物通过其他门禁。当前没有验证到符合本批限制且过预算的稳定修复。可验证的下一方案是采用该确定性策略并独立解决至少355字节的真实依赖开销；若保持`auto`，需先修正或升级其竞态实现并验证，而不能靠重试、导入顺序或缩小可执行源码取得一次通过。本批没有硬编码模块名单、关闭strictRequires、改预算或增加插件/依赖。

## 浏览器证据缺口与日志定位

只读18份现有FluentRead Neo owner记录及对应cleanup：均声明剩余PID/监听器为空。历史target与浏览器socket已经退役；缺少当前有效隔离owner/session和精确owned page websocket记录。未连接旧/未知socket、未枚举进程/窗口/端口、未启动新浏览器或操作Recovery。最终原样standalone IIFE的真实浏览器ungzip绑定仍未测，Node库/入口验证不代替它。

本批诊断与原始日志留在同一CW工作区 `userscript-performance-clean-pr-20261009/minimal-followup/`，索引为`DIAGNOSTIC-INDEX.json`。关键结果：`final-js-byte-attribution.json`、`actual-crypto-race.json`、`strict-true-standard-result.json`、`browser-records-ineligible.json`；命令/退出码与日志在上层`STAGES.json`及`followup-*.log.txt`。串行、CPU目标60%、单worker；无新增权限、依赖、模型/搜索API调用。本次后续提交仅报告精简，保留standard预算与浏览器证据缺口为合并阻塞。
