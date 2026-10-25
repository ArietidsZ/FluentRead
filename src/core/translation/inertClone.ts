/**
 * @file src/core/translation/inertClone.ts
 *
 * 文件职责：在没有浏览上下文的文档中复制翻译来源元素，避免为了读取骨架而在实时文档中深拷贝资源节点。
 * 主要内容：按来源 ownerDocument 弱缓存浅复制的文档壳，通过 importNode 保留元素命名空间、原始属性和指定深度的子节点；
 * HTML 文档壳单独保存 base，并在每次复制前同步当前来源 baseURI；来源已无窗口时只同步显式 base 属性，不依赖失效的浏览上下文。XML 文档壳只复制节点，不伪造 HTML base 语义。
 * 模块边界：只创建脱离页面的本地副本，不挂载来源或返回元素、不净化内容、不访问配置或网络，也不缓存宿主元素。
 */

interface InertCloneDocument {
    document: Document;
    base: Element | null;
}

const documents = new WeakMap<Document, InertCloneDocument>();

/** 默认返回独立深副本；相对地址属性保持原文，XML 来源不承诺继承 baseURI 的解析结果。 */
export function cloneTranslationElementInert<T extends Element>(source: T, deep = true): T {
    const owner = source.ownerDocument;
    let context = documents.get(owner);
    if (!context) {
        // 只浅复制 Document，不经过实时文档中任何 IMG、媒体或其它来源子树。
        const document = owner.cloneNode(false) as Document;
        const html = document.createElement('html');
        let base: Element | null = null;
        if (html.namespaceURI === 'http://www.w3.org/1999/xhtml') {
            const head = document.createElement('head');
            base = document.createElement('base');
            head.appendChild(base);
            html.appendChild(head);
            document.appendChild(html);
        }
        context = {document, base};
        documents.set(owner, context);
        // 已惰性的副本再次取快照时继续复用，不形成一串中间文档。
        documents.set(document, context);
    }
    if (context.base) {
        const baseURI = owner.defaultView ? source.baseURI : owner.querySelector('base[href]')?.getAttribute('href');
        if (typeof baseURI === 'string') context.base.setAttribute('href', baseURI);
        else context.base.removeAttribute('href');
    }
    return context.document.importNode(source, deep);
}
