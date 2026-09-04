/**
 * @file src/features/full-page-translation/content/orphanArtifacts.ts
 * 文件职责：清理宿主 clone/remount 后失去状态所有权的 FluentRead 轻 DOM 产物，并保住仅译文模式中的宿主原文。
 * 主要内容：移除直属双语/loading/retry 孤儿，解包 single-slot 的 light DOM 文本，排除译文产物判定同源重挂，并跳过仍由活动 WeakMap 状态管理的真实产物。
 * 模块边界：本文件只规范化明确带 FluentRead owned 标记的孤儿 DOM，不发现候选、不发请求，也不删除仅凭同名 class 无法证明所有权的宿主节点。
 */
import {
    getTranslationOwnersForRemovedNode,
    getTranslationState,
} from '@/src/features/full-page-translation/content/state';

const REMOVABLE_ORPHAN_ARTIFACT_SELECTOR = [
    '.fluent-read-bilingual-content[data-fr-translation-owned="true"]',
    '.fluent-read-loading[data-fr-translation-owned="true"]',
    '.fluent-read-retry-wrapper[data-fr-translation-owned="true"]',
].join(',');
const OWNED_SINGLE_SLOT_SELECTOR =
    '.fluent-read-single-slot[data-fr-translation-owned="true"]';
const normalizedOwnerClassMutations = new WeakSet<HTMLElement>();
const OWNED_ARTIFACT_SELECTOR = '[data-fr-translation-owned="true"]';

function asHTMLElement(node: Element | null): HTMLElement | null {
    if (!node) return null;
    const HTMLElementConstructor = node.ownerDocument.defaultView?.HTMLElement;
    return HTMLElementConstructor && node instanceof HTMLElementConstructor
        ? node as HTMLElement
        : null;
}

function queryElements(root: Node, selector: string): Element[] {
    const elements: Element[] = [];
    if (root.nodeType === 1 && (root as Element).matches(selector)) elements.push(root as Element);
    const queryRoot = root as Node & ParentNode;
    if (typeof queryRoot.querySelectorAll === 'function') {
        elements.push(...Array.from(queryRoot.querySelectorAll(selector)));
    }
    return elements;
}

function normalizedNodeText(node: Node): string {
    if (node.nodeType === 3) return (node as Text).data;
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    if (element.matches(OWNED_ARTIFACT_SELECTOR)) return '';
    const clone = element.cloneNode(true) as Element;
    queryElements(clone, OWNED_ARTIFACT_SELECTOR).forEach((artifact) => artifact.remove());
    return clone.textContent!;
}

/** 清理一个没有活动状态、但仍携带直属扩展产物的克隆 owner。 */
export function normalizeOrphanedTranslationOwner(node: HTMLElement): void {
    if (getTranslationState(node)) return;
    const orphaned = Array.from(node.children).filter((child) =>
        child.matches(REMOVABLE_ORPHAN_ARTIFACT_SELECTOR));
    if (orphaned.length === 0) return;

    orphaned.forEach((child) => child.remove());
    const nextClassName = Array.from(node.classList)
        .filter((className) => className !== 'fluent-read-bilingual' && className !== 'fluent-read-failure')
        .join(' ');
    if (node.getAttribute('class') !== (nextClassName || null)) {
        normalizedOwnerClassMutations.add(node);
        if (nextClassName) node.setAttribute('class', nextClassName);
        else node.removeAttribute('class');
    }
}

/** 识别并只消费一次孤儿 owner 清理产生的 class MutationRecord。 */
export function consumeOrphanedOwnerClassMutation(node: HTMLElement): boolean {
    if (!normalizedOwnerClassMutations.has(node)) return false;
    normalizedOwnerClassMutations.delete(node);
    return true;
}

/** 同父级、同原文的替换属于框架重挂，不改变 AI 页面上下文。 */
export function isTextEquivalentHostReplacement(mutation: MutationRecord): boolean {
    if (mutation.type !== 'childList' || mutation.addedNodes.length === 0 || mutation.removedNodes.length === 0) {
        return false;
    }
    const changedNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
    const isTranslationRemount = changedNodes.some((node) =>
        getTranslationOwnersForRemovedNode(node).length > 0 ||
        queryElements(node, '[data-fr-translation-owned="true"]').length > 0);
    if (!isTranslationRemount) return false;
    const text = (nodes: NodeList) => Array.from(nodes)
        .map(normalizedNodeText)
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
    const addedText = text(mutation.addedNodes);
    return addedText.length > 0 && addedText === text(mutation.removedNodes);
}

/** 在候选发现前清理 dirty root 中的双语、加载与失败孤儿。 */
export function normalizeOrphanedTranslationArtifacts(root: Node): void {
    const owners = new Set<HTMLElement>();
    queryElements(root, REMOVABLE_ORPHAN_ARTIFACT_SELECTOR).forEach((artifact) => {
        const owner = asHTMLElement(artifact.parentElement);
        if (owner) owners.add(owner);
    });
    owners.forEach(normalizeOrphanedTranslationOwner);
}

/**
 * single-slot 的 light DOM 保存宿主原 Text；cloneNode 不复制 closed ShadowRoot。
 * 无状态克隆必须先解包再发现/恢复，否则通用孤儿删除会连原文一起删除。
 */
export function normalizeOrphanedSingleSlots(root: Node): void {
    queryElements(root, OWNED_SINGLE_SLOT_SELECTOR).forEach((slot) => {
        if (getTranslationOwnersForRemovedNode(slot).length > 0 || !slot.parentNode) return;
        const parent = slot.parentNode;
        while (slot.firstChild) parent.insertBefore(slot.firstChild, slot);
        parent.removeChild(slot);
    });
}
