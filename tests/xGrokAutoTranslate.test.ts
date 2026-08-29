import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';

import {X_GROK_NATIVE_TRANSLATION_ATTRIBUTE} from '@/src/core/translation/public';
import {
    X_GROK_POST_TRANSLATION_BUTTON_ATTRIBUTE,
    isXGrokAutoTranslatePage,
    isXGrokAutoTranslateMounted,
    mountXGrokAutoTranslate,
    unmountXGrokAutoTranslate,
} from '@/src/features/x-grok-translation/public';
import {X_GROK_PAGE_BRIDGE_DISPOSE_EVENT} from '@/src/features/x-grok-translation/content/pageBridgeCore';

class TestIntersectionObserver {
    static instances: TestIntersectionObserver[] = [];

    readonly observed = new Set<Element>();
    readonly observe = vi.fn((target: Element) => this.observed.add(target));
    readonly unobserve = vi.fn((target: Element) => this.observed.delete(target));
    readonly disconnect = vi.fn(() => this.observed.clear());

    constructor(
        private readonly callback: IntersectionObserverCallback,
        readonly options?: IntersectionObserverInit,
    ) {
        TestIntersectionObserver.instances.push(this);
    }

    emit(target: Element, isIntersecting: boolean): void {
        this.callback(
            [{target, isIntersecting} as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
        );
    }

    emitMany(entries: Array<{target: Element; isIntersecting: boolean}>): void {
        this.callback(
            entries as IntersectionObserverEntry[],
            this as unknown as IntersectionObserver,
        );
    }
}

class TestMutationObserver {
    static instances: TestMutationObserver[] = [];

    readonly observe = vi.fn();
    readonly disconnect = vi.fn();

    constructor(private readonly callback: MutationCallback) {
        TestMutationObserver.instances.push(this);
    }

    emit(records: MutationRecord[]): void {
        this.callback(records, this as unknown as MutationObserver);
    }
}

const replacedGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>();

function replaceGlobal(name: PropertyKey, value: unknown): void {
    if (!replacedGlobals.has(name)) {
        replacedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    }
    Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
}

function installDom(hostname = 'x.com'): Document {
    const {window, document} = parseHTML('<html><head></head><body></body></html>');
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: {hostname, href: `https://${hostname}/home`},
    });
    replaceGlobal('window', window);
    replaceGlobal('document', document);
    replaceGlobal('Node', window.Node);
    replaceGlobal('Element', window.Element);
    replaceGlobal('HTMLElement', window.HTMLElement);
    replaceGlobal('HTMLButtonElement', window.HTMLButtonElement);
    replaceGlobal('MutationObserver', TestMutationObserver);
    replaceGlobal('IntersectionObserver', TestIntersectionObserver);
    Object.defineProperty(window, 'innerWidth', {configurable: true, value: 1_024});
    Object.defineProperty(window, 'innerHeight', {configurable: true, value: 768});
    return document;
}

function setTweetTextRect(
    tweetText: HTMLElement,
    rect: {left: number; top: number; right: number; bottom: number} = {
        left: 10,
        top: 20,
        right: 210,
        bottom: 80,
    },
): void {
    tweetText.getBoundingClientRect = () => ({
        ...rect,
        x: rect.left,
        y: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
        toJSON: () => ({}),
    });
}

function createTweet(
    document: Document,
    statusId: string,
    options: {translated?: boolean; disabled?: boolean; withControl?: boolean} = {},
): {article: HTMLElement; button: HTMLButtonElement | null} {
    const article = document.createElement('article');
    article.setAttribute('data-testid', 'tweet');
    article.innerHTML = `
        <a href="/fluentread/status/${statusId}"><time></time></a>
        <div data-testid="tweetText">Post ${statusId}</div>
        ${options.withControl === false ? '' : `
            <div data-grok-control>
                <svg viewBox="0 0 33 32"></svg>
                ${options.translated ? '<span data-translated-from>来源说明</span>' : ''}
                <button ${options.disabled ? 'disabled aria-disabled="true"' : ''}>
                    <span>${options.translated ? 'Show original' : '任意本地化按钮文案'}</span>
                </button>
            </div>
        `}
    `;
    const tweetText = article.querySelector<HTMLElement>('[data-testid="tweetText"]')!;
    setTweetTextRect(tweetText);
    return {
        article,
        button: article.querySelector('button') as HTMLButtonElement | null,
    };
}

function childListRecord(
    target: Node,
    addedNodes: Node[] = [],
    removedNodes: Node[] = [],
): MutationRecord {
    return {
        type: 'childList',
        target,
        addedNodes,
        removedNodes,
    } as unknown as MutationRecord;
}

function attributeRecord(target: Node): MutationRecord {
    return {type: 'attributes', target} as unknown as MutationRecord;
}

function getFallbackButton(article: HTMLElement): HTMLButtonElement | null {
    const host = article.querySelector<HTMLElement>(`[${X_GROK_POST_TRANSLATION_BUTTON_ATTRIBUTE}]`);
    return (host?.shadowRoot?.querySelector('button') as HTMLButtonElement | null | undefined) ?? null;
}

