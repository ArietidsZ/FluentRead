/**
 * @file src/features/information-highlight/offscreen/scorer.ts
 * 文件职责：以可注入因果模型端口执行有界分块评分并明确管理每段的张量所有权。
 * 主要内容：BOS 起点、全词表意外度、跨块 KV 缓存、准确 UTF-16 映射、取消及所有成功/失败出口释放；不截断输入。
 * 模块边界：不下载、不创建 Worker、不访问 DOM；模型持久会话由 Worker 持有，每段缓存只属于一次请求。
 */
import {alignQwenByteTokens, floatLogits, scoreCausalChunk, scoredTokenSpans} from '@/src/core/information-highlight/scoring';
import {INFORMATION_HIGHLIGHT_CHUNK_TOKENS, INFORMATION_HIGHLIGHT_MAX_CHARACTERS, INFORMATION_HIGHLIGHT_MAX_TOKENS, type InformationHighlightResult} from '../protocol';
export interface ScoringTensor {dims: readonly number[]; type: string; data: ArrayLike<number>; dispose(): void}
export type ScoringPast = Record<string, ScoringTensor>;
export interface CausalScoringEngine {
    tokenize(text: string): {ids: number[]; pieces: string[]; addedTokens: ReadonlyMap<string, string>};
    bosId: number;
    forward(ids: number[], attentionLength: number, past: ScoringPast | null): Promise<Record<string, ScoringTensor>>;
    yield(): Promise<void>;
}
function active(signal: AbortSignal): void {if (signal.aborted) throw new DOMException('信息高亮已取消', 'AbortError');}
function dispose(values: Record<string, ScoringTensor>): void {new Set(Object.values(values)).forEach(tensor => tensor.dispose());}

export async function scoreLocalSurprisal(engine: CausalScoringEngine, text: string, signal: AbortSignal): Promise<InformationHighlightResult> {
    active(signal);
    if (!text || text.length > INFORMATION_HIGHLIGHT_MAX_CHARACTERS) throw new Error('INFORMATION_HIGHLIGHT_TEXT_LIMIT');
    const encoded = engine.tokenize(text);
    if (!encoded.ids.length || encoded.ids.length > INFORMATION_HIGHLIGHT_MAX_TOKENS) throw new Error('INFORMATION_HIGHLIGHT_TOKEN_LIMIT');
    if (!Number.isInteger(engine.bosId) || engine.bosId < 0) throw new Error('INFORMATION_HIGHLIGHT_BOS');
    const offsets = alignQwenByteTokens(text, encoded.pieces, encoded.addedTokens);
    // Qwen tokenizer 不自动插入 BOS；config 的 151643 endoftext 明确作为文档起点，空 span 不参与绘制。
    const ids = [engine.bosId, ...encoded.ids], scores: number[] = [];
    let past: ScoringPast | null = null;
    try {
        for (let start = 0; start < ids.length; start += INFORMATION_HIGHLIGHT_CHUNK_TOKENS) {
            active(signal);
            const end = Math.min(start + INFORMATION_HIGHLIGHT_CHUNK_TOKENS, ids.length);
            const outputs = await engine.forward(ids.slice(start, end), end, past);
            let next: ScoringPast | null = null;
            try {
                active(signal);
                const logits = outputs.logits;
                if (!logits || logits.dims.length !== 3 || logits.dims[0] !== 1 || logits.dims[1] !== end - start) throw new Error('INFORMATION_HIGHLIGHT_BAD_LOGITS');
                scores.push(...scoreCausalChunk(floatLogits(logits.type, logits.data), logits.dims[2], ids, start, end));
                next = Object.fromEntries(Object.entries(outputs).filter(([name]) => name.startsWith('present.')).map(([name, value]) => [name.replace('present.', 'past_key_values.'), value]));
                if (!Object.keys(next).length) throw new Error('INFORMATION_HIGHLIGHT_NO_CACHE');
                if (past) dispose(past);
                past = next;
            } finally {
                const retained = new Set(Object.values(next || {}));
                dispose(Object.fromEntries(Object.entries(outputs).filter(([, value]) => !retained.has(value))));
            }
            await engine.yield();
        }
        active(signal);
        return {spans: scoredTokenSpans(offsets, scores), engine: 'Qwen2.5 0.5B · local WebGPU · q4f16'};
    } finally {if (past) dispose(past);}
}
