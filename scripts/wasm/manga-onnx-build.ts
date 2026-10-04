import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

/** Paddle 的两个浏览器端口与漫画入口共享 WebGPU/CPU 实例；仅限定该 SDK，不改动字幕或其他 ONNX 版本。 */
export function mangaOnnxBuildPlugin() {
    return {
        name:'fluentread-manga-onnx',
        enforce:'pre' as const,
        resolveId(source:string,importer?:string) {
            if(source!=='onnxruntime-web'||!importer?.replace(/\\/g,'/').includes('/ppu-paddle-ocr/'))return null;
            return require.resolve('onnxruntime-web/webgpu').replace(/\.min\.js$/,'.bundle.min.mjs');
        },
    };
}
