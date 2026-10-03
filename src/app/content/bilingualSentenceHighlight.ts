/**
 * @file src/app/content/bilingualSentenceHighlight.ts
 * 文件职责：将内容应用的高亮配置接入逐句高亮功能的安装和卸载生命周期。
 * 主要内容：按 Document 幂等管理高亮实例、页面开关和可即时切换的样式属性，不触碰翻译状态或请求流程。
 * 模块边界：这里只负责页面级配置接线；句子定位归 full-page-translation feature，配置持久化由 config service 管理。
 */
import {installBilingualSentenceHighlight} from '@/src/features/full-page-translation/content/sentenceHighlight';
import {normalizeSentenceHighlightStyle} from '@/src/core/config/sentenceHighlight';

export const BILINGUAL_SENTENCE_HIGHLIGHT_ATTRIBUTE = 'data-fr-bilingual-sentence-highlight';
export const BILINGUAL_SENTENCE_HIGHLIGHT_STYLE_ATTRIBUTE = 'data-fr-bilingual-sentence-highlight-style';
const disposers = new WeakMap<Document, () => void>();

export function syncBilingualSentenceHighlight(document: Document, enabled: boolean, style?: unknown): void {
    const root = document.documentElement;
    if (!root) return;
    if (enabled) {
        root.setAttribute(BILINGUAL_SENTENCE_HIGHLIGHT_STYLE_ATTRIBUTE, normalizeSentenceHighlightStyle(style));
        if (disposers.has(document)) return;
        root.setAttribute(BILINGUAL_SENTENCE_HIGHLIGHT_ATTRIBUTE, 'true');
        disposers.set(document, installBilingualSentenceHighlight(document));
    } else {
        disposers.get(document)?.();
        disposers.delete(document);
        root.removeAttribute(BILINGUAL_SENTENCE_HIGHLIGHT_ATTRIBUTE);
        root.removeAttribute(BILINGUAL_SENTENCE_HIGHLIGHT_STYLE_ATTRIBUTE);
    }
}
