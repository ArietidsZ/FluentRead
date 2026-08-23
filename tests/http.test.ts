import {afterEach, describe, expect, it, vi} from 'vitest';
import {runtimeFetch, setRuntimeFetch} from '@/entrypoints/utils/http';

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
});
