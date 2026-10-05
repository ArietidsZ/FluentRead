/**
 * @file src/features/video-subtitle/offscreen/qwen/model.ts
 * 文件职责：定义固定版本 Qwen3-ASR 0.6B 浏览器模型、量化变体和权重完整性清单。
 * 主要内容：按 shader-f16 选择 q4f16 或 FP32 激活的 q4，均使用 WebGPU；只下载当前变体及共享分词和嵌入数据。
 * 模块边界：只描述数据与形状契约，不分配 GPU、不下载模型，不承诺词级时间戳。
 */
import manifest from './artifacts.json';
import prompt from './prompt.json';
import type { ModelArtifact } from '@/src/platform/storage/modelArtifacts';
export const QWEN_ASR_MODEL = 'qwen3-asr-0.6b' as const;
export type QwenVariant = 'q4' | 'q4f16';
export const QWEN_PROMPT = prompt;
export function qwenArtifacts(variant: QwenVariant): ModelArtifact[] {
    const selection = prompt.variants[variant];
    const paths = new Set([...Object.values(selection).filter((value): value is string => typeof value === 'string'),
        prompt.embedding.file, prompt.embedding.scales_file, prompt.mel.filters_file,
        'prompt_config.json', 'tokenizer.json', 'tokenizer_config.json']);
    return manifest.files.filter(file => paths.has(file.path)).map(file => ({ ...file, repo: manifest.repo, revision: manifest.revision }));
}
export function qwenArtifact(path: string): ModelArtifact {
    const file = manifest.files.find(file => file.path === path);
    if (!file)
        throw new Error('Qwen ASR 模型文件不在固定清单中');
    return { ...file, repo: manifest.repo, revision: manifest.revision };
}
export function selectQwenVariant(features: readonly string[]): QwenVariant {
    return features.includes('shader-f16') ? 'q4f16' : 'q4';
}
