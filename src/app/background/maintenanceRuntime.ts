/**
 * @file src/app/background/maintenanceRuntime.ts
 * 文件职责：把浏览器运行时能力接入后台维护任务，统一安装配置自动备份与翻译缓存清理生命周期。
 * 主要内容：将 browser.alarms、当前时间、备份 store 和告警输出适配给可测试的自动备份 runtime，并继续注册已有缓存清理任务。
 * 模块边界：本文件是后台组合层，不实现到期算法、快照格式或缓存清理策略；具体行为分别留在 configAutoBackupRuntime、services/config 和 cacheCleanup。
 */
import {installTranslationCacheCleanup} from './cacheCleanup';
import {
    installConfigAutoBackupRuntime,
    type ConfigAutoBackupAlarmApi,
} from './configAutoBackupRuntime';
import {
    captureConfigAutoBackup,
    configAutoBackupsReady,
    getConfigAutoBackupsSnapshot,
} from '@/src/services/config/autoBackupStore';

/** 把浏览器 alarm/storage 适配到可独立测试的后台维护任务。 */
export function installBackgroundMaintenance(): void {
    installConfigAutoBackupRuntime({
        alarms: browser.alarms as unknown as ConfigAutoBackupAlarmApi,
        ready: configAutoBackupsReady,
        getSnapshot: getConfigAutoBackupsSnapshot,
        capture: (options) => captureConfigAutoBackup(options),
        now: () => Date.now(),
        warn: (message, error) => console.warn(message, error),
    });
    installTranslationCacheCleanup();
}
