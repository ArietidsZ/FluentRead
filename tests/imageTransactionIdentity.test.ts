import {afterEach, describe, expect, it, vi} from 'vitest';
import {createImageGlossaryContext} from '@/src/app/background/imageGlossaryContext';
import {createAreaTranslationBackgroundHandlers, AREA_TRANSLATE_CAPTURE_MESSAGE_TYPE} from '@/src/features/area-translation/background/handlers';
import {createImageSourceVerifier, imageTranslationProgressTransport, imageTranslationOffscreenAdapter} from '@/src/features/image-translation/background/offscreenAdapter';
import {getTranslationProviderConfig, createTranslationProviderConfigSnapshot, getTranslationRequestControl} from '@/src/services/translation/requestSnapshot';
import {Config} from '@/src/core/config/model';
import {createImageTranslationBackgroundHandlers, IMAGE_TRANSLATE_MESSAGE_TYPE, IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE, IMAGE_CANCEL_MESSAGE_TYPE, createImageOperationRegistry} from '@/src/features/image-translation/background/handlers';

const owner = (tabId: number, documentId = 'document-a') => ({sender: {id: 'extension', tab: {id: tabId}, frameId: 0, documentId, url: 'https://example.test/page'}});
const deferred = () => {
    let resolve!: (value: string) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<string>((done, fail) => {resolve = done; reject = fail;});
    return {promise, resolve, reject};
};
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();});

describe('图片区域事务身份回归', () => {
    it('不同标签页可并发使用相同公开请求ID', async () => {
        const registry = createImageOperationRegistry();
        const a = deferred(); const b = deferred();
        const first = registry.run({requestId: 'shared'}, () => a.promise, owner(1));
        const second = registry.run({requestId: 'shared'}, () => b.promise, owner(2));
        const settled = Promise.allSettled([first, second]);
        a.resolve('a'); b.resolve('b');
        expect(await settled).toEqual([{status: 'fulfilled', value: 'a'}, {status: 'fulfilled', value: 'b'}]);
    });

    it('同标签页的新文档无权取消旧文档的公开请求', async () => {
        const registry = createImageOperationRegistry(); const work = deferred();
        const first = registry.run({requestId: 'shared'}, () => work.promise, owner(1, 'document-a'));
        const settled = Promise.allSettled([first]);
        await Promise.resolve();
        const cancel = registry.cancel('shared', owner(1, 'document-b'));
        work.resolve('a');
        expect(cancel.cancelled).toBe(false);
        expect(await settled).toEqual([{status: 'fulfilled', value: 'a'}]);
    });

    it('预取消消费后重加在有界淘汰中仍保留新的标记', async () => {
        const registry = createImageOperationRegistry();
        registry.cancel('repeat', owner(1));
        await expect(registry.run({requestId: 'repeat'}, async () => 'unexpected', owner(1))).rejects.toThrow('取消');
        registry.cancel('repeat', owner(1));
        for (let i = 0; i < 511; i += 1) registry.cancel(`other-${i}`, owner(1));
        const operation = vi.fn(async () => 'unexpected');
        const result = await registry.run({requestId: 'repeat'}, operation, owner(1)).then(value => ({value}), error => ({error: error.message}));
        expect(result).toEqual({error: '图片 OCR 请求已取消'});
        expect(operation).not.toHaveBeenCalled();
    });

    it('负控制：同一归属的并发公开ID仍拒绝，原归属取消仍生效', async () => {
        const registry = createImageOperationRegistry(); const work = deferred();
        const first = registry.run({requestId: 'shared'}, () => work.promise, owner(1));
        const settled = Promise.allSettled([first]);
        await expect(registry.run({requestId: 'shared'}, async () => 'duplicate', owner(1))).rejects.toThrow('正在执行');
        expect(registry.cancel('shared', owner(1)).cancelled).toBe(true);
        work.resolve('a');
        expect((await settled)[0]).toMatchObject({status: 'rejected', reason: {name: 'AbortError'}});
    });
});

