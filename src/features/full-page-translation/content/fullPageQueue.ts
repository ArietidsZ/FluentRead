/**
 * @file src/features/full-page-translation/content/fullPageQueue.ts
 * 文件职责：维护全文翻译 pending 候选的排队元数据，并选择当前最适合启动的候选。
 * 主要内容：保留同源候选的等待时间与稳定序号，读取当前候选锚点布局，执行视口优先、方向预取和后台公平配额。
 * 模块边界：本文件不发现候选、不修改 DOM、不调用 provider；runtime 负责生命周期与资格判断，fullPagePriority 负责纯排序规则。
 */

import type {TranslationCandidate} from '@/src/core/translation/public';
import {
    compareFullPageCandidatePriority,
    FULL_PAGE_BACKGROUND_MAX_WAIT_MS,
    FULL_PAGE_FOREGROUND_DISPATCH_QUOTA,
    FULL_PAGE_PREFETCH_MARGIN_PX,
    scoreFullPageCandidatePriority,
    type FullPageCandidatePriority,
    type FullPageScrollDirection,
} from './fullPagePriority';

export interface FullPagePendingMetadata {
    source: string;
    queuedAt: number;
    sequence: number;
}

export interface FullPageQueueState {
    pending: Map<Node, TranslationCandidate>;
    pendingMetadata: Map<Node, FullPagePendingMetadata>;
    inFlightCandidates: Map<Node, TranslationCandidate>;
    candidateAnchors: Map<Node, HTMLElement>;
    nextPendingSequence: number;
    foregroundDispatchesSinceBackground: number;
    scrollDirection: FullPageScrollDirection;
    lastScrollPosition: number | undefined;
}

export type FullPageQueueStorage = Omit<FullPageQueueState, 'inFlightCandidates'>;

export interface FullPageQueueSelectionOptions {
    now: number;
    viewportHeight: number;
    isEligible: (candidate: TranslationCandidate) => boolean;
    resolveSource: (candidate: TranslationCandidate) => string;
}

export interface FullPagePendingSelection {
    key: Node;
    candidate: TranslationCandidate;
    priority: FullPageCandidatePriority;
}

function readScrollPosition(): number | undefined {
    if (typeof window === 'undefined') return undefined;
    const value = window.scrollY ?? window.pageYOffset;
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function createFullPageQueueState(): FullPageQueueStorage {
    return {
        pending: new Map(),
        pendingMetadata: new Map(),
        candidateAnchors: new Map(),
        nextPendingSequence: 0,
        foregroundDispatchesSinceBackground: 0,
        scrollDirection: 'unknown',
        lastScrollPosition: readScrollPosition(),
    };
}

export function clearFullPageQueueState(state: FullPageQueueState): void {
    state.pending.clear();
    state.pendingMetadata.clear();
    state.candidateAnchors.clear();
}

export function noteFullPageScroll(
    state: FullPageQueueState,
    isActive: () => boolean,
    onScroll: () => void,
): void {
    if (!isActive()) return;
    const nextPosition = readScrollPosition();
    if (nextPosition !== undefined && state.lastScrollPosition !== undefined) {
        if (nextPosition > state.lastScrollPosition) state.scrollDirection = 'forward';
        else if (nextPosition < state.lastScrollPosition) state.scrollDirection = 'backward';
    }
    if (nextPosition !== undefined) state.lastScrollPosition = nextPosition;
    onScroll();
}

export function queueFullPageCandidate(
    state: FullPageQueueState,
    key: Node,
    candidate: TranslationCandidate,
    source: string,
    queuedAt = Date.now(),
): void {
    const previous = state.pendingMetadata.get(key);
    if (!previous || previous.source !== source) {
        state.pendingMetadata.set(key, {
            source,
            queuedAt,
            sequence: ++state.nextPendingSequence,
        });
    }
    state.pending.set(key, candidate);
}

export function removeFullPagePending(
    state: FullPageQueueState,
    key: Node,
    candidate?: TranslationCandidate,
): boolean {
    if (candidate && state.pending.get(key) !== candidate) return false;
    const removed = state.pending.delete(key);
    if (removed) state.pendingMetadata.delete(key);
    return removed;
}

function getCandidateRect(
    state: FullPageQueueState,
    key: Node,
    candidate: TranslationCandidate,
): {top: number; bottom: number} | undefined {
    const anchor = state.candidateAnchors.get(key) ?? candidate.element;
    if (!anchor.isConnected || typeof anchor.getBoundingClientRect !== 'function') return undefined;
    try {
        const rect = anchor.getBoundingClientRect();
        if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) return undefined;
        return {top: rect.top, bottom: rect.bottom};
    } catch {
        return undefined;
    }
}

function getCandidatePriority(
    state: FullPageQueueState,
    key: Node,
    candidate: TranslationCandidate,
    options: FullPageQueueSelectionOptions,
): FullPageCandidatePriority {
    let metadata = state.pendingMetadata.get(key);
    if (!metadata) {
        metadata = {
            source: options.resolveSource(candidate),
            queuedAt: options.now,
            sequence: ++state.nextPendingSequence,
        };
        state.pendingMetadata.set(key, metadata);
    }
    return scoreFullPageCandidatePriority({
        rect: getCandidateRect(state, key, candidate),
        viewportTop: 0,
        viewportBottom: Math.max(0, Number.isFinite(options.viewportHeight) ? options.viewportHeight : 0),
        prefetchMargin: FULL_PAGE_PREFETCH_MARGIN_PX,
        direction: state.scrollDirection,
        queuedAt: metadata.queuedAt,
        now: options.now,
        sequence: metadata.sequence,
    });
}

export function selectNextFullPageCandidate(
    state: FullPageQueueState,
    options: FullPageQueueSelectionOptions,
): FullPagePendingSelection | undefined {
    const candidates: FullPagePendingSelection[] = [];
    for (const [key, candidate] of state.pending) {
        if (state.inFlightCandidates.has(key) || !options.isEligible(candidate)) continue;
        candidates.push({key, candidate, priority: getCandidatePriority(state, key, candidate, options)});
    }
    if (candidates.length === 0) return undefined;

    const agedBackground = candidates.some(({priority}) =>
        priority.band === 'background' && priority.ageMs >= FULL_PAGE_BACKGROUND_MAX_WAIT_MS,
    );
    const forceBackground = agedBackground &&
        state.foregroundDispatchesSinceBackground >= FULL_PAGE_FOREGROUND_DISPATCH_QUOTA;
    const eligible = forceBackground
        ? candidates.filter(({priority}) => priority.band === 'background')
        : candidates;
    return eligible.reduce((best, current) => {
        if (!best || compareFullPageCandidatePriority(current.priority, best.priority) < 0) return current;
        return best;
    }, undefined as FullPagePendingSelection | undefined);
}
