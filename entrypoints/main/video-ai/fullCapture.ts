import {
  normalizeVideoLocalTranscriptionModel,
  resampleToWhisperAudio,
} from '@/entrypoints/utils/videoTranscription';
import {
  measureVideoAiSpeechActivity,
  VIDEO_AI_SAMPLE_RATE,
  VideoAiStreamingResampler,
} from './audioWindow';
import {
  mergeVideoAiSubtitleCues,
  upsertVideoAiSubtitleCue,
} from './cueTimeline';
import {
  VideoAiTranscriptStabilizer,
  type VideoAiStabilizedCue,
} from './streamingTranscript';
import type {
  VideoAiAudioChunk,
  VideoAiTranscriptionResult,
} from './capture';

export type VideoAiFullCapturePhase =
  | 'idle'
  | 'capturing'
  | 'transcribing'
  | 'translating'
  | 'ready'
  | 'error';

export interface VideoAiFullCaptureProgress {
  phase: VideoAiFullCapturePhase;
  captureMode?: 'fast-decode' | 'realtime-scan';
  progress: number;
  capturedMs: number;
  durationMs: number;
  transcribedMs: number;
  windowIndex: number;
  windowCount: number;
}

export interface VideoAiFullCaptureOptions {
  getVideo: () => HTMLVideoElement | null;
  getModel: () => unknown;
  isSupported: () => boolean;
  transcribe: (chunk: VideoAiAudioChunk) => Promise<VideoAiTranscriptionResult>;
  onTranscriptionComplete: (cues: VideoAiStabilizedCue[], sessionId: number) => Promise<void>;
  onError: (error: Error) => void;
  onStateChange: () => void;
  onProgress?: (progress: VideoAiFullCaptureProgress) => void;
  onSessionStart?: (sessionId: number) => void;
  onInvalidate?: (reason: 'cancel' | 'error' | 'destroy', sessionId: number) => void;
}

type CaptureStreamVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

type AudioContextConstructor = new (contextOptions?: AudioContextOptions) => AudioContext;

interface SavedMediaState {
  currentTime: number;
  paused: boolean;
  playbackRate: number;
  muted: boolean;
  volume: number;
}

interface FullAudioWindow {
  startMs: number;
  endMs: number;
  pcm: Float32Array;
}

const AUDIO_PROCESSOR_BUFFER_SIZE = 4_096;
const FULL_TINY_WINDOW_MS = 10_000;
const FULL_BASE_WINDOW_MS = 14_000;
const FULL_WINDOW_OVERLAP_MS = 1_200;
const FULL_MIN_WINDOW_MS = 900;
const FULL_MAX_DURATION_MS = 20 * 60 * 1_000;
const FULL_CAPTURE_FINALIZE_DELAY_MS = 420;
const FULL_FAST_DECODE_MAX_BYTES = 48 * 1024 * 1024;
const FULL_FAST_DECODE_FETCH_TIMEOUT_MS = 1_500;
const FULL_FAST_DECODE_TIMEOUT_MS = 8_000;
const FULL_FAST_DECODE_DURATION_TOLERANCE_MS = 750;
// X 的 MediaSource/blob URL 通常只能绑定可见播放器；隐藏副本只作为
// 优先路径，超过这个短等待就直接复用可见 video，避免整段生成白等 10 秒。
const FULL_SCAN_VIDEO_LOAD_TIMEOUT_MS = 2_500;

const FULL_CANCELLED_ERROR = '本地视频 AI 字幕已取消';

function toError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(typeof value === 'string' ? value : fallback);
}