for (const privateFirst of [false, true]) {
    describe(`真实图片调用链 ID复用 privateFirst=${privateFirst}`, () => {
        it('A超时后B复用公开ID，A的旧文字进度取消均不能进入B', async () => {
            vi.useFakeTimers();
            const registry = createImageOperationRegistry('image-area', context => context.sender?.url === 'chrome-extension://extension/offscreen.html');
            const config = new Config();
            const a = deferred(); const b = deferred();
            const internalIds: string[] = []; const signals: AbortSignal[] = [];
            const translateTexts = vi.fn(async () => ['translated']);
            const sendProgress = vi.fn(async () => {});
            const offscreen = {sender: {url: 'chrome-extension://extension/offscreen.html'}};
            const raw = createImageTranslationBackgroundHandlers({
                operationRegistry: registry, getTranslationService: () => config.service, getGlossaryConfig: () => config,
                assertLanguagesDownloaded: async () => {}, downloadLanguages: async () => {}, markLanguagesDownloaded: async () => [],
                supportsBatchTranslation: () => true, translateTexts, fetchImage: async () => 'data:image/png;base64,x',
                isOffscreenSender: context => context.sender?.url === offscreen.sender.url, sendProgress,
                translateImage: async (_image, _language, _title, options) => {
                    internalIds.push(options.requestId); signals.push(options.signal);
                    await (internalIds.length === 1 ? a.promise : b.promise);
                    return {image: 'data:image/png;base64,x', lines: []};
                },
            });
            const wrapped = createImageGlossaryContext({
                ready: Promise.resolve(), operationRegistry: registry, offscreenUrl: offscreen.sender.url,
                getConfig: () => config, getSourceLanguage: () => config.from, getGlossaryRevision: () => 'revision',
            }).wrap(raw);
            const call = (type: string, fields: object, context: object) => Promise.resolve(wrapped.find(handler => handler.type === type)!.handle({type, ...fields}, context));
            const firstOwner = {sender: {...owner(1).sender, tab: {id: 1, incognito: privateFirst}}};
            const secondOwner = {sender: {...owner(2).sender, tab: {id: 2, incognito: !privateFirst}}};
            const first = call(IMAGE_TRANSLATE_MESSAGE_TYPE, {requestId: 'shared', image: 'data:image/png;base64,x', sourceLanguage: 'en', timeoutMs: 50}, firstOwner);
            const firstSettled = first.catch(error => error);
            await vi.advanceTimersByTimeAsync(50);
            await firstSettled;
            const second = call(IMAGE_TRANSLATE_MESSAGE_TYPE, {requestId: 'shared', image: 'data:image/png;base64,x', sourceLanguage: 'en', timeoutMs: 500}, secondOwner);
            const secondSettled = second.catch(error => error);
            await vi.advanceTimersByTimeAsync(0);
            const oldId = internalIds[0];
            const staleText = await call(IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE, {requestId: oldId, texts: ['hello']}, offscreen).catch(error => error);
            await call('fluentReadImageProgress', {requestId: oldId, stage: 'translating'}, offscreen).catch(error => error);
            await call(IMAGE_CANCEL_MESSAGE_TYPE, {requestId: oldId}, offscreen).catch(error => error);
            const bAborted = signals[1].aborted;
            a.resolve('a'); b.resolve('b');
            await Promise.allSettled([firstSettled, secondSettled]);
            expect(staleText).toBeInstanceOf(Error);
            expect(translateTexts).not.toHaveBeenCalled();
            expect(sendProgress).not.toHaveBeenCalled();
            expect(bAborted).toBe(false);
            expect(internalIds[0]).not.toBe(internalIds[1]);
        });
    });
}

