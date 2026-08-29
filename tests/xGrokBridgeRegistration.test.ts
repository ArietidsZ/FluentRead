import {describe, expect, it, vi} from 'vitest';
import {
    getXGrokPageBridgeMatches,
    reconcileXGrokPageBridgeRegistration,
    X_GROK_PAGE_BRIDGE_ACTIVATOR_PATH,
    X_GROK_PAGE_BRIDGE_REGISTRATION_ID,
    type XGrokBridgeRegistrationPort,
    type XGrokRegisteredContentScript,
} from '@/src/features/x-grok-translation/background/registrationCore';

function registrationFixture(initial: readonly XGrokRegisteredContentScript[] = []) {
    let registered = [...initial];
    const getRegisteredContentScripts = vi.fn(async () => [...registered]);
    const registerContentScripts = vi.fn(async (scripts: Array<{
        id: string;
        js: string[];
        matches: string[];
        persistAcrossSessions: boolean;
        runAt: 'document_start';
        world: 'MAIN';
    }>) => {
        registered.push(...scripts);
    });
    const unregisterContentScripts = vi.fn(async ({ids}: {ids: string[]}) => {
        registered = registered.filter(({id}) => !ids.includes(id));
    });
    const port: XGrokBridgeRegistrationPort = {
        getRegisteredContentScripts,
        registerContentScripts,
        unregisterContentScripts,
    };
    return {
        get registered() { return registered; },
        getRegisteredContentScripts,
        port,
        registerContentScripts,
        unregisterContentScripts,
    };
}

const ALL_MATCHES = [
    '*://x.com/*',
    '*://*.x.com/*',
    '*://twitter.com/*',
    '*://*.twitter.com/*',
];

describe('X/Grok 动态激活器 matches', () => {
    it('总开关或功能开关关闭时不注册', () => {
        expect(getXGrokPageBridgeMatches({
            on: false,
            xGrokAutoTranslateEnabled: true,
            disabledExtensionDomains: [],
        })).toEqual([]);
        expect(getXGrokPageBridgeMatches({
            on: true,
            xGrokAutoTranslateEnabled: false,
            disabledExtensionDomains: [],
        })).toEqual([]);
    });

    it('默认按稳定顺序覆盖 X 与 Twitter 的裸域和子域', () => {
        expect(getXGrokPageBridgeMatches({
            on: true,
            xGrokAutoTranslateEnabled: true,
            disabledExtensionDomains: [],
        })).toEqual(ALL_MATCHES);
    });

    it('站点禁用规则可分别缩掉 X、Twitter 或全部域名', () => {
        expect(getXGrokPageBridgeMatches({
            on: true,
            xGrokAutoTranslateEnabled: true,
            disabledExtensionDomains: ['x.com'],
        })).toEqual(ALL_MATCHES.slice(2));
        expect(getXGrokPageBridgeMatches({
            on: true,
            xGrokAutoTranslateEnabled: true,
            disabledExtensionDomains: ['twitter.com'],
        })).toEqual(ALL_MATCHES.slice(0, 2));
        expect(getXGrokPageBridgeMatches({
            on: true,
            xGrokAutoTranslateEnabled: true,
            disabledExtensionDomains: ['x.com', 'twitter.com'],
        })).toEqual([]);
    });
});

