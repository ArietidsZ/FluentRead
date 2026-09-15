/**
 * @file src/core/language/identify.ts
 *
 * 文件职责：对一段待翻译文本给出与目标语言无关的语言识别结论，是全文、悬浮、标题、划词和共享翻译客户端同目标跳过判断的唯一证据来源。
 * 主要内容：规范空白后生成技术标识符遮蔽副本并按文字切词；以非名称字母量确定主文字，把其他文字正文判为混合，把缩写、内部大写名称、格式名和带版本名称限制为不能主导结论的少量权重；中日韩分别使用假名/谚文/汉字规则并以中文专用字形排除中日、中韩误判；单一语言文字直接给出结论；Latin、Cyrillic、Arabic、Devanagari 交给统计评估，并逐句检查是否夹带可信的其他语言句子；结果以文本为键做有界缓存，目标语言与排除列表不进入缓存。可核对的公开符号包括 identifyTextLanguage、LanguageIdentification、LanguageIdentificationStatus、clearLanguageIdentificationCache、normalizeLanguageEvidenceText。
 * 模块边界：本文件属于 core 纯算法，不比较目标语言、不读取配置或页面 lang、不修改原文与 DOM；配置语言匹配和各功能入口语义由 detect.ts 负责。
 */

import {classifyChineseHan, hasSimplifiedChineseEvidence, hasTraditionalChineseEvidence} from './chinese';
import {SCRIPT_UNIQUE_LANGUAGES, hasScriptUniqueVeto, segmentScriptWords, type ScriptWord, type WritingScript} from './scripts';
import {assessStatisticalLanguage} from './statistical';
import {classifyEmbeddedLatinWord, createLanguageDetectionCopy, isAcronymWord, isMixedCaseName} from './technicalTokens';
import type {StatisticalScript} from './lexicon';

export type LanguageIdentificationStatus = 'empty' | 'identified' | 'unknown' | 'mixed';

export interface LanguageIdentification {
    status: LanguageIdentificationStatus;
    /** 可信归属的规范语言代码；简繁字形相同的中文同时属于 zh-Hans 与 zh-Hant。 */
    languages: readonly string[];
    /** 不可信时的最佳猜测，仅供选择朗读音色或模型语言等非跳过用途。 */
    bestGuess?: string;
    method?: 'script' | 'chinese' | 'japanese' | 'korean' | 'statistical' | 'lexical-only';
}

const STATISTICAL_SCRIPTS = new Set<WritingScript>(['Latin', 'Cyrillic', 'Arabic', 'Devanagari']);
const CJK_SCRIPTS = new Set<WritingScript>(['Han', 'Kana', 'Hangul']);
const IDENTIFICATION_CACHE_LIMIT = 512;
const CACHEABLE_TEXT_LENGTH = 4096;
const MIXED_SENTENCE_MIN_WORDS = 3;
const MIXED_SENTENCE_MIN_LETTERS = 12;
/** 现代韩文汉字通常是 1–6 字名词，连续 8 个及以上汉字按中文句子处理。 */
const KOREAN_MAX_HANJA_RUN = 8;
// 句末标点覆盖 Latin/CJK、阿拉伯文（؟ ؛ ۔）、印度诸文字（। ॥）、希腊文问号及亚美尼亚、缅甸、高棉、吉兹文句号。
const SENTENCE_BOUNDARY_PATTERN = /(?<=[.!?。！？;；:：\u061F\u061B\u06D4\u0964\u0965\u037E\u0589\u104B\u17D4\u1362])\s*(?=\S)|\n+/u;
const identificationCache = new Map<string, LanguageIdentification>();

const EMPTY: LanguageIdentification = Object.freeze({status: 'empty', languages: Object.freeze([])});
const UNKNOWN: LanguageIdentification = Object.freeze({status: 'unknown', languages: Object.freeze([])});
const MIXED: LanguageIdentification = Object.freeze({status: 'mixed', languages: Object.freeze([])});

