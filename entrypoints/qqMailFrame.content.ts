/**
 * @file entrypoints/qqMailFrame.content.ts
 * 文件职责：声明仅用于旧版 QQ 邮件阅读子页面的 WXT 内容入口。
 * 主要内容：以受限 URL 匹配启用 frame 注入，委托内容应用验证顶层来源并管理翻译生命周期。
 * 模块边界：不扩大通用 content 的注入范围，不匹配编辑、列表或 about:blank 页面。
 */
import {startQqMailFrameApp} from '@/src/app/content/qqMailFrameRuntime';
export default defineContentScript({
    matches: ['https://mail.qq.com/cgi-bin/readmail*'],
    allFrames: true,
    runAt: 'document_end',
    cssInjectionMode: 'ui',
    main: startQqMailFrameApp,
});
