import {parseHTML} from 'linkedom';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/src/services/config/store', () => ({
    config: {style: 1, to: 'zh-Hans'},
}));
vi.mock('@/src/core/config/catalog', () => ({
    options: {styles: []},
}));

import {
    applyTranslationsToSnapshot,
    collectLiveTranslationTextSlots,
    createTranslationSourceSnapshot,
    getCurrentTranslationCore,
} from '@/src/core/translation/public';
import {refreshBilingualTranslationSkeleton} from
    '@/src/features/full-page-translation/content/bilingualReplay';
import {appendBilingualTranslation} from
    '@/src/features/full-page-translation/content/renderer';
import {
    beginTranslation,
    markTranslationComplete,
    restoreAllTranslations,
    setBilingualContent,
    setRenderedStyleAttribute,
    type TranslationState,
} from '@/src/features/full-page-translation/content/state';
import {isTranslationArtifactCurrent} from
    '@/src/features/full-page-translation/content/translationStability';

async function withDocumentRealm<T>(
    document: Document,
    callback: () => T | Promise<T>,
): Promise<T> {
    const realm = document.defaultView as unknown as Record<string, unknown>;
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const realmBindings: Record<string, unknown> = {
        document,
        window: document.defaultView,
        DOMParser: class FixtureDOMParser {
            parseFromString(source: string): Document {
                return parseHTML(`<html><head></head><body>${source}</body></html>`).document;
            }
        },
        Element: realm.Element,
        HTMLElement: realm.HTMLElement,
        MutationObserver: realm.MutationObserver,
        Node: realm.Node,
        ShadowRoot: realm.ShadowRoot,
    };
    const previousDescriptors = new Map<string, PropertyDescriptor | undefined>();

    Object.entries(realmBindings).forEach(([name, value]) => {
        previousDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        if (value !== undefined) {
            Object.defineProperty(globalRecord, name, {
                configurable: true,
                writable: true,
                value,
            });
        }
    });

    try {
        return await callback();
    } finally {
        restoreAllTranslations();
        Object.keys(realmBindings).forEach((name) => {
            const descriptor = previousDescriptors.get(name);
            if (descriptor) Object.defineProperty(globalRecord, name, descriptor);
            else delete globalRecord[name];
        });
    }
}

interface CommittedReplayFixture {
    owner: HTMLElement;
    state: TranslationState;
    wrapper: HTMLElement;
    sources: readonly string[];
    translations: readonly string[];
}

function createCommittedReplayFixture(
    document: Document,
    includeReplay = true,
    allowTopLevelApplicationShell = false,
): CommittedReplayFixture {
    const base = document.createElement('base');
    base.setAttribute('href', 'https://example.com/');
    document.head.appendChild(base);
    document.body.innerHTML = `
        <p id="owner">
            <span id="plain-source">Translate this sentence.</span>
            <a id="source-link" href="https://example.com/before" title="Before">Read the details.</a>
            <code id="source-code">const version = 'before';</code>
            <mark id="source-no-translate" translate="no">Protected copy before.</mark>
            <ruby id="source-math" class="MathJax"><strong>formula before</strong></ruby>
        </p>
    `;
    const owner = document.querySelector<HTMLElement>('#owner')!;
    const core = getCurrentTranslationCore();
    const options = allowTopLevelApplicationShell
        ? {allowTopLevelApplicationShell: true, protectedElement: owner}
        : {protectedElement: owner};
    const snapshot = createTranslationSourceSnapshot(
        owner,
        core.shouldStayOriginal,
        undefined,
        options,
    );
    const liveSlots = collectLiveTranslationTextSlots(
        owner,
        core.shouldStayOriginal,
        undefined,
        options,
    );
    const sources = snapshot.slots.map((slot) => slot.source);
    const translations = Object.freeze(['这句话已翻译。', '阅读最新详情。']);
    expect(sources).toEqual(['Translate this sentence.', 'Read the details.']);

    const attempt = beginTranslation(
        owner,
        'bilingual',
        'content',
        false,
        sources.join(' '),
        liveSlots.map((slot) => slot.node),
        allowTopLevelApplicationShell,
    )!;
    expect(markTranslationComplete(owner, attempt.state, attempt.generation)).toBe(true);
    const translatedHTML = applyTranslationsToSnapshot(snapshot, translations);
    const wrapper = appendBilingualTranslation(owner, translatedHTML, {
        targetLanguage: 'zh-Hans',
        style: 1,
    });
    setBilingualContent(owner, wrapper, includeReplay ? {
        sources,
        translations,
        targetLanguage: 'zh-Hans',
        style: 1,
    } : undefined);
    setRenderedStyleAttribute(owner);

    return {owner, state: attempt.state, wrapper, sources, translations};
}