/** 识别只关心词和句子边界：合并行内空白，保留换行作为句子边界。 */
export function normalizeLanguageEvidenceText(value: string): string {
    return value.replace(/[^\S\n]+/gu, ' ').replace(/ ?\n[\s]*/gu, '\n').trim();
}

export function clearLanguageIdentificationCache(): void {
    identificationCache.clear();
}

function identified(languages: readonly string[], method: NonNullable<LanguageIdentification['method']>): LanguageIdentification {
    return Object.freeze({status: 'identified', languages: Object.freeze([...languages]), bestGuess: languages[0], method});
}

function unknown(bestGuess?: string): LanguageIdentification {
    return bestGuess ? Object.freeze({status: 'unknown', languages: Object.freeze([]), bestGuess}) : UNKNOWN;
}

interface EmbeddedEvidence {
    foreignProse: boolean;
    nameWeight: number;
}

/**
 * 统计主文字以外的词：其他文字的多字母词都是外语正文；Latin 词按名称/格式/单字母/正文分类；
 * 希腊字母单字常作数学或物理符号，不视为外语。
 */
function assessEmbeddedWords(words: readonly ScriptWord[], isMain: (word: ScriptWord) => boolean, versionedNames: number): EmbeddedEvidence {
    let foreignProse = false;
    let nameWeight = versionedNames * 2;
    for (const word of words) {
        if (isMain(word)) continue;
        if (word.script === 'Latin') {
            const {role, weight} = classifyEmbeddedLatinWord(word.text);
            if (role === 'prose') foreignProse = true;
            nameWeight += weight;
            continue;
        }
        if (word.script === 'Greek' && word.letters === 1) continue;
        foreignProse = true;
    }
    return {foreignProse, nameWeight};
}

function statisticalWords(words: readonly ScriptWord[], script: StatisticalScript): string[] {
    return words
        .filter(word => word.script === script)
        .map(word => word.text)
        .filter(word => script !== 'Latin' || (!isAcronymWord(word) && !isMixedCaseName(word)));
}

/**
 * 已可信识别整段后逐句检查。这里只需要“存在其他语言证据”，比跳过判断更敏感：
 * 句子被可信识别为其他语言，或其他语言的功能词严格领先，都视为夹带外语句子并保留翻译。
 */
function containsForeignSentence(copy: string, script: StatisticalScript, language: string): boolean {
    const sentences = copy.split(SENTENCE_BOUNDARY_PATTERN);
    if (sentences.length < 2) return false;
    return sentences.some((sentence) => {
        const words = statisticalWords(segmentScriptWords(sentence), script);
        const letters = words.reduce((total, word) => total + [...word].filter(character => /\p{L}/u.test(character)).length, 0);
        if (words.length < MIXED_SENTENCE_MIN_WORDS || letters < MIXED_SENTENCE_MIN_LETTERS) return false;
        const assessment = assessStatisticalLanguage(script, words);
        const foreign = assessment.language ?? assessment.functionWordLeader;
        return foreign !== undefined && foreign !== language;
    });
}

function identifyCjk(copy: string, words: readonly ScriptWord[], versionedNames: number): LanguageIdentification {
    const counts = {Han: 0, Kana: 0, Hangul: 0};
    for (const word of words) {
        if (word.script === 'Han' || word.script === 'Kana' || word.script === 'Hangul') counts[word.script] += word.letters;
    }
    const native = counts.Han + counts.Kana + counts.Hangul;
    const embedded = assessEmbeddedWords(words, word => CJK_SCRIPTS.has(word.script), versionedNames);
    if (embedded.foreignProse || (counts.Kana > 0 && counts.Hangul > 0)) return MIXED;
    // 名称只能点缀正文：按词计权后超过母语字符一半时，无法证明整段属于目标语言。
    if (embedded.nameWeight * 2 > native) return UNKNOWN;
    const han = words.filter(word => word.script === 'Han').map(word => word.text).join('');

    if (counts.Kana > 0) {
        return hasSimplifiedChineseEvidence(han) || hasTraditionalChineseEvidence(han)
            ? MIXED
            : identified(['ja'], 'japanese');
    }
    if (counts.Hangul > 0) {
        // 韩文汉字使用传统字形且多为短名词；简体字、汉字多于谚文或出现中文句子式的长汉字串时不能证明是韩文。
        const longestHanRun = Math.max(0, ...words.filter(word => word.script === 'Han').map(word => word.letters));
        return hasSimplifiedChineseEvidence(han) || counts.Han > counts.Hangul || longestHanRun >= KOREAN_MAX_HANJA_RUN
            ? MIXED
            : identified(['ko'], 'korean');
    }
    const script = classifyChineseHan(copy);
    if (script === 'shared') return identified(['zh-Hans', 'zh-Hant'], 'chinese');
    return script ? identified([`zh-${script}`], 'chinese') : unknown('zh');
}

