/**
 * @file src/core/translation/sentenceAlignment.ts
 * 文件职责：为双语阅读生成保留字符坐标的句子边界及有序对应组。
 * 主要内容：使用原生分句与兼容回退处理标点、缩写和空白；句数不同时按累计长度选择受约束的相邻句边界。
 * 模块边界：只处理字符串，不读取网页或配置，不调用翻译服务；长度对齐是局部启发式，不代表语义校验。
 */
import {splitTranslationSentences} from './lineBreak';

export interface SentenceSpan {start: number; end: number}
export interface SentencePair {source: SentenceSpan; translation: SentenceSpan}

export function sentenceSpans(text: string): SentenceSpan[] {
    const chunks = typeof Intl.Segmenter === 'function'
        ? Array.from(new Intl.Segmenter(undefined, {granularity: 'sentence'}).segment(text), part => part.segment)
        : splitTranslationSentences(text);
    const spans: SentenceSpan[] = [];
    let offset = 0;
    for (const chunk of chunks) {
        const start = offset + chunk.length - chunk.trimStart().length;
        offset += chunk.length;
        const end = offset - (chunk.length - chunk.trimEnd().length);
        if (start >= end) continue;
        const previous = spans.at(-1);
        // 原生 ICU 分句会把 Dr. Smith 等称谓拆开；沿用译文换行的常见缩写保护。
        if (previous && /\b(?:Mr|Mrs|Ms|Dr|Prof|St|vs|etc|No|Fig|e\.g|i\.e)\.$/iu.test(text.slice(previous.start, previous.end))) {
            previous.end = end;
        } else spans.push({start, end});
    }
    return spans;
}

export function alignBilingualSentences(sourceText: string, translationText: string): SentencePair[] {
    const source = sentenceSpans(sourceText);
    const translation = sentenceSpans(translationText);
    if (!source.length || !translation.length || Math.max(source.length, translation.length) > 256) return [];
    if (source.length === translation.length) return source.map((span, i) => ({source: span, translation: translation[i]}));
    const sourceIsShorter = source.length < translation.length;
    const anchors = sourceIsShorter ? source : translation;
    const longer = sourceIsShorter ? translation : source;
    const anchorTotal = anchors.at(-1)!.end;
    const longerTotal = longer.at(-1)!.end;
    const pairs: SentencePair[] = [];
    let start = 0;
    for (let i = 0; i < anchors.length; i++) {
        // 每组至少保留一句，末组接住全部尾句；不会丢句、交叉或产生空对应侧。
        const last = longer.length - (anchors.length - i);
        let end = last;
        if (i < anchors.length - 1) {
            end = start;
            const target = anchors[i].end / anchorTotal;
            while (end < last && Math.abs(longer[end + 1].end / longerTotal - target)
                < Math.abs(longer[end].end / longerTotal - target)) end++;
        }
        const group = {start: longer[start].start, end: longer[end].end};
        pairs.push(sourceIsShorter ? {source: anchors[i], translation: group} : {source: group, translation: anchors[i]});
        start = end + 1;
    }
    return pairs;
}
