/** 真实图片 wrapper/registry/handler/原生 Port；准备 gate 不释放前即检查后台 dispatch 终止和清理，不依赖客户端 timeout。 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Config} from '@/src/core/config/model';
import {createImageGlossaryContext, type ImageGlossarySenderContext} from '@/src/app/background/imageGlossaryContext';
import {createImageOperationRegistry, createImageTranslationBackgroundHandlers} from '@/src/features/image-translation/background/handlers';
import {createImageDocumentPortHandler} from '@/src/features/image-translation/background/documentSession';
import {createImageDocumentClient} from '@/src/features/image-translation/services/documentClient';
import {IMAGE_DOCUMENT_VERSION} from '@/src/features/image-translation/documentChannel';
import {documentPortPair} from './helpers/imageDocumentPorts';
function deferred<T>() {let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};}
const drain = async () => {for (let i = 0; i < 60; i++) await Promise.resolve();};
const message = {type: 'fluentReadImageTranslate', requestId: 'preparation', image: 'data:image/png;base64,AQ==', sourceLanguage: 'en'};
function fixture(phase: 'ready' | 'source') {
    const gate = deferred<any>(), config = new Config();
    config.incognitoService = 'custom:preparation'; config.incognitoModel = 'private';
    config.customOpenAIProviders = [{id: 'custom:preparation', name: 'Synthetic preparation', endpoint: 'https://preparation.synthetic.test/v1', models: ['private']}];
    const registry = createImageOperationRegistry('preparation', () => false, Date.now, true);
    const source = vi.fn(() => phase === 'source' ? gate.promise : Promise.resolve('private' as const));
    const translateImage = vi.fn(async () => ({image: message.image, lines: []}));
    const adapter = createImageGlossaryContext<ImageGlossarySenderContext>({ready: phase === 'ready' ? gate.promise : Promise.resolve(),
        operationRegistry: registry, requireDocumentOwner: true, getConfig: () => config, offscreenUrl: 'chrome-extension://extension/offscreen.html',
        getSourceLanguage: () => 'en', getGlossaryRevision: () => 'unused', resolveImageSourcePrivacy: source});
    const handlers = adapter.wrap(createImageTranslationBackgroundHandlers({operationRegistry: registry, assertLanguagesDownloaded: async () => {},
        translateImage, fetchImage: async () => '', getTranslationService: () => 'google', supportsBatchTranslation: () => true,
        translateTexts: async () => [], downloadLanguages: async () => {}, markLanguagesDownloaded: async () => []}) as any);
    const active = new Set<Promise<unknown>>(); let owner: ImageGlossarySenderContext | undefined;
    const server = createImageDocumentPortHandler({runtimeId: 'extension', releaseOwner: registry.releaseOwner, dispatch: (packet, context) => {
        owner = context; const pending = Promise.resolve(handlers.find(h => h.type === packet.type)!.handle(packet, context)); active.add(pending);
        void pending.then(() => active.delete(pending), () => active.delete(pending)); return pending;
    }});
    const pair = documentPortPair({id: 'extension', url: 'https://example.test/document', tab: {id: 1, incognito: true}}); server.connect(pair.background);
    const client = createImageDocumentClient(() => pair.client);
    const start = () => {const pending = client.request(message, {requestId: message.requestId, timeoutMs: 5000}, 'client timeout'); void pending.catch(() => {}); return pending;};
    const cleanup = async () => {pair.close(); gate.resolve(phase === 'ready' ? undefined : 'private'); await drain();};
    return {gate, registry, source, translateImage, adapter, active, pair, client, start, cleanup, owner: () => owner!};
}
afterEach(() => {vi.restoreAllMocks(); vi.useRealTimers();});
describe('image preparation cancellation before any gate settlement', () => {
    describe.each(['ready', 'source'] as const)('%s preparation gate', phase => {
        describe.each(['configuration', 'disconnect'] as const)('%s cancellation', reason => {
            it.each(['never', 'resolve', 'reject'] as const)('stops background dispatch before late %s', async late => {
                const h = fixture(phase), pending = h.start(); let outcome: unknown;
                void pending.then(value => {outcome = {value};}, error => {outcome = {error};});
                try {
                    await drain(); expect(h.active.size).toBe(1); expect(h.translateImage).not.toHaveBeenCalled();
                    expect(h.source).toHaveBeenCalledTimes(phase === 'source' ? 1 : 0);
                    if (reason === 'configuration') h.adapter.cancelImages(); else h.pair.close();
                    await drain();
                    expect(h.active.size).toBe(0); expect(outcome).toMatchObject({error: reason === 'configuration' ? {name: 'AbortError'} : {message: expect.stringContaining('port closed')}});
                    if (reason === 'configuration') expect(h.registry.cancel(message.requestId, h.owner()).cancelled).toBe(false);
                    const abort = vi.spyOn(AbortController.prototype, 'abort'); h.adapter.cancelImages(); expect(abort).not.toHaveBeenCalled();
                    if (late === 'resolve') h.gate.resolve(phase === 'ready' ? undefined : 'private');
                    if (late === 'reject') h.gate.reject(new Error('synthetic late preparation rejection'));
                    await drain(); expect(h.active.size).toBe(0); expect(h.translateImage).not.toHaveBeenCalled();
                    await expect(pending).rejects.toThrow(reason === 'configuration' ? '取消' : 'port closed');
                } finally {await h.cleanup();}
            });
        });
        it('reaches the existing registry deadline while the gate never returns', async () => {
            vi.useFakeTimers(); const h = fixture(phase);
            try {
                h.pair.client.postMessage({kind: 'request', version: IMAGE_DOCUMENT_VERSION, rpcId: 'server-deadline', message: {...message, timeoutMs: 25}});
                await drain(); expect(h.active.size).toBe(1); await vi.advanceTimersByTimeAsync(26);
                expect(h.active.size).toBe(0); expect(h.translateImage).not.toHaveBeenCalled();
                const results = vi.mocked(h.pair.background.postMessage).mock.calls.map(([packet]) => packet as any).filter(packet => packet.kind === 'result');
                expect(results).toHaveLength(1); expect(results[0].response).toMatchObject({success: false, errorName: 'TimeoutError'});
                expect(h.registry.cancel(message.requestId, h.owner()).cancelled).toBe(false);
            } finally {await h.cleanup();}
        });
        it('normally resolves and seals the private snapshot before OCR dispatch', async () => {
            const h = fixture(phase), pending = h.start();
            try {
                await drain(); h.gate.resolve(phase === 'ready' ? undefined : 'private'); expect(await pending).toMatchObject({success: true});
                expect(h.translateImage).toHaveBeenCalledOnce(); const options = (h.translateImage.mock.calls as any)[0][3];
                expect(options.snapshot.config.imageTranslationService).toBe('custom:preparation'); expect(Object.isFrozen(options.snapshot.config)).toBe(true);
                expect(h.active.size).toBe(0);
            } finally {await h.cleanup();}
        });
    });
    it('an explicit cancel reaches the registered preparation before ready resolves and releases its owner slot', async () => {
        const h = fixture('ready'), pending = h.start();
        try {
            await drain(); expect(h.registry.cancel(message.requestId, h.owner()).cancelled).toBe(true);
            await drain(); expect(h.active.size).toBe(0); await expect(pending).rejects.toMatchObject({name: 'AbortError'});
            expect(h.registry.cancel(message.requestId, h.owner()).cancelled).toBe(false);
        } finally {await h.cleanup();}
    });
    it.each(['resolve', 'reject'] as const)('late registry snapshot preparation %s is consumed and cannot seal a cancelled transaction', async late => {
        const gate = deferred<any>(), registry = createImageOperationRegistry('late-preparation', () => false, Date.now, true);
        const context = {sender: {id: 'extension', documentId: 'native-document', tab: {id: 1}}};
        let options: any; const operation = vi.fn(async () => 'unexpected');
        const pending = registry.run({requestId: 'late'}, operation, context, undefined, value => {options = value; return gate.promise;});
        const rejected = expect(pending).rejects.toMatchObject({name: 'AbortError'}); await drain(); registry.cancel('late', context); await rejected;
        if (late === 'resolve') gate.resolve(Object.freeze({sourceLanguage: 'en', glossaryRevision: 'unused'})); else gate.reject(new Error('synthetic late snapshot rejection'));
        await drain(); expect(operation).not.toHaveBeenCalled(); expect(options.snapshot).toBeUndefined(); expect(registry.cancel('late', context).cancelled).toBe(false);
    });
});