function identifyUncached(value: string): LanguageIdentification {
    if (!/\p{L}/u.test(value)) return EMPTY;
    const detectionCopy = createLanguageDetectionCopy(value);
    const words = segmentScriptWords(detectionCopy.text);
    if (words.length === 0) return UNKNOWN;

    // 主文字按“非名称字母”决定：PDF、OpenAI 这类名称不能把中文句子变成 Latin 文本。
    const weights = new Map<string, number>();
    for (const word of words) {
        const group = CJK_SCRIPTS.has(word.script) ? 'CJK' : word.script;
        const contributes = word.script !== 'Latin' || classifyEmbeddedLatinWord(word.text).role === 'prose';
        if (contributes) weights.set(group, (weights.get(group) ?? 0) + word.letters);
    }
    const ranked = [...weights].sort((left, right) => right[1] - left[1]);
    if (ranked.length === 0 || (ranked[1] && ranked[1][1] === ranked[0]![1])) return UNKNOWN;
    const main = ranked[0]![0];

    if (main === 'CJK') return identifyCjk(detectionCopy.text, words, detectionCopy.versionedNames);

    const script = main as WritingScript;
    const embedded = assessEmbeddedWords(words, word => word.script === script, script === 'Latin' ? 0 : detectionCopy.versionedNames);
    if (embedded.foreignProse) return MIXED;
    const nativeLetters = weights.get(script)!;
    if (script !== 'Latin' && embedded.nameWeight * 2 > nativeLetters) return UNKNOWN;

    const scriptLanguage = SCRIPT_UNIQUE_LANGUAGES[script];
    if (scriptLanguage) {
        if (nativeLetters < 2 || hasScriptUniqueVeto(script, detectionCopy.text)) return UNKNOWN;
        return identified([scriptLanguage], 'script');
    }
    if (!STATISTICAL_SCRIPTS.has(script)) return UNKNOWN;

    const statisticalScript = script as StatisticalScript;
    const assessment = assessStatisticalLanguage(statisticalScript, statisticalWords(words, statisticalScript));
    if (!assessment.language) return unknown(assessment.bestGuess);
    if (containsForeignSentence(detectionCopy.text, statisticalScript, assessment.language)) return MIXED;
    return identified([assessment.language], assessment.reason === 'lexical-only' ? 'lexical-only' : 'statistical');
}

/** 识别文本语言；只以文本为缓存键，目标语言、排除语言或源语言变化都会重新比较而不会复用旧结论。 */
export function identifyTextLanguage(text: string): LanguageIdentification {
    const value = normalizeLanguageEvidenceText(text);
    if (value.length > CACHEABLE_TEXT_LENGTH) return identifyUncached(value);
    const cached = identificationCache.get(value);
    if (cached) {
        identificationCache.delete(value);
        identificationCache.set(value, cached);
        return cached;
    }
    const result = identifyUncached(value);
    identificationCache.set(value, result);
    if (identificationCache.size > IDENTIFICATION_CACHE_LIMIT) {
        identificationCache.delete(identificationCache.keys().next().value!);
    }
    return result;
}
