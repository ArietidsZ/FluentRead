import {describe, expect, it, vi} from 'vitest';

import {createVideoAiModelSetup, type VideoAiModelSetupDependencies} from '@/src/features/video-subtitle/content/video-ai/modelSetup';
import type {VideoLocalTranscriptionModel} from '@/src/features/video-subtitle/transcription';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return {promise, resolve};
}

function setup(overrides: Partial<VideoAiModelSetupDependencies> & {responses?: Record<string, unknown[]>} = {}) {
  let configured: VideoLocalTranscriptionModel = 'tiny';
  let current = true;
  const events: string[] = [];
  const responses = overrides.responses ?? {};
  const sendMessage = vi.fn(async (message: {type: string}) => {
    const next = responses[message.type]?.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const dependencies: VideoAiModelSetupDependencies = {
    sendMessage,
    getConfiguredModel: () => configured,
    getDeviceProfile: () => ({deviceMemoryGb: 8, hardwareConcurrency: 12, mobile: false}),
    captureRequest: () => () => current,
    persistModel: vi.fn((model) => { configured = model; }),
    startGeneration: vi.fn(() => events.push('start')),
    setError: vi.fn((message) => events.push(`error:${message}`)),
    formatDownloadError: (message) => `下载失败：${message}`,
    onChange: vi.fn(),
    ...overrides,
  };
  const controller = createVideoAiModelSetup(dependencies);
  return {
    controller, dependencies, events, sendMessage,
    configure: (model: VideoLocalTranscriptionModel) => { configured = model; },
    invalidate: () => { current = false; },
  };
}

describe('video AI model setup', () => {
  it('starts immediately when the configured model is already downloaded', async () => {
    const {controller, events, dependencies} = setup({responses: {fluentReadGetLocalVideoModelState: [{success: true, models: ['tiny']}]}});
    const pending = controller.request(() => true);
    expect(controller.checking).toBe(true);
    await pending;
    expect(controller.checking).toBe(false);
    expect(controller.choice).toBeNull();
    expect(events).toEqual(['error:', 'start']);
    expect(dependencies.onChange).toHaveBeenCalledTimes(2);
  });

  it('offers a device recommendation, lets the user switch, and downloads before starting', async () => {
    const {controller, events, dependencies, sendMessage} = setup({responses: {
      fluentReadGetLocalVideoModelState: [{success: true, models: []}],
      fluentReadPrepareLocalVideoModel: [{success: true, models: ['tiny']}],
    }});
    await controller.request(() => true);
    expect(controller.choice).toEqual({downloaded: [], recommended: 'base', selected: 'base'});
    controller.select('tiny');
    expect(controller.choice?.selected).toBe('tiny');

    const confirmed = controller.confirm();
    expect(controller.choice).toBeNull();
    expect(controller.downloading).toBe(true);
    await confirmed;
    expect(controller.downloading).toBe(false);
    expect(sendMessage).toHaveBeenLastCalledWith({type: 'fluentReadPrepareLocalVideoModel', model: 'tiny'});
    expect(dependencies.persistModel).not.toHaveBeenCalled();
    expect(events).toEqual(['error:', 'error:', 'start']);
  });

  it('persists a newly chosen model and prefers an already downloaded model without downloading', async () => {
    const {controller, dependencies, sendMessage, events} = setup({responses: {fluentReadGetLocalVideoModelState: [{success: true, models: ['base']}]}});
    await controller.request(() => true);
    expect(controller.choice?.selected).toBe('base');
    await controller.confirm();
    expect(dependencies.persistModel).toHaveBeenCalledWith('base');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toBe('start');
  });

  it('keeps a non-default configured model selected when nothing is downloaded', async () => {
    const {controller, configure} = setup({
      responses: {fluentReadGetLocalVideoModelState: [{success: true, models: []}]},
      getDeviceProfile: () => ({mobile: true}),
    });
    configure('base');
    await controller.request(() => true);
    expect(controller.choice).toEqual({downloaded: [], recommended: 'tiny', selected: 'base'});
  });

  it('reports status failures only for current requests and never opens a stale choice', async () => {
    const failing = setup({responses: {fluentReadGetLocalVideoModelState: [new Error('offline')]}});
    await failing.controller.request(() => true);
    expect(failing.events).toEqual(['error:', 'error:无法读取模型状态，请重试']);

    const stale = setup({responses: {fluentReadGetLocalVideoModelState: [new Error('offline')]}});
    const staleRequest = stale.controller.request(() => true);
    stale.invalidate();
    await staleRequest;
    expect(stale.events).toEqual(['error:']);

    const moved = setup({responses: {fluentReadGetLocalVideoModelState: [{success: true, models: []}]}});
    const movedRequest = moved.controller.request(() => true);
    moved.invalidate();
    await movedRequest;
    expect(moved.controller.choice).toBeNull();

    const switched = setup({responses: {fluentReadGetLocalVideoModelState: [{success: true, models: ['tiny']}]}});
    const switchedRequest = switched.controller.request(() => true);
    switched.configure('base');
    await switchedRequest;
    expect(switched.events).toEqual(['error:']);

    const hidden = setup({responses: {fluentReadGetLocalVideoModelState: [{success: true, models: []}]}});
    await hidden.controller.request(() => false);
    expect(hidden.controller.choice).toBeNull();
  });

  it('ignores overlapping requests and empty selections, cancellations or confirmations', async () => {
    const status = deferred<unknown>();
    const idle = setup({sendMessage: vi.fn(() => status.promise)});
    const first = idle.controller.request(() => true);
    await idle.controller.request(() => true);
    idle.controller.select('base');
    idle.controller.cancel();
    await idle.controller.confirm();
    expect(idle.dependencies.sendMessage).toHaveBeenCalledTimes(1);
    expect(idle.dependencies.onChange).toHaveBeenCalledTimes(1);
    status.resolve({success: true, models: []});
    await first;
    idle.controller.cancel();
    expect(idle.controller.choice).toBeNull();

    const download = deferred<unknown>();
    const busy = setup({sendMessage: vi.fn((message: {type: string}) => message.type === 'fluentReadPrepareLocalVideoModel'
      ? download.promise
      : Promise.resolve({success: true, models: []}))});
    await busy.controller.request(() => true);
    const confirming = busy.controller.confirm();
    await busy.controller.request(() => true);
    expect(busy.dependencies.sendMessage).toHaveBeenCalledTimes(2);
    download.resolve({success: true});
    await confirming;
    expect(busy.dependencies.startGeneration).toHaveBeenCalledTimes(1);
  });

  it('shows download failures and does not start after the request becomes stale', async () => {
    const failed = setup({responses: {
      fluentReadGetLocalVideoModelState: [{success: true, models: []}],
      fluentReadPrepareLocalVideoModel: [{success: false, error: '模型文件下载失败（503）'}],
    }});
    await failed.controller.request(() => true);
    await failed.controller.confirm();
    expect(failed.events.at(-1)).toBe('error:下载失败：模型文件下载失败（503）');
    expect(failed.dependencies.startGeneration).not.toHaveBeenCalled();

    const stale = setup({responses: {
      fluentReadGetLocalVideoModelState: [{success: true, models: []}],
      fluentReadPrepareLocalVideoModel: [{success: true, models: ['base']}],
    }});
    await stale.controller.request(() => true);
    const confirming = stale.controller.confirm();
    stale.invalidate();
    await confirming;
    expect(stale.dependencies.startGeneration).not.toHaveBeenCalled();
  });
});
