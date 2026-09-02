import {describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {
    canKeepTranslationAttempt,
    hasCurrentTranslationSource,
    reboundLiveTextResult,
} from '@/src/features/full-page-translation/content/translationStability';
import type {TranslationState} from '@/src/features/full-page-translation/content/state';

function state(overrides: Partial<TranslationState> = {}): TranslationState {
    return {
        mode: 'bilingual',
        kind: 'content',
        phase: 'loading',
        generation: 1,
        sourceText: 'source',
        sourceHTML: 'source',
        syntheticSegment: false,
        originalStyleAttribute: null,
        originalClassAttribute: null,
        originalTextValues: [],
        controller: new AbortController(),
        ...overrides,
    };
}

describe('动态翻译稳定性判定', () => {
    it('只在连接、内容候选且原文仍匹配时认为来源稳定', () => {
        const {document} = parseHTML('<html><body><p>source</p></body></html>');
        const node = document.querySelector('p') as HTMLElement;
        const readSource = vi.fn(() => true);
        expect(hasCurrentTranslationSource(node, state(), readSource)).toBe(true);
        expect(readSource).toHaveBeenCalledWith(node, expect.anything());
        expect(hasCurrentTranslationSource(node, state({syntheticSegment: true}), readSource)).toBe(false);
        expect(hasCurrentTranslationSource(node, state({kind: 'control'}), readSource)).toBe(false);
        expect(hasCurrentTranslationSource(node, state(), () => false)).toBe(false);
        const detached = document.createElement('p');
        expect(hasCurrentTranslationSource(detached, state(), readSource)).toBe(false);
    });

    it('覆盖 loading、双语和仅译文状态的 artifact/slot 分支', () => {
        const {document} = parseHTML('<html><body><p>source</p></body></html>');
        const node = document.querySelector('p') as HTMLElement;
        const readSource = () => true;
        const readSlots = vi.fn(() => true);

        expect(canKeepTranslationAttempt(node, state(), readSource, readSlots)).toBe(true);

        const bilingual = document.createElement('span');
        bilingual.textContent = '译文';
        node.appendChild(bilingual);
        expect(canKeepTranslationAttempt(node, state({
            phase: 'translated',
            bilingualContent: bilingual,
        }), readSource, readSlots)).toBe(true);
        expect(canKeepTranslationAttempt(node, state({
            phase: 'translated',
            bilingualContent: bilingual,
        }), readSource, readSlots, false)).toBe(false);
        expect(canKeepTranslationAttempt(node, state({
            phase: 'translated',
        }), readSource, readSlots)).toBe(false);

        const sourceNode = document.createTextNode('source');
        const slotHost = document.createElement('span');
        node.appendChild(slotHost);
        expect(canKeepTranslationAttempt(node, state({
            mode: 'single',
            phase: 'translated',
            sourceTextNodes: [sourceNode],
            singleTextSlotHosts: [{host: slotHost, source: sourceNode, sourceValue: 'source'}],
        }), readSource, readSlots)).toBe(true);
        expect(canKeepTranslationAttempt(node, state({
            mode: 'single',
            phase: 'translated',
            sourceTextNodes: [sourceNode],
            singleTextSlotHosts: [],
        }), readSource, readSlots)).toBe(false);
        expect(canKeepTranslationAttempt(node, state({phase: 'error'}), readSource, readSlots)).toBe(false);
        expect(readSlots).toHaveBeenCalled();
    });

    it('复用同一 Text、重绑定等价重建 Text，并拒绝数量或来源不一致', () => {
        const {document} = parseHTML('<html><body></body></html>');
        const original = document.createTextNode('source');
        const replacement = document.createTextNode('source');
        const result = {
            sources: ['source'],
            translations: ['译文'],
            nodes: [original],
            slots: [{node: original, text: '译文'}],
        };
        const currentPart = {node: replacement, prefix: '(', source: 'source', suffix: ')'};

        expect(reboundLiveTextResult([original], result, [currentPart])).toEqual({
            nodes: [original],
            slots: [{node: original, text: '译文'}],
        });
        expect(reboundLiveTextResult([replacement], result, [currentPart])).toEqual({
            nodes: [replacement],
            slots: [{node: replacement, text: '(译文)'}],
        });
        expect(reboundLiveTextResult([replacement], {...result, translations: []}, [currentPart])).toEqual({
            nodes: [replacement],
            slots: [{node: replacement, text: '(source)'}],
        });
        expect(reboundLiveTextResult([], result, [])).toBeNull();
        expect(reboundLiveTextResult([replacement], result, [{...currentPart, source: 'other'}])).toBeNull();
    });
});
