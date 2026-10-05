/**
 * @file src/features/local-translation/offscreen/artifactStore.ts
 * 文件职责：把本地翻译模型目录接入通用的固定版本模型文件仓库。
 * 主要内容：展开翻译模型清单并将 Transformers.js 请求限定到已校验的离线文件；固定英日 tokenizer 仅修正运行时副本，已有下载 API 和缓存身份保持兼容。
 * 模块边界：具体分块下载、校验和清理由 platform/storage 处理；本文件不初始化模型或访问页面。
 */
import frozenArtifacts from '@/src/core/config/localTranslationArtifacts.json';
import {correctOpusUnknownId, OPUS_UNKNOWN_ID_CORRECTION} from '@/src/core/translation/opusTokenizer';
import {getLocalTranslationModel} from '@/src/core/config/localTranslation';
import {artifactUrl, artifactComplete, modelArtifactBlob as translationArtifactBlob, type ModelArtifact as TranslationArtifact} from '@/src/platform/storage/modelArtifacts';
export {artifactUrl, artifactComplete, artifactDownloadedBytes, LOCAL_MODEL_CACHE, MODEL_CHUNK_SIZE,
    downloadModelArtifact as downloadTranslationArtifact, modelArtifactBlob as translationArtifactBlob,
    removeModelArtifact as removeTranslationArtifact} from '@/src/platform/storage/modelArtifacts';
export type {ModelArtifact as TranslationArtifact} from '@/src/platform/storage/modelArtifacts';
const metadata = frozenArtifacts as Record<string, {revision: string; files: Omit<TranslationArtifact, 'repo' | 'revision'>[]}>;

export function getTranslationArtifacts(model: unknown): TranslationArtifact[] {
    const item = getLocalTranslationModel(model);
    return item.repositories.flatMap((repo) => {
        const entry = metadata[repo];
        return entry ? entry.files
            .filter((file) => item.engine !== 'opus' || !file.path.endsWith('.onnx')
                || (item.onnxDtype === 'fp32'
                    ? ['onnx/encoder_model.onnx', 'onnx/decoder_model_merged.onnx'].includes(file.path)
                    : file.path.endsWith(item.onnxDtype === 'fp16' ? '_fp16.onnx' : '_quantized.onnx')))
            .map((file) => ({...file, repo, revision: entry.revision})) : [];
    });
}

/** Transformers.js can only read our verified files; it cannot download on inference. */
export async function matchTranslationArtifact(request: string | Request): Promise<Response | undefined> {
    const key = typeof request === 'string' ? request : request.url;
    for (const [repo, entry] of Object.entries(metadata)) {
        const file = entry.files.find((file) => key === artifactUrl({...file, repo, revision: entry.revision}));
        if (file) {
            const artifact = {...file, repo, revision: entry.revision};
            if (!await artifactComplete(artifact)) return undefined;
            let body = await translationArtifactBlob(artifact);
            if (repo === OPUS_UNKNOWN_ID_CORRECTION.repo && file.path === OPUS_UNKNOWN_ID_CORRECTION.path) {
                // 原始固定哈希文件保持不变；只向 tokenizer 提供已核实的运行时修正副本。
                body = new Blob([correctOpusUnknownId(artifact, await body.text())], {type: 'application/json'});
            }
            return new Response(body, {headers: {'Content-Length': String(body.size)}});
        }
    }
    return undefined;
}
