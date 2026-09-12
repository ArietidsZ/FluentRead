import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createOffscreenMessageListener} from '@/src/app/offscreen/messageRouter';
import {createLocalTranslationOffscreenAdapter} from '@/src/platform/offscreen/localTranslation';
import {
  LOCAL_TRANSLATION_MODEL_IDS,
  LOCAL_TRANSLATION_MODEL_STATE_KEY,
  LOCAL_TRANSLATION_DOWNLOAD_STATE_KEY,
} from '@/src/core/config/localTranslation';
import {createLocalTranslationBackgroundHandlers} from '@/src/features/local-translation/background/handlers';
import {OFFSCREEN_CANCEL_LOCAL_TRANSLATION_MESSAGE_TYPE} from '@/src/platform/offscreen/client';

const send = vi.fn();
const client = {
  send,
  sendIfPresent: vi.fn(),
  ensureDocument: vi.fn(),
  hasDocument: vi.fn(),
} as any;

const baseOffscreenDependencies = {
  ttsPlayer: {play: vi.fn(async () => undefined), stop: vi.fn(() => true)},
  recognizeImage: vi.fn(async () => []),
  fetchImage: vi.fn(async () => 'data:image/png;base64,image'),
  translateImage: vi.fn(async () => ({image: 'image', lines: []})),
  translateArea: vi.fn(async () => ({image: 'image', lines: []})),
  downloadOcrLanguages: vi.fn(async () => undefined),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('local translation Offscreen adapter', () => {
  it('forwards detection context without changing the source text', async () => {
    send.mockResolvedValue({success: true, result: '译文'});
    await createLocalTranslationOffscreenAdapter(client).translate({text: 'Reduce Waste during Filament Change',
      sourceLanguage: 'auto', targetLanguage: 'zh', sourceLanguageDetectionText: 'English paragraph context'});
    expect(send.mock.calls[0][0]).toMatchObject({text: 'Reduce Waste during Filament Change', sourceLanguageDetectionText: 'English paragraph context'});
  });
  it('forwards model, language pair, cancellation and timeout metadata', async () => {
    send.mockResolvedValueOnce({success: true, result: '译文'});
    const adapter = createLocalTranslationOffscreenAdapter(client);
    const controller = new AbortController();
    await expect(adapter.translate({
      model: LOCAL_TRANSLATION_MODEL_IDS.m2m100,
      text: 'Hello',
      sourceLanguage: 'en',
      targetLanguage: 'zh-Hans',
    }, {signal: controller.signal, timeoutMs: 20_000})).resolves.toBe('译文');
    expect(send).toHaveBeenCalledWith({
      type: 'LOCAL_TRANSLATION_TRANSLATE',
      requestId: expect.any(String),
      model: LOCAL_TRANSLATION_MODEL_IDS.m2m100,
      text: 'Hello',
      sourceLanguage: 'en',
      targetLanguage: 'zh-Hans',
    }, {
      signal: controller.signal,
      timeoutMs: 20_000,
      cancelMessage: {
        type: OFFSCREEN_CANCEL_LOCAL_TRANSLATION_MESSAGE_TYPE,
        requestId: expect.any(String),
      },
    });
    const sent = send.mock.calls[0]?.[0];
    const options = send.mock.calls[0]?.[1];
    expect(options.cancelMessage.requestId).toBe(sent.requestId);
  });

  it('validates prepare, status and remove responses', async () => {
    send
      .mockResolvedValueOnce({success: true, model: LOCAL_TRANSLATION_MODEL_IDS.m2m100})
      .mockResolvedValueOnce({success: true, models: []})
      .mockResolvedValueOnce({success: true});
    const adapter = createLocalTranslationOffscreenAdapter(client);
    await expect(adapter.prepare(LOCAL_TRANSLATION_MODEL_IDS.m2m100)).resolves.toMatchObject({success: true});
    await expect(adapter.status()).resolves.toMatchObject({success: true});
    await expect(adapter.remove(LOCAL_TRANSLATION_MODEL_IDS.m2m100)).resolves.toBeUndefined();
    expect(send).toHaveBeenNthCalledWith(1, expect.objectContaining({type: 'LOCAL_TRANSLATION_PREPARE'}), {timeoutMs: 30_000});
    expect(send).toHaveBeenNthCalledWith(2, {type: 'LOCAL_TRANSLATION_STATUS'}, {timeoutMs: 30_000});
    expect(send).toHaveBeenNthCalledWith(3, expect.objectContaining({type: 'LOCAL_TRANSLATION_REMOVE_MODEL'}), {timeoutMs: 30_000});
  });
});

describe('local translation paragraph language detection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('@/src/features/local-translation/offscreen/downloads');
    vi.resetModules();
  });

  it('uses real detection with paragraph context, preserves explicit choices and handles blank context', async () => {
    vi.resetModules();
    vi.doMock('@/src/features/local-translation/offscreen/downloads', () => ({
      createLocalTranslationDownloadManager: () => ({status: async () => ({tasks: [{model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, phase: 'ready'}]})}),
    }));
    const posted: any[] = [];
    class FakeWorker {
      onmessage?: (event: any) => void;
      postMessage(message: any) {
        posted.push(message);
        queueMicrotask(() => this.onmessage?.({data: {requestId: message.requestId, success: true, result: '译文'}}));
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('window', {setTimeout, clearTimeout, location: {href: 'https://extension.test/offscreen.html'}});
    const {translateLocalText, disposeLocalTranslationWorker} = await import('@/src/features/local-translation/offscreen/translation');
    const text = 'Reduce Waste during Filament Change';
    const paragraph = 'When switching between different filaments for printing, the printer flushes the remaining material to avoid color mixing. ' + text;
    const request = {model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, text, sourceLanguage: 'auto', targetLanguage: 'zh'};
    try {
      await expect(translateLocalText(request)).rejects.toThrow('LANGUAGE_UNSUPPORTED');
      await expect(translateLocalText({...request, sourceLanguageDetectionText: paragraph})).resolves.toBe('译文');
      expect(posted.at(-1)).toMatchObject({text, sourceLanguage: 'en', targetLanguage: 'zh'});
      expect(posted.at(-1)).not.toHaveProperty('sourceLanguageDetectionText');
      await expect(translateLocalText({...request, sourceLanguage: 'fr', sourceLanguageDetectionText: paragraph})).rejects.toThrow('LANGUAGE_UNSUPPORTED');
      for (const context of [undefined, '', '  ', [], {}]) {
        await expect(translateLocalText({...request, text: paragraph, sourceLanguageDetectionText: context})).resolves.toBe('译文');
      }
    } finally {
      disposeLocalTranslationWorker();
    }
  });
});