describe('双语译文骨架重放', () => {
    it('保持同一 wrapper 并用最新安全骨架就地重放原 provider 译文', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        await withDocumentRealm(document, () => {
            const fixture = createCommittedReplayFixture(document);
            const replayTranslations = [...fixture.state.bilingualReplay!.translations];
            const providerTranslations = [...fixture.translations];
            const previousSourceNodes = [...(fixture.state.sourceTextNodes ?? [])];

            const plain = fixture.owner.querySelector<HTMLElement>('#plain-source')!;
            const replacementPlainText = document.createTextNode('Translate this sentence.');
            plain.replaceChildren(replacementPlainText);
            const link = fixture.owner.querySelector<HTMLAnchorElement>('#source-link')!;
            link.setAttribute('href', 'https://example.com/after');
            link.setAttribute('title', 'After');
            fixture.owner.querySelector<HTMLElement>('#source-code')!.textContent =
                "const version = 'after';";
            fixture.owner.querySelector<HTMLElement>('#source-no-translate')!.textContent =
                'Protected copy after.';
            fixture.owner.querySelector<HTMLElement>('#source-math')!.innerHTML =
                '<strong>formula after</strong>';

            expect(refreshBilingualTranslationSkeleton(fixture.owner, fixture.state)).toBe(true);
            expect(fixture.owner.querySelector(
                ':scope > .fluent-read-bilingual-content[data-fr-translation-owned="true"]',
            )).toBe(fixture.wrapper);
            expect(fixture.wrapper.getAttribute('translate')).toBe('no');
            expect(fixture.wrapper.querySelector('code')?.textContent).toBe("const version = 'after';");
            expect(fixture.wrapper.querySelector('mark')?.textContent).toBe('Protected copy after.');
            expect(fixture.wrapper.querySelector('ruby strong')?.textContent).toBe('formula after');
            expect(fixture.wrapper.querySelector('a')?.getAttribute('href'))
                .toBe('https://example.com/after');
            expect(fixture.wrapper.querySelector('a')?.getAttribute('title')).toBe('After');
            fixture.translations.forEach((translation) => {
                expect(fixture.wrapper.textContent).toContain(translation);
            });
            expect(fixture.translations).toEqual(providerTranslations);
            expect(fixture.state.bilingualReplay?.sources).toEqual(fixture.sources);
            expect(fixture.state.bilingualReplay?.translations).toEqual(replayTranslations);
            expect(fixture.state.sourceTextNodes).toContain(replacementPlainText);
            expect(fixture.state.sourceTextNodes?.[0]).toBe(replacementPlainText);
            expect(fixture.state.sourceTextNodes?.[0]).not.toBe(previousSourceNodes[0]);
            expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(true);
        });
    });

    it('没有 replay 快照时拒绝刷新', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        await withDocumentRealm(document, () => {
            const fixture = createCommittedReplayFixture(document, false);
            const previousOuterHTML = fixture.wrapper.outerHTML;

            expect(refreshBilingualTranslationSkeleton(fixture.owner, fixture.state)).toBe(false);
            expect(fixture.wrapper.outerHTML).toBe(previousOuterHTML);
            expect(fixture.state.bilingualReplay).toBeUndefined();
        });
    });

    it('允许顶层应用壳时沿用相同保护边界重放', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        await withDocumentRealm(document, () => {
            const fixture = createCommittedReplayFixture(document, true, true);

            expect(fixture.state.allowTopLevelApplicationShell).toBe(true);
            expect(refreshBilingualTranslationSkeleton(fixture.owner, fixture.state)).toBe(true);
            expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(true);
        });
    });

    it('当前 wrapper 工件不完整时拒绝重放', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        await withDocumentRealm(document, () => {
            const fixture = createCommittedReplayFixture(document);
            fixture.wrapper.remove();

            expect(refreshBilingualTranslationSkeleton(fixture.owner, fixture.state)).toBe(false);
            expect(fixture.wrapper.parentNode).toBeNull();
            expect(fixture.state.bilingualReplay?.translations).toEqual(fixture.translations);
        });
    });

    it('provider source slots 发生变化时拒绝复用旧译文', async () => {
        const {document} = parseHTML('<html><body></body></html>');
        await withDocumentRealm(document, () => {
            const fixture = createCommittedReplayFixture(document);
            const previousOuterHTML = fixture.wrapper.outerHTML;
            const previousSourceNodes = fixture.state.sourceTextNodes;
            fixture.owner.querySelector<HTMLElement>('#plain-source')!.textContent =
                'This is a different provider source.';

            expect(refreshBilingualTranslationSkeleton(fixture.owner, fixture.state)).toBe(false);
            expect(fixture.wrapper.outerHTML).toBe(previousOuterHTML);
            expect(fixture.state.sourceTextNodes).toBe(previousSourceNodes);
            expect(fixture.state.bilingualReplay?.translations).toEqual(fixture.translations);
        });
    });
});
