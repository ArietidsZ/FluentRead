/**
 * @file src/core/glossary/match.ts
 * 文件职责：在翻译请求的文字、语言及网站范围中解析真正命中的术语，并报告可解释的固定译名冲突。
 * 主要内容：共享可解释的语言和网站范围判定、原词重复判断，使用字面检索、词边界、大小写选项与长词优先；库与条目顺序决定冲突胜者。
 * 模块边界：属于纯匹配算法，不读取配置、不构建提示词、不进行翻译后的字符串替换；输出实际命中的条目与不重叠范围，供本地预览和请求保护共用。
 */
import {cleanGlossaryText, normalizeGlossaryDomain, normalizeGlossaryIds, normalizeGlossaryLanguage,
    normalizeGlossaryLibraries, type GlossaryLibrary} from './model';

export interface GlossaryTerm { source: string; target: string }
export interface GlossaryConflict {
    source: string;
    keptTarget: string;
    ignoredTarget: string;
    libraryId: string;
    entryId: string;
}
export interface GlossaryContext {
    text: string | string[];
    sourceLanguage: string;
    targetLanguage: string;
    pageUrl?: string;
    glossaryIds?: string[] | null;
}

/** 与实际请求共用范围判定，界面可解释未参与匹配的原因，不另写一套近似规则。 */
export function getGlossaryScopeReason(library: GlossaryLibrary, context: GlossaryContext):
    'disabled' | 'selection' | 'source' | 'target' | 'website' | 'empty' | 'eligible' {
    const selected = normalizeGlossaryIds(context.glossaryIds);
    const source = normalizeGlossaryLanguage(context.sourceLanguage);
    const target = normalizeGlossaryLanguage(context.targetLanguage);
    if (!library.enabled) return 'disabled';
    if (selected && !selected.includes(library.id)) return 'selection';
    if (source && !languageMatches(normalizeGlossaryLanguage(library.sourceLanguage), source)) return 'source';
    if (!languageMatches(normalizeGlossaryLanguage(library.targetLanguage), target)) return 'target';
    if (!domainMatches(library.domains, context.pageUrl)) return 'website';
    return library.entries.length ? 'eligible' : 'empty';
}

/** 大小写敏感且拼写不同的词可以并存；其余同源词沿用请求中的优先级规则。 */
export function glossarySourcesOverlap(a: {source: string; caseSensitive: boolean}, b: {source: string; caseSensitive: boolean}): boolean {
    const left = cleanGlossaryText(a.source);
    const right = cleanGlossaryText(b.source);
    return left === right || ((!a.caseSensitive || !b.caseSensitive) && left.toLowerCase() === right.toLowerCase());
}

function languageMatches(rule: string, actual: string): boolean {
    return !rule || rule === actual || actual.startsWith(`${rule}-`);
}

function domainMatches(domains: string[], pageUrl: string | undefined): boolean {
    if (!domains.length) return true;
    if (!pageUrl) return false;
    try {
        const url = new URL(pageUrl);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
        const host = url.hostname.toLowerCase().replace(/\.$/u, '');
        return domains.some((domain) => {
            const rule = normalizeGlossaryDomain(domain);
            if (!rule) return false;
            if (rule.startsWith('*.')) return host.endsWith(`.${rule.slice(2)}`);
            return host === rule || host.endsWith(`.${rule}`);
        });
    } catch {
        return false;
    }
}

function isWordCharacter(character: string): boolean {
    return /^[\p{L}\p{N}\p{M}_]$/u.test(character)
        && !/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(character);
}

/** 返回原文 UTF-16 范围，大小写匹配不会因 Unicode 小写展开改变偏移。 */
export function findGlossaryRanges(text: string, source: string, caseSensitive: boolean): {start: number; end: number}[] {
    if (!source) return [];
    const needle = source.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const pattern = new RegExp(needle, caseSensitive ? 'gu' : 'giu');
    const ranges: {start: number; end: number}[] = [];
    for (const match of text.matchAll(pattern)) {
        const start = match.index!;
        const end = start + match[0].length;
        const first = Array.from(match[0])[0];
        const last = Array.from(match[0]).at(-1)!;
        const before = Array.from(text.slice(Math.max(0, start - 2), start)).at(-1) ?? '';
        const after = Array.from(text.slice(end, end + 2))[0] ?? '';
        if ((!isWordCharacter(first) || !isWordCharacter(before))
            && (!isWordCharacter(last) || !isWordCharacter(after))) ranges.push({start, end});
    }
    return ranges;
}

/** 先占用长短语，预览和实际保护共用完全相同的不重叠范围。 */
export function findGlossaryMatches<T extends {source: string; target: string; caseSensitive: boolean}>(text: string, entries: readonly T[]) {
    const used = new Uint8Array(text.length);
    const matches: {start: number; end: number; entry: T}[] = [];
    for (const entry of [...entries].sort((a, b) => b.source.length - a.source.length)) {
        for (const range of findGlossaryRanges(text, entry.source, entry.caseSensitive)) {
            if (used.subarray(range.start, range.end).includes(1)) continue;
            used.fill(1, range.start, range.end);
            matches.push({...range, entry});
        }
    }
    return matches.sort((a, b) => a.start - b.start);
}

export function resolveGlossaryEntries(libraries: readonly GlossaryLibrary[], context: GlossaryContext): {
    terms: {source: string; target: string; caseSensitive: boolean}[]; conflicts: GlossaryConflict[];
} {
    const texts = (Array.isArray(context.text) ? context.text : [context.text]).map(cleanGlossaryText);
    const chosen: {term: GlossaryTerm; caseSensitive: boolean}[] = [];
    const conflicts: GlossaryConflict[] = [];
    for (const library of normalizeGlossaryLibraries(libraries)) {
        if (getGlossaryScopeReason(library, context) !== 'eligible') continue;
        for (const entry of library.entries) {
            if (!texts.some((text) => findGlossaryRanges(text, entry.source, entry.caseSensitive).length > 0)) continue;
            const term = {source: entry.source, target: entry.target};
            const previous = chosen.find((item) => glossarySourcesOverlap({...item.term, caseSensitive: item.caseSensitive}, entry));
            if (previous) {
                if (previous.term.target !== term.target) conflicts.push({source: entry.source,
                    keptTarget: previous.term.target || previous.term.source, ignoredTarget: term.target || term.source, libraryId: library.id, entryId: entry.id});
            } else chosen.push({term, caseSensitive: entry.caseSensitive});
        }
    }
    const candidates = chosen.map(item => ({...item.term, caseSensitive: item.caseSensitive}));
    const used = new Set(texts.flatMap(text => findGlossaryMatches(text, candidates).map(match => match.entry)));
    return {terms: candidates.filter(term => used.has(term)).sort((a, b) => b.source.length - a.source.length), conflicts};
}

export function resolveGlossary(libraries: readonly GlossaryLibrary[], context: GlossaryContext): {
    terms: GlossaryTerm[]; conflicts: GlossaryConflict[];
} {
    const result = resolveGlossaryEntries(libraries, context);
    return {terms: result.terms.map(({source, target}) => ({source, target: target || source})), conflicts: result.conflicts};
}
