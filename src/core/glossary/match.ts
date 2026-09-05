/**
 * @file src/core/glossary/match.ts
 * 文件职责：在翻译请求的文字、语言及网站范围中解析真正命中的术语，并报告可解释的固定译名冲突。
 * 主要内容：使用字面字符串检索、英文与其他非中日韩文字的词边界、大小写选项及长词优先；库与条目顺序决定同源词冲突胜者。
 * 模块边界：属于纯匹配算法，不读取配置、不构建提示词、不进行翻译后的字符串替换；返回结果仅携带实际命中的原词和译词。
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

function containsTerm(text: string, source: string, caseSensitive: boolean): boolean {
    const candidate = caseSensitive ? text : text.toLowerCase();
    const needle = caseSensitive ? source : source.toLowerCase();
    const first = Array.from(needle)[0];
    const last = Array.from(needle).at(-1)!;
    let position = candidate.indexOf(needle);
    while (position !== -1) {
        const before = Array.from(candidate.slice(Math.max(0, position - 2), position)).at(-1) ?? '';
        const after = Array.from(candidate.slice(position + needle.length, position + needle.length + 2))[0] ?? '';
        if ((!isWordCharacter(first) || !isWordCharacter(before))
            && (!isWordCharacter(last) || !isWordCharacter(after))) return true;
        position = candidate.indexOf(needle, position + needle.length);
    }
    return false;
}

export function resolveGlossary(libraries: readonly GlossaryLibrary[], context: GlossaryContext): {
    terms: GlossaryTerm[]; conflicts: GlossaryConflict[];
} {
    const selected = normalizeGlossaryIds(context.glossaryIds);
    const sourceLanguage = normalizeGlossaryLanguage(context.sourceLanguage);
    const targetLanguage = normalizeGlossaryLanguage(context.targetLanguage);
    const texts = (Array.isArray(context.text) ? context.text : [context.text]).map(cleanGlossaryText);
    const chosen: {term: GlossaryTerm; caseSensitive: boolean}[] = [];
    const conflicts: GlossaryConflict[] = [];
    for (const library of normalizeGlossaryLibraries(libraries)) {
        if (!library.enabled || (selected && !selected.includes(library.id))
            // 自动源语没有可靠的明确语言值，先以原词命中筛选，避免默认 auto 排除所有有源语约束的库。
            || (sourceLanguage !== '' && !languageMatches(library.sourceLanguage, sourceLanguage))
            || !languageMatches(library.targetLanguage, targetLanguage)
            || !domainMatches(library.domains, context.pageUrl)) continue;
        for (const entry of library.entries) {
            if (!texts.some((text) => containsTerm(text, entry.source, entry.caseSensitive))) continue;
            const term = {source: entry.source, target: entry.target || entry.source};
            const previous = chosen.find((item) => item.term.source === term.source
                || ((!item.caseSensitive || !entry.caseSensitive) && item.term.source.toLowerCase() === term.source.toLowerCase()));
            if (previous) {
                if (previous.term.target !== term.target) conflicts.push({source: entry.source,
                    keptTarget: previous.term.target, ignoredTarget: term.target, libraryId: library.id, entryId: entry.id});
            } else chosen.push({term, caseSensitive: entry.caseSensitive});
        }
    }
    return {terms: chosen.map((item) => item.term).sort((a, b) => b.source.length - a.source.length), conflicts};
}
