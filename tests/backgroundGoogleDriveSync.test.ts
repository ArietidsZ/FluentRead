import {describe, expect, it, vi} from 'vitest';
import {createGoogleDriveSyncHandler, isGoogleDriveSettingsSender, GOOGLE_DRIVE_SYNC_MESSAGE_TYPE as type} from '@/src/app/background/handlers/googleDriveSync';
import {DriveError} from '@/src/platform/google-drive/auth';
import {DriveEncryptionError} from '@/src/platform/google-drive/encryption';
import {DriveConfigError} from '@/src/core/config/driveSync';
import type {createGoogleDriveSync} from '@/src/services/config/googleDriveSync';

function fixture(trusted = true) {
    const service = {status: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), cancel: vi.fn(), prepare: vi.fn(), commit: vi.fn()} as unknown as ReturnType<typeof createGoogleDriveSync>;
    return {service, handler: createGoogleDriveSyncHandler(service, () => trusted)};
}
describe('Google Drive 可信消息协议', () => {
    it('设置页可操作，其他扩展、网页、popup、路径前缀和非法 URL 都不能操作', () => {
        const options = 'chrome-extension://fixture/options.html';
        expect(isGoogleDriveSettingsSender({id: 'fixture', url: `${options}?test=1#backup`}, 'fixture', options)).toBe(true);
        for (const sender of [undefined, {}, {id: 'fixture'}, {id: 'other', url: options}, {id: 'fixture', url: 'invalid'}, {id: 'fixture', url: 'https://fixture/options.html'}, {id: 'fixture', url: 'chrome-extension://other/options.html'}, {id: 'fixture', url: 'chrome-extension://fixture/popup.html'}, {id: 'fixture', url: `${options}.evil`}]) expect(isGoogleDriveSettingsSender(sender, 'fixture', options)).toBe(false);
        expect(isGoogleDriveSettingsSender({id: 'fixture', url: options}, 'fixture', 'invalid')).toBe(false);
    });
    it('拒绝内容脚本发送者，合法设置消息只向服务传递必要参数', async () => {
        const f = fixture(false);
        expect(await f.handler.handle({type, action: 'connect'}, {})).toMatchObject({success: false});
        expect(f.service.connect).not.toHaveBeenCalled();
        const allowed = fixture();
        for (const action of ['status', 'connect', 'disconnect', 'cancel'] as const) {
            expect(await allowed.handler.handle({type, action}, {})).toMatchObject({success: true});
            expect(allowed.service[action]).toHaveBeenCalledOnce();
        }
        await allowed.handler.handle({type, action: 'prepare', passphrase: 'fixture long password'}, {});
        expect(allowed.service.prepare).toHaveBeenCalledWith('fixture long password');
        await allowed.handler.handle({type, action: 'commit', passphrase: 'fixture long password', id: 'fixture-id', direction: 'merge', choices: {'0': 'local', '1': 'remote'}}, {});
        expect(allowed.service.commit).toHaveBeenCalledWith('fixture-id', 'fixture long password', 'merge', {'0': 'local', '1': 'remote'});
    });
    it('拒绝非法动作、口令、预览 ID、方向与冲突选择', async () => {
        const f = fixture();
        for (const message of [{}, {action: 'bad'}, {action: 'prepare'}, {action: 'prepare', passphrase: 1}, {action: 'commit'}, {action: 'commit', passphrase: 'fixture'}, {action: 'commit', passphrase: 'fixture', id: 'x'.repeat(65)}, {action: 'commit', passphrase: 'fixture', id: 'id', direction: 'bad'}]) expect(await f.handler.handle({type, ...message}, {})).toMatchObject({success: false});
        for (const choices of [undefined, null, [], 1, {'bad-secret-field': 'local'}, {'0': 'bad'}, Object.fromEntries(Array.from({length: 50_001}, (_, id) => [String(id), 'local']))]) expect(await f.handler.handle({type, action: 'commit', passphrase: 'fixture', id: 'id', direction: 'merge', choices}, {})).toMatchObject({success: false});
        expect(f.service.commit).not.toHaveBeenCalled();
    });
    it('只返回已知安全错误，绝不反射外部错误或密钥', async () => {
        const f = fixture();
        for (const error of [new DriveError('fixture safe drive error'), new DriveEncryptionError('fixture safe encryption error'), new DriveConfigError('fixture safe config error')]) {
            vi.mocked(f.service.status).mockRejectedValueOnce(error);
            expect(await f.handler.handle({type, action: 'status'}, {})).toEqual({success: false, error: error.message});
        }
        for (const error of [new Error('fixture-private-upstream-key'), 'fixture-private-token', null]) {
            vi.mocked(f.service.status).mockRejectedValueOnce(error);
            expect(JSON.stringify(await f.handler.handle({type, action: 'status'}, {}))).not.toContain('fixture-private');
        }
    });
});
