/**
 * @file src/features/full-page-translation/content/frameSession.ts
 * 文件职责：让受支持邮件子页面跟随顶层全文会话，并隔离异步状态读取的过期响应。
 * 主要内容：定义不含凭据的会话快照，校验响应，按会话标识与恢复版本决定启动、保留或清理子页面翻译。
 * 模块边界：不访问 browser、DOM 或配置存储；可信消息传输和功能挂载由 content composition root 注入。
 */
import type {FullPageTranslationMode} from '@/src/core/config/model';
import type {FullPageTranslationConfigSnapshot} from './translationRequest';

export interface FrameTranslationState {
    enabled: boolean;
    revision: number;
    sessionId: number | null;
    translationConfig?: FullPageTranslationConfigSnapshot;
    fullPageMode?: FullPageTranslationMode;
}

export function isFrameTranslationState(value: unknown): value is FrameTranslationState {
    if (!value || typeof value !== 'object') return false;
    const state = value as FrameTranslationState;
    if (typeof state.enabled !== 'boolean' || !Number.isSafeInteger(state.revision) || state.revision < 0) return false;
    if (state.sessionId === null) return true;
    if (!Number.isSafeInteger(state.sessionId) || state.sessionId < 1) return false;
    if (state.fullPageMode !== 'all' && state.fullPageMode !== 'viewport') return false;
    const config = state.translationConfig;
    if (!config || typeof config !== 'object') return false;
    return ['service', 'model', 'sourceLanguage', 'targetLanguage'].every(key => typeof config[key as keyof typeof config] === 'string')
        && ['thinking', 'useCache', 'enableAIContext', 'enableAIMultiSegment'].every(key => typeof config[key as keyof typeof config] === 'boolean')
        && (config.displayMode === 'bilingual' || config.displayMode === 'single') && Number.isFinite(config.style)
        && (config.profileId === undefined || typeof config.profileId === 'string')
        && (config.glossaryRevision === undefined || (typeof config.glossaryRevision === 'string'
            && /^glossary-v1:(?:disabled|[a-f0-9]{64})$/u.test(config.glossaryRevision)))
        && (config.glossaryIds === undefined || config.glossaryIds === null
            || (Array.isArray(config.glossaryIds) && config.glossaryIds.length <= 100
                && Array.from(config.glossaryIds).every(id => typeof id === 'string' && id.length <= 128)))
        && (config.requestOverridesApplied === undefined || config.requestOverridesApplied === true);
}

export interface FrameSessionDependencies {
    readState(): Promise<unknown>;
    isEnabled(): boolean;
    setAvailable(available: boolean): void;
    start(state: FrameTranslationState): void;
    restore(): void;
}

/** 每次通知重新读取顶层真值，后发请求优先；销毁后的 Promise 永远不能重新启动会话。 */
export function createFrameSessionController(deps: FrameSessionDependencies) {
    let generation = 0;
    let disposed = false;
    let sessionId: number | null = null;
    let revision: number | null = null;
    const clear = () => { sessionId = null; revision = null; deps.setAvailable(false); deps.restore(); };
    return {
        async refresh(): Promise<void> {
            if (disposed) return;
            const request = ++generation;
            let state: unknown;
            try { state = await deps.readState(); } catch { state = null; }
            if (disposed || request !== generation) return;
            if (!deps.isEnabled() || !isFrameTranslationState(state) || !state.enabled) { clear(); return; }
            deps.setAvailable(true);
            if (sessionId === state.sessionId && revision === state.revision) return;
            deps.restore();
            sessionId = state.sessionId;
            revision = state.revision;
            if (state.sessionId !== null) deps.start(state);
        },
        suspend(): void { if (!disposed) { ++generation; clear(); } },
        dispose(): void { if (!disposed) { disposed = true; ++generation; clear(); } },
    };
}
