/**
 * @file src/features/full-page-translation/content/mutationObservation.ts
 * 文件职责：为全文翻译组合 DOM 观察选项，并计算突发变化的扫描边界。
 * 主要内容：保留通用保护和产物完整性属性，合并网站依赖；复杂选择器取消属性过滤，并按树包含关系合并扫描根。
 * 模块边界：仅生成选项和读取传入节点的树关系，不创建 MutationObserver、不读取全局 DOM 或配置。
 */
import {getSiteAdapterAttributeFilter} from '@/src/core/site-adaptation/compiler';
import type {TranslationSiteAdapter} from '@/src/core/translation/types';

export function createTranslationMutationObserverOptions(adapters: readonly TranslationSiteAdapter[]): MutationObserverInit {
    const attributeFilter = getSiteAdapterAttributeFilter(adapters, [
        'style', 'class', 'role', 'hidden', 'inert', 'contenteditable', 'aria-hidden', 'translate',
        'lang', 'dir', 'href', 'title', 'data-notranslate', 'data-fr-translation-owned',
    ]);
    return {
        childList: true, subtree: true, characterData: true, characterDataOldValue: true,
        attributes: true, attributeOldValue: true,
        ...(attributeFilter === null ? {} : {attributeFilter}),
    };
}

/** 脏根合并以真实树包含关系为准，异常或缺失 contains 时不吞掉待扫描根。 */
export function mutationRootContains(ancestor: Node, descendant: Node): boolean {
    if (ancestor === descendant) return true;
    try { return typeof ancestor.contains === 'function' && ancestor.contains(descendant); }
    catch { return false; }
}

/** 突发变更只能扩展到所属 document 或 ShadowRoot，不能丢失另一棵树。 */
export function collapseMutationRescanRoot(node: Node): Node {
    const root = node.getRootNode();
    return root.nodeType === 9 ? (root as Document).documentElement : root;
}
