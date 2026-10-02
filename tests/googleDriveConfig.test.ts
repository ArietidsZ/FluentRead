import {describe, expect, it} from 'vitest';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {CONFIG_CREDENTIAL_FIELDS} from '@/src/core/config/credentials';
import {buildDriveSyncDiff, driveSyncPayload, driveValuesEqual, parseDriveSyncPayload, resolveDriveSyncDiff, toDriveSyncConfig} from '@/src/core/config/driveSync';

function complete(patch: Record<string, unknown> = {}) {return toDriveSyncConfig(normalizeConfig({...new Config(), videoServiceDefaultMigrated: true, ...patch}));}
describe('Google Drive 完整快照和安全合并', () => {
    it('保留全部指定凭据及请求体/URL 鉴权，省略本机统计和迁移状态', () => {
        const fixture = complete({customOpenAIProviders: [{id: 'custom:fixture', name: 'Fixture', endpoint: 'https://fixture.invalid/v1', models: ['fixture-model']}], token: {openai: 'fixture-key'}, customHeaders: {'custom:fixture': '{"Authorization":"fixture-header"}'}, customBody: {openai: '{"auth":"fixture-body"}'}, proxy: {openai: 'https://fixture.invalid/?token=fixture-query'}, extra: {oauth: 'fixture-oauth'}, key: 'fixture-scalar', count: 10});
        expect(fixture).toMatchObject({customOpenAIProviders: [{id: 'custom:fixture', name: 'Fixture', endpoint: 'https://fixture.invalid/v1', models: ['fixture-model']}], token: {openai: 'fixture-key'}, customHeaders: {'custom:fixture': '{"Authorization":"fixture-header"}'}, customBody: {openai: '{"auth":"fixture-body"}'}, proxy: {openai: 'https://fixture.invalid/?token=fixture-query'}, extra: {oauth: 'fixture-oauth'}, key: 'fixture-scalar'});
        for (const field of CONFIG_CREDENTIAL_FIELDS) expect(Object.hasOwn(fixture, field)).toBe(true);
        for (const field of ['count', 'persistCredentials', 'uiLanguageSetupCompleted', 'videoServiceDefaultMigrated']) expect(fixture).not.toHaveProperty(field);
        expect(parseDriveSyncPayload(driveSyncPayload(fixture))).toEqual(fixture);
    });
    it('拒绝不完整快照、恶意原型字段和复杂树', () => {
        const fixture = complete();
        for (const invalid of [null, [], {}, {format: 'fluentread-complete-config', version: 2, config: fixture}, {format: 'fluentread-complete-config', version: 1, config: {}}, {format: 'fluentread-complete-config', version: 1, config: {...fixture, token: undefined, on: null}}]) expect(() => parseDriveSyncPayload(invalid)).toThrow();
        for (const field of CONFIG_CREDENTIAL_FIELDS) {const missing = {...fixture}; delete missing[field]; expect(() => parseDriveSyncPayload(driveSyncPayload(missing))).toThrow('完整');}
        const malicious = JSON.parse('{"future":{"__proto__":{"polluted":true}}}');
        expect(() => toDriveSyncConfig({...fixture, ...malicious})).toThrow('无效字段');
        let deep: unknown = 1;
        for (let depth = 0; depth < 42; depth++) deep = {nested: deep};
        expect(() => toDriveSyncConfig({...fixture, deep})).toThrow('复杂');
        expect(() => toDriveSyncConfig({...fixture, huge: Array.from({length: 50_001}, () => 0)})).toThrow('复杂');
        expect({}).not.toHaveProperty('polluted');
    });
    it('按共同基线自动选择单边修改，并要求显式解决双方冲突', () => {
        const base = {to: 'en', theme: 'light', future: {a: 1, b: 2}, list: [1, 2]};
        const local = {...base, theme: 'dark', future: {a: 3, b: 2}, list: [2, 3]};
        const remote = {...base, to: 'fr', future: {a: 4, b: 2}};
        const diff = buildDriveSyncDiff(base, local, remote);
        expect(diff.changes.filter(change => change.conflict)).toHaveLength(1);
        expect(() => resolveDriveSyncDiff(diff, {})).toThrow('每个冲突');
        const choices = Object.fromEntries(diff.changes.filter(change => change.conflict).map(change => [change.id, 'remote']));
        expect(resolveDriveSyncDiff(diff, choices)).toEqual({to: 'fr', theme: 'dark', future: {a: 4, b: 2}, list: [2, 3]});
        expect(() => resolveDriveSyncDiff(diff, null)).toThrow('选择无效');
        expect(() => resolveDriveSyncDiff(diff, {...choices, [diff.changes[0].id]: 'bad'})).toThrow();
    });
    it('连接与凭据整组选择，不把旧密钥合并到新地址，支持明确删除', () => {
        const base = {theme: 'light', token: {openai: 'fixture-old'}, proxy: {openai: 'https://old.invalid'}, customHeaders: {openai: 'fixture-header'}};
        const local = {...base, token: {openai: 'fixture-local'}};
        const remote = {...base, proxy: {openai: 'https://new.invalid'}, customHeaders: {}};
        const diff = buildDriveSyncDiff(base, local, remote);
        expect(diff.changes).toHaveLength(1);
        expect(diff.changes[0]).toMatchObject({sensitive: true, conflict: true});
        expect(JSON.stringify(diff.changes)).not.toContain('fixture');
        expect(JSON.stringify(diff.changes)).not.toContain('.invalid');
        expect(resolveDriveSyncDiff(diff, {'0': 'remote'})).toEqual(remote);
        const deletion = buildDriveSyncDiff({future: {a: 1}, theme: 'light'}, {future: {}, theme: 'light'}, {future: {a: 1}, theme: 'dark'});
        expect(resolveDriveSyncDiff(deletion, {})).toEqual({future: {}, theme: 'dark'});
    });
    it('首次同步没有隐含方向；预览隐藏未知键和值，覆盖空值和递归相等', () => {
        const diff = buildDriveSyncDiff(null, {theme: 'light', futureSecret: 'fixture-secret', future: null, empty: '', list: []}, {theme: 'dark', futureSecret: 'remote-secret', future: {}, empty: 'secret', list: ['secret']});
        expect(diff.changes.every(change => change.conflict)).toBe(true);
        expect(JSON.stringify(diff.changes)).not.toMatch(/fixture-secret|remote-secret|futureSecret/u);
        expect(resolveDriveSyncDiff(diff, Object.fromEntries(diff.changes.map(change => [change.id, 'local'])))).toEqual(diff.draft);
        expect(driveValuesEqual({a: [1, {b: null}]}, {a: [1, {b: null}]})).toBe(true);
        for (const [left, right] of [[[], {}], [[1], [1, 2]], [{a: 1}, {b: 1}], [{a: 1}, {a: 2}], [null, 1]]) expect(driveValuesEqual(left, right)).toBe(false);
        expect(buildDriveSyncDiff({}, {}, {}).changes).toEqual([]);
    });
    it('普通设置可辨认名称和值；伪装成普通字段的复杂私密对象仍掩码', () => {
        const diff = buildDriveSyncDiff(null,
            {mouseHoverTranslationDelay: 100, selectionTranslatorDelay: 200, disableFloatingBall: false},
            {mouseHoverTranslationDelay: 300, selectionTranslatorDelay: 400, disableFloatingBall: true});
        expect(diff.changes.map(change => change.label)).toEqual(['悬停翻译延迟（毫秒） · 1', '划词翻译延迟（毫秒） · 2', '禁用悬浮球 · 3']);
        expect(diff.changes[0]).toMatchObject({local: '100', remote: '300', sensitive: false});
        expect(diff.changes[2]).toMatchObject({local: '关闭', remote: '开启'});
        expect(JSON.stringify(buildDriveSyncDiff(null, {theme: {private: 'fixture-secret'}}, {theme: 'dark'}).changes)).not.toContain('fixture-secret');
    });
    it('兼容缺省嵌套偏好并隐藏空连接、未知结构及伪装的普通字段', () => {
        const payload = complete();
        expect(() => parseDriveSyncPayload(driveSyncPayload({...payload, translationCenterServices: null, favoriteServices: null, quickTranslationProfiles: null, writing: null, harness: null}))).not.toThrow();
        expect(() => parseDriveSyncPayload(driveSyncPayload({...payload, quickTranslationProfiles: [null, {service: 'google'}]}))).not.toThrow();
        const diff = buildDriveSyncDiff(null, {theme: 'light', future: {a: 1}, customOpenAIProviders: []}, {theme: null, future: {a: 2}, customOpenAIProviders: [{name: 'fixture-private'}]});
        expect(JSON.stringify(diff.changes)).not.toContain('fixture-private');
        expect(buildDriveSyncDiff(null, {}, {token: {openai: 'fixture'}}).changes[0].local).toBe('空值');
    });
    it('拒绝各功能引用已删除服务，服务选择与连接定义必须一起合并', () => {
        const base = complete({customOpenAIProviders: [{id: 'custom:fixture', name: 'Fixture', endpoint: 'https://fixture.invalid/v1', models: ['fixture-model']}]});
        const local = complete({...base, customOpenAIProviders: []});
        for (const field of ['service', 'documentService', 'hoverTranslationService', 'selectionTranslationService', 'imageTranslationService', 'videoService', 'areaTranslationService', 'inputBoxTranslationService']) {
            const remote = complete({...base, [field]: 'custom:fixture'});
            const diff = buildDriveSyncDiff(base, local, remote);
            expect(diff.changes.filter(change => change.conflict)).toHaveLength(1);
            const merged = resolveDriveSyncDiff(diff, Object.fromEntries(diff.changes.map(change => [change.id, 'remote'])));
            expect(parseDriveSyncPayload(driveSyncPayload(merged))).toEqual(remote);
            expect(() => parseDriveSyncPayload(driveSyncPayload({...local, [field]: 'custom:fixture'}))).toThrow();
        }
        for (const patch of [{translationCenterServices: ['custom:missing']}, {favoriteServices: ['custom:missing']}, {quickTranslationProfiles: [{service: 'custom:missing'}]}, {writing: {service: 'custom:missing'}}, {harness: {service: 'custom:missing'}}]) {
            expect(() => parseDriveSyncPayload(driveSyncPayload({...local, ...patch}))).toThrow('不存在');
        }
    });

});
