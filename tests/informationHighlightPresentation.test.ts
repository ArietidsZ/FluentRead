/**
 * @file tests/informationHighlightPresentation.test.ts
 * 文件职责：验证智能高亮共享色板及真实词项热力呈现规则，保护原始评分和 Unicode 坐标。
 * 主要内容：覆盖八档透明度、完整词项单调密度、同分及离群值、无评分关键词底纹、异常输入与标准分词缺失时的有界后备。
 * 模块边界：只执行纯呈现算法，不操作用户网页、不运行语言模型；视觉效果由独立生产浏览器验证。
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {alignInformationWordSpans, informationWordSpans, scoreInformationKeywords, selectInformationSpans} from '@/src/features/information-highlight/domain/keywords';
import {informationGraphemeBoundaries} from '@/src/features/information-highlight/domain/textBoundaries';
import {INFORMATION_HIGHLIGHT_COLORS, INFORMATION_HIGHLIGHT_LEVELS, INFORMATION_HIGHLIGHT_PALETTES, informationHighlightOpacity, presentInformationHeatmap} from '@/src/features/information-highlight/domain/public';

afterEach(() => vi.unstubAllGlobals());
const sample = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa';
function sampleScores(text = sample) {return informationWordSpans(text).map((word, index) => ({start: word.start, end: word.end, score: index + 1}));}

describe('共享阅读色板与透明度', () => {
    it('六套色板的十六进制预览和真实 CSS RGB 完全一致，所有常量不可改写', () => {
        expect(INFORMATION_HIGHLIGHT_COLORS).toEqual(['rose', 'amber', 'mint', 'blue', 'violet', 'slate']);
        expect(Object.isFrozen(INFORMATION_HIGHLIGHT_COLORS)).toBe(true);
        expect(Object.isFrozen(INFORMATION_HIGHLIGHT_PALETTES)).toBe(true);
        for (const color of INFORMATION_HIGHLIGHT_COLORS) {
            const palette = INFORMATION_HIGHLIGHT_PALETTES[color];
            expect(palette.rgb.split(' ').map(Number)).toEqual([1, 3, 5].map(index => parseInt(palette.swatch.slice(index, index + 2), 16)));
            expect(Object.isFrozen(palette)).toBe(true);
        }
    });
    it('八档热力逐步加深且全部柔和有界，旧底色和细线仍保留固定强度', () => {
        expect(INFORMATION_HIGHLIGHT_LEVELS).toBe(8);
        const ramp = Array.from({length: INFORMATION_HIGHLIGHT_LEVELS}, (_, level) => informationHighlightOpacity('heatmap', level));
        expect(ramp).toEqual([0.04, 0.07, 0.11, 0.16, 0.22, 0.30, 0.39, 0.50]);
        expect(informationHighlightOpacity('heatmap')).toBe(ramp[7]);
        expect(informationHighlightOpacity('heatmap', -9)).toBe(ramp[0]);
        expect(informationHighlightOpacity('heatmap', 99)).toBe(ramp[7]);
        expect(informationHighlightOpacity('heatmap', 2.6)).toBe(ramp[3]);
        for (const value of [NaN, Infinity, -Infinity]) expect(informationHighlightOpacity('heatmap', value)).toBe(ramp[3]);
        expect(informationHighlightOpacity('background')).toBe(0.28);
        for (let level = 0; level < INFORMATION_HIGHLIGHT_LEVELS; level++) {
            const [soft, standard, strong] = (['soft', 'standard', 'strong'] as const).map(intensity => informationHighlightOpacity('heatmap', level, intensity));
            expect(soft).toBeLessThan(standard); expect(strong).toBeGreaterThan(standard); expect(strong).toBeLessThanOrEqual(0.8);
        }
        expect(informationHighlightOpacity('heatmap', 7, 'strong')).toBe(0.8); expect(informationHighlightOpacity('heatmap', 7, 'soft')).toBe(0.3);
        expect(informationHighlightOpacity('background', 0, 'strong')).toBe(0.448); expect(informationHighlightOpacity('background', 0, 'soft')).toBe(0.168);
        expect(informationHighlightOpacity('underline', 0, 'strong')).toBe(1); expect(informationHighlightOpacity('underline', 0, 'soft')).toBe(0.48);
        expect(informationHighlightOpacity('underline')).toBe(0.8);
    });
});

describe('词项热力呈现的评分与密度边界', () => {
    it('默认热力广泛柔和覆盖，三档只增加完整词项，并保留每个词的原分数和层次', () => {
        const raw = sampleScores(), snapshot = structuredClone(raw);
        const results = ['low', 'medium', 'high'].map(density => presentInformationHeatmap(sample, raw, density as 'low' | 'medium' | 'high'));
        expect(results.map(result => result.length)).toEqual([7, 14, 16]);
        for (let index = 0; index < 2; index++) {
            const next = new Map(results[index + 1].map(span => [span.start, span]));
            for (const span of results[index]) expect(next.get(span.start)).toEqual(span);
        }
        expect(results[2].map(span => span.score)).toEqual(raw.map(span => span.score));
        expect(new Set(results[2].map(span => span.level)).size).toBe(8);
        expect(results[2].map(span => sample.slice(span.start, span.end))).toEqual(sample.split(' '));
        expect(raw).toEqual(snapshot);
        expect(selectInformationSpans(sample, raw, 'high').reduce((size, span) => size + span.end - span.start, 0)).toBeLessThan(results[1].reduce((size, span) => size + span.end - span.start, 0));
    });
    it('同分使用同一平均秩次，单词或整段等分使用中间柔和色阶，密度仍保持选择性', () => {
        const text = 'alpha bravo charlie delta';
        const spans = sampleScores(text).map((span, index) => ({...span, score: index < 2 ? 1 : 10}));
        expect(presentInformationHeatmap(text, spans, 'high').map(span => span.level)).toEqual([0, 0, 5, 5]);
        const equal = spans.map(span => ({...span, score: 7}));
        expect(presentInformationHeatmap(text, equal, 'high').map(span => span.level)).toEqual([3, 3, 3, 3]);
        expect(presentInformationHeatmap(text, equal, 'low')).toHaveLength(2);
        expect(presentInformationHeatmap('alpha', [{start: 0, end: 5, score: 1000}], 'high')).toEqual([{start: 0, end: 5, score: 1000, level: 3}]);
    });
    it('极端离群值保留原分数，不挤压其它词的可辨层次或制造固定重要性阈值', () => {
        const raw = sampleScores();
        const extreme = raw.map((span, index) => ({...span, score: index === raw.length - 1 ? 1e200 : span.score}));
        const normal = presentInformationHeatmap(sample, raw, 'high'), outlier = presentInformationHeatmap(sample, extreme, 'high');
        expect(outlier.map(span => span.level)).toEqual(normal.map(span => span.level));
        expect(outlier.at(-1)!.score).toBe(1e200);
    });
    it('只绘制评分器返回的词项，深色集中在少数高分词上，空评分不产生绘制', () => {
        const text = 'The algorithm and the original reading.';
        const raw = scoreInformationKeywords(text).spans;
        expect(presentInformationHeatmap(text, raw, 'high').map(span => text.slice(span.start, span.end))).toEqual(['algorithm', 'original', 'reading']);
        expect(presentInformationHeatmap(text, [], 'high')).toEqual([]);
        expect(presentInformationHeatmap('the and', scoreInformationKeywords('the and').spans, 'high')).toEqual([]);
        const levels = presentInformationHeatmap(sample, sampleScores(), 'high').map(span => span.level);
        expect(levels.filter(level => level <= 3).length).toBeGreaterThan(levels.filter(level => level >= 5).length * 2);
        expect(levels).toEqual([...levels].sort((a, b) => a - b));
    });
    it('评分片段聚合到完整字素和词项，拒绝非法边界、标点、emoji及累加溢出', () => {
        const text = 'extraordinary cafe\u0301 👩‍💻，中文阅读。';
        const raw = [{start: 0, end: 5, score: 2}, {start: 5, end: 13, score: 3}, {start: 14, end: 19, score: 4},
            {start: 19, end: 26, score: 5}, {start: -1, end: 4, score: 5}, {start: .5, end: 4, score: 5},
            {start: 0, end: 0, score: 5}, {start: 0, end: 999, score: 5}, {start: 0, end: 1, score: NaN},
            {start: 14, end: 18, score: 999}, {start: 21, end: 22, score: 999}];
        const result = presentInformationHeatmap(text, raw, 'high');
        expect(result.map(span => text.slice(span.start, span.end))).toEqual(['extraordinary', 'cafe\u0301']);
        expect(result.map(span => span.score)).toEqual([5, 4]);
        const boundaries = informationGraphemeBoundaries(text);
        expect(result.every(span => boundaries.has(span.start) && boundaries.has(span.end))).toBe(true);
        expect(presentInformationHeatmap('! 👩‍💻', [{start: 0, end: 7, score: 4}], 'high')).toEqual([]);
        expect(alignInformationWordSpans('alpha', [{start: 0, end: 5, score: Number.MAX_VALUE}, {start: 0, end: 5, score: Number.MAX_VALUE}])).toEqual([]);
    });
    it('标准分词缺失时保留组合重音、代理对和汉字词项，不切开连字字素', () => {
        vi.stubGlobal('Intl', {...Intl, Segmenter: undefined});
        const text = 'cafe\u0301 中文阅读 𠀀𠀁 ab-cd 👩‍💻';
        const raw = sampleScores(text), result = presentInformationHeatmap(text, raw, 'high');
        expect(result.map(span => text.slice(span.start, span.end))).toEqual(['cafe\u0301', '中文', '阅读', '𠀀𠀁', 'ab-cd']);
        const boundaries = informationGraphemeBoundaries(text);
        expect(result.every(span => boundaries.has(span.start) && boundaries.has(span.end))).toBe(true);
        expect(presentInformationHeatmap('ab‍cd', [{start: 0, end: 5, score: 1}], 'high')).toEqual([]);
    });
});
