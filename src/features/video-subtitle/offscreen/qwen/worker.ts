/**
 * @file src/features/video-subtitle/offscreen/qwen/worker.ts
 * 文件职责：在独立 Worker 中组装 Qwen3-ASR 0.6B WebGPU 转写与已有字幕消息协议。
 * 主要内容：要求硬件 WebGPU、按 shader-f16 选量化、顺序复用会话、跳过近数字静音并返回真实窗口边界；故障不请求 CPU 重试。
 * 模块边界：不采集音频、不访问页面、不把输入上传；取消和硬超时由现有 owner 终止 Worker。
 */
import { Tokenizer } from '@huggingface/tokenizers';
import * as ort from 'onnxruntime-web-qwen/webgpu';
import { probeWebGpu } from '@/src/shared/onnx/webgpu';
import { configureOnnxWasmBackend, withCompressedWasmBinary } from '@/src/shared/onnx/wasmBinary';
import { createQwenAudioFrontend, type QwenMelFilters } from './audio';
import { createQwenAsrEngine } from './engine';
import { readQwenAsrFile } from './cache';
import { QWEN_ASR_MODEL, QWEN_PROMPT, selectQwenVariant, type QwenVariant } from './model';
interface Request {
    requestId: number;
    type: 'prepare' | 'transcribe' | 'dispose';
    audio?: Float32Array;
    sourceLanguage?: string;
    device?: string;
}
let model: Awaited<ReturnType<typeof createQwenAsrEngine>> | undefined;
let variant: QwenVariant = 'q4', gpuInfo = '';
let queue = Promise.resolve();
const url = (path: string) => new URL(path, self.location.href).toString();
async function prepare(): Promise<void> {
    if (model)
        return;
    const gpu = await probeWebGpu();
    if (!gpu.available)
        throw new Error('Qwen ASR 需要硬件 WebGPU，不会改用 CPU');
    gpuInfo = gpu.info;
    variant = selectQwenVariant(gpu.features || []);
    ort.env.wasm.numThreads = 1;
    // 直接 ORT 与 Kokoro 当前锁定相同的1.26构建；重用匹配的数据文件，运行时仍在独立 Worker 中。
    configureOnnxWasmBackend(ort.env.wasm, { mjs: url('fluent-read-ai/tts-ort-wasm-simd-threaded.asyncify.mjs'), wasm: url('fluent-read-ai/tts-ort-wasm-simd-threaded.asyncify.wasm') });
    const filters = JSON.parse(new TextDecoder().decode(await readQwenAsrFile(QWEN_PROMPT.mel.filters_file))) as QwenMelFilters;
    const tokenizer = new Tokenizer(JSON.parse(new TextDecoder().decode(await readQwenAsrFile('tokenizer.json'))), JSON.parse(new TextDecoder().decode(await readQwenAsrFile('tokenizer_config.json'))));
    model = await withCompressedWasmBinary(ort.env.wasm, url('fluent-read-ai/tts-ort-wasm-simd-threaded.asyncify.wasm'), () => createQwenAsrEngine({ variant, read: readQwenAsrFile, frontend: createQwenAudioFrontend(filters), decode: ids => tokenizer.decode(ids, { skip_special_tokens: true }) }));
}
export function startQwenAsrWorker(): void {
    self.addEventListener('message', (event: MessageEvent<Request>) => {
        const request = event.data;
        if (!request || !Number.isSafeInteger(request.requestId))
            return;
        const run = async () => {
            try {
                if (request.device === 'wasm')
                    throw new Error('Qwen ASR 不支持 CPU 回退');
                if (request.type === 'dispose') {
                    await model?.dispose();
                    model = undefined;
                    self.postMessage({ requestId: request.requestId, success: true });
                    return;
                }
                if (request.type !== 'prepare' && request.type !== 'transcribe')
                    throw new Error('Qwen ASR 请求无效');
                const started = performance.now();
                const audio = request.audio;
                if (request.type === 'transcribe' && (!(audio instanceof Float32Array) || audio.length > 480000 || !audio.every(Number.isFinite)))
                    throw new Error('Qwen ASR 音频无效');
                if (request.type === 'transcribe' && (audio!.length < 400 || audio!.every(value => Math.abs(value) < 1e-5))) {
                    self.postMessage({ requestId: request.requestId, success: true, model: QWEN_ASR_MODEL, text: '', segments: [], skipped: true });
                    return;
                }
                await prepare();
                if (request.type === 'prepare') {
                    self.postMessage({ requestId: request.requestId, success: true, model: QWEN_ASR_MODEL, backend: 'webgpu', gpuInfo, dtype: variant });
                    return;
                }
                const text = await model!.transcribe(audio!, request.sourceLanguage);
                const audioDurationMs = audio!.length / 16;
                self.postMessage({ requestId: request.requestId, success: true, model: QWEN_ASR_MODEL, backend: 'webgpu', gpuInfo, dtype: variant,
                    text, segments: text ? [{ startMs: 0, endMs: audioDurationMs, text }] : [], timestampSource: 'window', audioDurationMs, inferenceMs: performance.now() - started });
            }
            catch (error) {
                await model?.dispose().catch(() => undefined);
                model = undefined;
                self.postMessage({ requestId: request.requestId, success: false, error: error instanceof Error ? error.message : String(error) });
            }
        };
        queue = queue.then(run, run);
    });
}