describe('X Grok 原生逐帖自动翻译', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        TestIntersectionObserver.instances = [];
        TestMutationObserver.instances = [];
        installDom();
    });

    it('页面适用性只接受 X/Twitter 主域及子域，不接受伪后缀或无效 URL', () => {
        expect(isXGrokAutoTranslatePage('https://x.com/home')).toBe(true);
        expect(isXGrokAutoTranslatePage('https://mobile.x.com/user/status/1')).toBe(true);
        expect(isXGrokAutoTranslatePage('http://twitter.com/home')).toBe(true);
        expect(isXGrokAutoTranslatePage('https://pro.twitter.com/home')).toBe(true);
        expect(isXGrokAutoTranslatePage('https://x.com.example.org/home')).toBe(false);
        expect(isXGrokAutoTranslatePage('ftp://x.com/home')).toBe(false);
        expect(isXGrokAutoTranslatePage('not a valid URL')).toBe(false);
    });

    afterEach(() => {
        unmountXGrokAutoTranslate();
        vi.clearAllTimers();
        vi.useRealTimers();
        for (const [name, descriptor] of replacedGlobals) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
        replacedGlobals.clear();
    });

    it('运行时从未挂载时，关闭操作仍会停用 document_start 预激活的页面桥', () => {
        const disposed = vi.fn();
        document.addEventListener(X_GROK_PAGE_BRIDGE_DISPOSE_EVENT, disposed, {once: true});

        unmountXGrokAutoTranslate();

        expect(isXGrokAutoTranslateMounted()).toBe(false);
        expect(disposed).toHaveBeenCalledOnce();
    });

    it('挂载时标记 documentElement、观察动态根，并仅在初始帖子接近视口后点击', () => {
        const {article, button} = createTweet(document, '1001');
        const click = vi.fn();
        button!.click = click;
        document.body.append(article);

        mountXGrokAutoTranslate();

        expect(isXGrokAutoTranslateMounted()).toBe(true);
        expect(document.documentElement.hasAttribute(X_GROK_NATIVE_TRANSLATION_ATTRIBUTE)).toBe(true);
        expect(TestMutationObserver.instances[0]!.observe).toHaveBeenCalledWith(
            document.documentElement,
            expect.objectContaining({childList: true, subtree: true}),
        );
        const visibility = TestIntersectionObserver.instances[0]!;
        expect(visibility.options?.rootMargin).toBe('600px 0px');
        expect(visibility.observe).toHaveBeenCalledWith(article);
        expect(article.querySelector(`[${X_GROK_POST_TRANSLATION_BUTTON_ATTRIBUTE}]`)).toBeNull();
        expect(click).not.toHaveBeenCalled();

        visibility.emit(article, true);
        expect(click).toHaveBeenCalledOnce();
        visibility.emit(document.body, true);
        visibility.emit(document.createElement('article'), true);
        visibility.emit(document.createTextNode('not an element') as unknown as Element, true);
    });

    it('X 没有原生入口时为正文帖子立即补充可访问按钮，可信点击交给 FluentRead', () => {
        const {article} = createTweet(document, '1040', {withControl: false});
        const translateAtPoint = vi.fn();
        document.body.append(article);

        mountXGrokAutoTranslate({
            translateAtPoint,
            acceptsUserGesture: () => true,
        });

        const host = article.querySelector<HTMLElement>(`[${X_GROK_POST_TRANSLATION_BUTTON_ATTRIBUTE}]`)!;
        const tweetText = article.querySelector<HTMLElement>('[data-testid="tweetText"]')!;
        const button = getFallbackButton(article)!;
        expect(host.getAttribute(X_GROK_POST_TRANSLATION_BUTTON_ATTRIBUTE)).toBe('fallback');
        expect(host.nextSibling).toBe(tweetText);
        expect(host.getAttribute('data-fr-translation-owned')).toBe('true');
        expect(button.textContent).toBe('翻译帖子');
        expect(button.getAttribute('aria-label')).toBe('翻译帖子（Grok 优先）');
        expect(button.title).toContain('不可用时使用 FluentRead');

        button.click();

        expect(translateAtPoint).toHaveBeenCalledOnce();
        expect(translateAtPoint).toHaveBeenCalledWith(110, 50);
    });

    it('宿主页合成事件不能通过每帖按钮触发 FluentRead 请求', () => {
        const {article} = createTweet(document, '1041', {withControl: false});
        const translateAtPoint = vi.fn();
        document.body.append(article);
        mountXGrokAutoTranslate({translateAtPoint});

        getFallbackButton(article)!.click();

        expect(translateAtPoint).not.toHaveBeenCalled();
    });

    it('补充按钮隔离 pointerdown，并只用正文在真实视口内的可见中心触发翻译', () => {
        const clipped = createTweet(document, '1049', {withControl: false});
        const offscreen = createTweet(document, '1050', {withControl: false});
        setTweetTextRect(
            clipped.article.querySelector<HTMLElement>('[data-testid="tweetText"]')!,
            {left: -40, top: -20, right: 120, bottom: 80},
        );
        setTweetTextRect(
            offscreen.article.querySelector<HTMLElement>('[data-testid="tweetText"]')!,
            {left: -100, top: 20, right: -1, bottom: 80},
        );
        Object.defineProperty(window, 'innerWidth', {configurable: true, value: 0});
        Object.defineProperty(window, 'innerHeight', {configurable: true, value: 0});
        Object.defineProperty(document.documentElement, 'clientWidth', {configurable: true, value: 320});
        Object.defineProperty(document.documentElement, 'clientHeight', {configurable: true, value: 200});
        document.body.append(clipped.article, offscreen.article);
        const translateAtPoint = vi.fn();
        mountXGrokAutoTranslate({translateAtPoint, acceptsUserGesture: () => true});

        const propagatedPointerDown = vi.fn();
        clipped.article.addEventListener('pointerdown', propagatedPointerDown);
        const pointerDown = new window.Event('pointerdown', {bubbles: true, cancelable: true});
        getFallbackButton(clipped.article)!.dispatchEvent(pointerDown);
        expect(pointerDown.defaultPrevented).toBe(true);
        expect(propagatedPointerDown).not.toHaveBeenCalled();

        getFallbackButton(clipped.article)!.click();
        getFallbackButton(offscreen.article)!.click();

        expect(translateAtPoint).toHaveBeenCalledOnce();
        expect(translateAtPoint).toHaveBeenCalledWith(60, 40);
    });

    it('虚拟列表回收、帖子脱离和正文被替换后，旧按钮都不能触发翻译', () => {
        const {article} = createTweet(document, '1051', {withControl: false});
        document.body.append(article);
        const translateAtPoint = vi.fn();
        mountXGrokAutoTranslate({translateAtPoint, acceptsUserGesture: () => true});
        const mutations = TestMutationObserver.instances[0]!;
        const staleButton = getFallbackButton(article)!;

        article.remove();
        mutations.emit([childListRecord(document.body, [], [article])]);
        document.body.append(article);
        mutations.emit([childListRecord(document.body, [article])]);
        staleButton.click();

        const currentButton = getFallbackButton(article)!;
        article.querySelector('[data-testid="tweetText"]')!.remove();
        currentButton.click();
        article.remove();
        currentButton.click();

        expect(translateAtPoint).not.toHaveBeenCalled();
    });

    it('点击补充按钮时若 X 已切换到翻译完成状态，只移除补充入口而不重复翻译', () => {
        const empty = createTweet(document, '1052', {withControl: false});
        document.body.append(empty.article);
        const translateAtPoint = vi.fn();
        mountXGrokAutoTranslate({translateAtPoint, acceptsUserGesture: () => true});
        const fallbackButton = getFallbackButton(empty.article)!;
        const translatedControl = createTweet(document, '1052', {translated: true, disabled: true})
            .article.querySelector('[data-grok-control]')!;
        empty.article.append(translatedControl);

        fallbackButton.click();

        expect(translateAtPoint).not.toHaveBeenCalled();
        expect(getFallbackButton(empty.article)).toBeNull();
    });

    it('X 原生入口存在但不可操作时仍保留每帖补充按钮', () => {
        const {article} = createTweet(document, '1047', {disabled: true});
        document.body.append(article);

        mountXGrokAutoTranslate({acceptsUserGesture: () => true});

        const fallbackButton = getFallbackButton(article)!;
        fallbackButton.click();
        expect(fallbackButton.isConnected).toBe(true);
    });

    it('引用帖在 DOM 中更深时只给主帖正文补一个按钮', () => {
        const article = document.createElement('article');
        article.setAttribute('data-testid', 'tweet');
        article.innerHTML = `
            <a href="/fluentread/status/1042"><time></time></a>
            <section data-quoted><div><div data-testid="tweetText">Quoted post</div></div></section>
            <section data-main><div data-testid="tweetText">Main post</div></section>
        `;
        document.body.append(article);

        mountXGrokAutoTranslate();

        const hosts = article.querySelectorAll(`[${X_GROK_POST_TRANSLATION_BUTTON_ATTRIBUTE}]`);
        const mainText = article.querySelector('[data-main] [data-testid="tweetText"]')!;
        expect(hosts).toHaveLength(1);
        expect(hosts[0]!.nextSibling).toBe(mainText);
    });

    it('发现挂载后动态加入的帖子，并在其进入近视口时触发', () => {
        mountXGrokAutoTranslate();
        const {article, button} = createTweet(document, '1002');
        const click = vi.fn();
        button!.click = click;
        document.body.append(article);

        TestMutationObserver.instances[0]!.emit([
            childListRecord(document.body, [article]),
        ]);
        const visibility = TestIntersectionObserver.instances[0]!;
        expect(visibility.observe).toHaveBeenCalledWith(article);
        visibility.emit(article, true);

        expect(click).toHaveBeenCalledOnce();
    });

    it('动态帖子没有原生入口时补按钮，X 后续给出入口后移除补充按钮并自动触发', () => {
        const empty = createTweet(document, '1043', {withControl: false});
        document.body.append(empty.article);
        mountXGrokAutoTranslate();
        const mutations = TestMutationObserver.instances[0]!;
        const visibility = TestIntersectionObserver.instances[0]!;
        visibility.emit(empty.article, true);
        expect(getFallbackButton(empty.article)).not.toBeNull();

        const control = createTweet(document, '1043').article.querySelector('[data-grok-control]')!;
        empty.article.append(control);
        const nativeButton = control.querySelector('button') as HTMLButtonElement;
        const nativeClick = vi.fn();
        nativeButton.click = nativeClick;
        mutations.emit([childListRecord(empty.article, [control])]);

        expect(getFallbackButton(empty.article)).toBeNull();
        expect(nativeClick).toHaveBeenCalledOnce();
    });

    it('补充按钮点击瞬间发现 X 原生入口时优先委托 Grok，不调用 FluentRead', () => {
        const empty = createTweet(document, '1044', {withControl: false});
        const translateAtPoint = vi.fn();
        document.body.append(empty.article);
        mountXGrokAutoTranslate({
            translateAtPoint,
            acceptsUserGesture: () => true,
        });
        const fallbackButton = getFallbackButton(empty.article)!;

        const control = createTweet(document, '1044').article.querySelector('[data-grok-control]')!;
        const nativeButton = control.querySelector('button') as HTMLButtonElement;
        const nativeClick = vi.fn();
        nativeButton.click = nativeClick;
        empty.article.append(control);

        fallbackButton.click();

        expect(nativeClick).toHaveBeenCalledOnce();
        expect(translateAtPoint).not.toHaveBeenCalled();
        expect(getFallbackButton(empty.article)).toBeNull();
    });

    it('用户已经选择 FluentRead 兜底后，迟到的 X 原生入口不会再自动造成双重翻译', () => {
        const empty = createTweet(document, '1048', {withControl: false});
        const translateAtPoint = vi.fn();
        document.body.append(empty.article);
        mountXGrokAutoTranslate({
            translateAtPoint,
            acceptsUserGesture: () => true,
        });
        const visibility = TestIntersectionObserver.instances[0]!;
        const mutations = TestMutationObserver.instances[0]!;
        visibility.emit(empty.article, true);
        getFallbackButton(empty.article)!.click();
        expect(translateAtPoint).toHaveBeenCalledOnce();

        const control = createTweet(document, '1048').article.querySelector('[data-grok-control]')!;
        const nativeButton = control.querySelector('button') as HTMLButtonElement;
        const nativeClick = vi.fn();
        nativeButton.click = nativeClick;
        empty.article.append(control);
        mutations.emit([childListRecord(empty.article, [control])]);

        expect(nativeClick).not.toHaveBeenCalled();
        expect(getFallbackButton(empty.article)).toBeNull();
    });

    it('重复可见回调和点击后的宿主 DOM 变化不会再次点击同一帖子', () => {
        const {article, button} = createTweet(document, '1003');
        const click = vi.fn();
        button!.click = click;
        document.body.append(article);
        mountXGrokAutoTranslate();
        mountXGrokAutoTranslate();

        expect(TestIntersectionObserver.instances).toHaveLength(1);
        expect(TestMutationObserver.instances).toHaveLength(1);

        const visibility = TestIntersectionObserver.instances[0]!;
        visibility.emit(article, true);
        visibility.emit(article, true);
        const translatedFrom = document.createElement('span');
        button!.parentElement!.insertBefore(translatedFrom, button);
        TestMutationObserver.instances[0]!.emit([
            childListRecord(button!.parentElement!, [translatedFrom]),
        ]);
        vi.runAllTimers();

        expect(click).toHaveBeenCalledOnce();
    });

    it('Grok 图标和按钮之间已有来源 span 时识别为 Show original 状态并跳过', () => {
        const {article, button} = createTweet(document, '1004', {translated: true});
        const click = vi.fn();
        button!.click = click;
        document.body.append(article);
        mountXGrokAutoTranslate();

        TestIntersectionObserver.instances[0]!.emit(article, true);
        TestMutationObserver.instances[0]!.emit([attributeRecord(button!.parentElement!)]);
        vi.runAllTimers();

        expect(click).not.toHaveBeenCalled();
    });

    it('首页只有内嵌 Grok 图标的通用“Grok 操作”时绝不把它误当翻译入口', () => {
        const article = document.createElement('article');
        article.setAttribute('data-testid', 'tweet');
        article.innerHTML = `
            <a href="/fluentread/status/1005"><time></time></a>
            <div data-testid="tweetText">Timeline original post</div>
            <button aria-label="Grok 操作" aria-haspopup="menu">
                <svg viewBox="0 0 33 32"></svg>
            </button>
        `;
        const grokAction = article.querySelector('button') as HTMLButtonElement;
        const tweetText = article.querySelector<HTMLElement>('[data-testid="tweetText"]')!;
        setTweetTextRect(tweetText);
        const click = vi.fn();
        grokAction.click = click;
        document.body.append(article);
        const translateAtPoint = vi.fn();
        mountXGrokAutoTranslate({
            translateAtPoint,
            acceptsUserGesture: () => true,
        });

        TestIntersectionObserver.instances[0]!.emit(article, true);
        vi.runAllTimers();

        expect(click).not.toHaveBeenCalled();
        expect(getFallbackButton(article)).not.toBeNull();
        getFallbackButton(article)!.click();
        expect(translateAtPoint).toHaveBeenCalledWith(110, 50);
    });

    it('同批进入视口的多个帖子进入单队列，并保持至少 250ms 的触发间隔', () => {
        const first = createTweet(document, '1010');
        const second = createTweet(document, '1011');
        const third = createTweet(document, '1016');
        const firstClick = vi.fn();
        const secondClick = vi.fn();
        const thirdClick = vi.fn();
        first.button!.click = firstClick;
        second.button!.click = secondClick;
        third.button!.click = thirdClick;
        document.body.append(first.article, second.article, third.article);
        mountXGrokAutoTranslate();

        TestIntersectionObserver.instances[0]!.emitMany([
            {target: first.article, isIntersecting: true},
            {target: second.article, isIntersecting: true},
            {target: third.article, isIntersecting: true},
        ]);
        TestIntersectionObserver.instances[0]!.emit(second.article, true);

        expect(firstClick).toHaveBeenCalledOnce();
        expect(secondClick).not.toHaveBeenCalled();
        expect(thirdClick).not.toHaveBeenCalled();
        vi.advanceTimersByTime(249);
        expect(secondClick).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(secondClick).toHaveBeenCalledOnce();
        expect(thirdClick).not.toHaveBeenCalled();
        vi.advanceTimersByTime(250);
        expect(thirdClick).toHaveBeenCalledOnce();
    });

    it('排队帖子滚出视口时取消本次触发，重新进入后才恢复', () => {
        const first = createTweet(document, '1014');
        const second = createTweet(document, '1015');
        const firstClick = vi.fn();
        const secondClick = vi.fn();
        first.button!.click = firstClick;
        second.button!.click = secondClick;
        document.body.append(first.article, second.article);
        mountXGrokAutoTranslate();
        const visibility = TestIntersectionObserver.instances[0]!;

        visibility.emitMany([
            {target: first.article, isIntersecting: true},
            {target: second.article, isIntersecting: true},
        ]);
        visibility.emit(second.article, false);
        vi.advanceTimersByTime(250);

        expect(firstClick).toHaveBeenCalledOnce();
        expect(secondClick).not.toHaveBeenCalled();
        visibility.emit(second.article, true);
        expect(secondClick).toHaveBeenCalledOnce();
    });

    it('首次点击八秒后仍是同一个未译控件时只补点一次，第二次无响应即停止', () => {
        const {article, button} = createTweet(document, '1012');
        const click = vi.fn();
        button!.click = click;
        document.body.append(article);
        mountXGrokAutoTranslate();

        TestIntersectionObserver.instances[0]!.emit(article, true);
        expect(click).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(7_999);
        expect(click).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(1);
        expect(click).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(8_000);
        expect(click).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);

        TestMutationObserver.instances[0]!.emit([
            childListRecord(button!.parentElement!, [document.createTextNode('host churn')]),
        ]);
        expect(click).toHaveBeenCalledTimes(2);
    });

    it('八秒验证时若 X 已切换为译文结构则完成，不会补点 Show original', () => {
        const {article, button} = createTweet(document, '1017');
        const click = vi.fn();
        button!.click = click;
        document.body.append(article);
        mountXGrokAutoTranslate();

        TestIntersectionObserver.instances[0]!.emit(article, true);
        const translatedFrom = document.createElement('span');
        button!.parentElement!.insertBefore(translatedFrom, button);
        vi.advanceTimersByTime(8_000);

        expect(click).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('八秒验证发现 article 已复用为新 status 时按新帖重置并重新触发', () => {
        const {article, button} = createTweet(document, '1018');
        const click = vi.fn();
        button!.click = click;
        document.body.append(article);
        mountXGrokAutoTranslate();

        TestIntersectionObserver.instances[0]!.emit(article, true);
        article.querySelector('a')!.setAttribute('href', '/fluentread/status/2018');
        vi.advanceTimersByTime(8_000);

        expect(click).toHaveBeenCalledTimes(2);
    });

    it('引用帖已经翻译而主帖尚未翻译时只点击主帖控件，不误点 Show original', () => {
        const article = document.createElement('article');
        article.setAttribute('data-testid', 'tweet');
        article.innerHTML = `
            <a href="/fluentread/status/1013"><time></time></a>
            <section data-main-post>
                <div data-testid="tweetText">Main post</div>
                <div data-main-grok>
                    <svg viewBox="0 0 33 32"></svg>
                    <button><span>任意主帖文案</span></button>
                </div>
            </section>
            <section data-quoted-post>
                <div data-testid="tweetText">Quoted post</div>
                <div data-quoted-grok>
                    <svg viewBox="0 0 33 32"></svg>
                    <span data-translated-from>Translated from</span>
                    <button><span>Show original</span></button>
                </div>
            </section>
        `;
        const mainButton = article.querySelector('[data-main-grok] button') as HTMLButtonElement;
        const quotedButton = article.querySelector('[data-quoted-grok] button') as HTMLButtonElement;
        const mainClick = vi.fn();
        const quotedClick = vi.fn();
        mainButton.click = mainClick;
        quotedButton.click = quotedClick;
        document.body.append(article);
        mountXGrokAutoTranslate();

        TestIntersectionObserver.instances[0]!.emit(article, true);

        expect(mainClick).toHaveBeenCalledOnce();
        expect(quotedClick).not.toHaveBeenCalled();
    });

    it('用 tweetText 共同祖先选择主帖控件，并兼容图标包裹、无效 time 链接与普通按钮', () => {
        const article = document.createElement('article');
        article.setAttribute('data-testid', 'tweet');
        article.innerHTML = `
            <a href="/fluentread/status/not-a-number"><time></time></a>
            <a href="/fluentread/status/1019"></a>
            <svg></svg>
            <button data-decoy>普通帖子按钮</button>
            <section data-deep-quote>
                <div><div data-testid="tweetText">Quoted first but deeper</div></div>
                <div data-quote-grok>
                    <svg viewBox="0 0 33 32"></svg>
                    <span data-translated-from>来源</span>
                    <button><span>Show original</span></button>
                </div>
            </section>
            <section data-main-post>
                <div data-testid="tweetText">Main shallower text</div>
                <div data-main-grok>
                    <i><svg viewBox="0   0 33  32"></svg></i>
                    <button><span>任意文案</span></button>
                </div>
            </section>
        `;
        const mainButton = article.querySelector('[data-main-grok] button') as HTMLButtonElement;
        const quotedButton = article.querySelector('[data-quote-grok] button') as HTMLButtonElement;
        const mainClick = vi.fn();
        const quotedClick = vi.fn();
        mainButton.click = mainClick;
        quotedButton.click = quotedClick;
        document.body.append(article);
        mountXGrokAutoTranslate();

        TestIntersectionObserver.instances[0]!.emit(article, true);

        expect(mainClick).toHaveBeenCalledOnce();
        expect(quotedClick).not.toHaveBeenCalled();
    });

    it('缺少主帖 tweetText 或引用归属结构含糊时保持不触发', () => {
        const noTweetText = createTweet(document, '1020').article;
        noTweetText.querySelector('[data-testid="tweetText"]')!.remove();
        noTweetText.querySelector('time')!.remove();
        const noTextButton = noTweetText.querySelector('button') as HTMLButtonElement;
        const noTextClick = vi.fn();
        noTextButton.click = noTextClick;

        const ambiguous = createTweet(document, '1021').article;
        ambiguous.querySelectorAll('a').forEach((anchor) => anchor.remove());
        ambiguous.append(Object.assign(document.createElement('div'), {
            innerHTML: '<div data-testid="tweetText">Quoted sibling</div>',
        }));
        const ambiguousButton = ambiguous.querySelector('button') as HTMLButtonElement;
        const ambiguousClick = vi.fn();
        ambiguousButton.click = ambiguousClick;
        document.body.append(noTweetText, ambiguous);
        mountXGrokAutoTranslate();

        const visibility = TestIntersectionObserver.instances[0]!;
        visibility.emit(noTweetText, true);
        visibility.emit(ambiguous, true);
        vi.runAllTimers();

        expect(noTextClick).not.toHaveBeenCalled();
        expect(ambiguousClick).not.toHaveBeenCalled();
    });

    it('timer 到期前帖子脱离文档时停止验证和延迟发现', () => {
        const clicked = createTweet(document, '1030');
        const waiting = createTweet(document, '1031', {withControl: false});
        const click = vi.fn();
        clicked.button!.click = click;
        document.body.append(clicked.article, waiting.article);
        mountXGrokAutoTranslate();
        const visibility = TestIntersectionObserver.instances[0]!;
        visibility.emit(clicked.article, true);
        visibility.emit(waiting.article, true);

        clicked.article.remove();
        waiting.article.remove();
        vi.runAllTimers();

        expect(click).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('非 X/Twitter 域名不挂载观察器，也不留下 X/Grok 页面标记', () => {
        unmountXGrokAutoTranslate();
        installDom('example.com');

        mountXGrokAutoTranslate();

        expect(isXGrokAutoTranslateMounted()).toBe(false);
        expect(TestIntersectionObserver.instances).toHaveLength(0);
        expect(TestMutationObserver.instances).toHaveLength(0);
        expect(document.documentElement.hasAttribute(X_GROK_NATIVE_TRANSLATION_ATTRIBUTE)).toBe(false);
    });

    it('关闭功能时移除所有 FluentRead 每帖按钮，不触碰帖子正文', () => {
        const first = createTweet(document, '1045', {withControl: false});
        const second = createTweet(document, '1046', {withControl: false});
        document.body.append(first.article, second.article);
        mountXGrokAutoTranslate();
        expect(document.querySelectorAll(`[${X_GROK_POST_TRANSLATION_BUTTON_ATTRIBUTE}]`)).toHaveLength(2);

        unmountXGrokAutoTranslate();

        expect(document.querySelectorAll(`[${X_GROK_POST_TRANSLATION_BUTTON_ATTRIBUTE}]`)).toHaveLength(0);
        expect(first.article.querySelector('[data-testid="tweetText"]')?.textContent).toBe('Post 1045');
        expect(second.article.querySelector('[data-testid="tweetText"]')?.textContent).toBe('Post 1046');
    });

    it('同一个虚拟列表 article 被复用为新 status ID 时重置状态并触发新帖子', () => {
        const first = createTweet(document, '1005');
        const firstClick = vi.fn();
        first.button!.click = firstClick;
        document.body.append(first.article);
        mountXGrokAutoTranslate();

        const visibility = TestIntersectionObserver.instances[0]!;
        visibility.emit(first.article, true);
        expect(firstClick).toHaveBeenCalledOnce();

        const replacement = createTweet(document, '2005');
        first.article.replaceChildren(...Array.from(replacement.article.childNodes));
        const secondButton = first.article.querySelector('button') as HTMLButtonElement;
        const secondClick = vi.fn();
        secondButton.click = secondClick;
        TestMutationObserver.instances[0]!.emit([
            childListRecord(first.article, Array.from(first.article.childNodes)),
        ]);
        vi.advanceTimersByTime(250);

        expect(secondClick).toHaveBeenCalledOnce();
        expect(firstClick).toHaveBeenCalledOnce();
    });

    it('首次可见回调前 article 已复用时以回调时的 status 身份触发', () => {
        const {article, button} = createTweet(document, '1032');
        const click = vi.fn();
        button!.click = click;
        document.body.append(article);
        mountXGrokAutoTranslate();

        article.querySelector('a')!.setAttribute('href', '/fluentread/status/2032');
        TestIntersectionObserver.instances[0]!.emit(article, true);

        expect(click).toHaveBeenCalledOnce();
    });

    it('排队期间 status 改变、控件变为已译或被禁用时都会在出队前重新校验', () => {
        const first = createTweet(document, '1022');
        const reused = createTweet(document, '1023');
        const translated = createTweet(document, '1024');
        const disabled = createTweet(document, '1025');
        const firstClick = vi.fn();
        const reusedClick = vi.fn();
        const translatedClick = vi.fn();
        const disabledClick = vi.fn();
        first.button!.click = firstClick;
        reused.button!.click = reusedClick;
        translated.button!.click = translatedClick;
        disabled.button!.click = disabledClick;
        document.body.append(first.article, reused.article, translated.article, disabled.article);
        mountXGrokAutoTranslate();
        const visibility = TestIntersectionObserver.instances[0]!;
        visibility.emitMany([
            {target: first.article, isIntersecting: true},
            {target: reused.article, isIntersecting: true},
            {target: translated.article, isIntersecting: true},
            {target: disabled.article, isIntersecting: true},
        ]);

        reused.article.querySelector('a')!.setAttribute('href', '/fluentread/status/2023');
        const translatedFrom = document.createElement('span');
        translated.button!.parentElement!.insertBefore(translatedFrom, translated.button);
        disabled.button!.setAttribute('disabled', '');
        vi.advanceTimersByTime(250);
        expect(reusedClick).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(250);
        expect(translatedClick).not.toHaveBeenCalled();
        expect(disabledClick).not.toHaveBeenCalled();
        vi.advanceTimersByTime(250);
        expect(disabledClick).not.toHaveBeenCalled();
    });

    it('原生 button.click 抛错时只再试一次，之后进入冷却', () => {
        const {article, button} = createTweet(document, '1026');
        const click = vi.fn(() => {
            throw new Error('host rejected synthetic click');
        });
        button!.click = click;
        document.body.append(article);
        mountXGrokAutoTranslate();

        TestIntersectionObserver.instances[0]!.emit(article, true);
        vi.runAllTimers();

        expect(click).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('延迟控件只进行有限次定时重试，真实 DOM 更新仍可立即唤醒', () => {
        const empty = createTweet(document, '1006', {withControl: false});
        document.body.append(empty.article);
        mountXGrokAutoTranslate();
        TestIntersectionObserver.instances[0]!.emit(empty.article, true);
        TestIntersectionObserver.instances[0]!.emit(empty.article, true);

        vi.runAllTimers();
        expect(vi.getTimerCount()).toBe(0);

        const control = createTweet(document, '1006').article.querySelector('[data-grok-control]')!;
        empty.article.append(control);
        const button = empty.article.querySelector('button') as HTMLButtonElement;
        const click = vi.fn();
        button.click = click;
        TestMutationObserver.instances[0]!.emit([
            childListRecord(empty.article, [control]),
        ]);

        expect(click).toHaveBeenCalledOnce();
    });

    it('宿主移除帖子时清理其 timer、观察与队列，已重新接入的节点不会被误清理', () => {
        const first = createTweet(document, '1027');
        const queued = createTweet(document, '1028');
        const firstClick = vi.fn();
        const queuedClick = vi.fn();
        first.button!.click = firstClick;
        queued.button!.click = queuedClick;
        document.body.append(first.article, queued.article);
        mountXGrokAutoTranslate();
        const visibility = TestIntersectionObserver.instances[0]!;
        const mutations = TestMutationObserver.instances[0]!;
        visibility.emitMany([
            {target: first.article, isIntersecting: true},
            {target: queued.article, isIntersecting: true},
        ]);

        queued.article.remove();
        mutations.emit([childListRecord(document.body, [], [queued.article])]);
        vi.advanceTimersByTime(250);
        expect(queuedClick).not.toHaveBeenCalled();
        expect(visibility.unobserve).toHaveBeenCalledWith(queued.article);

        document.body.append(queued.article);
        mutations.emit([childListRecord(document.body, [], [queued.article])]);
        const neverTracked = createTweet(document, '1029').article;
        mutations.emit([childListRecord(document.body, [], [neverTracked])]);
        mutations.emit([childListRecord(document.body, [neverTracked])]);
    });

    it('BFCache pagehide 保留运行时与页面标记，返回后仍能处理动态帖子', () => {
        mountXGrokAutoTranslate();
        const visibility = TestIntersectionObserver.instances[0]!;
        const mutations = TestMutationObserver.instances[0]!;
        const pageHide = new window.Event('pagehide');
        Object.defineProperty(pageHide, 'persisted', {value: true});

        window.dispatchEvent(pageHide);

        expect(isXGrokAutoTranslateMounted()).toBe(true);
        expect(document.documentElement.hasAttribute(X_GROK_NATIVE_TRANSLATION_ATTRIBUTE)).toBe(true);
        expect(visibility.disconnect).not.toHaveBeenCalled();
        expect(mutations.disconnect).not.toHaveBeenCalled();

        const dynamic = createTweet(document, '1033');
        const click = vi.fn();
        dynamic.button!.click = click;
        document.body.append(dynamic.article);
        mutations.emit([childListRecord(document.body, [dynamic.article])]);
        visibility.emit(dynamic.article, true);

        expect(click).toHaveBeenCalledOnce();

        // persisted 事件不能消耗监听器；随后的真实离开仍须完成清理。
        window.dispatchEvent(new window.Event('pagehide'));
        expect(isXGrokAutoTranslateMounted()).toBe(false);
        expect(document.documentElement.hasAttribute(X_GROK_NATIVE_TRANSLATION_ATTRIBUTE)).toBe(false);
        expect(visibility.disconnect).toHaveBeenCalledOnce();
        expect(mutations.disconnect).toHaveBeenCalledOnce();
    });

    it('卸载会断开观察器、清除重试与页面标记，迟到回调不能再触发', () => {
        const first = createTweet(document, '1007');
        const queued = createTweet(document, '1008');
        const delayed = createTweet(document, '1009', {disabled: true});
        const firstClick = vi.fn();
        const queuedClick = vi.fn();
        const delayedClick = vi.fn();
        first.button!.click = firstClick;
        queued.button!.click = queuedClick;
        delayed.button!.click = delayedClick;
        document.body.append(first.article, queued.article, delayed.article);
        mountXGrokAutoTranslate();
        const visibility = TestIntersectionObserver.instances[0]!;
        const mutations = TestMutationObserver.instances[0]!;
        visibility.emitMany([
            {target: first.article, isIntersecting: true},
            {target: queued.article, isIntersecting: true},
            {target: delayed.article, isIntersecting: true},
        ]);
        expect(vi.getTimerCount()).toBeGreaterThan(0);

        window.dispatchEvent(new window.Event('pagehide'));

        expect(isXGrokAutoTranslateMounted()).toBe(false);
        expect(document.documentElement.hasAttribute(X_GROK_NATIVE_TRANSLATION_ATTRIBUTE)).toBe(false);
        expect(visibility.disconnect).toHaveBeenCalledOnce();
        expect(mutations.disconnect).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);

        const button = delayed.article.querySelector('button') as HTMLButtonElement;
        button.removeAttribute('disabled');
        button.removeAttribute('aria-disabled');
        const click = vi.fn();
        button.click = click;
        visibility.emit(delayed.article, true);
        mutations.emit([childListRecord(delayed.article, [button])]);
        vi.runAllTimers();
        expect(firstClick).toHaveBeenCalledOnce();
        expect(queuedClick).not.toHaveBeenCalled();
        expect(delayedClick).not.toHaveBeenCalled();
        expect(click).not.toHaveBeenCalled();
    });
});
