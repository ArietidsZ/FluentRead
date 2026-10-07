import {describe, expect, it, vi} from 'vitest';
vi.unmock('@/src/features/image-translation/services/mangaOcrAssetManifest');
import {MANGA_OCR_ROOT, MANGA_OCR_CACHE, MANGA_OCR_ASSETS, MANGA_OCR_MODEL_BYTES, MANGA_INPAINT_ASSET} from '@/src/features/image-translation/services/mangaOcrAssetManifest';
import * as runtime from '@/src/features/image-translation/services/mangaOcrAssets';

describe('未 mock 的漫画发布资产清单契约', () => {
    it('识别源固定 URL/revision，文件名、精确尺寸和 SHA-256 保持原发布值', () => {
        expect(MANGA_OCR_ROOT).toBe('https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/bf1d5edb0335d3262be7caf13f766ba274b4cadd/');
        expect(MANGA_OCR_ASSETS).toEqual([
    {key: 'detection', path: 'detection/PP-OCRv6_small_det.onnx', bytes: 9880512,
        sha256: 'd73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e'},
    {key: 'recognition', path: 'recognition/PP-OCRv6_small_rec.onnx', bytes: 21159378,
        sha256: '5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634'},
    {key: 'charactersDictionary', path: 'recognition/ppocrv6_dict.txt', bytes: 74948,
        sha256: '41557512862dfe31970cf22407742b629725461dd84c0d8771bde9c87c2202c8'},
]);
        expect(MANGA_OCR_ASSETS.map(asset => asset.path.split('/').pop())).toEqual(['PP-OCRv6_small_det.onnx', 'PP-OCRv6_small_rec.onnx', 'ppocrv6_dict.txt']);
    });
    it('LaMa URL/revision、文件名、精确尺寸与哈希保持原发布值', () => {
        expect(MANGA_INPAINT_ASSET).toEqual({
    url: 'https://huggingface.co/ogkalu/lama-manga-onnx-dynamic/resolve/ee4ed4a8447b6730fc41d34f90876b6c48af925a/lama-manga-dynamic.onnx',
    bytes: 206291843, sha256: 'de31ffa5ba26916b8ea35319f6c12151ff9654d4261bccf0583a69bb095315f9',
});
        expect(new URL(MANGA_INPAINT_ASSET.url).pathname.split('/').pop()).toBe('lama-manga-dynamic.onnx');
    });
    it('真实总容量和缓存名保持原值，旧 runtime exports 引用同一份清单', () => {
        expect(MANGA_OCR_MODEL_BYTES).toBe(31_114_838);
        expect(MANGA_OCR_CACHE).toBe('fluent-read-manga-ocr-v1');
        expect(runtime.MANGA_OCR_ASSETS).toBe(MANGA_OCR_ASSETS);
        expect(runtime.MANGA_INPAINT_ASSET).toBe(MANGA_INPAINT_ASSET);
        expect(runtime.MANGA_OCR_MODEL_BYTES).toBe(MANGA_OCR_MODEL_BYTES);
        expect(runtime.MANGA_OCR_CACHE).toBe(MANGA_OCR_CACHE);
    });
});
