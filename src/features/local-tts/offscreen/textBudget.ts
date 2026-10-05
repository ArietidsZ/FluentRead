/**
 * @file src/features/local-tts/offscreen/textBudget.ts
 * 文件职责：按真实音素分词结果约束 Kokoro 输入，避免中文长句被静默截断。
 * 主要内容：保留原生 tokenizer 行为但关闭截断，计入首尾特殊 token；用原生词边界拆分超长文本，保持数字、单词和字符顺序。
 * 模块边界：不运行模型、不下载、不改写原文；单个不可拆分词超限时明确失败。
 */
export const LOCAL_TTS_TOKEN_LIMIT = 512;
export class TtsTokenBudgetError extends Error {
    constructor(readonly tokens: number) {
        super('本地 TTS 文本片段超过模型上下文，请缩短连续数字或单词后重试');
        this.name = 'TtsTokenBudgetError';
    }
}

/** Proxy保留原生可调用 tokenizer 的属性和方法，只改变当前调用的截断选项。 */
export function protectTtsTokenizer<T extends Function>(tokenizer: T): T {
    return new Proxy(tokenizer, {
        apply(target, thisArg, argumentsList) {
            const [text, options] = argumentsList;
            const result = Reflect.apply(target, thisArg, [text, {...options, truncation: false}]);
            const count = result?.input_ids?.dims?.at(-1);
            if (!Number.isSafeInteger(count) || count < 0) throw new Error('本地 TTS 分词结果无效');
            if (count > LOCAL_TTS_TOKEN_LIMIT) throw new TtsTokenBudgetError(count);
            return result;
        },
    });
}

export function splitTtsAtWordBoundaries(text: string, maxLength = 180): string[] {
    const chunks: string[] = [];
    let current = '';
    // Intl词边界会把2026-10-04和2026年10月4日拆开；保留数值复合单元的内部边界。
    const numbers = Array.from(text.matchAll(/[第$€£¥+\-−]?\p{N}+(?:[.,:/\-]\p{N}+|[年月日时分秒元%]\p{N}*)*/gu),
        match => ({start: match.index, end: match.index + match[0].length}));
    let numberIndex = 0;
    let unit = '';
    for (const {segment, index} of new Intl.Segmenter(undefined, {granularity: 'word'}).segment(text)) {
        unit += segment;
        const boundary = index + segment.length;
        while (numbers[numberIndex] && numbers[numberIndex].end <= boundary) numberIndex += 1;
        const number = numbers[numberIndex];
        if (number && number.start < boundary && boundary < number.end) continue;
        if (current && current.length + unit.length > maxLength) {
            chunks.push(current);
            current = '';
        }
        current += unit;
        unit = '';
    }
    if (current) chunks.push(current);
    return chunks;
}

/** 使用已观察到的音素膨胀比例缩小候选文本，避免固定中文字符数假设。 */
export function subdivideTtsChunk(text: string, error: TtsTokenBudgetError): string[] {
    const target = Math.max(1, Math.min(text.length - 1, Math.floor(text.length * (LOCAL_TTS_TOKEN_LIMIT - 2) / error.tokens)));
    const chunks = splitTtsAtWordBoundaries(text, target);
    if (chunks.length < 2) throw error;
    return chunks;
}
