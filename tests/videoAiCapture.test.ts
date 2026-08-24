import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  VideoAiCaptureController,
  type VideoAiAudioChunk,
  type VideoAiTranscriptionResult,
} from '@/entrypoints/main/video-ai/capture';
import {
  getVideoAiStreamProfile,
  VIDEO_AI_SAMPLE_RATE,
} from '@/entrypoints/main/video-ai/audioWindow';

class FakeMediaStreamTrack {
  stopCount = 0;

  private readonly endedListeners = new Set<() => void>();

  stop(): void {
    this.stopCount += 1;
  }

  clone(): MediaStreamTrack {
    return new FakeMediaStreamTrack() as unknown as MediaStreamTrack;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type !== 'ended') return;
    this.endedListeners.add(() => {
      if (typeof listener === 'function') listener(new Event('ended'));
      else listener.handleEvent(new Event('ended'));
    });
  }

  removeEventListener(type: string): void {
    if (type === 'ended') this.endedListeners.clear();
  }

  emitEnded(): void {
    [...this.endedListeners].forEach((listener) => listener());
  }
}

class FakeMediaStream {
  constructor(private readonly tracks: FakeMediaStreamTrack[] = []) {}

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks as unknown as MediaStreamTrack[];
  }

  getTracks(): MediaStreamTrack[] {
    return this.getAudioTracks();
  }
}

class FakeAudioNode {
  disconnectCount = 0;

  connect(): this {
    return this;
  }

  disconnect(): void {
    this.disconnectCount += 1;
  }
}

class FakeScriptProcessorNode extends FakeAudioNode {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null = null;

  emit(samples: Float32Array, sampleRate = VIDEO_AI_SAMPLE_RATE): void {
    this.onaudioprocess?.({
      inputBuffer: {
        numberOfChannels: 1,
        sampleRate,
        getChannelData: () => samples,
      },
    } as unknown as AudioProcessingEvent);
  }
}

class FakeGainNode extends FakeAudioNode {
  gain = { value: 1 };
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  state: AudioContextState = 'running';
  readonly destination = new FakeAudioNode();
  readonly processor = new FakeScriptProcessorNode();
  readonly source = new FakeAudioNode();
  readonly gain = new FakeGainNode();
  closeCount = 0;

  constructor(_options?: AudioContextOptions) {
    FakeAudioContext.instances.push(this);
  }

  createMediaStreamSource(): MediaStreamAudioSourceNode {
    return this.source as unknown as MediaStreamAudioSourceNode;
  }

  createScriptProcessor(): ScriptProcessorNode {
    return this.processor as unknown as ScriptProcessorNode;
  }

  createGain(): GainNode {
    return this.gain as unknown as GainNode;
  }

  async resume(): Promise<void> {}

