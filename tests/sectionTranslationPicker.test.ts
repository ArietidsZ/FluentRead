import {parseHTML} from 'linkedom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {SectionLabelSummary} from '@/src/features/section-translation/core';

type Listener = {type: string; listener: (event: any) => void; signal?: AbortSignal};

const PAGE = `<html><body>
<article id="readme"><p id="para">Hello <b id="bold">world</b></p><p id="second">Second paragraph</p></article>
<div id="ball" data-fluent-read-ui="floating-ball"></div>
<div id="shadow-host"></div>
</body></html>`;

interface PickerHarness {
    document: Document;
    view: Record<string, unknown>;
    byId(id: string): HTMLElement;
    hit: {current: Element | null};
    frames: (() => void)[];
    flushFrames(): void;
    emit(type: string, event?: Record<string, unknown>): Record<string, any>;
    emitDocument(type: string, event?: Record<string, unknown>): void;
    host(): HTMLElement | null;
    shadow(): ShadowRoot;
    inspect: ReturnType<typeof vi.fn>;
    onPick: ReturnType<typeof vi.fn>;
    options: Record<string, unknown>;
    windowListeners: Listener[];
}

const summary = (overrides: Partial<SectionLabelSummary> = {}): SectionLabelSummary => ({
    total: 2, active: 0, pending: 2, truncated: false, action: 'translate', ...overrides,
});

function rect(left: number, top: number, width: number, height: number) {
    return {left, top, width, height, right: left + width, bottom: top + height, x: left, y: top};
}

async function createHarness(options: {withAnimationFrame?: boolean; initialPoint?: {x: number; y: number} | null} = {}): Promise<PickerHarness & {picker: typeof import('@/src/features/section-translation/content/picker')}> {
    vi.resetModules();
    const {window: view, document} = parseHTML(PAGE);
    const byId = (id: string) => document.getElementById(id)! as HTMLElement;
    const inline = new Set<Element>([byId('bold')]);
    (view as unknown as {getComputedStyle: (element: Element) => {display: string}}).getComputedStyle = (element) => ({
        display: inline.has(element) ? 'inline' : 'block',
    });
    byId('readme').getBoundingClientRect = () => rect(20, 40, 800, 600) as DOMRect;
    byId('para').getBoundingClientRect = () => rect(30, 60, 400, 40) as DOMRect;
    byId('second').getBoundingClientRect = () => rect(30, 120, 400, 40) as DOMRect;

    const windowListeners: Listener[] = [];
    const documentListeners: Listener[] = [];
    const frames: (() => void)[] = [];
    const fakeWindow: Record<string, unknown> = {
        innerHeight: 800,
        innerWidth: 1200,
        addEventListener: (type: string, listener: (event: any) => void, init?: {signal?: AbortSignal}) => {
            windowListeners.push({type, listener, signal: init?.signal});
        },
        setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
        clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
    };
    if (options.withAnimationFrame !== false) {
        fakeWindow.requestAnimationFrame = (callback: () => void) => frames.push(callback);
        fakeWindow.cancelAnimationFrame = vi.fn();
    }
    const documentTarget = document as unknown as Record<string, unknown>;
    documentTarget.addEventListener = (type: string, listener: (event: any) => void, init?: {signal?: AbortSignal}) => {
        documentListeners.push({type, listener, signal: init?.signal});
    };
    const hit = {current: byId('bold') as Element | null};
    documentTarget.elementFromPoint = () => hit.current;
    let visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => visibility});

    let shadowRoot: ShadowRoot | null = null;
    const createElement = document.createElement.bind(document);
    documentTarget.createElement = (tag: string) => {
        const element = createElement(tag) as HTMLElement;
        if (tag === 'fluent-read-section-picker') {
            const attach = element.attachShadow.bind(element);
            element.attachShadow = (init: ShadowRootInit) => {
                shadowRoot = attach(init);
                return shadowRoot;
            };
        }
        return element;
    };

    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal('document', document);

    const picker = await import('@/src/features/section-translation/content/picker');
    const inspect = vi.fn(() => summary());
    const onPick = vi.fn();
    const pickerOptions = {
        initialPoint: options.initialPoint === undefined ? {x: 50, y: 70} : options.initialPoint,
        inspect,
        onPick,
        text: (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key,
        isExitHotkey: (event: KeyboardEvent) => event.altKey === true && event.key === 'r',
        isEditing: (event: KeyboardEvent) => event.target === byId('para'),
    };

    const run = (store: Listener[], type: string, event: Record<string, any>) => {
        for (const entry of store.filter((item) => item.type === type && !item.signal?.aborted)) entry.listener(event);
    };
    const createEvent = (type: string, event: Record<string, unknown> = {}) => ({
        type,
        isTrusted: true,
        button: 0,
        clientX: 0,
        clientY: 0,
        preventDefault: vi.fn(),
        stopImmediatePropagation: vi.fn(),
        composedPath: () => [document.body, document.documentElement, document],
        ...event,
    });
    return {
        picker,
        document,
        view: view as unknown as Record<string, unknown>,
        byId,
        hit,
        frames,
        flushFrames: () => {
            while (frames.length > 0) frames.shift()!();
        },
        emit: (type, event) => {
            const created = createEvent(type, event);
            run(windowListeners, type, created);
            return created;
        },
        emitDocument: (type, event) => run(documentListeners, type, createEvent(type, event)),
        host: () => document.documentElement.querySelector('[data-fluent-read-ui="section-picker"]') as HTMLElement | null,
        shadow: () => shadowRoot!,
        inspect,
        onPick,
        options: pickerOptions,
        windowListeners,
    };
}

