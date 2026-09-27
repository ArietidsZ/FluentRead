/**
 * @file src/features/section-translation/content/picker.ts
 * 文件职责：实现局部翻译的区域选择模式，像开发者工具的元素选择器一样高亮鼠标下的内容块，让用户点击确认要翻译或恢复的区域，并在选择期间拦截网页自身的点击与悬停反应。
 * 主要内容：在封闭 Shadow Root 中创建高亮框、结果标签与提示条；按帧合并指针与滚动更新，方向键扩大或缩小范围并在鼠标仍位于扩大范围内时保持选择；延迟盘点区域状态并缓存结果；点击或 Enter 确认、Esc/右键/关闭按钮/页面隐藏退出；确认后短暂收束动画再移除界面。
 * 模块边界：本模块只处理手势、高亮和选择生命周期，所有事件先校验 isTrusted；区域判定规则来自 ../core，区域盘点、翻译和提示文案由调用方注入，不直接发起翻译、不读取配置存储。
 */
import pickerStyles from './picker.css?inline';
import {
    describeSectionElement,
    expandSectionElement,
    isSectionPickerUi,
    resolveSectionElement,
    resolveSectionLabel,
    type SectionGeometry,
    type SectionLabelSummary,
    type SectionRect,
} from '../core';

export interface SectionPickerPoint {
    readonly x: number;
    readonly y: number;
}

export interface SectionPickerOptions {
    /** 进入选择模式时已知的指针位置；快捷键进入时可立即高亮鼠标下的区域。 */
    initialPoint?: SectionPickerPoint | null;
    /** 盘点区域状态，决定标签显示翻译、恢复原文还是无可翻译内容。 */
    inspect(element: Element): SectionLabelSummary;
    /** 用户确认区域后调用；此时选择模式已经退出，网页恢复正常交互。 */
    onPick(element: Element): void;
    /** 界面文案解析，按当前界面语言返回文字。 */
    text(key: string, params?: Readonly<Record<string, string | number>>): string;
    /** 选择期间再次按下进入快捷键即退出。 */
    isExitHotkey?(event: KeyboardEvent): boolean;
    /** 焦点在输入场景时方向键与 Enter 留给网页。 */
    isEditing?(event: KeyboardEvent): boolean;
}

export const SECTION_PICKER_HOST_ATTRIBUTE = 'section-picker';
const INSPECT_DELAY_MS = 90;
const CONFIRM_ANIMATION_MS = 320;
const TOPMOST_NOTICE_MS = 1200;
const LABEL_GAP = 6;
/** 高亮框向外留出的距离，避免边框压在区域边缘的文字上。 */
const BOX_OUTSET = 3;
const VIEWPORT_MARGIN = 4;
const MAX_SHADOW_DEPTH = 16;

/** 选择期间这些指针事件不交给网页，避免链接跳转、按钮触发、拖拽或划词浮层。 */
const INTERCEPTED_MOUSE_EVENTS = ['mousedown', 'mouseup', 'click', 'dblclick', 'auxclick'] as const;
/** pointerdown 只停止传播、不取消默认行为，让触屏仍能滚动页面。 */
const INTERCEPTED_POINTER_EVENTS = ['pointerdown', 'pointerup'] as const;
/** 悬停卡片、下拉菜单等网页悬停反应会遮挡目标区域，选择期间一并屏蔽。 */
const SUPPRESSED_HOVER_EVENTS = ['pointerover', 'mouseover'] as const;

const geometry: SectionGeometry = {
    display(element) {
        try {
            return element.ownerDocument.defaultView!.getComputedStyle(element).display;
        } catch {
            // 取不到计算样式（例如元素所在文档没有视图）时按块级处理，不因此丢失可选区域。
            return '';
        }
    },
    rect: (element) => element.getBoundingClientRect(),
};

interface PickerSession {
    dispose(confirmed: boolean): void;
}

let activeSession: PickerSession | null = null;

export function isSectionPickerActive(): boolean {
    return activeSession !== null;
}

/** 退出选择模式且不做任何翻译；未处于选择模式时无副作用。 */
export function stopSectionPicker(): void {
    activeSession?.dispose(false);
}

/** 进入选择模式；已在选择中时保持原状态并返回 true。 */
export function startSectionPicker(options: SectionPickerOptions): boolean {
    if (activeSession) return true;
    if (!document.documentElement) return false;
    activeSession = createPickerSession(options);
    return true;
}

