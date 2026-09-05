import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {describe, expect, it, vi} from 'vitest';
import {
    collectLiveTranslationTextSlots,
    createTranslationCore,
    TranslationCandidateCore,
} from '@/src/core/translation/public';
import {
    classifyGenericCandidate,
    findTranslationControlOwner,
    getDirectInlineRuns,
} from '@/src/core/translation/layout';
import {maxComposedAncestorDepth} from '@/src/core/translation/dom';
import {
    beginTranslation,
    markTranslationComplete,
    restoreTranslation,
    setLiveTranslationSourceSnapshot,
    setTextSlotsApplied,
} from '@/src/features/full-page-translation/content/state';

const fixtureHTML = readFileSync(new URL('./fixtures/translation-pages/button-controls.html', import.meta.url), 'utf8');

function fixture(url = 'https://example.test/controls') {
    const {document, window} = parseHTML(fixtureHTML);
    const core = createTranslationCore({url: new URL(url)});
    Object.defineProperty(window, 'getComputedStyle', {
        configurable: true,
        value: (element: Element) => ({
            display: element.getAttribute('data-display') ??
                (['SPAN', 'A'].includes(element.tagName) ? 'inline' : 'block'),
            getPropertyValue: () => '',
        }),
    });
    return {document, window, core};
}

