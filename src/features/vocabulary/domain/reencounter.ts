/**
 * @file src/features/vocabulary/domain/reencounter.ts
 * 文件职责：在新阅读文本中定位主动收藏的表达，生成可对照的原句与最小收藏快照。
 * 主要内容：用多模式匹配索引处理大小写、组合字符、空白和常见排印符号，保留原文坐标，按完整词边界及最长匹配消除重叠，并抽取有界的真实语境。
 * 模块边界：本模块不访问网页、存储、浏览器或模型，不记录遇见次数，也不修改掌握度或复习计划；内容层负责把坐标转换为只读 Range。
 */
import type {VocabularyEntry} from '../learningModel';

export interface ReencounterEntry {
  id: string;
  term: string;
  sourceLanguage: string;
  reference: string;
  savedSentence: string;
  savedTitle: string;
}
export interface ExpressionMatch {entryId: string; start: number; end: number}
interface SymbolSpan {symbol: string; start: number; end: number}
interface Terminal {entryId: string; length: number}
interface TrieNode {next: Map<string, number>; fail: number; output: Terminal[]; link: number}
export interface ExpressionIndex {nodes: TrieNode[]}
const node = (): TrieNode => ({next: new Map(), fail: 0, output: [], link: 0});

/** 规范化时保留每个字符在原文中的区间；大小写扩展与组合字符不会造成 Range 偏移。 */
function symbols(text: string): SymbolSpan[] {
  const result: SymbolSpan[] = [];
  for (const part of text.matchAll(/\P{M}\p{M}*|\p{M}+/gu)) {
    const start = part.index;
    const end = start + part[0].length;
    const normalized = part[0].normalize('NFC').toLowerCase().replace(/[’‘]/gu, "'").replace(/[‐‑‒–—]/gu, '-');
    for (const character of normalized) {
      const symbol = /\s/u.test(character) ? ' ' : character;
      if (symbol === ' ' && result.at(-1)?.symbol === ' ') result[result.length - 1].end = end;
      else result.push({symbol, start, end});
    }
  }
  return result;
}

/** 编译收藏索引；重复表达保留列表中优先的收藏，不把整本词书逐项扫描每一段。 */
export function createExpressionIndex(entries: readonly Pick<ReencounterEntry, 'id' | 'term'>[]): ExpressionIndex {
  const nodes: TrieNode[] = [node()];
  for (const entry of entries) {
    const term = symbols(entry.term.trim());
    if (!term.length || !/[\p{L}\p{N}]/u.test(entry.term)) continue;
    let state = 0;
    for (const {symbol} of term) {
      let next = nodes[state].next.get(symbol);
      if (next === undefined) { next = nodes.length; nodes[state].next.set(symbol, next); nodes.push(node()); }
      state = next;
    }
    if (!nodes[state].output.length) nodes[state].output.push({entryId: entry.id, length: term.length});
  }
  const queue = [...nodes[0].next.values()];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const state = queue[cursor];
    for (const [symbol, next] of nodes[state].next) {
      queue.push(next);
      let fallback = nodes[state].fail;
      while (fallback && !nodes[fallback].next.has(symbol)) fallback = nodes[fallback].fail;
      nodes[next].fail = nodes[fallback].next.get(symbol) ?? 0;
      const parent = nodes[next].fail;
      nodes[next].link = nodes[parent].output.length ? parent : nodes[parent].link;
    }
  }
  return {nodes};
}

function wordCharacter(symbol: string): boolean {
  // 汉字与假名允许在连续原文中匹配；有空格词界的语言不匹配词内子串。
  return /[\p{L}\p{M}\p{N}'-]/u.test(symbol) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(symbol);
}

/** 返回不重叠的最长完整表达；所有坐标仍指向未经修改的原文。 */
export function matchExpressions(text: string, index: ExpressionIndex, limit = 300): ExpressionMatch[] {
  const input = symbols(text);
  const candidates: ExpressionMatch[] = [];
  const {nodes} = index;
  let state = 0;
  for (let cursor = 0; cursor < input.length; cursor += 1) {
    const symbol = input[cursor].symbol;
    while (state && !nodes[state].next.has(symbol)) state = nodes[state].fail;
    state = nodes[state].next.get(symbol) ?? 0;
    for (let outputState = state; outputState; outputState = nodes[outputState].link) {
      for (const output of nodes[outputState].output) {
        const start = cursor - output.length + 1;
        if (wordCharacter(input[start].symbol) && start > 0 && wordCharacter(input[start - 1].symbol)) continue;
        if (wordCharacter(symbol) && cursor + 1 < input.length && wordCharacter(input[cursor + 1].symbol)) continue;
        candidates.push({entryId: output.entryId, start: input[start].start, end: input[cursor].end});
      }
    }
  }
  candidates.sort((a, b) => a.start - b.start || b.end - a.end);
  const matches: ExpressionMatch[] = [];
  let end = -1;
  for (const candidate of candidates) {
    if (candidate.start < end) continue;
    if (matches.length >= limit) break;
    matches.push(candidate); end = candidate.end;
  }
  return matches;
}

/** 抽取当前句，超长段落只保留命中附近的有界原文，绝不拼造句子。 */
export function reencounterSentence(text: string, start: number, end: number): string {
  const left = Math.max(0, start - 400);
  const right = Math.min(text.length, end + 400);
  const before = text.slice(left, start);
  const after = text.slice(end, right);
  const boundary = /[.!?。！？\n]/gu;
  const previous = [...before.matchAll(boundary)].at(-1);
  const next = after.search(boundary);
  return text.slice(previous ? left + previous.index + 1 : left, next >= 0 ? end + next + 1 : right).trim();
}

/** 内容页只读取对照所需字段，不接收来源 URL、复习日志或整个历史问答。 */
export function reencounterSnapshot(entry: VocabularyEntry): ReencounterEntry {
  const index = createExpressionIndex([entry]);
  const saved = [...entry.contexts].sort((a, b) => b.capturedAt - a.capturedAt).find(context => {
    const hit = matchExpressions(context.text, index, 1)[0];
    return hit && /[\p{L}\p{N}]/u.test(context.text.slice(0, hit.start) + context.text.slice(hit.end));
  });
  const reference = Object.values(entry.translations).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.text || '';
  return {id: entry.id, term: entry.term, sourceLanguage: entry.sourceLanguage, reference,
    savedSentence: saved?.text || '', savedTitle: saved?.pageTitle || ''};
}

/** 用于本地匹配的列表只带身份和表达；原句与参考内容在主动打开卡片后读取。 */
export function reencounterTerm(entry: VocabularyEntry): ReencounterEntry {
  return {id: entry.id, term: entry.term, sourceLanguage: entry.sourceLanguage, reference: '', savedSentence: '', savedTitle: ''};
}
