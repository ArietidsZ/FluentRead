import {afterEach, describe, expect, it, vi} from 'vitest';
import {VideoAiFullCaptureController, type VideoAiFullCaptureProgress} from '@/src/features/video-subtitle/content/video-ai/fullCapture';
import type {VideoAiAudioChunk} from '@/src/features/video-subtitle/content/video-ai/capture';

class FakeNode {
  constructor(private readonly shouldThrow = false) {}
  connect(): this { return this; }
  disconnect(): void {
    if (this.shouldThrow) throw new Error('disconnect failed');
  }
}

class FakeProcessor extends FakeNode {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null = null;

  emit(samples: Float32Array): void {
    this.onaudioprocess?.({
      inputBuffer: {
        numberOfChannels: 1,
        sampleRate: 16_000,
        getChannelData: () => samples,
      },
    } as unknown as AudioProcessingEvent);
  }
}

class FakeGain extends FakeNode {
  gain = {value: 1};
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static throwDisconnect = false;
  static throwDecode = false;
  static decodeResults: Array<AudioBuffer | Promise<AudioBuffer>> = [];
  static throwMediaElement = false;
  static decodeResult: {numberOfChannels: number; sampleRate: number; getChannelData: (index: number) => Float32Array} = {
    numberOfChannels: 1,
    sampleRate: 16_000,
    getChannelData: () => speechAudio(1_000),
  };
  readonly processor = new FakeProcessor(FakeAudioContext.throwDisconnect);
  readonly source = new FakeNode(FakeAudioContext.throwDisconnect);
  readonly gain = new FakeGain(FakeAudioContext.throwDisconnect);
  readonly destination = new FakeNode(FakeAudioContext.throwDisconnect);
  state: AudioContextState = 'running';

  constructor() { FakeAudioContext.instances.push(this); }
  createMediaElementSource(): MediaElementAudioSourceNode {
    if (FakeAudioContext.throwMediaElement) throw new Error('media element blocked');
    return this.source as unknown as MediaElementAudioSourceNode;
  }
  createMediaStreamSource(): MediaStreamAudioSourceNode { return this.source as unknown as MediaStreamAudioSourceNode; }
  createScriptProcessor(): ScriptProcessorNode { return this.processor as unknown as ScriptProcessorNode; }
  createGain(): GainNode { return this.gain as unknown as GainNode; }
  async decodeAudioData(): Promise<AudioBuffer> {
    if (FakeAudioContext.throwDecode) throw new Error('decode failed');
    const next = FakeAudioContext.decodeResults.shift();
    if (next) return await next;
    return FakeAudioContext.decodeResult as unknown as AudioBuffer;
  }
  async resume(): Promise<void> {}
  async close(): Promise<void> { this.state = 'closed'; }
}

class FakeVideo {
  currentSrc = 'blob:source';
  src = 'blob:source';
  duration = 10;
  paused = false;
  ended = false;
  muted = false;
  volume = 1;
  playbackRate = 1;
  readyState = 1;
  crossOrigin = '';
  style = {cssText: ''};
  captureStream = () => new FakeMediaStream() as unknown as MediaStream;
  pauseCalls = 0;
  playCalls = 0;
  removed = false;
  throwOnPause = false;
  throwOnSrcObject = false;
  throwOnCurrentTime = false;
  private currentTimeValue = 0;
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  get currentTime(): number { return this.currentTimeValue; }
  set currentTime(value: number) {
    if (this.throwOnCurrentTime) throw new Error('currentTime is read-only');
    this.currentTimeValue = value;
  }

  private srcObjectValue: unknown = null;
  get srcObject(): unknown { return this.srcObjectValue; }
  set srcObject(value: unknown) {
    if (this.throwOnSrcObject) throw new Error('srcObject is read-only');
    this.srcObjectValue = value;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) || new Set<EventListenerOrEventListenerObject>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string): void {
    const event = new Event(type);
    for (const listener of this.listeners.get(type) || []) {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    }
  }

  setAttribute(): void {}
  load(): void {}
  pause(): void {
    this.pauseCalls += 1;
    if (this.throwOnPause) throw new Error('pause failed');
    this.paused = true;
  }
  async play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
  }
  remove(): void { this.removed = true; }
}

