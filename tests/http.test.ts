import {afterEach, describe, expect, it, vi} from 'vitest';
import {runtimeFetch, setRuntimeFetch} from '@/src/platform/http/runtime';

describe('runtime HTTP transport', () => {
    afterEach(() => setRuntimeFetch());

    it('uses an installed fetch-compatible transport', async () => {
        const response = new Response('{"ok":true}', {
            status: 201,
            headers: {'content-type': 'application/json'},
        });
        const transport = vi.fn(async () => response);
        setRuntimeFetch(transport);

        const result = await runtimeFetch('https://example.com/translate', {
            method: 'POST',
            body: 'hello',
        });

        expect(transport).toHaveBeenCalledWith('https://example.com/translate', {
            method: 'POST',
            body: 'hello',
        });
        expect(result.status).toBe(201);
        expect(await result.json()).toEqual({ok: true});
    });

    it('reset 后恢复调用运行环境的原生 fetch', async () => {
        const originalFetch = globalThis.fetch;
        const nativeFetch = vi.fn(async () => new Response('native'));
        globalThis.fetch = nativeFetch;
        setRuntimeFetch();

        try {
            const response = await runtimeFetch(new URL('https://example.com/native'));
            expect(await response.text()).toBe('native');
            expect(nativeFetch).toHaveBeenCalledOnce();
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