function applyHostStyles(host: HTMLElement): void {
    // 宿主页样式不能把浮层放回文档流、截断或让它接收指针；外观细节留在 Shadow Root。
    const importantStyles: Record<string, string> = {
        display: 'block',
        position: 'fixed',
        top: '0',
        left: '0',
        width: '0',
        height: '0',
        margin: '0',
        padding: '0',
        border: '0',
        overflow: 'visible',
        opacity: '1',
        visibility: 'visible',
        transform: 'none',
        'pointer-events': 'none',
        'z-index': '2147483647',
    };
    Object.entries(importantStyles).forEach(([property, value]) => host.style.setProperty(property, value, 'important'));
}

function createElement(tag: string, className: string, text?: string): HTMLElement {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function containsPoint(rect: SectionRect, point: SectionPickerPoint): boolean {
    return point.x >= rect.left && point.x <= rect.left + rect.width
        && point.y >= rect.top && point.y <= rect.top + rect.height;
}

const scheduleFrame = (callback: () => void): number => typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame(callback)
    : window.setTimeout(callback, 16);

const cancelFrame = (handle: number): void => {
    if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(handle);
    else window.clearTimeout(handle);
};

function createPickerSession(options: SectionPickerOptions): PickerSession {
    const controller = new AbortController();
    const {signal} = controller;

    // Step 1: 创建封闭 Shadow Root 浮层；网页脚本无法读取或改写其中的界面。
    const host = document.createElement('fluent-read-section-picker');
    host.setAttribute('data-fluent-read-ui', SECTION_PICKER_HOST_ATTRIBUTE);
    host.setAttribute('translate', 'no');
    applyHostStyles(host);
    const shadow = host.attachShadow({mode: 'closed'});
    const style = document.createElement('style');
    style.textContent = pickerStyles;
    const box = createElement('div', 'fr-section-box');
    const label = createElement('div', 'fr-section-label');
    label.setAttribute('aria-hidden', 'true');
    const labelAction = createElement('span', 'fr-section-label-action');
    const labelMeta = createElement('span', 'fr-section-label-meta');
    label.append(labelAction, labelMeta);
    const bar = createElement('div', 'fr-section-bar');
    bar.setAttribute('role', 'status');
    const close = createElement('button', 'fr-section-bar-close', '×') as HTMLButtonElement;
    close.type = 'button';
    close.setAttribute('aria-label', options.text('sectionTranslation.picker.close'));
    close.title = options.text('sectionTranslation.picker.close');
    bar.append(
        createElement('strong', 'fr-section-bar-title', options.text('sectionTranslation.picker.title')),
        createElement('span', 'fr-section-bar-instruction', options.text('sectionTranslation.picker.instruction')),
        createElement('span', 'fr-section-bar-keys', options.text('sectionTranslation.picker.keys')),
        close,
    );
    shadow.append(style, box, label, bar);
    document.documentElement.appendChild(host);

    let pointer: SectionPickerPoint | null = options.initialPoint ?? null;
    let target: Element | null = null;
    /** 当前范围链：首项是鼠标下的基础区域，之后每项是一次方向键扩大的结果。 */
    let expansion: Element[] = [];
    let targetChanged = false;
    let targetDirty = pointer !== null;
    /** 滚动或缩放触发的绘制要立即贴合内容，不能沿用换选区域时的过渡动画。 */
    let snapNextRender = false;
    let frame = 0;
    let rendering = false;
    let inspectTimer: ReturnType<typeof setTimeout> | undefined;
    let topmostTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const summaries = new WeakMap<Element, SectionLabelSummary>();

    /** 事件落在本浮层或 FluentRead 其他界面（通知、悬浮球等）上时交还给它们自己处理。 */
    const isExtensionUiEvent = (event: Event): boolean => typeof event.composedPath === 'function'
        && event.composedPath().some((node) => node === host
            || ((node as Node).nodeType === 1 && isSectionPickerUi(node as Element)));

    function consume(event: Event, preventDefault = true): void {
        if (preventDefault) event.preventDefault();
        event.stopImmediatePropagation();
    }

    /** 逐层进入可读取的 ShadowRoot，找到指针下最深的网页元素。 */
    function elementAtPoint(point: SectionPickerPoint): Element | null {
        let element = document.elementFromPoint(point.x, point.y);
        for (let depth = 0; element?.shadowRoot && depth < MAX_SHADOW_DEPTH; depth += 1) {
            const inner: Element | null = element.shadowRoot.elementFromPoint(point.x, point.y);
            if (!inner || inner === element) break;
            element = inner;
        }
        return element;
    }

    function setTone(tone: 'translate' | 'restore' | 'muted'): void {
        for (const element of [box, label]) {
            element.classList.toggle('tone-restore', tone === 'restore');
            element.classList.toggle('tone-muted', tone === 'muted');
        }
    }

    function updateLabel(): void {
        if (!target) return;
        const summary = summaries.get(target);
        labelMeta.textContent = describeSectionElement(target);
        if (!summary) {
            labelAction.textContent = options.text('sectionTranslation.label.inspecting');
            return;
        }
        const resolved = resolveSectionLabel(summary);
        labelAction.textContent = options.text(resolved.key, resolved.params);
        setTone(resolved.tone);
    }

    function scheduleInspect(): void {
        if (inspectTimer !== undefined) clearTimeout(inspectTimer);
        inspectTimer = undefined;
        const current = target;
        if (!current) return;
        updateLabel();
        if (summaries.has(current)) return;
        // 快速划过时只盘点停下来的区域，避免每经过一个元素就遍历一次子树。
        inspectTimer = setTimeout(() => {
            inspectTimer = undefined;
            if (disposed || target !== current || !current.isConnected) return;
            summaries.set(current, options.inspect(current));
            // “已是最大范围”提示仍在显示时先保留提示，计时结束后再显示盘点结果。
            if (topmostTimer === undefined) updateLabel();
            scheduleRender();
        }, INSPECT_DELAY_MS);
    }

    function setTarget(next: Element | null): void {
        if (next === target) return;
        target = next;
        targetChanged = true;
        if (topmostTimer !== undefined) clearTimeout(topmostTimer);
        topmostTimer = undefined;
        scheduleInspect();
        scheduleRender();
    }

    function refreshTarget(): void {
        targetDirty = false;
        if (!pointer) return;
        const hit = elementAtPoint(pointer);
        // 指针停在提示条上时保持当前区域，方便点击关闭按钮。
        if (hit === host) return;
        const expanded = expansion.length > 1 ? expansion[expansion.length - 1] : null;
        if (expanded?.isConnected && containsPoint(geometry.rect(expanded), pointer)) return;
        const base = resolveSectionElement(hit, geometry);
        expansion = base ? [base] : [];
        setTarget(base);
    }

    function positionLabel(rect: SectionRect): void {
        label.classList.add('is-visible');
        const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
        const labelWidth = label.offsetWidth || 0;
        const labelHeight = label.offsetHeight || 0;
        const above = rect.top - BOX_OUTSET - labelHeight - LABEL_GAP;
        const top = above >= VIEWPORT_MARGIN
            ? above
            : Math.min(Math.max(rect.top + LABEL_GAP, VIEWPORT_MARGIN), window.innerHeight - labelHeight - VIEWPORT_MARGIN);
        const left = Math.min(Math.max(rect.left, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, viewportWidth - labelWidth - VIEWPORT_MARGIN));
        label.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    }

    function render(): void {
        frame = 0;
        if (disposed) return;
        rendering = true;
        try {
            draw();
        } finally {
            rendering = false;
        }
    }

    function draw(): void {
        if (target && !target.isConnected) {
            // 网页替换了内容（如单页应用切换路由）：丢弃失效区域，按当前指针重新选择。
            target = null;
            expansion = [];
            targetDirty = true;
        }
        if (targetDirty) refreshTarget();
        if (!target) {
            box.classList.remove('is-visible');
            label.classList.remove('is-visible');
            return;
        }
        const rect = geometry.rect(target);
        // 换选区域时平滑过渡；过渡类保留到下一次滚动/缩放，避免紧随其后的重绘把进行中的过渡打断。
        if (targetChanged || snapNextRender) {
            box.classList.toggle('is-following', targetChanged && !snapNextRender && box.classList.contains('is-visible'));
        }
        targetChanged = false;
        snapNextRender = false;
        box.style.transform = `translate(${Math.round(rect.left - BOX_OUTSET)}px, ${Math.round(rect.top - BOX_OUTSET)}px)`;
        box.style.width = `${Math.round(rect.width + BOX_OUTSET * 2)}px`;
        box.style.height = `${Math.round(rect.height + BOX_OUTSET * 2)}px`;
        box.classList.add('is-visible');
        positionLabel(rect);
    }

    function scheduleRender(): void {
        // 绘制过程中切换区域会就地完成本帧，不再额外排队一帧。
        if (disposed || frame || rendering) return;
        frame = scheduleFrame(render);
    }

    function showTopmostNotice(): void {
        labelAction.textContent = options.text('sectionTranslation.label.topmost');
        scheduleRender();
        if (topmostTimer !== undefined) clearTimeout(topmostTimer);
        topmostTimer = setTimeout(() => {
            topmostTimer = undefined;
            updateLabel();
            scheduleRender();
        }, TOPMOST_NOTICE_MS);
    }

    function expand(): void {
        if (!target) return;
        const next = expandSectionElement(target, geometry);
        if (!next) {
            showTopmostNotice();
            return;
        }
        expansion.push(next);
        setTarget(next);
    }

    function shrink(): void {
        if (expansion.length <= 1) return;
        expansion.pop();
        setTarget(expansion[expansion.length - 1]!);
    }

    function pick(element: Element): void {
        dispose(true);
        options.onPick(element);
    }

    function dispose(confirmed: boolean): void {
        if (disposed) return;
        disposed = true;
        if (activeSession === session) activeSession = null;
        controller.abort();
        if (frame) cancelFrame(frame);
        if (inspectTimer !== undefined) clearTimeout(inspectTimer);
        if (topmostTimer !== undefined) clearTimeout(topmostTimer);
        if (!confirmed || !box.classList.contains('is-visible')) {
            host.remove();
            return;
        }
        // 确认后保留高亮框做一次短暂收束，让用户看清选中的范围；此时已不再拦截网页事件。
        bar.classList.add('is-hidden');
        label.classList.remove('is-visible');
        box.classList.remove('is-following');
        box.classList.add('is-confirmed');
        setTimeout(() => host.remove(), CONFIRM_ANIMATION_MS);
    }

    // Step 2: 在 window 捕获阶段接管指针、键盘和视口事件；所有监听随 signal 一次移除。
    const listen = <K extends keyof WindowEventMap>(
        type: K,
        listener: (event: WindowEventMap[K]) => void,
        passive = false,
    ): void => window.addEventListener(type, listener, {capture: true, passive, signal});

    listen('pointermove', (event) => {
        if (!event.isTrusted) return;
        pointer = {x: event.clientX, y: event.clientY};
        targetDirty = true;
        scheduleRender();
    }, true);
    for (const type of INTERCEPTED_POINTER_EVENTS) {
        listen(type, (event) => {
            if (!event.isTrusted) return;
            if (!isExtensionUiEvent(event)) consume(event, false);
        });
    }
    for (const type of INTERCEPTED_MOUSE_EVENTS) {
        listen(type, (event) => {
            if (!event.isTrusted) return;
            if (isExtensionUiEvent(event)) return;
            consume(event);
            if (event.type !== 'click' || event.button !== 0) return;
            // 触屏没有悬停阶段：按落点即时解析区域后再确认。
            pointer = {x: event.clientX, y: event.clientY};
            refreshTarget();
            if (target) pick(target);
        });
    }
    for (const type of SUPPRESSED_HOVER_EVENTS) {
        listen(type, (event) => {
            if (!event.isTrusted) return;
            if (!isExtensionUiEvent(event)) event.stopImmediatePropagation();
        });
    }
    listen('contextmenu', (event) => {
        if (!event.isTrusted) return;
        if (isExtensionUiEvent(event)) return;
        consume(event);
        dispose(false);
    });
    listen('keydown', (event) => {
        if (!event.isTrusted) return;
        if (event.key === 'Escape' || options.isExitHotkey?.(event) === true) {
            consume(event);
            dispose(false);
            return;
        }
        // 焦点在关闭按钮或输入框上时，Enter 与方向键保持它们原本的作用。
        if (isExtensionUiEvent(event) || options.isEditing?.(event) === true) return;
        if (event.key === 'ArrowUp') {
            consume(event);
            expand();
        } else if (event.key === 'ArrowDown') {
            consume(event);
            shrink();
        } else if (event.key === 'Enter' && target) {
            consume(event);
            pick(target);
        }
    });
    const handleViewportChange = (event: Event): void => {
        if (!event.isTrusted) return;
        targetDirty = true;
        snapNextRender = true;
        scheduleRender();
    };
    listen('scroll', handleViewportChange, true);
    listen('resize', handleViewportChange, true);
    document.addEventListener('visibilitychange', (event) => {
        if (!event.isTrusted) return;
        if (document.visibilityState === 'hidden') dispose(false);
    }, {signal});
    close.addEventListener('click', (event) => {
        if (!event.isTrusted) return;
        consume(event);
        dispose(false);
    }, {signal});

    const session: PickerSession = {dispose};
    scheduleRender();
    return session;
}
