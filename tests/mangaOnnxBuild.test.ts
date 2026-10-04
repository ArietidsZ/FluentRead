import {describe,expect,it} from 'vitest';
import {mangaOnnxBuildPlugin} from '../scripts/wasm/manga-onnx-build';
describe('漫画 ONNX 构建隔离',()=>{
    it('只将 Paddle 浏览器 SDK 解析到同一个 WebGPU bundle，保留其他模型的版本与实例',()=>{
        const plugin=mangaOnnxBuildPlugin();
        expect(plugin.resolveId('onnxruntime-web','/packages/ppu-paddle-ocr/web/platform.web.js')).toMatch(/ort\.webgpu\.bundle\.min\.mjs$/);
        expect(plugin.resolveId('onnxruntime-web','C:\\packages\\ppu-paddle-ocr\\web\\paddle-ocr.service.web.js')).toMatch(/ort\.webgpu\.bundle\.min\.mjs$/);
        expect(plugin.resolveId('onnxruntime-web')).toBeNull();
        expect(plugin.resolveId('onnxruntime-web','/packages/transformers/index.js')).toBeNull();
        expect(plugin.resolveId('onnxruntime-web/webgpu','/packages/ppu-paddle-ocr/web/platform.web.js')).toBeNull();
    });
});
