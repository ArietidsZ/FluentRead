import { describe, expect, it, vi } from 'vitest'
import {
  advanceVocabularyReviewSession,
  buildAnkiTsv,
  buildVocabularyCloze,
  vocabularyStudyContext,
  vocabularyReviewCloze,
  vocabularyStudyPrompt,
  vocabularyReferencePreview,
  createVocabularyLifecycleGuard,
  createVocabularyReviewSession,
  reconcileVocabularyReviewQueue,
  reconcileVocabularyReviewSession,
  vocabularyImportNeedsConfirmation,
  vocabularyReviewSessionProgress,
  normalizeLearningSourceText,
  type VocabularyEntry,
} from '@/src/features/vocabulary/learningModel'

const NOW = 10_000

function entry(id: string, overrides: Partial<VocabularyEntry> = {}): VocabularyEntry {
  return {
    id,
    identityKey: `en:${id}`,
    sourceLanguage: 'en',
    term: id,
    normalizedTerm: id,
    translations: {},
    phonetic: '',
    partOfSpeech: '',
    contexts: [],
    createdAt: 1,
    updatedAt: 1,
    lastSeenAt: 1,
    encounterCount: 1,
    masteryLevel: 0,
    status: 'new',
    nextReviewAt: NOW,
    lastReviewedAt: null,
    reviewCount: 0,
    lapseCount: 0,
    schemaVersion: 1,
    ...overrides,
  }
}

describe('vocabulary learning model edge cases', () => {
  it('validates multilingual learning text without truncating long selections', () => {
    expect(normalizeLearningSourceText(null)).toBe('');
    expect(normalizeLearningSourceText('  Café\n 是一个词。\u0000 ')).toBe('Café 是一个词。');
    expect(normalizeLearningSourceText('…?!')).toBe('');
    expect(normalizeLearningSourceText('a'.repeat(4096))).toHaveLength(4096);
    expect(normalizeLearningSourceText('a'.repeat(4097))).toBe('');
  });
  it('normalizes empty export cells, invalid sizes and empty cloze inputs', () => {
    expect(buildAnkiTsv([null as unknown as string], [[undefined]])).toBe(
      '#separator:tab\n#html:false\n#columns:\n',
    )
    expect(vocabularyImportNeedsConfirmation(Number.NaN)).toBe(false)
    expect(buildVocabularyCloze('', 'word')).toBe('')
    expect(buildVocabularyCloze('word', '')).toBe('')
  })

  it('deduplicates queue entries and advances non-head or missing entries safely', () => {
    const first = entry('first')
    const second = entry('second')
    expect(reconcileVocabularyReviewQueue([first, first], [first], NOW)).toEqual([first])

    const session = createVocabularyReviewSession([first, second])
    expect(advanceVocabularyReviewSession(session, 'second')).toMatchObject({
      queue: [first],
      completed: 1,
      answerVisible: false,
    })
    expect(advanceVocabularyReviewSession(session, 'missing')).toMatchObject({
      queue: [first, second],
      completed: 0,
      answerVisible: false,
    })
  })

  it('detects each kind of current-card change and preserves an unchanged answer', () => {
    const current = entry('current')
    const session = { queue: [current], completed: 2, answerVisible: true }

    expect(reconcileVocabularyReviewSession(session, [], NOW).answerVisible).toBe(false)
    expect(reconcileVocabularyReviewSession(session, [entry('other')], NOW).answerVisible).toBe(false)
    expect(reconcileVocabularyReviewSession(session, [entry('current', { updatedAt: 2 })], NOW).answerVisible).toBe(false)
    expect(reconcileVocabularyReviewSession(session, [entry('current', { reviewCount: 1 })], NOW).answerVisible).toBe(false)
    expect(reconcileVocabularyReviewSession(session, [current], NOW).answerVisible).toBe(true)

    expect(vocabularyReviewSessionProgress({ queue: [], completed: 2, answerVisible: false })).toEqual({
      current: null,
      position: 2,
      total: 2,
    })
  })

  it('runs initialization only while the lifecycle remains active', async () => {
    const initialize = vi.fn()
    const active = createVocabularyLifecycleGuard()
    await expect(active.runAfterReady(Promise.resolve(), initialize)).resolves.toBe(true)
    expect(initialize).toHaveBeenCalledOnce()

    const disposedDuringInitialization = createVocabularyLifecycleGuard()
    await expect(disposedDuringInitialization.runAfterReady(Promise.resolve(), () => {
      disposedDuringInitialization.dispose()
    })).resolves.toBe(false)
  })
})


describe('context-grounded vocabulary study', () => {
  it('selects the newest relevant sentence without inventing clues or mutating saved contexts', () => {
    const contexts = [
      {text: 'We arrived on time.', capturedAt: 3},
      {text: 'on time', capturedAt: 5},
      {text: 'Nothing relevant here.', capturedAt: 6},
      {text: 'The train left on time.', capturedAt: 2},
    ];
    const before = structuredClone(contexts);
    const saved = entry('on time', {term: 'on time', contexts});
    expect(vocabularyStudyContext(saved)).toBe(contexts[0]);
    expect(vocabularyReviewCloze(saved)).toBe('We arrived ____.');
    expect(saved.contexts).toEqual(before);
    expect(vocabularyReviewCloze(entry('word', {contexts: [{text: 'word!', capturedAt: 1}]}))).toBe('');
    expect(vocabularyReviewCloze(entry('word', {contexts: [{text: 'sword fish', capturedAt: 1}]}))).toBe('');
    expect(vocabularyStudyContext(entry('word'))).toBeUndefined();
  });

  it('asks for one expression with evidence and distinguishes original context from generated examples', () => {
    const question = vocabularyStudyPrompt('understand');
    expect(question).toContain('不另选词');
    expect(question).toContain('缺少语境');
    expect(question).toContain('read_context');
    expect(question).toContain('自拟例句');
    expect(question).toContain('不出随机填空题');
    expect(question.length).toBeLessThanOrEqual(1000);
  });

  it('asks for minimal usage corrections without scoring mastery or embedding learner data', () => {
    const prompt = vocabularyStudyPrompt('use');
    expect(prompt).toContain('最小修改');
    expect(prompt).toContain('区分错误和可选润色');
    expect(prompt).toContain('不得编造用户成绩或更新复习状态');
    expect(prompt).toContain('用户当前问题中的文字就是需要反馈的造句');
  });

  it('keeps long collected AI explanations as a short list preview without losing the original', () => {
    expect(vocabularyReferencePreview('### 用法\n**on time** > `按时`')).toBe('用法 on time 按时');
    expect(vocabularyReferencePreview('字'.repeat(500))).toHaveLength(120);
    expect(vocabularyReferencePreview('')).toBe('');
  });
});
