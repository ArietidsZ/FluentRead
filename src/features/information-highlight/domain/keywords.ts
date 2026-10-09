/**
 * @file src/features/information-highlight/domain/keywords.ts
 * 文件职责：以可解释的本地词项规则生成信息高亮候选，不依赖语言模型、词典下载或网络服务。
 * 主要内容：保留 UTF-16 原文坐标，以标准词分段及有界后备分词排除停用词，结合段内重复、词长和数字辨识度排序；密度选择只决定绘制覆盖，不把规则分数解释为理解收益或事实可信度。
 * 模块边界：纯文本算法，不读取 DOM、不写配置、不导入浏览器平台；调用方负责文本规模、页面所有权和原生 Range 绘制。
 */
import type {InformationHighlightDensity} from '@/src/core/config/informationHighlight';
import type {InformationHighlightResult, InformationHighlightSpan} from '../protocol';
import {informationGraphemeBoundaries} from './textBoundaries';

const stopWords = new Set(('a an and are as at be been but by can could did do does for from had has have he her here him his how i if in into is it its me more most my no nor not of on one or our out she so some than that the their them then there these they this those to too up us was we were what when where which who will with would you your ' +
    '的 地 得 了 着 过 是 在 和 与 及 或 而 但 为 于 对 从 到 把 被 让 给 有 无 不 也 都 就 很 更 最 一 个 这 那 这些 那些 我 我们 你 你们 他 她 它 他们 什么 怎么 因为 所以 可以 可能').split(/\s+/u));
interface Word {start: number; end: number; key: string}

function words(text: string): Word[] {
    const candidates: Word[] = [];
    const Segmenter = Intl.Segmenter;
    if (Segmenter) {
        const segmenter = new Segmenter(undefined, {granularity: 'word'});
        for (const part of segmenter.segment(text)) {
            if (part.isWordLike) candidates.push({start: part.index, end: part.index + part.segment.length, key: part.segment.toLocaleLowerCase()});
        }
    } else {
        // 后备只按原文匹配；连续汉字拆成双字单位，避免把整句误作一个词或更改原文。
        for (const match of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’_-][\p{L}\p{N}\p{M}]+)*/gu)) {
            const start = match.index!;
            if (/^[\p{Script=Han}]+$/u.test(match[0])) {
                let offset = 0;
                const characters = [...match[0]];
                for (let i = 0; i < characters.length; i += 2) {
                    const key = characters.slice(i, i + 2).join('');
                    candidates.push({start: start + offset, end: start + offset + key.length, key}); offset += key.length;
                }
            } else candidates.push({start, end: start + match[0].length, key: match[0].toLocaleLowerCase()});
        }
    }
    return candidates;
}

/** 轻量规则评分是候选排序，不是概率、模型意外度或语义重要性的标定值。 */
export function scoreInformationKeywords(text: string): InformationHighlightResult {
    const candidates = words(text).filter(word => !stopWords.has(word.key) && [...word.key].length >= 2);
    const counts = new Map<string, number>();
    for (const word of candidates) counts.set(word.key, (counts.get(word.key) ?? 0) + 1);
    return {engine: 'local-keyword-rules-v1', spans: candidates.map(word => ({start: word.start, end: word.end,
        score: Math.log2(2 + Math.min([...word.key].length, 12)) + Math.log2(1 + counts.get(word.key)!) * 0.35 + (/\p{N}/u.test(word.key) ? 0.4 : 0)}))};
}

/** 过滤不可信区间、按字符预算挑选高分候选，并合并相邻重叠坐标。 */
export function selectInformationSpans(text: string, spans: readonly InformationHighlightSpan[], density: InformationHighlightDensity): InformationHighlightSpan[] {
    const boundaries = informationGraphemeBoundaries(text);
    const validPieces = spans.filter(span => Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end)
        && span.start >= 0 && span.end <= text.length && span.end > span.start && Number.isFinite(span.score)
        && boundaries.has(span.start) && boundaries.has(span.end));
    // 模型 subword/byte pieces 在原文词段上聚合，密度绘制不会切开英文词或标准中文词项。
    validPieces.sort((a, b) => a.start - b.start);
    let cursor = 0;
    const valid: InformationHighlightSpan[] = [];
    for (const word of words(text)) {
        if (!boundaries.has(word.start) || !boundaries.has(word.end)) continue;
        while (cursor < validPieces.length && validPieces[cursor].end <= word.start) cursor++;
        let score = 0, matches = 0;
        for (let i = cursor; i < validPieces.length && validPieces[i].start < word.end; i++) {
            if (validPieces[i].end > word.start) {score += validPieces[i].score; matches++;}
        }
        if (matches) valid.push({start: word.start, end: word.end, score});
    }
    const budget = Math.max(1, Math.ceil(text.replace(/\s/gu, '').length * ({low: 0.12, medium: 0.22, high: 0.35}[density])));
    const selected: InformationHighlightSpan[] = [];
    let used = 0;
    for (const span of [...valid].sort((a, b) => b.score - a.score || a.start - b.start)) {
        if (selected.length >= 48 || (selected.length > 0 && used + span.end - span.start > budget)) continue;
        // 聚合后的词段已经构成互不重叠的原文分区。
        selected.push({...span}); used += span.end - span.start;
    }
    selected.sort((a, b) => a.start - b.start);
    const merged: InformationHighlightSpan[] = [];
    for (const span of selected) {
        const previous = merged.at(-1);
        if (previous && previous.end === span.start) {previous.end = span.end; previous.score = Math.max(previous.score, span.score);}
        else merged.push(span);
    }
    return merged;
}
