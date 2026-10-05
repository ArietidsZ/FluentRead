/**
 * @file src/features/video-subtitle/offscreen/qwen/engine.ts
 * 文件职责：直接通过 WebGPU 运行固定导出的 Qwen3-ASR 0.6B 编码器与自回归解码器。
 * 主要内容：复用会话与量化嵌入，KV 保留在 GPU，贪心解码、有限 token 和取消边界；只返回窗口文字，不生成未对齐的词级时间戳。
 * 模块边界：模型字节、音频特征与分词解码由调用方提供；不下载、不访问页面、不创建 CPU 模型或失败回退。
 */
import * as ort from 'onnxruntime-web-qwen/webgpu';
import { QWEN_PROMPT, type QwenVariant } from './model';
import { qwenArgmax, qwenEmbeddingRow, qwenFloatData, qwenPromptEmbeddings, qwenTextTokens } from './tensors';
type Tensor = ort.Tensor;
type Session = ort.InferenceSession;
interface QwenEngineInput {
    variant: QwenVariant;
    read: (path: string) => Promise<ArrayBuffer>;
    frontend: (audio: Float32Array) => Promise<{
        data: Float32Array;
        frames: number;
    }>;
    decode: (tokens: number[]) => string;
}
const aborted = (signal?: AbortSignal) => { if (signal?.aborted)
    throw new DOMException('Qwen ASR 已取消', 'AbortError'); };
