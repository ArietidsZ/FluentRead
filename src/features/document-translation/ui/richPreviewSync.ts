/**
 * @file src/features/document-translation/ui/richPreviewSync.ts
 * 文件职责：让 HTML、Markdown、纯文本与 ePub 章节的隔离预览在译文逐段到达时原位更新，而不是重新载入整页并丢失滚动位置。
 * 主要内容：把新生成的预览 HTML 解析成文档后，与预览框里现有的正文逐节点比对，只改写发生变化的文字、属性和子树；提供按文档规模放慢的节流间隔，避免长文档每到一段译文就整篇比对。
 * 模块边界：只做 DOM 同步，不生成预览 HTML、不发起翻译、不决定何时刷新；预览框不允许执行脚本，无法访问其文档时返回 false，由页面退回整页载入。
 */

interface PreviewFrame {contentDocument?: Document | null}
type PreviewParser = (html: string) => Document | null;

function sameKind(current: Node, next: Node): boolean {
    return current.nodeType === next.nodeType && current.nodeName === next.nodeName;
}

function syncAttributes(current: Element, next: Element): void {
    for (const name of current.getAttributeNames()) if (!next.hasAttribute(name)) current.removeAttribute(name);
    for (const name of next.getAttributeNames()) {
        const value = next.getAttribute(name)!;
        if (current.getAttribute(name) !== value) current.setAttribute(name, value);
    }
}

/** 按位置逐个比对子节点：同类节点就地更新，不同类的整棵替换，多出来的删除。 */
export function syncPreviewChildren(current: Node, next: Node): void {
    const owner = current.ownerDocument!;
    const nextChildren = Array.from(next.childNodes);
    nextChildren.forEach((nextChild, index) => {
        const currentChild = current.childNodes[index];
        if (!currentChild) {current.appendChild(owner.importNode(nextChild, true)); return;}
        if (!sameKind(currentChild, nextChild)) {current.replaceChild(owner.importNode(nextChild, true), currentChild); return;}
        if (currentChild.nodeType === 1) {
            syncAttributes(currentChild as Element, nextChild as Element);
            syncPreviewChildren(currentChild, nextChild);
        } else if (currentChild.nodeValue !== nextChild.nodeValue) currentChild.nodeValue = nextChild.nodeValue;
    });
    while (current.childNodes.length > nextChildren.length) current.removeChild(current.lastChild!);
}

const browserParser: PreviewParser = html => typeof DOMParser === 'undefined' ? null : new DOMParser().parseFromString(html, 'text/html');

/**
 * 把预览框的正文同步为给定 HTML 的正文。预览框尚未载入、不可访问或无法解析时返回 false。
 */
export function syncRichPreview(frame: PreviewFrame | null | undefined, html: string, parse: PreviewParser = browserParser): boolean {
    const body = frame?.contentDocument?.body;
    const next = body ? parse(html)?.body : null;
    if (!body || !next) return false;
    syncAttributes(body, next);
    syncPreviewChildren(body, next);
    return true;
}

/** 翻译进行中的刷新间隔：短文档四分之一秒一次，片段越多越慢，最长两秒。 */
export function richPreviewInterval(segmentCount: number): number {
    return Math.min(2000, Math.max(250, Math.round(segmentCount / 8)));
}
