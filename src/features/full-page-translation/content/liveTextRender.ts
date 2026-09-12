/**
 * @file src/features/full-page-translation/content/liveTextRender.ts
 * 文件职责：把实时文本槽与按钮属性两类替换式译文提交到宿主 DOM，并给出统一的提交结论。
 * 主要内容：复验请求期间发生变化的 Text 槽身份；为仅译文正文挂载闭合 Shadow 槽，为交互控件原位回写 Text，为按钮型 input 改写标签属性；所有写入都在视口锚点内执行，并返回 committed/stale/unchanged/empty 供调用方映射为目标结果。 可核对的公开符号包括 LiveTextRenderCommit、renderLiveTextResult。
 * 模块边界：本文件只负责一次已完成请求的渲染提交，不发起请求、不调度候选、不监听 DOM 变更，也不决定重试与会话生命周期。
 */
import {
    collectLiveTranslationTextSlots,
    getCurrentTranslationCore,
} from '@/src/core/translation/public';
import type {TranslationScope} from '@/src/core/translation/public';
import {appendSingleTranslationSlots} from './renderer';
import {
    discardTranslation,
    markTranslationComplete,
    setControlValueApplied,
    setLiveTranslationSourceSnapshot,
    setSingleTextSlotHosts,
    setTextSlotsApplied,
    type TranslationState,
} from './state';
import {
    getCurrentTranslationStateTextNodes,
    getTranslationStateProtectionBoundary,
    getTranslationTextProtectionOptions,
    reboundLiveTextResult,
} from './translationStability';
import type {ControlValueTranslationResult, LiveTextTranslationResult} from './liveTextTranslation';
import {withFullPageViewportAnchor} from './viewportStability';

/** 渲染层只描述这次提交发生了什么；重试根、来源文本等调用方语义仍由 runtime 决定。 */
export type LiveTextRenderCommit = 'committed' | 'stale' | 'unchanged' | 'empty';

/**
 * 按钮型 input 的可见标签只存在于 value 属性里，元素内部没有任何 Text 节点，
 * 因此既无法插入双语行，也无法回写文本槽，只能整体替换属性文本。
 */
function renderControlValue(
    node: HTMLElement,
    state: TranslationState,
    generation: number,
    result: ControlValueTranslationResult,
): LiveTextRenderCommit {
    if (!result.complete || !result.changed) {
        withFullPageViewportAnchor(() => discardTranslation(node, state), [node]);
        return result.complete ? 'unchanged' : 'empty';
    }
    if (!markTranslationComplete(node, state, generation, false)) return 'stale';
    withFullPageViewportAnchor(() => node.setAttribute(result.attribute, result.text), [node]);
    setControlValueApplied(node, result.text);
    return 'committed';
}

/**
 * 实时文本槽在异步期间可能被宿主等价重挂。提交前按当前 Text 身份重新绑定译文；
 * 无法对齐时交回上层作为过期尝试处理，绝不把旧译文写进新节点。
 */
function renderLiveText(
    node: HTMLElement,
    state: TranslationState,
    generation: number,
    result: LiveTextTranslationResult,
    scope: TranslationScope | undefined,
    targetLanguage: string,
): LiveTextRenderCommit {
    if (!result.complete) {
        withFullPageViewportAnchor(() => discardTranslation(node, state), [node]);
        return 'empty';
    }
    if (!result.changed) {
        withFullPageViewportAnchor(() => discardTranslation(node, state), [node]);
        return result.nodes.length === 0 ? 'empty' : 'unchanged';
    }
    const currentNodes = getCurrentTranslationStateTextNodes(node, state);
    const currentParts = collectLiveTranslationTextSlots(
        node,
        getCurrentTranslationCore(scope).shouldStayOriginal,
        getTranslationStateProtectionBoundary(node, state),
        getTranslationTextProtectionOptions(state.allowTopLevelApplicationShell, node),
    );
    const rebound = reboundLiveTextResult(currentNodes, result, currentParts);
    if (!rebound) return 'stale';
    if (!markTranslationComplete(node, state, generation, false)) return 'stale';
    setLiveTranslationSourceSnapshot(node, rebound.nodes);
    if (state.mode === 'single' && state.kind === 'content') {
        const hosts = withFullPageViewportAnchor(() =>
            appendSingleTranslationSlots(node, rebound.slots, {targetLanguage}), [node]);
        if (hosts.length !== rebound.slots.length) return 'stale';
        setSingleTextSlotHosts(node, hosts);
        return 'committed';
    }
    withFullPageViewportAnchor(() => {
        currentParts.forEach((part, index) => {
            if (part.node.isConnected) {
                part.node.nodeValue = `${part.prefix}${result.translations[index] ?? part.source}${part.suffix}`;
            }
        });
    }, [node]);
    setTextSlotsApplied(node, rebound.nodes);
    return 'committed';
}

/** 交互控件、仅译文正文和按钮属性共用同一条替换式提交入口，保证渲染语义一致。 */
export function renderLiveTextResult(
    node: HTMLElement,
    state: TranslationState,
    generation: number,
    result: LiveTextTranslationResult | ControlValueTranslationResult,
    scope: TranslationScope | undefined,
    targetLanguage: string,
): LiveTextRenderCommit {
    return result.kind === 'control-value'
        ? renderControlValue(node, state, generation, result)
        : renderLiveText(node, state, generation, result, scope, targetLanguage);
}
