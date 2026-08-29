import {describe, expect, it, vi} from 'vitest';
import {
    installXGrokPageBridgeCore,
    installXGrokPageBridgeLifecycleCore,
    rewriteXGrokPostUrl,
    X_GROK_PAGE_BRIDGE_ACTIVATION_KEY,
    X_GROK_PAGE_BRIDGE_DISPOSE_EVENT,
    X_GROK_PAGE_BRIDGE_ENABLE_EVENT,
    X_GROK_PAGE_BRIDGE_LIFECYCLE_STATE_KEY,
    X_GROK_PAGE_BRIDGE_STATE_KEY,
    X_GROK_TRANSLATED_POST_FEATURE,
    type XGrokBridgeEventTarget,
    type XGrokBridgeMethodSlot,
    type XGrokFetchPort,
    type XGrokPageBridgeEnvironment,
    type XGrokXhrOpenPort,
} from '@/src/features/x-grok-translation/content/pageBridgeCore';

class FakeEvents implements XGrokBridgeEventTarget {
    readonly listeners = new Map<string, Set<(event?: {persisted?: boolean}) => void>>();

    addEventListener(type: string, listener: (event?: {persisted?: boolean}) => void): void {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: (event?: {persisted?: boolean}) => void): void {
        this.listeners.get(type)?.delete(listener);
    }

    emit(type: string, event?: {persisted?: boolean}): void {
        for (const listener of [...this.listeners.get(type) ?? []]) listener(event);
    }
}

function methodSlot<T extends (...args: never[]) => unknown>(initial: T) {
    let value = initial;
    let getLocked = false;
    let setMode: 'normal' | 'ignore' | 'throw' = 'normal';
    const port: XGrokBridgeMethodSlot<T> = {
        get: () => {
            if (getLocked) throw new Error('get locked');
            return value;
        },
        set: (next) => {
            if (setMode === 'throw') throw new Error('set locked');
            if (setMode === 'normal') value = next;
        },
    };
    return {
        port,
        get value() { return value; },
        set value(next: T) { value = next; },
        lockGet: () => { getLocked = true; },
        unlockGet: () => { getLocked = false; },
        setMode: (mode: 'normal' | 'ignore' | 'throw') => { setMode = mode; },
    };
}

function timelineUrl(options: {
    host?: string;
    operation?: string;
    feature?: unknown;
    protocol?: string;
} = {}): string {
    const features = {
        another_feature: true,
        [X_GROK_TRANSLATED_POST_FEATURE]: options.feature ?? false,
    };
    const url = new URL(
        `${options.protocol ?? 'https:'}//${options.host ?? 'x.com'}`
        + `/i/api/graphql/query-id/${options.operation ?? 'HomeTimeline'}`,
    );
    url.searchParams.set('variables', JSON.stringify({count: 20}));
    url.searchParams.set('features', JSON.stringify(features));
    url.searchParams.set('fieldToggles', JSON.stringify({withArticlePlainText: false}));
    return url.href;
}

function expectRewritten(value: string, baseHref: string): URL {
    const rewritten = rewriteXGrokPostUrl(value, baseHref);
    expect(rewritten).not.toBeNull();
    const url = new URL(rewritten!);
    expect(JSON.parse(url.searchParams.get('features')!)).toEqual({
        another_feature: true,
        [X_GROK_TRANSLATED_POST_FEATURE]: true,
    });
    expect(url.searchParams.get('variables')).toBe(JSON.stringify({count: 20}));
    expect(url.searchParams.get('fieldToggles')).toBe(JSON.stringify({withArticlePlainText: false}));
    return url;
}

