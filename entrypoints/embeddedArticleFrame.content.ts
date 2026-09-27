/**
 * @file entrypoints/embeddedArticleFrame.content.ts
 * 文件职责：仅在受支持的 Disqus 评论与 Kaggle 笔记本正文子文档注入翻译入口。
 * 主要内容：限制 HTTPS 匹配路径并启用子 frame 注入，交给运行时及后台再次核验顶层来源。
 * 模块边界：通用内容入口仍只在顶层运行；不匹配广告、登录和任意第三方 iframe。
 */
import {startEmbeddedFrameApp} from '@/src/app/content/embeddedFrameRuntime';

export default defineContentScript({
    matches: [
        'https://disqus.com/embed/comments/*',
        'https://www.kaggleusercontent.com/kf/*/__results__.html*',
    ],
    allFrames: true,
    runAt: 'document_end',
    cssInjectionMode: 'ui',
    main: startEmbeddedFrameApp,
});
