<!--
 * @file docs/guide/chrome-translator.md
 * 文件职责：说明 Chrome 内置 Translator 与 Language Detector 在 FluentRead 中的准备流程、能力边界和官方排错入口。
 * 主要内容：解释语言对准备、自动源语言、首次下载、用户激活、浏览器支持和模型诊断。
 * 模块边界：本文只描述 Chrome 官方 API 与 FluentRead 的设置流程，不承诺所有语言对均可用，也不代替 Chrome 的运行时能力检查。
 -->
# Chrome 本地翻译

FluentRead 可以调用 Chrome 的内置 Translator API 和 Language Detector API，在设备本地完成语言识别与翻译。设置页的“准备 Chrome 本地翻译”按钮只检查当前配置的语言对：源语言来自“翻译设置”，目标语言跟随目标语言设置。源语言为“自动”时，FluentRead 优先使用最近的待准备记录，但仅在其目标语言与当前设置一致时采用；没有可用记录时用固定的 en/fr 校验句完成当前目标的模型自检。网页正文翻译仍由网页侧自动识别原文。

待准备的语言对会在当前浏览器会话中分别保留，完成一种语言的准备不会清除其他语言的待处理记录。

首次准备时 Chrome 可能下载本地模型。下载需要一次明确的用户操作，因此请直接点击按钮并保持设置页打开。准备完成后回到网页重试翻译；一次检查完成只代表当前语言对已经完成准备，不代表所有语言都已准备。

## 能力限制

Chrome 官方文档目前将 Translator API 和 Language Detector API 列为桌面 Chrome 能力，并要求运行时检查 `availability()`。`downloadable` 表示 Chrome 可能支持但仍需准备，不能直接当作“不支持”；只有运行时明确无法创建模型时，FluentRead 才会提示模型不可用。浏览器策略、模型下载状态和 Chrome 版本都可能影响结果。

扩展页面可以调用这些 API，但 Chrome 的 API 运行在窗口文档上下文；扩展 service worker 本身不能直接使用需要 `Window` 的接口。首次模型下载仍受用户激活约束，不能通过后台静默完成。

## 官方资料

- [Translator API](https://developer.chrome.com/docs/ai/translator-api)
- [Language Detector API](https://developer.chrome.com/docs/ai/language-detection)
- [Chrome 内置 AI 入门与要求](https://developer.chrome.com/docs/ai/get-started)
- [Chrome 内置模型排错](https://developer.chrome.com/docs/ai/debug-built-in-model)
- [Translator 与 Language Detector API Playground](https://chrome.dev/web-ai-demos/translation-language-detection-api-playground/)

## 排错

如果准备失败，请先确认 Chrome 版本、当前浏览器策略和网络/模型下载状态。Chrome 官方排错入口是 `chrome://on-device-internals`：查看 `Event Logs` 与 `Model Status`，必要时导出诊断信息。这个地址属于浏览器内部页面，适合手动复制到地址栏打开，不作为普通网页链接点击。

FluentRead 的错误消息会保留 Chrome 返回的原始原因，便于在展开官方帮助后进一步诊断。`NotSupportedError` 只说明当前 Chrome 无法创建这次模型，不等于已经证明目标语言本身不支持。