function pageBridgeFixture() {
    let href = 'https://x.com/home';
    let replaceFailure = false;
    const stateHost: Record<string, unknown> = {};
    const pageEvents = new FakeEvents();
    const documentEvents = new FakeEvents();
    const originalFetch = vi.fn(function originalFetch(this: unknown, input: unknown, init?: unknown) {
        return {host: this, input, init};
    }) as unknown as XGrokFetchPort;
    const originalOpen = vi.fn(function originalOpen(
        this: unknown,
        method: string,
        url: unknown,
        ...rest: unknown[]
    ) {
        return {host: this, method, url, rest};
    }) as unknown as XGrokXhrOpenPort;
    const fetch = methodSlot(originalFetch);
    const xhrOpen = methodSlot(originalOpen);
    const replacements: Array<{input: unknown; nextUrl: string}> = [];
    const environment: XGrokPageBridgeEnvironment = {
        stateHost,
        fetch: fetch.port,
        xhrOpen: xhrOpen.port,
        pageEvents,
        documentEvents,
        getHref: () => href,
        replaceFetchInputUrl: (input, nextUrl) => {
            replacements.push({input, nextUrl});
            if (replaceFailure) throw new Error('replace failed');
            return {original: input, url: nextUrl};
        },
    };
    return {
        documentEvents,
        environment,
        fetch,
        originalFetch,
        originalOpen,
        pageEvents,
        replacements,
        setHref: (value: string) => { href = value; },
        setReplaceFailure: (value: boolean) => { replaceFailure = value; },
        stateHost,
        xhrOpen,
    };
}

describe('X/Grok 帖子请求 URL 改写', () => {
    it('支持 X/Twitter 裸域、子域、尾点、HTTP 与 Timeline 版本后缀', () => {
        expectRewritten(timelineUrl({host: 'api.x.com'}), 'https://x.com/home');
        expectRewritten(timelineUrl({host: 'mobile.twitter.com', operation: 'SearchTimelineV2'}), 'https://twitter.com/home');
        expectRewritten(timelineUrl({host: 'x.com.', protocol: 'http:'}), 'http://x.com./home');

        const relative = new URL(timelineUrl({operation: 'UserTweetsTimeline'}));
        expectRewritten(`${relative.pathname}${relative.search}`, 'https://subdomain.x.com/home');
        expectRewritten(
            timelineUrl({host: 'twitter.com', operation: '%48omeTimeline'}),
            'https://mobile.twitter.com/home',
        );
    });

    it('为个人主页、媒体、收藏和帖子详情请求也开启原生翻译字段', () => {
        for (const operation of [
            'UserTweets',
            'UserTweetsAndReplies',
            'UserHighlightsTweets',
            'UserMedia',
            'Likes',
            'Bookmarks',
            'TweetDetail',
            'TweetResultByRestId',
        ]) {
            expectRewritten(timelineUrl({operation}), 'https://x.com/home');
        }
    });

    it('严格拒绝非 X 来源、非 HTTP 请求和不返回帖子内容的 GraphQL 路径', () => {
        const valid = timelineUrl();
        expect(rewriteXGrokPostUrl(valid, 'https://example.com/home')).toBeNull();
        expect(rewriteXGrokPostUrl(timelineUrl({host: 'example.com'}), 'https://x.com/home')).toBeNull();
        expect(rewriteXGrokPostUrl(timelineUrl({protocol: 'ftp:'}), 'https://x.com/home')).toBeNull();
        expect(rewriteXGrokPostUrl(timelineUrl({operation: 'UserByScreenName'}), 'https://x.com/home')).toBeNull();
        expect(rewriteXGrokPostUrl(
            timelineUrl({operation: 'HomeTimeline/extra'}),
            'https://x.com/home',
        )).toBeNull();
        expect(rewriteXGrokPostUrl(
            timelineUrl({operation: '%E0%A4%A'}),
            'https://x.com/home',
        )).toBeNull();
    });

    it('只接受带目标 false 布尔值的对象 features，并安全处理非法 URL/JSON', () => {
        const base = 'https://x.com/home';
        const make = (features?: string) => {
            const url = new URL('https://x.com/i/api/graphql/id/HomeTimeline');
            if (features !== undefined) url.searchParams.set('features', features);
            return url.href;
        };

        expect(rewriteXGrokPostUrl(make(), base)).toBeNull();
        expect(rewriteXGrokPostUrl(make(''), base)).toBeNull();
        expect(rewriteXGrokPostUrl(make('{'), base)).toBeNull();
        expect(rewriteXGrokPostUrl(make('null'), base)).toBeNull();
        expect(rewriteXGrokPostUrl(make('1'), base)).toBeNull();
        expect(rewriteXGrokPostUrl(make('[]'), base)).toBeNull();
        expect(rewriteXGrokPostUrl(make('{}'), base)).toBeNull();
        expect(rewriteXGrokPostUrl(make(JSON.stringify({
            [X_GROK_TRANSLATED_POST_FEATURE]: true,
        })), base)).toBeNull();
        expect(rewriteXGrokPostUrl('http://[bad', base)).toBeNull();
        expect(rewriteXGrokPostUrl(timelineUrl(), 'http://[bad')).toBeNull();
    });
});

