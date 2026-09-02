import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {
    createFullPageScrollController,
    withFullPageViewportAnchor,
} from '@/src/features/full-page-translation/content/viewportStability';

const replacedGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>();

function replaceGlobal(name: PropertyKey, value: unknown): void {
    if (!replacedGlobals.has(name)) replacedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
}

describe('全文翻译视口稳定性', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        const {window, document} = parseHTML('<html><body></body></html>');
        replaceGlobal('window', window);
        replaceGlobal('document', document);
        replaceGlobal('Node', window.Node);
        replaceGlobal('Element', window.Element);
        replaceGlobal('HTMLElement', window.HTMLElement);
        Object.defineProperty(window, 'setTimeout', {configurable: true, value: globalThis.setTimeout});
        Object.defineProperty(window, 'clearTimeout', {configurable: true, value: globalThis.clearTimeout});
        Object.defineProperty(window, 'innerWidth', {configurable: true, value: 1280});
        Object.defineProperty(window, 'innerHeight', {configurable: true, value: 900});
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        for (const [name, descriptor] of replacedGlobals) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
        replacedGlobals.clear();
    });

    it('没有命中测试 API 时保持 callback，并在文档滚动中补偿锚点位移', () => {
        const {document, window} = globalThis as unknown as {document: Document; window: Window & typeof globalThis};
        Object.defineProperty(document, 'elementFromPoint', {configurable: true, value: undefined});
        expect(withFullPageViewportAnchor(() => 'ok')).toBe('ok');
        Object.defineProperty(document, 'elementFromPoint', {configurable: true, value: () => undefined});
        expect(withFullPageViewportAnchor(() => 'no-anchor')).toBe('no-anchor');
        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            value: () => ({nodeType: 1, tagName: 'P', style: undefined}),
        });
        expect(withFullPageViewportAnchor(() => 'invalid-anchor')).toBe('invalid-anchor');

        const anchor = document.createElement('p');
        document.body.appendChild(anchor);
        Object.defineProperty(document, 'elementFromPoint', {configurable: true, value: () => anchor});
        let reads = 0;
        Object.defineProperty(anchor, 'getBoundingClientRect', {
            configurable: true,
            value: () => {
                reads += 1;
                const top = reads % 2 === 1 ? 120 : 156;
                return {width: 400, height: 40, top, right: 400, bottom: top + 40, left: 0, x: 0, y: top};
            },
        });
        const scrollBy = vi.fn();
        Object.defineProperty(window, 'scrollBy', {configurable: true, value: scrollBy});

        expect(withFullPageViewportAnchor(() => 7)).toBe(7);
        expect(scrollBy).toHaveBeenCalledWith(0, 36);
    });

    it('优先调整可滚动祖先，并跳过被排除、扩展产物、零尺寸和异常锚点', () => {
        const {document, window} = globalThis as unknown as {document: Document; window: Window & typeof globalThis};
        const scroller = document.createElement('div');
        scroller.style.overflowY = 'auto';
        Object.defineProperty(scroller, 'scrollHeight', {configurable: true, value: 300});
        Object.defineProperty(scroller, 'clientHeight', {configurable: true, value: 100});
        scroller.scrollTop = 10;
        const anchor = document.createElement('p');
        scroller.appendChild(anchor);
        document.body.appendChild(scroller);
        Object.defineProperty(window, 'getComputedStyle', {
            configurable: true,
            value: (element: Element) => ({overflowY: element === scroller ? 'auto' : ''}),
        });
        Object.defineProperty(document, 'elementFromPoint', {configurable: true, value: () => anchor});
        let reads = 0;
        Object.defineProperty(anchor, 'getBoundingClientRect', {
            configurable: true,
            value: () => {
                reads += 1;
                const top = reads % 2 === 1 ? 80 : 125;
                return {width: 400, height: 40, top, right: 400, bottom: top + 40, left: 0, x: 0, y: top};
            },
        });
        const scrollBy = vi.fn();
        Object.defineProperty(window, 'scrollBy', {configurable: true, value: scrollBy});
        withFullPageViewportAnchor(() => undefined);
        expect(scroller.scrollTop).toBe(55);
        expect(scrollBy).not.toHaveBeenCalled();

        const wrapper = document.createElement('div');
        const nestedAnchor = document.createElement('p');
        wrapper.appendChild(nestedAnchor);
        document.body.appendChild(wrapper);
        Object.defineProperty(document, 'elementFromPoint', {configurable: true, value: () => nestedAnchor});
        Object.defineProperty(nestedAnchor, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({width: 300, height: 30, top: 80, right: 300, bottom: 110, left: 0, x: 0, y: 80}),
        });
        expect(withFullPageViewportAnchor(() => undefined)).toBeUndefined();

        const brokenStyleWrapper = document.createElement('div');
        const brokenStyleAnchor = document.createElement('p');
        brokenStyleWrapper.appendChild(brokenStyleAnchor);
        document.body.appendChild(brokenStyleWrapper);
        Object.defineProperty(window, 'getComputedStyle', {
            configurable: true,
            value: () => { throw new Error('style'); },
        });
        Object.defineProperty(document, 'elementFromPoint', {configurable: true, value: () => brokenStyleAnchor});
        Object.defineProperty(brokenStyleAnchor, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({width: 200, height: 20, top: 60, right: 200, bottom: 80, left: 0, x: 0, y: 60}),
        });
        expect(withFullPageViewportAnchor(() => undefined)).toBeUndefined();

        const zero = document.createElement('p');
        document.body.appendChild(zero);
        Object.defineProperty(document, 'elementFromPoint', {configurable: true, value: () => zero});
        Object.defineProperty(zero, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, x: 0, y: 0}),
        });
        expect(withFullPageViewportAnchor(() => undefined)).toBeUndefined();

        const excludedParent = document.createElement('div');
        const excluded = document.createElement('span');
        excludedParent.appendChild(excluded);
        document.body.appendChild(excludedParent);
        Object.defineProperty(document, 'elementFromPoint', {configurable: true, value: () => excluded});
        Object.defineProperty(excludedParent, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, x: 0, y: 0}),
        });
        expect(withFullPageViewportAnchor(() => undefined, [excluded])).toBeUndefined();

        const artifact = document.createElement('span');
        artifact.setAttribute('data-fr-translation-owned', 'true');
        document.body.appendChild(artifact);
        Object.defineProperty(document, 'elementFromPoint', {configurable: true, value: () => artifact});
        expect(withFullPageViewportAnchor(() => undefined)).toBeUndefined();

        const broken = document.createElement('p');
        document.body.appendChild(broken);
        Object.defineProperty(document, 'elementFromPoint', {configurable: true, value: () => broken});
        Object.defineProperty(broken, 'getBoundingClientRect', {configurable: true, value: () => { throw new Error('layout'); }});
        expect(withFullPageViewportAnchor(() => undefined)).toBeUndefined();
    });

    it('异常/无位移/无 scrollBy 时不阻断翻译 callback', () => {
        const {document, window} = globalThis as unknown as {document: Document; window: Window & typeof globalThis};
        const anchor = document.createElement('p');
        document.body.appendChild(anchor);
        Object.defineProperty(document, 'elementFromPoint', {configurable: true, value: () => anchor});
        Object.defineProperty(anchor, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({width: 300, height: 30, top: 90, right: 300, bottom: 120, left: 0, x: 0, y: 90}),
        });
        Object.defineProperty(window, 'scrollBy', {configurable: true, value: undefined});
        expect(withFullPageViewportAnchor(() => 1)).toBe(1);

        Object.defineProperty(anchor, 'getBoundingClientRect', {
            configurable: true,
            value: () => ({width: 300, height: 30, top: 90, right: 300, bottom: 120, left: 0, x: 0, y: 90}),
        });
        expect(withFullPageViewportAnchor(() => anchor.remove())).toBeUndefined();

        document.body.appendChild(anchor);
        Object.defineProperty(anchor, 'getBoundingClientRect', {
            configurable: true,
            value: () => {
                if ((anchor as unknown as {reads?: number}).reads) throw new Error('restore layout');
                (anchor as unknown as {reads: number}).reads = 1;
                return {width: 300, height: 30, top: 90, right: 300, bottom: 120, left: 0, x: 0, y: 90};
            },
        });
        expect(withFullPageViewportAnchor(() => undefined)).toBeUndefined();
    });

    it('滚动控制器只在活动会话中延迟目标，并在空闲时释放', async () => {
        let active = true;
        const onIdle = vi.fn();
        const afterIdle = vi.fn();
        const controller = createFullPageScrollController({
            isActive: () => active,
            onIdle,
            afterIdle,
        });
        const {document} = globalThis as unknown as {document: Document};
        const target = document.createElement('p');
        document.body.appendChild(target);

        expect(controller.isScrolling).toBe(false);
        expect(controller.defer(target)).toBe(false);
        controller.note();
        controller.note();
        expect(controller.isScrolling).toBe(true);
        expect(controller.defer(target)).toBe(true);
        expect(controller.defer(document.createElement('p'))).toBe(false);
        await vi.advanceTimersByTimeAsync(219);
        expect(onIdle).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(controller.isScrolling).toBe(false);
        expect(onIdle).toHaveBeenCalledWith([target]);
        expect(afterIdle).toHaveBeenCalledOnce();
        expect(controller.defer(target)).toBe(false);
        controller.dispose();
    });

    it('会话在滚动空闲前失活时不执行回调，dispose 可清理定时器', async () => {
        let active = true;
        const onIdle = vi.fn();
        const afterIdle = vi.fn();
        const controller = createFullPageScrollController({
            isActive: () => active,
            onIdle,
            afterIdle,
        });
        controller.note();
        active = false;
        await vi.advanceTimersByTimeAsync(220);
        expect(onIdle).not.toHaveBeenCalled();
        expect(afterIdle).not.toHaveBeenCalled();
        expect(controller.isScrolling).toBe(true);
        controller.dispose();
        active = true;
        controller.note();
        controller.dispose();
        expect(controller.isScrolling).toBe(false);
        active = false;
        controller.note();
        expect(controller.isScrolling).toBe(false);
    });
});
