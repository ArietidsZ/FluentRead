/**
 * @file src/features/full-page-translation/content/renderer.ts
 * 文件职责：把翻译返回的受限 HTML 或纯文本安全插入原页面，构造 FluentRead 双语与仅译文节点，同时保护链接属性并触发布局截断修复。
 * 主要内容：包含 URL 协议白名单、可复制属性集合、递归节点净化、DocumentFragment 创建、不改写宿主 class 的双语 wrapper，以及通过 Shadow DOM 保留宿主原文的仅译文文本槽。
 * 模块边界：本文件只负责安全渲染，不发起翻译或管理请求状态；服务调用归 runtime，节点所有权归 state，配置仅用于展示选项，任意脚本、事件属性和危险链接都不得穿过净化边界。
 */
import { options } from "@/src/core/config/catalog";
import { config } from "@/src/services/config/store";
import {ensureTranslationTruncationLayout} from "@/src/features/full-page-translation/content/layout";

/**
 * 译文允许保留的内联元素。
 * 翻译服务返回的结构不是可信 HTML，因此不直接把响应写入 innerHTML。
 */
const allowedTags = new Set([
    "a", "abbr", "b", "bdi", "bdo", "br", "cite", "em", "font",
    "code", "i", "kbd", "mark", "q", "ruby", "samp", "small", "span",
    "strong", "sub", "sup", "time", "u", "var", "wbr",
]);

const blockedTags = new Set([
    "iframe", "object", "script", "style", "template", "xmp",
]);

function isSafeHref(value: string): boolean {
    try {
        const url = new URL(value, document.baseURI);
        return ["http:", "https:", "mailto:"].includes(url.protocol);
    } catch {
        return false;
    }
}

function copySafeAttributes(source: Element, target: HTMLElement): void {
    if (source.tagName.toLowerCase() === "a") {
        const href = source.getAttribute("href");
        if (href && isSafeHref(href)) target.setAttribute("href", href);

        const title = source.getAttribute("title");
        if (title) target.setAttribute("title", title);
    }
}

