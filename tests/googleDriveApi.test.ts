import {afterEach, describe, expect, it, vi} from 'vitest';
import {createDriveApi} from '@/src/platform/google-drive/api';
import {DriveError} from '@/src/platform/google-drive/auth';
import {GOOGLE_DRIVE_CONFIG_FILE_NAME, GOOGLE_DRIVE_MAX_BYTES} from '@/src/platform/google-drive/constants';
import {encryptDriveConfig} from '@/src/platform/google-drive/encryption';

const metadata = {id: 'fixture/file', name: GOOGLE_DRIVE_CONFIG_FILE_NAME, version: '1', modifiedTime: 'fixture-time'};
const session = {account: {id: 'fixture-account', email: 'tester@fixture.invalid'}, request: async <T>(operation: (token: string) => Promise<T>) => operation('fixture-token')};
function json(value: unknown, etag?: string) {return new Response(JSON.stringify(value), {headers: etag ? {etag} : {}});}
afterEach(() => vi.useRealTimers());
describe('Google Drive appDataFolder HTTP 边界', () => {
    it('限定应用空间和文件名；空云盘不下载', async () => {
        const fetcher = vi.fn<typeof fetch>(async () => json({files: []}));
        expect(await createDriveApi(fetcher).read(session)).toBeNull();
        const url = new URL(String(fetcher.mock.calls[0][0]));
        expect(url.searchParams.get('spaces')).toBe('appDataFolder');
        expect(url.searchParams.get('q')).toBe(`name = '${GOOGLE_DRIVE_CONFIG_FILE_NAME}' and trashed = false`);
        expect(url.search).not.toContain('fixture-token');
        expect(fetcher.mock.calls[0][1]).toMatchObject({headers: {Authorization: 'Bearer fixture-token'}});
    });
    it('读取一致的媒体与元数据，编码文件 ID，并保留服务器条件标识', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(json({files: [metadata]})).mockResolvedValueOnce(json(metadata, '"fixture-etag"')).mockResolvedValueOnce(new Response('encrypted fixture content')).mockResolvedValueOnce(json(metadata, '"fixture-etag"'));
        const remote = await createDriveApi(fetcher).read(session);
        expect(remote).toEqual({file: {id: metadata.id, version: '1', modifiedTime: 'fixture-time', etag: '"fixture-etag"'}, content: 'encrypted fixture content'});
        expect(fetcher.mock.calls[2][0]).toContain('fixture%2Ffile?alt=media');
    });
    it('拒绝重复文件、错误元数据和读取期间发生的版本变化', async () => {
        for (const data of [null, {}, {files: null}, {files: [metadata, metadata]}, {files: [], nextPageToken: 'more'}, {files: [null]}, {files: [{}]}, {files: [{...metadata, id: 1}]}, {files: [{...metadata, id: ''}]}, {files: [{...metadata, version: 1}]}, {files: [{...metadata, modifiedTime: 1}]}]) await expect(createDriveApi(vi.fn(async () => json(data))).read(session)).rejects.toThrow();
        const fetcher = vi.fn().mockResolvedValueOnce(json({files: [metadata]})).mockResolvedValueOnce(json(metadata)).mockResolvedValueOnce(new Response('ciphertext')).mockResolvedValueOnce(json({...metadata, version: '2'}));
        await expect(createDriveApi(fetcher).read(session)).rejects.toThrow('云端配置已变化');
    });
    it('限制 Content-Length 和实际流大小，拒绝无媒体流', async () => {
        for (const response of [new Response('ciphertext', {headers: {'content-length': String(GOOGLE_DRIVE_MAX_BYTES + 1)}}), new Response('x'.repeat(GOOGLE_DRIVE_MAX_BYTES + 1)), new Response(null)]) {
            const fetcher = vi.fn().mockResolvedValueOnce(json({files: [metadata]})).mockResolvedValueOnce(json(metadata)).mockResolvedValueOnce(response);
            await expect(createDriveApi(fetcher).read(session)).rejects.toThrow();
        }
    });
    it('只上传加密配置，创建和更新使用不同方法，支持条件写入', async () => {
        const content = await encryptDriveConfig({private: 'fixture-content-secret'}, 'fixture secure passphrase');
        const fetcher = vi.fn<typeof fetch>(async () => json(metadata, '"new-etag"'));
        const api = createDriveApi(fetcher);
        await api.write(session, content, null);
        expect(fetcher.mock.calls[0][1]).toMatchObject({method: 'POST', body: expect.stringContaining('appDataFolder')});
        expect(String(fetcher.mock.calls[0][1]?.body)).not.toContain('fixture-content-secret');
        await api.write(session, content, {...metadata, etag: '"previous-etag"'});
        expect(fetcher.mock.calls[1][1]).toMatchObject({method: 'PATCH', headers: {'If-Match': '"previous-etag"'}});
        expect(String(fetcher.mock.calls[1][0])).toContain('fixture%2Ffile');
        await api.write(session, content, metadata);
        expect(fetcher.mock.calls[2][1]?.headers).not.toHaveProperty('If-Match');
        for (const invalid of ['broken', 'null', '{}', JSON.stringify({format: 'wrong'}), 'x'.repeat(GOOGLE_DRIVE_MAX_BYTES + 1)]) await expect(api.write(session, invalid, null)).rejects.toThrow('加密');
    });
    it('错误和超时不反射上游私密响应，不进行额外重试', async () => {
        for (const status of [401, 403, 412, 500]) {
            const fetcher = vi.fn(async () => new Response('fixture-private-upstream-error', {status}));
            const error = await createDriveApi(fetcher).read(session).catch(error => error);
            expect(error).toBeInstanceOf(DriveError);
            expect(error.status).toBe(status);
            expect(error.message).not.toContain('fixture-private');
            expect(fetcher).toHaveBeenCalledOnce();
        }
        await expect(createDriveApi(vi.fn(async () => {throw new Error('fixture-private-network-error');})).read(session)).rejects.toThrow('网络请求失败');
        await expect(createDriveApi(vi.fn(async () => new Response('invalid JSON'))).read(session)).rejects.toThrow('响应无效');
        vi.useFakeTimers();
        const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('timeout')))));
        const request = createDriveApi(fetcher).read(session).catch(error => error);
        await vi.advanceTimersByTimeAsync(30_000);
        expect((await request).message).toContain('网络请求失败');
    });
});
