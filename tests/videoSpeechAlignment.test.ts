import {describe, expect, it} from 'vitest';
import {alignVideoAiSegmentsToSpeech, findVideoAiPauseBoundary} from '@/src/features/video-subtitle/content/video-ai/speechAlignment';

function pcm(durationMs: number, ranges: [number, number][]): Float32Array {
  const audio = new Float32Array(durationMs * 16);
  for (const [start, end] of ranges) audio.fill(0.1, start * 16, end * 16);
  return audio;
}
describe('音频停顿与完整字幕对齐', () => {
  it('从句级时间戳两侧去掉明显静音，保留轻声边界余量及文字', () => {
    const audio = pcm(6000, [[0, 1800], [3200, 5000]]);
    expect(alignVideoAiSegmentsToSpeech(audio, [
      {startMs: 0, endMs: 2400, text: 'First sentence.'},
      {startMs: 2400, endMs: 6000, text: 'Second sentence.'},
    ])).toEqual([
      {startMs: 0, endMs: 1840, text: 'First sentence.'},
      {startMs: 3160, endMs: 5040, text: 'Second sentence.'},
    ]);
  });
  it('短停顿与连续背景声音不改变模型给定边界', () => {
    const audio = pcm(1000, [[80, 920]]);
    expect(alignVideoAiSegmentsToSpeech(audio, [{startMs: 0, endMs: 1000, text: 'quiet edges'}]))
      .toEqual([{startMs: 0, endMs: 1000, text: 'quiet edges'}]);
    const short = new Float32Array(50).fill(0.01);
    expect(alignVideoAiSegmentsToSpeech(short, [{text: 'tiny'}])).toEqual([{text: 'tiny', startMs: 0, endMs: 3.125}]);
  });
  it('空音频、静音及非有限采样不捏造新的时间戳', () => {
    const segments = [{startMs: 0, endMs: 1000, text: 'low volume'}];
    const audio = new Float32Array(16000);audio[0] = NaN;audio[1] = Infinity;
    expect(alignVideoAiSegmentsToSpeech(audio, segments)).toEqual(segments);
    expect(alignVideoAiSegmentsToSpeech(new Float32Array(), segments)).toEqual(segments);
    expect(alignVideoAiSegmentsToSpeech(audio, [])).toEqual([]);
    expect(alignVideoAiSegmentsToSpeech(pcm(1000, [[0, 1000]]), [{startMs: NaN, endMs: NaN}]))
      .toEqual([{startMs: 0, endMs: 1000}]);
  });
  it('长窗优先从后半段自然停顿切开，连续语音仍保留重叠窗口', () => {
    expect(findVideoAiPauseBoundary(pcm(10000, [[0, 3900], [5200, 9000]]))).toBe(9500);
    expect(findVideoAiPauseBoundary(pcm(10000, [[0, 3000], [4000, 10000]]))).toBe(0);
    expect(findVideoAiPauseBoundary(pcm(10000, [[0, 6100], [7500, 10000]]))).toBe(6800);
    expect(findVideoAiPauseBoundary(pcm(10000, [[0, 9750]]))).toBe(0);
    expect(findVideoAiPauseBoundary(pcm(10000, [[0, 10000]]))).toBe(0);
    expect(findVideoAiPauseBoundary(new Float32Array())).toBe(0);
  });
  it('模型提前截断词尾时补齐到邻近停顿，不越过下一句或连续背景声', () => {
    const audio=pcm(4000,[[0,2400],[3200,4000]]);
    expect(alignVideoAiSegmentsToSpeech(audio,[{startMs:0,endMs:1900,text:'complete the word'}])[0].endMs).toBe(2440);
    expect(alignVideoAiSegmentsToSpeech(audio,[{startMs:0,endMs:1900},{startMs:2100,endMs:2400}])[0].endMs).toBe(1900);
    expect(alignVideoAiSegmentsToSpeech(pcm(4000,[[0,4000]]),[{startMs:0,endMs:1900}])[0].endMs).toBe(1900);
    expect(alignVideoAiSegmentsToSpeech(audio,[{startMs:0,endMs:2400}])[0].endMs).toBe(2440);
  });

});
