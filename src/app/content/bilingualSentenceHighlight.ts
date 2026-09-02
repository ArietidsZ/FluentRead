/**
 * @file src/app/content/bilingualSentenceHighlight.ts
 * 文件职责：同步网页根节点上的双语逐句高亮开关，供内容应用控制 page.css 的可选视觉状态。
 * 主要内容：定义高亮配置属性名称和安全的 Document 属性同步函数，不触碰翻译状态或请求流程。
 * 模块边界：这里只负责页面级视觉开关；双语译文 DOM 由全文翻译 renderer 管理，配置持久化由 config service 管理。
 */

export const BILINGUAL_SENTENCE_HIGHLIGHT_ATTRIBUTE = 'data-fr-bilingual-sentence-highlight';

export function syncBilingualSentenceHighlight(document: Document, enabled: boolean): void {
    const root = document.documentElement;
    if (!root) return;
    if (enabled) root.setAttribute(BILINGUAL_SENTENCE_HIGHLIGHT_ATTRIBUTE, 'true');
    else root.removeAttribute(BILINGUAL_SENTENCE_HIGHLIGHT_ATTRIBUTE);
}