function sanitizeNode(node: Node): Node[] {
    if (node.nodeType === Node.TEXT_NODE) {
        return [document.createTextNode(node.nodeValue ?? "")];
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return [];

    const source = node as Element;
    const tag = source.tagName.toLowerCase();
    if (blockedTags.has(tag)) return [];

    const children = Array.from(source.childNodes).flatMap(sanitizeNode);

    // 不在白名单中的结构只展开其安全文本/内联子节点，避免丢失译文内容。
    if (!allowedTags.has(tag)) return children;

    const target = document.createElement(tag);
    copySafeAttributes(source, target);
    children.forEach((child) => target.appendChild(child));
    return [target];
}

/**
 * 将服务响应解析为安全的 DocumentFragment。
 * DOMParser 使用独立文档解析，随后只迁移白名单节点和安全属性。
 */
function createSafeTranslationFragment(text: string): DocumentFragment {
    const parsed = new DOMParser().parseFromString(text || "", "text/html");
    const fragment = document.createDocumentFragment();
    Array.from(parsed.body.childNodes)
        .flatMap(sanitizeNode)
        .forEach((node) => fragment.appendChild(node));
    return fragment;
}

/**
 * 双语模式：译文仍放在目标段落内部，以保持现有 DOM 断言和页面布局习惯；
 * 但具体节点由状态机保存，恢复时只移除这一份 wrapper。
 */
export interface BilingualTranslationRenderOptions {
    /** 全文会话启动时冻结的目标语言；普通悬浮翻译缺省仍读取当前配置。 */
    targetLanguage?: string;
    /** 全文会话启动时冻结的译文样式。 */
    style?: number;
}

export interface SingleTranslationSlot {
    node: Text;
    text: string;
}

/**
 * 仅译文模式不再改写宿主 Text.nodeValue。React、GitHub relative-time
 * 等动态组件会把被改写的文本立即校正回原文，与 MutationObserver
 * 重译形成无限往返。这里把原 Text 移入轻 DOM，但只渲染闭合
 * ShadowRoot 中的译文：宿主仍能读到原 textContent 和原节点身份，
 * 用户看到的则是可选中、可复制且继承页面样式的译文。
 */
export function appendSingleTranslationSlots(
    owner: HTMLElement,
    slots: readonly SingleTranslationSlot[],
    renderOptions: BilingualTranslationRenderOptions = {},
): HTMLElement[] {
    if (slots.some(({node}) => !node.parentNode || !owner.contains(node))) return [];
    const hosts: HTMLElement[] = [];
    for (const slot of slots) {
        const parent = slot.node.parentNode!;

        const host = owner.ownerDocument.createElement("span");
        host.classList.add("fluent-read-single-slot");
        host.setAttribute("data-fr-translation-owned", "true");
        host.setAttribute("translate", "no");
        host.setAttribute("aria-label", slot.text);
        host.lang = (renderOptions.targetLanguage ?? config.to) || "";
        host.dir = "auto";

        const shadow = host.attachShadow({mode: "closed"});
        const translated = owner.ownerDocument.createElement("span");
        translated.setAttribute("data-fr-translation-owned", "true");
        translated.setAttribute("translate", "no");
        translated.lang = host.lang;
        translated.dir = "auto";
        translated.textContent = slot.text;
        shadow.appendChild(translated);

        parent.insertBefore(host, slot.node);
        host.appendChild(slot.node);
        hosts.push(host);
    }
    return hosts;
}

function createBilingualTranslationContent(
    node: HTMLElement,
    text: string,
    renderOptions: BilingualTranslationRenderOptions = {},
): HTMLElement {
    const content = node.ownerDocument.createElement("span");
    content.classList.add("fluent-read-bilingual-content");
    content.setAttribute("data-fr-translation-owned", "true");
    content.setAttribute("translate", "no");
    content.lang = (renderOptions.targetLanguage ?? config.to) || "";
    content.dir = "auto";

    const styleValue = renderOptions.style ?? config.style;
    const style = options.styles.find((item) => item.value === styleValue && !item.disabled);
    if (style?.class) content.classList.add(style.class);

    // 译文可能来自机器翻译的 HTML 或大模型的富文本响应。统一经过
    // DOMParser + 白名单迁移，既保留链接/强调等行内结构，也不把服务响应
    // 当作可信 HTML 直接写回网页。
    const fragment = createSafeTranslationFragment(text);
    content.appendChild(fragment);
    return content;
}

export function appendBilingualTranslation(
    node: HTMLElement,
    text: string,
    renderOptions: BilingualTranslationRenderOptions = {},
): HTMLElement {
    const content = createBilingualTranslationContent(node, text, renderOptions);
    // clone/remount 可能复制轻 DOM wrapper 却丢失 WeakMap；只替换直属工件。
    Array.from(node.children)
        .filter((child) => child.matches(
            '.fluent-read-bilingual-content[data-fr-translation-owned="true"]',
        ))
        .forEach((child) => child.remove());
    ensureTranslationTruncationLayout(node);
    node.appendChild(content);
    return content;
}

/** 来源骨架变化但 provider 槽未变时，就地更新 wrapper，避免原文帧和重复请求。 */
export function refreshBilingualTranslation(
    node: HTMLElement,
    content: HTMLElement,
    text: string,
    renderOptions: BilingualTranslationRenderOptions = {},
): HTMLElement {
    const replacement = createBilingualTranslationContent(node, text, renderOptions);
    Array.from(content.attributes).forEach(({name}) => content.removeAttribute(name));
    Array.from(replacement.attributes).forEach(({name, value}) => content.setAttribute(name, value));
    content.replaceChildren(...Array.from(replacement.childNodes));
    ensureTranslationTruncationLayout(node);
    return content;
}
