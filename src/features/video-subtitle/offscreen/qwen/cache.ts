/**
 * @file src/features/video-subtitle/offscreen/qwen/cache.ts
 * 文件职责：复用平台分块仓库准备 Qwen ASR 模型文件，并向 Worker 提供纯离线读取。
 * 主要内容：按量化变体顺序下载固定清单、校验后复用、逐文件清除；不另建下载存储或持有整包模型。
 * 模块边界：只处理已公布的模型数据，模型推理和设备选择归调用方。
 */
import { downloadModelArtifact, modelArtifactBlob, removeModelArtifact } from '@/src/platform/storage/modelArtifacts';
import { qwenArtifact, qwenArtifacts, type QwenVariant } from './model';
export async function cacheQwenAsrFiles(variant: QwenVariant, signal = new AbortController().signal): Promise<void> {
    for (const file of qwenArtifacts(variant))
        await downloadModelArtifact(file, signal, () => undefined);
}
export async function readQwenAsrFile(path: string): Promise<ArrayBuffer> {
    try { return await (await modelArtifactBlob(qwenArtifact(path))).arrayBuffer(); }
    catch (error) {
        if (error instanceof Error && /^LOCAL_TRANSLATION_(?:NOT_DOWNLOADED|INTEGRITY)$/.test(error.message)) {
            throw new Error('Qwen ASR 模型未准备好，请在设置中重新下载');
        }
        throw error;
    }
}
export async function removeQwenAsrFiles(): Promise<void> {
    const files = new Map([...qwenArtifacts('q4'), ...qwenArtifacts('q4f16')].map(file => [file.path, file]));
    for (const file of files.values())
        await removeModelArtifact(file);
}
