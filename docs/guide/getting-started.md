# 安装与第一次翻译

从安装到看到第一段译文，按下面三步完成。免费翻译服务无需填写密钥。

<GuideVisual kind="install" />

## 安装

选择你正在使用的浏览器，进入官方商店添加 FluentRead：

| 浏览器 | 官方安装入口 |
| --- | --- |
| Chrome | [Chrome 应用商店](https://chromewebstore.google.com/detail/djnlaiohfaaifbibleebjggkghlmcpcj) |
| Edge | [Edge 加载项](https://microsoftedge.microsoft.com/addons/detail/kakgmllfpjldjhcnkghpplmlbnmcoflp) |
| Firefox | [Firefox 附加组件](https://addons.mozilla.org/zh-CN/firefox/addon/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB/) |

安装后将图标固定到工具栏。安装前已经打开的网页，刷新一次。

第一次打开菜单时，先点击欢迎页的 **设置界面语言 / Set interface language**。语言卡片会完整显示中文与英文名称；选择后点击 **确认 / Confirm** 进入主菜单，以后打开会直接显示主菜单。界面语言只影响扩展按钮与设置文字，网页翻译的目标语言在主菜单中单独选择。

欢迎页只加载引导所需内容，双语提示随扩展提供。确认语言后才准备主菜单与所选界面的完整文案，等待和欢迎页保持稳定尺寸。

<details class="guide-details">
<summary>手机、油猴脚本与 Thunderbird</summary>

支持扩展的 **安卓 Edge** 可从扩展入口搜索 FluentRead，在扩展列表打开菜单，再点击网页翻译。手机使用菜单或已开启的悬浮球，不使用桌面快捷键和右键菜单。iPhone/iPad 上的 Edge 扩展可用性仍需另行确认。

其他安装方式：[油猴脚本](/guide/userscript) · [Thunderbird 邮件翻译](/guide/thunderbird)。

</details>

## 第一次翻译

### 1. 打开文章

用新闻、博客或论坛中的普通网页开始。浏览器设置页和扩展商店不允许扩展翻译。

### 2. 确认目标语言

点击工具栏里的 FluentRead 图标。源语言保留 **自动检测**，目标语言选择你想读的语言；默认是 **简体中文**。服务保留 **免费翻译服务**。

<figure class="doc-figure">
<a href="/screenshots/ui/zh-CN/popup.webp" target="_blank" rel="noopener"><img class="doc-screenshot popup" src="/screenshots/ui/zh-CN/popup.webp" width="640" height="874" alt="实际扩展菜单：先确认目标语言和免费翻译服务，再点击网页翻译按钮" loading="lazy" /></a>
<figcaption>真实扩展菜单。点击图片查看高清原图。</figcaption>
</figure>

### 3. 点击“翻译页面”

点击菜单中的 **翻译当前网页**。原文下方出现译文；向下滚动，继续阅读后面的段落。

<BrandReader />

### 4. 随时回到原文

打开菜单，点击 **恢复当前网页**。想换语言或服务时，先恢复，再重新翻译。

<details class="guide-details">
<summary>简繁转换与不需要翻译的文字</summary>

简体中文和繁体中文可以单独选择。已经属于目标中文书写体系的内容会保留原文；少量 AI、CoT、OpenAI 等缩写，以及 PDF、ePub、DOCX、Markdown 等格式名称不会让整段中文重复翻译。简繁转换、混合书写体系、完整外语段落或无法确认语言的内容仍会尝试翻译。

</details>

## 只想查一句话

在菜单中开启 **划词翻译**。选中一句，点击附近的 FluentRead 图标看译文；需要查词或拆句时，切换[卡片模式](/guide/deepseek-harness)。

只查一个段落，可以把鼠标放在段落上，按 **Control**：[悬浮段落翻译](/guide/hover-translation)。

## 点击后没有变化

确认扩展已开启，刷新普通网页再试。免费服务繁忙时稍后重试，或[切换服务](/config/translation-engines)。仍无结果，按[常见问题](/guide/faq)排查。

## 接下来

- [选择下一项任务](/docs/)
- [调整译文外观](/config/appearance)
- [连接自己的 AI 服务](/config/translation-engines)
