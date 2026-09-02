/**
 * @file src/core/translation/adapters/reddit.ts
 *
 * 文件职责：声明 Reddit 页面中帖子与评论文本的翻译适配规则，限制候选在用户可读内容而非导航或操作区。
 * 主要内容：导出 redditAdapter，以 host 和站点 DOM selector 建立声明式规则，供候选引擎按照统一优先级和安全守卫执行。 可核对的公开符号包括 redditAdapter。
 * 模块边界：本文件位于 core 的站点规则层，只表达 URL 与 DOM 候选决策；不发送翻译请求、不渲染译文、不监听业务生命周期，通用安全守卫仍由 TranslationCandidateCore 执行。
 */

import {createDeclarativeAdapter} from './declarative';

const redditPostProseSelectors = [
    'shreddit-post [slot="text-body"] p',
    'shreddit-post [slot="text-body"] li',
    'shreddit-post [slot="text-body"] blockquote',
    'shreddit-post [slot="text-body"] h1',
    'shreddit-post [slot="text-body"] h2',
    'shreddit-post [slot="text-body"] h3',
    'shreddit-post [slot="text-body"] h4',
    'shreddit-post [slot="text-body"] h5',
    'shreddit-post [slot="text-body"] h6',
    '[data-testid="post-content"] p',
    '[data-testid="post-content"] li',
    '[data-testid="post-content"] blockquote',
    '[data-click-id="text"] p',
    '[data-click-id="text"] li',
    '[data-click-id="body"] p',
    '[data-click-id="body"] h1',
    '[data-click-id="body"] h2',
    '[data-click-id="body"] h3',
    '[data-click-id="body"] h4',
    '[data-click-id="body"] h5',
    '[data-click-id="body"] h6',
] as const;

const redditCommentProseSelectors = [
    'shreddit-comment [slot="comment"] p',
    'shreddit-comment [slot="comment"] li',
    'shreddit-comment [slot="comment"] blockquote',
    'shreddit-comment [id$="-comment-rtjson-content"] p',
    '[data-testid="comment"] p',
    '[data-testid="comment"] li',
    '[data-click-id="comment"] p',
] as const;

const redditControlSelectors = [
    'button',
    '[role="button"]',
    '[role="menuitem"]',
] as const;

export const redditAdapter = createDeclarativeAdapter({
    id: 'reddit',
    priority: 390,
    // Reddit 的页面壳层包含大量由 Web Component 生成的按钮、链接和 aria 文案。
    // 参照沉浸式翻译的 Reddit 规则，只接收下方显式声明的正文 target。
    genericCandidatePolicy: 'targets-only',
    hosts: [
        {hostname: 'reddit.com', includeSubdomains: true},
        {hostname: 'redd.it', includeSubdomains: true},
    ],
    prune: [
        {
            selector: ['reddit-composer', '[data-testid="comment-submission-form"]'],
            reason: 'reddit-composer',
        },
    ],
    targets: [
        {
            selector: ['shreddit-post [slot="title"]', 'h1[id^="post-title-"]'],
            reason: 'reddit-post-title',
            match: 'closest',
            atomic: true,
        },
        {
            selector: redditPostProseSelectors,
            reason: 'reddit-post-prose',
            match: 'closest',
        },
        {
            selector: redditCommentProseSelectors,
            reason: 'reddit-comment-prose',
            match: 'closest',
        },
    ],
    keepOriginal: [
        {
            selector: redditControlSelectors,
            reason: 'reddit-controls',
        },
        {
            selector: ['faceplate-timeago', '[data-testid="post_timestamp"]', '[data-testid="vote-arrows"]'],
            reason: 'reddit-dynamic-metadata',
        },
    ],
    mutationExclude: [
        {
            selector: [
                ...redditControlSelectors,
                'faceplate-timeago',
                '[data-testid="post_timestamp"]',
                '[data-testid="vote-arrows"]',
                'shreddit-status',
                '[aria-live]',
            ],
            reason: 'reddit-controlled-mutation',
        },
    ],
});
