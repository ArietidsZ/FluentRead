/**
 * @file src/app/background/handlers/downloadProgress.ts
 * 文件职责：把离屏页面上报的模型与语言包下载进度转存到扩展本地存储，供设置页和网页内界面通过存储变化事件实时显示。
 * 主要内容：只接受来自本扩展离屏页面的进度消息，校验下载标识与字节数，按到达顺序串行写入；下载结束时删除对应键，让订阅方收到结束事件。
 * 模块边界：不发起、暂停或取消下载，也不判断资源是否已就绪；存储端口与离屏页面地址由后台组合根注入，写入失败不影响下载本身。
 */
import {
    DOWNLOAD_PROGRESS_MESSAGE,
    downloadProgressKey,
    isDownloadProgressId,
    normalizeDownloadProgress,
} from '@/src/core/download/progress';
import type {BackgroundMessageHandler} from '../messageRouter';

export interface DownloadProgressHandlerDependencies {
    readonly runtimeId: string;
    readonly offscreenUrl: string;
    readonly storage: {
        set(value: Record<string, unknown>): Promise<void>;
        remove(key: string): Promise<void>;
    };
}

interface IncomingDownloadProgressMessage {
    type: typeof DOWNLOAD_PROGRESS_MESSAGE;
    id?: unknown;
    progress?: unknown;
}

export function createDownloadProgressHandler(
    dependencies: DownloadProgressHandlerDependencies,
): BackgroundMessageHandler<unknown, IncomingDownloadProgressMessage, {success: boolean}> {
    // 结束通知必须排在最后一次进度之后落盘，否则订阅方会停在“仍在下载”。
    let writes: Promise<void> = Promise.resolve();
    return {
        type: DOWNLOAD_PROGRESS_MESSAGE,
        async handle(message, context) {
            const sender = (context as {sender?: {id?: unknown; url?: unknown}} | undefined)?.sender;
            if (sender?.id !== dependencies.runtimeId || sender.url !== dependencies.offscreenUrl) return {success: false};
            const id = message.id;
            if (!isDownloadProgressId(id)) return {success: false};
            const finished = message.progress === undefined;
            const progress = normalizeDownloadProgress(message.progress);
            if (!finished && !progress) return {success: false};
            const key = downloadProgressKey(id);
            const write = writes.then(() => progress
                ? dependencies.storage.set({[key]: progress})
                : dependencies.storage.remove(key));
            writes = write.catch(() => undefined);
            await writes;
            return {success: true};
        },
    };
}
