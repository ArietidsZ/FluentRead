import {describe, expect, it} from 'vitest';
import {writingEntryCandidates, type WritingEntryPlacement} from '@/src/features/writing-assistant/entryPlacement';

const viewport = {left: 0, top: 0, right: 600, bottom: 400};
const action = {left: 250, top: 100, right: 350, bottom: 132, width: 100, height: 32};

function expectCandidateWithinFreeBounds(candidate: WritingEntryPlacement): void {
    expect(candidate.left).toBeGreaterThanOrEqual(viewport.left + 8);
    expect(candidate.top).toBeGreaterThanOrEqual(viewport.top + 8);
    expect(candidate.left + candidate.width).toBeLessThanOrEqual(viewport.right - 8);
    expect(candidate.top + candidate.height).toBeLessThanOrEqual(viewport.bottom - 8);
    expect(candidate.left + candidate.width <= action.left || candidate.left >= action.right).toBe(true);
}

describe('writing entry placement geometry', () => {
    it('prioritizes complete and compact candidates on the preferred GitHub side', () => {
        const candidates = writingEntryCandidates(action, viewport, 100, 'github');

        expect(candidates).toEqual([
            {left: 142, top: 100, width: 100, height: 32, compact: false},
            {left: 358, top: 100, width: 100, height: 32, compact: false},
            {left: 210, top: 100, width: 32, height: 32, compact: true},
            {left: 358, top: 100, width: 32, height: 32, compact: true},
        ]);
        candidates.forEach(expectCandidateWithinFreeBounds);
    });

    it('reverses side priority for Gmail while preserving width priority', () => {
        expect(writingEntryCandidates(action, viewport, 100, 'gmail')).toEqual([
            {left: 358, top: 100, width: 100, height: 32, compact: false},
            {left: 142, top: 100, width: 100, height: 32, compact: false},
            {left: 358, top: 100, width: 32, height: 32, compact: true},
            {left: 210, top: 100, width: 32, height: 32, compact: true},
        ]);
    });

    it('centers the fixed-height entry beside a taller action', () => {
        const candidates = writingEntryCandidates(
            {...action, top: 80, bottom: 144, height: 64},
            viewport,
            96,
            'github',
        );

        expect(candidates[0]).toEqual({left: 146, top: 96, width: 96, height: 32, compact: false});
    });

    it('keeps only the side and mode that fit the viewport inset', () => {
        const candidates = writingEntryCandidates(
            {...action, left: 60, right: 160},
            {...viewport, right: 190},
            100,
            'github',
        );

        expect(candidates).toEqual([
            {left: 20, top: 100, width: 32, height: 32, compact: true},
        ]);
    });

    it('returns no complete-width candidate when neither side can fit the full button', () => {
        const candidates = writingEntryCandidates(
            {...action, left: 80, right: 180},
            {...viewport, right: 220},
            120,
            'gmail',
        );

        expect(candidates).toEqual([
            {left: 40, top: 100, width: 32, height: 32, compact: true},
        ]);
    });

    it('returns no candidates for offscreen or invalid dimensions', () => {
        expect(writingEntryCandidates({...action, left: -1, right: 99}, viewport, 100, 'github')).toEqual([]);
        expect(writingEntryCandidates({...action, top: 380, bottom: 412}, viewport, 100, 'github')).toEqual([]);
        expect(writingEntryCandidates(action, viewport, 31, 'github')).toEqual([]);
        expect(writingEntryCandidates({...action, width: 0}, viewport, 100, 'github')).toEqual([]);
        expect(writingEntryCandidates(action, {...viewport, right: Number.NaN}, 100, 'github')).toEqual([]);
        expect(writingEntryCandidates({...action, right: 200}, viewport, 100, 'github')).toEqual([]);
    });

    it('does not duplicate compact candidates when complete width is exactly 32', () => {
        expect(writingEntryCandidates(action, viewport, 32, 'github')).toEqual([
            {left: 210, top: 100, width: 32, height: 32, compact: true},
            {left: 358, top: 100, width: 32, height: 32, compact: true},
        ]);
    });
});
