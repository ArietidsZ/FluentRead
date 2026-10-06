/**
 * @file tests/downloadProgressTransport.test.ts
 * 文件职责：验证下载进度从离屏页面经后台转存、再由界面订阅的整条通道只接受可信来源，并且结束通知不会被进度覆盖。
 * 主要内容：覆盖后台 handler 的来源校验、标识与数值校验、串行写入和写入失败，以及存储变化订阅的区域过滤、多标识分发、结束事件和取消订阅。
 * 模块边界：使用内存存储端口和假的变化事件，不启动浏览器、不发起下载。
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createDownloadProgressHandler} from '@/src/app/background/handlers/downloadProgress';
import {DOWNLOAD_PROGRESS_MESSAGE, downloadProgressKey, type DownloadProgress} from '@/src/core/download/progress';
import {watchDownloadProgress} from '@/src/platform/storage/downloadProgress';

const runtimeId = 'fluentread-extension';
const offscreenUrl = 'chrome-extension://fluentread-extension/offscreen.html';
const trusted = {sender: {id: runtimeId, url: offscreenUrl}};

afterEach(() => vi.unstubAllGlobals());

function createHandler() {
    const values = new Map<string, unknown>();
    const operations: string[] = [];
    const storage = {
        set: vi.fn(async (value: Record<string, unknown>) => {
            for (const [key, item] of Object.entries(value)) { values.set(key, item); operations.push(`set:${key}`); }
        }),
        remove: vi.fn(async (key: string) => { values.delete(key); operations.push(`remove:${key}`); }),
    };
    const handler = createDownloadProgressHandler({runtimeId, offscreenUrl, storage});
    const send = (message: Record<string, unknown>, context: unknown = trusted) =>
        handler.handle({type: DOWNLOAD_PROGRESS_MESSAGE, ...message}, context);
    return {handler, send, storage, values, operations};
}

describe('background download progress handler', () => {
    it('stores normalized progress from the offscreen document and removes the key when the download ends', async () => {
        const {handler, send, values, operations} = createHandler();
        expect(handler.type).toBe(DOWNLOAD_PROGRESS_MESSAGE);
        const key = downloadProgressKey('local-tts');
        await expect(send({id: 'local-tts', progress: {loaded: 12, total: 10}})).resolves.toEqual({success: true});
        expect(values.get(key)).toEqual({loaded: 12, total: 12});
        // 进度与结束通知几乎同时到达时，删除必须排在写入之后。
        const results = await Promise.all([
            send({id: 'local-tts', progress: {loaded: 20, total: 40}}),
            send({id: 'local-tts'}),
        ]);
        expect(results).toEqual([{success: true}, {success: true}]);
        expect(operations).toEqual([`set:${key}`, `set:${key}`, `remove:${key}`]);
        expect(values.has(key)).toBe(false);
    });

    it('ignores other senders, malformed ids and malformed progress without touching storage', async () => {
        const {send, storage} = createHandler();
        const progress = {loaded: 1, total: 2};
        for (const context of [
            null,
            {},
            {sender: {id: 'another-extension', url: offscreenUrl}},
            {sender: {id: runtimeId, url: 'chrome-extension://fluentread-extension/options.html'}},
            {sender: {id: runtimeId, url: 'https://example.com/offscreen.html'}},
        ]) {
            await expect(send({id: 'local-tts', progress}, context)).resolves.toEqual({success: false});
        }
        for (const message of [
            {progress},
            {id: 'Not An Id', progress},
            {id: 'local-tts', progress: {loaded: -1, total: 2}},
            {id: 'local-tts', progress: 'half'},
            {id: 'local-tts', progress: null},
        ]) {
            await expect(send(message)).resolves.toEqual({success: false});
        }
        expect(storage.set).not.toHaveBeenCalled();
        expect(storage.remove).not.toHaveBeenCalled();
    });

    it('keeps accepting progress after a storage write fails', async () => {
        const {send, storage, values} = createHandler();
        storage.set.mockRejectedValueOnce(new Error('quota'));
        await expect(send({id: 'video-model:tiny', progress: {loaded: 1, total: 4}})).resolves.toEqual({success: true});
        await expect(send({id: 'video-model:tiny', progress: {loaded: 2, total: 4}})).resolves.toEqual({success: true});
        expect(values.get(downloadProgressKey('video-model:tiny'))).toEqual({loaded: 2, total: 4});
    });
});

describe('download progress subscription', () => {
    function createEvents() {
        const listeners = new Set<(changes: Record<string, {newValue?: unknown}>, areaName: string) => void>();
        return {
            listeners,
            addListener: (listener: (changes: Record<string, {newValue?: unknown}>, areaName: string) => void) => { listeners.add(listener); },
            removeListener: (listener: (changes: Record<string, {newValue?: unknown}>, areaName: string) => void) => { listeners.delete(listener); },
            emit(changes: Record<string, {newValue?: unknown}>, areaName = 'local') { for (const listener of listeners) listener(changes, areaName); },
        };
    }

    it('delivers progress and finish events only for watched ids in the local area', () => {
        const events = createEvents();
        const received: Array<[string, DownloadProgress | undefined]> = [];
        const stop = watchDownloadProgress(['local-tts', 'video-model:tiny'], (id, progress) => received.push([id, progress]), events);
        events.emit({[downloadProgressKey('local-tts')]: {newValue: {loaded: 3, total: 9}}, [downloadProgressKey('ocr-language:eng')]: {newValue: {loaded: 1, total: 2}}});
        events.emit({[downloadProgressKey('video-model:tiny')]: {newValue: {loaded: 1, total: 2}}}, 'sync');
        events.emit({unrelated: {newValue: 1}});
        events.emit({[downloadProgressKey('video-model:tiny')]: {newValue: 'corrupt'}});
        events.emit({[downloadProgressKey('local-tts')]: {}});
        expect(received).toEqual([
            ['local-tts', {loaded: 3, total: 9}],
            ['video-model:tiny', undefined],
            ['local-tts', undefined],
        ]);
        stop();
        expect(events.listeners.size).toBe(0);
        events.emit({[downloadProgressKey('local-tts')]: {newValue: {loaded: 9, total: 9}}});
        expect(received).toHaveLength(3);
    });

    it('subscribes to the extension storage change event by default', () => {
        const events = createEvents();
        vi.stubGlobal('browser', {storage: {onChanged: events}});
        const listener = vi.fn();
        const stop = watchDownloadProgress(['local-tts'], listener);
        events.emit({[downloadProgressKey('local-tts')]: {newValue: {loaded: 1, total: 0}}});
        expect(listener).toHaveBeenCalledWith('local-tts', {loaded: 1, total: 0});
        stop();
        expect(events.listeners.size).toBe(0);
    });
});
