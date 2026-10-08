import {afterEach, describe, expect, it, vi} from 'vitest';
import {createImageOperationRegistry} from '@/src/features/image-translation/background/operationRegistry';
import {imageTranslationProgressTransport, createImageSourceVerifier} from '@/src/features/image-translation/background/offscreenAdapter';
const context = () => ({sender: {id: 'extension', tab: {id: 7}, frameId: 0, url: 'https://example.test/same'}});
const gate = () => {let resolve!: (value: string) => void; const promise = new Promise<string>(done => {resolve = done;}); return {promise, resolve};};
afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks();});
describe('missing-documentId existing fallback boundary (offline actual registry/adapter)', () => {
    it('old and replacement same-URL document cannot cancel each other', async () => {
        const oldDocument = context(); const replacementDocument = context(); const work = gate();
        const registry = createImageOperationRegistry();
        const first = registry.run({requestId: 'shared'}, () => work.promise, oldDocument);
        const observed = Promise.allSettled([first]); await Promise.resolve();
        const cancelled = registry.cancel('shared', replacementDocument);
        work.resolve('old-result');
        const outcome = await observed;
        expect(cancelled.cancelled).toBe(false);
        expect(outcome).toEqual([{status: 'fulfilled', value: 'old-result'}]);
    });
    it('old and replacement same-URL document can start the same public ID independently', async () => {
        const registry = createImageOperationRegistry(); const a = gate(); const b = gate();
        const first = registry.run({requestId: 'same'}, () => a.promise, context());
        const second = registry.run({requestId: 'same'}, () => b.promise, context());
        const observed = Promise.allSettled([first, second]); a.resolve('a'); b.resolve('b');
        expect(await observed).toEqual([{status: 'fulfilled', value: 'a'}, {status: 'fulfilled', value: 'b'}]);
    });
    it('navigation replaces the frame slot before disconnect: old progress must not reach replacement', async () => {
        const oldDocument: unknown[] = []; const replacementDocument: unknown[] = [];
        let current = oldDocument;
        const sendMessage = vi.fn(async (_tab, message, options) => {if (!options?.documentId) current.push(message); return {valid: true};});
        vi.stubGlobal('browser', {tabs: {sendMessage}});
        const owner = context(); current = replacementDocument;
        await imageTranslationProgressTransport.sendProgress(owner, {type: 'fluentReadImageProgress', requestId: 'old-public', stage: 'translating'});
        expect(replacementDocument).toHaveLength(0);
    });
    it('navigation replaces the frame slot: old source challenge must not validate through replacement', async () => {
        const replacementDocument: unknown[] = [];
        const verifier = createImageSourceVerifier(async (_tab, message, options) => {if (!options?.documentId) replacementDocument.push(message); return {valid: true};});
        const controller = new AbortController();
        const outcome = await verifier('https://cdn.example/image.png', {requestId: 'internal', callerRequestId: 'image-source-original', signal: controller.signal, timeoutMs: 100}, context()).then(() => 'accepted', () => 'denied');
        expect(replacementDocument).toHaveLength(0);
        expect(outcome).toBe('denied');
    });
});


it('negative control: browser-provided documentId preserves same-frame owner isolation and original targeted transport', async () => {
    const a = {...context(), sender: {...context().sender, documentId: 'doc-a'}};
    const b = {...context(), sender: {...context().sender, documentId: 'doc-b'}};
    const registry = createImageOperationRegistry(); const work = gate();
    const first = registry.run({requestId: 'same'}, () => work.promise, a);
    const observed = Promise.allSettled([first]); await Promise.resolve();
    expect(registry.cancel('same', b).cancelled).toBe(false);
    expect(registry.cancel('same', a).cancelled).toBe(true);
    work.resolve('late'); expect((await observed)[0]).toMatchObject({status: 'rejected', reason: {name: 'AbortError'}});
    const replacement: unknown[] = []; const original: unknown[] = [];
    const sendMessage = vi.fn(async (_tab, message, options) => {if (options?.documentId === 'doc-a') original.push(message); else replacement.push(message); return {valid: true};});
    vi.stubGlobal('browser', {tabs: {sendMessage}});
    await imageTranslationProgressTransport.sendProgress(a, {type: 'fluentReadImageProgress', requestId: 'old-public', stage: 'translating'});
    await createImageSourceVerifier(sendMessage)('https://cdn.example/image.png', {requestId: 'internal', callerRequestId: 'image-source-original', signal: new AbortController().signal, timeoutMs: 100}, a);
    expect(original).toHaveLength(2); expect(replacement).toHaveLength(0);
    expect(sendMessage.mock.calls[1][1]).toMatchObject({requestId: 'image-source-original'});
});
