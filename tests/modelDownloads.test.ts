import {afterEach, describe, expect, it, vi} from 'vitest';
import {huggingFaceDownloadOrigins, modelDownloadSources, withModelDownload} from '@/src/platform/http/modelDownloads';

const url = 'https://huggingface.co/test/model/resolve/pinned/weights.onnx';
afterEach(() => {vi.unstubAllGlobals(); vi.useRealTimers();});

describe('model download source and stream boundaries', () => {
    it('uses language only as an ordering hint, retains both mirrors and honors explicit preference', () => {
        vi.stubGlobal('navigator', undefined);
        expect(huggingFaceDownloadOrigins()[0]).toBe('https://huggingface.co');
        vi.stubGlobal('navigator', {language: 'zh-CN'});
        expect(huggingFaceDownloadOrigins()).toEqual(['https://hf-mirror.com','https://hf-mirror.net','https://huggingface.co']);
        expect(huggingFaceDownloadOrigins('official')[0]).toContain('huggingface.co');
        vi.stubGlobal('navigator', {language: 'zh-TW'});
        expect(huggingFaceDownloadOrigins()[0]).toContain('huggingface.co');
        expect(huggingFaceDownloadOrigins('mirror')[0]).toContain('hf-mirror.com');
        expect(modelDownloadSources(url + '?download=true', 'official')).toEqual([
            url + '?download=true', url.replace('huggingface.co', 'hf-mirror.com') + '?download=true', url.replace('huggingface.co', 'hf-mirror.net') + '?download=true',
        ]);
        const whisper = 'https://modelscope.cn/models/onnx-community/whisper-tiny/resolve/master/config.json';
        expect(modelDownloadSources(whisper)).toEqual([whisper,
            'https://huggingface.co/onnx-community/whisper-tiny/resolve/main/config.json',
            'https://hf-mirror.com/onnx-community/whisper-tiny/resolve/main/config.json',
            'https://hf-mirror.net/onnx-community/whisper-tiny/resolve/main/config.json']);
        for (const other of ['https://example.com/model', 'https://modelscope.cn/models/other/model/resolve/master/config.json', 'https://modelscope.cn/other']) {
            expect(modelDownloadSources(other)).toEqual([other]);
        }
    });
    it('streams through cache, keeps source headers, and never buffers or copies the whole model', async () => {
        const original = new Response(new Uint8Array([1,2,3]), {headers: {'Content-Type':'application/octet-stream'}});
        const buffer = vi.spyOn(original, 'arrayBuffer');
        const fetcher = vi.fn(async () => original);
        vi.stubGlobal('fetch', fetcher);
        const value = await withModelDownload(url, async (response, source) => {
            expect(source).toBe(url);expect(response.headers.get('Content-Type')).toContain('octet-stream');
            return Array.from(new Uint8Array(await response.arrayBuffer()));
        }, {preference:'official'});
        expect(value).toEqual([1,2,3]);expect(buffer).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledOnce();
        expect(fetcher).toHaveBeenCalledWith(url, {signal:expect.any(AbortSignal),credentials:'omit',referrerPolicy:'no-referrer'});
    });
    it('reports real received bytes per source and gives a total only for an uncompressed Content-Length', async () => {
        const chunks = (parts: number[][]) => new ReadableStream<Uint8Array>({start(stream) {for (const part of parts) stream.enqueue(new Uint8Array(part)); stream.close();}});
        const run = async (response: Response) => {
            const calls: Array<[number, number | undefined]> = [];
            vi.stubGlobal('fetch', vi.fn(async () => response));
            await withModelDownload('https://example.com/model', item => item.arrayBuffer(), {onProgress: (loaded, total) => calls.push([loaded, total])});
            return calls;
        };
        expect(await run(new Response(chunks([[1, 2], [3, 4, 5]]), {headers: {'Content-Length': '5'}}))).toEqual([[0, 5], [2, 5], [5, 5]]);
        expect(await run(new Response(chunks([[1, 2, 3]])))).toEqual([[0, undefined], [3, undefined]]);
        // 压缩传输的 Content-Length 是编码后的大小；非法或为零的长度同样不能当作总量。
        expect(await run(new Response(chunks([[1]]), {headers: {'Content-Length': '1', 'Content-Encoding': 'gzip'}}))).toEqual([[0, undefined], [1, undefined]]);
        expect(await run(new Response(chunks([[1]]), {headers: {'Content-Length': 'many'}}))).toEqual([[0, undefined], [1, undefined]]);
        expect(await run(new Response(chunks([[1]]), {headers: {'Content-Length': '0'}}))).toEqual([[0, undefined], [1, undefined]]);

        // 换来源重试时从 0 重新回报；进度回调抛错不影响下载结果。
        vi.stubGlobal('navigator', {language: 'en-US'});
        const restarted: number[] = [];
        let pulls = 0;
        const broken = new ReadableStream<Uint8Array>({pull(stream) {if (pulls++ === 0) stream.enqueue(new Uint8Array([9])); else stream.error(new Error('cut'));}});
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(broken)).mockResolvedValueOnce(new Response(chunks([[1, 2]]))));
        expect(await withModelDownload(url, response => response.text(), {onProgress: (loaded) => { restarted.push(loaded); throw new Error('ui failed'); }})).toBe('\u0001\u0002');
        expect(restarted).toEqual([0, 1, 0, 2]);
    });
    it('falls back for HTTP, HTML challenge pages, missing bodies and validation failures', async () => {
        vi.stubGlobal('navigator', {language: 'en-US'});
        for (const bad of [new Response('', {status:503}), new Response('<html>', {headers:{'Content-Type':'text/html'}}), new Response(null)]) {
            const fetcher = vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(new Response('verified'));
            vi.stubGlobal('fetch', fetcher);
            expect(await withModelDownload(url, response => response.text())).toBe('verified');
            expect(fetcher.mock.calls[1][0]).toContain('hf-mirror.com');
        }
        const fetcher = vi.fn(async () => new Response('valid'));
        vi.stubGlobal('fetch', fetcher);
        const consume = vi.fn(async (response: Response) => {const text=await response.text();if(consume.mock.calls.length<3)throw new Error('bad hash');return text;});
        expect(await withModelDownload(url, consume)).toBe('valid');
        expect(fetcher).toHaveBeenCalledTimes(3);
    });
    it('falls back when a stream breaks or a fetch rejects and exposes the final failure', async () => {
        const body = new ReadableStream<Uint8Array>({start(controller){controller.error(new Error('broken body'));}});
        const fetcher=vi.fn().mockResolvedValueOnce(new Response(body)).mockRejectedValueOnce('network').mockResolvedValueOnce(new Response('good'));
        vi.stubGlobal('fetch', fetcher);
        expect(await withModelDownload(url, response => response.text())).toBe('good');
        vi.stubGlobal('fetch', vi.fn(async()=>{throw new Error('offline');}));
        await expect(withModelDownload(url, response=>response.text())).rejects.toThrow('offline');
    });
    it('propagates quota errors and user cancellation without downloading from another source', async () => {
        const fetcher=vi.fn(async()=>new Response('bytes'));
        vi.stubGlobal('fetch',fetcher);
        await expect(withModelDownload(url,async()=>{throw new DOMException('disk full','QuotaExceededError');})).rejects.toMatchObject({name:'QuotaExceededError'});
        expect(fetcher).toHaveBeenCalledOnce();fetcher.mockClear();
        const controller=new AbortController();controller.abort();
        await expect(withModelDownload(url,response=>response.text(),{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
        expect(fetcher).not.toHaveBeenCalled();
        const reading=new AbortController();
        await expect(withModelDownload(url,async response=>{await response.text();reading.abort();},{signal:reading.signal})).rejects.toMatchObject({name:'AbortError'});
        expect(fetcher).toHaveBeenCalledOnce();fetcher.mockClear();
        const headers=new AbortController();fetcher.mockImplementationOnce(async()=>{headers.abort();return new Response('bytes');});
        await expect(withModelDownload(url,response=>response.text(),{signal:headers.signal})).rejects.toMatchObject({name:'AbortError'});
        expect(fetcher).toHaveBeenCalledOnce();
    });
    it('times out stalled headers, switches sources and cancels a stalled body', async () => {
        vi.useFakeTimers();
        const fetcher=vi.fn((_url:string,options:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
            options.signal!.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError')),{once:true});
        }));
        vi.stubGlobal('fetch',fetcher);
        const pending=withModelDownload(url,response=>response.text(),{idleTimeoutMs:10,timeoutMs:100});
        const checked=expect(pending).rejects.toThrow('超过');
        await vi.advanceTimersByTimeAsync(31);await checked;expect(fetcher).toHaveBeenCalledTimes(3);
        const controller=new AbortController();
        const cancelled=withModelDownload(url,response=>response.text(),{signal:controller.signal});
        const cancellation=expect(cancelled).rejects.toMatchObject({name:'AbortError'});
        await vi.advanceTimersByTimeAsync(1);controller.abort();await cancellation;
        vi.stubGlobal('fetch',vi.fn(async (_url:string,options:RequestInit)=>new Response(new ReadableStream({start(stream){options.signal!.addEventListener('abort',()=>stream.close());}}))));
        const reading=withModelDownload('https://example.com/model',response=>response.text(),{idleTimeoutMs:10});
        const timeout=expect(reading).rejects.toThrow('超过');await vi.advanceTimersByTimeAsync(11);await timeout;
    });
    it('enforces total timeout even with a consumer pending after reception and cleans cancelled streams', async () => {
        vi.useFakeTimers();
        const cancel=vi.fn(async()=>{});
        const reader={read:async()=>({done:true}),cancel,releaseLock:vi.fn()};
        vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,statusText:'OK',headers:new Headers(),body:{getReader:()=>reader}})));
        const pending=withModelDownload('https://example.com/model',async response=>{await response.text();await new Promise(resolve=>setTimeout(resolve,11));},{timeoutMs:10});
        const check=expect(pending).rejects.toThrow('超过');await vi.advanceTimersByTimeAsync(12);await check;
        expect(reader.releaseLock).toHaveBeenCalled();
        const result=await withModelDownload('https://example.com/model',async response=>{await response.body!.cancel();return 'cancelled';});
        expect(result).toBe('cancelled');expect(cancel).toHaveBeenCalled();
    });
});
