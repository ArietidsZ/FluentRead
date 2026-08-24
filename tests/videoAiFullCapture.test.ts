import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  consolidateVideoAiFullCues,
  createVideoAiFullAudioWindows,
  VideoAiFullCaptureController,
} from '@/entrypoints/main/video-ai/fullCapture';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('本地 AI 完整视频音频窗口', () => {
  it('Tiny 使用 10 秒窗口和 1.2 秒重叠，并覆盖到完整尾部', () => {
    const audio = new Float32Array(25 * 16_000);
    const windows = createVideoAiFullAudioWindows(audio, 'tiny');

    expect(windows.map(({ startMs, endMs }) => [Math.round(startMs), Math.round(endMs)])).toEqual([
      [0, 10_000],
      [8_800, 18_800],
      [17_600, 25_000],
    ]);
    expect(windows.every(({ pcm }) => pcm.length > 0)).toBe(true);
    expect(windows.at(-1)?.endMs).toBe(25_000);
  });

  it('Base 在较长窗口下仍不超过 Whisper 单次 30 秒上限', () => {
    const audio = new Float32Array(45 * 16_000);
    const windows = createVideoAiFullAudioWindows(audio, 'base');

    expect(windows.length).toBe(4);
    expect(windows[0].endMs - windows[0].startMs).toBe(14_000);
    expect(windows[1].startMs).toBe(12_800);
    expect(windows.at(-1)?.endMs).toBe(45_000);
    expect(Math.max(...windows.map(({ pcm }) => pcm.length / 16_000))).toBeLessThanOrEqual(30);
  });

  it('空 PCM 不会伪造一个可识别窗口', () => {
    expect(createVideoAiFullAudioWindows(new Float32Array(), 'tiny')).toEqual([]);
  });

  it('完整模式会在重叠 spoken 时间内保留信息量更高的句子', () => {
    const cues = consolidateVideoAiFullCues([
      {
        startMs: 15_000,
        durationMs: 3_800,
        spokenEndMs: 18_200,
        availableAtMs: 0,
        text: 'Back inside, the team compared both models and recorded every observation.',
      },
      {
        startMs: 15_300,
        durationMs: 2_000,
        spokenEndMs: 17_000,
        availableAtMs: 0,
        partial: true,
        text: 'Back in some parts of the window,',
      },
    ]);

    expect(cues).toHaveLength(1);
    expect(cues[0].text).toContain('compared both models');
  });
});

describe('本地 AI 完整生成控制器的安全边界', () => {
  it('浏览器不支持采集时立即进入错误态，不会显示生成中', () => {
    const errors: Error[] = [];
    const states: string[] = [];
    const controller = new VideoAiFullCaptureController({
      getVideo: () => null,
      getModel: () => 'tiny',
      isSupported: () => false,
      transcribe: async () => ({ text: '' }),
      onTranscriptionComplete: async () => undefined,
      onError: (error) => errors.push(error),
      onStateChange: () => states.push(controller.getPhase()),
    });

    expect(controller.start()).toBe(false);
    expect(controller.getPhase()).toBe('error');
    expect(controller.isRequested()).toBe(false);
    expect(errors[0]?.message).toContain('完整采集');
    expect(states).not.toContain('capturing');
  });

  it('可直接读取完整媒体时跳过 1x 扫描并保持回放时间轴', async () => {
    const speech = Float32Array.from(
      { length: 3 * 16_000 },
      (_, index) => 0.04 * Math.sin(2 * Math.PI * 220 * index / 16_000),
    );
    const decoded = {
      numberOfChannels: 1,
      sampleRate: 16_000,
      duration: 3,
      getChannelData: () => speech,
    };
    class FastAudioContext {
      state: AudioContextState = 'running';

      async decodeAudioData(): Promise<AudioBuffer> {
        return decoded as unknown as AudioBuffer;
      }

      async close(): Promise<void> {
        this.state = 'closed';
      }
    }
    const videoState = {
      currentSrc: 'data:video/webm;base64,fixture',
      src: 'data:video/webm;base64,fixture',
      duration: 3,
      currentTime: 0,
      paused: false,
      playbackRate: 1,
      muted: false,
      volume: 1,
      captureStream: () => ({ getAudioTracks: () => [] }),
      pause: vi.fn(),
      play: vi.fn(async () => undefined),
    };
    const transcribe = vi.fn(async () => ({
      text: 'A fast decoded sentence.',
      segments: [{ startMs: 0, endMs: 1_000, text: 'A fast decoded sentence.' }],
    }));
    const onTranscriptionComplete = vi.fn(async () => undefined);
    const progress: Array<{ captureMode?: string; phase: string }> = [];
    vi.stubGlobal('window', {
      AudioContext: FastAudioContext,
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(4),
    })));

    const controller = new VideoAiFullCaptureController({
      getVideo: () => videoState as unknown as HTMLVideoElement,
      getModel: () => 'tiny',
      isSupported: () => true,
      transcribe,
      onTranscriptionComplete,
      onError: (error) => { throw error; },
      onStateChange: () => undefined,
      onProgress: (next) => progress.push({ captureMode: next.captureMode, phase: next.phase }),
    });

    expect(controller.start()).toBe(true);
    for (let index = 0; index < 30 && controller.getPhase() !== 'ready'; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(controller.getPhase()).toBe('ready');
    expect(fetch).toHaveBeenCalledWith('data:video/webm;base64,fixture', expect.objectContaining({
      credentials: 'include',
    }));
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(onTranscriptionComplete).toHaveBeenCalledTimes(1);
    expect(progress.some((item) => item.captureMode === 'fast-decode')).toBe(true);
    expect(videoState.currentTime).toBe(0);
    expect(videoState.play).toHaveBeenCalled();
  });
});
