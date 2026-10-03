import {afterEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {createMangaSession, type MangaSnapshot} from '@/src/features/image-translation/content/mangaSession';
import {createMangaReader, mangaReaderSelector} from '@/src/features/image-translation/content/mangaReader';
import {normalizeConfig} from '@/src/core/config/model';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => {resolve = yes;}); return {promise, resolve}; }
function sessionFixture() {
    const one = {} as HTMLImageElement, two = {} as HTMLImageElement;
    const ports = {translate: vi.fn().mockResolvedValue(undefined), restore: vi.fn(), release: vi.fn(), failed: vi.fn().mockReturnValue(false), changed: vi.fn()};
    const session = createMangaSession(ports);
    const snapshot: MangaSnapshot = {route: 'chapter-1', available: true, pages: [
        {image: one, identity: '1', visible: true}, {image: two, identity: '2', visible: false},
    ]};
    session.refresh(snapshot);
    const start = () => {session.toggle(); session.refresh(snapshot);};
    return {session, ports, one, two, snapshot, start};
}
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});

describe('漫画会话所有权与可见页调度', () => {
    it('旧配置启用入口但保留图片总开关和用户明确关闭的入口', () => {
        expect(normalizeConfig({}).imageTranslationMangaEnabled).toBe(true);
        expect(normalizeConfig({}).disableImageTranslator).toBe(true);
        expect(normalizeConfig({imageTranslationMangaEnabled: false}).imageTranslationMangaEnabled).toBe(false);
        expect(normalizeConfig({imageTranslationMangaEnabled: 'false'} as never).imageTranslationMangaEnabled).toBe(true);
    });
    it('只有开启后的可见页面会翻译，滚动继续且同一页不会重复入队', async () => {
        const f = sessionFixture(); await flush(); expect(f.ports.translate).not.toHaveBeenCalled();
        f.start(); expect(f.session.status().pending).toBe(true);expect(f.session.status().completed).toBe(0); await flush();
        expect(f.ports.translate.mock.calls.map(c => c[0])).toEqual([f.one]);
        f.session.refresh(f.snapshot); await flush(); expect(f.ports.translate).toHaveBeenCalledTimes(1);
        f.snapshot.pages[0].visible = false; f.snapshot.pages[1].visible = true;
        f.session.refresh(f.snapshot); await flush();
        expect(f.ports.release).toHaveBeenCalledWith(f.one);
        expect(f.ports.translate.mock.calls.map(c => c[0])).toEqual([f.one, f.two]);
    });
    it('两个可见页面严格串行，原图暂停后重开可继续', async () => {
        const f = sessionFixture(), pending = deferred();
        f.ports.translate.mockReturnValueOnce(pending.promise);
        f.snapshot.pages[1].visible = true; f.start(); await flush();
        expect(f.ports.translate).toHaveBeenCalledTimes(1);
        f.session.toggle(); expect(f.session.status().active).toBe(false);
        expect(f.ports.restore).toHaveBeenCalledTimes(2);
        f.session.refresh(f.snapshot); await flush(); expect(f.ports.translate).toHaveBeenCalledTimes(1);
        f.session.toggle(); f.session.refresh(f.snapshot); await flush();
        expect(f.ports.translate).toHaveBeenCalledTimes(1);
        pending.resolve(); await flush(); expect(f.ports.translate).toHaveBeenCalledTimes(3);
        expect(f.session.status()).toEqual({available: true, active: true, pending: false, errors: 0, completed: 2});
    });
    it('尚未执行的旧任务取消后不会发送请求', async () => {
        const f = sessionFixture(); f.start(); f.session.toggle(); await flush();
        expect(f.ports.translate).not.toHaveBeenCalled();
    });
    it('资源替换立即释放旧结果，迟到结果不能归属新页面', async () => {
        const f = sessionFixture(), pending = deferred(); f.ports.translate.mockReturnValueOnce(pending.promise);
        f.start(); await flush(); f.snapshot.pages[0].identity = 'new-source'; f.session.refresh(f.snapshot);
        expect(f.ports.release).toHaveBeenCalledWith(f.one);
        pending.resolve(); await flush(); expect(f.ports.translate).toHaveBeenCalledTimes(2);
    });
    it('换章与关闭功能停止会话，失败页不会自动无限重试', async () => {
        const f = sessionFixture(); f.ports.translate.mockRejectedValueOnce(new Error('network')); f.start(); await flush();
        expect(f.session.status().errors).toBe(1);
        f.session.refresh(f.snapshot); await flush(); expect(f.ports.translate).toHaveBeenCalledTimes(1);
        f.session.toggle(); f.session.toggle(); f.session.refresh(f.snapshot); await flush();
        expect(f.ports.translate).toHaveBeenCalledTimes(2); expect(f.session.status().errors).toBe(0);
        f.snapshot.route = 'chapter-2'; f.session.refresh(f.snapshot);
        expect(f.session.status().active).toBe(false);
        f.start(); await flush(); f.snapshot.available = false; f.session.refresh(f.snapshot);
        expect(f.session.toggle()).toBe(false); expect(f.session.status().active).toBe(false);
    });
    it('翻译端口报告错误与卸载后迟到拒绝均被安全消费', async () => {
        const f = sessionFixture(); f.ports.failed.mockReturnValue(true); f.start(); await flush();
        expect(f.session.status().errors).toBe(1);
        const pending = deferred(); f.session.toggle(); f.ports.translate.mockReturnValueOnce(pending.promise);
        f.session.toggle(); f.session.refresh(f.snapshot); await flush();
        f.session.dispose(); pending.resolve(); await flush();
        expect(f.session.toggle()).toBe(false); f.session.refresh(f.snapshot);
        expect(f.session.status()).toEqual({available: false, active: false, pending: false, errors: 0, completed: 0});
    });
    it('页面移除后的拒绝不会计入当前会话', async () => {
        const f = sessionFixture(); let reject!: (error: Error) => void;
        f.ports.translate.mockReturnValueOnce(new Promise<void>((_, no) => {reject = no;}));
        f.start(); await flush(); f.snapshot.pages = []; f.session.refresh(f.snapshot);
        reject(new Error('cancelled')); await flush(); expect(f.session.status().errors).toBe(0);
    });
});