function getAudioContextConstructor(): AudioContextConstructor | undefined {
  return window.AudioContext
    || (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
}

function getWindowLengthMs(model: unknown): number {
  return normalizeVideoLocalTranscriptionModel(model) === 'base'
    ? FULL_BASE_WINDOW_MS
    : FULL_TINY_WINDOW_MS;
}

/**
 * 完整模式的音频窗口按固定大小建立并保留少量重叠；采集过程中窗口就会
 * 排入同一个 Worker 链，让 Whisper 与隐藏扫描并行，同时避免把整段长视频
 * 一次性送进 Worker，降低峰值内存和单次推理超时风险。
 */
export function createVideoAiFullAudioWindows(
  audio: Float32Array,
  model: unknown,
  sampleRate = VIDEO_AI_SAMPLE_RATE,
): FullAudioWindow[] {
  if (audio.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) return [];
  const totalMs = audio.length * 1_000 / sampleRate;
  const windowMs = Math.min(getWindowLengthMs(model), totalMs);
  const overlapMs = Math.min(FULL_WINDOW_OVERLAP_MS, Math.max(0, windowMs - FULL_MIN_WINDOW_MS));
  const stepMs = Math.max(FULL_MIN_WINDOW_MS, windowMs - overlapMs);
  const windows: FullAudioWindow[] = [];

  let startMs = 0;
  while (startMs < totalMs) {
    const endMs = Math.min(totalMs, startMs + windowMs);
    if (endMs - startMs < FULL_MIN_WINDOW_MS && windows.length > 0) {
      windows[windows.length - 1].endMs = totalMs;
      break;
    }

    const startSample = Math.max(0, Math.floor(startMs * sampleRate / 1_000));
    const endSample = Math.min(audio.length, Math.ceil(endMs * sampleRate / 1_000));
    if (endSample > startSample) {
      windows.push({
        startMs: startSample * 1_000 / sampleRate,
        endMs: endSample * 1_000 / sampleRate,
        pcm: audio.slice(startSample, endSample),
      });
    }

    if (endMs >= totalMs) break;
    const nextStartMs = startMs + stepMs;
    if (totalMs - nextStartMs < FULL_MIN_WINDOW_MS) {
      windows[windows.length - 1].endMs = totalMs;
      break;
    }
    startMs = nextStartMs;
  }

  return windows;
}

function getFullCueEndMs(cue: VideoAiStabilizedCue): number {
  const spokenEndMs = typeof cue.spokenEndMs === 'number' && Number.isFinite(cue.spokenEndMs)
    ? cue.spokenEndMs
    : cue.startMs + cue.durationMs;
  return Math.max(cue.startMs, spokenEndMs);
}

function fullCueTextScore(cue: VideoAiStabilizedCue): number {
  const words = cue.text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length || 0;
  const visibleUnits = cue.text.replace(/[\s\p{P}\p{S}]/gu, '').length;
  const hasSentenceStop = /[.!?。！？][”’"']?$/u.test(cue.text.trim());
  return words * 10 + visibleUnits + (hasSentenceStop ? 16 : 0) + (cue.partial ? 0 : 12);
}

/**
 * 完整识别可以在回放前看到所有重叠窗口。若两个 cue 在 spoken 时间上
 * 实际重叠且起点很近，较短的那条通常是 Whisper 的边界幻觉/半句候选；
 * 只保留信息量更高的 cue，避免“Back inside ... / Back in some parts ...”
 * 这类无法靠实时稳定器及时判断的片段进入最终时间轴。
 */
export function consolidateVideoAiFullCues(cues: VideoAiStabilizedCue[]): VideoAiStabilizedCue[] {
  const ordered = [...cues]
    .filter((cue) => cue.text.trim() && Number.isFinite(cue.startMs))
    .sort((left, right) => left.startMs - right.startMs);
  const result: VideoAiStabilizedCue[] = [];
  for (const cue of ordered) {
    const previous = result[result.length - 1];
    if (!previous) {
      result.push(cue);
      continue;
    }
    const previousEndMs = getFullCueEndMs(previous);
    const cueEndMs = getFullCueEndMs(cue);
    const overlapMs = Math.min(previousEndMs, cueEndMs) - Math.max(previous.startMs, cue.startMs);
    const startsNear = Math.abs(previous.startMs - cue.startMs) <= 900;
    const firstPreviousWord = previous.text.trim().split(/\s+/u, 1)[0]?.toLocaleLowerCase() || '';
    const firstCueWord = cue.text.trim().split(/\s+/u, 1)[0]?.toLocaleLowerCase() || '';
    if (overlapMs >= 450 && startsNear && firstPreviousWord && firstPreviousWord === firstCueWord) {
      const winner = fullCueTextScore(cue) > fullCueTextScore(previous) ? cue : previous;
      result[result.length - 1] = {
        ...winner,
        startMs: Math.min(previous.startMs, cue.startMs),
        durationMs: Math.max(winner.durationMs, previousEndMs, cueEndMs) - Math.min(previous.startMs, cue.startMs),
        availableAtMs: 0,
        translationAvailableAtMs: 0,
        spokenEndMs: Math.max(previousEndMs, cueEndMs),
      } as VideoAiStabilizedCue;
      continue;
    }
    result.push(cue);
  }
  return result;
}

/**
 * X 视频的完整 AI 字幕控制器。
 *
 * 这个控制器和实时捕获器刻意分开：完整模式不允许音频在播放器时间轴上
 * “边走边等结果”，而是先采集、再串行识别、再等待翻译，最后才恢复播放。
 */
export class VideoAiFullCaptureController {
  private phase: VideoAiFullCapturePhase = 'idle';
  private requested = false;
  private session = 0;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private silentSinkNode: GainNode | null = null;
  private stream: MediaStream | null = null;
  private captureSourceStream: MediaStream | null = null;
  private captureVideo: HTMLVideoElement | null = null;
  private scanVideo: HTMLVideoElement | null = null;
  /** MediaElementSource 接管可见 video 后必须保留到页面播放结束。 */
  private persistentVisibleAudioSource = false;
  private trackEndCleanups: Array<() => void> = [];
  private videoEndedCleanup: (() => void) | null = null;
  private finalizeTimer: number | undefined;
  private readonly resampler = new VideoAiStreamingResampler();
  private audioBlocks: Float32Array[] = [];
  private audioBlocksStartSample = 0;
  private bufferedSamples = 0;
  private audioHasSpeech = false;
  private captureStartOffsetMs = 0;
  private expectedDurationMs = 0;
  // 完整模式仍然只在最后统一暴露 cue，但识别可以和隐藏扫描并行。
  // 只维护一个串行 Promise 链，复用同一个 Whisper Worker，避免并发加载
  // 第二份模型导致内存峰值翻倍。
  private fullTranscriptionChain: Promise<void> | null = null;
  private readonly fullTranscriptionStabilizer = new VideoAiTranscriptStabilizer();
  private readonly fullCuesById = new Map<string, VideoAiStabilizedCue>();
  private fullFallbackCues: VideoAiStabilizedCue[] = [];
  private fullTranscriptionError: Error | null = null;
  private fullNextWindowStartMs = 0;
  private fullWindowLengthMs = 0;
  private fullWindowStepMs = 0;
  private fullWindowSequence = 0;
  private fullWindowCount = 0;
  private savedMediaState: SavedMediaState | null = null;
  private transcribing = false;
  private lastProgressNotifyAt = 0;
  private progress: VideoAiFullCaptureProgress = {
    phase: 'idle',
    progress: 0,
    capturedMs: 0,
    durationMs: 0,
    transcribedMs: 0,
    windowIndex: 0,
    windowCount: 0,
  };
  private error = '';

  constructor(private readonly options: VideoAiFullCaptureOptions) {}

  getPhase(): VideoAiFullCapturePhase {
    return this.phase;
  }

  getError(): string {
    return this.error;
  }

  getProgress(): VideoAiFullCaptureProgress {
    return { ...this.progress };
  }

  getSessionId(): number {
    return this.session;
  }

  isRequested(): boolean {
    return this.requested;
  }

  isActive(): boolean {
    return this.requested && this.phase !== 'idle' && this.phase !== 'error';
  }

  start(): boolean {
    if (this.isActive()) return true;
    if (!this.options.isSupported()) {
      this.failBeforeStart(new Error('当前浏览器无法完整采集 X 视频音频，请使用桌面版 Edge 或 Chrome'));
      return false;
    }

    const video = this.options.getVideo() as CaptureStreamVideo | null;
    const captureStream = video?.captureStream;
    const legacyCaptureStream = video?.mozCaptureStream;
    const AudioContextClass = getAudioContextConstructor();
    if (!video || (!captureStream && !legacyCaptureStream) || !AudioContextClass) {
      this.failBeforeStart(new Error('当前浏览器无法完整采集 X 视频音频，请使用桌面版 Edge 或 Chrome'));
      return false;
    }

    if (Number.isFinite(video.duration) && video.duration * 1_000 > FULL_MAX_DURATION_MS) {
      this.failBeforeStart(new Error('当前视频超过 20 分钟，完整本地识别会占用过多内存，请改用较短视频'));
      return false;
    }

    this.session += 1;
    const session = this.session;
    this.requested = true;
    this.error = '';
    this.phase = 'capturing';
    this.resetAudio();
    this.savedMediaState = {
      currentTime: Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0,
      paused: video.paused,
      playbackRate: Number.isFinite(video.playbackRate) && video.playbackRate > 0 ? video.playbackRate : 1,
      muted: video.muted,
      volume: video.volume,
    };
    this.captureVideo = video;
    this.expectedDurationMs = Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(FULL_MAX_DURATION_MS, video.duration * 1_000)
      : 0;
    this.setProgress({
      phase: 'capturing',
      captureMode: 'realtime-scan',
      progress: 0,
      capturedMs: 0,
      durationMs: this.expectedDurationMs,
      transcribedMs: 0,
      windowIndex: 0,
      windowCount: 0,
    });

    // 先暂停并回到 0 秒；完整模式的输出永远以 0 秒为时间轴起点。
    video.pause();
    try {
      video.currentTime = 0;
      video.playbackRate = 1;
      // Chromium 会把 video.muted/volume 传播到 captureStream 的音轨。完整
      // 模式优先通过 MediaElementAudioSourceNode 把媒体直接送进 Web Audio，
      // 再接 0 增益 sink；这样页面没有声音，但采集到的 PCM 仍然有能量。
      video.muted = false;
      video.volume = 0;
    } catch {
      // 某些跨域包装播放器的 currentTime/muted 可能只读；后续采集仍会给出
      // 明确错误，而不会让状态永久停留在生成中。
    }

    void this.startAudioGraph(video, captureStream || legacyCaptureStream!, AudioContextClass, session)
      .catch((error) => {
        if (session === this.session) this.fail(toError(error, '本地视频完整 AI 字幕启动失败'));
      });
    return true;
  }

  cancel(): void {
    if (!this.requested && this.phase === 'idle') return;
    const previousPhase = this.phase;
    const session = this.session;
    this.session += 1;
    this.requested = false;
    this.options.onInvalidate?.('cancel', session);
    this.clearFinalizeTimer();
    this.stopAudioGraph();
    if (previousPhase !== 'ready') this.restoreMediaState(true);
    this.resetAudio();
    this.phase = 'idle';
    this.error = '';
    this.setProgress({
      phase: 'idle',
      progress: 0,
      capturedMs: 0,
      durationMs: 0,
      transcribedMs: 0,
      windowIndex: 0,
      windowCount: 0,
    });
  }

  destroy(): void {
    if (!this.requested && this.phase === 'idle') {
      this.stopAudioGraph();
      return;
    }
    const session = this.session;
    this.session += 1;
    this.requested = false;
    this.options.onInvalidate?.('destroy', session);
    this.clearFinalizeTimer();
    this.stopAudioGraph();
    this.restoreMediaState(true);
    this.resetAudio();
    this.phase = 'idle';
    this.setProgress({
      phase: 'idle',
      progress: 0,
      capturedMs: 0,
      durationMs: 0,
      transcribedMs: 0,
      windowIndex: 0,
      windowCount: 0,
    });
  }

  private async startAudioGraph(
    video: CaptureStreamVideo,
    captureStreamFactory: () => MediaStream,
    AudioContextClass: AudioContextConstructor,
    session: number,
  ): Promise<void> {
    let createdStream: MediaStream | null = null;
    let createdSourceStream: MediaStream | null = null;
    let createdContext: AudioContext | null = null;
    let scanVideo: HTMLVideoElement | null = null;
    try {
      // 模型预热与媒体解码/扫描并行。对于可直接读取的 data/blob 媒体，
      // 后面的 fast path 会跳过 1x 播放；对 X MediaSource 仍自动回退到
      // captureStream，不改变它原本的时间轴和兼容性。
      this.options.onSessionStart?.(session);
      const fastAudio = await this.tryFastDecodeAudio(video, session);
      if (fastAudio) {
        this.audioBlocks = [fastAudio];
        this.audioBlocksStartSample = 0;
        this.bufferedSamples = fastAudio.length;
        this.captureStartOffsetMs = 0;
        this.audioHasSpeech = measureVideoAiSpeechActivity(fastAudio).active;
        this.expectedDurationMs = this.expectedDurationMs || fastAudio.length * 1_000 / VIDEO_AI_SAMPLE_RATE;
        this.setProgress({
          phase: 'capturing',
          captureMode: 'fast-decode',
          progress: 0.45,
          capturedMs: fastAudio.length * 1_000 / VIDEO_AI_SAMPLE_RATE,
          durationMs: this.expectedDurationMs,
          transcribedMs: 0,
          windowIndex: 0,
          windowCount: 0,
        });
        await this.finishCapture(session);
        return;
      }

      const reuseVisibleAudioGraph = this.persistentVisibleAudioSource
        && this.captureVideo === video
        && this.audioContext
        && this.sourceNode
        && this.silentSinkNode;
      let audioVideo: HTMLVideoElement;
      if (reuseVisibleAudioGraph) {
        audioVideo = video;
        audioVideo.muted = false;
        audioVideo.volume = 1;
      } else {
        try {
          audioVideo = await this.createScanVideo(video, session);
          scanVideo = audioVideo;
          this.scanVideo = audioVideo;
        } catch (scanError) {
          // MediaSource 只能绑定一个 media element；X 的 blob/MSE 播放器
          // 经常无法把同一个 URL 重新挂到隐藏副本。退回直接接管可见 video，
          // 但整个输出仍经过 0 增益 sink，用户不会听到扫描阶段的原声。
          if (!this.requested || session !== this.session) throw scanError;
          audioVideo = video;
        }
      }

      const context = reuseVisibleAudioGraph
        ? this.audioContext!
        : new AudioContextClass({
            sampleRate: VIDEO_AI_SAMPLE_RATE,
            latencyHint: 'playback',
          });
      if (!reuseVisibleAudioGraph) createdContext = context;
      let source: MediaStreamAudioSourceNode | MediaElementAudioSourceNode;
      let audioTracks: MediaStreamTrack[] = [];
      let sourceStream: MediaStream | null = null;
      let audioStream: MediaStream | null = null;
      if (reuseVisibleAudioGraph) {
        source = this.sourceNode!;
        this.silentSinkNode!.gain.value = 0;
        try { source.disconnect(); } catch { /* 旧图可能已经断开。 */ }
      } else try {
        // MediaElementAudioSourceNode 会接管该 video 的默认音频输出；这里只
        // 把它接到 0 增益 sink，因此扫描期间不会把原声播放给用户。
        source = context.createMediaElementSource(audioVideo);
        audioVideo.muted = false;
        audioVideo.volume = 1;
        this.persistentVisibleAudioSource = audioVideo === video;
      } catch {
        // 某些 X 跨域包装播放器禁止 MediaElementAudioSourceNode，退回
        // captureStream；这是兼容路径，若页面把 volume 传播为静音，后续
        // 的能量检查会给出明确提示而不是产出空字幕。
        sourceStream = captureStreamFactory.call(audioVideo);
        // 即使兼容路径的 captureStream 不受 volume 影响，也不要让隐藏扫描
        // 副本把原声直接送到用户扬声器；PCM 能量检查会决定该路径是否可用。
        audioVideo.volume = 0;
        createdSourceStream = sourceStream;
        audioTracks = sourceStream.getAudioTracks();
        const providedStream = video.srcObject as (MediaStream & {
          getAudioTracks?: () => MediaStreamTrack[];
        }) | null;
        if (audioTracks.length === 0 && providedStream && typeof providedStream.getAudioTracks === 'function') {
          audioTracks = providedStream.getAudioTracks().map((track) => track.clone());
        }
        if (audioTracks.length === 0) throw new Error('当前 X 视频没有可捕获的音轨');
        audioStream = new MediaStream(audioTracks);
        createdStream = audioStream;
        source = context.createMediaStreamSource(audioStream);
        this.persistentVisibleAudioSource = false;
      }
      const processor = context.createScriptProcessor(AUDIO_PROCESSOR_BUFFER_SIZE, 1, 1);
      const silentSink = reuseVisibleAudioGraph ? this.silentSinkNode! : context.createGain();
      silentSink.gain.value = 0;
      source.connect(processor);
      processor.connect(silentSink);
      if (!reuseVisibleAudioGraph) silentSink.connect(context.destination);

      const epoch = session;
      this.stream = audioStream;
      this.captureSourceStream = sourceStream;
      this.audioContext = context;
      this.sourceNode = source;
      this.processorNode = processor;
      this.silentSinkNode = silentSink;
      createdStream = null;
      createdSourceStream = null;
      createdContext = null;

      processor.onaudioprocess = (event) => {
        if (!this.requested || this.phase !== 'capturing' || epoch !== this.session) return;
        const channels = Array.from(
          { length: event.inputBuffer.numberOfChannels },
          (_, channel) => event.inputBuffer.getChannelData(channel),
        );
        const pcm = this.resampler.process(channels, event.inputBuffer.sampleRate, VIDEO_AI_SAMPLE_RATE);
        if (pcm.length === 0) return;
        if (this.bufferedSamples === 0) {
          const currentTimeMs = Number.isFinite(audioVideo.currentTime) ? Math.max(0, audioVideo.currentTime * 1_000) : 0;
          const blockDurationMs = pcm.length * 1_000 / VIDEO_AI_SAMPLE_RATE;
          this.captureStartOffsetMs = Math.max(0, currentTimeMs - blockDurationMs);
        }
        // resampler.process 已经返回了独立的 Float32Array；这里直接保留，
        // 避免每个 ScriptProcessor 回调再复制一遍 PCM。
        this.audioBlocks.push(pcm);
        this.bufferedSamples += pcm.length;
        if (!this.audioHasSpeech && measureVideoAiSpeechActivity(pcm).active) {
          this.audioHasSpeech = true;
        }
        const capturedMs = this.captureStartOffsetMs + this.bufferedSamples * 1_000 / VIDEO_AI_SAMPLE_RATE;
        if (capturedMs > FULL_MAX_DURATION_MS + 1_000) {
          this.fail(new Error('本地视频音频缓冲超过安全上限，已停止以保护浏览器性能'));
          return;
        }
        this.setProgress({
          phase: 'capturing',
          progress: this.expectedDurationMs > 0
            ? Math.min(0.45, capturedMs / this.expectedDurationMs * 0.45)
            : 0,
          capturedMs,
          durationMs: this.expectedDurationMs || capturedMs,
        });
        this.queueAvailableFullTranscriptionWindows(epoch);
      };

      const handleTrackEnded = () => {
        if (this.requested && this.phase === 'capturing' && epoch === this.session && !audioVideo.ended) {
          this.fail(new Error('X 视频音轨在完整采集前结束，请重新请求 AI 字幕'));
        }
      };
      this.trackEndCleanups = audioTracks.map((track) => {
        track.addEventListener('ended', handleTrackEnded);
        return () => track.removeEventListener('ended', handleTrackEnded);
      });

      const handleVideoEnded = () => {
        if (!this.requested || this.phase !== 'capturing' || epoch !== this.session) return;
        this.clearFinalizeTimer();
        this.finalizeTimer = window.setTimeout(() => {
          if (this.requested && this.phase === 'capturing' && epoch === this.session) {
            void this.finishCapture(epoch);
          }
        }, FULL_CAPTURE_FINALIZE_DELAY_MS);
      };
      audioVideo.addEventListener('ended', handleVideoEnded);
      this.videoEndedCleanup = () => audioVideo.removeEventListener('ended', handleVideoEnded);

      await context.resume();
      if (!this.requested || epoch !== this.session) throw new Error(FULL_CANCELLED_ERROR);
      // 完整扫描的 audio source 已经接到 0 增益 sink；视频本身先前已经在
      // 播放时，桌面浏览器通常会直接允许该播放请求。
      await audioVideo.play();
    } catch (error) {
      createdStream?.getTracks().forEach((track) => track.stop());
      createdSourceStream?.getTracks().forEach((track) => track.stop());
      if (createdContext && createdContext.state !== 'closed') {
        void createdContext.close().catch(() => undefined);
      }
      if (scanVideo) {
        try { scanVideo.pause(); } catch { /* 副本可能尚未完成加载。 */ }
        try { scanVideo.srcObject = null; } catch { /* 只读包装播放器忽略。 */ }
        scanVideo.remove();
      }
      if (this.scanVideo === scanVideo) this.scanVideo = null;
      throw error;
    }
  }

  private async tryFastDecodeAudio(
    video: HTMLVideoElement,
    session: number,
  ): Promise<Float32Array | null> {
    const source = video.currentSrc || video.src || '';
    if (!source || (!source.startsWith('blob:') && !source.startsWith('data:'))) return null;
    if (source.startsWith('data:') && source.length > FULL_FAST_DECODE_MAX_BYTES * 1.5) return null;

    const AudioContextClass = getAudioContextConstructor();
    if (!AudioContextClass) return null;

    const fetchController = new AbortController();
    let fetchTimeout: number | undefined;
    let decodeContext: AudioContext | null = null;
    let timeout: number | undefined;
    try {
      fetchTimeout = window.setTimeout(
        () => fetchController.abort(),
        FULL_FAST_DECODE_FETCH_TIMEOUT_MS,
      );
      const response = await fetch(source, {
        credentials: 'include',
        signal: fetchController.signal,
      });
      if (!response.ok) return null;
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > FULL_FAST_DECODE_MAX_BYTES) return null;
      const encoded = await response.arrayBuffer();
      if (encoded.byteLength === 0 || encoded.byteLength > FULL_FAST_DECODE_MAX_BYTES) return null;
      if (!this.requested || session !== this.session) throw new Error(FULL_CANCELLED_ERROR);

      decodeContext = new AudioContextClass();
      const decoded = await Promise.race([
        decodeContext.decodeAudioData(encoded.slice(0)),
        new Promise<never>((_, reject) => {
          timeout = window.setTimeout(
            () => reject(new Error('本地视频音频快速解码超时')),
            FULL_FAST_DECODE_TIMEOUT_MS,
          );
        }),
      ]);
      const channels = Array.from(
        { length: decoded.numberOfChannels },
        (_, channel) => decoded.getChannelData(channel),
      );
      const audio = resampleToWhisperAudio(channels, decoded.sampleRate, VIDEO_AI_SAMPLE_RATE);
      if (audio.length === 0) return null;
      const decodedAudioDurationMs = audio.length * 1_000 / VIDEO_AI_SAMPLE_RATE;
      const videoDurationMs = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration * 1_000
        : 0;
      // decodeAudioData 不暴露容器编辑列表或 A/V 起始偏移；明显的时长差异
      // 说明这个媒体不能安全地从 0ms 建立字幕时间轴，退回以播放器时钟为准。
      if (videoDurationMs > 0
        && Math.abs(decodedAudioDurationMs - videoDurationMs) > FULL_FAST_DECODE_DURATION_TOLERANCE_MS) {
        return null;
      }
      return audio;
    } catch (error) {
      if (error instanceof Error && error.message === FULL_CANCELLED_ERROR) throw error;
      return null;
    } finally {
      if (fetchTimeout !== undefined) window.clearTimeout(fetchTimeout);
      if (timeout !== undefined) window.clearTimeout(timeout);
      if (decodeContext && decodeContext.state !== 'closed') {
        await decodeContext.close().catch(() => undefined);
      }
    }
  }

  private async createScanVideo(sourceVideo: HTMLVideoElement, session: number): Promise<HTMLVideoElement> {
    const scanVideo = document.createElement('video');
    try {
      scanVideo.preload = 'auto';
      scanVideo.playsInline = true;
      scanVideo.controls = false;
      scanVideo.loop = false;
      scanVideo.muted = false;
      scanVideo.volume = 1;
      scanVideo.playbackRate = 1;
      scanVideo.setAttribute('aria-hidden', 'true');
      scanVideo.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none;';
      if (sourceVideo.crossOrigin) scanVideo.crossOrigin = sourceVideo.crossOrigin;
      if (sourceVideo.srcObject) {
        scanVideo.srcObject = sourceVideo.srcObject;
      } else {
        const source = sourceVideo.currentSrc || sourceVideo.src;
        if (!source) throw new Error('当前 X 视频没有可复制的音频源');
        scanVideo.src = source;
      }
      document.documentElement.appendChild(scanVideo);
      scanVideo.load();
      if (scanVideo.readyState < 1) {
        await new Promise<void>((resolve, reject) => {
          let timeout: number | undefined;
          const cleanup = () => {
            scanVideo.removeEventListener('loadedmetadata', onReady);
            scanVideo.removeEventListener('canplay', onReady);
            scanVideo.removeEventListener('error', onError);
            if (timeout !== undefined) window.clearTimeout(timeout);
          };
          const onReady = () => { cleanup(); resolve(); };
          const onError = () => { cleanup(); reject(new Error('扫描副本无法加载 X 视频音频')); };
          scanVideo.addEventListener('loadedmetadata', onReady, { once: true });
          scanVideo.addEventListener('canplay', onReady, { once: true });
          scanVideo.addEventListener('error', onError, { once: true });
          timeout = window.setTimeout(() => {
            cleanup();
            reject(new Error('扫描副本加载 X 视频音频超时'));
          }, FULL_SCAN_VIDEO_LOAD_TIMEOUT_MS);
        });
      }
      if (!this.requested || session !== this.session) throw new Error(FULL_CANCELLED_ERROR);
      try { scanVideo.currentTime = 0; } catch { /* 资源已从 0 秒开始时可忽略。 */ }
      return scanVideo;
    } catch (error) {
      // 失败的 MediaSource/blob 隐藏副本不会进入 this.scanVideo（只有成功
      // 返回后才登记），所以必须在这里立即解绑并移除，避免每次点击泄漏
      // 一个 video 元素和一份媒体缓冲。
      try { scanVideo.pause(); } catch { /* 副本可能尚未加载。 */ }
      try { scanVideo.srcObject = null; } catch { /* 只读包装播放器忽略。 */ }
      scanVideo.remove();
      throw error;
    }
  }

  private async finishCapture(session: number): Promise<void> {
    if (session !== this.session || !this.requested || this.phase !== 'capturing') return;
    this.clearFinalizeTimer();
    this.stopAudioGraph();
    if (this.bufferedSamples === 0 || !this.audioHasSpeech) {
      this.fail(new Error('没有捕获到可识别的视频音频，请确认视频有声音后重试'));
      return;
    }

    // 采集完成后立刻冻结在 0 秒；识别/翻译阶段不会继续消耗媒体时间，
    // 也不会在屏幕上显示已经走到结尾的旧 cue。
    const video = this.captureVideo || this.options.getVideo();
    if (video) {
      try {
        video.pause();
        video.currentTime = 0;
      } catch {
        // 后续仍按 PCM 的时间轴完成；播放器如果拒绝 seek，restore 阶段会再试。
      }
    }

    // 结束时补上最后一个尾窗；前面的完整窗口已经在扫描期间排队，
    // 这里只等待同一个串行链，不再从头重新识别整段 PCM。
    this.queueAvailableFullTranscriptionWindows(session, true);
    const transcriptionChain = this.fullTranscriptionChain;
    if (!transcriptionChain) {
      this.fail(new Error('没有生成可识别的音频窗口，请重试'));
      return;
    }
    this.phase = 'transcribing';
    this.transcribing = true;
    const capturedDurationMs = this.bufferedSamples * 1_000 / VIDEO_AI_SAMPLE_RATE;
    this.setProgress({
      phase: 'transcribing',
      progress: 0.45,
      capturedMs: this.captureStartOffsetMs + capturedDurationMs,
      durationMs: this.expectedDurationMs || capturedDurationMs,
      transcribedMs: 0,
      windowIndex: 0,
      windowCount: this.fullWindowCount,
    });

    try {
      await transcriptionChain;
      if (this.fullTranscriptionError) throw this.fullTranscriptionError;
      if (!this.requested || session !== this.session) throw new Error(FULL_CANCELLED_ERROR);

      const flushed = this.fullTranscriptionStabilizer.flush(0);
      this.fullFallbackCues = this.absorbCues(flushed, this.fullCuesById, this.fullFallbackCues);
      const cues = consolidateVideoAiFullCues(mergeVideoAiSubtitleCues([
        ...this.fullCuesById.values(),
        ...this.fullFallbackCues,
      ]).map((cue) => ({
        ...cue,
        availableAtMs: 0,
        translationAvailableAtMs: 0,
      })) as unknown as VideoAiStabilizedCue[]);
      if (cues.length === 0) throw new Error('本地 AI 没有识别出可读字幕，请换用 Base 模型重试');
      if (!this.requested || session !== this.session) throw new Error(FULL_CANCELLED_ERROR);
      this.transcribing = false;
      this.phase = 'translating';
      this.setProgress({
        phase: 'translating',
        progress: 0.85,
        windowIndex: this.fullWindowCount,
        windowCount: this.fullWindowCount,
        transcribedMs: capturedDurationMs,
      });
      await this.options.onTranscriptionComplete(cues, session);
      if (!this.requested || session !== this.session) throw new Error(FULL_CANCELLED_ERROR);

      this.phase = 'ready';
      this.setProgress({
        phase: 'ready',
        progress: 1,
        windowIndex: this.fullWindowCount,
        windowCount: this.fullWindowCount,
        transcribedMs: capturedDurationMs,
      });
      this.releaseAudioBuffers();
      this.restoreMediaState(false, true);
      this.options.onStateChange();
    } catch (error) {
      this.transcribing = false;
      if (session !== this.session || !this.requested || (error instanceof Error && error.message === FULL_CANCELLED_ERROR)) return;
      this.fail(toError(error, '本地视频完整 AI 字幕失败'));
    } finally {
      this.transcribing = false;
      this.releaseAudioBuffers();
    }
  }

  private absorbCues(
    incoming: VideoAiStabilizedCue[],
    cuesById: Map<string, VideoAiStabilizedCue>,
    fallbackCues: VideoAiStabilizedCue[],
  ): VideoAiStabilizedCue[] {
    for (const cue of incoming) {
      const normalized = { ...cue, availableAtMs: 0, translationAvailableAtMs: 0 } as VideoAiStabilizedCue;
      if (normalized.cueId) {
        cuesById.set(normalized.cueId, normalized);
      } else {
        fallbackCues = upsertVideoAiSubtitleCue(fallbackCues, normalized) as VideoAiStabilizedCue[];
      }
    }
    return fallbackCues;
  }

  private createFullAudioWindowFromBlocks(startMs: number, endMs: number): FullAudioWindow | null {
    const startSample = Math.max(0, Math.floor(startMs * VIDEO_AI_SAMPLE_RATE / 1_000));
    const endSample = Math.min(
      this.bufferedSamples,
      Math.max(startSample, Math.ceil(endMs * VIDEO_AI_SAMPLE_RATE / 1_000)),
    );
    if (endSample <= startSample) return null;

    const pcm = new Float32Array(endSample - startSample);
    let blockStartSample = this.audioBlocksStartSample;
    let copiedSamples = 0;
    for (const block of this.audioBlocks) {
      const blockEndSample = blockStartSample + block.length;
      if (blockEndSample <= startSample) {
        blockStartSample = blockEndSample;
        continue;
      }
      if (blockStartSample >= endSample) break;

      const sourceStart = Math.max(0, startSample - blockStartSample);
      const sourceEnd = Math.min(block.length, endSample - blockStartSample);
      if (sourceEnd > sourceStart) {
        const slice = block.subarray(sourceStart, sourceEnd);
        pcm.set(slice, copiedSamples);
        copiedSamples += slice.length;
      }
      blockStartSample = blockEndSample;
    }

    if (copiedSamples !== pcm.length) return null;
    return {
      startMs: startSample * 1_000 / VIDEO_AI_SAMPLE_RATE,
      endMs: endSample * 1_000 / VIDEO_AI_SAMPLE_RATE,
      pcm,
    };
  }

  private trimAudioBlocksBefore(startMs: number): void {
    if (this.audioBlocks.length === 0) return;
    const targetSample = Math.max(
      this.audioBlocksStartSample,
      Math.min(
        this.bufferedSamples,
        Math.floor(startMs * VIDEO_AI_SAMPLE_RATE / 1_000),
      ),
    );
    if (targetSample <= this.audioBlocksStartSample) return;

    let blockStartSample = this.audioBlocksStartSample;
    let removeCount = 0;
    while (removeCount < this.audioBlocks.length) {
      const block = this.audioBlocks[removeCount];
      const blockEndSample = blockStartSample + block.length;
      if (blockEndSample > targetSample) break;
      blockStartSample = blockEndSample;
      removeCount += 1;
    }
    if (removeCount > 0) this.audioBlocks.splice(0, removeCount);

    if (this.audioBlocks.length === 0) {
      this.audioBlocksStartSample = targetSample;
      return;
    }

    const firstBlockOffset = targetSample - blockStartSample;
    if (firstBlockOffset > 0) {
      this.audioBlocks[0] = this.audioBlocks[0].subarray(firstBlockOffset);
      blockStartSample = targetSample;
    }
    this.audioBlocksStartSample = blockStartSample;
  }

  /**
   * 在隐藏 video 仍然扫描时，把已经完整的窗口排进同一个串行 Worker
   * 链。这样识别时间和后续扫描重叠，但不会创建第二个 Whisper session。
   */
  private queueAvailableFullTranscriptionWindows(session: number, forceTail = false): void {
    if (!this.requested || session !== this.session || this.phase !== 'capturing') return;
    if (this.fullWindowLengthMs <= 0) {
      this.fullWindowLengthMs = getWindowLengthMs(this.options.getModel());
      this.fullWindowStepMs = Math.max(
        FULL_MIN_WINDOW_MS,
        this.fullWindowLengthMs - FULL_WINDOW_OVERLAP_MS,
      );
    }

    const capturedMs = this.bufferedSamples * 1_000 / VIDEO_AI_SAMPLE_RATE;
    const queueWindow = (startMs: number, endMs: number): void => {
      const window = this.createFullAudioWindowFromBlocks(startMs, endMs);
      if (!window) return;
      const sequence = this.fullWindowSequence;
      this.fullWindowSequence += 1;
      this.fullWindowCount += 1;
      const previous = this.fullTranscriptionChain || Promise.resolve();
      this.fullTranscriptionChain = previous
        .then(() => this.transcribeFullAudioWindow(window, sequence, session))
        .catch((error) => {
          const normalized = toError(error, '本地视频完整 AI 字幕失败');
          this.fullTranscriptionError ||= normalized;
          if (this.requested && session === this.session) this.fail(normalized);
        });
    };

    while (capturedMs + 1 >= this.fullNextWindowStartMs + this.fullWindowLengthMs) {
      queueWindow(this.fullNextWindowStartMs, this.fullNextWindowStartMs + this.fullWindowLengthMs);
      this.fullNextWindowStartMs += this.fullWindowStepMs;
    }

    if (forceTail && capturedMs > this.fullNextWindowStartMs + 1) {
      const tailDurationMs = capturedMs - this.fullNextWindowStartMs;
      if (this.fullWindowSequence === 0 || tailDurationMs >= FULL_MIN_WINDOW_MS) {
        queueWindow(this.fullNextWindowStartMs, capturedMs);
      }
      this.fullNextWindowStartMs = capturedMs;
    }
    // 已完成窗口的 PCM 已经复制进独立的 Float32Array；只保留下一窗口
    // 的重叠前缀，避免长视频把整个音频时间轴一直挂在页面内存中。
    this.trimAudioBlocksBefore(this.fullNextWindowStartMs);
  }

  private async transcribeFullAudioWindow(
    window: FullAudioWindow,
    sequence: number,
    session: number,
  ): Promise<void> {
    try {
      if (!this.requested || session !== this.session) throw new Error(FULL_CANCELLED_ERROR);
      const chunk: VideoAiAudioChunk = {
        pcm: window.pcm,
        startMs: window.startMs,
        durationMs: window.endMs - window.startMs,
        audioDurationMs: window.pcm.length * 1_000 / VIDEO_AI_SAMPLE_RATE,
        playbackRate: 1,
        sequence: sequence + 1,
        sessionId: session,
      };
      let result: VideoAiTranscriptionResult = { text: '', segments: [] };
      if (measureVideoAiSpeechActivity(window.pcm).active) {
        result = await this.options.transcribe(chunk);
        if (result.skipped) throw new Error('本地视频 AI 完整识别请求被跳过，请重试');
      }
      if (!this.requested || session !== this.session) throw new Error(FULL_CANCELLED_ERROR);
      const cues = this.fullTranscriptionStabilizer.ingest({
        startMs: window.startMs,
        durationMs: chunk.durationMs,
        availableAtMs: 0,
        text: result.text,
        segments: result.segments,
      });
      this.fullFallbackCues = this.absorbCues(cues, this.fullCuesById, this.fullFallbackCues);
      const transcribedMs = window.endMs;
      const progressPhase = this.phase === 'capturing' ? 'capturing' : 'transcribing';
      const progress = progressPhase === 'capturing'
        ? Math.min(0.45, transcribedMs / Math.max(1, this.expectedDurationMs) * 0.45)
        : 0.45 + Math.min(0.4, transcribedMs / Math.max(1, this.expectedDurationMs || transcribedMs) * 0.4);
      this.setProgress({
        phase: progressPhase,
        progress,
        transcribedMs,
        windowIndex: sequence + 1,
        windowCount: this.fullWindowCount,
      });
    } finally {
      // Promise 链仍会保留已完成窗口的闭包；及时丢掉 PCM，避免完整扫描
      // 时每个重叠窗口都把一份音频留到最后才回收。
      window.pcm = new Float32Array();
    }
  }

  private resetFullTranscriptionState(): void {
    this.fullTranscriptionChain = null;
    this.fullTranscriptionStabilizer.reset();
    this.fullCuesById.clear();
    this.fullFallbackCues = [];
    this.fullTranscriptionError = null;
    this.fullNextWindowStartMs = 0;
    this.fullWindowLengthMs = 0;
    this.fullWindowStepMs = 0;
    this.fullWindowSequence = 0;
    this.fullWindowCount = 0;
  }

  private resetAudio(): void {
    this.resampler.reset();
    this.audioBlocks = [];
    this.audioBlocksStartSample = 0;
    this.bufferedSamples = 0;
    this.audioHasSpeech = false;
    this.captureStartOffsetMs = 0;
    this.expectedDurationMs = 0;
    this.resetFullTranscriptionState();
  }

  private releaseAudioBuffers(): void {
    this.audioBlocks = [];
    this.audioBlocksStartSample = 0;
    this.bufferedSamples = 0;
    this.audioHasSpeech = false;
  }

  private stopAudioGraph(): void {
    const keepVisiblePlaybackGraph = this.persistentVisibleAudioSource
      && this.audioContext
      && this.sourceNode
      && this.silentSinkNode;
    this.videoEndedCleanup?.();
    this.videoEndedCleanup = null;
    this.trackEndCleanups.forEach((cleanup) => cleanup());
    this.trackEndCleanups = [];
    if (this.processorNode) this.processorNode.onaudioprocess = null;
    try { this.sourceNode?.disconnect(); } catch { /* 浏览器可能已关闭节点。 */ }
    try { this.processorNode?.disconnect(); } catch { /* 浏览器可能已关闭节点。 */ }
    if (keepVisiblePlaybackGraph) {
      // MediaElementAudioSourceNode 一旦接管 video，关闭 AudioContext 会让
      // 原生音频输出无法恢复。保留一个极轻量的播放图，并把增益切回 1；
      // 下一次完整生成会复用同一个 source node，避免重复绑定异常。
      this.silentSinkNode!.gain.value = 1;
      try { this.sourceNode!.connect(this.silentSinkNode!); } catch { /* 旧图可能已失效。 */ }
    } else {
      try { this.silentSinkNode?.disconnect(); } catch { /* 浏览器可能已关闭节点。 */ }
      this.sourceNode = null;
      this.silentSinkNode = null;
      const context = this.audioContext;
      this.audioContext = null;
      if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    }
    this.processorNode = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.captureSourceStream?.getTracks().forEach((track) => track.stop());
    this.captureSourceStream = null;
    const scanVideo = this.scanVideo;
    this.scanVideo = null;
    if (scanVideo) {
      try { scanVideo.pause(); } catch { /* 副本可能已经结束。 */ }
      try { scanVideo.srcObject = null; } catch { /* 只读包装播放器忽略。 */ }
      scanVideo.remove();
    }
    if (!keepVisiblePlaybackGraph) this.captureVideo = null;
  }

  private restoreMediaState(restorePosition: boolean, replayFromStart = false): void {
    const video = this.captureVideo || this.options.getVideo();
    const saved = this.savedMediaState;
    if (!video || !saved) return;
    try {
      if (restorePosition) video.currentTime = saved.currentTime;
      if (replayFromStart) video.currentTime = 0;
      video.playbackRate = saved.playbackRate;
      video.volume = saved.volume;
      video.muted = saved.muted;
      if (saved.paused) {
        video.pause();
      } else {
        void video.play().catch(() => undefined);
      }
    } catch {
      // 媒体节点被 X 替换时，页面自己的播放状态优先；不让恢复异常阻断
      // 已经生成好的字幕。
    }
  }

  private clearFinalizeTimer(): void {
    if (this.finalizeTimer !== undefined) {
      window.clearTimeout(this.finalizeTimer);
      this.finalizeTimer = undefined;
    }
  }

  private failBeforeStart(error: Error): void {
    this.phase = 'error';
    this.requested = false;
    this.error = error.message;
    this.options.onError(error);
    this.setProgress({ ...this.progress, phase: 'error', progress: 0 });
  }

  private fail(error: Error): void {
    const session = this.session;
    this.session += 1;
    this.requested = false;
    this.error = error.message;
    this.options.onInvalidate?.('error', session);
    this.clearFinalizeTimer();
    this.stopAudioGraph();
    this.restoreMediaState(true);
    this.releaseAudioBuffers();
    this.phase = 'error';
    this.options.onError(error);
    this.setProgress({ ...this.progress, phase: 'error', progress: 0 });
  }

  private setProgress(patch: Partial<VideoAiFullCaptureProgress>): void {
    const previousPhase = this.progress.phase;
    this.progress = { ...this.progress, ...patch };
    const now = performance.now();
    // ScriptProcessorNode 的回调频率会随浏览器实际 AudioContext 采样率变化。
    // 采集阶段只保留最新内部进度，限制 UI/播放器控件刷新到 4Hz；阶段切换
    // 和识别/翻译完成仍然立即通知，避免页面在本地推理时被重复 DOM 更新拖慢。
    if (this.progress.phase === 'capturing'
      && previousPhase === 'capturing'
      && now - this.lastProgressNotifyAt < 250) {
      return;
    }
    this.lastProgressNotifyAt = now;
    this.options.onProgress?.({ ...this.progress });
    this.options.onStateChange();
  }
}
