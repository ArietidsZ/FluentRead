/**
 * @file src/core/translation/adapters/bilibili.ts
 *
 * 文件职责：声明 B 站评论组件的候选保护规则，避免翻译渲染进入由 B 站自定义元素和 Shadow DOM 管理的评论子树。
 * 主要内容：导出 bilibiliAdapter，裁剪评论根节点及其兼容性后备节点，保留视频页其他普通正文继续使用通用候选发现。
 * 模块边界：本文件位于 core 的站点规则层，只表达 URL 与 DOM 候选决策；不发送翻译请求、不渲染译文、不监听业务生命周期，通用安全守卫仍由 TranslationCandidateCore 执行。
 */

import {createDeclarativeAdapter} from './declarative';

/**
 * B 站评论由多层自定义元素维护自己的 Shadow DOM。向其中插入双语节点会把
 * FluentRead 的 DOM 事务交给站点渲染器共同管理，双击评论时尤其容易触发页面卡死。
 * 评论区是交互组件而非文章正文，因此整棵评论子树保持由 B 站自己维护。
 */
export const bilibiliAdapter = createDeclarativeAdapter({
    id: 'bilibili',
    priority: 380,
    hosts: [{hostname: 'bilibili.com', includeSubdomains: true}],
    prune: [
        {
            selector: [
                '#commentapp',
                'bili-comments',
                'bili-comment-thread-renderer',
                'bili-comment-renderer',
                'bili-rich-text',
            ],
            reason: 'bilibili-comment-component',
        },
    ],
});
