/**
 * @file src/features/reading-assistant/sentenceAnalysis.ts
 * 文件职责：将模型的词性表格严格对应到用户选中的原文，生成可交互的句法片段。
 * 主要内容：校验固定列、片段边界、顺序、长度和数量，区分词性与句中作用；保留未标注原文，歧义或不匹配时回退普通回答。
 * 模块边界：不推断语法、不执行模型文本、不生成 HTML；渲染与选择状态由 SentenceAnalysis.vue 管理。
 */
import {describePartOfSpeech} from '@/src/core/language/partOfSpeech';
import type {ReadingAnswerBlock} from './answerFormat';

export interface SentenceAnnotation {
    text: string;
    start: number;
    end: number;
    part: ReturnType<typeof describePartOfSpeech>;
    role: string;
    meaning: string;
}

const plain = (value: string) => value.trim().replace(/^(?:\*\*|`)|(?:\*\*|`)$/gu, '');
const word = (value: string) => /[\p{L}\p{N}_]/u.test(value);

export function anchorSentenceAnalysis(block: ReadingAnswerBlock, source: string): SentenceAnnotation[] | null {
    if (block.kind !== 'table' || !source || source.length > 4096 || block.rows.length === 0 || block.rows.length > 80) return null;
    const columns = block.headers.map(cell => plain(cell).toLowerCase());
    const expected = [['text', '原文片段'], ['pos', '词性'], ['role', '句中作用'], ['meaning', '含义']];
    if (columns.length !== 4 || columns.some((cell, index) => !expected[index].includes(cell))) return null;
    const result: SentenceAnnotation[] = [];
    let cursor = 0;
    for (const row of block.rows) {
        if (row.length !== 4) return null;
        const [text, pos, role, meaning] = row.map(plain);
        if (!text || !pos || !role || !meaning || text.length > 300 || role.length > 400 || meaning.length > 400) return null;
        // 原文顺序锚定，重复词依次消耗；不把 he 对应到 the 内部。
        const start = source.indexOf(text, cursor);
        const end = start + text.length;
        if (start < 0 || (word(text[0]) && start > 0 && word(source[start - 1]))
            || (word(text[text.length - 1]) && end < source.length && word(source[end]))) return null;
        result.push({text, start, end, part: describePartOfSpeech(pos), role, meaning});
        cursor = end;
    }
    return result;
}
