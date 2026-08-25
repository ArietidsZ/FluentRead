/**
 * @file src/core/translation/adapters/learnopengl.ts
 *
 * 文件职责：声明 LearnOpenGL 教程站点的内容结构规则，优先选择章节 prose 并保护代码示例、目录和页面控件。
 * 主要内容：导出 learnOpenGLAdapter，将教程正文相关 selector 交给 createDeclarativeAdapter，处理该站点特有的嵌套布局而不改变通用核心。 可核对的公开符号包括 learnOpenGLAdapter。
 * 模块边界：本文件位于 core 的站点规则层，只表达 URL 与 DOM 候选决策；不发送翻译请求、不渲染译文、不监听业务生命周期，通用安全守卫仍由 TranslationCandidateCore 执行。
 */

import {createDeclarativeAdapter} from './declarative';

/**
 * LearnOpenGL's legacy image-backed navigation uses fixed-height menu rows.
 * Appending bilingual block content makes neighbouring rows overlap and can
 * cover their click targets, so the site-owned navigation stays untouched.
 * The reading surface under #content remains eligible for normal discovery.
 */
export const learnOpenGLAdapter = createDeclarativeAdapter({
    id: 'learnopengl',
    priority: 300,
    hosts: [{hostname: 'learnopengl.com', includeSubdomains: true}],
    prune: [
        {
            selector: '#nav',
            reason: 'learnopengl-fixed-navigation',
        },
    ],
});