describe('local translation background handlers', () => {
  it('acknowledges background jobs without marking them downloaded and only persists trusted completed progress', async () => {
    let stored: Record<string, unknown> = {[LOCAL_TRANSLATION_MODEL_STATE_KEY]: []};
    const offscreen = {
      prepare: vi.fn(async () => ({success: true, model: LOCAL_TRANSLATION_MODEL_IDS.m2m100})),
      status: vi.fn(async () => ({models: [{model: LOCAL_TRANSLATION_MODEL_IDS.m2m100, downloaded: true}]})),
      remove: vi.fn(async () => undefined),
      pause: vi.fn(async () => ({success: true})),
      translate: vi.fn(async () => 'result'),
    };
    const handlers = createLocalTranslationBackgroundHandlers({
      offscreen,
      isTrustedProgress: (context) => context === 'offscreen',
      storage: {
        get: async () => stored,
        set: async (value) => { stored = {...stored, ...value}; },
      },
    });
    const prepare = handlers.find((item) => item.type === 'fluentReadPrepareLocalTranslationModel')!;
    const state = handlers.find((item) => item.type === 'fluentReadGetLocalTranslationModelState')!;
    const remove = handlers.find((item) => item.type === 'fluentReadRemoveLocalTranslationModel')!;

    await expect(prepare.handle({type: 'fluentReadPrepareLocalTranslationModel', model: LOCAL_TRANSLATION_MODEL_IDS.m2m100} as any, {})).resolves.toMatchObject({
      success: true,
      model: LOCAL_TRANSLATION_MODEL_IDS.m2m100,
    });
    expect(stored[LOCAL_TRANSLATION_MODEL_STATE_KEY]).toEqual([]);
    await expect(state.handle({type: 'fluentReadGetLocalTranslationModelState'}, {})).resolves.toEqual({success: true, models: [{model: LOCAL_TRANSLATION_MODEL_IDS.m2m100, downloaded: true}]});
    const progress = handlers.find((item) => item.type === 'fluentReadLocalTranslationDownloadProgress')!;
    const snapshot = {version: 2, tasks: [{model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, phase: 'ready', downloadedBytes: 20, totalBytes: 20, bytesPerSecond: 0, updatedAt: 2}]};
    await expect(progress.handle({type: progress.type, snapshot} as any, {})).resolves.toEqual({success: false});
    expect(stored[LOCAL_TRANSLATION_MODEL_STATE_KEY]).toEqual([]);
    await expect(progress.handle({type: progress.type, snapshot} as any, 'offscreen')).resolves.toEqual({success: true});
    expect(stored[LOCAL_TRANSLATION_MODEL_STATE_KEY]).toEqual([LOCAL_TRANSLATION_MODEL_IDS.opusZhEn]);
    await progress.handle({type: progress.type, snapshot: {...snapshot, tasks: [{...snapshot.tasks[0], phase: 'downloading', updatedAt: 1}]}} as any, 'offscreen');
    expect(stored[LOCAL_TRANSLATION_DOWNLOAD_STATE_KEY]).toEqual(snapshot);
    await expect(remove.handle({type: 'fluentReadRemoveLocalTranslationModel', model: LOCAL_TRANSLATION_MODEL_IDS.m2m100} as any, {})).resolves.toMatchObject({success: true});
    expect(offscreen.prepare).toHaveBeenCalledOnce();
    expect(offscreen.remove).toHaveBeenCalledOnce();
  });
});

