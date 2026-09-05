/**
 * @file src/features/full-page-translation/content/liveTextTranslation.ts
 * 文件职责：按候选类型、展示模式和识别范围选择文本槽请求，保留异步提交所需的来源与译文快照。
 * 主要内容：为正文双语构造文本快照，为交互控件和仅译文模式构造带前后缀的实时 Text 槽结果，统一传递取消、重试、范围与会话参数。
 * 模块边界：本文件不管理 DOM 状态、不决定候选、不监听 mutation；runtime 负责 generation 校验和最终渲染。
 */
import {
    collectLiveTranslationTextSlots,
    getCurrentTranslationCore,
} from '@/src/core/translation/public';
import type {TranslationScope, TranslationTextProtectionOptions} from '@/src/core/translation/public';
import type {TranslationQueueSession} from '@/src/services/translation/queue';
import {
    translateTextSlots,
    type FullPageTranslationConfigSnapshot,
    type FullPageTranslationSessionCache,
} from './translationRequest';

export interface LiveTextTranslationResult {
    kind: 'live-text';
    complete: boolean;
    changed: boolean;
    sources: readonly string[];
    translations: readonly string[];
    nodes: readonly Text[];
    slots: readonly {node: Text; text: string}[];
}

export async function translateLiveText(
    node: HTMLElement,
    snapshot: FullPageTranslationConfigSnapshot,
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
    fullPageSession?: FullPageTranslationSessionCache,
    protectionOptions?: TranslationTextProtectionOptions,
    forceFailedRequest = false,
    scope?: TranslationScope,
): Promise<LiveTextTranslationResult> {
    const parts = collectLiveTranslationTextSlots(
        node,
        getCurrentTranslationCore(scope).shouldStayOriginal,
        undefined,
        protectionOptions,
    );
    if (parts.length === 0) return {
        kind: 'live-text',
        complete: false,
        changed: false,
        sources: [],
        translations: [],
        nodes: [],
        slots: [],
    };

    const origins = parts.map((part) => part.source);
    const translations = await translateTextSlots(
        origins,
        snapshot,
        signal,
        queueSession,
        fullPageSession,
        forceFailedRequest,
    );
    const changed = translations.some((translation, index) =>
        translation.replace(/[\s\u3000]+/gu, ' ').trim() !== (origins[index] || '').replace(/[\s\u3000]+/gu, ' ').trim(),
    );

    return {
        kind: 'live-text',
        complete: translations.length === origins.length,
        changed,
        sources: origins,
        translations,
        nodes: parts.map((part) => part.node),
        slots: parts.map((part, index) => ({
            node: part.node,
            text: `${part.prefix}${translations[index] ?? part.source}${part.suffix}`,
        })),
    };
}

export type TranslationResult = LiveTextTranslationResult | {
    kind: 'snapshot';
    sources: readonly string[];
    translations: readonly string[];
};

/** 统一冻结候选范围；异步期间其他会话的范围变化不能改变本次请求的文本槽。 */
export async function createTranslationRequest(
    node: HTMLElement,
    kind: 'content' | 'control',
    mode: 'bilingual' | 'single',
    snapshot: FullPageTranslationConfigSnapshot,
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
    fullPageSession?: FullPageTranslationSessionCache,
    protectionOptions?: TranslationTextProtectionOptions,
    forceFailedRequest = false,
    scope?: TranslationScope,
): Promise<TranslationResult> {
    if (kind === 'control' || mode === 'single') {
        return translateLiveText(node, snapshot, signal, queueSession, fullPageSession,
            protectionOptions, forceFailedRequest, scope);
    }
    const parts = collectLiveTranslationTextSlots(node, getCurrentTranslationCore(scope).shouldStayOriginal,
        undefined, protectionOptions);
    const origins = parts.map((part) => part.source);
    if (origins.length === 0) return {kind: 'snapshot', sources: [], translations: []};
    const translations = await translateTextSlots(origins, snapshot, signal, queueSession,
        fullPageSession, forceFailedRequest);
    return {kind: 'snapshot', sources: origins, translations};
}
