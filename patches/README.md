# Paddle OCR dependency patch

`ppu-paddle-ocr@6.6.0.patch` modifies `core/base-detection.service.js` from
[ppu-paddle-ocr](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr).
The published file is minified to a single line, so the patch contains that
entire line. The original MIT license is included in
`ppu-paddle-ocr-LICENSE.txt`.

Detection failures and missing output tensors must propagate as errors rather
than being reported as an empty page. A successful detection with no text
still returns an empty list. Reassess this patch when upgrading the dependency;
remove it if the upstream behavior has been fixed.
