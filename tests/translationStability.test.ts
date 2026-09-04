import {describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {
    canKeepTranslationAttempt,
    hasCurrentTranslationSource,
    isOwnCurrentArtifactAddition,
    isOwnStateArtifactMutation,
    isOwnSingleTextSlotMove,
    isTranslationArtifact,
    isTranslationArtifactCurrent,
    mutationTouchesCurrentTranslationArtifact,
    reboundLiveTextResult,
    statefulSourceAndTextSlotsAreCurrent,
} from '@/src/features/full-page-translation/content/translationStability';
import {
    getTranslationOverflowGenerationIdentity,
    getTranslationSourceStructureSignature,
    type TranslationState,
} from '@/src/features/full-page-translation/content/state';

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

function childListRecord(
    target: Node,
    addedNodes: readonly Node[] = [],
    removedNodes: readonly Node[] = [],
): MutationRecord {
    return {
        type: 'childList',
        target,
        addedNodes: addedNodes as unknown as NodeList,
        removedNodes: removedNodes as unknown as NodeList,
    } as MutationRecord;
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
        bilingual.className = 'fluent-read-bilingual-content';
        bilingual.setAttribute('data-fr-translation-owned', 'true');
        bilingual.textContent = '译文';
        node.appendChild(bilingual);
        const bilingualState = state({
            phase: 'translated',
            bilingualContent: bilingual,
            bilingualHTML: '译文',
            bilingualOuterHTML: bilingual.outerHTML,
        });
        expect(isTranslationArtifactCurrent(node, bilingualState)).toBe(true);
        expect(canKeepTranslationAttempt(node, bilingualState, readSource, readSlots)).toBe(true);
        expect(canKeepTranslationAttempt(node, state({
            phase: 'translated',
            bilingualContent: bilingual,
            bilingualHTML: '译文',
            bilingualOuterHTML: bilingual.outerHTML,
        }), readSource, readSlots, false)).toBe(false);
        expect(canKeepTranslationAttempt(node, state({
            phase: 'translated',
        }), readSource, readSlots)).toBe(false);
        const duplicate = bilingual.cloneNode(true) as HTMLElement;
        node.appendChild(duplicate);
        expect(isTranslationArtifactCurrent(node, bilingualState)).toBe(false);
        duplicate.remove();
        bilingual.textContent = '被站点篡改';
        expect(isTranslationArtifactCurrent(node, bilingualState)).toBe(false);
        bilingual.textContent = '译文';
        bilingual.classList.add('site-tampered');
        expect(isTranslationArtifactCurrent(node, bilingualState)).toBe(false);
        bilingual.classList.remove('site-tampered');

        const sourceNode = document.createTextNode('source');
        const slotHost = document.createElement('span');
        slotHost.appendChild(sourceNode);
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

        expect(isTranslationArtifactCurrent(node, state({
            kind: 'control',
            phase: 'translated',
            textSlotsApplied: true,
        }))).toBe(true);
        expect(isTranslationArtifactCurrent(node, state({
            mode: 'single',
            kind: 'control',
            phase: 'translated',
            textSlotsApplied: false,
        }))).toBe(false);
        expect(readSlots).toHaveBeenCalled();
    });

    it('完整 outerHTML 快照会拒绝 wrapper 任一展示属性被篡改', () => {
        const {document} = parseHTML('<html><body><p>source</p></body></html>');
        const node = document.querySelector('p') as HTMLElement;
        const bilingual = document.createElement('span');
        bilingual.className = 'fluent-read-bilingual-content baseline-style';
        bilingual.setAttribute('data-fr-translation-owned', 'true');
        bilingual.setAttribute('style', 'color: inherit');
        bilingual.setAttribute('lang', 'zh-CN');
        bilingual.setAttribute('dir', 'ltr');
        bilingual.setAttribute('translate', 'no');
        bilingual.textContent = '译文';
        node.appendChild(bilingual);
        const bilingualState = state({
            phase: 'translated',
            bilingualContent: bilingual,
            bilingualHTML: bilingual.innerHTML,
            bilingualOuterHTML: bilingual.outerHTML,
        });

        expect(isTranslationArtifactCurrent(node, bilingualState)).toBe(true);
        const mutations = [
            ['class', 'fluent-read-bilingual-content baseline-style site-tampered'],
            ['style', 'color: red'],
            ['lang', 'fr'],
            ['dir', 'rtl'],
            ['translate', 'yes'],
        ] as const;
        mutations.forEach(([name, tamperedValue]) => {
            const originalValue = bilingual.getAttribute(name)!;
            bilingual.setAttribute(name, tamperedValue);
            expect(isTranslationArtifactCurrent(node, bilingualState), `${name} 篡改`).toBe(false);
            bilingual.setAttribute(name, originalValue);
            expect(isTranslationArtifactCurrent(node, bilingualState), `${name} 恢复`).toBe(true);
        });
    });

    it('双语仅在语义与精确原文结构一致时重绑文本节点', () => {
        const {document} = parseHTML('<html><body><p><span>source</span></p></body></html>');
        const node = document.querySelector('p') as HTMLElement;
        const originalText = node.querySelector('span')!.firstChild as Text;
        const current = state({
            phase: 'translated',
            sourceText: 'source',
            sourceHTML: node.innerHTML,
            sourceTextNodes: [originalText],
        });

        expect(statefulSourceAndTextSlotsAreCurrent(node, current)).toBe(true);
        expect(current.sourceTextNodes).toEqual([originalText]);

        const replacement = document.createTextNode('source');
        originalText.replaceWith(replacement);
        expect(statefulSourceAndTextSlotsAreCurrent(node, current)).toBe(true);
        expect(current.sourceTextNodes).toEqual([replacement]);

        const stateWithoutCapturedNodes = state({
            phase: 'translated',
            sourceText: 'source',
            sourceHTML: node.innerHTML,
            sourceTextNodes: undefined,
            allowTopLevelApplicationShell: true,
        });
        expect(statefulSourceAndTextSlotsAreCurrent(node, stateWithoutCapturedNodes)).toBe(true);
        expect(stateWithoutCapturedNodes.sourceTextNodes).toEqual([replacement]);

        replacement.replaceWith(document.createElement('strong'));
        node.querySelector('strong')!.textContent = 'source';
        expect(statefulSourceAndTextSlotsAreCurrent(node, current)).toBe(false);

        node.querySelector('strong')!.textContent = 'changed';
        expect(statefulSourceAndTextSlotsAreCurrent(node, state({
            phase: 'translated',
            sourceText: 'source',
            sourceHTML: node.innerHTML,
        }))).toBe(false);
    });

    it('结构签名忽略 hover 展示属性，但拒绝译文骨架内容或链接变化', () => {
        const {document} = parseHTML(`
            <html><body><p id="owner"><a id="link" href="/before">source</a><span class="MathJax">render 1</span></p></body></html>
        `);
        const node = document.querySelector<HTMLElement>('#owner')!;
        const link = document.querySelector<HTMLAnchorElement>('#link')!;
        const source = link.firstChild as Text;
        const current = state({
            phase: 'translated',
            sourceText: 'source',
            sourceHTML: node.innerHTML,
            sourceTextNodes: [source],
            sourceStructureSignature: getTranslationSourceStructureSignature(node),
        });

        node.className = 'hovered';
        node.style.color = 'red';
        expect(statefulSourceAndTextSlotsAreCurrent(node, current)).toBe(true);
        expect(current.sourceTextNodes).toEqual([source]);

        node.querySelector<HTMLElement>('.MathJax')!.textContent = 'render 2';
        expect(statefulSourceAndTextSlotsAreCurrent(node, current)).toBe(false);
        node.querySelector<HTMLElement>('.MathJax')!.textContent = 'render 1';
        expect(statefulSourceAndTextSlotsAreCurrent(node, current)).toBe(true);

        const replacementLink = document.createElement('a');
        replacementLink.href = '/after';
        replacementLink.appendChild(source);
        link.replaceWith(replacementLink);
        expect(statefulSourceAndTextSlotsAreCurrent(node, current)).toBe(false);
    });

    it('有界结构快照溢出时同 owner 保持稳定，但真实 mutation 或 Text 换代立即失效', () => {
        const {document} = parseHTML('<html><body><div id="owner"></div></body></html>');
        const node = document.querySelector<HTMLElement>('#owner')!;
        let deepest = node;
        for (let depth = 0; depth < 140; depth += 1) {
            const child = document.createElement('span');
            deepest.appendChild(child);
            deepest = child;
        }
        const source = document.createTextNode('source');
        deepest.appendChild(source);
        const current = state({
            phase: 'translated',
            sourceText: 'source',
            sourceHTML: node.innerHTML,
            sourceTextNodes: [source],
            sourceStructureSignature: getTranslationSourceStructureSignature(node),
            sourceOverflowGenerationIdentity: getTranslationOverflowGenerationIdentity(node),
        });

        expect(current.sourceStructureSignature).toBe('overflow');
        expect(getTranslationOverflowGenerationIdentity(node)).toBe(current.sourceOverflowGenerationIdentity);
        const cloneSpy = vi.spyOn(node, 'cloneNode');
        for (let check = 0; check < 20; check += 1) {
            expect(statefulSourceAndTextSlotsAreCurrent(node, current)).toBe(true);
        }
        expect(cloneSpy).not.toHaveBeenCalled();
        expect(statefulSourceAndTextSlotsAreCurrent(node, {
            ...current,
            sourceTextNodes: undefined,
        })).toBe(true);

        current.sourceStructureDirty = true;
        expect(statefulSourceAndTextSlotsAreCurrent(node, current)).toBe(false);

        current.sourceStructureDirty = false;
        const replacementSource = document.createTextNode('source');
        source.replaceWith(replacementSource);
        expect(statefulSourceAndTextSlotsAreCurrent(node, current)).toBe(true);
        expect(current.sourceTextNodes).toEqual([replacementSource]);

        replacementSource.data = 'changed';
        expect(statefulSourceAndTextSlotsAreCurrent(node, current)).toBe(false);
    });

    it('校验仅译文与控件文本槽的节点身份和译文值', () => {
        const {document} = parseHTML('<html><body><p><span>source</span></p></body></html>');
        const node = document.querySelector('p') as HTMLElement;
        const host = node.querySelector('span') as HTMLElement;
        const source = host.firstChild as Text;
        const slotState = state({
            mode: 'single',
            phase: 'translated',
            sourceTextNodes: [source],
            singleTextSlotHosts: [{host, source, sourceValue: 'source'}],
        });

        expect(statefulSourceAndTextSlotsAreCurrent(node, slotState)).toBe(true);
        expect(statefulSourceAndTextSlotsAreCurrent(node, {
            ...slotState,
            sourceTextNodes: undefined,
        })).toBe(false);

        const translatedValues = new WeakMap<Text, string>([[source, 'source']]);
        const controlState = state({
            mode: 'single',
            kind: 'control',
            phase: 'translated',
            sourceTextNodes: [source],
            translatedTextNodes: [source],
            textSlotsApplied: true,
            translatedTextValues: translatedValues,
        });
        expect(statefulSourceAndTextSlotsAreCurrent(node, controlState)).toBe(true);
        translatedValues.set(source, 'different');
        expect(statefulSourceAndTextSlotsAreCurrent(node, controlState)).toBe(false);
        expect(statefulSourceAndTextSlotsAreCurrent(node, {
            ...controlState,
            translatedTextValues: undefined,
        })).toBe(false);

        const button = document.createElement('button');
        button.innerHTML = '<span aria-hidden="true">★</span><span>保存更改</span>';
        document.body.appendChild(button);
        const buttonText = button.lastElementChild!.firstChild as Text;
        expect(statefulSourceAndTextSlotsAreCurrent(button, state({
            mode: 'single',
            kind: 'control',
            phase: 'translated',
            sourceTextNodes: [buttonText],
            translatedTextNodes: [buttonText],
            textSlotsApplied: true,
            translatedTextValues: new WeakMap([[buttonText, '保存更改']]),
        }))).toBe(true);

        const singleState = state({
            mode: 'single',
            phase: 'translated',
            sourceTextNodes: [source],
            translatedTextNodes: [source],
            textSlotsApplied: true,
            translatedTextValues: new WeakMap([[source, 'source']]),
        });
        expect(statefulSourceAndTextSlotsAreCurrent(node, singleState)).toBe(true);
        expect(statefulSourceAndTextSlotsAreCurrent(node, state({
            mode: 'single',
            sourceText: 'source',
            sourceTextNodes: [source],
        }))).toBe(true);
        expect(statefulSourceAndTextSlotsAreCurrent(node, state({
            mode: 'single',
            sourceTextNodes: undefined,
        }))).toBe(false);
    });

    it('只接受当前控件 generation 的 spinner 事务与最终 Text 写入', () => {
        const {document} = parseHTML('<html><body><button>Save changes</button><aside></aside></body></html>');
        const button = document.querySelector('button') as HTMLElement;
        const other = document.querySelector('aside') as HTMLElement;
        const source = button.firstChild as Text;
        const spinner = document.createElement('span');
        spinner.setAttribute('data-fr-translation-owned', 'true');
        button.appendChild(spinner);
        const loading = state({
            kind: 'control', sourceText: 'Save changes', sourceTextNodes: [source], spinner,
        });

        expect(isOwnStateArtifactMutation(childListRecord(button, [spinner]), button, loading)).toBe(true);
        expect(isOwnStateArtifactMutation(childListRecord(button, [spinner], [source]), button, loading)).toBe(false);
        expect(isOwnStateArtifactMutation(childListRecord(other, [spinner]), button, loading)).toBe(false);
        expect(isOwnStateArtifactMutation(childListRecord(button, [other]), button, loading)).toBe(false);
        expect(isOwnStateArtifactMutation(childListRecord(button, [spinner]), button,
            {...loading, kind: 'content'})).toBe(true);

        spinner.remove();
        source.data = '保存更改';
        const translated = state({
            kind: 'control', phase: 'translated', settledSpinner: spinner,
            sourceTextNodes: [source], translatedTextNodes: [source], textSlotsApplied: true,
            translatedTextValues: new WeakMap([[source, '保存更改']]),
        });
        const characterMutation = {
            type: 'characterData', target: source,
            addedNodes: [] as unknown as NodeList,
            removedNodes: [] as unknown as NodeList,
        } as unknown as MutationRecord;
        expect(isOwnStateArtifactMutation(characterMutation, button, translated)).toBe(true);
        translated.translatedTextValues!.set(source, '被篡改');
        expect(isOwnStateArtifactMutation(characterMutation, button, translated)).toBe(false);
        expect(isOwnStateArtifactMutation(childListRecord(button, [], [spinner]), button, translated)).toBe(true);
        expect(isOwnStateArtifactMutation(childListRecord(button), button, translated)).toBe(false);
        expect(isOwnStateArtifactMutation(childListRecord(other, [], [spinner]), button, translated)).toBe(false);
        expect(isOwnStateArtifactMutation({...characterMutation, type: 'attributes'} as MutationRecord,
            button, translated)).toBe(false);
        expect(isOwnStateArtifactMutation(characterMutation, button, {...translated, phase: 'error'})).toBe(false);

        expect(isOwnStateArtifactMutation(
            childListRecord(button, [], [spinner]),
            button,
            {...translated, kind: 'content'},
        )).toBe(true);
    });

    it('只把当前 single-slot host 和完整双语 wrapper 识别为自身新增工件', () => {
        const {document} = parseHTML('<html><body><p>source</p></body></html>');
        const owner = document.querySelector<HTMLElement>('p')!;
        const source = owner.firstChild as Text;
        const slotHost = document.createElement('span');
        slotHost.appendChild(source);
        owner.appendChild(slotHost);
        const wrapper = document.createElement('span');
        wrapper.className = 'fluent-read-bilingual-content';
        wrapper.setAttribute('data-fr-translation-owned', 'true');
        wrapper.textContent = '译文';
        owner.appendChild(wrapper);
        const current = state({
            phase: 'translated',
            sourceTextNodes: [source],
            singleTextSlotHosts: [{host: slotHost, source, sourceValue: 'source'}],
            bilingualContent: wrapper,
            bilingualOuterHTML: wrapper.outerHTML,
        });

        expect(isOwnCurrentArtifactAddition(childListRecord(owner, [slotHost]), current)).toBe(true);
        expect(isOwnCurrentArtifactAddition(childListRecord(owner, [wrapper]), current)).toBe(true);
        wrapper.setAttribute('lang', 'ja');
        expect(isOwnCurrentArtifactAddition(childListRecord(owner, [wrapper]), current)).toBe(false);
        expect(isOwnCurrentArtifactAddition(
            childListRecord(owner, [document.createElement('aside')]),
            current,
        )).toBe(false);
        expect(isOwnCurrentArtifactAddition(childListRecord(owner), current)).toBe(false);
    });

    it('识别当前译文工件 mutation，并严格识别自身 single-slot 搬移', () => {
        const {document} = parseHTML('<html><body><p><span>source</span></p></body></html>');
        const node = document.querySelector('p') as HTMLElement;
        const host = node.querySelector('span') as HTMLElement;
        const source = host.firstChild as Text;
        const emptyState = state();
        expect(mutationTouchesCurrentTranslationArtifact(childListRecord(node), emptyState)).toBe(false);

        const artifact = document.createElement('span');
        artifact.setAttribute('data-fr-translation-owned', 'true');
        const child = document.createElement('em');
        artifact.appendChild(child);
        node.appendChild(artifact);
        const artifactState = state({spinner: artifact});
        expect(mutationTouchesCurrentTranslationArtifact(childListRecord(artifact), artifactState)).toBe(true);
        expect(mutationTouchesCurrentTranslationArtifact(childListRecord(child), artifactState)).toBe(true);
        expect(mutationTouchesCurrentTranslationArtifact(childListRecord(node, [artifact]), artifactState)).toBe(true);
        expect(mutationTouchesCurrentTranslationArtifact(childListRecord(node, [node]), artifactState)).toBe(true);
        expect(mutationTouchesCurrentTranslationArtifact(
            childListRecord(node, [document.createTextNode('other')]),
            artifactState,
        )).toBe(false);

        const slotState = state({
            mode: 'single',
            sourceTextNodes: [source],
            singleTextSlotHosts: [{host, source, sourceValue: 'source'}],
        });
        expect(isOwnSingleTextSlotMove(
            childListRecord(host, [source], [source]),
            node,
            slotState,
        )).toBe(true);
        expect(isOwnSingleTextSlotMove(childListRecord(host), node, slotState)).toBe(false);
        expect(isOwnSingleTextSlotMove(
            {...childListRecord(host, [source]), type: 'attributes'} as MutationRecord,
            node,
            slotState,
        )).toBe(false);
        expect(isOwnSingleTextSlotMove(childListRecord(host, [source]), node, state())).toBe(false);
        expect(isOwnSingleTextSlotMove(
            childListRecord(source, [source]),
            node,
            slotState,
        )).toBe(false);
        expect(isOwnSingleTextSlotMove(
            childListRecord(node, [source]),
            node,
            slotState,
        )).toBe(false);
        expect(isOwnSingleTextSlotMove(
            childListRecord(host, [document.createTextNode('other')]),
            node,
            slotState,
        )).toBe(false);
    });

    it('仅把标记工件及其后代当作 FluentRead 产物', () => {
        const {document} = parseHTML(`
            <html><body>
                <span id="segment" data-fr-translation-segment="true"><em id="child">translated</em></span>
                <span id="owned" data-fr-translation-owned="true">owned</span>
                <span id="plain">plain</span>
            </body></html>
        `);
        const segment = document.querySelector('#segment')!;
        const child = document.querySelector('#child')!;
        const ownedText = document.querySelector('#owned')!.firstChild!;
        const plain = document.querySelector('#plain')!;

        expect(isTranslationArtifact(segment)).toBe(true);
        expect(isTranslationArtifact(child)).toBe(true);
        expect(isTranslationArtifact(ownedText)).toBe(true);
        expect(isTranslationArtifact(plain)).toBe(false);
        expect(isTranslationArtifact(document.createTextNode('detached'))).toBe(false);
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
