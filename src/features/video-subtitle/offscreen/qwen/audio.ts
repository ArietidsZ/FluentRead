/**
 * @file src/features/video-subtitle/offscreen/qwen/audio.ts
 * 文件职责：使用已锁定的原生音频特征提取器构造 Qwen ASR 的 128 维 log-Mel 输入。
 * 主要内容：16 kHz、400 点周期 Hann、160 步长、反射填充与固定 Slaney 滤波器；按真实长度提取，不补成 Whisper 的 30 秒窗口。
 * 模块边界：只处理有界 PCM 和模型自带的滤波器，不采集音频、不运行识别模型。
 */
import { WhisperFeatureExtractor } from '@huggingface/transformers';
export interface QwenMelFilters {
    n_mels: number;
    n_freqs: number;
    data: number[][];
}
export function createQwenAudioFrontend(filters: QwenMelFilters) {
    if (filters.n_mels !== 128 || filters.n_freqs !== 201 || filters.data.length !== 128
        || filters.data.some(row => row.length !== 201 || row.some(value => !Number.isFinite(value)))) {
        throw new Error('Qwen ASR Mel 滤波器无效');
    }
    const extractor = new WhisperFeatureExtractor({ n_fft: 400, hop_length: 160, feature_size: 128,
        sampling_rate: 16000, n_samples: 480000, nb_max_frames: 3000, mel_filters: filters.data });
    return async (audio: Float32Array): Promise<{
        data: Float32Array;
        frames: number;
    }> => {
        if (audio.length < 400 || audio.length > 480000 || !audio.every(Number.isFinite))
            throw new Error('Qwen ASR 音频必须为 0.025–30 秒的有效 16 kHz 单声道 PCM');
        const { input_features } = await extractor._call(audio, { max_length: audio.length });
        return { data: input_features.data as Float32Array, frames: Math.floor(audio.length / 160) };
    };
}