describe('X/Grok MAIN world 请求桥', () => {
    it('Fetch GET 只替换 URL 输入，并原样保留 this、init、结果和其他字段', () => {
        const fixture = pageBridgeFixture();
        const dispose = installXGrokPageBridgeCore(fixture.environment);
        const host = {name: 'fetch-host'};
        const init = {cache: 'no-store'};
        const input = timelineUrl();

        const result = fixture.fetch.value.call(host, input, init) as {
            host: unknown;
            input: {original: unknown; url: string};
            init: unknown;
        };

        expect(result.host).toBe(host);
        expect(result.input.original).toBe(input);
        expect(result.init).toBe(init);
        expect(new URL(result.input.url).searchParams.get('variables')).toBe(JSON.stringify({count: 20}));
        expect(JSON.parse(new URL(result.input.url).searchParams.get('features')!)[X_GROK_TRANSLATED_POST_FEATURE])
            .toBe(true);
        expect(fixture.replacements).toHaveLength(1);
        dispose();
        expect(fixture.fetch.value).toBe(fixture.originalFetch);
        expect(fixture.xhrOpen.value).toBe(fixture.originalOpen);
    });

    it('Fetch 规范化 URL-like/method，并跳过 POST、无效输入与不需改写的请求', () => {
        const fixture = pageBridgeFixture();
        installXGrokPageBridgeCore(fixture.environment);
        const valid = timelineUrl();

        fixture.fetch.value({href: valid, method: 'get'} as never);
        fixture.fetch.value({href: 1, url: valid, method: 'GET'} as never, 'invalid-init' as never);
        fixture.fetch.value({href: 1, url: 2, method: 3} as never);
        fixture.fetch.value(null);
        fixture.fetch.value(1);
        fixture.fetch.value(valid, {method: 'post'});
        fixture.fetch.value(timelineUrl({feature: true}), {method: 'GET'});

        expect(fixture.replacements).toHaveLength(2);
        expect(fixture.originalFetch).toHaveBeenCalledTimes(7);
        expect((fixture.originalFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[5]?.[0]).toBe(valid);
    });

    it('Fetch URL 替换异常时回退原输入，原 fetch 异常保持原样抛出', () => {
        const fixture = pageBridgeFixture();
        fixture.setReplaceFailure(true);
        installXGrokPageBridgeCore(fixture.environment);
        const input = timelineUrl();

        const result = fixture.fetch.value(input) as {input: unknown};
        expect(result.input).toBe(input);
        (fixture.originalFetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
            throw new Error('network failed');
        });
        expect(() => fixture.fetch.value('/home')).toThrow('network failed');
    });

    it('XHR 只改写 GET 帖子请求 URL，并保留 method、this 与其余 open 参数', () => {
        const fixture = pageBridgeFixture();
        installXGrokPageBridgeCore(fixture.environment);
        const host = {name: 'xhr-host'};
        const input = {href: timelineUrl()};

        const rewritten = fixture.xhrOpen.value.call(host, 'get', input, true, 'user', 'password') as {
            host: unknown;
            method: string;
            url: string;
            rest: unknown[];
        };
        expect(rewritten.host).toBe(host);
        expect(rewritten.method).toBe('get');
        expect(rewritten.rest).toEqual([true, 'user', 'password']);
        expect(JSON.parse(new URL(rewritten.url).searchParams.get('features')!)[X_GROK_TRANSLATED_POST_FEATURE])
            .toBe(true);

        const post = fixture.xhrOpen.value.call(host, 'POST', timelineUrl()) as {url: unknown};
        const invalid = fixture.xhrOpen.value.call(host, 'GET', {url: 1}) as {url: unknown};
        expect(post.url).toBe((fixture.originalOpen as unknown as ReturnType<typeof vi.fn>).mock.calls[1]?.[1]);
        expect(invalid.url).toEqual({url: 1});
    });

    it('重复安装先卸载旧 owner，旧 disposer 不会破坏新桥', () => {
        const fixture = pageBridgeFixture();
        fixture.stateHost[X_GROK_PAGE_BRIDGE_STATE_KEY] = {};
        const firstDispose = installXGrokPageBridgeCore(fixture.environment);
        const firstWrapper = fixture.fetch.value;
        const secondDispose = installXGrokPageBridgeCore(fixture.environment);

        expect(fixture.fetch.value).not.toBe(firstWrapper);
        firstDispose();
        expect(fixture.fetch.value).not.toBe(fixture.originalFetch);
        secondDispose();
        secondDispose();
        expect(fixture.fetch.value).toBe(fixture.originalFetch);
        expect(fixture.stateHost[X_GROK_PAGE_BRIDGE_STATE_KEY]).toBeUndefined();
    });

    it('只读、忽略写入、后来锁定与宿主替换均安全降级，遗留 wrapper 也会停用', () => {
        const fixture = pageBridgeFixture();
        fixture.fetch.setMode('throw');
        fixture.xhrOpen.setMode('ignore');
        const unavailableDispose = installXGrokPageBridgeCore(fixture.environment);
        expect(fixture.fetch.value).toBe(fixture.originalFetch);
        expect(fixture.xhrOpen.value).toBe(fixture.originalOpen);
        unavailableDispose();

        fixture.fetch.setMode('normal');
        fixture.xhrOpen.setMode('normal');
        const dispose = installXGrokPageBridgeCore(fixture.environment);
        const retainedFetchWrapper = fixture.fetch.value;
        const retainedOpenWrapper = fixture.xhrOpen.value;
        const laterFetch = vi.fn();
        fixture.fetch.value = laterFetch as unknown as XGrokFetchPort;
        fixture.xhrOpen.setMode('throw');
        expect(() => dispose()).not.toThrow();
        expect(fixture.fetch.value).toBe(laterFetch);

        retainedFetchWrapper(timelineUrl());
        retainedOpenWrapper.call({}, 'GET', timelineUrl());
        expect(fixture.replacements).toHaveLength(0);
        expect((fixture.originalFetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0])
            .toBe(timelineUrl());
        expect((fixture.originalOpen as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1])
            .toBe(timelineUrl());
    });

    it('卸载时 getter 异常被吞掉，且失去 owner 的 disposer 不碰宿主方法', () => {
        const fixture = pageBridgeFixture();
        const dispose = installXGrokPageBridgeCore(fixture.environment);
        const installedState = fixture.stateHost[X_GROK_PAGE_BRIDGE_STATE_KEY];
        fixture.stateHost[X_GROK_PAGE_BRIDGE_STATE_KEY] = {owner: Symbol('new-owner')};
        dispose();
        expect(fixture.stateHost[X_GROK_PAGE_BRIDGE_STATE_KEY]).toBeTruthy();

        fixture.stateHost[X_GROK_PAGE_BRIDGE_STATE_KEY] = installedState;
        fixture.fetch.lockGet();
        expect(() => dispose()).not.toThrow();
        fixture.fetch.unlockGet();
        expect(fixture.xhrOpen.value).toBe(fixture.originalOpen);
    });
});

