import {gzipSync, gunzipSync} from 'node:zlib';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {inflateGzipBase64} from '@/userscript/compression';

describe('userscript compressed assets', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('inflates real gzip data with the browser stream API', async () => {
        const source = 'FluentRead 样式和 English settings';
        const encoded = gzipSync(source).toString('base64');
        await expect(inflateGzipBase64(encoded)).resolves.toBe(source);
    });

    it('uses the preloaded pako global when an older browser lacks DecompressionStream', async () => {
        const source = 'FluentRead 旧浏览器样式';
        const encoded = gzipSync(source).toString('base64');
        const ungzip = vi.fn((bytes: Uint8Array) => gunzipSync(bytes).toString('utf8'));
        vi.stubGlobal('DecompressionStream', undefined);
        vi.stubGlobal('pako', {ungzip});

        await expect(inflateGzipBase64(encoded)).resolves.toBe(source);
        expect(ungzip).toHaveBeenCalledOnce();
    });
});
