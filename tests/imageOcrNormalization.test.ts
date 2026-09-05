import {describe, expect, it} from 'vitest';
import {
    getOcrImageSize,
    getAreaOcrImageSize,
    normalizeOcrLines,
    restoreOcrLineCoordinates,
    selectChangedTranslations,
} from '@/src/features/image-translation/core';

describe('图片 OCR 有界尺寸和可信文本', () => {
    it('普通图片保留原始尺寸，大图同时受像素总数和最长边约束', () => {
        expect(getOcrImageSize(320, 180)).toEqual({width: 320, height: 180});
        expect(getOcrImageSize(1920, 1080)).toEqual({width: 1920, height: 1080});
        expect(getOcrImageSize(8000, 1000)).toEqual({width: 4096, height: 512});
        expect(getOcrImageSize(4000, 3000)).toEqual({width: 2828, height: 2121});
        expect(getOcrImageSize(1, 100_000)).toEqual({width: 1, height: 4096});
    });

    it.each([[0, 10], [-1, 10], [10, 0], [10, -1], [Infinity, 10], [10, Infinity], [NaN, 10]])(
        '拒绝无效尺寸 %s × %s', (width, height) => {
            expect(() => getOcrImageSize(width, height)).toThrow('图片尺寸无效');
        },
    );

    it('圈选只放大小图，为紧贴文字预留边框，超大和极窄选区仍有像素预算', () => {
        expect(getAreaOcrImageSize(320, 180)).toEqual({width: 640, height: 360, padding: 10});
        expect(getAreaOcrImageSize(1000, 500)).toEqual({width: 2000, height: 1000, padding: 10});
        expect(getAreaOcrImageSize(1001, 500)).toEqual({width: 1001, height: 500, padding: 10});
        expect(getAreaOcrImageSize(500, 501)).toEqual({width: 500, height: 501, padding: 10});
        for (const [width, height] of [[8000, 1000], [4000, 3000], [1, 100_000], [100_000, 1]]) {
            const size = getAreaOcrImageSize(width, height);
            expect(size.width).toBeGreaterThanOrEqual(1);
            expect(size.height).toBeGreaterThanOrEqual(1);
            expect(Math.max(size.width, size.height) + size.padding * 2).toBeLessThanOrEqual(4096);
            expect((size.width + size.padding * 2) * (size.height + size.padding * 2)).toBeLessThanOrEqual(6_000_000);
        }
        expect(() => getAreaOcrImageSize(0, 50)).toThrow('图片尺寸无效');
    });

    it('圈选坐标先去边框再逆缩放，忽略白边内的伪识别并保留触边原文', () => {
        expect(restoreOcrLineCoordinates([
            {text: 'center', bbox: {x0: 30, y0: 50, x1: 110, y1: 90}},
            {text: 'edge', bbox: {x0: 5, y0: 5, x1: 215, y1: 115}},
            {text: 'border', bbox: {x0: 0, y0: 0, x1: 9, y1: 9}},
        ], 100, 50, 200, 100, 10)).toEqual([
            {text: 'center', bbox: {x0: 10, y0: 20, x1: 50, y1: 40}},
            {text: 'edge', bbox: {x0: 0, y0: 0, x1: 100, y1: 50}},
        ]);
    });

    it('将降采样框映回原图并夹紧越界框，舍弃完全落在图片外的识别', () => {
        expect(restoreOcrLineCoordinates([
            {text: 'valid', bbox: {x0: 10, y0: 20, x1: 30, y1: 40}},
            {text: 'edge', bbox: {x0: -3, y0: -2, x1: 120, y1: 120}},
            {text: 'outside', bbox: {x0: 101, y0: 1, x1: 120, y1: 2}},
            {text: 'invalid', bbox: {x0: NaN, y0: 1, x1: 120, y1: 2}},
        ], 201, 199, 100, 100)).toEqual([
            {text: 'valid', bbox: {x0: 20, y0: 39, x1: 61, y1: 80}},
            {text: 'edge', bbox: {x0: 0, y0: 0, x1: 201, y1: 199}},
        ]);
    });

    it('低置信和无效 words 全部过滤后不再回退到整行噪声', () => {
        const bbox = {x0: 0, y0: 0, x1: 50, y1: 10};
        expect(normalizeOcrLines([{paragraphs: [{lines: [
            {text: 'noise', bbox, words: [{text: 'noise', confidence: 10, bbox}]},
            {text: 'nan', bbox, words: [{text: 'nan', confidence: NaN, bbox}]},
            {text: 'infinite', bbox, words: [{text: 'infinite', confidence: Infinity, bbox}]},
            {text: 'invalid', bbox, words: [{text: 'invalid', bbox: {...bbox, x1: Infinity}}]},
            {text: 'empty', bbox, words: [{text: '  ', bbox}]},
        ]}]}])).toEqual([]);
    });

    it('无词数据时接受可信行，但拒绝低置信度或非有限行框', () => {
        const bbox = {x0: 0, y0: 0, x1: 50, y1: 10};
        expect(normalizeOcrLines([{paragraphs: [{lines: [
            {text: 'recognized', bbox, words: [], confidence: 80},
            {text: 'low', bbox, confidence: 24},
            {text: 'nan', bbox, confidence: NaN},
            {text: 'infinite', bbox: {...bbox, x1: Infinity}},
            {text: 'flat', bbox: {...bbox, y1: 0}},
        ]}]}])).toEqual([{text: 'recognized', bbox}]);
    });

    it('保留英文标点与括号空格语义，不把句子变成分隔符碎片', () => {
        const tokens = ['Hello', ',', 'world', '!', '(', 'Read', 'this', ')'];
        expect(normalizeOcrLines([{paragraphs: [{lines: [{
            text: 'Hello, world! (Read this)',
            bbox: {x0: 0, y0: 0, x1: 100, y1: 10},
            words: tokens.map((text, index) => ({
                text,
                bbox: {x0: index * 12, y0: 0, x1: index * 12 + 10, y1: 10},
            })),
        }]}]}])).toEqual([{
            text: 'Hello, world! (Read this)',
            bbox: {x0: 0, y0: 0, x1: 94, y1: 10},
        }]);
    });

    it('空白译文不会擦除原字，正常译文去掉首尾空白', () => {
        const bbox = {x0: 0, y0: 0, x1: 50, y1: 10};
        const lines = [{text: 'one', bbox}, {text: 'two', bbox}, {text: 'three', bbox}];
        expect(selectChangedTranslations(lines, ['  ', '\n', ' 三 '])).toEqual([{text: '三', bbox}]);
    });
});
