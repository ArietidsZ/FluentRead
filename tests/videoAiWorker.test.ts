import {describe, expect, it} from 'vitest';
import {parseWhisperChunkTimestamps} from '@/src/features/video-subtitle/offscreen/timestampParser';

describe('视频 AI Worker timestamp parser', () => {
    it('把连续缺失 timestamp 的 chunks 分成单调区间', () => {
        const result = parseWhisperChunkTimestamps([
            {text: 'first'},
            {text: 'second'},
        ], 2_000);
        expect(result).toEqual([
            {startMs: 0, endMs: 1_000, text: 'first'},
            {startMs: 1_000, endMs: 2_000, text: 'second'},
        ]);
    });

    it('使用下一段已知起点填补缺失结束点并避免相撞', () => {
        const result = parseWhisperChunkTimestamps([
            {timestamp: [0, null], text: 'first'},
            {timestamp: [1.5, 2], text: 'second'},
        ], 2_000);
        expect(result[0]).toMatchObject({startMs: 0, endMs: 1_500});
        expect(result[1]).toMatchObject({startMs: 1_500, endMs: 2_000});
    });

    it('过滤空文本并限制越界时间', () => {
        const result = parseWhisperChunkTimestamps([
            {timestamp: [-1, 99], text: '  kept  '},
            {timestamp: [99, 100], text: ''},
        ], 1_000);
        expect(result).toEqual([{startMs: 0, endMs: 1_000, text: 'kept'}]);
    });

    it('修复相同起止点为最小可见区间', () => {
        const result = parseWhisperChunkTimestamps([{timestamp: [1, 1], text: 'edge'}], 2_000);
        expect(result[0]).toMatchObject({startMs: 1_000, endMs: 1_400});
    });
    it('对非法音频时长和非字符串文本返回空结果', () => {
        expect(parseWhisperChunkTimestamps([{timestamp: [0, 1], text: 123}], Number.NaN)).toEqual([]);
    });
});
