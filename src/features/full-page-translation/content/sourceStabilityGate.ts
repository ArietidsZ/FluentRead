/**
 * @file src/features/full-page-translation/content/sourceStabilityGate.ts
 * 文件职责：把来源稳定性判定接入会话调度，并拥有可取消的安静窗口定时器。
 * 主要内容：暂停动态来源请求、按最新候选和当前视口重新调度，清理会话与路由切换后的定时器；共享可见锚点的预取范围判定。
 * 模块边界：通过端口调用 runtime 的候选发现与队列，不直接管理译文 DOM、provider 或配置；纯来源判定由 sourceStability.ts 提供。
 */
import {getTranslationCandidateKey, type TranslationCandidate} from '@/src/core/translation/public';
import {FULL_PAGE_PREFETCH_MARGIN_PX} from './fullPagePriority';
import {createTranslationSourceHistory, observeTranslationSource} from './sourceStability';

interface SourceStabilitySession {
    translationMode: string;
    scheduled: Map<Node, TranslationCandidate>;
    unchangedCandidates: WeakMap<Node, unknown>;
    lifecycleRetries: WeakMap<Node, unknown>;
}

interface SourceStabilityPorts<T> {
    isCurrent: (session: T) => boolean;
    resolve: (candidate: TranslationCandidate) => TranslationCandidate | null;
    discover: (session: T, candidate: TranslationCandidate) => void;
    source: (candidate: TranslationCandidate) => string;
    queue: (session: T, key: Node, candidate: TranslationCandidate, source: string) => void;
    drain: (session: T) => void;
}

/** 复用曾经可见的锚点前检查当前位置，避免把离屏来源提前请求。 */
export function isAnchorNearViewport(anchor: HTMLElement): boolean {
    try {
        const rect = anchor.getBoundingClientRect();
        const width = window.innerWidth || document.documentElement.clientWidth;
        const height = window.innerHeight || document.documentElement.clientHeight;
        return width > 0 && height > 0 && rect.width > 0 && rect.height > 0 &&
            rect.right > 0 && rect.left < width &&
            rect.bottom > -FULL_PAGE_PREFETCH_MARGIN_PX &&
            rect.top < height + FULL_PAGE_PREFETCH_MARGIN_PX;
    } catch {
        return false;
    }
}

export class TranslationSourceStabilityGate<T extends SourceStabilitySession> {
    private history = createTranslationSourceHistory();
    private readonly timers = new Map<T, Map<Node, number>>();

    constructor(private readonly ports: SourceStabilityPorts<T>) {}

    /** 返回 true 表示当前来源暂时或持续保持原文。 */
    blocks(candidate: TranslationCandidate, source: string, session?: T): boolean {
        const identity = getTranslationCandidateKey(candidate);
        const stability = observeTranslationSource(this.history, identity, source, Date.now());
        const timers = session ? this.timers.get(session) : undefined;
        const currentTimer = timers?.get(identity);
        if (currentTimer !== undefined) {
            window.clearTimeout(currentTimer);
            timers!.delete(identity);
        }
        if (stability.kind === 'ready') return false;
        if (stability.kind === 'settling' && session) {
            const pending = timers ?? new Map<Node, number>();
            this.timers.set(session, pending);
            pending.set(identity, window.setTimeout(() => {
                pending.delete(identity);
                if (!this.ports.isCurrent(session) || !identity.isConnected) return;
                session.unchangedCandidates.delete(identity);
                session.lifecycleRetries.delete(identity);
                const fresh = this.ports.resolve(candidate);
                if (!fresh) return;
                this.ports.discover(session, fresh);
                const key = getTranslationCandidateKey(fresh);
                const scheduled = session.scheduled.get(key);
                // 重新 observe 相同锚点不保证再次派发 IO；只唤醒仍在预取区的最新候选。
                if (scheduled && (session.translationMode === 'all' || isAnchorNearViewport(fresh.element))) {
                    this.ports.queue(session, key, scheduled, this.ports.source(scheduled));
                    this.ports.drain(session);
                }
            }, stability.delay));
        }
        return true;
    }

    dispose(session: T): void {
        this.timers.get(session)?.forEach(timer => window.clearTimeout(timer));
        this.timers.delete(session);
    }

    reset(): void {
        this.timers.forEach((_timers, session) => this.dispose(session));
        this.history = createTranslationSourceHistory();
    }
}
