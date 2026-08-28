/**
 * @file src/app/background/configMessageHandlers.ts
 * 文件职责：集中组装后台配置消息处理器，使保存、翻译计数、历史恢复和自动备份恢复共享同一条修改队列。
 * 主要内容：连接配置 store 与四类 handler，注入当前修订号、扩展 URL 校验和 mutation coordinator，并输出供 message runtime 注册的处理器集合。
 * 模块边界：本文件属于后台 composition root，只负责依赖接线；消息参数校验位于 handlers，配置归一化、持久化和恢复规则位于 services/config。
 */
import {
    applyConfigHistoryAction,
    config,
    configReady,
    getConfigRevision,
    incrementConfigCount,
    prepareConfigSaveRequest,
    saveConfig,
} from '@/src/services/config/store';
import {restoreConfigAutoBackup} from '@/src/services/config/autoBackupStore';
import type {BackgroundMessageHandler} from './messageRouter';
import {createConfigAutoBackupRestoreHandler} from './handlers/configAutoBackup';
import {createConfigCountIncrementHandler} from './handlers/configCount';
import {createConfigHistoryHandler} from './handlers/configHistory';
import {
    createConfigMutationCoordinator,
    createConfigPersistenceHandler,
    type ConfigPersistenceContext,
} from './handlers/configPersistence';

/** 把配置保存、计数、历史与备份恢复放入同一 mutation 队列。 */
export function createConfigBackgroundHandlers<TContext extends ConfigPersistenceContext>(): Array<BackgroundMessageHandler<TContext>> {
    const mutations = createConfigMutationCoordinator();
    return [
        createConfigCountIncrementHandler((delta, operationId) => (
            mutations.run(() => incrementConfigCount(delta, operationId))
        )),
        createConfigHistoryHandler((action, version) => (
            mutations.run(() => applyConfigHistoryAction(action, version))
        )),
        createConfigAutoBackupRestoreHandler((version) => (
            mutations.run(() => restoreConfigAutoBackup(version))
        )),
        createConfigPersistenceHandler({
            ready: configReady,
            getCurrentConfig: () => config,
            prepareConfigSaveRequest,
            saveConfig,
            getCurrentRevision: getConfigRevision,
            runMutation: mutations.run,
            isExtensionUrl: (url) => url.startsWith(browser.runtime.getURL('/')),
        }),
    ] as Array<BackgroundMessageHandler<TContext>>;
}