const OFFSCREEN_URL = 'chrome-extension://extension/offscreen.html';
const offscreenOwner = {sender: {id: 'extension', url: OFFSCREEN_URL}};
function transactionFixture() {
    const config = Object.assign(new Config(), {service: 'openai', imageTranslationService: 'openai', from: 'en', to: 'zh-Hans'});
    const registry = createImageOperationRegistry('image-area', context => context.sender?.id === 'extension' && context.sender.url === OFFSCREEN_URL);
    const works: ReturnType<typeof deferred>[] = [];
    const options: any[] = [];
    const translateTexts = vi.fn(async (request: any) => Array.isArray(request.origin) ? request.origin.map(() => 'translated') : 'translated');
    const sendProgress = vi.fn(async () => {});
    const supportsBatchTranslation = vi.fn(() => true);
    const capture = async (_image: string, _language: string, _title: string, option: any) => {
        const work = deferred(); works.push(work); options.push(option);
        await work.promise;
        return {image: 'data:image/png,x', lines: []};
    };
    const raw = createImageTranslationBackgroundHandlers({operationRegistry: registry,
        getTranslationService: () => config.imageTranslationService || config.service, getGlossaryConfig: () => config,
        assertLanguagesDownloaded: async () => {}, downloadLanguages: async () => {}, markLanguagesDownloaded: async () => [],
        supportsBatchTranslation, translateTexts, fetchImage: async () => 'data:image/png,x',
        translateImage: capture, isOffscreenSender: context => context.sender?.url === OFFSCREEN_URL, sendProgress});
    const reads = vi.fn(() => config);
    const wrapper = createImageGlossaryContext({ready: Promise.resolve(), operationRegistry: registry, getConfig: reads,
        offscreenUrl: OFFSCREEN_URL, getSourceLanguage: () => config.from, getGlossaryRevision: () => 'fallback'});
    const handlers = wrapper.wrap(raw);
    const call = (type: string, fields: object, context: any = owner(1)) => Promise.resolve(handlers.find(h => h.type === type)!.handle({type, ...fields} as any, context));
    const start = (requestId = 'shared', context: any = owner(1), timeoutMs = 1000) => call(IMAGE_TRANSLATE_MESSAGE_TYPE,
        {requestId, image: 'data:image/png,x', sourceLanguage: 'en', timeoutMs}, context);
    const enter = async () => {for (let i = 0; i < 12; i += 1) await Promise.resolve();};
    const cleanup = async (...pending: Promise<unknown>[]) => {for (const work of works) work.resolve('done'); await Promise.allSettled(pending);};
    return {config, registry, works, options, translateTexts, sendProgress, supportsBatchTranslation, reads, wrapper, call, start, enter, cleanup};
}