describe('local translation Offscreen message route', () => {
  const request = {
    target: 'offscreen', type: 'LOCAL_TRANSLATION_TRANSLATE', requestId: 'route-1',
    model: LOCAL_TRANSLATION_MODEL_IDS.opusZhEn, text: 'Hello', sourceLanguage: 'en', targetLanguage: 'zh',
  };
  const localDependencies = () => ({
    translate: vi.fn(async (): Promise<unknown> => 'translated'),
    prepare: vi.fn(async () => ({phase: 'queued'})),
    pause: vi.fn(async () => ({phase: 'paused'})),
    status: vi.fn(async () => ({models: []})),
    removeModel: vi.fn(async () => undefined),
  });
  const route = (localTranslation?: ReturnType<typeof localDependencies>) => {
    const listener = createOffscreenMessageListener({
      ...baseOffscreenDependencies, translate: vi.fn(async () => 'chrome'), localTranslation,
    });
    return (message: Record<string, unknown>) => new Promise<any>((resolve) => {
      expect(listener({...request, ...message}, {}, resolve)).toBe(true);
    });
  };

  it.each(['PREPARE', 'PAUSE', 'STATUS', 'REMOVE_MODEL', 'TRANSLATE'])('rejects %s when local execution is unavailable', async (operation) => {
    await expect(route()({type: `LOCAL_TRANSLATION_${operation}`})).resolves.toMatchObject({success: false});
  });

  it.each([
    ['PREPARE', 'prepare', {success: true, phase: 'queued'}],
    ['PAUSE', 'pause', {success: true, phase: 'paused'}],
    ['STATUS', 'status', {success: true, models: []}],
    ['REMOVE_MODEL', 'removeModel', {success: true}],
  ] as const)('forwards %s and returns its snapshot', async (operation, method, response) => {
    const local = localDependencies();
    await expect(route(local)({type: `LOCAL_TRANSLATION_${operation}`})).resolves.toEqual(response);
    expect(local[method]).toHaveBeenCalledOnce();
  });

  it.each([
    {model: 'unknown'}, {sourceLanguageDetectionText: 42}, {requestId: 'invalid request'},
  ])('rejects invalid translation fields %j before execution', async (fields) => {
    const local = localDependencies();
    await expect(route(local)(fields)).resolves.toMatchObject({success: false});
    expect(local.translate).not.toHaveBeenCalled();
  });

  it('preserves a valid detection context and rejects duplicate active identifiers', async () => {
    const local = localDependencies();
    let finish!: (value: string) => void;
    local.translate.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const dispatch = route(local);
    const result = dispatch({sourceLanguageDetectionText: 'English context'});
    await vi.waitFor(() => expect(local.translate).toHaveBeenCalledOnce());
    await expect(dispatch({})).resolves.toMatchObject({success: false, error: expect.stringContaining('正在执行')});
    finish('translated');
    await expect(result).resolves.toEqual({success: true, result: 'translated', requestId: 'route-1'});
  });

  it.each(['reject', 'invalid-result'] as const)('reports executor failure: %s', async (mode) => {
    const local = localDependencies();
    if (mode === 'reject') local.translate.mockRejectedValue(new Error('executor failed'));
    else local.translate.mockResolvedValue(null);
    await expect(route(local)({})).resolves.toMatchObject({success: false, requestId: 'route-1'});
  });

  it('validates cancellation and safely acknowledges an already settled request', async () => {
    const dispatch = route(localDependencies());
    await expect(dispatch({type: OFFSCREEN_CANCEL_LOCAL_TRANSLATION_MESSAGE_TYPE, requestId: 'invalid request'}))
      .resolves.toMatchObject({success: false});
    await expect(dispatch({type: OFFSCREEN_CANCEL_LOCAL_TRANSLATION_MESSAGE_TYPE}))
      .resolves.toEqual({success: true, cancelled: false, requestId: 'route-1'});
  });

  it('passes a signal to the local executor and supports cancellation', async () => {
    let resolveTranslation!: (value: string) => void;
    const translate = vi.fn((_message: Record<string, unknown>, _signal: AbortSignal) => new Promise<string>((resolve) => { resolveTranslation = resolve; }));
    const listener = createOffscreenMessageListener({
      ...baseOffscreenDependencies,
      translate: vi.fn(async () => 'chrome'),
      localTranslation: {
        translate,
        prepare: vi.fn(async () => ({model: LOCAL_TRANSLATION_MODEL_IDS.m2m100})),
        status: vi.fn(async () => ({models: []})),
        removeModel: vi.fn(async () => undefined),
      },
    });
    let response!: (value: unknown) => void;
    const responsePromise = new Promise<unknown>((resolve) => { response = resolve; });
    expect(listener({
      target: 'offscreen',
      type: 'LOCAL_TRANSLATION_TRANSLATE',
      requestId: 'local-1',
      model: LOCAL_TRANSLATION_MODEL_IDS.m2m100,
      text: 'Hello',
      sourceLanguage: 'en',
      targetLanguage: 'zh-Hans',
    }, {}, response)).toBe(true);
    await vi.waitFor(() => expect(translate).toHaveBeenCalledOnce());
    const signal = translate.mock.calls[0]?.[1] as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    let cancelResponse!: (value: unknown) => void;
    const cancelPromise = new Promise<unknown>((resolve) => { cancelResponse = resolve; });
    expect(listener({
      target: 'offscreen',
      type: OFFSCREEN_CANCEL_LOCAL_TRANSLATION_MESSAGE_TYPE,
      requestId: 'local-1',
    }, {}, cancelResponse)).toBe(true);
    await expect(cancelPromise).resolves.toEqual({success: true, cancelled: true, requestId: 'local-1'});
    await expect(responsePromise).resolves.toMatchObject({success: false, cancelled: true, requestId: 'local-1'});
    expect(signal.aborted).toBe(true);
    resolveTranslation('迟到译文');
  });
});
