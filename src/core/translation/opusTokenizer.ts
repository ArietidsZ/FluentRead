/**
 * @file src/core/translation/opusTokenizer.ts
 * 文件职责：修复一个已核实固定版本的英日 OPUS tokenizer 未知词 ID 导出错误。
 * 主要内容：仅匹配精确仓库、commit、文件路径及原始 SHA256，将指向逗号的 unk_id=2 改为词表中 <unk> 的 ID1。
 * 模块边界：只转换已校验 JSON 的运行时副本；不改下载缓存、其他版本、词表或分词规则，也不承诺修复该模型的语义质量。
 */
export const OPUS_UNKNOWN_ID_CORRECTION = {
    repo: 'Xenova/opus-mt-en-jap',
    revision: '9d418190be3aa945eae5bab1bd96bc5e349ad784',
    path: 'tokenizer.json',
    sha256: '240dd3befcfb8727158fb23fbc8a94a41e5b827ad486601ea0805c17fb9f6fd9',
} as const;

type ArtifactIdentity = {repo: string; revision: string; path: string; sha256: string};

export function correctOpusUnknownId(artifact: ArtifactIdentity, original: string): string {
    if (artifact.repo !== OPUS_UNKNOWN_ID_CORRECTION.repo
        || artifact.revision !== OPUS_UNKNOWN_ID_CORRECTION.revision
        || artifact.path !== OPUS_UNKNOWN_ID_CORRECTION.path
        || artifact.sha256 !== OPUS_UNKNOWN_ID_CORRECTION.sha256) return original;
    const tokenizer = JSON.parse(original);
    if (tokenizer?.model?.type !== 'Unigram' || tokenizer.model.unk_id !== 2
        || tokenizer.model.vocab?.[1]?.[0] !== '<unk>' || tokenizer.model.vocab?.[2]?.[0] !== ',') {
        throw new Error('LOCAL_TRANSLATION_INTEGRITY');
    }
    tokenizer.model.unk_id = 1;
    return JSON.stringify(tokenizer);
}