describe('事务恢复与绝对预算', () => {
    it('同标签页不同document并发隔离，冻结进度归属并回传公开ID', async () => {
        const h = transactionFixture(); const original = owner(1, 'a');
        const a = h.start('same', original); const b = h.start('same', owner(1, 'b'));
        const settled = Promise.allSettled([a, b]); await h.enter();
        original.sender.documentId = 'mutated'; original.sender.tab.id = 9;
        await h.call('fluentReadImageProgress', {requestId: h.options[0].requestId, stage: 'recognizing', progress: 42}, offscreenOwner);
        expect(h.sendProgress).toHaveBeenCalledWith(expect.objectContaining({sender: expect.objectContaining({documentId: 'a', tab: {id: 1}})}),
            {type: 'fluentReadImageProgress', requestId: 'same', stage: 'recognizing', progress: 42});
        expect(Object.isFrozen(h.registry.restore(h.options[0].requestId, offscreenOwner))).toBe(true);
        await h.cleanup(settled);
    });

    it('OCR期间设置变更不改模型词表快照，嵌套文字沿用父signal与剩余预算', async () => {
        vi.useFakeTimers(); const h = transactionFixture();
        h.config.model.openai = 'initial-model';
        const a = h.start('frozen', owner(1), 100); const settled = Promise.allSettled([a]); await h.enter();
        await vi.advanceTimersByTimeAsync(30);
        h.config.imageTranslationService = 'google'; h.config.model.openai = 'changed-model'; h.config.to = 'fr';
        await h.call(IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE, {requestId: h.options[0].requestId, texts: ['hello'], timeoutMs: 300000}, offscreenOwner);
        const request = h.translateTexts.mock.calls[0][0];
        expect(request).toMatchObject({serviceOverride: 'openai', requestTimeoutMs: 70});
        const snapshot = getTranslationProviderConfig(request, createTranslationProviderConfigSnapshot(h.config));
        expect(snapshot.model.openai).toBe('initial-model'); expect(snapshot.to).toBe('zh-Hans');
        expect(getTranslationRequestControl(request)?.signal).toBe(h.options[0].signal);
        expect(h.reads).toHaveBeenCalledOnce();
        await h.cleanup(settled);
    });

    it('时钟超过父deadline但timer尚未运行时恢复即撤销，供应商零调用', async () => {
        vi.useFakeTimers(); const h = transactionFixture(); const a = h.start('expired', owner(1), 100);
        const settled = Promise.allSettled([a]); await h.enter(); vi.setSystemTime(Date.now() + 101);
        await expect(h.call(IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE, {requestId: h.options[0].requestId, texts: ['hello']}, offscreenOwner)).rejects.toMatchObject({name: 'TimeoutError'});
        expect(h.translateTexts).not.toHaveBeenCalled();
        expect(() => h.registry.restore(h.options[0].requestId, offscreenOwner)).toThrow('上下文已失效');
        await h.cleanup(settled);
    });

    it('旧finalizer完成不删除原归属新事务，未知旧事务取消不建立公开预取消', async () => {
        vi.useFakeTimers(); const h = transactionFixture(); const a = h.start('same', owner(1), 10);
        const firstSettled = Promise.allSettled([a]); await h.enter(); const old = h.options[0].requestId;
        await vi.advanceTimersByTimeAsync(10); await firstSettled;
        const b = h.start('same', owner(1), 100); const secondSettled = Promise.allSettled([b]); await h.enter();
        h.works[0].resolve('late'); await h.enter();
        expect(h.registry.restore(h.options[1].requestId, offscreenOwner).callerRequestId).toBe('same');
        expect(h.registry.cancel(old, offscreenOwner).cancelled).toBe(false);
        expect(h.options[1].signal.aborted).toBe(false);
        await h.cleanup(secondSettled);
        expect(() => h.registry.restore(h.options[1].requestId, offscreenOwner)).toThrow('上下文已失效');
    });

    it('只允许验证的无tab离屏发送者恢复；标签页移除立即撤销自己的事务', async () => {
        const h = transactionFixture(); const a = h.start('a', owner(1)); const b = h.start('b', owner(2));
        const settled = Promise.allSettled([a, b]); await h.enter(); const id = h.options[0].requestId;
        for (const context of [owner(1), {sender: {...offscreenOwner.sender, tab: {id: 1}}}, {sender: {...offscreenOwner.sender, id: 'another'}}])
            expect(() => h.registry.restore(id, context)).toThrow('未授权');
        h.registry.releaseTab(1);
        expect(() => h.registry.restore(id, offscreenOwner)).toThrow('上下文已失效');
        expect(h.options[0].signal.aborted).toBe(true); expect(h.options[1].signal.aborted).toBe(false);
        await h.cleanup(settled);
    });

    it('预取消仅属于原标签页文档，消费后可以重新启动并正常取消', async () => {
        const registry = createImageOperationRegistry(); registry.cancel('same', owner(1, 'a'));
        await expect(registry.run({requestId: 'same'}, async () => 'other-tab', owner(2))).resolves.toBe('other-tab');
        await expect(registry.run({requestId: 'same'}, async () => 'other-document', owner(1, 'b'))).resolves.toBe('other-document');
        await expect(registry.run({requestId: 'same'}, async () => 'unexpected', owner(1, 'a'))).rejects.toThrow('取消');
        await expect(registry.run({requestId: 'same'}, async () => 'consumed', owner(1, 'a'))).resolves.toBe('consumed');
    });

    it('远程图片来源回查使用原公开ID与原document，离屏仍使用内部ID', async () => {
        const send = vi.fn(async () => ({valid: true})); const verifier = createImageSourceVerifier(send);
        const registry = createImageOperationRegistry();
        await registry.run({requestId: 'public-auth'}, async options => {
            expect(options.requestId).not.toBe('public-auth');
            await verifier('https://cdn.example/image.png', options, owner(1, 'auth-doc'));
            return 'done';
        }, owner(1, 'auth-doc'));
        expect(send).toHaveBeenCalledWith(1, expect.objectContaining({requestId: 'public-auth'}), {frameId: 0, documentId: 'auth-doc'});
    });

    it('区域路由视觉与文字准备接收同一配置快照，移除标签页撤销区域恢复权限', async () => {
        const h = transactionFixture(); const received: unknown[] = []; const work = deferred(); let areaOptions: any;
        const [, area] = createAreaTranslationBackgroundHandlers({operationRegistry: h.registry,
            captureVisibleTab: async () => '', getDefaultSourceLanguage: () => 'en', assertLanguagesDownloaded: async () => {},
            getVisionRoute: config => {received.push(config); return {mode: 'ocr'};},
            prepareVisionRoute: config => {received.push(config); return async () => ({mode: 'ocr'});},
            prepareVisionTranslation: (_l, _t, _c, config) => {received.push(config); return async () => ({image: '', lines: []});},
            prepareTextTranslation: (_l, _t, _c, config) => {received.push(config); h.config.service = 'google'; return async value => value;},
            translateArea: async (_i, _l, _t, _s, options) => {areaOptions = options; await work.promise; return {image: '', lines: []};}});
        const handler = h.wrapper.wrap([area as any])[0];
        const pending = Promise.resolve(handler.handle({type: AREA_TRANSLATE_CAPTURE_MESSAGE_TYPE, requestId: 'area', image: 'data:image/png,x',
            selection: {left: 0, top: 0, width: 20, height: 20, viewportWidth: 100, viewportHeight: 100}} as any, owner(7)));
        const settled = Promise.allSettled([pending]); await h.enter();
        expect(received).toHaveLength(4); expect(received.every(value => value === received[0])).toBe(true);
        expect((received[0] as Config).service).toBe('openai'); expect(Object.isFrozen(received[0])).toBe(true);
        h.registry.releaseTab(7); expect(() => h.registry.restore(areaOptions.requestId, offscreenOwner)).toThrow('上下文已失效');
        work.resolve('done'); await settled;
    });
});

