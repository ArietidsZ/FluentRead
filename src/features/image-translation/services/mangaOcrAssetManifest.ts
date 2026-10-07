/**
 * @file src/features/image-translation/services/mangaOcrAssetManifest.ts
 * 文件职责：登记漫画识别与修补模型的固定发布资产清单。
 * 主要内容：保存上游固定 revision、文件路径、精确字节数和 SHA-256，以及识别模型总容量与缓存名。
 * 模块边界：仅导出数据及由清单求和的总字节数，不下载、校验、缓存或执行模型；运行时服务与独立清单契约测试共用这些发布数据。
 */
export const MANGA_OCR_ROOT = 'https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/bf1d5edb0335d3262be7caf13f766ba274b4cadd/';
export const MANGA_OCR_CACHE = 'fluent-read-manga-ocr-v1';
export const MANGA_OCR_ASSETS = [
    {key: 'detection', path: 'detection/PP-OCRv6_small_det.onnx', bytes: 9880512,
        sha256: 'd73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e'},
    {key: 'recognition', path: 'recognition/PP-OCRv6_small_rec.onnx', bytes: 21159378,
        sha256: '5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634'},
    {key: 'charactersDictionary', path: 'recognition/ppocrv6_dict.txt', bytes: 74948,
        sha256: '41557512862dfe31970cf22407742b629725461dd84c0d8771bde9c87c2202c8'},
] as const;
export const MANGA_OCR_MODEL_BYTES = MANGA_OCR_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0);
export const MANGA_INPAINT_ASSET = {
    url: 'https://huggingface.co/ogkalu/lama-manga-onnx-dynamic/resolve/ee4ed4a8447b6730fc41d34f90876b6c48af925a/lama-manga-dynamic.onnx',
    bytes: 206291843, sha256: 'de31ffa5ba26916b8ea35319f6c12151ff9654d4261bccf0583a69bb095315f9',
};
