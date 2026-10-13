# Claude Code 单次交付批次：设置页服务与模型搜索一致性

## 批次范围

本批次只包含一个边界明确的编码任务：统一设置页服务目录和模型选择器的文本匹配规则。完成本任务即结束本批次，不自行扩展到其他缺陷或后续批次。

- 仓库：ArietidsZ/FluentRead
- 固定代码基线：0652ce2309c76a09310868acb45e71990533b500
- 难度：低至中
- 源码核查日期：2026-10-13
- 本交接由源码检查支持；未运行复现测试或浏览器验收。
- 此文档所在分支仅作交接，不代表生产实现或已通过验收。

从固定基线建立独立实现分支；不要混入其他工作分支。最新上游代码只用于交叉核查，不授权自动同步、覆盖或移植其他更改。

## 问题与源码证据

同一产品的三个入口存在不同规则：

1. Popup 的 searchServiceOptions 使用 NFKC、小写规范化，以及忽略空白、点、下划线、斜杠、圆括号和连字符的紧凑匹配。
2. 设置页服务目录只做 NFKC、小写和普通子串匹配，Open AI 无法找到 OpenAI。
3. 设置页模型选择器缺少 NFKC 及分隔符容错；GPT 4.1 mini 或 ｇｐｔ－４．１－ｍｉｎｉ 无法找到 gpt-4.1-mini。

固定基线：
- [现有纯搜索逻辑](https://github.com/ArietidsZ/FluentRead/blob/0652ce2309c76a09310868acb45e71990533b500/src/ui/view-model/serviceCatalog.ts#L286-L323)
- [设置服务目录](https://github.com/ArietidsZ/FluentRead/blob/0652ce2309c76a09310868acb45e71990533b500/src/features/settings/ui/services/ServiceCatalog.vue#L217-L223)
- [模型选择器](https://github.com/ArietidsZ/FluentRead/blob/0652ce2309c76a09310868acb45e71990533b500/src/features/settings/ui/services/ModelPicker.vue#L172-L176)
- [已有搜索测试](https://github.com/ArietidsZ/FluentRead/blob/0652ce2309c76a09310868acb45e71990533b500/tests/serviceCatalog.test.ts)
- [实际 OpenAI 目录项](https://github.com/ArietidsZ/FluentRead/blob/0652ce2309c76a09310868acb45e71990533b500/src/core/config/catalog.ts#L636)
- [实际模型目录项](https://github.com/ArietidsZ/FluentRead/blob/0652ce2309c76a09310868acb45e71990533b500/src/core/config/catalog.ts#L475-L476)

上游 cf52fdd80e2d39ad1f4b1a413c9660d45edddec6 仍存在差异：
- [ServiceCatalog](https://github.com/FluentRead/FluentRead/blob/cf52fdd80e2d39ad1f4b1a413c9660d45edddec6/src/features/settings/ui/services/ServiceCatalog.vue#L253-L262)
- [ModelPicker](https://github.com/FluentRead/FluentRead/blob/cf52fdd80e2d39ad1f4b1a413c9660d45edddec6/src/features/settings/ui/services/ModelPicker.vue#L195-L199)
- [Popup 规则](https://github.com/FluentRead/FluentRead/blob/cf52fdd80e2d39ad1f4b1a413c9660d45edddec6/src/ui/view-model/serviceCatalog.ts#L287-L324)

已检查 fork Issues/PR 列表、相关搜索及上游近期 100 个 PR，未发现同范围任务；这不是全历史无重复的保证。相邻 #874、#883、#902、#946 的分组、模型文案及 Popup 排序不在本任务内。不要附带移植上游已经修复的模型添加容量、长度或上下文检查。

## 实现要求

- 复用或抽取现有纯文本匹配逻辑，避免三份重复实现；保持模块依赖方向，不引入新依赖。
- 服务目录仍只查名称、ID、描述和 searchTerms，不引入全服务模型索引。
- 模型选择器仍只查现有 label 和 value；匹配归一化不得修改显示值、ID 或存储值。
- 保留现有分组、选项顺序、空状态和 Popup 模型解析。
- 空白查询返回原有全部选项；仅含分隔符的非空查询不能因紧凑字符串为空而意外匹配全部。
- 保留现有普通子串匹配：例如某些标点在原名称中确实存在时仍可直接命中。不要将上一条错误实现为“所有标点查询一律无结果”。
- 搜索不得触发选择、添加、删除、连接测试或翻译请求。

建议改动范围：
- src/ui/view-model/serviceCatalog.ts
- src/features/settings/ui/services/ServiceCatalog.vue
- src/features/settings/ui/services/ModelPicker.vue
- tests/serviceCatalog.test.ts
- 一个聚焦组件测试文件，例如 tests/serviceSearchComponent.test.ts
- tests/test-matrix.json 及确有必要的测试说明

## 确定性验收

1. 服务目录：OpenAI、open ai、ＯＰＥＮ　ＡＩ 均命中真实 openai 选项。
2. 模型选择器：gpt-4.1-mini、GPT 4.1 mini、gpt_4.1_mini、ｇｐｔ－４．１－ｍｉｎｉ 均命中同一模型。
3. local/translation-model 可被 local translation model 命中，显示和最终选择事件仍保留原始 ID。
4. 既有别名、中文名称、描述、模型标签和普通子串搜索继续有效。
5. 空字符串、全空白保留原顺序、分组和唯一性。
6. 不存在的词返回空结果；分隔符查询不产生空串导致的全匹配，同时保留直接子串语义。
7. 清空搜索、关闭重开、修改 props.options 后再次搜索，均使用当前数据。
8. 仅输入查询不发出选择、添加或删除事件；点击选项只发出一次原始 ID。
9. Popup 既有搜索、自定义模型解析和顺序测试保持通过。

至少提交一份同一测试在旧源码失败、修改后通过的红绿证据。组件测试应执行真实组件逻辑，复用仓库已有 Vue SFC 测试方式；不得仅做源码字符串断言。

## 验证与交付

先阅读该基线的 AGENTS.md、docs/testing.md、package.json。新增测试在 tests/test-matrix.json 中唯一归类，不降低覆盖率或放宽断言。

先运行聚焦检查，避免在明显失败时重复跑整套：
- pnpm test tests/serviceCatalog.test.ts tests/serviceSearchComponent.test.ts tests/settingsUiArchitecture.test.ts
- pnpm test:audit
- pnpm compile
- pnpm test:architecture

聚焦检查通过后，按仓库要求完成适用的交付门禁：
- pnpm test:unit
- pnpm test:functional
- pnpm test:regression
- pnpm test:coverage
- pnpm build
- pnpm build:firefox
- pnpm test:userscript
- 修改文档时按仓库要求运行 pnpm docs:build

如基线或依赖阻塞，记录准确命令、失败项和对照，不顺手修复无关问题，不把未运行写成通过。标明组件模拟、构建和真实浏览器验证的区别；不得调用付费或真实翻译供应商来测试搜索。

交付小范围差异、实现 commit、红绿测试记录和逐项命令结果。若任务执行端没有明确的代码推送授权，先提供本地 commit 或 patch 供用户取回；此任务文档本身不授予 PR 发布、上游投稿、合并或部署权限。

## 禁止扩展

不改翻译请求、provider 路由、凭据、连接测试、tabless/userscript 隐私、私有缓存、批量去重、词语上下文、配置迁移、依赖、构建体积、Pi 或 Recovery。不得合并其他候选分支，不重做 Popup 常用排序和模型摘要。
