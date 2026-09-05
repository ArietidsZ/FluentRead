/**
 * @file src/core/translation/adapters/ubuntu.ts
 *
 * 文件职责：保留 Ubuntu HTML 手册中的命令语法、命令名称和字面参数，允许解释正文继续翻译。
 * 主要内容：导出 ubuntuManpageAdapter，以手册 URL 和 mandoc 的段落、缩进与字体标记划分文本边界，不依赖命令关键词表。
 * 模块边界：只声明站点 DOM 语义规则；不发送请求、不渲染译文、不改变宿主节点或通用 PRE 保护策略。
 */

import {safeClosest} from '../dom';
import type {TranslationSiteAdapter} from '../types';
import {createDeclarativeAdapter} from './declarative';

const commandRegions = [
    '#main-content h1',
    '#manpage-content > #synopsis + section.Sh',
] as const;

/** 缩进块之前也可能是完整说明段；只保护以字面命令开头且余文仅为括号附注的标签。 */
function isCommandLabel(element: Element): boolean {
    const label = safeClosest(element, '#manpage-content > #description + section.Sh > p.Pp:has(+ .Bd-indent)');
    if (!label) return false;
    const clone = label.cloneNode(true) as Element;
    clone.querySelectorAll('[data-fr-translation-owned="true"]').forEach((node) => node.remove());
    const first = [...clone.childNodes].find((node) =>
        (node.nodeType === 1 || node.nodeType === 3) && Boolean(node.textContent!.trim()));
    if (!first || first.nodeType !== 1) return false;
    if (!(first as Element).matches('b, i')) return false;
    // 保留链接中的普通文字；只移除 mandoc 字面字体，避免把链接说明误判为命令元数据。
    clone.querySelectorAll('b, i').forEach((node) => node.remove());
    let depth = 0;
    for (const character of clone.textContent!) {
        if (character === '(') depth += 1;
        else if (character === ')') {
            if (depth === 0) return false;
            depth -= 1;
        } else if (depth === 0 && /[\p{L}\p{N}]/u.test(character)) return false;
    }
    return depth === 0;
}

/** mandoc 的粗体表示命令/字面量，斜体表示参数；正文中的这些片段保留在译文中。 */
const literalMarkup = [
    '#manpage-content section.Sh b',
    '#manpage-content section.Sh i',
] as const;

const baseAdapter = createDeclarativeAdapter({
    id: 'ubuntu-manpage',
    priority: 360,
    hosts: [{hostname: 'manpages.ubuntu.com', includeSubdomains: false}],
    pathnames: [/^\/manpages\/[^/]+\/(?:[a-z]{2}(?:_[A-Z]{2})?\/)?man[0-9][^/]*\/[^/]+\.html$/u],
    prune: [{selector: commandRegions, reason: 'ubuntu-manpage-command'}],
    keepOriginal: [{selector: [...commandRegions, ...literalMarkup], reason: 'ubuntu-manpage-literal'}],
    omitFromTranslation: [{selector: commandRegions, reason: 'ubuntu-manpage-command'}],
    mutationExclude: [{selector: commandRegions, reason: 'ubuntu-manpage-command'}],
});

export const ubuntuManpageAdapter: TranslationSiteAdapter = {
    ...baseAdapter,
    decide(element, context) {
        return isCommandLabel(element)
            ? {kind: 'prune-subtree', reason: 'ubuntu-manpage-command'}
            : baseAdapter.decide(element, context);
    },
    shouldStayOriginal(element, context) {
        return isCommandLabel(element) || baseAdapter.shouldStayOriginal!(element, context);
    },
    shouldOmitFromTranslation(element, context) {
        return isCommandLabel(element) || baseAdapter.shouldOmitFromTranslation!(element, context);
    },
    shouldIgnoreMutation(element, context) {
        return isCommandLabel(element) || baseAdapter.shouldIgnoreMutation!(element, context);
    },
};
