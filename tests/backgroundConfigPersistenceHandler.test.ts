import {describe, expect, it, vi} from 'vitest';

import {
    CONFIG_PERSIST_MESSAGE_TYPE,
    createConfigPersistenceHandler,
    type ConfigPersistenceDependencies,
} from '@/src/app/background/handlers/configPersistence';
import {createBackgroundMessageRouter} from '@/src/app/background/messageRouter';

interface TestConfig {
    marker: string;
    allowCredentialUpdates?: boolean;
}

function createDependencies(overrides: Partial<ConfigPersistenceDependencies<TestConfig>> = {}) {
    const current = {marker: 'current'};
    const dependencies: ConfigPersistenceDependencies<TestConfig> = {
        ready: Promise.resolve(),
        getCurrentConfig: vi.fn(() => current),
        prepareConfigSaveRequest: vi.fn((incomingConfig, _currentConfig, allowCredentialUpdates) => ({
            marker: String(incomingConfig.marker),
            allowCredentialUpdates,
        })),
        saveConfig: vi.fn(async () => undefined),
        isExtensionUrl: vi.fn((url) => url.startsWith('chrome-extension://extension-id/')),
        ...overrides,
    };
    return dependencies;
}

describe('background config persistence handler', () => {
    it('按扩展 sender 权限保存配置，并记录历史', async () => {
        const dependencies = createDependencies();
        const router = createBackgroundMessageRouter([
            createConfigPersistenceHandler(dependencies),
        ]);

        await expect(router.dispatch({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'extension-save'},
            clientId: 'options-page',
            sequence: 1,
        }, {sender: {url: 'chrome-extension://extension-id/options.html'}})).resolves.toEqual({
            handled: true,
            response: {success: true},
        });

        expect(dependencies.prepareConfigSaveRequest).toHaveBeenCalledWith(
            {marker: 'extension-save'},
            {marker: 'current'},
            true,
        );
        expect(dependencies.saveConfig).toHaveBeenCalledWith(
            {marker: 'extension-save', allowCredentialUpdates: true},
            {recordHistory: true},
        );
    });

    it('content sender 使用 legacy clientId fallback，且不能更新凭据', async () => {
        const dependencies = createDependencies();
        const handler = createConfigPersistenceHandler(dependencies);

        await expect(handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'content-save'},
        }, {
            sender: {
                id: 'content-script',
                url: 'https://example.com/article',
                frameId: 3,
                tab: {id: 7},
            },
        })).resolves.toEqual({success: true});

        expect(dependencies.prepareConfigSaveRequest).toHaveBeenCalledWith(
            {marker: 'content-save'},
            {marker: 'current'},
            false,
        );
    });

    it('同一 client 并发保存只让最新 sequence 落盘', async () => {
        const dependencies = createDependencies();
        const handler = createConfigPersistenceHandler(dependencies);

        const first = handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'old'},
            clientId: 'popup',
            sequence: 1,
        }, {});
        const second = handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'new'},
            clientId: 'popup',
            sequence: 2,
        }, {});

        await expect(Promise.all([first, second])).resolves.toEqual([{success: true}, {success: true}]);
        expect(dependencies.saveConfig).toHaveBeenCalledOnce();
        expect(dependencies.saveConfig).toHaveBeenCalledWith(
            {marker: 'new', allowCredentialUpdates: false},
            {recordHistory: true},
        );
    });

    it('tabId 为 0 时仍保留独立 fallback client 身份', async () => {
        const dependencies = createDependencies();
        const handler = createConfigPersistenceHandler(dependencies);

        const first = handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'tab-zero'},
            sequence: 1,
        }, {sender: {tab: {id: 0}, frameId: 0}});
        const second = handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'extension-page'},
            sequence: 2,
        }, {sender: {frameId: 0}});

        await expect(Promise.all([first, second])).resolves.toEqual([{success: true}, {success: true}]);
        expect(dependencies.saveConfig).toHaveBeenCalledTimes(2);
        expect(dependencies.saveConfig).toHaveBeenNthCalledWith(
            1,
            {marker: 'tab-zero', allowCredentialUpdates: false},
            {recordHistory: true},
        );
        expect(dependencies.saveConfig).toHaveBeenNthCalledWith(
            2,
            {marker: 'extension-page', allowCredentialUpdates: false},
            {recordHistory: true},
        );
    });

    it('过期 sequence 直接成功返回，不重复覆盖最新配置', async () => {
        const dependencies = createDependencies();
        const handler = createConfigPersistenceHandler(dependencies);

        await handler.handle({type: CONFIG_PERSIST_MESSAGE_TYPE, config: {marker: 'new'}, clientId: 'options', sequence: 8}, {});
        await expect(handler.handle({
            type: CONFIG_PERSIST_MESSAGE_TYPE,
            config: {marker: 'old'},
            clientId: 'options',
            sequence: 7,
        }, {})).resolves.toEqual({success: true});

        expect(dependencies.saveConfig).toHaveBeenCalledOnce();
        expect(dependencies.saveConfig).toHaveBeenCalledWith(
            {marker: 'new', allowCredentialUpdates: false},
            {recordHistory: true},
        );
    });

    it('无 sequence 保存保持队列顺序，前一个失败后后续请求仍可继续', async () => {
        let releaseFirst!: () => void;
        const firstStarted = new Promise<void>((resolve) => { releaseFirst = resolve; });
        const saveOrder: string[] = [];
        const dependencies = createDependencies({
            saveConfig: vi.fn(async (config) => {
                saveOrder.push(config.marker);
                if (config.marker === 'first') {
                    await firstStarted;
                    throw new Error('first failed');
                }
            }),
        });
        const handler = createConfigPersistenceHandler(dependencies);

        const first = handler.handle({type: CONFIG_PERSIST_MESSAGE_TYPE, config: {marker: 'first'}}, {});
        const second = handler.handle({type: CONFIG_PERSIST_MESSAGE_TYPE, config: {marker: 'second'}}, {});
        await vi.waitFor(() => expect(saveOrder).toEqual(['first']));
        releaseFirst();

        await expect(first).rejects.toThrow('first failed');
        await expect(second).resolves.toEqual({success: true});
        expect(saveOrder).toEqual(['first', 'second']);
    });

    it.each([
        [{type: CONFIG_PERSIST_MESSAGE_TYPE}, 'config'],
        [{type: CONFIG_PERSIST_MESSAGE_TYPE, config: []}, 'config'],
        [{type: CONFIG_PERSIST_MESSAGE_TYPE, config: {}, clientId: ''}, 'clientId'],
        [{type: CONFIG_PERSIST_MESSAGE_TYPE, config: {}, clientId: 42}, 'clientId'],
        [{type: CONFIG_PERSIST_MESSAGE_TYPE, config: {}, sequence: -1}, 'sequence'],
        [{type: CONFIG_PERSIST_MESSAGE_TYPE, config: {}, sequence: 1.5}, 'sequence'],
    ])('拒绝非法配置保存消息 %#', async (message, field) => {
        const handler = createConfigPersistenceHandler(createDependencies());

        await expect(handler.handle(message, {})).rejects.toThrow(field);
    });
});
