/**
 * @file src/features/video-subtitle/offscreen/qwen/tensors.ts
 * 文件职责：构造 Qwen ASR 解码输入并解释浮点输出，不复制完整嵌入矩阵。
 * 主要内容：按 token 行反量化 INT8 嵌入、拼接音频特征、FP16 转换、有限 logits 贪心选择与转写文本标记裁剪。
 * 模块边界：纯数值处理，不访问 GPU、缓存、浏览器或分词器。
 */
const floatScratch = new Float32Array(1), bitsScratch = new Uint32Array(floatScratch.buffer);
export function floatToHalf(value: number): number {
    floatScratch[0] = value;
    const bits = bitsScratch[0], sign = (bits >>> 16) & 0x8000, exponent = ((bits >>> 23) & 255) - 127 + 15, mantissa = bits & 0x7fffff;
    if (exponent >= 31)
        return sign | 0x7c00 | (mantissa && ((bits >>> 23) & 255) === 255 ? 0x200 : 0);
    if (exponent <= 0) {
        if (exponent < -10)
            return sign;
        const full = mantissa | 0x800000, shift = 14 - exponent, rounded = (full + (1 << (shift - 1)) - 1 + ((full >>> shift) & 1)) >>> shift;
        return sign | rounded;
    }
    const rounded = mantissa + 0xfff + ((mantissa >>> 13) & 1);
    return sign | (exponent << 10) + (rounded >>> 13);
}
export function halfToFloat(value: number): number {
    const sign = value & 0x8000 ? -1 : 1, exponent = (value >>> 10) & 31, mantissa = value & 1023;
    return exponent === 31 ? (mantissa ? NaN : sign * Infinity) : sign * (exponent ? 1 + mantissa / 1024 : mantissa / 1024) * 2 ** (exponent ? exponent - 15 : -14);
}
export function qwenFloatData(data: Float32Array, fp16: boolean): Float32Array | Uint16Array {
    return fp16 ? Uint16Array.from(data, floatToHalf) : data;
}
export function qwenEmbeddingRow(tokens: Int8Array, scales: Float32Array, hidden: number, id: number): Float32Array {
    if (!Number.isSafeInteger(id) || id < 0 || id >= scales.length || tokens.length !== scales.length * hidden || !Number.isFinite(scales[id]))
        throw new Error('Qwen ASR 嵌入索引或形状无效');
    const row = new Float32Array(hidden), offset = id * hidden, scale = scales[id];
    for (let i = 0; i < hidden; i++)
        row[i] = tokens[offset + i] * scale;
    return row;
}
export function qwenPromptEmbeddings(tokens: Int8Array, scales: Float32Array, hidden: number, prefix: readonly number[], audio: Float32Array, suffix: readonly number[]): Float32Array {
    if (audio.length % hidden !== 0 || !audio.every(Number.isFinite))
        throw new Error('Qwen ASR 音频编码形状无效');
    const output = new Float32Array((prefix.length + suffix.length) * hidden + audio.length);
    prefix.forEach((id, index) => output.set(qwenEmbeddingRow(tokens, scales, hidden, id), index * hidden));
    output.set(audio, prefix.length * hidden);
    suffix.forEach((id, index) => output.set(qwenEmbeddingRow(tokens, scales, hidden, id), (prefix.length + index) * hidden + audio.length));
    return output;
}
export function qwenArgmax(data: Float32Array | Uint16Array): number {
    let token = -1, best = -Infinity;
    for (let i = 0; i < data.length; i++) {
        const value = data instanceof Uint16Array ? halfToFloat(data[i]) : data[i];
        if (Number.isNaN(value) || value === Infinity) throw new Error('Qwen ASR 解码结果无效');
        if (Number.isFinite(value) && value > best) {
            best = value;
            token = i;
        }
    }
    if (token < 0)
        throw new Error('Qwen ASR 解码结果无效');
    return token;
}
export function qwenTextTokens(tokens: readonly number[], marker: number): number[] {
    const index = tokens.indexOf(marker);
    return tokens.slice(index < 0 ? 0 : index + 1);
}