describe('共享嵌套取消', () => {
    it('验证的离屏取消以内部事务ID中止嵌套文字与父请求，忽略迟到provider结果', async () => {
        const h = transactionFixture(); const provider = deferred();
        h.translateTexts.mockImplementationOnce(() => provider.promise);
        const image = h.start('cancel-parent'); const imageSettled = Promise.allSettled([image]); await h.enter();
        const text = h.call(IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE, {requestId: h.options[0].requestId, texts: ['hello']}, offscreenOwner);
        const textSettled = Promise.allSettled([text]); await h.enter();
        expect(h.registry.cancel(h.options[0].requestId, offscreenOwner).cancelled).toBe(true);
        expect((await textSettled)[0]).toMatchObject({status: 'rejected', reason: {name: 'AbortError'}});
        expect((await imageSettled)[0]).toMatchObject({status: 'rejected', reason: {name: 'AbortError'}});
        provider.resolve('late'); await h.cleanup(imageSettled, textSettled);
    });
});

describe('导出的事务入口边界', () => {
    it('独立registry的离屏文字入口只借用已知内部事务，终止后拒绝恢复与旧绑定', async () => {
        const registry = createImageOperationRegistry('standalone', context => context.sender?.url === OFFSCREEN_URL);
        const work = deferred(); let options: any; let bound: any;
        const first = registry.run({requestId: 'public'}, async value => {options = value; bound = registry.bind(owner(1), value); return work.promise;}, owner(1));
        const settled = Promise.allSettled([first]); await Promise.resolve();
        await expect(registry.run({requestId: 'unknown'}, async () => 'unexpected', offscreenOwner)).rejects.toThrow('上下文已失效');
        await registry.run({requestId: options.requestId}, async nested => {expect(nested.signal).toBe(options.signal); return 'nested';}, offscreenOwner);
        work.resolve('done'); await settled;
        await expect(registry.run({requestId: options.requestId}, async () => 'unexpected', offscreenOwner)).rejects.toThrow('上下文已失效');
        await expect(registry.run({requestId: 'public'}, async () => 'unexpected', bound)).rejects.toThrow('上下文已失效');
    });
    it('信号的非Error取消理由仍归一化为AbortError', async () => {
        const registry = createImageOperationRegistry();
        await expect(registry.run({requestId: 'reason'}, async options => {options.controller!.abort('operator-cancelled'); return 'late';}, owner(1))).rejects.toMatchObject({name: 'AbortError'});
    });
    it('嵌套入口已通过验证后预算耗尽仍保证供应商零调用', async () => {
        vi.useFakeTimers(); const h = transactionFixture(); const image = h.start('budget-after-admission', owner(1), 100);
        const settled = Promise.allSettled([image]); await h.enter();
        h.supportsBatchTranslation.mockImplementationOnce(() => {vi.setSystemTime(Date.now() + 101); return true;});
        await expect(h.call(IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE, {requestId: h.options[0].requestId, texts: ['hello']}, offscreenOwner)).rejects.toThrow('总时间已耗尽');
        expect(h.translateTexts).not.toHaveBeenCalled();
        expect(() => h.registry.restore(h.options[0].requestId, offscreenOwner)).toThrow('超时');
        await h.cleanup(settled);
    });
});

