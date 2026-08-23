export const VOCABULARY_BOOK_MESSAGE = 'fluentReadVocabularyBook' as const;
export const VOCABULARY_BOOK_CHANGED_MESSAGE = 'fluentReadVocabularyBookChanged' as const;

export const VOCABULARY_BOOK_EXPORT_FORMAT = 'fluentread-vocabulary-book' as const;
export const VOCABULARY_BOOK_EXPORT_VERSION = 1 as const;
export const VOCABULARY_ENTRY_SCHEMA_VERSION = 1 as const;

export const VOCABULARY_BOOK_MAX_ENTRIES = 5_000;
export const VOCABULARY_ENTRY_MAX_CONTEXTS = 8;
export const VOCABULARY_REVIEW_LOG_MAX_PER_ENTRY = 100;
export const VOCABULARY_LARGE_IMPORT_WARNING_BYTES = 20 * 1024 * 1024;

function sanitizeAnkiTsvCell(value: unknown): string {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

/** Build an Anki text import without turning the column labels into a card. */
export function buildAnkiTsv(columns: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const columnHeader = columns.map(sanitizeAnkiTsvCell).join('\t');
  const dataRows = rows.map(row => row.map(sanitizeAnkiTsvCell).join('\t'));
  return [
    '#separator:tab',
    '#html:false',
    `#columns:${columnHeader}`,
    ...dataRows,
  ].join('\n');
}

export function vocabularyImportNeedsConfirmation(fileSize: number): boolean {
  return Number.isFinite(fileSize) && fileSize > VOCABULARY_LARGE_IMPORT_WARNING_BYTES;
}

const VOCABULARY_WORD_CONTINUATION_CLASS = "\\p{L}\\p{M}\\p{N}'’‘\\-‐‑‒–—";

function vocabularyTermPattern(term: string): string {
  return [...term].map(character => {
    if ("'’‘".includes(character)) return "['’‘]";
    if ('-‐‑‒–—'.includes(character)) return '[-‐‑‒–—]';
    return character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
}

/** Replace complete word occurrences only; return empty when no cloze can be made safely. */
export function buildVocabularyCloze(context: string, term: string): string {
  const source = String(context || '');
  const normalizedTerm = String(term || '').trim();
  if (!source || !normalizedTerm) return '';
  const termPattern = vocabularyTermPattern(normalizedTerm);
  const matcher = new RegExp(
    `(^|[^${VOCABULARY_WORD_CONTINUATION_CLASS}])(?:${termPattern})(?=$|[^${VOCABULARY_WORD_CONTINUATION_CLASS}])`,
    'giu',
  );
  let replacements = 0;
  const cloze = source.replace(matcher, (_match, prefix: string) => {
    replacements += 1;
    return `${prefix}____`;
  });
  return replacements > 0 ? cloze : '';
}

export type VocabularyMasteryLevel = 0 | 1 | 2 | 3 | 4 | 5;
export type VocabularyStatus = 'new' | 'learning' | 'familiar' | 'mastered';
export type VocabularyReviewRating = 'again' | 'good' | 'manual-mastered' | 'relearn';
export type VocabularyScheduledReviewRating = Extract<VocabularyReviewRating, 'again' | 'good'>;

export interface VocabularyTranslationSnapshot {
  text: string;
  updatedAt: number;
}

export type VocabularyTranslations = Record<string, VocabularyTranslationSnapshot>;

export interface VocabularyContextInput {
  text: string;
  sourceUrl?: string;
  pageTitle?: string;
  capturedAt?: number;
}

export interface VocabularyContext {
  text: string;
  sourceUrl?: string;
  pageTitle?: string;
  capturedAt: number;
}

export interface VocabularyEntry {
  id: string;
  identityKey: string;
  sourceLanguage: string;
  term: string;
  normalizedTerm: string;
  translations: VocabularyTranslations;
  phonetic: string;
  partOfSpeech: string;
  contexts: VocabularyContext[];
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number;
  encounterCount: number;
  masteryLevel: VocabularyMasteryLevel;
  status: VocabularyStatus;
  nextReviewAt: number | null;
  lastReviewedAt: number | null;
  reviewCount: number;
  lapseCount: number;
  schemaVersion: typeof VOCABULARY_ENTRY_SCHEMA_VERSION;
}

export interface VocabularyReviewLog {
  id: string;
  entryId: string;
  rating: VocabularyReviewRating;
  reviewedAt: number;
  beforeLevel: VocabularyMasteryLevel;
  afterLevel: VocabularyMasteryLevel;
  nextReviewAt: number | null;
}

export interface VocabularyUpsertInput {
  sourceLanguage: string;
  targetLanguage: string;
  term: string;
  translation: string;
  phonetic?: string;
  partOfSpeech?: string | string[];
  context?: VocabularyContextInput;
  contexts?: VocabularyContextInput[];
}

export interface VocabularyListOptions {
  status?: VocabularyStatus | VocabularyStatus[];
  sourceLanguage?: string;
  targetLanguage?: string;
  search?: string;
  dueOnly?: boolean;
  now?: number;
  order?: 'recent' | 'due' | 'term';
  offset?: number;
  limit?: number;
}

export interface VocabularyReviewResult {
  entry: VocabularyEntry;
  log: VocabularyReviewLog;
}

export interface VocabularyRemovalSnapshot {
  entry: VocabularyEntry;
  reviewLogs: VocabularyReviewLog[];
}

/**
 * Context fields are optional in exports because privacy-safe exports omit
 * page content and location by default while retaining capture timestamps.
 */
export interface VocabularyExportContext {
  capturedAt: number;
  text?: string;
  sourceUrl?: string;
  pageTitle?: string;
}

export type VocabularyExportEntry = Omit<VocabularyEntry, 'contexts'> & {
  contexts: VocabularyExportContext[];
};

export interface VocabularyBookExport {
  format: typeof VOCABULARY_BOOK_EXPORT_FORMAT;
  version: typeof VOCABULARY_BOOK_EXPORT_VERSION;
  exportedAt: number;
  includesPrivateContext: boolean;
  entries: VocabularyExportEntry[];
  reviewLogs: VocabularyReviewLog[];
}

export interface VocabularyExportOptions {
  includePrivateContext?: boolean;
  now?: number;
}

export interface VocabularyImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  reviewLogsImported: number;
}

export type VocabularyBookErrorCode =
  | 'invalid-input'
  | 'not-found'
  | 'limit-exceeded'
  | 'invalid-export'
  | 'storage-error';

export type VocabularyGetByTermRequest = {
  type: typeof VOCABULARY_BOOK_MESSAGE;
  action: 'getByTerm';
  sourceLanguage: string;
  /** Kept during the beta message rollout for callers that use word terminology. */
  targetLanguage?: string;
} & ({ term: string; word?: never } | { word: string; term?: never });

export type VocabularyBookRequest =
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'list'; options?: VocabularyListOptions }
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'get'; entryId: string }
  | VocabularyGetByTermRequest
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'upsert'; input: VocabularyUpsertInput }
  | {
      type: typeof VOCABULARY_BOOK_MESSAGE;
      action: 'review';
      entryId: string;
      rating: VocabularyScheduledReviewRating;
    }
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'setMastery'; entryId: string }
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'relearn'; entryId: string }
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'getReviewLogs'; entryId: string }
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'remove'; entryId: string }
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'removeWithSnapshot'; entryId: string }
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'clear' }
  | {
      type: typeof VOCABULARY_BOOK_MESSAGE;
      action: 'exportData';
      options?: VocabularyExportOptions;
    }
  | { type: typeof VOCABULARY_BOOK_MESSAGE; action: 'importData'; data: unknown };

export type VocabularyBookResponse<T = unknown> =
  | { success: true; data: T }
  | {
      success: false;
      error: {
        code: VocabularyBookErrorCode;
        message: string;
      };
    };

export interface VocabularyBookChangedMessage {
  type: typeof VOCABULARY_BOOK_CHANGED_MESSAGE;
  reason:
    | 'upsert'
    | 'review'
    | 'manual-mastered'
    | 'relearn'
    | 'remove'
    | 'clear'
    | 'import';
  entryId?: string;
}