function query(root: ShadowRoot, selector: string): HTMLElement {
    return root.querySelector(selector) as HTMLElement;
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('局部翻译选择模式', () => {
    it('在封闭 Shadow Root 中高亮鼠标下的段落，并在停留后显示点击结果', async () => {
        const harness = await createHarness();
        expect(harness.picker.startSectionPicker(harness.options as never)).toBe(true);
        expect(harness.picker.isSectionPickerActive()).toBe(true);
        const host = harness.host()!;
        expect(host.getAttribute('translate')).toBe('no');
        expect(host.shadowRoot).toBeNull();
        expect(host.style.getPropertyValue('pointer-events')).toBe('none');

        harness.flushFrames();
        const shadow = harness.shadow();
        const box = query(shadow, '.fr-section-box');
        expect(box.classList.contains('is-visible')).toBe(true);
        expect(box.classList.contains('is-following')).toBe(false);
        expect(box.style.transform).toBe('translate(27px, 57px)');
        expect(box.style.width).toBe('406px');
        expect(query(shadow, '.fr-section-label-action').textContent).toBe('sectionTranslation.label.inspecting');
        expect(query(shadow, '.fr-section-label-meta').textContent).toBe('p#para');
        expect(query(shadow, '.fr-section-bar').getAttribute('role')).toBe('status');
        expect(query(shadow, '.fr-section-bar-close').getAttribute('aria-label')).toBe('sectionTranslation.picker.close');

        vi.advanceTimersByTime(90);
        expect(harness.inspect).toHaveBeenCalledWith(harness.byId('para'));
        expect(query(shadow, '.fr-section-label-action').textContent).toBe('sectionTranslation.label.translate:{"count":2}');

        harness.inspect.mockReturnValueOnce(summary({active: 2, pending: 0, action: 'restore'}));
        harness.hit.current = harness.byId('second');
        harness.emit('pointermove', {clientX: 60, clientY: 130});
        harness.flushFrames();
        expect(box.classList.contains('is-following')).toBe(true);
        vi.advanceTimersByTime(90);
        expect(box.classList.contains('tone-restore')).toBe(true);
        expect(query(shadow, '.fr-section-label').classList.contains('tone-restore')).toBe(true);

        // 回到已盘点过的区域时直接复用结果，不再重复遍历。
        harness.hit.current = harness.byId('para');
        harness.emit('pointermove', {clientX: 50, clientY: 70});
        harness.flushFrames();
        expect(harness.inspect).toHaveBeenCalledTimes(2);
        expect(query(shadow, '.fr-section-label-action').textContent).toBe('sectionTranslation.label.translate:{"count":2}');
        harness.picker.stopSectionPicker();
    });

    it('快速划过时只盘点最终停留的区域', async () => {
        const harness = await createHarness();
        harness.picker.startSectionPicker(harness.options as never);
        harness.flushFrames();
        harness.hit.current = harness.byId('second');
        harness.emit('pointermove', {clientX: 60, clientY: 130});
        harness.flushFrames();
        vi.advanceTimersByTime(90);
        expect(harness.inspect).toHaveBeenCalledOnce();
        expect(harness.inspect).toHaveBeenCalledWith(harness.byId('second'));
        harness.picker.stopSectionPicker();
    });

    it('方向键扩大与缩小范围，扩大后鼠标仍在范围内时保持选择', async () => {
        const harness = await createHarness();
        harness.picker.startSectionPicker(harness.options as never);
        harness.flushFrames();
        const box = query(harness.shadow(), '.fr-section-box');

        const up = harness.emit('keydown', {key: 'ArrowUp'});
        expect(up.preventDefault).toHaveBeenCalled();
        expect(up.stopImmediatePropagation).toHaveBeenCalled();
        harness.flushFrames();
        expect(box.style.transform).toBe('translate(17px, 37px)');

        // 在扩大后的范围内移动鼠标不会跳回段落。
        harness.hit.current = harness.byId('second');
        harness.emit('pointermove', {clientX: 60, clientY: 130});
        harness.flushFrames();
        expect(box.style.width).toBe('806px');

        // 已到最大范围时提示用户，稍后恢复原标签。
        harness.emit('keydown', {key: 'ArrowUp'});
        harness.flushFrames();
        const action = query(harness.shadow(), '.fr-section-label-action');
        expect(action.textContent).toBe('sectionTranslation.label.topmost');
        vi.advanceTimersByTime(1200);
        expect(action.textContent).toBe('sectionTranslation.label.translate:{"count":2}');

        harness.emit('keydown', {key: 'ArrowDown'});
        harness.flushFrames();
        expect(box.style.width).toBe('406px');
        // 已是最小范围时再缩小没有变化。
        harness.emit('keydown', {key: 'ArrowDown'});
        harness.flushFrames();
        expect(box.style.width).toBe('406px');

        // 扩大后鼠标离开扩大范围，回到鼠标下的基础区域。
        harness.emit('keydown', {key: 'ArrowUp'});
        harness.flushFrames();
        harness.hit.current = harness.byId('second');
        harness.emit('pointermove', {clientX: 900, clientY: 700});
        harness.flushFrames();
        expect(box.style.transform).toBe('translate(27px, 117px)');
        harness.picker.stopSectionPicker();
    });

    it('点击确认区域：网页收不到点击，选择模式退出后回调并短暂保留收束动画', async () => {
        const harness = await createHarness();
        harness.picker.startSectionPicker(harness.options as never);
        harness.flushFrames();

        const down = harness.emit('pointerdown');
        expect(down.stopImmediatePropagation).toHaveBeenCalled();
        expect(down.preventDefault).not.toHaveBeenCalled();
        const click = harness.emit('click', {clientX: 50, clientY: 70});
        expect(click.preventDefault).toHaveBeenCalled();
        expect(harness.onPick).toHaveBeenCalledWith(harness.byId('para'));
        expect(harness.picker.isSectionPickerActive()).toBe(false);
        expect(harness.windowListeners.every((entry) => entry.signal?.aborted)).toBe(true);

        const box = query(harness.shadow(), '.fr-section-box');
        expect(box.classList.contains('is-confirmed')).toBe(true);
        expect(query(harness.shadow(), '.fr-section-bar').classList.contains('is-hidden')).toBe(true);
        expect(harness.host()).not.toBeNull();
        vi.advanceTimersByTime(320);
        expect(harness.host()).toBeNull();
    });

    it('触屏点按时按落点即时解析区域；非左键与空白处点击不会确认', async () => {
        const harness = await createHarness({initialPoint: null});
        harness.picker.startSectionPicker(harness.options as never);
        harness.flushFrames();
        expect(query(harness.shadow(), '.fr-section-box').classList.contains('is-visible')).toBe(false);

        const middle = harness.emit('auxclick', {button: 1});
        expect(middle.preventDefault).toHaveBeenCalled();
        harness.hit.current = null;
        harness.emit('click', {clientX: 5000, clientY: 5000});
        harness.hit.current = harness.document.body;
        harness.emit('click', {clientX: 5, clientY: 5});
        expect(harness.onPick).not.toHaveBeenCalled();

        harness.hit.current = harness.byId('second');
        harness.emit('click', {clientX: 60, clientY: 130});
        expect(harness.onPick).toHaveBeenCalledWith(harness.byId('second'));
        // 高亮框尚未绘制时直接移除界面，不播放收束动画。
        expect(harness.host()).toBeNull();
    });

    it('Enter 确认当前区域；Esc、右键、再次按进入快捷键和关闭按钮都会退出且不翻译', async () => {
        const enter = await createHarness();
        enter.picker.startSectionPicker(enter.options as never);
        enter.flushFrames();
        enter.emit('keydown', {key: 'Enter'});
        expect(enter.onPick).toHaveBeenCalledWith(enter.byId('para'));

        for (const exit of [
            (harness: PickerHarness) => harness.emit('keydown', {key: 'Escape'}),
            (harness: PickerHarness) => harness.emit('contextmenu'),
            (harness: PickerHarness) => harness.emit('keydown', {key: 'r', altKey: true}),
            (harness: PickerHarness) => {
                const close = query(harness.shadow(), '.fr-section-bar-close');
                const event = new (harness.document.defaultView as unknown as {Event: typeof Event}).Event('click');
                Object.defineProperty(event, 'isTrusted', {value: true});
                close.dispatchEvent(event);
            },
            (harness: PickerHarness) => {
                Object.defineProperty(harness.document, 'visibilityState', {configurable: true, get: () => 'hidden'});
                harness.emitDocument('visibilitychange');
            },
        ]) {
            const harness = await createHarness();
            harness.picker.startSectionPicker(harness.options as never);
            harness.flushFrames();
            exit(harness);
            expect(harness.picker.isSectionPickerActive()).toBe(false);
            expect(harness.host()).toBeNull();
            expect(harness.onPick).not.toHaveBeenCalled();
            // 退出是幂等的：迟到的关闭点击不会重复清理或抛错。
            const lateClose = new (harness.document.defaultView as unknown as {Event: typeof Event}).Event('click');
            Object.defineProperty(lateClose, 'isTrusted', {value: true});
            query(harness.shadow(), '.fr-section-bar-close').dispatchEvent(lateClose);
            expect(harness.host()).toBeNull();
        }
    });

    it('页面仍可见时的 visibilitychange、未确认的 Enter 与伪造事件不会改变选择', async () => {
        const harness = await createHarness({initialPoint: null});
        harness.picker.startSectionPicker(harness.options as never);
        harness.emitDocument('visibilitychange');
        harness.emitDocument('visibilitychange', {isTrusted: false});
        harness.emit('keydown', {key: 'Enter'});
        for (const type of ['pointermove', 'pointerdown', 'click', 'mouseover', 'contextmenu', 'keydown', 'scroll']) {
            const event = harness.emit(type, {isTrusted: false, key: 'Escape'});
            expect(event.preventDefault).not.toHaveBeenCalled();
            expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
        }
        const close = query(harness.shadow(), '.fr-section-bar-close');
        close.dispatchEvent(new (harness.document.defaultView as unknown as {Event: typeof Event}).Event('click'));
        // 还没有指针位置时，滚动不会凭空选中区域。
        harness.emit('scroll');
        harness.flushFrames();
        expect(query(harness.shadow(), '.fr-section-box').classList.contains('is-visible')).toBe(false);
        harness.emit('scroll');
        expect(harness.picker.isSectionPickerActive()).toBe(true);
        expect(harness.onPick).not.toHaveBeenCalled();
        harness.picker.stopSectionPicker();
        // 退出后迟到的帧不再绘制。
        harness.flushFrames();
        expect(harness.host()).toBeNull();
    });

    it('焦点在输入框或事件落在 FluentRead 界面上时，按键和点击交还原处理者', async () => {
        const harness = await createHarness();
        harness.picker.startSectionPicker(harness.options as never);
        harness.flushFrames();

        const typing = harness.emit('keydown', {key: 'ArrowUp', target: harness.byId('para')});
        expect(typing.preventDefault).not.toHaveBeenCalled();
        const ownUi = (event: Record<string, unknown>) => harness.emit(event.type as string, {
            ...event,
            composedPath: () => [harness.byId('ball'), harness.document.body],
        });
        for (const type of ['pointerdown', 'mousedown', 'click', 'mouseover', 'contextmenu']) {
            const event = ownUi({type});
            expect(event.preventDefault).not.toHaveBeenCalled();
            expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
        }
        const enterOnClose = harness.emit('keydown', {key: 'Enter', composedPath: () => [harness.host(), harness.document.body]});
        expect(enterOnClose.preventDefault).not.toHaveBeenCalled();
        // 没有 composedPath 的旧事件按网页事件处理。
        const legacy = harness.emit('mouseover', {composedPath: undefined});
        expect(legacy.stopImmediatePropagation).toHaveBeenCalled();
        const pageHover = harness.emit('pointerover');
        expect(pageHover.stopImmediatePropagation).toHaveBeenCalled();
        expect(pageHover.preventDefault).not.toHaveBeenCalled();
        expect(harness.picker.isSectionPickerActive()).toBe(true);
        expect(harness.onPick).not.toHaveBeenCalled();
        harness.picker.stopSectionPicker();
    });

    it('滚动、缩放后按指针重新选择，指针停在提示条上时保持当前区域', async () => {
        const harness = await createHarness();
        harness.picker.startSectionPicker(harness.options as never);
        harness.flushFrames();
        const box = query(harness.shadow(), '.fr-section-box');

        harness.hit.current = harness.byId('second');
        harness.emit('scroll');
        harness.flushFrames();
        expect(box.style.transform).toBe('translate(27px, 117px)');
        // 滚动带来的换选立即贴合内容，不播放跟随动画。
        expect(box.classList.contains('is-following')).toBe(false);

        harness.hit.current = harness.host();
        harness.emit('resize');
        harness.flushFrames();
        expect(box.style.transform).toBe('translate(27px, 117px)');

        // 指针移到页面空白处时取消高亮。
        harness.hit.current = harness.document.body;
        harness.emit('pointermove', {clientX: 5, clientY: 790});
        harness.flushFrames();
        expect(box.classList.contains('is-visible')).toBe(false);
        harness.picker.stopSectionPicker();
    });

    it('网页替换当前区域后丢弃失效节点，并按指针重新选择', async () => {
        const harness = await createHarness();
        harness.picker.startSectionPicker(harness.options as never);
        harness.flushFrames();
        const box = query(harness.shadow(), '.fr-section-box');

        harness.byId('para').remove();
        harness.hit.current = harness.document.body;
        harness.emit('keydown', {key: 'ArrowDown'});
        harness.flushFrames();
        harness.emit('scroll');
        harness.flushFrames();
        expect(box.classList.contains('is-visible')).toBe(false);
        expect(query(harness.shadow(), '.fr-section-label').classList.contains('is-visible')).toBe(false);
        // 没有区域时方向键与 Enter 都不会生效。
        harness.emit('keydown', {key: 'ArrowUp'});
        harness.emit('keydown', {key: 'Enter'});
        expect(harness.onPick).not.toHaveBeenCalled();
        harness.picker.stopSectionPicker();
    });

    it('区域在盘点前失效时不会写回过期标签', async () => {
        const harness = await createHarness();
        harness.picker.startSectionPicker(harness.options as never);
        harness.flushFrames();
        harness.byId('para').remove();
        vi.advanceTimersByTime(90);
        expect(harness.inspect).not.toHaveBeenCalled();
        harness.picker.stopSectionPicker();
        vi.advanceTimersByTime(1000);
        expect(harness.inspect).not.toHaveBeenCalled();
    });

    it('选择模式单例：重复进入复用现有浮层，停止后可再次进入；没有文档根时拒绝进入', async () => {
        const harness = await createHarness();
        harness.picker.stopSectionPicker();
        expect(harness.picker.startSectionPicker(harness.options as never)).toBe(true);
        expect(harness.picker.startSectionPicker(harness.options as never)).toBe(true);
        expect(harness.document.documentElement.querySelectorAll('[data-fluent-read-ui="section-picker"]')).toHaveLength(1);
        harness.picker.stopSectionPicker();
        expect(harness.host()).toBeNull();
        expect(harness.picker.startSectionPicker(harness.options as never)).toBe(true);
        harness.picker.stopSectionPicker();

        vi.stubGlobal('document', {documentElement: null});
        expect(harness.picker.startSectionPicker(harness.options as never)).toBe(false);
        expect(harness.picker.isSectionPickerActive()).toBe(false);
    });

    it('没有 requestAnimationFrame 时回退到定时器，并能穿过开放的 ShadowRoot 命中内部元素', async () => {
        const harness = await createHarness({withAnimationFrame: false});
        const shadowHost = harness.byId('shadow-host');
        const openRoot = shadowHost.attachShadow({mode: 'open'});
        const inner = harness.document.createElement('section');
        openRoot.appendChild(inner);
        inner.getBoundingClientRect = () => rect(100, 300, 300, 80) as DOMRect;
        (openRoot as unknown as {elementFromPoint: () => Element}).elementFromPoint = () => inner;
        harness.hit.current = shadowHost;

        harness.picker.startSectionPicker(harness.options as never);
        vi.advanceTimersByTime(16);
        expect(query(harness.shadow(), '.fr-section-box').style.transform).toBe('translate(97px, 297px)');

        // ShadowRoot 命中自身宿主时停止下钻。
        (openRoot as unknown as {elementFromPoint: () => Element}).elementFromPoint = () => shadowHost;
        shadowHost.getBoundingClientRect = () => rect(0, 280, 600, 120) as DOMRect;
        harness.emit('pointermove', {clientX: 10, clientY: 290});
        vi.advanceTimersByTime(16);
        expect(query(harness.shadow(), '.fr-section-box').style.transform).toBe('translate(-3px, 277px)');

        // ShadowRoot 内没有命中元素时停留在宿主上。
        (openRoot as unknown as {elementFromPoint: () => null}).elementFromPoint = () => null;
        harness.emit('pointermove', {clientX: 12, clientY: 292});
        vi.advanceTimersByTime(16);
        expect(query(harness.shadow(), '.fr-section-box').style.transform).toBe('translate(-3px, 277px)');
        // 待绘制的回退定时器在退出时一并取消。
        harness.emit('pointermove', {clientX: 14, clientY: 294});
        harness.picker.stopSectionPicker();
        vi.advanceTimersByTime(16);
        expect(harness.host()).toBeNull();
    });

    it('“已是最大范围”提示按时恢复，期间完成的盘点不覆盖提示，退出时清理计时器', async () => {
        const harness = await createHarness();
        harness.picker.startSectionPicker(harness.options as never);
        harness.flushFrames();
        harness.emit('keydown', {key: 'ArrowUp'});
        harness.emit('keydown', {key: 'ArrowUp'});
        harness.flushFrames();
        const action = query(harness.shadow(), '.fr-section-label-action');
        expect(action.textContent).toBe('sectionTranslation.label.topmost');
        vi.advanceTimersByTime(90);
        expect(harness.inspect).toHaveBeenCalledWith(harness.byId('readme'));
        expect(action.textContent).toBe('sectionTranslation.label.topmost');
        // 连续到顶只保留最后一次提示的计时。
        harness.emit('keydown', {key: 'ArrowUp'});
        vi.advanceTimersByTime(1199);
        expect(action.textContent).toBe('sectionTranslation.label.topmost');
        // 换选区域时立即结束提示，改为盘点新的区域。
        harness.emit('keydown', {key: 'ArrowDown'});
        expect(action.textContent).toBe('sectionTranslation.label.inspecting');

        // 提示期间区域被网页移除：计时结束时没有区域可更新。
        harness.emit('keydown', {key: 'ArrowUp'});
        harness.emit('keydown', {key: 'ArrowUp'});
        harness.byId('readme').remove();
        harness.hit.current = harness.document.body;
        harness.emit('scroll');
        harness.flushFrames();
        vi.advanceTimersByTime(1200);
        expect(action.textContent).toBe('sectionTranslation.label.topmost');

        harness.hit.current = harness.byId('shadow-host');
        harness.byId('shadow-host').getBoundingClientRect = () => rect(0, 700, 500, 50) as DOMRect;
        harness.emit('pointermove', {clientX: 10, clientY: 710});
        harness.flushFrames();
        harness.emit('keydown', {key: 'ArrowUp'});
        harness.picker.stopSectionPicker();
        vi.advanceTimersByTime(2000);
        expect(harness.host()).toBeNull();
    });

    it('未提供退出快捷键与输入判断时仍可用 Esc 退出；取不到计算样式时按块级处理', async () => {
        const harness = await createHarness();
        harness.view.getComputedStyle = () => {
            throw new Error('no view');
        };
        harness.byId('bold').getBoundingClientRect = () => rect(80, 62, 60, 20) as DOMRect;
        const {isExitHotkey: _exit, isEditing: _editing, ...options} = harness.options;
        harness.picker.startSectionPicker(options as never);
        harness.flushFrames();
        expect(query(harness.shadow(), '.fr-section-label-meta').textContent).toBe('b#bold');
        harness.emit('keydown', {key: 'r', altKey: true});
        harness.emit('keydown', {key: 'ArrowUp'});
        harness.flushFrames();
        expect(query(harness.shadow(), '.fr-section-label-meta').textContent).toBe('p#para');
        harness.emit('keydown', {key: 'Escape'});
        expect(harness.picker.isSectionPickerActive()).toBe(false);
    });

    it('标签在区域上方放不下时贴在区域内侧，并始终留在视口内', async () => {
        const harness = await createHarness();
        harness.byId('para').getBoundingClientRect = () => rect(-50, 2, 400, 40) as DOMRect;
        harness.picker.startSectionPicker(harness.options as never);
        harness.flushFrames();
        expect(query(harness.shadow(), '.fr-section-label').style.transform).toBe('translate(4px, 8px)');

        harness.byId('second').getBoundingClientRect = () => rect(30, 300, 400, 40) as DOMRect;
        harness.hit.current = harness.byId('second');
        harness.emit('pointermove', {clientX: 60, clientY: 310});
        harness.flushFrames();
        expect(query(harness.shadow(), '.fr-section-label').style.transform).toBe('translate(30px, 291px)');
        harness.picker.stopSectionPicker();
    });
});
