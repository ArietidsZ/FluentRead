import {describe, expect, it, vi} from 'vitest';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {driveSyncPayload, toDriveSyncConfig} from '@/src/core/config/driveSync';
import {decryptDriveConfig, encryptDriveConfig} from '@/src/platform/google-drive/encryption';
import {createGoogleDriveSync, type DriveSyncPorts, type DriveSyncState} from '@/src/services/config/googleDriveSync';
import type {DriveRemote} from '@/src/platform/google-drive/api';

const password = 'fixture cross device password';
const owner = {id: 'fixture-account-a', email: 'tester@fixture.invalid'};
function config(patch: Record<string, unknown> = {}) {return toDriveSyncConfig(normalizeConfig({...new Config(), videoServiceDefaultMigrated: true, ...patch}));}
function fixture() {
    let local = config({customOpenAIProviders: [{id: 'custom:fixture', name: 'Fixture', endpoint: 'https://fixture.invalid/v1', models: ['fixture-model']}], token: {openai: 'fixture-key-a'}, customHeaders: {'custom:fixture': '{"Authorization":"fixture-header-a"}'}, customBody: {openai: '{"auth":"fixture-body-a"}'}, proxy: {openai: 'https://fixture.invalid/?key=fixture-url-a'}, extra: {oauth: 'fixture-oauth-a'}});
    let remote: DriveRemote | null = null;
    let state: unknown = null;
    let account = owner;
    let clock = 1000;
    const session = () => ({account, request: async <T>(operation: (token: string) => Promise<T>) => operation('fixture-auth-token')});
    const ports: DriveSyncPorts = {
        auth: {availability: vi.fn(() => ({available: true, reason: ''})), open: vi.fn(async () => session()), disconnect: vi.fn(async () => undefined)},
        api: {
            read: vi.fn(async () => remote),
            write: vi.fn(async (_session, content) => {const file = {id: 'fixture-file', version: String(Number(remote?.file.version ?? 0) + 1), modifiedTime: 'fixture-time'}; remote = {file, content}; return file;}),
        },
        snapshot: vi.fn(async () => structuredClone(local)),
        apply: vi.fn(async value => {local = structuredClone(value);}),
        readState: vi.fn(async () => state), writeState: vi.fn(async value => {state = value;}), now: () => clock,
    };
    const service = createGoogleDriveSync(ports);
    return {service, ports, get local() {return local;}, set local(value) {local = value;}, get remote() {return remote;}, set remote(value) {remote = value;}, get state() {return state;}, set state(value) {state = value;}, set account(value: typeof owner) {account = value;}, set clock(value: number) {clock = value;}};
}
async function synced() {
    const f = fixture();
    await f.service.connect();
    const preview = await f.service.prepare(password);
    await f.service.commit(preview.id, password, 'upload', {});
    return f;
}
describe('Google Drive 同步事务', () => {
    it('MV3 后台重启后仍可用口令恢复一次性预览，暂存中没有明文凭据', async () => {
        const first = fixture();
        await first.service.connect();
        const initial = await first.service.prepare(password);
        const prepared = first.state as DriveSyncState;
        expect(JSON.stringify(prepared)).not.toMatch(/fixture-key-a|fixture-header-a|fixture-body-a|fixture-oauth-a/u);
        await createGoogleDriveSync(first.ports).commit(initial.id, password, 'upload', {});
        const existing = await first.service.prepare(password);
        await createGoogleDriveSync(first.ports).commit(existing.id, password, 'merge', {});
        expect(first.state).not.toHaveProperty('prepared');
        const second = fixture(); second.remote = first.remote;
        await second.service.connect();
        const download = await second.service.prepare(password);
        await createGoogleDriveSync(second.ports).commit(download.id, password, 'download', {});
        expect(second.local).toEqual(first.local);
    });
    it('拒绝损坏预览元数据与被人为延长的过期预览', async () => {
        const f = fixture(); await f.service.connect();
        for (const prepared of [null, {}, {id: 1}, {id: 'id'}, {id: 'id', expiresAt: 'bad'}, {id: 'id', expiresAt: 1000}, {id: 'id', expiresAt: 1000, content: 1}]) {
            f.state = {...f.state as DriveSyncState, prepared};
            expect(await f.service.status()).toMatchObject({account: owner});
        }
        const preview = await f.service.prepare(password);
        const state = f.state as DriveSyncState;
        f.clock = preview.expiresAt;
        f.state = {...state, prepared: {...state.prepared!, expiresAt: preview.expiresAt + 1000}};
        await expect(createGoogleDriveSync(f.ports).commit(preview.id, password, 'upload', {})).rejects.toThrow('失效');
        const next = await f.service.prepare(password);
        const updated = f.state as DriveSyncState;
        f.state = {...updated, prepared: {...updated.prepared!, id: 'different-id'}};
        await expect(f.service.commit('different-id', password, 'upload', {})).rejects.toThrow('失效');
        expect(next.id).not.toBe('different-id');
    });
    it('只由连接动作交互授权；首次上传前无写入，持久化只含密文基线', async () => {
        const f = fixture();
        expect(await f.service.status()).toMatchObject({account: null});
        expect(f.ports.auth.open).not.toHaveBeenCalled();
        await expect(f.service.prepare(password)).rejects.toThrow('先连接');
        expect(await f.service.connect()).toMatchObject({account: owner, lastSyncedAt: null});
        expect(f.ports.auth.open).toHaveBeenCalledWith(true);
        const preview = await f.service.prepare(password);
        expect(preview).toMatchObject({hasRemote: false, hasBaseline: false, changes: []});
        expect(f.ports.api.write).not.toHaveBeenCalled();
        await f.service.commit(preview.id, password, 'upload', {});
        const persisted = f.state as DriveSyncState;
        for (const secret of ['fixture-key-a', 'fixture-header-a', 'fixture-body-a', 'fixture-url-a', 'fixture-oauth-a', password, 'fixture-auth-token']) {expect(JSON.stringify(persisted)).not.toContain(secret); expect(f.remote!.content).not.toContain(secret);}
        expect(toDriveSyncConfig((await decryptDriveConfig(f.remote!.content, password) as {config: unknown}).config)).toEqual(f.local);
        expect(persisted).toMatchObject({connected: true, accountId: owner.id, lastSyncedAt: 1000});
        expect(f.ports.apply).not.toHaveBeenCalled();
        expect(await f.service.status()).toMatchObject({account: owner, lastSyncedAt: 1000});
        await f.service.disconnect();
        expect(await f.service.status()).toMatchObject({account: null});
        expect(f.remote).not.toBeNull();
        expect(f.ports.auth.disconnect).toHaveBeenCalledOnce();
    });
    it('第二设备必须明确下载，精确恢复凭据及其删除，口令错误不产生任何写入', async () => {
        const first = await synced();
        const second = fixture();
        second.remote = first.remote;
        second.local = config({token: {openai: 'fixture-other'}, key: 'fixture-remove-me'});
        await second.service.connect();
        await expect(second.service.prepare('wrong fixture password')).rejects.toThrow('口令不正确');
        expect(second.ports.apply).not.toHaveBeenCalled();
        expect(second.ports.api.write).not.toHaveBeenCalled();
        const preview = await second.service.prepare(password);
        expect(preview.hasBaseline).toBe(false);
        expect(JSON.stringify(preview)).not.toMatch(/fixture-key-a|fixture-remove-me/u);
        await second.service.commit(preview.id, password, 'download', {});
        expect(second.local).toEqual(first.local);
        expect(second.ports.api.write).not.toHaveBeenCalled();
        await expect(second.service.commit(preview.id, password, 'download', {})).rejects.toThrow('失效');
    });
    it('基于共同基线合并独立设置变化，私密连接冲突必须整组选择', async () => {
        const f = await synced();
        const base = f.local;
        f.local = config({...base, theme: 'dark', token: {openai: 'fixture-local-changed'}, apiKeys: {openai: ['fixture-local-changed']}});
        const remoteConfig = config({...base, to: 'fr', proxy: {openai: 'https://remote.invalid'}});
        f.remote = {file: {...f.remote!.file, version: '2'}, content: await encryptDriveConfig(driveSyncPayload(remoteConfig), password)};
        const preview = await f.service.prepare(password);
        expect(preview.hasBaseline).toBe(true);
        await expect(f.service.commit(preview.id, password, 'merge', {})).rejects.toThrow('每个冲突');
        const refreshed = await f.service.prepare(password);
        const choices = Object.fromEntries(refreshed.changes.filter(change => change.conflict).map(change => [change.id, 'remote']));
        await f.service.commit(refreshed.id, password, 'merge', choices);
        expect(f.local).toMatchObject({theme: 'dark', to: 'fr', token: {openai: 'fixture-key-a'}, proxy: {openai: 'https://remote.invalid'}});
        expect((await decryptDriveConfig(f.remote!.content, password) as {config: unknown}).config).toEqual(f.local);
    });
    it('拒绝过期、取消、口令变化、本机修改和账号切换的预览', async () => {
        const f = fixture();
        await f.service.connect();
        let preview = await f.service.prepare(password);
        f.clock = preview.expiresAt;
        await expect(f.service.commit(preview.id, password, 'upload', {})).rejects.toThrow('失效');
        preview = await f.service.prepare(password);
        await f.service.cancel();
        await expect(f.service.commit(preview.id, password, 'upload', {})).rejects.toThrow('失效');
        preview = await f.service.prepare(password);
        await expect(f.service.commit(preview.id, `${password}-changed`, 'upload', {})).rejects.toThrow('口令已修改');
        preview = await f.service.prepare(password);
        f.local = config({...f.local, to: 'de'});
        await expect(f.service.commit(preview.id, password, 'upload', {})).rejects.toThrow('本机配置已变化');
        preview = await f.service.prepare(password);
        f.account = {id: 'fixture-account-b', email: 'other@fixture.invalid'};
        await expect(f.service.commit(preview.id, password, 'upload', {})).rejects.toThrow('账号已切换');
        expect(f.ports.api.write).not.toHaveBeenCalled();
    });
    it('云端新增、删除和修改均使旧预览失效，上传失败保留本机和基线', async () => {
        const f = await synced();
        const baseline = f.state;
        const local = f.local;
        let preview = await f.service.prepare(password);
        f.remote = {...f.remote!, file: {...f.remote!.file, version: '9'}};
        await expect(f.service.commit(preview.id, password, 'upload', {})).rejects.toThrow('云端配置已变化');
        preview = await f.service.prepare(password);
        f.remote = null;
        await expect(f.service.commit(preview.id, password, 'download', {})).rejects.toThrow('云端配置已变化');
        preview = await f.service.prepare(password);
        f.remote = {file: {id: 'new-file', version: '1', modifiedTime: ''}, content: await encryptDriveConfig(driveSyncPayload(local), password)};
        await expect(f.service.commit(preview.id, password, 'upload', {})).rejects.toThrow('云端配置已变化');
        preview = await f.service.prepare(password);
        vi.mocked(f.ports.api.write).mockRejectedValueOnce(new Error('fixture upstream secret'));
        await expect(f.service.commit(preview.id, password, 'upload', {})).rejects.toThrow();
        expect(f.local).toEqual(local);
        expect(f.state).toEqual(baseline);
        expect(f.ports.apply).not.toHaveBeenCalled();
    });
    it('本机写入失败先恢复原设置，不把失败记录为同步成功', async () => {
        const f = await synced();
        const local = f.local;
        const baseline = f.state;
        f.remote = {file: {...f.remote!.file, version: '2'}, content: await encryptDriveConfig(driveSyncPayload(config({...local, to: 'de'})), password)};
        const preview = await f.service.prepare(password);
        vi.mocked(f.ports.apply).mockRejectedValueOnce(new Error('fixture storage failure'));
        await expect(f.service.commit(preview.id, password, 'download', {})).rejects.toThrow('已恢复原配置');
        expect(f.local).toEqual(local);
        expect(f.state).toEqual(baseline);
        const again = await f.service.prepare(password);
        vi.mocked(f.ports.apply).mockRejectedValue(new Error('fixture total storage failure'));
        await expect(f.service.commit(again.id, password, 'download', {})).rejects.toThrow('保存和恢复失败');
    });
    it('旧基线无法解密和换账号时不隐含合并；重新连接同账号保留基线', async () => {
        const f = await synced();
        const state = f.state as DriveSyncState;
        f.state = {...state, baseline: 'obsolete plaintext baseline'};
        expect((await f.service.prepare(password)).hasBaseline).toBe(false);
        f.state = state;
        await f.service.connect();
        expect((await f.service.prepare(password)).hasBaseline).toBe(true);
        f.account = {id: 'fixture-account-b', email: 'other@fixture.invalid'};
        expect(await f.service.status()).toMatchObject({lastSyncedAt: null});
        expect((await f.service.prepare(password)).hasBaseline).toBe(false);
        await f.service.connect();
        expect(f.state).toMatchObject({accountId: 'fixture-account-b', baseline: '', lastSyncedAt: null});
    });
    it('防御未配置浏览器、无效状态、授权失败、断开状态和不存在的同步方向', async () => {
        const f = fixture();
        for (const state of [[], {}, {version: 2}, {version: 1}, {version: 1, connected: true}, {version: 1, connected: true, accountId: 'a'}, {version: 1, connected: true, accountId: 'a', baseline: ''}, {version: 1, connected: true, accountId: 'a', baseline: '', lastSyncedAt: 'bad'}]) {f.state = state; expect(await f.service.status()).toMatchObject({account: null});}
        vi.mocked(f.ports.auth.availability).mockReturnValueOnce({available: false, reason: 'fixture unsupported'});
        expect(await f.service.status()).toMatchObject({available: false});
        await f.service.connect();
        vi.mocked(f.ports.auth.open).mockRejectedValueOnce(new Error('fixture auth failure'));
        expect(await f.service.status()).toMatchObject({account: null});
        let preview = await f.service.prepare(password);
        await expect(f.service.commit(preview.id, password, 'download', {})).rejects.toThrow('无效的同步方向');
        preview = await f.service.prepare(password);
        await f.service.disconnect();
        await expect(f.service.commit(preview.id, password, 'upload', {})).rejects.toThrow('失效');
        await f.service.connect();
        preview = await f.service.prepare(password);
        f.state = {...f.state as DriveSyncState, connected: false};
        await expect(f.service.commit(preview.id, password, 'upload', {})).rejects.toThrow('已断开');
        await expect(f.service.prepare('short')).rejects.toThrow('12');
        await expect(f.service.commit('missing', 'short', 'upload', {})).rejects.toThrow('12');
    });
});