const release = (sessions: Session[]) => Promise.allSettled(sessions.map(session => Promise.resolve().then(() => session.release())));
const inputType = (session: Session, name: string) => { const metadata = session.inputMetadata[session.inputNames.indexOf(name)]; return metadata && 'type' in metadata ? metadata.type : undefined; };
const dispose = (tensors: Record<string, Tensor> | undefined) => { for (const tensor of Object.values(tensors || {})) {
    try {
        tensor.dispose();
    }
    catch { /* 会话释放仍会回收设备资源；清理异常不覆盖原始推理错误。 */ }
} };
export async function createQwenAsrEngine(input: QwenEngineInput, signal?: AbortSignal) {
    const config = QWEN_PROMPT, variant = config.variants[input.variant], sessions: Session[] = [];
    let encoder!: Session, init!: Session, step!: Session, embeddings!: Int8Array, scales!: Float32Array;
    try {
        aborted(signal);
        embeddings = new Int8Array(await input.read(config.embedding.file));
        scales = new Float32Array(await input.read(config.embedding.scales_file));
        if (embeddings.length !== config.embedding.shape[0] * config.embedding.shape[1] || scales.length !== config.embedding.shape[0])
            throw new Error('Qwen ASR 嵌入文件大小不符');
        aborted(signal);
        encoder = await ort.InferenceSession.create(await input.read(variant.encoder), { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' });
        sessions.push(encoder);
        aborted(signal);
        const weights = new Uint8Array(await input.read(variant.weights));
        const options: ort.InferenceSession.SessionOptions = { executionProviders: ['webgpu'], graphOptimizationLevel: 'all',
            externalData: [{ path: variant.weights, data: weights }], preferredOutputLocation: { logits: 'cpu', present_keys: 'gpu-buffer', present_values: 'gpu-buffer' } };
        init = await ort.InferenceSession.create(await input.read(variant.decoder_init), options);
        sessions.push(init);
        aborted(signal);
        step = await ort.InferenceSession.create(await input.read(variant.decoder_step), options);
        sessions.push(step);
        aborted(signal);
        // FP16 encoder仍接收并返回 FP32；decoder的精度由实际图元数据决定。
        if (inputType(encoder, encoder.inputNames[0]) !== 'float32')
            throw new Error('Qwen ASR 编码器输入契约不符');
        for (const session of [init, step]) {
            const type = inputType(session, 'input_embeds');
            if (type !== 'float16' && type !== 'float32')
                throw new Error('Qwen ASR 解码器输入契约不符');
        }
    }
    catch (error) {
        await release(sessions);
        throw error;
    }
    let disposed = false, failed = false, busy = false;
    return {
        async transcribe(audio: Float32Array, language: string | undefined, signal?: AbortSignal): Promise<string> {
            if (busy)
                throw new Error('Qwen ASR 正在处理另一个窗口');
            if (disposed || failed)
                throw new Error('Qwen ASR GPU 会话已失效，请重试');
            aborted(signal);
            busy = true;
            failed = true;
            let encoded: Record<string, Tensor> | undefined, outputs: Record<string, Tensor> | undefined;
            try {
                const mel = await input.frontend(audio);
                aborted(signal);
                const tensor = new ort.Tensor('float32', mel.data, [1, 128, mel.frames]);
                try {
                    encoded = await encoder.run({ [encoder.inputNames[0]]: tensor });
                }
                finally {
                    tensor.dispose();
                }
                aborted(signal);
                const features = encoded!.audio_features;
                if (features.type !== 'float32' || features.dims[0] !== 1 || features.dims[2] !== config.decoder.hidden_size)
                    throw new Error('Qwen ASR 音频输出契约不符');
                const normalized = language?.toLowerCase().split(/[-_]/)[0];
                const forced = config.language_prefix_ids[normalized as keyof typeof config.language_prefix_ids] || [];
                const suffix = [...config.prompt.suffix_ids, ...forced];
                const prompt = qwenPromptEmbeddings(embeddings, scales, config.decoder.hidden_size, config.prompt.prefix_ids, features.data as Float32Array, suffix);
                dispose(encoded);
                encoded = undefined;
                let length = prompt.length / config.decoder.hidden_size;
                let data = prompt;
                const generated: number[] = [];
                for (let count = 0; count < config.prompt.max_new_tokens; count++) {
                    aborted(signal);
                    const session = count === 0 ? init : step;
                    const fp16 = inputType(session, 'input_embeds') === 'float16';
                    const size = count === 0 ? length : 1;
                    const embed = new ort.Tensor(fp16 ? 'float16' : 'float32', qwenFloatData(data, fp16), [1, size, config.decoder.hidden_size]);
                    const positions = new ort.Tensor('int64', BigInt64Array.from({ length: size }, (_, i) => BigInt(count === 0 ? i : length - 1)), [1, size]);
                    const feeds: Record<string, Tensor> = { input_embeds: embed, position_ids: positions };
                    if (outputs) {
                        feeds.past_keys = outputs.present_keys;
                        feeds.past_values = outputs.present_values;
                    }
                    let next: Record<string, Tensor>;
                    try {
                        next = await session.run(feeds);
                    }
                    finally {
                        embed.dispose();
                        positions.dispose();
                    }
                    dispose(outputs);
                    outputs = next;
                    aborted(signal);
                    const logits = outputs.logits;
                    if (logits.data.length !== config.decoder.vocab_size)
                        throw new Error('Qwen ASR logits 形状无效');
                    const token = qwenArgmax(logits.data as Float32Array | Uint16Array);
                    if (config.prompt.eos_ids.includes(token)) {
                        const textTokens = qwenTextTokens(generated, config.prompt.asr_text_id);
                        const text = textTokens.length === 0 ? '' : input.decode(textTokens).trim();
                        failed = false;
                        return text;
                    }
                    generated.push(token);
                    length++;
                    data = qwenEmbeddingRow(embeddings, scales, config.decoder.hidden_size, token);
                }
                throw new Error('Qwen ASR 输出达到长度上限，请缩短语音窗口');
            }
            finally {
                busy = false;
                dispose(encoded);
                dispose(outputs);
            }
        },
        async dispose(): Promise<void> { if (disposed)
            return; disposed = true; embeddings = new Int8Array(); scales = new Float32Array(); await release(sessions); },
    };
}