function readerFixture(withIntersection = true, initialUrl = 'https://mangaplus.shueisha.co.jp/viewer/1024050', siteRules?: () => import('@/src/core/config/manga').MangaSiteRule[]) {
    const {document, window: dom} = parseHTML('<html><body><div class="zao-image-container"><img class="zao-image" src="blob:page-1"></div><img id="logo" src="https://site/logo.png"></body></html>');
    const image = document.querySelector('img')! as HTMLImageElement;
    Object.defineProperties(image, {complete: {writable: true, value: true}, naturalWidth: {writable: true, value: 800}, naturalHeight: {value: 1200}, currentSrc: {get: () => image.src}});
    let bounds = {left: 0, top: 0, right: 800, bottom: 1200, width: 800, height: 1200};
    image.getBoundingClientRect = () => bounds as DOMRect;
    let style = {visibility: 'visible', display: 'block'};
    let hidden = false; Object.defineProperty(document, 'hidden', {get: () => hidden});
    const events = new Map<string, () => void>(), frames = new Map<number, FrameRequestCallback>(); let id = 0;
    const window = {location: {href: initialUrl}, innerWidth: 1280, innerHeight: 900,
        addEventListener: vi.fn((event, callback) => events.set(event, callback)), removeEventListener: vi.fn(),
        requestAnimationFrame: vi.fn(callback => {frames.set(++id, callback); return id;}), cancelAnimationFrame: vi.fn(i => frames.delete(i))};
    const io = {observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(), callback: null as unknown as IntersectionObserverCallback};
    const mo = {observe: vi.fn(), disconnect: vi.fn(), callback: null as unknown as MutationCallback};
    vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('Element', dom.Element);
    vi.stubGlobal('getComputedStyle', () => style);
    vi.stubGlobal('IntersectionObserver', withIntersection ? class {observe = io.observe; unobserve = io.unobserve; disconnect = io.disconnect;
        constructor(callback: IntersectionObserverCallback) {io.callback = callback;} } : undefined);
    vi.stubGlobal('MutationObserver', class {observe = mo.observe; disconnect = mo.disconnect;
        constructor(callback: MutationCallback) {mo.callback = callback;} });
    const ports = {enabled: vi.fn().mockReturnValue(true), identity: (i: HTMLImageElement) => i.src,
        translate: vi.fn().mockResolvedValue(undefined), restore: vi.fn(), release: vi.fn(), failed: vi.fn().mockReturnValue(false), changed: vi.fn()};
    const reader = createMangaReader({...ports, siteRules});
    const run = () => {const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(c => c(0));};
    const intersect = (yes: boolean) => {io.callback([{target: image, isIntersecting: yes} as unknown as IntersectionObserverEntry], {} as IntersectionObserver); run();};
    return {reader, ports, image, io, mo, window, dom, document, run, intersect,
        setRect: (v: Partial<typeof bounds>) => Object.assign(bounds, v), setStyle: (v: Partial<typeof style>) => Object.assign(style, v),
        setHidden: (v: boolean) => {hidden = v;}};
}
describe('漫画站点适配与 DOM 生命周期', () => {
    it('自定义选择器只识别图片，损坏的选择器不中断页面，规则修改后重新扫描', async () => {
        const rules = [{hostname:'example.com',pathPrefix:'/reader/',selector:'.zao-image-container, .zao-image-container img'}];
        const f = readerFixture(false, 'https://example.com/reader/1', () => rules);
        expect(f.ports.changed).toHaveBeenLastCalledWith(expect.objectContaining({available:true,pageCount:1}));
        f.reader.toggle();await flush();expect(f.ports.translate).toHaveBeenCalledWith(f.image);
        rules[0].selector = '[';f.reader.schedule();f.run();expect(f.io.unobserve).not.toHaveBeenCalled();
        expect(f.ports.changed).toHaveBeenLastCalledWith(expect.objectContaining({pageCount:0}));
        rules[0].selector = '.zao-image';f.reader.schedule();f.run();await flush();expect(f.ports.translate).toHaveBeenCalledTimes(2);f.ports.enabled.mockReturnValue(false);f.reader.schedule();f.run();f.reader.schedule();f.run();f.reader.dispose();
    });
    it.each(['https://mangaplus.shueisha.co.jp/viewer/1024050', 'https://mangaplus.shueisha.co.jp/viewer/123/'])('精确识别阅读器 %s', href => {
        expect(mangaReaderSelector(href)).toBe('.zao-image-container img.zao-image');
    });
    it.each(['not a url', 'http://mangaplus.shueisha.co.jp/viewer/123', 'https://mangaplus.shueisha.co.jp/updates', 'https://mangaplus.shueisha.co.jp.attacker.test/viewer/123'])('拒绝首页和相似域名 %s', href => {
        expect(mangaReaderSelector(href)).toBeNull();
    });
    it('观察可见正文、不处理 logo，关闭后释放观察器与事件', async () => {
        const f = readerFixture(); expect(f.io.observe).toHaveBeenCalledWith(f.image);
        f.reader.toggle(); await flush(); expect(f.ports.translate).not.toHaveBeenCalled();
        f.intersect(true); await flush(); expect(f.ports.translate).toHaveBeenCalledWith(f.image);
        f.intersect(false); expect(f.ports.release).toHaveBeenCalledWith(f.image);
        f.intersect(true); await flush(); expect(f.ports.translate).toHaveBeenCalledTimes(2);
        f.reader.schedule(); f.reader.schedule(); f.reader.dispose(); f.run(); f.reader.schedule();
        expect(f.window.cancelAnimationFrame).toHaveBeenCalled(); expect(f.io.disconnect).toHaveBeenCalled();
        expect(f.mo.disconnect).toHaveBeenCalled(); expect(f.window.removeEventListener).toHaveBeenCalledTimes(2);
        expect(f.reader.toggle()).toBe(false);
    });
    it('Mutation、load、配置和路由变化合并到一帧，UI 内变更不再触发扫描', async () => {
        const f = readerFixture(); f.intersect(true); f.reader.toggle(); await flush();
        const host = f.document.createElement('div'); host.setAttribute('data-fluent-read-ui', 'fixture');
        const before = f.window.requestAnimationFrame.mock.calls.length;
        f.mo.callback([{target: host} as unknown as MutationRecord], {} as MutationObserver);
        expect(f.window.requestAnimationFrame).toHaveBeenCalledTimes(before);
        f.mo.callback([{target: f.image} as unknown as MutationRecord], {} as MutationObserver);
        f.document.dispatchEvent(new f.dom.Event('load')); f.reader.schedule(); f.run();
        expect(f.window.requestAnimationFrame).toHaveBeenCalledTimes(before + 1);
        f.image.remove(); f.reader.schedule(); f.run(); expect(f.io.unobserve).toHaveBeenCalledWith(f.image);
        f.window.location.href = 'https://mangaplus.shueisha.co.jp/viewer/555';
        f.document.dispatchEvent(new f.dom.Event('fluentread-route-change')); f.run();
        expect(f.reader.status().active).toBe(false);
        f.ports.enabled.mockReturnValue(false); f.reader.schedule(); f.run(); expect(f.reader.status().available).toBe(false);
        f.reader.dispose();
    });
    it('没有 IntersectionObserver 时按视口处理；隐藏、未加载和不可见页面不进入队列', async () => {
        const f = readerFixture(false); f.reader.toggle(); await flush(); expect(f.ports.translate).toHaveBeenCalledTimes(1);
        const cases = [
            () => {f.setHidden(true);}, () => {Object.defineProperty(f.image, 'complete', {value: false});}, () => {Object.defineProperty(f.image, 'naturalWidth', {value: 0});},
            () => {f.setRect({width: 1});}, () => {f.setRect({bottom: 0});}, () => {f.setRect({right: 0});},
            () => {f.setRect({top: 1000});}, () => {f.setRect({left: 2000});},
            () => {f.setStyle({visibility: 'hidden'});}, () => {f.setStyle({visibility: 'collapse'});}, () => {f.setStyle({display: 'none'});},
        ];
        for (const change of cases) {
            f.setHidden(false); Object.defineProperties(f.image, {complete: {value: true}, naturalWidth: {value: 800}});
            f.setRect({left: 0, top: 0, right: 800, bottom: 1200, width: 800}); f.setStyle({visibility: 'visible', display: 'block'});
            change(); f.reader.schedule(); f.run(); await flush();
            expect(f.ports.translate).toHaveBeenCalledTimes(1);
        }
        f.reader.dispose();
    });
    it('扩展自有图片被过滤；非阅读器没有 DOM 观察器，进入阅读器后才挂载', () => {
        const f = readerFixture(false, 'https://example.com'); expect(f.mo.observe).not.toHaveBeenCalled();
        f.reader.schedule(); f.run(); expect(f.window.requestAnimationFrame).not.toHaveBeenCalled();
        Object.assign(f.window, {location: undefined}); f.reader.schedule(); f.run();
        Object.assign(f.window, {location: {href: 'https://example.com'}});
        f.window.location.href = 'https://mangaplus.shueisha.co.jp/viewer/123';
        f.image.parentElement!.setAttribute('data-fluent-read-ui', 'fake'); f.reader.schedule(); f.run();
        expect(f.reader.status().available).toBe(true); expect(f.io.observe).not.toHaveBeenCalled();
        f.reader.dispose();
    });
    it('无页面地址的测试环境安全回退且忽略非元素 mutation', () => {
        const f = readerFixture(false); (f.window as {location?: unknown}).location = undefined;
        f.mo.callback([{target: f.document} as unknown as MutationRecord], {} as MutationObserver); f.run();
        expect(f.reader.status().available).toBe(false); f.reader.dispose();
    });
});
