import {describe, expect, it, vi} from 'vitest';

import {LOCAL_TTS_MODEL, LOCAL_TTS_MODEL_ID, LOCAL_TTS_MODEL_STATE_KEY} from '@/src/core/config/localTts';
import {
    createLocalTtsBackgroundHandlers,
    LOCAL_TTS_MODEL_PREPARE_MESSAGE,
    LOCAL_TTS_MODEL_REMOVE_MESSAGE,
    LOCAL_TTS_MODEL_STATE_MESSAGE,
} from '@/src/features/local-tts/background/handlers';
import {createLocalTtsOffscreenAdapter} from '@/src/features/local-tts/background/offscreenAdapter';
import {LocalTtsLanguageUnsupportedError, localTtsErrorCode} from '@/src/features/local-tts/protocol';
import type {OffscreenClient} from '@/src/platform/offscreen/client';

function createStore(initial: Record<string, unknown> = {}) {
    const data = {...initial};
    return {
        data,
        get: vi.fn(async (key: string) => (key in data ? {[key]: data[key]} : {})),
        set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(data, value); }),
    };
}

function handlersFor(offscreen: Partial<Parameters<typeof createLocalTtsBackgroundHandlers>[0]['offscreen']>, store = createStore()) {
    const handlers = createLocalTtsBackgroundHandlers({
        offscreen: {
            prepare: vi.fn(async () => ({})),
            status: vi.fn(async () => ({})),
            remove: vi.fn(async () => undefined),
            ...offscreen,
        },
        storage: store,
    });
    const byType = new Map(handlers.map((handler) => [handler.type, handler]));
    return {
        store,
        run: (type: string) => byType.get(type)!.handle({type}, undefined),
    };
}

const defaultState = {model: LOCAL_TTS_MODEL_ID, downloaded: false, downloadSizeMb: LOCAL_TTS_MODEL.downloadSizeMb};

describe('本地 TTS 模型后台消息', () => {
    it('状态查询优先采用 Offscreen 实测结果，其次是已保存状态，最后回落到未下载', async () => {
        const reported = {model: LOCAL_TTS_MODEL_ID, downloaded: true, downloadSizeMb: 170, revision: 'r1'};
        const live = handlersFor({status: vi.fn(async () => ({models: [reported]}))});
        await expect(live.run(LOCAL_TTS_MODEL_STATE_MESSAGE)).resolves.toEqual({success: true, model: LOCAL_TTS_MODEL_ID, downloaded: true, models: [reported]});
        expect(live.store.data[LOCAL_TTS_MODEL_STATE_KEY]).toEqual(reported);

        const saved = {model: LOCAL_TTS_MODEL_ID, downloaded: true, downloadSizeMb: 170};
        const fromStorage = handlersFor({status: vi.fn(async () => ({models: [{model: 'other', downloaded: true}]}))},
            createStore({[LOCAL_TTS_MODEL_STATE_KEY]: saved}));
        await expect(fromStorage.run(LOCAL_TTS_MODEL_STATE_MESSAGE)).resolves.toMatchObject({downloaded: true, models: [saved]});

        for (const models of [undefined, [null], [['array']], [{model: LOCAL_TTS_MODEL_ID, downloaded: 'yes'}]]) {
            const empty = handlersFor({status: vi.fn(async () => ({models}))}, createStore({[LOCAL_TTS_MODEL_STATE_KEY]: 'corrupt'}));
            await expect(empty.run(LOCAL_TTS_MODEL_STATE_MESSAGE)).resolves.toEqual({
                success: true, model: LOCAL_TTS_MODEL_ID, downloaded: false, models: [defaultState],
            });
        }
    });

    it('下载完成后始终记为已下载，并保留 Offscreen 返回的版本信息', async () => {
        const described = handlersFor({prepare: vi.fn(async () => ({dtype: 'q4f16', revision: 'abc', backend: 'wasm'}))});
        const response = await described.run(LOCAL_TTS_MODEL_PREPARE_MESSAGE);
        expect(response).toMatchObject({success: true, backend: 'wasm', model: LOCAL_TTS_MODEL_ID, downloaded: true});
        expect(described.store.data[LOCAL_TTS_MODEL_STATE_KEY]).toEqual({...defaultState, downloaded: true, dtype: 'q4f16', revision: 'abc'});

        const reported = {model: LOCAL_TTS_MODEL_ID, downloaded: false, downloadSizeMb: 170};
        const listed = handlersFor({prepare: vi.fn(async () => ({models: [reported], dtype: 7}))});
        await expect(listed.run(LOCAL_TTS_MODEL_PREPARE_MESSAGE)).resolves.toMatchObject({models: [{...reported, downloaded: true}]});

        const bare = handlersFor({prepare: vi.fn(async () => ({dtype: 1, revision: 2}))});
        await bare.run(LOCAL_TTS_MODEL_PREPARE_MESSAGE);
        expect(bare.store.data[LOCAL_TTS_MODEL_STATE_KEY]).toEqual({...defaultState, downloaded: true, dtype: undefined, revision: undefined});
    });

    it('清除期间拒绝重复清除和下载，失败后释放锁；状态写入按顺序串行且失败不阻塞后续写入', async () => {
        let finishRemove!: () => void;
        const remove = vi.fn(() => new Promise<void>((resolve) => { finishRemove = resolve; }));
        const store = createStore();
        store.set.mockRejectedValueOnce(new Error('quota'));
        const subject = handlersFor({remove, prepare: vi.fn(async () => ({}))}, store);

        const removing = subject.run(LOCAL_TTS_MODEL_REMOVE_MESSAGE);
        await expect(subject.run(LOCAL_TTS_MODEL_REMOVE_MESSAGE)).rejects.toThrow('正在清除本地 TTS 模型');
        await expect(subject.run(LOCAL_TTS_MODEL_PREPARE_MESSAGE)).rejects.toThrow('正在清除本地 TTS 模型');
        finishRemove();
        await expect(removing).rejects.toThrow('quota');

        remove.mockImplementationOnce(async () => undefined);
        await expect(subject.run(LOCAL_TTS_MODEL_REMOVE_MESSAGE)).resolves.toEqual({
            success: true, model: LOCAL_TTS_MODEL_ID, downloaded: false, models: [defaultState],
        });
        expect(store.data[LOCAL_TTS_MODEL_STATE_KEY]).toEqual(defaultState);
    });
});

