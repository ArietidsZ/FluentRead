# 无痕翻译持久缓存隔离

范围：后台翻译 broker 的持久缓存、在途请求去重和模型用量/翻译统计；同时关闭原本已接收可信无痕标记的阅读与写作助手用量记录。此修改不改变任何供应商选择，不新增设置，也不申请无痕访问权限。

- 普通窗口沿用原有缓存与统计行为。
- 无痕来源只接受浏览器 sender.tab.incognito 或扩展私密进程标记；页面 payload 中的同名字段不可信。
- 图片 OCR 的 Offscreen 回调沿用现有活跃事务注册表保存的真实来源；事务完成或失败后清理。
- 无痕文本不读取/写入普通翻译缓存，不与普通窗口在途调用合并，不写 broker 统计。没有新增持久隐私档案或跨窗口全局开关。
- 不宣称整个扩展完全无痕：词典、朗读、视频转录缓存及用户主动保存/导出行为不在此改动范围。

## 验证

使用本地合成文本和 mock provider，没有外发真实页面数据。

`tests/privateTranslationIsolation.test.ts` 覆盖缓存读写、用量记录、普通请求保持原样、同供应商同模型同时请求的去重隔离，以及真实/伪造上下文。追加批量正文、页面摘要并发和 token 用量记录专项，4 项全部通过。
`tests/imageGlossaryContext.test.ts` 新用例覆盖私密图片事务与普通图片并发、Offscreen 回调与失效清理。

实际消融：把 broker 替换为基线 73f1bd3 的原文件后运行隔离测试，3 项中 2 项失败：私密请求读取共享缓存；相同普通/私密请求只调用一次 provider。恢复修改后 3 项通过。证明隔离属于已有缺陷修复，与专用模型配置独立。

现有图片术语测试 2 项失败（期望原词 API，而实际已被术语占位符替换）；在未修改基线同样复现。未把这些失败归因于本次改动或顺手修改。

真实浏览器隐私窗口验证尚未完成。共享环境 WXT prepare 原有 ONNX native 动态库版本冲突；独立 worker 导入修复是构建验证的环境前提，不包含在本补丁中。初次直接 vue-tsc 在 Node 默认约 2GB heap 下耗尽内存，不能据此声称类型检查通过。

## 浏览器依据

- [Chrome incognito manifest](https://developer.chrome.com/docs/extensions/reference/manifest/incognito)：默认 spanning；即使 split，storage.local/sync 仍共享。
- [Firefox incognito manifest](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/incognito)：Firefox 不支持 split；必须以真实 Tab/Window 的 incognito 区分来源。
- [inIncognitoContext](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/extension/inIncognitoContext)：内容脚本或私密扩展进程的上下文标记。