describe('X/Grok 动态激活器注册协调', () => {
    it('目标为空且当前不存在时只读取，不做多余注销', async () => {
        const fixture = registrationFixture([{id: 'another-script', matches: ['*://example.com/*']}]);
        await reconcileXGrokPageBridgeRegistration(fixture.port, []);

        expect(fixture.getRegisteredContentScripts).toHaveBeenCalledWith({
            ids: [X_GROK_PAGE_BRIDGE_REGISTRATION_ID],
        });
        expect(fixture.unregisterContentScripts).not.toHaveBeenCalled();
        expect(fixture.registerContentScripts).not.toHaveBeenCalled();
    });

    it('目标为空且当前存在时精确注销自己的注册', async () => {
        const fixture = registrationFixture([
            {id: 'another-script', matches: ['*://example.com/*']},
            {id: X_GROK_PAGE_BRIDGE_REGISTRATION_ID, matches: ALL_MATCHES},
        ]);
        await reconcileXGrokPageBridgeRegistration(fixture.port, []);

        expect(fixture.unregisterContentScripts).toHaveBeenCalledWith({
            ids: [X_GROK_PAGE_BRIDGE_REGISTRATION_ID],
        });
        expect(fixture.registerContentScripts).not.toHaveBeenCalled();
        expect(fixture.registered).toEqual([{id: 'another-script', matches: ['*://example.com/*']}]);
    });

    it('当前不存在时按 document_start MAIN world 完整注册持久激活器', async () => {
        const fixture = registrationFixture();
        await reconcileXGrokPageBridgeRegistration(fixture.port, ALL_MATCHES);

        expect(fixture.unregisterContentScripts).not.toHaveBeenCalled();
        expect(fixture.registerContentScripts).toHaveBeenCalledWith([{
            id: X_GROK_PAGE_BRIDGE_REGISTRATION_ID,
            js: [X_GROK_PAGE_BRIDGE_ACTIVATOR_PATH],
            matches: ALL_MATCHES,
            persistAcrossSessions: true,
            runAt: 'document_start',
            world: 'MAIN',
        }]);
        expect(fixture.registered[0]?.matches).not.toBe(ALL_MATCHES);
    });

    it('当前 matches 集合一致时忽略浏览器返回顺序并幂等保留', async () => {
        const fixture = registrationFixture([{
            id: X_GROK_PAGE_BRIDGE_REGISTRATION_ID,
            matches: [...ALL_MATCHES].reverse(),
        }]);
        await reconcileXGrokPageBridgeRegistration(fixture.port, [...ALL_MATCHES]);

        expect(fixture.unregisterContentScripts).not.toHaveBeenCalled();
        expect(fixture.registerContentScripts).not.toHaveBeenCalled();
    });

    it.each([
        ['缺失 matches', undefined],
        ['长度变化', [ALL_MATCHES[0]]],
        ['同长度但内容变化', [ALL_MATCHES[1], '*://example.com/*']],
    ])('当前%s时先注销再以期望集合替换', async (_label, currentMatches) => {
        const fixture = registrationFixture([{
            id: X_GROK_PAGE_BRIDGE_REGISTRATION_ID,
            matches: currentMatches,
        }]);
        const expected = ALL_MATCHES.slice(0, 2);
        await reconcileXGrokPageBridgeRegistration(fixture.port, expected);

        expect(fixture.unregisterContentScripts.mock.invocationCallOrder[0])
            .toBeLessThan(fixture.registerContentScripts.mock.invocationCallOrder[0]!);
        expect(fixture.unregisterContentScripts).toHaveBeenCalledWith({
            ids: [X_GROK_PAGE_BRIDGE_REGISTRATION_ID],
        });
        expect(fixture.registerContentScripts.mock.calls[0]?.[0]?.[0]?.matches).toEqual(expected);
    });

    it('端口读取或注册失败保持拒绝，交由后台适配器统一记录', async () => {
        const getFailure = registrationFixture();
        getFailure.getRegisteredContentScripts.mockRejectedValueOnce(new Error('get failed'));
        await expect(reconcileXGrokPageBridgeRegistration(getFailure.port, ALL_MATCHES))
            .rejects.toThrow('get failed');

        const registerFailure = registrationFixture();
        registerFailure.registerContentScripts.mockRejectedValueOnce(new Error('register failed'));
        await expect(reconcileXGrokPageBridgeRegistration(registerFailure.port, ALL_MATCHES))
            .rejects.toThrow('register failed');
    });
});
