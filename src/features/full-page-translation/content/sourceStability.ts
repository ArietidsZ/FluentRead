/**
 * @file src/features/full-page-translation/content/sourceStability.ts
 * 文件职责：让不断变化的页面来源在稳定后才重新翻译，识别持续变化的短计数展示。
 * 主要内容：以弱引用身份保存最近来源和变更时间；变更后等待安静窗口，连续仅数字变化的短标签保持原文，语义变化后解除该限制。
 * 模块边界：不读取 DOM 或系统时钟，不持有定时器或 provider；runtime 提供候选身份、来源和时间，并负责取消请求及会话清理。
 */

export const TRANSLATION_SOURCE_QUIET_MS = 1800;
const NUMERIC_CHANGE_WINDOW_MS = 4000;

interface SourceHistory {
    source: string;
    changedAt: number;
    lastChangeAt: number;
    numericSignature: string | null;
    numericChanges: number;
    numeric: boolean;
}

export type TranslationSourceHistory = WeakMap<Node, SourceHistory>;
export type SourceStabilityDecision = {kind: 'ready'} | {kind: 'numeric'} | {kind: 'settling'; delay: number};

export function createTranslationSourceHistory(): TranslationSourceHistory {
    return new WeakMap();
}

function numericSignature(source: string): string | null {
    if (source.length > 120 || !/\p{Nd}/u.test(source)) return null;
    const signature = source.replace(/[+-]?\p{Nd}+(?:[.,]\p{Nd}+)*/gu, '#');
    // 长句或完整句子的数值更新仍有阅读价值；仅将短计数标签识别为动态数值。
    if (/[.!?。！？]/u.test(signature) || signature.split(/\s+/u).length > 4 ||
        (signature.match(/\p{L}/gu)?.length ?? 0) > 32) return null;
    return signature;
}

export function observeTranslationSource(
    history: TranslationSourceHistory, identity: Node, value: string, now: number,
): SourceStabilityDecision {
    const source = value.replace(/[\s\u3000]+/gu, ' ').trim();
    const previous = history.get(identity);
    const signature = numericSignature(source);
    if (!previous) {
        history.set(identity, {source, changedAt: -Infinity, lastChangeAt: now,
            numericSignature: signature, numericChanges: 0, numeric: false});
        return {kind: 'ready'};
    }
    if (previous.source !== source) {
        const sameNumericLabel = signature !== null && signature === previous.numericSignature;
        const numericChanges = sameNumericLabel && now - previous.lastChangeAt <= NUMERIC_CHANGE_WINDOW_MS
            ? previous.numericChanges + 1 : 0;
        previous.numeric = sameNumericLabel && (previous.numeric || numericChanges >= 2);
        previous.numericChanges = numericChanges;
        previous.numericSignature = signature;
        previous.source = source;
        previous.changedAt = now;
        previous.lastChangeAt = now;
    }
    if (previous.numeric) return {kind: 'numeric'};
    const delay = TRANSLATION_SOURCE_QUIET_MS - (now - previous.changedAt);
    return delay > 0 ? {kind: 'settling', delay} : {kind: 'ready'};
}