describe('原文档进度传输', () => {
    it('浏览器消息端口保持原frame/document与公开ID', async () => {
        const sendMessage = vi.fn(async () => undefined);
        vi.stubGlobal('browser', {tabs: {sendMessage}});
        const progress = {type: 'fluentReadImageProgress' as const, requestId: 'public', stage: 'rendering' as const};
        await imageTranslationProgressTransport.sendProgress(owner(3, 'original-document'), progress);
        expect(sendMessage).toHaveBeenCalledWith(3, progress, {frameId: 0, documentId: 'original-document'});
    });
});

describe('实际应用装配共用事务', () => {
    it('装配的身份校验与标签页释放贯通真实包装器和feature handlers', async () => {
        const config = Object.assign(new Config(), {service: 'openai', imageTranslationService: 'openai'});
        const translate = vi.fn(async () => ['translated']);
        vi.doMock('@/src/services/config/store', () => ({config, configReady: Promise.resolve(), subscribeConfig: () => () => undefined}));
        vi.doMock('@/src/app/translation/runtime', () => ({translateWithCache: translate}));
        vi.doMock('@/src/app/translation/visionProbeRuntime', () => ({modelVisionProbe: {resolve: vi.fn()}}));
        vi.stubGlobal('browser', {runtime: {id: 'extension', getURL: (path: string) => `chrome-extension://extension${path}`}});
        const work = deferred(); const entered = deferred(); let options: any;
        const adapter = vi.spyOn(imageTranslationOffscreenAdapter, 'translateImage').mockImplementation(async (_i, _l, _t, value) => {
            options = value; entered.resolve('entered'); await work.promise; return {image: 'data:image/png,x', lines: []};
        });
        const {createImageAreaTranslationRuntime} = await import('@/src/app/background/areaRuntime');
        const runtime = createImageAreaTranslationRuntime({assertDownloaded: async () => {}, getDownloaded: async () => [], markDownloaded: async () => [], markRemoved: async () => []} as any,
            {imageTranslation: true, areaTranslation: true} as any);
        const call = (type: string, fields: object, context: any) => Promise.resolve(runtime.handlers.find(h => h.type === type)!.handle({type, ...fields} as any, context));
        const image = call(IMAGE_TRANSLATE_MESSAGE_TYPE, {requestId: 'public', image: 'data:image/png,x', sourceLanguage: 'en'}, owner(1));
        const settled = Promise.allSettled([image]);
        try {
            await entered.promise;
            config.imageTranslationService = 'google';
            await expect(call(IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE, {requestId: options.requestId, texts: ['hello']}, offscreenOwner)).resolves.toMatchObject({success: true, translations: ['translated']});
            expect((translate.mock.calls as any)[0][0].serviceOverride).toBe('openai');
            await expect(call(IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE, {requestId: options.requestId, texts: ['hello']}, {sender: {...offscreenOwner.sender, id: 'other'}})).rejects.toThrow('来源未授权');
            expect(translate).toHaveBeenCalledOnce();
            runtime.releaseTab(1);
            await expect(call(IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE, {requestId: options.requestId, texts: ['hello']}, offscreenOwner)).rejects.toThrow('上下文已失效');
            expect((await settled)[0]).toMatchObject({status: 'rejected', reason: {name: 'AbortError'}});
        } finally {
            work.resolve('late'); await settled; adapter.mockRestore();
            vi.doUnmock('@/src/services/config/store'); vi.doUnmock('@/src/app/translation/runtime'); vi.doUnmock('@/src/app/translation/visionProbeRuntime');
        }
    });
});


