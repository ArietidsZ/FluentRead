/**
 * @file src/features/full-page-translation/content/liveTextTranslation.ts
 * 文件职责：执行交互控件和仅译文内容的实时文本槽翻译，并保留异步提交所需的来源/译文快照。
 * 主要内容：收集当前可译 Text 节点、调用全文请求编排并构造带前后缀的实时槽结果。
 * 模块边界：本文件不管理 DOM 状态、不决定候选、不监听 mutation；runtime 负责 generation 校验和最终渲染。
 */
import {
    collectLiveTranslationTextSlots,
    getCurrentTranslationCore,
} from '@/src/core/translation/public';
import type {TranslationTextProtectionOptions} from '@/src/core/translation/public';
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
): Promise<LiveTextTranslationResult> {
    const parts = collectLiveTranslationTextSlots(
        node,
        getCurrentTranslationCore().shouldStayOriginal,
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
