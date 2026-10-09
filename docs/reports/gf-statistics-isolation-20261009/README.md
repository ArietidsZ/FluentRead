# GF 六份 inline CSS 固定资源候选

基线 `9874f0d58d006c7bc883597fe38623b0c70349a9`；最终源码 `42ebf213de39d82c9ea8c755888b2f96e58c95f8`；固定资源 `adb33392e7bb8bb8e79fdb8c1147b287c0673793`。普通推送同一 `perf/gf-statistics-repositories-20261009` 候选分支，无新 PR；前批审查留在提交历史。

GF 专用 post transform 只匹配六个完整路径加 `?inline`：notice、picker、translation-display、page、bilingual-sentence-highlight、vocabulary-reencounter。使用 AST 捕获 **Vite 处理后的单个字符串 default export**，额外语句、表达式或解析错误立即拒绝。没有从原 CSS 文件读取运行时值。具名 `inlineStyles` 加入既有固定 data JSON，六个模块同步读取字符串，缺值/非 string 明确失败；独立于原全局 `css`。序列化按六端口固定键序。

notice/picker 的 ShadowRoot、挂载与关闭时机，pageStyles 的四份样式顺序、停用/卸载，以及动态外观 CSS 均留在原消费者。真实 GF entry 模块集合不变，三个消费者转换代码 SHA 与基线相同；六个完整 CSS 字符串正文不再留在主文件。源 CSS、三个消费者及 translationAppearance 文件字节未改。standard/standalone 不注册新插件。

| 产物 | 基线实际字节 | 最终实际字节 | 实际变化 |
| --- | ---: | ---: | ---: |
| GF 主文件 | 2,180,182 | **2,148,481** | **-31,701** |
| standard | 1,957,868 | 1,957,868 | 完整字节及 SHA 相同 |
| standalone | 3,590,688 | 3,590,688 | 最终原构建完整字节及 SHA 相同 |
| data | 930,496 | 964,406 | +33,910 |
| vendor | 610,343 | 610,343 | 完整字节及 SHA 相同 |
| 主文件 + 两资源 | 3,721,021 | 3,723,230 | **+2,209** |

独立 control/candidate 使用同长度固定 URL；最终正式主文件与最终独立候选仅两个 40 字符资源提交号不同，URL 长度 135/133 不变。31,701 是实际主文件减量；六份原字符串合计 32,608 只是数据计数。最终 GF SHA `b8dddc9da6e86f47d0453ab2eb6663d334f13ccddaddd749187db4380363cf85`。

六份实际 Vite 值与固定 data、GF 同步端口逐项精确字符串/UTF-8 字节/SHA 相等。原 english、zhCNMessages、siteCatalogs、css、characterData 五字段未变；完整 Unicode 来源/许可证和 data 头部字节保留，已审查 vendor 全部字节保留。

最小红契约 15 项：12 预期失败、3 通过；最终同步/AST/输出隔离契约 **16/16**。首次正式流程发现 transform 完成顺序导致 data SHA 不稳定，未执行 verifier；补充逆序完成的红契约后，固定六键序修复，最终原流程的 fixed-resource 检查通过。notice、picker、pageStyles 原契约用求值后的实际 GF CSS 端口执行 **88/88 合成 DOM**，另正常 CSS 路径 88/88；最终 shipped data realm 1 项、类型和测试归类通过。辅助工具解析/类型错误的原失败日志保留，文档执行结果见收据。

一次 standalone 原重建为 3,590,643（-45），原输出留 CW。相邻基线/当前控制的 resolved config、全部 1,182 模块代码 SHA 和 renderedLength 完全相同，两份产物均等于原基线 SHA；随后最终原构建也等于基线。记录构建波动，不改 standalone 策略、不将中间输出作为最终成果。最终 prepare 的 vendor 多 44 字节，19 个已检查输入未变；保留原输出且不推测成因，未采用此无关变更，正式原流程按既有行为复制固定 vendor。

最终两资源 tracked/built/固定 Git/远端 GitHub blob/主文件精确 CDN 响应均逐字节及 SHA 一致，两个 URL 首次 HTTP 200。原 GF 第 15 行预算仍失败，超 **148,481**；后续正式断言未执行。逐个未改原 assertion 的独立诊断 18 项中 17 通过、仅预算失败，后续 16 项诊断通过，**不代表正式 GF 通过**。

未运行浏览器或最终 IIFE 实测，未新增依赖、权限或真实搜索/模型调用。剩余阻塞是 2 MB 预算与浏览器实测。#912、cb07 及其他受保护引用保持不变。

[小型收据](./verification-receipt.json)保存六项 SHA、真实图/资源绑定和阶段哈希；完整图、日志、未采用产物仅留 CW。
