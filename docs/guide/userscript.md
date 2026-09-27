# 油猴脚本

如果你使用 Tampermonkey、Violentmonkey、Via 或 Safari Userscripts，也可以安装 FluentRead 油猴脚本，在网页中使用核心翻译功能。具体支持情况取决于浏览器和脚本管理器版本。

## 直接安装

打开 [Greasy Fork 安装流畅阅读油猴脚本](https://greasyfork.org/zh-CN/scripts/482986-%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB)，按照脚本管理器提示完成安装。

Greasy Fork 上的版本可能晚于 GitHub 源码。排查问题时，请先查看安装页和脚本设置中的版本号。当前自动化运行验证覆盖 Chrome 与 Violentmonkey；Safari Userscripts 和 Via 仍需实际设备验证。

安装完成后：

1. 打开一篇普通网页；
2. 在脚本管理器中确认 FluentRead 已启用；
3. 使用页面翻译、划词翻译或悬浮球开始阅读。提供脚本菜单的管理器也可以从菜单打开设置。

## Safari Userscripts 安装与排查

1. 从 App Store 安装 Userscripts，并在 Safari 的扩展设置中启用。iPhone/iPad 上打开「设置 → Safari → 扩展 → Userscripts」；允许它访问所有网站，并在 Safari 中选择「始终允许」。macOS 上也要为访问的网站授予权限。
2. iPhone/iPad 上先在 Userscripts App 中设置脚本目录；macOS 可使用默认目录。在 Safari 打开上方安装页，通过 Userscripts 工具栏的安装提示保存并启用脚本。安装时保持联网，让管理器下载 `@require` 中的界面依赖。
3. 在 Userscripts 弹出窗口确认「Enable Injection」已开启，FluentRead 对当前网页已匹配且启用，然后刷新一个普通的 HTTP(S) 网页。设置从页面悬浮球打开；Safari Userscripts 没有脚本菜单命令。
4. 如果脚本是直接加入脚本目录或从外部编辑器修改的，至少打开一次 Userscripts 弹出窗口，让它重新读取文件。仍未出现悬浮球时，请检查脚本版本、站点权限、当前页是否匹配，以及管理器是否成功下载依赖；反馈时附上 Safari、系统、Userscripts 版本和出问题的网页地址。

这些步骤依据 [Userscripts 官方安装与元数据说明](https://github.com/quoid/userscripts/tree/release/4.x.x)；Safari 上的实际运行情况仍需设备验证。

## 可以做什么？

- 全文翻译、恢复原文和再次翻译；
- 划词、悬浮、双击、长按和中键翻译；
- 输入框翻译、复制和朗读；
- 使用免费服务、云端服务、AI 服务或自定义接口；
- 在脚本自己的设置页中保存语言、服务和显示偏好。

首次安装需要脚本管理器访问 jsDelivr，取得固定版本的界面依赖。简体中文和英文界面随脚本提供；首次切换到日语、韩语、法语、俄语或西班牙语时，脚本会从 jsDelivr 或 GitHub 下载对应的静态界面语言文件，并缓存在脚本管理器的私有存储中。这些请求不包含正在阅读的网页内容或 API Key。离线环境中，尚未缓存的语言会暂时使用中文界面。

## 和浏览器扩展有什么不同？

油猴脚本受脚本管理器和网页权限限制，不能提供浏览器扩展的全部能力。图片 OCR、圈选截图、Chrome 内置翻译、跨标签页后台功能和 YouTube 字幕功能可能不可用；不同脚本管理器的行为也可能不同。

## 数据与隐私

脚本配置保存在脚本管理器提供的私有存储中。翻译请求会发送到你当前选择的服务；界面依赖和语言文件按上文所述从 jsDelivr 或 GitHub 获取。使用云端服务前，请确认服务商的数据政策。不要在共享设备上填写 API Key，也不要把密钥放进网页、截图或公开反馈。