describe('本地 TTS Offscreen 适配器', () => {
    function clientWith(send: (message: Record<string, unknown>, options?: unknown) => Promise<unknown>) {
        return {send: vi.fn(send)} as unknown as OffscreenClient & {send: ReturnType<typeof vi.fn>};
    }

    it('合成请求携带可取消 requestId 与超时，并解码 WAV 音频', async () => {
        const client = clientWith(async () => ({success: true, audioBase64: btoa('RIFF'), voice: 'zm_009', backend: 'wasm'}));
        const adapter = createLocalTtsOffscreenAdapter(client);
        const controller = new AbortController();
        const audio = await adapter.synthesize('你好', 'zh-CN', 'auto', controller.signal);

        expect(new TextDecoder().decode(audio.audio)).toBe('RIFF');
        expect(audio).toMatchObject({contentType: 'audio/wav', voice: 'zm_009', backend: 'wasm'});
        const [message, options] = client.send.mock.calls[0]!;
        expect(message).toMatchObject({type: 'LOCAL_TTS_SYNTHESIZE', text: '你好', language: 'zh-CN', voice: 'auto'});
        expect(options).toEqual({
            signal: controller.signal,
            timeoutMs: 120_000,
            cancelMessage: {type: expect.any(String), requestId: (message as {requestId: string}).requestId},
        });

        const fallbackVoice = createLocalTtsOffscreenAdapter(clientWith(async () => ({success: true, audioBase64: btoa('x'), voice: ''})));
        await expect(fallbackVoice.synthesize('hi', 'en-US', 'af_sol')).resolves.toMatchObject({voice: 'af_sol'});
    });

    it('失败响应重建为带稳定错误码的 Error，供后台策略跨消息边界识别', async () => {
        const unsupported = new LocalTtsLanguageUnsupportedError('fr-FR');
        const adapter = createLocalTtsOffscreenAdapter(clientWith(async (message) => {
            if (message.type === 'LOCAL_TTS_SYNTHESIZE') return {success: false, error: unsupported.message, errorCode: unsupported.code};
            return undefined;
        }));
        const error = await adapter.synthesize('bonjour', 'fr-FR', 'auto').catch((reason: unknown) => reason);
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(LocalTtsLanguageUnsupportedError);
        expect(localTtsErrorCode(error)).toBe('local-tts-language-unsupported');
        expect((error as Error).message).toBe('本地 TTS 暂不支持语言：fr-FR');

        for (const response of [{success: true, audioBase64: ''}, {success: true}, {success: false, error: ''}]) {
            const empty = createLocalTtsOffscreenAdapter(clientWith(async () => response));
            await expect(empty.synthesize('x', 'zh-CN', 'auto')).rejects.toThrow('本地 TTS 合成失败');
        }
        await expect(adapter.prepare()).rejects.toThrow('本地 TTS 模型下载失败');
        await expect(adapter.status()).rejects.toThrow('无法读取本地 TTS 模型状态');
        await expect(adapter.remove()).rejects.toThrow('本地 TTS 模型清除失败');
        expect(localTtsErrorCode(await adapter.remove().catch((reason: unknown) => reason))).toBeUndefined();
        expect(new LocalTtsLanguageUnsupportedError('').message).toBe('本地 TTS 暂不支持语言：未知语言');
    });

    it('模型管理请求使用各自的超时并原样返回成功响应', async () => {
        const client = clientWith(async (message) => ({success: true, type: message.type}));
        const adapter = createLocalTtsOffscreenAdapter(client);
        await expect(adapter.prepare(true)).resolves.toEqual({success: true, type: 'LOCAL_TTS_PREPARE'});
        await expect(adapter.status()).resolves.toEqual({success: true, type: 'LOCAL_TTS_STATUS'});
        await expect(adapter.remove()).resolves.toBeUndefined();
        expect(client.send.mock.calls.map(([message, options]) => [message, options])).toEqual([
            [{type: 'LOCAL_TTS_PREPARE', keepWarm: true}, {timeoutMs: 300_000}],
            [{type: 'LOCAL_TTS_STATUS'}, {timeoutMs: 30_000}],
            [{type: 'LOCAL_TTS_REMOVE_MODEL'}, {timeoutMs: 30_000}],
        ]);
        await adapter.prepare();
        expect(client.send.mock.calls.at(-1)?.[0]).toEqual({type: 'LOCAL_TTS_PREPARE', keepWarm: false});
    });
});
