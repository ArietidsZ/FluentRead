/**
 * @file src/features/area-translation/content/areaHotkey.ts
 * 文件职责：在不创建圈选 UI 的情况下判断可信快捷键是否应启动圈选翻译。
 * 主要内容：复用配置中的快捷键匹配，并排除重复、输入框、可编辑区域及无法穿透的焦点宿主。
 * 模块边界：本模块只读键盘事件和焦点，不挂载 Shadow DOM、不截屏；具体选区状态由 AreaTranslator.vue 管理。
 */
import {matchesAreaTranslationHotkey} from '@/src/core/config/areaTranslation';

interface AreaHotkeyConfig {
    on?: boolean;
    selectionAreaEnabled: boolean;
    selectionAreaHotkey: string;
    customSelectionAreaHotkey: string;
}

const NATIVE_FOCUSABLE_TAGS = ['A', 'AREA', 'AUDIO', 'BUTTON', 'DETAILS', 'EMBED', 'IFRAME', 'LABEL', 'OBJECT', 'SUMMARY', 'VIDEO'];
const TYPING_ROLES = ['textbox', 'searchbox', 'combobox', 'spinbutton'];

function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(target.tagName) || target.isContentEditable) return true;
    if (target.closest('[contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable=""]')) return true;
    const role = target.getAttribute('role');
    return typeof role === 'string' && TYPING_ROLES.includes(role.toLowerCase());
}

function deepActiveElement(document: Document): Element | null {
    let focused = document.activeElement;
    while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
    return focused;
}

/** 封闭 Shadow Root 无法读取内部输入焦点时保守跳过；普通可聚焦控件仍允许快捷键。 */
function isOpaqueFocusHost(element: Element): boolean {
    if (['BODY', 'HTML'].includes(element.tagName)) return false;
    if (element.tagName.includes('-')) return true;
    if (element.hasAttribute('tabindex')) return false;
    return !NATIVE_FOCUSABLE_TAGS.includes(element.tagName);
}

export function shouldStartAreaTranslationFromHotkey(
    event: KeyboardEvent,
    config: AreaHotkeyConfig,
    document: Document,
): boolean {
    if (!event.isTrusted || event.repeat || event.isComposing || config.on === false || config.selectionAreaEnabled !== true) return false;
    if (!matchesAreaTranslationHotkey(event, config.selectionAreaHotkey, config.customSelectionAreaHotkey)) return false;
    const host = document.getElementById('fluent-read-area-translator-container');
    if (host && event.target instanceof Node && host.contains(event.target)) return false;
    if (event.composedPath().some(isTypingTarget)) return false;
    const focused = deepActiveElement(document);
    return !focused || (!isTypingTarget(focused) && !isOpaqueFocusHost(focused));
}
