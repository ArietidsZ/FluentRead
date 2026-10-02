/**
 * @file src/app/background/handlers/googleDriveSync.ts
 * 文件职责：将加密同步协议限制在扩展设置页面的可信消息边界。
 * 主要内容：校验发送者、动作、口令、预览 ID 与冲突选择，屏蔽外部异常原文。
 * 模块边界：不读取配置或令牌；依赖服务执行同步，返回值仅含状态与隐藏内容的预览。
 */
import type {BackgroundMessageHandler} from '../messageRouter';
import type {ConfigPersistenceContext} from './configPersistence';
import type {createGoogleDriveSync} from '@/src/services/config/googleDriveSync';
import {DriveError} from '@/src/platform/google-drive/auth';
import {DriveEncryptionError} from '@/src/platform/google-drive/encryption';
import {DriveConfigError} from '@/src/core/config/driveSync';

export const GOOGLE_DRIVE_SYNC_MESSAGE_TYPE = 'googleDriveEncryptedSync';
export interface DriveSyncMessage {type: typeof GOOGLE_DRIVE_SYNC_MESSAGE_TYPE; action?: unknown; passphrase?: unknown; id?: unknown; direction?: unknown; choices?: unknown}
type Service = ReturnType<typeof createGoogleDriveSync>;
export function isGoogleDriveSettingsSender(sender: ConfigPersistenceContext['sender'], extensionId: string, optionsUrl: string): boolean {
    if (!sender?.url || sender.id !== extensionId) return false;
    try {
        const source = new URL(sender.url);
        const expected = new URL(optionsUrl);
        return source.protocol === expected.protocol && source.host === expected.host && source.pathname === expected.pathname;
    } catch {return false;}
}
export function createGoogleDriveSyncHandler(service: Service, trusted: (sender: ConfigPersistenceContext['sender']) => boolean): BackgroundMessageHandler<ConfigPersistenceContext, DriveSyncMessage> {
    return {
        type: GOOGLE_DRIVE_SYNC_MESSAGE_TYPE,
        async handle(message, context) {
            if (!trusted(context.sender)) return {success: false, error: 'Google Drive 同步仅允许从扩展设置页面操作。'};
            try {
                let data: unknown;
                if (message.action === 'status') data = await service.status();
                else if (message.action === 'connect') data = await service.connect();
                else if (message.action === 'disconnect') data = await service.disconnect();
                else if (message.action === 'cancel') data = await service.cancel();
                else if (message.action === 'prepare' && typeof message.passphrase === 'string') data = await service.prepare(message.passphrase);
                else if (message.action === 'commit' && typeof message.passphrase === 'string' && typeof message.id === 'string' && message.id.length <= 64 && ['upload', 'download', 'merge'].includes(message.direction as string)) {
                    const choices = message.choices;
                    if (!choices || typeof choices !== 'object' || Array.isArray(choices) || Object.keys(choices).length > 50_000 || !Object.entries(choices).every(([key, value]) => /^\d+$/u.test(key) && (value === 'local' || value === 'remote'))) return {success: false, error: '无效的同步差异选择。'};
                    data = await service.commit(message.id, message.passphrase, message.direction as 'upload' | 'download' | 'merge', choices as Record<string, unknown>);
                } else return {success: false, error: '无效的 Google Drive 同步操作。'};
                return {success: true, data};
            } catch (error) {
                return {success: false, error: error instanceof DriveError || error instanceof DriveEncryptionError || error instanceof DriveConfigError ? error.message : '同步未完成，请检查网络和配置存储后重新预览。'};
            }
        },
    };
}