class FakeTrack {
  clone(): FakeTrack { return new FakeTrack(); }
  stop(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

class FakeMediaStream {
  constructor(private readonly tracks: FakeTrack[] = []) {}
  getAudioTracks(): FakeTrack[] { return this.tracks; }
  getTracks(): FakeTrack[] { return this.tracks; }
}

function installScanDom(scanVideo: FakeVideo): void {
  vi.stubGlobal('document', {
    createElement: () => scanVideo,
    documentElement: {appendChild: vi.fn()},
  });
  vi.stubGlobal('window', {
    AudioContext: FakeAudioContext,
    setTimeout,
    clearTimeout,
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: false,
    headers: {get: () => null},
  })));
}

function installCustomAudioWindow(): void {
  vi.stubGlobal('window', {AudioContext: FakeAudioContext, setTimeout, clearTimeout});
}

async function tick(count = 20): Promise<void> {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

function speechAudio(durationMs = 1_000): Float32Array {
  return new Float32Array(Math.round(durationMs * 16)).fill(0.04);
}

function makeInjectedController(options: {
  audio?: Float32Array;
  transcribe?: (chunk: VideoAiAudioChunk) => Promise<Record<string, unknown>>;
  onComplete?: (cues: unknown[], session: number) => Promise<void>;
  onError?: (error: Error) => void;
  onProgress?: (progress: VideoAiFullCaptureProgress) => void;
  onInvalidate?: (reason: 'cancel' | 'error' | 'destroy', session: number) => void;
  onSessionStart?: (session: number) => void;
} = {}): VideoAiFullCaptureController {
  const video = new FakeVideo();
  return new VideoAiFullCaptureController({
    getVideo: () => video as unknown as HTMLVideoElement,
    getAudio: async () => options.audio || speechAudio(),
    getModel: () => 'tiny',
    isSupported: () => true,
    transcribe: options.transcribe || (async () => ({
      text: 'Injected complete sentence.',
      segments: [{startMs: 0, endMs: 900, text: 'Injected complete sentence.'}],
    })),
    onTranscriptionComplete: options.onComplete || (async () => undefined),
    onError: options.onError || vi.fn(),
    onStateChange: vi.fn(),
    onProgress: options.onProgress,
    onInvalidate: options.onInvalidate,
    onSessionStart: options.onSessionStart,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  FakeAudioContext.instances = [];
  FakeAudioContext.throwDisconnect = false;
  FakeAudioContext.throwDecode = false;
  FakeAudioContext.throwMediaElement = false;
  FakeAudioContext.decodeResults = [];
  FakeAudioContext.decodeResult = {
    numberOfChannels: 1,
    sampleRate: 16_000,
    getChannelData: () => speechAudio(1_000),
  };
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('完整 AI 字幕失败与取消边界', () => {
  it('没有可复制音源时清理副本，并吞掉 pause/srcObject 清理异常', async () => {
    const sourceVideo = new FakeVideo();
    sourceVideo.currentSrc = '';
    sourceVideo.src = '';
    const scanVideo = new FakeVideo();
    scanVideo.throwOnPause = true;
    scanVideo.throwOnSrcObject = true;
    installScanDom(scanVideo);

    const onError = vi.fn();
    const controller = new VideoAiFullCaptureController({
      getVideo: () => sourceVideo as unknown as HTMLVideoElement,
      getModel: () => 'tiny',
      isSupported: () => true,
      transcribe: async () => ({text: ''}),
      onTranscriptionComplete: async () => undefined,
      onError,
      onStateChange: vi.fn(),
    });

    expect(controller.start()).toBe(true);
    await tick();
    expect(controller.getPhase()).toBe('error');
    expect(controller.getError()).toContain('没有可复制的音频源');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(scanVideo.removed).toBe(true);
  });

  it('隐藏副本 currentTime 不可写时继续工作，取消时吞掉音频图清理异常', async () => {
    const sourceVideo = new FakeVideo();
    const scanVideo = new FakeVideo();
    scanVideo.throwOnCurrentTime = true;
    scanVideo.throwOnPause = true;
    scanVideo.throwOnSrcObject = true;
    installScanDom(scanVideo);
    FakeAudioContext.throwDisconnect = true;

    const controller = new VideoAiFullCaptureController({
      getVideo: () => sourceVideo as unknown as HTMLVideoElement,
      getModel: () => 'tiny',
      isSupported: () => true,
      transcribe: async () => ({text: ''}),
      onTranscriptionComplete: async () => undefined,
      onError: vi.fn(),
      onStateChange: vi.fn(),
    });

    expect(controller.start()).toBe(true);
    await tick();
    expect(scanVideo.playCalls).toBe(1);
    expect(controller.getPhase()).toBe('capturing');
    controller.cancel();
    expect(controller.getPhase()).toBe('idle');
    expect(scanVideo.removed).toBe(true);
  });

  it('MediaElementSource 失败时使用克隆音轨，并清理 fallback stream', async () => {
    const sourceVideo = new FakeVideo();
    const scanVideo = new FakeVideo();
    sourceVideo.srcObject = new FakeMediaStream([new FakeTrack()]);
    installScanDom(scanVideo);
    vi.stubGlobal('MediaStream', FakeMediaStream);
    FakeAudioContext.throwMediaElement = true;

    const controller = new VideoAiFullCaptureController({
      getVideo: () => sourceVideo as unknown as HTMLVideoElement,
      getModel: () => 'tiny',
      isSupported: () => true,
      transcribe: async () => ({text: 'unused'}),
      onTranscriptionComplete: async () => undefined,
      onError: vi.fn(),
      onStateChange: vi.fn(),
    });

    expect(controller.start()).toBe(true);
    await tick(20);
    expect(controller.getPhase()).toBe('capturing');
    controller.cancel();
    expect(controller.getPhase()).toBe('idle');
    expect(scanVideo.removed).toBe(true);
  });

  it('扫描副本加载期间取消后丢弃迟到的 loadedmetadata，并清理副本', async () => {
    const sourceVideo = new FakeVideo();
    const scanVideo = new FakeVideo();
    scanVideo.readyState = 0;
    installScanDom(scanVideo);
    const controller = new VideoAiFullCaptureController({
      getVideo: () => sourceVideo as unknown as HTMLVideoElement,
      getModel: () => 'tiny',
      isSupported: () => true,
      transcribe: async () => ({text: 'unused'}),
      onTranscriptionComplete: async () => undefined,
      onError: vi.fn(),
      onStateChange: vi.fn(),
    });

    expect(controller.start()).toBe(true);
    await tick(12);
    controller.cancel();
    scanVideo.readyState = 1;
    scanVideo.emit('loadedmetadata');
    await tick(12);
    expect(controller.getPhase()).toBe('idle');
    expect(scanVideo.removed).toBe(true);
  });

  it('旧 session 返回被新 session 复用的 scan element 时不移除新图', async () => {
    const sourceVideo = new FakeVideo();
    const scanVideo = new FakeVideo();
    installScanDom(scanVideo);
    let resolveFirst!: (value: HTMLVideoElement) => void;
    const firstIsolated = new Promise<HTMLVideoElement>(resolve => { resolveFirst = resolve; });
    let isolatedCalls = 0;
    const controller = new VideoAiFullCaptureController({
      getVideo: () => sourceVideo as unknown as HTMLVideoElement,
      getIsolatedVideo: async () => {
        isolatedCalls += 1;
        return isolatedCalls === 1 ? firstIsolated : scanVideo as unknown as HTMLVideoElement;
      },
      getModel: () => 'tiny',
      isSupported: () => true,
      transcribe: async () => ({text: 'unused'}),
      onTranscriptionComplete: async () => undefined,
      onError: vi.fn(),
      onStateChange: vi.fn(),
    });

    expect(controller.start()).toBe(true);
    await tick(20);
    controller.cancel();
    expect(controller.start()).toBe(true);
    await tick(30);
    expect(controller.getPhase()).toBe('capturing');
    resolveFirst(scanVideo as unknown as HTMLVideoElement);
    await tick(30);
    expect(scanVideo.removed).toBe(false);
    expect(controller.getPhase()).toBe('capturing');
    controller.cancel();
  });

  it('快速解码返回空 PCM 或抛出异常时回退到隐藏扫描路径', async () => {
    for (const decodeResult of [
      {numberOfChannels: 0, sampleRate: 16_000, getChannelData: () => new Float32Array()},
      null,
    ]) {
      const sourceVideo = new FakeVideo();
      const scanVideo = new FakeVideo();
      installScanDom(scanVideo);
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        headers: {get: () => null},
        arrayBuffer: async () => new ArrayBuffer(8),
      })));
      if (decodeResult) {
        FakeAudioContext.decodeResult = decodeResult;
      } else {
        FakeAudioContext.throwDecode = true;
      }

      const controller = new VideoAiFullCaptureController({
        getVideo: () => sourceVideo as unknown as HTMLVideoElement,
        getModel: () => 'tiny',
        isSupported: () => true,
        transcribe: async () => ({text: 'unused'}),
        onTranscriptionComplete: async () => undefined,
        onError: vi.fn(),
        onStateChange: vi.fn(),
      });
      expect(controller.start()).toBe(true);
      await tick(20);
      expect(controller.getPhase()).toBe('capturing');
      controller.cancel();
      FakeAudioContext.throwDecode = false;
    }
  });

  it('快速解码读取期间取消时重新抛出取消错误并保持 idle', async () => {
    const sourceVideo = new FakeVideo();
    const scanVideo = new FakeVideo();
    installScanDom(scanVideo);
    let controller!: VideoAiFullCaptureController;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: {get: () => null},
      arrayBuffer: async () => {
        controller.cancel();
        return new ArrayBuffer(8);
      },
    })));
    controller = new VideoAiFullCaptureController({
      getVideo: () => sourceVideo as unknown as HTMLVideoElement,
      getModel: () => 'tiny',
      isSupported: () => true,
      transcribe: async () => ({text: 'unused'}),
      onTranscriptionComplete: async () => undefined,
      onError: vi.fn(),
      onStateChange: vi.fn(),
    });
    expect(controller.start()).toBe(true);
    await tick(24);
    expect(controller.getPhase()).toBe('idle');
    expect(controller.isRequested()).toBe(false);
  });

  it('旧 session 的延迟快速解码返回不会覆盖 cancel + restart 后的新状态', async () => {
    installCustomAudioWindow();
    const sourceVideo = new FakeVideo();
    sourceVideo.duration = 1;
    const speech = {
      numberOfChannels: 1,
      sampleRate: 16_000,
      getChannelData: () => speechAudio(1_000),
    } as unknown as AudioBuffer;
    let resolveFirst!: (value: AudioBuffer) => void;
    const firstDecode = new Promise<AudioBuffer>(resolve => { resolveFirst = resolve; });
    FakeAudioContext.decodeResults = [firstDecode, speech];
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: {get: () => null},
      arrayBuffer: async () => new ArrayBuffer(8),
    })));
    const transcribe = vi.fn(async () => ({
      text: 'The restarted decode state survives.',
      segments: [{startMs: 0, endMs: 900, text: 'The restarted decode state survives.'}],
    }));
    const controller = new VideoAiFullCaptureController({
      getVideo: () => sourceVideo as unknown as HTMLVideoElement,
      getModel: () => 'tiny',
      isSupported: () => true,
      transcribe,
      onTranscriptionComplete: async () => undefined,
      onError: (error) => { throw error; },
      onStateChange: vi.fn(),
    });

    expect(controller.start()).toBe(true);
    await tick(20);
    controller.cancel();
    expect(controller.start()).toBe(true);
    await tick(40);
    expect(controller.getPhase()).toBe('ready');
    const progressBeforeLateDecode = controller.getProgress();
    resolveFirst(speech);
    await tick(40);
    expect(controller.getPhase()).toBe('ready');
    expect(controller.getProgress().phase).toBe(progressBeforeLateDecode.phase);
    expect(transcribe).toHaveBeenCalledTimes(1);
    controller.destroy();
  });

  it('fast decode capturing 进度同步取消时不会进入旧 finishCapture', async () => {
    installCustomAudioWindow();
    let now = 0;
    vi.spyOn(globalThis.performance, 'now').mockImplementation(() => { now += 300; return now; });
    const sourceVideo = new FakeVideo();
    sourceVideo.duration = 1;
    const speech = {
      numberOfChannels: 1,
      sampleRate: 16_000,
      getChannelData: () => speechAudio(1_000),
    } as unknown as AudioBuffer;
    FakeAudioContext.decodeResults = [speech];
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: {get: () => null},
      arrayBuffer: async () => new ArrayBuffer(8),
    })));
    let controller!: VideoAiFullCaptureController;
    const transcribe = vi.fn(async () => ({text: 'must not run'}));
    controller = new VideoAiFullCaptureController({
      getVideo: () => sourceVideo as unknown as HTMLVideoElement,
      getModel: () => 'tiny',
      isSupported: () => true,
      transcribe,
      onTranscriptionComplete: async () => undefined,
      onProgress: (progress) => {
        if (progress.phase === 'capturing' && progress.captureMode === 'fast-decode') controller.cancel();
      },
      onError: vi.fn(),
      onStateChange: vi.fn(),
    });
    expect(() => controller.start()).not.toThrow();
    await tick(40);
    expect(controller.getPhase()).toBe('idle');
    expect(controller.isRequested()).toBe(false);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('识别完成但没有可读 cue 时进入错误态', async () => {
    installCustomAudioWindow();
    const onError = vi.fn();
    const controller = makeInjectedController({
      audio: speechAudio(),
      transcribe: async () => ({text: '', segments: []}),
      onError,
    });

    expect(controller.start()).toBe(true);
    await tick(40);
    expect(controller.getPhase()).toBe('error');
    expect(controller.getError()).toContain('没有识别出可读字幕');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('onTranscriptionComplete 取消后不会回到 ready 或再次写入结果', async () => {
    installCustomAudioWindow();
    let controller!: VideoAiFullCaptureController;
    const onComplete = vi.fn(async () => {
      controller.cancel();
    });
    controller = makeInjectedController({onComplete});

    expect(controller.start()).toBe(true);
    await tick(40);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(controller.getPhase()).toBe('idle');
    expect(controller.isRequested()).toBe(false);
  });

  it('首个转写窗口开始前取消时不会继续提交识别结果', async () => {
    installCustomAudioWindow();
    let controller!: VideoAiFullCaptureController;
    controller = makeInjectedController({
      onProgress: (progress) => {
        if (progress.phase === 'transcribing' && progress.transcribedMs === 0) controller.cancel();
      },
    });
    expect(controller.start()).toBe(true);
    await tick(40);
    expect(controller.getPhase()).toBe('idle');
    expect(controller.isRequested()).toBe(false);
  });

  it('窗口完成回调前取消时不会进入翻译完成态', async () => {
    installCustomAudioWindow();
    let controller!: VideoAiFullCaptureController;
    controller = makeInjectedController({
      onProgress: (progress) => {
        if (progress.phase === 'transcribing' && progress.transcribedMs > 0) controller.cancel();
      },
    });
    expect(controller.start()).toBe(true);
    await tick(50);
    expect(controller.getPhase()).toBe('idle');
    expect(controller.isRequested()).toBe(false);
  });

  it('translating 进度回调同步取消时不会调用完成回调', async () => {
    installCustomAudioWindow();
    let controller!: VideoAiFullCaptureController;
    const onComplete = vi.fn(async () => undefined);
    controller = makeInjectedController({
      onProgress: (progress) => {
        if (progress.phase === 'translating') controller.cancel();
      },
      onComplete,
    });
    expect(controller.start()).toBe(true);
    await tick(50);
    expect(controller.getPhase()).toBe('idle');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('ready 进度回调同步取消时不会释放或通知旧 session 状态', async () => {
    installCustomAudioWindow();
    let controller!: VideoAiFullCaptureController;
    const onStateChange = vi.fn();
    const sourceVideo = new FakeVideo();
    const controllerInstance = new VideoAiFullCaptureController({
      getVideo: () => sourceVideo as unknown as HTMLVideoElement,
      getAudio: async () => speechAudio(),
      getModel: () => 'tiny',
      isSupported: () => true,
      transcribe: async () => ({
        text: 'Ready callback sentence.',
        segments: [{startMs: 0, endMs: 900, text: 'Ready callback sentence.'}],
      }),
      onTranscriptionComplete: async () => undefined,
      onProgress: (progress) => {
        if (progress.phase === 'ready') controller.cancel();
      },
      onError: (error) => { throw error; },
      onStateChange,
    });
    controller = controllerInstance;
    expect(controller.start()).toBe(true);
    await tick(50);
    expect(controller.getPhase()).toBe('idle');
    expect(controller.isRequested()).toBe(false);
  });

  it('初始进度回调同步取消时不会访问已清空的 abort controller', async () => {
    installCustomAudioWindow();
    let controller!: VideoAiFullCaptureController;
    let firstProgress = true;
    controller = makeInjectedController({
      onProgress: () => {
        if (!firstProgress) return;
        firstProgress = false;
        controller.cancel();
      },
    });
    expect(() => controller.start()).not.toThrow();
    await tick(30);
    expect(controller.getPhase()).toBe('idle');
    expect(controller.isRequested()).toBe(false);
  });

  it('onSessionStart 同步取消时不会继续调用音频读取器', async () => {
    installCustomAudioWindow();
    let controller!: VideoAiFullCaptureController;
    const getAudio = vi.fn(async () => speechAudio());
    controller = makeInjectedController({
      onSessionStart: () => controller.cancel(),
    });
    // Replace the injected reader through a direct controller to observe that
    // cancellation is checked before the optional audio source is awaited.
    controller = new VideoAiFullCaptureController({
      getVideo: () => new FakeVideo() as unknown as HTMLVideoElement,
      getAudio,
      getModel: () => 'tiny',
      isSupported: () => true,
      transcribe: async () => ({text: 'unused'}),
      onTranscriptionComplete: async () => undefined,
      onSessionStart: () => controller.cancel(),
      onError: vi.fn(),
      onStateChange: vi.fn(),
    });
    expect(() => controller.start()).not.toThrow();
    await tick(30);
    expect(getAudio).not.toHaveBeenCalled();
    expect(controller.getPhase()).toBe('idle');
  });

  it('旧 session 的 finish finally 不会清空重启后的扫描 PCM', async () => {
    vi.useFakeTimers();
    const sourceVideo = new FakeVideo();
    const scanVideo = new FakeVideo();
    installScanDom(scanVideo);
    let audioCalls = 0;
    let transcribeCalls = 0;
    let resolveFirst!: (value: Record<string, unknown>) => void;
    const firstResult = new Promise<Record<string, unknown>>(resolve => { resolveFirst = resolve; });
    const chunks: VideoAiAudioChunk[] = [];
    const controller = new VideoAiFullCaptureController({
      getVideo: () => sourceVideo as unknown as HTMLVideoElement,
      getAudio: async () => {
        audioCalls += 1;
        return audioCalls === 1 ? speechAudio() : null;
      },
      getModel: () => 'tiny',
      isSupported: () => true,
      transcribe: async (chunk) => {
        transcribeCalls += 1;
        chunks.push(chunk);
        if (transcribeCalls === 1) return firstResult;
        return {text: 'The restarted scan survives.', segments: [{startMs: 0, endMs: 900, text: 'The restarted scan survives.'}]};
      },
      onTranscriptionComplete: async () => undefined,
      onError: (error) => { throw error; },
      onStateChange: vi.fn(),
    });

    expect(controller.start()).toBe(true);
    await tick(30);
    expect(transcribeCalls).toBe(1);
    controller.cancel();
    expect(controller.start()).toBe(true);
    await tick(30);
    const processor = FakeAudioContext.instances.at(-1)!.processor;
    scanVideo.currentTime = 9;
    processor.emit(speechAudio(9_000));
    resolveFirst({text: 'The old scan result.', segments: [{startMs: 0, endMs: 900, text: 'The old scan result.'}]});
    await tick(30);
    scanVideo.currentTime = 11;
    processor.emit(speechAudio(2_000));
    scanVideo.ended = true;
    scanVideo.emit('ended');
    vi.advanceTimersByTime(420);
    await tick(80);

    expect(controller.getPhase()).toBe('ready');
    const restartedChunk = chunks.find(chunk => chunk.sessionId === controller.getSessionId());
    expect(restartedChunk).toBeTruthy();
    expect(restartedChunk!.durationMs).toBeGreaterThanOrEqual(10_000);
    controller.destroy();
  });

  it('旧 session 的 queue 错误不会污染重启后的 fullTranscriptionError', async () => {
    installCustomAudioWindow();
    let transcribeCalls = 0;
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: (value: Record<string, unknown>) => void;
    const firstResult = new Promise<Record<string, unknown>>((_resolve, reject) => { rejectFirst = reject; });
    const secondResult = new Promise<Record<string, unknown>>(resolve => { resolveSecond = resolve; });
    const controller = makeInjectedController({
      transcribe: async () => {
        transcribeCalls += 1;
        return transcribeCalls === 1 ? firstResult : secondResult;
      },
      onError: (error) => { throw error; },
    });

    expect(controller.start()).toBe(true);
    await tick(30);
    controller.cancel();
    expect(controller.start()).toBe(true);
    await tick(30);
    expect(transcribeCalls).toBe(2);
    rejectFirst(new Error('old session failed'));
    await tick(30);
    resolveSecond({text: 'The new session succeeds.', segments: [{startMs: 0, endMs: 900, text: 'The new session succeeds.'}]});
    await tick(60);
    expect(controller.getPhase()).toBe('ready');
    controller.destroy();
  });

  it('窗口识别失败时进入错误态并释放扫描资源', async () => {
    installCustomAudioWindow();
    const onError = vi.fn();
    const controller = makeInjectedController({
      transcribe: async () => { throw new Error('window failed'); },
      onError,
    });
    expect(controller.start()).toBe(true);
    await tick(50);
    expect(controller.getPhase()).toBe('error');
    expect(controller.getError()).toContain('window failed');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('失败时回调当前 generation 的失效通知', async () => {
    installCustomAudioWindow();
    const onInvalidate = vi.fn();
    const controller = makeInjectedController({
      transcribe: async () => { throw new Error('invalidate me'); },
      onInvalidate,
    });
    expect(controller.start()).toBe(true);
    await tick(50);
    expect(controller.getPhase()).toBe('error');
    expect(onInvalidate).toHaveBeenCalledWith('error', expect.any(Number));
  });

  it('Worker 跳过窗口时给出可执行错误', async () => {
    installCustomAudioWindow();
    const onError = vi.fn();
    const controller = makeInjectedController({
      transcribe: async () => ({skipped: true}),
      onError,
    });
    expect(controller.start()).toBe(true);
    await tick(50);
    expect(controller.getPhase()).toBe('error');
    expect(controller.getError()).toContain('请求被跳过');
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('完整 AI 字幕扫描窗口的暂停边界', () => {
  function makeScanController(scanVideo: FakeVideo, chunks: VideoAiAudioChunk[]): VideoAiFullCaptureController {
    const sourceVideo = new FakeVideo();
    sourceVideo.duration = scanVideo.duration;
    return new VideoAiFullCaptureController({
      getVideo: () => sourceVideo as unknown as HTMLVideoElement,
      getIsolatedVideo: async () => scanVideo as unknown as HTMLVideoElement,
      getModel: () => 'tiny',
      isSupported: () => true,
      transcribe: async (chunk) => {
        chunks.push(chunk);
        return {
          text: 'A complete scan sentence.',
          segments: [{startMs: 0, endMs: Math.min(chunk.durationMs, 900), text: 'A complete scan sentence.'}],
        };
      },
      onTranscriptionComplete: async () => undefined,
      onError: (error) => { throw error; },
      onStateChange: vi.fn(),
    });
  }

  it('在窗口后半段发现长暂停时切断窗口，并跳过不足 900ms 的尾部', async () => {
    vi.useFakeTimers();
    const scanVideo = new FakeVideo();
    scanVideo.duration = 10;
    installScanDom(scanVideo);
    const chunks: VideoAiAudioChunk[] = [];
    const controller = makeScanController(scanVideo, chunks);
    expect(controller.start()).toBe(true);
    await tick(20);

    scanVideo.currentTime = 10;
    const audio = speechAudio(10_000);
    audio.fill(0, 9 * 16_000);
    FakeAudioContext.instances.at(-1)!.processor.emit(audio);
    scanVideo.ended = true;
    scanVideo.emit('ended');
    vi.advanceTimersByTime(420);
    await tick(50);

    expect(controller.getPhase()).toBe('ready');
    expect(chunks).toHaveLength(1);
    expect(Math.round(chunks[0].startMs)).toBe(0);
    expect(Math.round(chunks[0].durationMs)).toBe(9_500);
  });

  it('暂停边界后保留后续完整尾窗，并按新的绝对时间起点识别', async () => {
    vi.useFakeTimers();
    const scanVideo = new FakeVideo();
    scanVideo.duration = 11;
    installScanDom(scanVideo);
    const chunks: VideoAiAudioChunk[] = [];
    const controller = makeScanController(scanVideo, chunks);
    expect(controller.start()).toBe(true);
    await tick(20);

    scanVideo.currentTime = 11;
    const audio = speechAudio(11_000);
    audio.fill(0, 6 * 16_000, 7 * 16_000);
    FakeAudioContext.instances.at(-1)!.processor.emit(audio);
    scanVideo.ended = true;
    scanVideo.emit('ended');
    vi.advanceTimersByTime(420);
    await tick(60);

    expect(controller.getPhase()).toBe('ready');
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(Math.round(chunks[0].startMs)).toBe(0);
    expect(Math.round(chunks[0].durationMs)).toBe(6_500);
    expect(Math.round(chunks[1].startMs)).toBe(6_500);
    expect(chunks.every((chunk) => chunk.durationMs > 0 && chunk.durationMs <= 10_000)).toBe(true);
  });

  it('连续语音窗口保持重叠步长，并覆盖最终尾部', async () => {
    vi.useFakeTimers();
    const scanVideo = new FakeVideo();
    scanVideo.duration = 20;
    installScanDom(scanVideo);
    const chunks: VideoAiAudioChunk[] = [];
    const controller = makeScanController(scanVideo, chunks);
    expect(controller.start()).toBe(true);
    await tick(20);

    scanVideo.currentTime = 20;
    FakeAudioContext.instances.at(-1)!.processor.emit(speechAudio(20_000));
    scanVideo.ended = true;
    scanVideo.emit('ended');
    vi.advanceTimersByTime(420);
    await tick(80);

    expect(controller.getPhase()).toBe('ready');
    expect(chunks.map((chunk) => Math.round(chunk.startMs))).toEqual(expect.arrayContaining([0, 8_800, 17_600]));
    controller.destroy();
  });

  it('扫描进度回调同步取消时，后续 queue 入口会拒绝旧 session', async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(globalThis.performance, 'now').mockImplementation(() => { now += 300; return now; });
    const scanVideo = new FakeVideo();
    scanVideo.duration = 10;
    installScanDom(scanVideo);
    let controller!: VideoAiFullCaptureController;
    const transcribe = vi.fn(async () => ({text: 'must not run'}));
    controller = new VideoAiFullCaptureController({
      getVideo: () => new FakeVideo() as unknown as HTMLVideoElement,
      getIsolatedVideo: async () => scanVideo as unknown as HTMLVideoElement,
      getModel: () => 'tiny',
      isSupported: () => true,
      transcribe,
      onTranscriptionComplete: async () => undefined,
      onProgress: (progress) => {
        if (progress.phase === 'capturing' && progress.capturedMs > 0) controller.cancel();
      },
      onError: vi.fn(),
      onStateChange: vi.fn(),
    });
    expect(controller.start()).toBe(true);
    await tick(20);
    scanVideo.currentTime = 10;
    FakeAudioContext.instances.at(-1)!.processor.emit(speechAudio(10_000));
    await tick(30);
    expect(controller.getPhase()).toBe('idle');
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('多个音频块拼接时忽略窗口结束后的块，并继续完成尾窗', async () => {
    vi.useFakeTimers();
    const scanVideo = new FakeVideo();
    scanVideo.duration = 12.5;
    installScanDom(scanVideo);
    const chunks: VideoAiAudioChunk[] = [];
    const controller = makeScanController(scanVideo, chunks);
    expect(controller.start()).toBe(true);
    await tick(20);

    scanVideo.currentTime = 12.5;
    const processor = FakeAudioContext.instances.at(-1)!.processor;
    for (let index = 0; index < 5; index += 1) processor.emit(speechAudio(2_500));
    scanVideo.ended = true;
    scanVideo.emit('ended');
    vi.advanceTimersByTime(420);
    await tick(80);

    expect(controller.getPhase()).toBe('ready');
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    controller.destroy();
  });
});
