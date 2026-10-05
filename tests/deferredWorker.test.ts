import {afterEach, describe, expect, it, vi} from 'vitest';
import {startDeferredWorker} from '@/src/app/offscreen/deferredWorker';
afterEach(() => vi.unstubAllGlobals());
function scope() {
    const target = Object.assign(new EventTarget(), {postMessage: vi.fn()});vi.stubGlobal('self', target);return target;
}
const message = (requestId: unknown) => new MessageEvent('message', {data: {requestId}});
describe('deferred model worker boot', () => {
    it('does not lose the first request while importing and preserves order without duplicate delivery', async () => {
        const target = scope(), received: unknown[] = [];let ready!: () => void;
        const start = startDeferredWorker(async () => {await new Promise<void>(resolve => {ready = resolve;});target.addEventListener('message', e => received.push((e as MessageEvent).data.requestId));});
        target.dispatchEvent(message(1));target.dispatchEvent(message(2));expect(received).toEqual([]);
        ready();await start;target.dispatchEvent(message(3));expect(received).toEqual([1,2,3]);expect(target.postMessage).not.toHaveBeenCalled();
    });
    it.each([new Error('module unavailable'), 'failed import'])('returns startup failure to queued and subsequent valid requests (%s)', async error => {
        const target = scope();let reject!: (error: unknown) => void;
        const start = startDeferredWorker(() => new Promise((_, fail) => {reject = fail;}));
        target.dispatchEvent(message(1));reject(error);await start;target.dispatchEvent(message(2));target.dispatchEvent(message(undefined));
        expect(target.postMessage.mock.calls.map(call => call[0])).toEqual([1,2].map(requestId => ({requestId, success:false, error:error instanceof Error ? error.message : error})));
    });
});