describe('交互控件翻译所有权回归', () => {
    it.each(['https://example.test/controls', 'https://github.com/FluentRead/FluentRead/pull/451'])(
        '%s 的嵌套 flex/grid 标签属于同一个单行控件候选', (url) => {
            const {document, core} = fixture(url);
            const candidates = core.discover(document);
            for (const id of ['merge-button', 'save-button', 'menu-action', 'split-button']) {
                const owner = document.getElementById(id)!;
                expect(candidates.filter((candidate) => owner.contains(candidate.element)))
                    .toEqual([expect.objectContaining({element: owner, kind: 'control', reason: 'generic-control'})]);
                expect(core.resolve(owner)).toMatchObject({element: owner, kind: 'control'});
                for (const label of owner.querySelectorAll('[data-display]')) {
                    expect(core.inspect(label).candidate).toBeNull();
                    expect(core.resolve(label.firstChild)).toMatchObject({element: owner, kind: 'control'});
                    expect(getDirectInlineRuns(label)).toEqual([]);
                }
                expect(getDirectInlineRuns(owner)).toEqual([]);
            }
            expect(candidates.find((candidate) => candidate.element.id === 'prose')?.kind).toBe('content');
            expect(candidates.some((candidate) => candidate.element.id === 'merge-menu')).toBe(false);
        },
    );

    it('按钮的译文复用文本节点，保留图标、点击、计数和恢复后再次翻译', () => {
        const {document, window, core} = fixture();
        const owner = document.getElementById('save-button')!;
        const originalHTML = owner.innerHTML;
        const originalNodes = Array.from(owner.querySelectorAll('*'));
        const click = vi.fn();
        owner.addEventListener('click', click);
        const candidate = core.resolve(owner.querySelector('.button-label'))!;
        expect(candidate.kind).toBe('control');

        for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
            const parts = collectLiveTranslationTextSlots(candidate.element, core.shouldStayOriginal);
            expect(parts.map((part) => part.source)).toEqual(['Save changes']);
            const nodes = parts.map((part) => part.node);
            const attempt = beginTranslation(candidate.element, 'bilingual', candidate.kind, false, 'Save changes', nodes)!;
            expect(markTranslationComplete(candidate.element, attempt.state, attempt.generation, false)).toBe(true);
            setLiveTranslationSourceSnapshot(candidate.element, nodes);
            parts[0]!.node.nodeValue = '保存更改';
            setTextSlotsApplied(candidate.element, nodes);

            expect(owner.querySelector('.button-label')?.textContent).toBe('保存更改');
            expect(owner.querySelector('.fluent-read-bilingual-content')).toBeNull();
            expect(Array.from(owner.querySelectorAll('*'))).toEqual(originalNodes);
            expect(owner.querySelector('[aria-hidden]')?.textContent).toBe('✓');
            expect(owner.getAttribute('href')).toBe('#saved');
            owner.querySelector('.button-label')!.dispatchEvent(new window.Event('click', {bubbles: true}));
            expect(click).toHaveBeenCalledTimes(attemptIndex + 1);
            restoreTranslation(candidate.element);
            expect(owner.innerHTML).toBe(originalHTML);
            expect(core.resolve(owner.firstChild)).toMatchObject({element: owner, kind: 'control'});
        }
        const split = document.getElementById('split-button')!;
        expect(collectLiveTranslationTextSlots(split, core.shouldStayOriginal).map((part) => part.source))
            .toEqual(['Review', 'changes']);
        expect(split.querySelector('.badge')?.textContent).toBe('23');
    });

    it('宿主动态添加或移除按钮角色时重新计算标签的所有权', () => {
        const {document, core} = fixture();
        const owner = document.getElementById('menu-action')!;
        const label = owner.firstElementChild!;
        expect(core.resolve(label)?.element).toBe(owner);
        owner.removeAttribute('role');
        expect(core.resolve(label)).toMatchObject({element: label, kind: 'content'});
        owner.setAttribute('role', ' BUTTON ');
        expect(core.discover(owner)).toEqual([expect.objectContaining({element: owner, kind: 'control'})]);
        expect(core.resolve(label)).toMatchObject({element: owner, kind: 'control'});
    });

    it('只重扫新出现的内部标签时仍发现整个控件，并拒绝提升受保护子树', () => {
        const {document, core} = fixture();
        const owner = document.getElementById('merge-button')!;
        const label = owner.querySelector('.button-label')!;
        label.textContent = '';
        expect(core.discover(label)).toEqual([]);
        label.textContent = 'Merge pull request';
        expect(core.discover(label)).toEqual([expect.objectContaining({element: owner, kind: 'control'})]);
        label.setAttribute('translate', 'no');
        expect(core.discover(label)).toEqual([]);
        label.removeAttribute('translate');
        const excluded = new TranslationCandidateCore({adapters: [{
            id: 'blocked-label', matches: () => true,
            decide: (element) => element === label
                ? {kind: 'prune-subtree', reason: 'controlled-label'}
                : {kind: 'pass'},
        }]});
        expect(excluded.discover(label)).toEqual([]);
    });

    it('嵌套操作按钮与外层块级标签分别拥有文本，全文和悬浮都不重复吞并整个卡片', () => {
        const {document, core} = fixture();
        document.body.innerHTML = '<main><div id="card" role="button"><div id="label">Open details</div><button id="menu">More options</button></div></main>';
        const label = document.getElementById('label')!;
        const menu = document.getElementById('menu')!;
        expect(core.discover(document)).toEqual([
            expect.objectContaining({element: label, kind: 'control'}),
            expect.objectContaining({element: menu, kind: 'control'}),
        ]);
        expect(core.resolve(label.firstChild)).toMatchObject({element: label, kind: 'control'});
        expect(core.resolve(menu.firstChild)).toMatchObject({element: menu, kind: 'control'});
        expect(core.resolve(document.getElementById('card'))).toBeNull();
    });

    it('嵌套控件旁的直接文字只物化自己的 control run，保留子按钮原位与图标身份', () => {
        const {document, core} = fixture();
        document.body.innerHTML = '<main><div id="card" role="button">Open details <span aria-hidden="true">★</span><button id="menu">More options</button> now</div></main>';
        const owner = document.getElementById('card')!;
        const menu = document.getElementById('menu')!;
        const icon = owner.querySelector('[aria-hidden]')!;
        const candidates = core.discover(document);
        const runs = candidates.filter((candidate) => candidate.element === owner);
        expect(candidates.filter((candidate) => candidate.element === menu))
            .toEqual([expect.objectContaining({kind: 'control'})]);
        expect(runs).toHaveLength(2);
        for (const run of runs) {
            expect(run.kind).toBe('control');
            expect(run.nodes).not.toContain(menu);
            expect(core.resolve(run.nodes![0])).toMatchObject({element: owner, kind: 'control', nodes: run.nodes});
        }
        const segment = document.createElement('span');
        segment.setAttribute('data-fr-translation-segment', 'true');
        owner.insertBefore(segment, owner.firstChild);
        for (const node of runs[0]!.nodes!) segment.appendChild(node);
        expect(core.resolve(segment.firstChild)).toMatchObject({element: segment, kind: 'control'});
        expect(menu.parentElement).toBe(owner);
        expect(owner.querySelector('[aria-hidden]')).toBe(icon);
        expect(icon.textContent).toBe('★');
    });

    it('异常宽控件的嵌套边界检查有界，避免整体翻译吞并未经检查的子控件', () => {
        const {document} = fixture();
        const owner = document.createElement('button');
        owner.append('Open details');
        for (let index = 0; index < 2049; index += 1) owner.appendChild(document.createElement('span'));
        document.body.appendChild(owner);
        expect(classifyGenericCandidate(owner)).toBeNull();
    });

    it('精确适配器的控件内部标签默认继承 control，并继续遵守排除规则', () => {
        const {document} = fixture();
        const owner = document.getElementById('merge-button')!;
        const label = owner.querySelector('.button-label')!;
        const core = new TranslationCandidateCore({adapters: [{
            id: 'button-labels', matches: () => true,
            decide: (element) => element === label
                ? {kind: 'force-target', reason: 'exact-label'}
                : {kind: 'pass'},
        }]});
        expect(core.inspect(label).candidate).toMatchObject({element: label, kind: 'control'});
        expect(core.discover(owner)).toEqual([expect.objectContaining({element: label, kind: 'control'})]);
        owner.setAttribute('translate', 'no');
        expect(core.discover(owner)).toEqual([]);
        expect(core.resolve(label)).toBeNull();
    });

    it('控件边界沿开放 Shadow DOM 继承，同时限制异常深度', () => {
        const {document} = fixture();
        const owner = document.createElement('div');
        owner.setAttribute('role', 'button');
        document.body.appendChild(owner);
        const shadow = owner.attachShadow({mode: 'open'});
        const label = document.createElement('div');
        label.textContent = 'Open settings';
        shadow.appendChild(label);
        expect(findTranslationControlOwner(label)).toBe(owner);
        expect(classifyGenericCandidate(label)).toBeNull();
        const detached = document.createElement('div');
        expect(findTranslationControlOwner(detached)).toBeNull();
        let nested = owner;
        for (let index = 0; index <= maxComposedAncestorDepth; index += 1) {
            const child = document.createElement('div');
            nested.appendChild(child);
            nested = child;
        }
        expect(findTranslationControlOwner(nested)).toBeNull();
    });
});
