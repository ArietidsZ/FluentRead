/**
 * @file src/features/full-page-translation/content/translationStability.ts
 * 文件职责：提供动态页面翻译的语义稳定性判断和实时文本槽重绑定，隔离 React/虚拟列表重建造成的生命周期噪声。
 * 主要内容：判断原文是否仍相同、决定是否保留当前翻译 generation，并把异步结果映射到重建后的 Text 节点。
 * 模块边界：本文件不读取配置、不监听 DOM、不执行 provider 请求；runtime 通过回调提供当前来源与槽位快照。
 */
import type {TranslationTextSlot} from '@/src/core/translation/public';
import type {TranslationState} from './state';

export interface LiveTextResultSnapshot {
    sources: readonly string[];
    translations: readonly string[];
    nodes: readonly Text[];
    slots: readonly {node: Text; text: string}[];
}

export interface ReboundLiveTextResult {
    nodes: readonly Text[];
    slots: readonly {node: Text; text: string}[];
}

export function hasCurrentTranslationSource(
    node: HTMLElement,
    state: TranslationState,
    readSource: (node: HTMLElement, state: TranslationState) => boolean,
): boolean {
    if (state.syntheticSegment || state.kind !== 'content' || !node.isConnected) return false;
    return readSource(node, state);
}

export function canKeepTranslationAttempt(
    node: HTMLElement,
    state: TranslationState,
    readSource: (node: HTMLElement, state: TranslationState) => boolean,
    readSlots: (node: HTMLElement, state: TranslationState) => boolean,
    artifactIntact = true,
): boolean {
    if (!hasCurrentTranslationSource(node, state, readSource)) return false;
    if (state.phase === 'loading') return true;
    return state.phase === 'translated' && artifactIntact &&
        (state.mode === 'bilingual'
            ? state.bilingualContent?.isConnected === true
            : state.singleTextSlotHosts?.length === state.sourceTextNodes?.length) &&
        readSlots(node, state);
}

export function reboundLiveTextResult(
    currentNodes: readonly Text[],
    result: LiveTextResultSnapshot,
    currentParts: readonly TranslationTextSlot[],
): ReboundLiveTextResult | null {
    if (currentNodes.length === result.nodes.length &&
        currentNodes.every((node, index) => node === result.nodes[index])) {
        return {nodes: currentNodes, slots: result.slots};
    }
    if (currentParts.length !== result.sources.length ||
        currentParts.some((part, index) => part.source !== result.sources[index])) return null;
    return {
        nodes: currentParts.map((part) => part.node),
        slots: currentParts.map((part, index) => ({
            node: part.node,
            text: `${part.prefix}${result.translations[index] ?? part.source}${part.suffix}`,
        })),
    };
}
