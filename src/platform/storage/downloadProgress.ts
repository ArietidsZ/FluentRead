/**
 * @file src/platform/storage/downloadProgress.ts
 * 文件职责：让设置页、圈选卡片和播放器菜单订阅后台转存的下载进度，在任何扩展上下文里都能看到同一份真实进度。
 * 主要内容：按下载标识监听扩展本地存储的变化事件，把新值归一化后交给调用方；键被删除时回报 undefined 表示下载结束，并返回取消订阅函数。
 * 模块边界：只读取变化事件，不读存量值、不写存储、不发起下载；是否显示“下载中”由调用方结合自己的请求状态判断。
 */
import {downloadProgressKey, normalizeDownloadProgress, type DownloadProgress} from '@/src/core/download/progress';

interface StorageChangeEvents {
    addListener(listener: (changes: Record<string, {newValue?: unknown}>, areaName: string) => void): void;
    removeListener(listener: (changes: Record<string, {newValue?: unknown}>, areaName: string) => void): void;
}

/**
 * 只有正在进行的下载才会产生变化事件，因此收到进度即可认为下载仍在进行；
 * 上次会话残留的键不会触发回调，不会把界面卡在“下载中”。
 */
export function watchDownloadProgress(
    ids: readonly string[],
    listener: (id: string, progress: DownloadProgress | undefined) => void,
    events: StorageChangeEvents = browser.storage.onChanged,
): () => void {
    const keys = ids.map(id => [downloadProgressKey(id), id] as const);
    const handleChange = (changes: Record<string, {newValue?: unknown}>, areaName: string) => {
        if (areaName !== 'local') return;
        for (const [key, id] of keys) {
            if (Object.hasOwn(changes, key)) listener(id, normalizeDownloadProgress(changes[key].newValue));
        }
    };
    events.addListener(handleChange);
    return () => events.removeListener(handleChange);
}