  async close(): Promise<void> {
    this.closeCount += 1;
    this.state = 'closed';
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function speech(durationMs: number): Float32Array {
  const sampleCount = Math.round(durationMs * VIDEO_AI_SAMPLE_RATE / 1_000);
  return Float32Array.from(
    { length: sampleCount },
    (_, index) => 0.04 * Math.sin(2 * Math.PI * 220 * index / VIDEO_AI_SAMPLE_RATE),
  );
}

function silence(durationMs: number): Float32Array {
  return new Float32Array(Math.round(durationMs * VIDEO_AI_SAMPLE_RATE / 1_000));
}

function emitInProcessorBlocks(context: FakeAudioContext, pcm: Float32Array): void {
  const blockSize = 4_096;
  for (let offset = 0; offset < pcm.length; offset += blockSize) {
    context.processor.emit(pcm.subarray(offset, Math.min(pcm.length, offset + blockSize)));
  }
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

function createHarness(
  transcribe: (chunk: VideoAiAudioChunk) => Promise<VideoAiTranscriptionResult> = async () => ({ skipped: true }),
) {
  const sourceTracks: FakeMediaStreamTrack[] = [];
  const videoState = {
    currentTime: 0,
    playbackRate: 1,
    paused: false,
    ended: false,
    srcObject: null,
    captureStream: () => {
      const track = new FakeMediaStreamTrack();
      sourceTracks.push(track);
      return new FakeMediaStream([track]) as unknown as MediaStream;
    },
  };
  const video = videoState as unknown as HTMLVideoElement;
  const onCue = vi.fn();
  const onReset = vi.fn();
  const onError = vi.fn();
  const onStateChange = vi.fn();
  const onDiagnostic = vi.fn();
  const onInvalidate = vi.fn();
  const onSessionStart = vi.fn();
  const transcribeSpy = vi.fn(transcribe);
  const controller = new VideoAiCaptureController({
    getVideo: () => video,
    getModel: () => 'tiny',
    isSupported: () => true,
    transcribe: transcribeSpy,
    onCue,
    onReset,
    onError,
    onStateChange,
    onDiagnostic,
    onInvalidate,
    onSessionStart,
  });

  return {
    controller,
    video: videoState,
    sourceTracks,
    transcribe: transcribeSpy,
    onCue,
    onReset,
    onError,
    onDiagnostic,
    onInvalidate,
    onSessionStart,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeAudioContext.instances = [];
  vi.stubGlobal('MediaStream', FakeMediaStream);
  vi.stubGlobal('window', {
    AudioContext: FakeAudioContext,
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (...args: Parameters<typeof clearTimeout>) => clearTimeout(...args),
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('VideoAiCaptureController 生命周期', () => {
  it('视频结束时等待在途尾窗写回，再取消 generation 并释放音频图', async () => {
    const finalResult = deferred<VideoAiTranscriptionResult>();
    const harness = createHarness(async () => finalResult.promise);
    const profile = getVideoAiStreamProfile('tiny');
    expect(harness.controller.start()).toBe(true);
    harness.video.currentTime = profile.initialWindowMs / 1_000;
    emitInProcessorBlocks(FakeAudioContext.instances[0], speech(profile.initialWindowMs));
    expect(harness.transcribe).toHaveBeenCalledTimes(1);

    harness.video.currentTime = 30;
    harness.video.paused = true;
    harness.video.ended = true;
    harness.controller.end(false);
    expect(harness.onInvalidate).not.toHaveBeenCalledWith('ended', 1);
    expect(FakeAudioContext.instances[0].state).toBe('closed');

    finalResult.resolve({ text: 'The final sentence arrives.' });
    await flushPromises();
    expect(harness.onCue).toHaveBeenCalledWith(expect.objectContaining({
      cueId: 'session-1:ai-1',
      text: 'The final sentence arrives.',
    }));
    expect(harness.onInvalidate).toHaveBeenCalledWith('ended', 1);
    expect(harness.controller.isRunning()).toBe(false);
    expect(harness.controller.isRequested()).toBe(true);
  });

  it('视频结束且当前空闲时，会强制提交不足正常步长但超过 0.9 秒的尾音频', async () => {
    const harness = createHarness(async () => ({ text: 'A complete sentence arrives.' }));
    const profile = getVideoAiStreamProfile('tiny');
    expect(harness.controller.start()).toBe(true);
    harness.video.currentTime = profile.initialWindowMs / 1_000;
    emitInProcessorBlocks(FakeAudioContext.instances[0], speech(profile.initialWindowMs));
    await flushPromises();
    expect(harness.transcribe).toHaveBeenCalledTimes(1);

    harness.video.currentTime += 1.2;
    emitInProcessorBlocks(FakeAudioContext.instances[0], speech(1_200));
    expect(harness.transcribe).toHaveBeenCalledTimes(1);
    harness.video.ended = true;
    harness.video.paused = true;
    harness.controller.end(false);
    expect(harness.transcribe).toHaveBeenCalledTimes(2);
    expect(harness.transcribe.mock.calls[1][0].audioDurationMs).toBeGreaterThanOrEqual(1_000);
  });

  it('暂停恢复保留句子上下文，首个恢复窗口无需重新等满整段', () => {
    const harness = createHarness();
    const profile = getVideoAiStreamProfile('tiny');
    expect(harness.controller.start()).toBe(true);

    harness.video.currentTime = Math.max(0, profile.initialWindowMs - 200) / 1_000;
    emitInProcessorBlocks(
      FakeAudioContext.instances[0],
      speech(Math.max(0, profile.initialWindowMs - 200)),
    );
    expect(harness.transcribe).not.toHaveBeenCalled();
    harness.controller.pause();

    expect(harness.controller.start(false)).toBe(true);
    harness.video.currentTime = 4.4;
    emitInProcessorBlocks(FakeAudioContext.instances[1], speech(profile.initialWindowMs - 1_200));
    expect(harness.transcribe).toHaveBeenCalledTimes(1);
    const resumedChunk = harness.transcribe.mock.calls[0][0];
    expect(resumedChunk.sessionId).toBe(2);
    expect(resumedChunk.audioDurationMs).toBeGreaterThanOrEqual(profile.initialWindowMs);
    expect(resumedChunk.startMs).toBeLessThan(harness.video.currentTime * 1_000);

    harness.controller.cancel();
  });

  it('暂停会失效当前 generation，且旧 Promise 的结果和 finally 不污染恢复会话', async () => {
    const oldResult = deferred<VideoAiTranscriptionResult>();
    const resumedResult = deferred<VideoAiTranscriptionResult>();
    const responses: Promise<VideoAiTranscriptionResult>[] = [
      oldResult.promise,
      resumedResult.promise,
    ];
    const harness = createHarness(async () => responses.shift() || { skipped: true });
    const profile = getVideoAiStreamProfile('tiny');

    expect(harness.controller.start()).toBe(true);
    expect(harness.onSessionStart).toHaveBeenLastCalledWith(1);
    harness.video.currentTime = profile.initialWindowMs / 1_000;
    emitInProcessorBlocks(FakeAudioContext.instances[0], speech(profile.initialWindowMs));
    expect(harness.transcribe).toHaveBeenCalledTimes(1);
    expect(harness.transcribe.mock.calls[0][0].sessionId).toBe(1);

    harness.controller.pause();
    expect(harness.onInvalidate).toHaveBeenCalledWith('pause', 1);
    expect(harness.controller.isRunning()).toBe(false);
    expect(harness.controller.isRequested()).toBe(true);

    expect(harness.controller.start(false)).toBe(true);
    expect(harness.onSessionStart).toHaveBeenLastCalledWith(2);
    harness.video.currentTime = profile.initialWindowMs * 2 / 1_000;
    emitInProcessorBlocks(FakeAudioContext.instances[1], speech(profile.initialWindowMs));
    expect(harness.transcribe).toHaveBeenCalledTimes(2);
    expect(harness.transcribe.mock.calls[1][0].sessionId).toBe(2);

    oldResult.resolve({ text: 'Old generation must never render.' });
    await flushPromises();
    expect(harness.onCue).not.toHaveBeenCalled();
    expect(harness.onDiagnostic).not.toHaveBeenCalled();
    expect(harness.onError).not.toHaveBeenCalled();

    // 恢复后的请求仍在进行；旧请求的 finally 不得把 processing 清零并抢跑。
    harness.video.currentTime += profile.submitStepMs / 1_000;
    emitInProcessorBlocks(FakeAudioContext.instances[1], speech(profile.submitStepMs));
    expect(harness.transcribe).toHaveBeenCalledTimes(2);

    resumedResult.resolve({ text: 'New generation works now.' });
    await flushPromises();
    expect(harness.onCue).toHaveBeenCalledTimes(1);
    expect(harness.onCue.mock.calls[0][0].text).toBe('New generation works now.');
    expect(harness.onCue.mock.calls[0][0].cueId).toBe('session-2:ai-1');
    expect(harness.onDiagnostic.mock.calls.every(([diagnostic]) => diagnostic.sessionId === 2)).toBe(true);
    // 新请求完成后才允许追赶推理期间积累的音频。
    expect(harness.transcribe).toHaveBeenCalledTimes(3);

    harness.controller.cancel();
  });

  it.each([
    ['cancel', (harness: ReturnType<typeof createHarness>) => harness.controller.cancel()],
    ['seek', (harness: ReturnType<typeof createHarness>) => {
      harness.video.paused = true;
      harness.controller.resetAfterSeek();
    }],
    ['error', (harness: ReturnType<typeof createHarness>) => harness.sourceTracks[0].emitEnded()],
  ] as const)('%s 会释放捕获音轨和 AudioContext', (reason, stop) => {
    const harness = createHarness();
    expect(harness.controller.start()).toBe(true);
    const context = FakeAudioContext.instances[0];
    const track = harness.sourceTracks[0];

    stop(harness);

    expect(harness.onInvalidate).toHaveBeenCalledWith(reason, 1);
    expect(harness.controller.isRunning()).toBe(false);
    expect(track.stopCount).toBeGreaterThan(0);
    expect(context.closeCount).toBe(1);
    expect(context.state).toBe('closed');
    if (reason === 'error') {
      expect(harness.onError.mock.calls[0][0].message).toContain('音轨已结束');
      expect(harness.controller.isRequested()).toBe(false);
    }
  });

  it('数字静音不提交，语音达到 Tiny 初始窗口时立即提交', () => {
    const profile = getVideoAiStreamProfile('tiny');
    const silentHarness = createHarness();
    expect(silentHarness.controller.start()).toBe(true);
    emitInProcessorBlocks(FakeAudioContext.instances[0], silence(profile.initialWindowMs));
    expect(silentHarness.transcribe).not.toHaveBeenCalled();
    silentHarness.controller.cancel();

    const speechHarness = createHarness();
    expect(speechHarness.controller.start()).toBe(true);
    const speechContext = FakeAudioContext.instances[1];
    speechHarness.video.currentTime = profile.initialWindowMs / 1_000;
    emitInProcessorBlocks(speechContext, speech(profile.initialWindowMs));

    expect(speechHarness.transcribe).toHaveBeenCalledTimes(1);
    expect(speechHarness.transcribe.mock.calls[0][0]).toMatchObject({
      sessionId: 1,
      sequence: 1,
      audioDurationMs: profile.initialWindowMs,
      durationMs: profile.initialWindowMs,
      playbackRate: 1,
    });
    expect(speechHarness.transcribe.mock.calls[0][0].pcm).toHaveLength(
      profile.initialWindowMs * VIDEO_AI_SAMPLE_RATE / 1_000,
    );
    speechHarness.controller.cancel();
  });
});