describe('X/Grok MAIN world 桥生命周期', () => {
    it('默认未激活；启用、重复启用、禁用和重新启用均保持单层包装', () => {
        const fixture = pageBridgeFixture();
        const disposeLifecycle = installXGrokPageBridgeLifecycleCore(fixture.environment);
        expect(fixture.fetch.value).toBe(fixture.originalFetch);

        fixture.documentEvents.emit(X_GROK_PAGE_BRIDGE_DISPOSE_EVENT);
        fixture.documentEvents.emit(X_GROK_PAGE_BRIDGE_ENABLE_EVENT);
        const firstWrapper = fixture.fetch.value;
        expect(firstWrapper).not.toBe(fixture.originalFetch);
        expect(fixture.stateHost[X_GROK_PAGE_BRIDGE_ACTIVATION_KEY]).toBe(true);
        fixture.documentEvents.emit(X_GROK_PAGE_BRIDGE_ENABLE_EVENT);
        expect(fixture.fetch.value).toBe(firstWrapper);

        fixture.documentEvents.emit(X_GROK_PAGE_BRIDGE_DISPOSE_EVENT);
        expect(fixture.fetch.value).toBe(fixture.originalFetch);
        expect(fixture.stateHost[X_GROK_PAGE_BRIDGE_ACTIVATION_KEY]).toBe(false);
        fixture.documentEvents.emit(X_GROK_PAGE_BRIDGE_ENABLE_EVENT);
        expect(fixture.fetch.value).not.toBe(firstWrapper);

        disposeLifecycle();
        expect(fixture.fetch.value).toBe(fixture.originalFetch);
        expect(fixture.stateHost[X_GROK_PAGE_BRIDGE_ACTIVATION_KEY]).toBeUndefined();
        expect(fixture.stateHost[X_GROK_PAGE_BRIDGE_LIFECYCLE_STATE_KEY]).toBeUndefined();
        expect(fixture.documentEvents.listeners.get(X_GROK_PAGE_BRIDGE_ENABLE_EVENT)?.size).toBe(0);
        expect(fixture.pageEvents.listeners.get('pagehide')?.size).toBe(0);
    });

    it('预激活标记立即安装，BFCache 保留，普通 pagehide 完整释放', () => {
        const fixture = pageBridgeFixture();
        fixture.stateHost[X_GROK_PAGE_BRIDGE_ACTIVATION_KEY] = true;
        const dispose = installXGrokPageBridgeLifecycleCore(fixture.environment);
        const wrapper = fixture.fetch.value;
        expect(wrapper).not.toBe(fixture.originalFetch);

        fixture.pageEvents.emit('pagehide', {persisted: true});
        expect(fixture.fetch.value).toBe(wrapper);
        fixture.pageEvents.emit('pagehide', {persisted: false});
        expect(fixture.fetch.value).toBe(fixture.originalFetch);
        expect(fixture.stateHost[X_GROK_PAGE_BRIDGE_LIFECYCLE_STATE_KEY]).toBeUndefined();
        dispose();
    });

    it('无 pagehide 事件对象按普通卸载处理', () => {
        const fixture = pageBridgeFixture();
        installXGrokPageBridgeLifecycleCore(fixture.environment);
        fixture.pageEvents.emit('pagehide');
        expect(fixture.stateHost[X_GROK_PAGE_BRIDGE_LIFECYCLE_STATE_KEY]).toBeUndefined();
    });

    it('重复生命周期安装先释放旧 owner，旧 disposer 与伪 owner 都不能清理当前桥', () => {
        const fixture = pageBridgeFixture();
        fixture.stateHost[X_GROK_PAGE_BRIDGE_LIFECYCLE_STATE_KEY] = {};
        const firstDispose = installXGrokPageBridgeLifecycleCore(fixture.environment);
        fixture.documentEvents.emit(X_GROK_PAGE_BRIDGE_ENABLE_EVENT);
        const secondDispose = installXGrokPageBridgeLifecycleCore(fixture.environment);
        fixture.documentEvents.emit(X_GROK_PAGE_BRIDGE_ENABLE_EVENT);
        const currentWrapper = fixture.fetch.value;

        firstDispose();
        expect(fixture.fetch.value).toBe(currentWrapper);
        const currentState = fixture.stateHost[X_GROK_PAGE_BRIDGE_LIFECYCLE_STATE_KEY];
        fixture.stateHost[X_GROK_PAGE_BRIDGE_LIFECYCLE_STATE_KEY] = {owner: Symbol('foreign')};
        secondDispose();
        expect(fixture.fetch.value).toBe(currentWrapper);

        fixture.stateHost[X_GROK_PAGE_BRIDGE_LIFECYCLE_STATE_KEY] = currentState;
        secondDispose();
        expect(fixture.fetch.value).toBe(fixture.originalFetch);
    });

    it('旧生命周期 owner 的 dispose 会先执行，并保留预先声明的激活意图', () => {
        const fixture = pageBridgeFixture();
        const oldDispose = vi.fn(() => {
            fixture.stateHost[X_GROK_PAGE_BRIDGE_ACTIVATION_KEY] = true;
        });
        fixture.stateHost[X_GROK_PAGE_BRIDGE_LIFECYCLE_STATE_KEY] = {dispose: oldDispose};

        const dispose = installXGrokPageBridgeLifecycleCore(fixture.environment);
        expect(oldDispose).toHaveBeenCalledOnce();
        expect(fixture.fetch.value).not.toBe(fixture.originalFetch);
        dispose();
    });
});