describe('父事务结束撤销剩余子工作', () => {
    for (const completion of ['failure', 'success'] as const) {
        it(`父${completion}保留原结果并先撤销恢复权限再中止悬挂子调用`, async () => {
            const registry = createImageOperationRegistry('parent', context => context.sender?.id === 'extension' && context.sender.url === OFFSCREEN_URL);
            const parentWork = deferred(); const provider = deferred(); let options: any;
            const parent = registry.run({requestId: 'parent'}, value => {options = value; return parentWork.promise;}, owner(1));
            const parentObserved = Promise.allSettled([parent]);
            await Promise.resolve();
            const child = registry.run({requestId: options.requestId}, async value => {
                expect(value.signal).toBe(options.signal); return provider.promise;
            }, offscreenOwner);
            let childOutcome: unknown;
            const childObserved = child.then(value => {childOutcome = {value};}, error => {childOutcome = {error};});
            let restorationDeniedDuringAbort = false;
            options.signal.addEventListener('abort', () => {
                try {registry.restore(options.requestId, offscreenOwner);} catch {restorationDeniedDuringAbort = true;}
            }, {once: true});
            await Promise.resolve();
            const originalError = new Error('offscreen port closed');
            try {
                if (completion === 'failure') parentWork.reject(originalError); else parentWork.resolve('parent-result');
                const outcome = (await parentObserved)[0];
                expect(outcome).toEqual(completion === 'failure' ? {status: 'rejected', reason: originalError} : {status: 'fulfilled', value: 'parent-result'});
                for (let i = 0; i < 8; i += 1) await Promise.resolve();
                expect(options.signal.aborted).toBe(true);
                expect(childOutcome).toMatchObject({error: {name: 'AbortError'}});
                expect(restorationDeniedDuringAbort).toBe(true);
            } finally {
                parentWork.resolve('cleanup'); provider.resolve('late'); await Promise.allSettled([parentObserved, childObserved]);
            }
        });
    }

    it('真实handler链在离屏父失败后拒绝第四段non-batch供应商调用', async () => {
        const h = transactionFixture(); const providers = Array.from({length: 4}, deferred);
        h.supportsBatchTranslation.mockReturnValue(false);
        let index = 0;
        h.translateTexts.mockImplementation(() => providers[index++].promise);
        const parent = h.start('parent-chunks'); const parentObserved = Promise.allSettled([parent]); await h.enter();
        const child = h.call(IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE,
            {requestId: h.options[0].requestId, texts: ['first phrase', 'second phrase', 'third phrase', 'fourth phrase']}, offscreenOwner);
        let childOutcome: unknown;
        const childObserved = child.then(value => {childOutcome = {value};}, error => {childOutcome = {error};});
        await h.enter();
        expect(h.translateTexts).toHaveBeenCalledTimes(3);
        const originalError = new Error('offscreen port closed');
        try {
            h.works[0].reject(originalError);
            expect((await parentObserved)[0]).toEqual({status: 'rejected', reason: originalError});
            await h.enter();
            const childAfterFailure = childOutcome;
            for (const provider of providers.slice(0, 3)) provider.resolve('translated');
            await h.enter();
            expect(h.translateTexts).toHaveBeenCalledTimes(3);
            expect(childAfterFailure).toMatchObject({error: {name: 'AbortError'}});
            expect(h.options[0].signal.aborted).toBe(true);
        } finally {
            for (const provider of providers) provider.resolve('late');
            await h.cleanup(parentObserved, childObserved);
        }
    });
});

