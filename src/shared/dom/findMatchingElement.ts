/**
 * @file src/shared/dom/findMatchingElement.ts
 *
 * 文件职责：提供从给定元素向 composed tree 祖先查找 selector 匹配项的小型 DOM 工具，兼容 Shadow DOM 宿主边界。
 * 主要内容：findMatchingElement 先检查元素自身，再沿 parentElement 或 shadow host 上溯，找到即返回 Element，否则以 false 明确表示未匹配。 可核对的公开符号包括 findMatchingElement。
 * 模块边界：本文件属于 shared 小型公共层，仅提供无状态或低语义耦合的类型与工具；不读取 FluentRead 配置、不调用 provider、不注册入口或持有 feature 生命周期，使用者需自行处理业务政策。
 */

/** 从当前元素向上查找第一个匹配 selector 的元素。 */
export function findMatchingElement(element: Element, selector: string): Element | false {
    let current: Element | null = element;
    while (current) {
        if (current.matches(selector)) return current;
        current = current.parentElement;
    }
    return false;
}
