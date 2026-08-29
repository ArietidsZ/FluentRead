import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';

import {X_GROK_NATIVE_TRANSLATION_ATTRIBUTE} from '@/src/core/translation/public';
import {
    isXGrokAutoTranslatePage,
    isXGrokAutoTranslateMounted,
    mountXGrokAutoTranslate,
    unmountXGrokAutoTranslate,
} from '@/src/features/x-grok-translation/public';

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
    return document;
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
        expect(click).not.toHaveBeenCalled();

        visibility.emit(article, true);
        expect(click).toHaveBeenCalledOnce();
        visibility.emit(document.body, true);
        visibility.emit(document.createElement('article'), true);
        visibility.emit(document.createTextNode('not an element') as unknown as Element, true);
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

    it('非 X/Twitter 域名不挂载观察器，也不留下全文翻译互斥标记', () => {
        unmountXGrokAutoTranslate();
        installDom('example.com');

        mountXGrokAutoTranslate();

        expect(isXGrokAutoTranslateMounted()).toBe(false);
        expect(TestIntersectionObserver.instances).toHaveLength(0);
        expect(TestMutationObserver.instances).toHaveLength(0);
        expect(document.documentElement.hasAttribute(X_GROK_NATIVE_TRANSLATION_ATTRIBUTE)).toBe(false);
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
