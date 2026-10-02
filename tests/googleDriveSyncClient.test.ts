import {describe, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({send: vi.fn()}));
vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage: mocks.send}}}));
import {googleDriveSyncClient as client} from '@/src/services/config/googleDriveSyncClient';

describe('同步设置请求端口', () => {
    it('所有动作使用同一加密同步协议，不在客户端读取配置', async () => {
        mocks.send.mockResolvedValue({success: true, data: {fixture: true}});
        expect(await client.status()).toEqual({fixture: true});
        await client.cancel();
        await client.prepare();
        await client.commit('fixture-id', 'download', {'0': 'remote'});
        expect(mocks.send.mock.calls.map(call => call[0].action)).toEqual(['status', 'cancel', 'prepare', 'commit']);
        expect(mocks.send.mock.calls.every(([message]) => !('passphrase' in message))).toBe(true);
        expect(mocks.send).toHaveBeenLastCalledWith({type: 'googleDriveEncryptedSync', action: 'commit', id: 'fixture-id', direction: 'download', choices: {'0': 'remote'}});
    });
    it('后台不可用、无响应和失败响应都有可见错误', async () => {
        mocks.send.mockRejectedValueOnce(new Error('fixture transport private error'));
        await expect(client.status()).rejects.toThrow('后台暂时不可用');
        mocks.send.mockResolvedValueOnce(undefined);
        await expect(client.status()).rejects.toThrow('同步请求未完成');
        mocks.send.mockResolvedValueOnce({success: false});
        await expect(client.status()).rejects.toThrow('同步请求未完成');
        mocks.send.mockResolvedValueOnce({success: false, error: 'fixture safe error'});
        await expect(client.status()).rejects.toThrow('fixture safe error');
    });
});