describe('实际应用装配文档Port入口', () => {
    it('无documentId旧脚本被拒绝，同sender双Port真实图片handler独立且tabclose贯通', async () => {
        vi.resetModules();
        const config = Object.assign(new Config(), {service: 'openai', imageTranslationService: 'openai'});
        vi.doMock('@/src/services/config/store', () => ({config, configReady: Promise.resolve(), subscribeConfig: () => () => undefined}));
        vi.doMock('@/src/app/translation/runtime', () => ({translateWithCache: vi.fn(async () => ['translated'])}));
        vi.doMock('@/src/app/translation/visionProbeRuntime', () => ({modelVisionProbe: {resolve: vi.fn()}}));
        vi.stubGlobal('browser', {runtime: {id: 'extension', getURL: (path: string) => `chrome-extension://extension${path}`}});
        const {documentPortPair} = await import('./helpers/imageDocumentPorts');
        const {createImageDocumentClient} = await import('@/src/features/image-translation/services/documentClient');
        const {imageTranslationOffscreenAdapter: adapter} = await import('@/src/features/image-translation/background/offscreenAdapter');
        const {createImageAreaTranslationRuntime} = await import('@/src/app/background/areaRuntime');
        const work = deferred(); const options: any[] = [];
        const translation = vi.spyOn(adapter, 'translateImage').mockImplementation(async (_i, _l, _t, value) => {
            options.push(value); await work.promise; return {image: 'data:image/png,x', lines: []};
        });
        const runtime = createImageAreaTranslationRuntime({assertDownloaded: async () => {}, getDownloaded: async () => [], markDownloaded: async () => [], markRemoved: async () => []} as any,
            {imageTranslation: true, areaTranslation: true} as any);
        const pairA = documentPortPair(); const pairB = documentPortPair();
        const message = {type: IMAGE_TRANSLATE_MESSAGE_TYPE, requestId: 'same', image: 'data:image/png,x', sourceLanguage: 'en'};
        const outcomes: Promise<unknown>[] = [];
        try {
            await expect(Promise.resolve(runtime.handlers.find(h => h.type === message.type)!.handle(message,
                {sender: {...owner(1).sender, documentId: undefined}}))).rejects.toThrow('刷新');
            expect(translation).not.toHaveBeenCalled();
            runtime.connect(pairA.background); runtime.connect(pairB.background);
            const a = createImageDocumentClient(() => pairA.client); const b = createImageDocumentClient(() => pairB.client);
            outcomes.push(Promise.allSettled([a.request(message, {requestId: 'same', timeoutMs: 1000}, 'timeout'),
                b.request(message, {requestId: 'same', timeoutMs: 1000}, 'timeout')]));
            for (let i = 0; i < 30; i += 1) await Promise.resolve();
            expect(options).toHaveLength(2); expect(options[0].requestId).not.toBe(options[1].requestId);
            pairA.close(); expect(options[0].signal.aborted).toBe(true); expect(options[1].signal.aborted).toBe(false);
            runtime.releaseTab(1); expect(options[1].signal.aborted).toBe(true);
            expect(await outcomes[0]).toEqual([expect.objectContaining({status: 'rejected'}), expect.objectContaining({status: 'rejected'})]);
        } finally {
            pairA.close(); pairB.close(); work.resolve('late'); await Promise.allSettled(outcomes); translation.mockRestore();
            vi.doUnmock('@/src/services/config/store'); vi.doUnmock('@/src/app/translation/runtime'); vi.doUnmock('@/src/app/translation/visionProbeRuntime');
        }
    });
});
