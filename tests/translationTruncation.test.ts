import {parseHTML} from 'linkedom';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/src/services/config/store', () => ({
    config: {style: 1, to: 'zh-Hans'},
}));
vi.mock('@/src/core/config/catalog', () => ({
    options: {styles: []},
}));

import {
    findTranslationTruncationAncestors,
    hasActiveTranslationLineClamp,
    hasActiveTranslationTruncation,
    translationTruncationStyleOverrides,
} from '@/src/core/translation/public';
import {config} from '@/src/services/config/store';
import {options} from '@/src/core/config/catalog';
import {
    acquireTranslationLayoutOverride,
    beginTranslation,
    getTranslationState,
    hasTranslationLayoutOverride,
    isTranslationLayoutOverrideMutation,
    markTranslationComplete,
    reconcileTranslationLayoutOverrides,
    restoreTranslation,
    setBilingualContent,
    setBilingualOwnerRemountHandler,
    setSingleTextSlotHosts,
} from '@/src/features/full-page-translation/content/state';
import {transferEquivalentBilingualOwners} from
    '@/src/features/full-page-translation/content/bilingualRemount';
import {ensureTranslationTruncationLayout} from '@/src/features/full-page-translation/content/layout';
import {
    appendBilingualTranslation,
    appendSingleTranslationSlots,
} from '@/src/features/full-page-translation/content/renderer';
import {
    consumeOrphanedOwnerClassMutation,
    isTextEquivalentHostReplacement,
    normalizeOrphanedTranslationArtifacts,
} from
    '@/src/features/full-page-translation/content/orphanArtifacts';

function openRouterFixture() {
    const {document} = parseHTML(`
        <html><body>
            <div id="ordinary-overflow">
                <div id="clamp">
                    <div class="prose"><p id="first">A long model description for the first card.</p></div>
                    <p id="second">A second translated paragraph sharing the same clamp.</p>
                </div>
            </div>
        </body></html>
    `);
    const clamp = document.querySelector<HTMLElement>('#clamp')!;
    const ordinary = document.querySelector<HTMLElement>('#ordinary-overflow')!;
    const first = document.querySelector<HTMLElement>('#first')!;
    const second = document.querySelector<HTMLElement>('#second')!;
    const getComputedStyle = (element: Element) => {
        const lineClamp = element === clamp ? '2' : 'none';
        return {
            webkitLineClamp: lineClamp,
            getPropertyValue: (property: string) =>
                property === '-webkit-line-clamp' || property === 'line-clamp' ? lineClamp : '',
        } as unknown as CSSStyleDeclaration;
    };
    Object.defineProperty(document.defaultView, 'getComputedStyle', {
        configurable: true,
        value: getComputedStyle,
    });
    return {document, clamp, ordinary, first, second};
}

/** linkedom 未实现 CSS priority API，因此显式记录真实的 setProperty 调用。 */
function trackStylePriorities(element: HTMLElement) {
    const style = element.style;
    const priorities = new Map<string, string>();
    const calls: Array<{property: string; value: string; priority: string}> = [];
    const initialStyle = element.getAttribute('style') ?? '';
    initialStyle.split(';').forEach((declaration) => {
        const separator = declaration.indexOf(':');
        if (separator < 0 || !/!important\s*$/iu.test(declaration)) return;
        priorities.set(declaration.slice(0, separator).trim().toLowerCase(), 'important');
    });
    const originalSetProperty = style.setProperty.bind(style);
    const originalRemoveProperty = style.removeProperty.bind(style);

    Object.defineProperties(style, {
        getPropertyPriority: {
            configurable: true,
            value: (property: string) => priorities.get(property.toLowerCase()) ?? '',
        },
        setProperty: {
            configurable: true,
            value: (property: string, value: string, priority = '') => {
                const normalizedPriority = priority.toLowerCase();
                calls.push({property, value, priority: normalizedPriority});
                originalSetProperty(property, value);
                if (normalizedPriority) priorities.set(property.toLowerCase(), normalizedPriority);
                else priorities.delete(property.toLowerCase());
            },
        },
        removeProperty: {
            configurable: true,
            value: (property: string) => {
                priorities.delete(property.toLowerCase());
                return originalRemoveProperty(property);
            },
        },
    });

    return {
        calls,
        getPriority: (property: string) => priorities.get(property.toLowerCase()) ?? '',
    };
}

async function flushMutationObservers(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
}

async function withDocumentRealm<T>(
    document: Document,
    callback: () => Promise<T>,
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
        Object.keys(realmBindings).forEach((name) => {
            const descriptor = previousDescriptors.get(name);
            if (descriptor) Object.defineProperty(globalRecord, name, descriptor);
            else delete globalRecord[name];
        });
    }
}

function commitBilingualTranslation(owner: HTMLElement): HTMLElement {
    const attempt = beginTranslation(owner, 'bilingual')!;
    attempt.state.phase = 'translated';
    expect(ensureTranslationTruncationLayout(owner)).toBe(true);

    const wrapper = owner.ownerDocument.createElement('span');
    wrapper.className = 'fluent-read-bilingual-content';
    wrapper.setAttribute('data-fr-translation-owned', 'true');
    wrapper.textContent = 'Translated text.';
    owner.appendChild(wrapper);
    setBilingualContent(owner, wrapper);
    return wrapper;
}

function dynamicClampFixture() {
    const {document} = parseHTML(`
        <html><body>
            <div id="late-clamp"><p id="owner">A translated paragraph.</p></div>
        </body></html>
    `);
    const clamp = document.querySelector<HTMLElement>('#late-clamp')!;
    const owner = document.querySelector<HTMLElement>('#owner')!;
    Object.defineProperty(document.defaultView, 'getComputedStyle', {
        configurable: true,
        value: (element: Element) => {
            const inlineClamp = (element as HTMLElement).style?.getPropertyValue('-webkit-line-clamp') ?? '';
            const lineClamp = inlineClamp === 'unset'
                ? 'none'
                : inlineClamp || (element === clamp && clamp.classList.contains('line-clamp-2') ? '2' : 'none');
            return {
                webkitLineClamp: lineClamp,
                getPropertyValue: (property: string) =>
                    property === '-webkit-line-clamp' || property === 'line-clamp' ? lineClamp : '',
            } as unknown as CSSStyleDeclaration;
        },
    });
    return {document, clamp, owner};
}

describe('translation truncation layout', () => {
    it('清理以产物自身为 root 的直属孤儿，并忽略无 HTML owner 的 SVG 产物', async () => {
        const {document} = parseHTML('<html><body></body></html>');

        await withDocumentRealm(document, async () => {
            const artifactClasses = [
                'fluent-read-bilingual-content',
                'fluent-read-loading',
                'fluent-read-retry-wrapper',
            ];
            let detachedArtifact: HTMLElement | undefined;
            artifactClasses.forEach((artifactClass, index) => {
                const owner = document.createElement('p');
                owner.className = `${index === 0 ? 'host-class ' : ''}fluent-read-bilingual fluent-read-failure`;
                const artifact = document.createElement('span');
                artifact.className = artifactClass;
                artifact.setAttribute('data-fr-translation-owned', 'true');
                owner.appendChild(artifact);
                document.body.appendChild(owner);

                normalizeOrphanedTranslationArtifacts(artifact);

                expect(artifact.isConnected).toBe(false);
                if (index === 0) expect(owner.className).toBe('host-class');
                else expect(owner.hasAttribute('class')).toBe(false);
                expect(consumeOrphanedOwnerClassMutation(owner)).toBe(true);
                expect(consumeOrphanedOwnerClassMutation(owner)).toBe(false);
                if (index === 0) detachedArtifact = artifact;
            });

            expect(() => normalizeOrphanedTranslationArtifacts(detachedArtifact!)).not.toThrow();

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'fluent-read-bilingual');
            const svgArtifact = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            svgArtifact.setAttribute('class', 'fluent-read-bilingual-content');
            svgArtifact.setAttribute('data-fr-translation-owned', 'true');
            svg.appendChild(svgArtifact);
            document.body.appendChild(svg);

            normalizeOrphanedTranslationArtifacts(svgArtifact);

            expect(svgArtifact.parentElement).toBe(svg);
            expect(svg.getAttribute('class')).toBe('fluent-read-bilingual');
        });
    });

    it('只把同文本 childList 替换识别为页面上下文不变的框架重挂', () => {
        const {document} = parseHTML('<html><body></body></html>');
        const source = document.createElement('p');
        source.textContent = 'Same   source';
        const clone = document.createElement('p');
        clone.textContent = 'Same source';
        const record = (type: MutationRecordType, added: Node[], removed: Node[]) => ({
            type,
            addedNodes: added as unknown as NodeList,
            removedNodes: removed as unknown as NodeList,
        } as MutationRecord);

        expect(isTextEquivalentHostReplacement(record('childList', [clone], [source]))).toBe(false);
        const artifact = document.createElement('span');
        artifact.setAttribute('data-fr-translation-owned', 'true');
        source.appendChild(artifact);
        clone.appendChild(artifact.cloneNode(true));
        expect(isTextEquivalentHostReplacement(record('childList', [clone], [source]))).toBe(true);
        expect(isTextEquivalentHostReplacement(record(
            'childList',
            [clone, document.createComment('new framework marker')],
            [source, document.createComment('old framework marker')],
        ))).toBe(true);
        clone.textContent = 'Changed source';
        expect(isTextEquivalentHostReplacement(record('childList', [clone], [source]))).toBe(false);
        expect(isTextEquivalentHostReplacement(record('childList', [], [source]))).toBe(false);
        expect(isTextEquivalentHostReplacement(record('attributes', [source], [source]))).toBe(false);
    });

    it('finds the active OpenRouter-style ancestor but ignores ordinary overflow clipping', () => {
        const {clamp, ordinary, first} = openRouterFixture();

        expect(hasActiveTranslationLineClamp(clamp)).toBe(true);
        expect(hasActiveTranslationLineClamp(ordinary)).toBe(false);
        expect(findTranslationTruncationAncestors(first)).toEqual([clamp]);
    });

    it('只把真实溢出的 max-height 容器识别为截断，不改写未溢出的普通 owner', () => {
        const {document} = parseHTML('<html><body><div id="owner"></div></body></html>');
        const owner = document.querySelector<HTMLElement>('#owner')!;
        let overflowY = 'hidden';
        let overflow = 'hidden';
        let clientHeight = 40;
        Object.defineProperties(owner, {
            scrollHeight: {configurable: true, get: () => 120},
            clientHeight: {configurable: true, get: () => clientHeight},
        });
        Object.defineProperty(document.defaultView, 'getComputedStyle', {
            configurable: true,
            value: () => ({
                webkitLineClamp: 'none', maxHeight: '40px', overflowY, overflow,
                getPropertyValue: () => '',
            } as unknown as CSSStyleDeclaration),
        });

        expect(hasActiveTranslationTruncation(owner)).toBe(true);
        clientHeight = 120;
        expect(hasActiveTranslationTruncation(owner)).toBe(false);
        clientHeight = 40;
        overflowY = 'visible';
        expect(hasActiveTranslationTruncation(owner)).toBe(false);
        overflowY = 'auto';
        expect(hasActiveTranslationTruncation(owner)).toBe(false);
        overflowY = 'scroll';
        expect(hasActiveTranslationTruncation(owner)).toBe(false);
        overflowY = '';
        overflow = 'hidden';
        expect(hasActiveTranslationTruncation(owner)).toBe(true);
        Object.defineProperty(document.defaultView, 'getComputedStyle', {
            configurable: true,
            value: () => undefined,
        });
        expect(hasActiveTranslationTruncation(owner)).toBe(false);
    });

    it('includes a shared ancestor whose first lease has already removed its computed clamp', () => {
        const {clamp, first} = openRouterFixture();
        Object.defineProperty(first.ownerDocument.defaultView, 'getComputedStyle', {
            configurable: true,
            value: () => ({
                webkitLineClamp: 'none',
                getPropertyValue: () => '',
            } as unknown as CSSStyleDeclaration),
        });

        expect(findTranslationTruncationAncestors(first, (element) => element === clamp)).toEqual([clamp]);
    });

    it('wires OpenRouter ancestor unclamping through the real bilingual renderer', async () => {
        const {document, clamp, first} = openRouterFixture();
        const originalClampStyle = '-webkit-line-clamp: 2 !important; max-height: 40px; color: red;';
        clamp.setAttribute('style', originalClampStyle);
        const priorityTracking = trackStylePriorities(clamp);

        await withDocumentRealm(document, async () => {
            const attempt = beginTranslation(first, 'bilingual')!;
            attempt.state.phase = 'translated';
            const wrapper = appendBilingualTranslation(first, '模型介绍已翻译。');
            setBilingualContent(first, wrapper);

            expect(wrapper.parentElement).toBe(first);
            expect(wrapper.textContent).toBe('模型介绍已翻译。');
            expect(wrapper.getAttribute('translate')).toBe('no');
            expect(first.classList.contains('fluent-read-bilingual')).toBe(false);
            expect(hasTranslationLayoutOverride(first)).toBe(false);
            expect(first.getAttribute('style')).toBeNull();
            expect(hasTranslationLayoutOverride(clamp)).toBe(true);
            expect(clamp.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');
            expect(priorityTracking.calls).toContainEqual({
                property: '-webkit-line-clamp',
                value: 'unset',
                priority: 'important',
            });

            expect(restoreTranslation(first)).toBe(true);
            expect(wrapper.isConnected).toBe(false);
            expect(hasTranslationLayoutOverride(clamp)).toBe(false);
            expect(clamp.getAttribute('style')).toBe(originalClampStyle);
        });
    });

    it('sanitizes renderer HTML while preserving safe inline markup and configured style class', async () => {
        const {document} = parseHTML('<html><body><p id="owner">Readable paragraph.</p></body></html>');
        Object.defineProperty(document, 'baseURI', {
            configurable: true,
            value: 'https://host.example/page',
        });
        const owner = document.querySelector<HTMLElement>('#owner')!;
        const previousConfig = {...config};
        const previousStyles = [...options.styles];

        await withDocumentRealm(document, async () => {
            try {
                Object.assign(config, {style: 7, to: ''});
                options.styles = [
                    {value: 7, class: 'fr-rendered-style'},
                    {value: 7, class: 'fr-disabled-style', disabled: true},
                ] as typeof options.styles;

                const attempt = beginTranslation(owner, 'bilingual')!;
                attempt.state.phase = 'translated';
                const wrapper = appendBilingualTranslation(owner, [
                    '<a href="https://example.com/read" title="Read"><strong>safe link</strong></a>',
                    '<a href="javascript:alert(1)" title="Unsafe">bad href</a>',
                    '<a href="http://[">bad url</a>',
                    '<div>block wrapper <em>keeps text</em></div>',
                    '<script>alert(1)</script>',
                    '<!--ignored comment-->',
                ].join(''));

                expect(wrapper.classList.contains('fr-rendered-style')).toBe(true);
                expect(wrapper.classList.contains('fr-disabled-style')).toBe(false);
                expect(wrapper.lang).toBe('');
                expect(wrapper.querySelector('script')).toBeNull();
                expect(wrapper.querySelector('div')).toBeNull();
                expect(wrapper.textContent).toContain('block wrapper keeps text');

                const links = wrapper.querySelectorAll('a');
                expect(links).toHaveLength(3);
                expect(links[0]!.getAttribute('href')).toBe('https://example.com/read');
                expect(links[0]!.getAttribute('title')).toBe('Read');
                expect(links[1]!.hasAttribute('href')).toBe(false);
                expect(links[1]!.getAttribute('title')).toBe('Unsafe');
                expect(links[2]!.hasAttribute('href')).toBe(false);

                restoreTranslation(owner);
            } finally {
                Object.assign(config, previousConfig);
                options.styles = previousStyles;
            }
        });
    });

    it('双语 renderer 只替换直属 owned 孤儿 wrapper，并保留后代独立译文与非 owned 节点', async () => {
        const {document} = parseHTML(`
            <html><body>
                <p id="owner" class="fluent-read-bilingual">
                    Source text.
                    <span id="direct-owned" class="fluent-read-bilingual-content"
                        data-fr-translation-owned="true" translate="no">旧直属译文</span>
                    <span id="direct-unowned" class="fluent-read-bilingual-content">宿主同名节点</span>
                    <span id="nested-owner">
                        <span id="nested-owned" class="fluent-read-bilingual-content"
                            data-fr-translation-owned="true" translate="no">独立后代译文</span>
                    </span>
                </p>
            </body></html>
        `);
        const owner = document.querySelector<HTMLElement>('#owner')!;
        const directOwned = document.querySelector<HTMLElement>('#direct-owned')!;
        const directUnowned = document.querySelector<HTMLElement>('#direct-unowned')!;
        const nestedOwned = document.querySelector<HTMLElement>('#nested-owned')!;

        await withDocumentRealm(document, async () => {
            const wrapper = appendBilingualTranslation(owner, '新的直属译文');
            const directOwnedWrappers = Array.from(owner.children).filter((child) =>
                child.matches('.fluent-read-bilingual-content[data-fr-translation-owned="true"]'));

            expect(directOwned.isConnected).toBe(false);
            expect(directOwnedWrappers).toEqual([wrapper]);
            expect(wrapper.textContent).toBe('新的直属译文');
            expect(directUnowned.parentElement).toBe(owner);
            expect(nestedOwned.isConnected).toBe(true);
            expect(nestedOwned.textContent).toBe('独立后代译文');
            expect(owner.querySelectorAll(
                '.fluent-read-bilingual-content[data-fr-translation-owned="true"]',
            )).toHaveLength(2);
        });
    });

    it('仅译文 renderer 在闭合 ShadowRoot 显示译文，不改写宿主 textContent', async () => {
        const {document} = parseHTML('<html><body><relative-time id="time">12 hours ago</relative-time></body></html>');
        const owner = document.querySelector<HTMLElement>('#time')!;
        const source = owner.firstChild as Text;

        await withDocumentRealm(document, async () => {
            beginTranslation(owner, 'single', 'content', false, '12 hours ago', [source]);
            const hosts = appendSingleTranslationSlots(owner, [{node: source, text: '12 小时前'}], {
                targetLanguage: 'zh-Hans',
            });
            setSingleTextSlotHosts(owner, hosts);

            expect(hosts).toHaveLength(1);
            expect(hosts[0]!.firstChild).toBe(source);
            expect(hosts[0]!.shadowRoot).toBeNull();
            expect(hosts[0]!.lang).toBe('zh-Hans');
            expect(hosts[0]!.getAttribute('translate')).toBe('no');
            expect(hosts[0]!.getAttribute('aria-label')).toBe('12 小时前');
            expect(owner.textContent).toBe('12 hours ago');
            expect(source.nodeValue).toBe('12 hours ago');

            expect(restoreTranslation(owner)).toBe(true);
            expect(owner.firstChild).toBe(source);
            expect(owner.textContent).toBe('12 hours ago');
        });
    });

    it('仅译文 renderer 原子拒绝失效文本槽，并覆盖空语言回退', async () => {
        const {document} = parseHTML('<html><body><p id="owner">Owner</p><p id="foreign">Foreign</p></body></html>');
        const owner = document.querySelector<HTMLElement>('#owner')!;
        const foreign = document.querySelector<HTMLElement>('#foreign')!;
        const ownerSource = owner.firstChild as Text;
        const foreignSource = foreign.firstChild as Text;
        const detached = document.createTextNode('Detached');
        const previousTo = config.to;

        await withDocumentRealm(document, async () => {
            expect(appendSingleTranslationSlots(owner, [])).toEqual([]);
            expect(appendSingleTranslationSlots(owner, [{node: detached, text: '脱离'}])).toEqual([]);
            expect(appendSingleTranslationSlots(owner, [{node: foreignSource, text: '外部'}])).toEqual([]);
            expect(owner.textContent).toBe('Owner');
            expect(foreign.textContent).toBe('Foreign');

            try {
                config.to = '';
                beginTranslation(owner, 'single', 'content', false, 'Owner', [ownerSource]);
                const hosts = appendSingleTranslationSlots(owner, [{node: ownerSource, text: '所有者'}]);
                setSingleTextSlotHosts(owner, hosts);
                expect(hosts[0]!.lang).toBe('');
                expect(restoreTranslation(owner)).toBe(true);
            } finally {
                config.to = previousTo;
            }
        });
    });

    it('优先使用全文会话冻结的目标语言和译文样式，不受实时配置切换影响', async () => {
        const {document} = parseHTML('<html><body><p id="owner">Readable paragraph.</p></body></html>');
        const owner = document.querySelector<HTMLElement>('#owner')!;
        const previousConfig = {...config};
        const previousStyles = [...options.styles];

        await withDocumentRealm(document, async () => {
            try {
                Object.assign(config, {style: 7, to: 'ja'});
                options.styles = [
                    {value: 7, class: 'fr-live-style'},
                    {value: 9, class: 'fr-session-style'},
                ] as typeof options.styles;

                const wrapper = appendBilingualTranslation(owner, '会话译文', {
                    targetLanguage: 'zh-Hans',
                    style: 9,
                });
                expect(wrapper.lang).toBe('zh-Hans');
                expect(wrapper.classList.contains('fr-session-style')).toBe(true);
                expect(wrapper.classList.contains('fr-live-style')).toBe(false);
            } finally {
                Object.assign(config, previousConfig);
                options.styles = previousStyles;
            }
        });
    });

    it('accepts empty renderer text and ignores parser nodes that are not element or text', async () => {
        const {document} = parseHTML('<html><body><p id="owner">Readable paragraph.</p></body></html>');
        const owner = document.querySelector<HTMLElement>('#owner')!;

        await withDocumentRealm(document, async () => {
            const previousParser = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
            class FixtureDOMParser {
                parseFromString(): Document {
                    return {
                        body: {
                            childNodes: [
                                {nodeType: Node.TEXT_NODE, nodeValue: null},
                                {nodeType: Node.COMMENT_NODE, nodeValue: 'ignored'},
                            ],
                        },
                    } as unknown as Document;
                }
            }

            try {
                Object.defineProperty(globalThis, 'DOMParser', {
                    configurable: true,
                    value: FixtureDOMParser,
                });
                const attempt = beginTranslation(owner, 'bilingual')!;
                attempt.state.phase = 'translated';
                const wrapper = appendBilingualTranslation(owner, '');

                expect(wrapper.textContent).toBe('');
                expect(wrapper.childNodes).toHaveLength(1);
                expect(restoreTranslation(owner)).toBe(true);
            } finally {
                if (previousParser) Object.defineProperty(globalThis, 'DOMParser', previousParser);
                else Reflect.deleteProperty(globalThis, 'DOMParser');
            }
        });
    });

    it('shares one clamp lease and restores its properties only after the last owner exits', () => {
        const {clamp, first, second} = openRouterFixture();
        clamp.setAttribute(
            'style',
            '-webkit-line-clamp: 2 !important; max-height: 40px; color: red;',
        );
        const firstAttempt = beginTranslation(first, 'bilingual')!;
        const secondAttempt = beginTranslation(second, 'bilingual')!;

        expect(acquireTranslationLayoutOverride(
            first,
            clamp,
            translationTruncationStyleOverrides,
        )).toBe(true);
        expect(clamp.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');
        expect(isTranslationLayoutOverrideMutation(clamp)).toBe(true);

        expect(acquireTranslationLayoutOverride(
            second,
            clamp,
            translationTruncationStyleOverrides,
        )).toBe(true);
        expect(hasTranslationLayoutOverride(clamp)).toBe(true);

        firstAttempt.state.phase = 'translated';
        expect(restoreTranslation(first)).toBe(true);
        expect(clamp.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');
        expect(hasTranslationLayoutOverride(clamp)).toBe(true);

        clamp.style.setProperty('background-color', 'blue');
        secondAttempt.state.phase = 'translated';
        expect(restoreTranslation(second)).toBe(true);
        expect(clamp.style.getPropertyValue('-webkit-line-clamp')).toMatch(/^2(?: !important)?$/u);
        expect(clamp.style.getPropertyValue('max-height')).toBe('40px');
        expect(clamp.style.getPropertyValue('color')).toBe('red');
        expect(clamp.style.getPropertyValue('background-color')).toBe('blue');
        expect(clamp.style.getPropertyValue('line-clamp') ?? '').toBe('');
        expect(hasTranslationLayoutOverride(clamp)).toBe(false);
    });

    it('preserves a host clamp rewrite instead of restoring the stale pre-translation value', () => {
        const {clamp, first} = openRouterFixture();
        clamp.style.setProperty('-webkit-line-clamp', '2');
        const attempt = beginTranslation(first, 'bilingual')!;
        acquireTranslationLayoutOverride(first, clamp, translationTruncationStyleOverrides);

        clamp.style.setProperty('-webkit-line-clamp', '4', 'important');
        expect(isTranslationLayoutOverrideMutation(clamp)).toBe(false);
        attempt.state.phase = 'translated';
        expect(restoreTranslation(first)).toBe(true);

        expect(clamp.style.getPropertyValue('-webkit-line-clamp')).toBe('4');
    });

    it('reapplies an overridden host clamp and restores the host rewrite as the new baseline', () => {
        const {clamp, first} = openRouterFixture();
        clamp.style.setProperty('-webkit-line-clamp', '2');
        commitBilingualTranslation(first);

        clamp.setAttribute('style', '-webkit-line-clamp: 4; background-color: blue;');
        expect(reconcileTranslationLayoutOverrides(first)).toBe(true);
        expect(clamp.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');
        expect(clamp.style.getPropertyValue('background-color')).toBe('blue');

        expect(restoreTranslation(first)).toBe(true);
        expect(clamp.style.getPropertyValue('-webkit-line-clamp')).toBe('4');
        expect(clamp.style.getPropertyValue('background-color')).toBe('blue');
    });

    it('releases a hover-style lease when its translated owner is detached', async () => {
        const {document, clamp, first} = openRouterFixture();
        await withDocumentRealm(document, async () => {
            clamp.style.setProperty('-webkit-line-clamp', '2');
            commitBilingualTranslation(first);
            await flushMutationObservers();
            first.remove();
            await flushMutationObservers();

            try {
                expect(getTranslationState(first)).toBeUndefined();
                expect(clamp.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
                expect(hasTranslationLayoutOverride(clamp)).toBe(false);
            } finally {
                if (getTranslationState(first)) restoreTranslation(first);
            }
        });
    });

    it('keeps a connected hover owner when the host removes its bilingual wrapper', async () => {
        const {document, clamp, first} = openRouterFixture();
        await withDocumentRealm(document, async () => {
            clamp.style.setProperty('-webkit-line-clamp', '2');
            const wrapper = commitBilingualTranslation(first);
            await flushMutationObservers();

            wrapper.remove();
            await flushMutationObservers();

            try {
                expect(getTranslationState(first)?.phase).toBe('translated');
                expect(first.querySelectorAll('.fluent-read-bilingual-content')).toHaveLength(1);
                expect(first.querySelector('.fluent-read-bilingual-content')).toBe(wrapper);
                expect(wrapper.isConnected).toBe(true);
                expect(clamp.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');
            } finally {
                if (getTranslationState(first)) restoreTranslation(first);
            }
        });
    });

    it('hover-only observer 收养等价 owned wrapper clone，保持同一 generation 与译文', async () => {
        const {document, first} = openRouterFixture();
        await withDocumentRealm(document, async () => {
            const wrapper = commitBilingualTranslation(first);
            await flushMutationObservers();
            const initialState = getTranslationState(first)!;
            const clonedWrapper = wrapper.cloneNode(true) as HTMLElement;

            wrapper.replaceWith(clonedWrapper);
            await flushMutationObservers();

            try {
                expect(getTranslationState(first)).toBe(initialState);
                expect(initialState.phase).toBe('translated');
                expect(initialState.bilingualContent).toBe(clonedWrapper);
                expect(first.querySelectorAll('.fluent-read-bilingual-content')).toHaveLength(1);
                expect(first.textContent).toContain('Translated text.');
                expect(wrapper.isConnected).toBe(false);
                expect(clonedWrapper.isConnected).toBe(true);
            } finally {
                if (getTranslationState(first)) restoreTranslation(first);
            }
        });
    });

    it('hover-only observer 接受宿主仅给 owned wrapper 添加 class，不闪回原文', async () => {
        const {document, first} = openRouterFixture();
        await withDocumentRealm(document, async () => {
            const wrapper = commitBilingualTranslation(first);
            await flushMutationObservers();
            const initialState = getTranslationState(first)!;

            wrapper.classList.add('host-layout-class');
            await flushMutationObservers();

            try {
                expect(getTranslationState(first)).toBe(initialState);
                expect(initialState.phase).toBe('translated');
                expect(initialState.bilingualContent).toBe(wrapper);
                expect(wrapper.classList.contains('host-layout-class')).toBe(true);
                expect(first.querySelectorAll('.fluent-read-bilingual-content')).toHaveLength(1);
                expect(first.textContent).toContain('Translated text.');
            } finally {
                if (getTranslationState(first)) restoreTranslation(first);
            }
        });
    });

    it('hover-only observer 不收养内容被宿主篡改的 owned wrapper clone', async () => {
        const {document, first} = openRouterFixture();
        await withDocumentRealm(document, async () => {
            const wrapper = commitBilingualTranslation(first);
            await flushMutationObservers();
            const tamperedWrapper = wrapper.cloneNode(true) as HTMLElement;
            tamperedWrapper.textContent = 'Host-forged translation.';

            wrapper.replaceWith(tamperedWrapper);
            await flushMutationObservers();

            try {
                const nextState = getTranslationState(first);
                expect(nextState?.bilingualContent).not.toBe(tamperedWrapper);
                expect(tamperedWrapper.isConnected).toBe(false);
                expect(first.textContent).not.toContain('Host-forged translation.');
                if (nextState) {
                    expect(nextState.phase).toBe('translated');
                    expect(nextState.bilingualContent?.textContent).toBe('Translated text.');
                }
            } finally {
                if (getTranslationState(first)) restoreTranslation(first);
            }
        });
    });

    it('hover-only observer 在原位 href 变化时丢弃旧输出骨架并保留宿主链接', async () => {
        const {document} = parseHTML(
            '<html><body><p id="owner"><a href="/before">Readable link.</a></p></body></html>',
        );
        await withDocumentRealm(document, async () => {
            const owner = document.querySelector<HTMLElement>('#owner')!;
            const link = owner.querySelector<HTMLAnchorElement>('a')!;
            const wrapper = commitBilingualTranslation(owner);
            await flushMutationObservers();

            link.setAttribute('href', '/after');
            await flushMutationObservers();

            expect(getTranslationState(owner)).toBeUndefined();
            expect(wrapper.isConnected).toBe(false);
            expect(link.getAttribute('href')).toBe('/after');
            expect(owner.textContent).toBe('Readable link.');
        });
    });

    it('hover-only 已译 owner 的祖先变为 contenteditable 时立即恢复原文并清理状态', async () => {
        const {document} = parseHTML(
            '<html><body><section id="editor-shell"><p id="owner">Editable source.</p></section></body></html>',
        );
        await withDocumentRealm(document, async () => {
            const ancestor = document.querySelector<HTMLElement>('#editor-shell')!;
            const owner = document.querySelector<HTMLElement>('#owner')!;
            const wrapper = commitBilingualTranslation(owner);
            await flushMutationObservers();

            ancestor.setAttribute('contenteditable', 'true');
            await flushMutationObservers();

            try {
                expect(getTranslationState(owner)).toBeUndefined();
                expect(wrapper.isConnected).toBe(false);
                expect(owner.querySelector('.fluent-read-bilingual-content')).toBeNull();
                expect(owner.textContent).toBe('Editable source.');
            } finally {
                if (getTranslationState(owner)) restoreTranslation(owner);
            }
        });
    });

    it('hover-only owner 的祖先仅变更普通 class/style 时不触发资格清理', async () => {
        const {document} = parseHTML(
            '<html><body><section id="shell"><p id="owner">Stable source.</p></section></body></html>',
        );
        await withDocumentRealm(document, async () => {
            const ancestor = document.querySelector<HTMLElement>('#shell')!;
            const owner = document.querySelector<HTMLElement>('#owner')!;
            const wrapper = commitBilingualTranslation(owner);
            await flushMutationObservers();
            const initialState = getTranslationState(owner);

            ancestor.classList.add('host-hover');
            ancestor.style.color = 'red';
            await flushMutationObservers();

            try {
                expect(getTranslationState(owner)).toBe(initialState);
                expect(wrapper.isConnected).toBe(true);
                expect(owner.querySelector('.fluent-read-bilingual-content')).toBe(wrapper);
            } finally {
                if (getTranslationState(owner)) restoreTranslation(owner);
            }
        });
    });

    it.each(['semantic class', 'semantic style'] as const)(
        'hover-only owner 的祖先出现 %s 保护时恢复原文',
        async (guard) => {
            const {document} = parseHTML(
                '<html><body><section id="shell"><p id="owner">Protected source.</p></section></body></html>',
            );
            Object.defineProperty(document.defaultView, 'getComputedStyle', {
                configurable: true,
                value: (element: Element) => ({
                    display: (element as HTMLElement).style.display || 'block',
                    visibility: (element as HTMLElement).style.visibility || 'visible',
                    webkitLineClamp: 'none',
                    getPropertyValue: (property: string) => property === 'display'
                        ? (element as HTMLElement).style.display || 'block'
                        : property === 'visibility'
                            ? (element as HTMLElement).style.visibility || 'visible'
                            : '',
                }) as unknown as CSSStyleDeclaration,
            });
            await withDocumentRealm(document, async () => {
                const ancestor = document.querySelector<HTMLElement>('#shell')!;
                const owner = document.querySelector<HTMLElement>('#owner')!;
                const wrapper = commitBilingualTranslation(owner);
                await flushMutationObservers();

                if (guard === 'semantic class') ancestor.classList.add('notranslate');
                else ancestor.style.display = 'none';
                await flushMutationObservers();

                expect(getTranslationState(owner)).toBeUndefined();
                expect(wrapper.isConnected).toBe(false);
                expect(owner.textContent).toBe('Protected source.');
            });
        },
    );

    it('hover 显式放行的顶层 translate=no 应用壳不会被语义复验误清理', async () => {
        const {document} = parseHTML(
            '<html><body><section id="app" translate="no"><p id="owner">Explicit source.</p></section></body></html>',
        );
        await withDocumentRealm(document, async () => {
            const app = document.querySelector<HTMLElement>('#app')!;
            const owner = document.querySelector<HTMLElement>('#owner')!;
            const source = owner.firstChild as Text;
            const attempt = beginTranslation(
                owner, 'bilingual', 'content', false, source.data, [source], true,
            )!;
            attempt.state.phase = 'translated';
            expect(ensureTranslationTruncationLayout(owner)).toBe(true);
            const wrapper = document.createElement('span');
            wrapper.className = 'fluent-read-bilingual-content';
            wrapper.setAttribute('data-fr-translation-owned', 'true');
            wrapper.textContent = '显式译文。';
            owner.appendChild(wrapper);
            setBilingualContent(owner, wrapper);
            await flushMutationObservers();

            app.setAttribute('lang', 'en');
            await flushMutationObservers();

            try {
                expect(getTranslationState(owner)).toBe(attempt.state);
                expect(wrapper.isConnected).toBe(true);
                expect(owner.textContent).toContain('显式译文。');
            } finally {
                if (getTranslationState(owner)) restoreTranslation(owner);
            }
        });
    });

    it('keeps an overflow owner through ordinary hover class changes, then restores on real source mutation', async () => {
        const {document} = parseHTML('<html><body><div id="owner"></div></body></html>');
        await withDocumentRealm(document, async () => {
            const owner = document.querySelector<HTMLElement>('#owner')!;
            let deepest = owner;
            for (let depth = 0; depth < 140; depth += 1) {
                const child = document.createElement('span');
                deepest.appendChild(child);
                deepest = child;
            }
            deepest.textContent = 'Deep source.';
            const wrapper = commitBilingualTranslation(owner);
            await flushMutationObservers();
            expect(getTranslationState(owner)?.sourceStructureSignature).toBe('overflow');

            owner.className = 'host-hovered';
            await flushMutationObservers();
            expect(getTranslationState(owner)?.phase).toBe('translated');
            expect(wrapper.isConnected).toBe(true);

            owner.style.color = 'red';
            await flushMutationObservers();
            expect(getTranslationState(owner)?.phase).toBe('translated');
            expect(wrapper.isConnected).toBe(true);

            owner.setAttribute('lang', 'fr');
            await flushMutationObservers();
            expect(getTranslationState(owner)).toBeUndefined();
            expect(wrapper.isConnected).toBe(false);
            expect(owner.textContent).toBe('Deep source.');
            expect(owner.getAttribute('lang')).toBe('fr');
        });
    });

    it.each([
        ['MathJax class', (target: HTMLElement): void => { target.classList.add('MathJax'); }],
        ['inline display', (target: HTMLElement): void => { target.style.display = 'none'; }],
    ] as const)('overflow owner 在 %s 语义变化后恢复而不保留旧骨架', async (_name, mutate) => {
        const {document} = parseHTML('<html><body><div id="owner">Readable source.</div></body></html>');
        await withDocumentRealm(document, async () => {
            const owner = document.querySelector<HTMLElement>('#owner')!;
            let deepest = owner;
            for (let depth = 0; depth < 140; depth += 1) {
                const child = document.createElement('span');
                deepest.appendChild(child);
                deepest = child;
            }
            const target = document.createElement('span');
            target.textContent = 'Deep source.';
            deepest.appendChild(target);
            const wrapper = commitBilingualTranslation(owner);
            await flushMutationObservers();
            expect(getTranslationState(owner)?.sourceStructureSignature).toBe('overflow');

            mutate(target);
            await flushMutationObservers();

            expect(getTranslationState(owner)).toBeUndefined();
            expect(wrapper.isConnected).toBe(false);
            expect(owner.textContent).not.toContain('Translated text.');
        });
    });

    it('overflow mutation 的祖先查找在异常深 DOM 上保持有界', async () => {
        const {document} = parseHTML('<html><body><div id="owner">Readable source.</div></body></html>');
        await withDocumentRealm(document, async () => {
            const owner = document.querySelector<HTMLElement>('#owner')!;
            let deepest = owner;
            for (let depth = 0; depth < 540; depth += 1) {
                const child = document.createElement('span');
                deepest.appendChild(child);
                deepest = child;
            }
            deepest.textContent = 'Protected extreme-depth source.';
            const wrapper = commitBilingualTranslation(owner);
            await flushMutationObservers();
            expect(getTranslationState(owner)?.sourceStructureSignature).toBe('overflow');

            deepest.classList.add('MathJax');
            await flushMutationObservers();

            expect(getTranslationState(owner)).toBeUndefined();
            expect(wrapper.isConnected).toBe(false);
        });
    });

    it('overflow owner 同位重建完全相同的 source DOM 时重绑 Text 并保留译文', async () => {
        const {document} = parseHTML('<html><body><div id="owner"></div></body></html>');
        await withDocumentRealm(document, async () => {
            const owner = document.querySelector<HTMLElement>('#owner')!;
            let deepest = owner;
            for (let depth = 0; depth < 140; depth += 1) {
                const child = document.createElement('span');
                deepest.appendChild(child);
                deepest = child;
            }
            deepest.textContent = 'Exact overflow source.';
            commitBilingualTranslation(owner);
            await flushMutationObservers();
            const originalState = getTranslationState(owner)!;
            const originalTextNode = originalState.sourceTextNodes?.at(-1);
            const sourceHTML = originalState.sourceHTML;

            owner.innerHTML = sourceHTML;
            await flushMutationObservers();

            const reboundState = getTranslationState(owner)!;
            expect(reboundState).toBe(originalState);
            expect(reboundState.phase).toBe('translated');
            expect(reboundState.sourceStructureDirty).toBe(false);
            expect(reboundState.sourceTextNodes?.at(-1)).not.toBe(originalTextNode);
            expect(reboundState.sourceTextNodes?.every((node) => node.isConnected)).toBe(true);
            expect(owner.querySelectorAll('.fluent-read-bilingual-content')).toHaveLength(1);
        });
    });

    it('atomically hands a hover-only translation to an equivalent remounted owner', async () => {
        const {document} = parseHTML(
            '<html><body><article id="row"><p id="owner">Hover-only remount stays translated.</p></article></body></html>',
        );
        await withDocumentRealm(document, async () => {
            const row = document.querySelector<HTMLElement>('#row')!;
            const owner = document.querySelector<HTMLElement>('#owner')!;
            const source = owner.firstChild as Text;
            const attempt = beginTranslation(
                owner, 'bilingual', 'content', false, source.data, [source],
            )!;
            expect(markTranslationComplete(owner, attempt.state, attempt.generation)).toBe(true);
            expect(ensureTranslationTruncationLayout(owner)).toBe(true);
            const wrapper = document.createElement('span');
            wrapper.className = 'fluent-read-bilingual-content';
            wrapper.setAttribute('data-fr-translation-owned', 'true');
            wrapper.textContent = '仅悬停重挂仍保留译文。';
            owner.appendChild(wrapper);
            setBilingualContent(owner, wrapper);
            await flushMutationObservers();

            setBilingualOwnerRemountHandler((mutations) => {
                transferEquivalentBilingualOwners(mutations, (_old, replacement) => ({
                    sourceTextNodes: [replacement.firstChild as Text],
                    reconcileLayout: ensureTranslationTruncationLayout,
                }));
            });
            const replacement = document.createElement('p');
            replacement.id = 'owner';
            replacement.textContent = source.data;
            owner.replaceWith(replacement);
            await flushMutationObservers();

            try {
                expect(getTranslationState(owner)).toBeUndefined();
                expect(getTranslationState(replacement)?.phase).toBe('translated');
                expect(replacement.querySelectorAll('.fluent-read-bilingual-content')).toHaveLength(1);
                expect(replacement.textContent).toContain('仅悬停重挂仍保留译文。');
            } finally {
                setBilingualOwnerRemountHandler(undefined);
                if (getTranslationState(replacement)) restoreTranslation(replacement);
                row.replaceChildren();
            }
        });
    });

    it('restores and reacquires a cloned ancestor clamp during whole-subtree remount', async () => {
        const {document} = parseHTML(
            '<html><body><article id="row" style="-webkit-line-clamp: 2"><p id="owner">Cloned clamp stays reversible.</p></article></body></html>',
        );
        Object.defineProperty(document.defaultView, 'getComputedStyle', {
            configurable: true,
            value: (element: Element) => {
                const inlineClamp = (element as HTMLElement).style?.getPropertyValue('-webkit-line-clamp') ?? '';
                const lineClamp = inlineClamp === 'unset' ? 'none' : inlineClamp || 'none';
                return {
                    webkitLineClamp: lineClamp,
                    getPropertyValue: (property: string) =>
                        property === '-webkit-line-clamp' || property === 'line-clamp' ? lineClamp : '',
                } as unknown as CSSStyleDeclaration;
            },
        });
        await withDocumentRealm(document, async () => {
            const row = document.querySelector<HTMLElement>('#row')!;
            const owner = document.querySelector<HTMLElement>('#owner')!;
            commitBilingualTranslation(owner);
            await flushMutationObservers();
            expect(row.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');

            setBilingualOwnerRemountHandler((mutations) => {
                transferEquivalentBilingualOwners(mutations, (_old, replacement) => ({
                    sourceTextNodes: [replacement.firstChild as Text],
                    reconcileLayout: ensureTranslationTruncationLayout,
                }));
            });
            const replacementRow = row.cloneNode(true) as HTMLElement;
            const replacementOwner = replacementRow.querySelector<HTMLElement>('#owner')!;
            row.replaceWith(replacementRow);
            await flushMutationObservers();

            try {
                expect(getTranslationState(owner)).toBeUndefined();
                expect(getTranslationState(replacementOwner)?.phase).toBe('translated');
                expect(replacementRow.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');
                expect(hasTranslationLayoutOverride(replacementRow)).toBe(true);
                expect(restoreTranslation(replacementOwner)).toBe(true);
                expect(replacementRow.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
            } finally {
                setBilingualOwnerRemountHandler(undefined);
                if (getTranslationState(replacementOwner)) restoreTranslation(replacementOwner);
            }
        });
    });

    it('moves a connected hover owner lease from clamp A to clamp B', async () => {
        const {document} = parseHTML(`
            <html><body>
                <div id="clamp-a" style="-webkit-line-clamp: 2"><p id="owner">Moved prose.</p></div>
                <div id="clamp-b" style="-webkit-line-clamp: 3"></div>
            </body></html>
        `);
        const clampA = document.querySelector<HTMLElement>('#clamp-a')!;
        const clampB = document.querySelector<HTMLElement>('#clamp-b')!;
        const owner = document.querySelector<HTMLElement>('#owner')!;
        Object.defineProperty(document.defaultView, 'getComputedStyle', {
            configurable: true,
            value: (element: Element) => {
                const inlineClamp = (element as HTMLElement).style?.getPropertyValue('-webkit-line-clamp') ?? '';
                const lineClamp = inlineClamp === 'unset' ? 'none' : inlineClamp || 'none';
                return {
                    webkitLineClamp: lineClamp,
                    getPropertyValue: (property: string) =>
                        property === '-webkit-line-clamp' || property === 'line-clamp' ? lineClamp : '',
                } as unknown as CSSStyleDeclaration;
            },
        });

        await withDocumentRealm(document, async () => {
            const wrapper = commitBilingualTranslation(owner);
            await flushMutationObservers();
            expect(clampA.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');

            clampB.appendChild(owner);
            await flushMutationObservers();

            try {
                expect(getTranslationState(owner)?.phase).toBe('translated');
                expect(wrapper.isConnected).toBe(true);
                expect(clampA.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
                expect(clampB.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');
            } finally {
                if (getTranslationState(owner)) restoreTranslation(owner);
            }
        });
    });

    it.each([
        {
            trigger: 'class',
            activate: (clamp: HTMLElement) => clamp.classList.add('line-clamp-2'),
            restoredClamp: '',
        },
        {
            trigger: 'inline style',
            activate: (clamp: HTMLElement) => clamp.style.setProperty('-webkit-line-clamp', '2'),
            restoredClamp: '2',
        },
    ])('automatically acquires an ancestor clamp activated through $trigger', async ({activate, restoredClamp}) => {
        const {document, clamp, owner} = dynamicClampFixture();
        await withDocumentRealm(document, async () => {
            commitBilingualTranslation(owner);
            await flushMutationObservers();
            expect(clamp.style.getPropertyValue('-webkit-line-clamp') ?? '').toBe('');

            activate(clamp);
            await flushMutationObservers();

            try {
                expect(getTranslationState(owner)?.phase).toBe('translated');
                expect(clamp.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');
            } finally {
                if (getTranslationState(owner)) restoreTranslation(owner);
            }
            expect(clamp.style.getPropertyValue('-webkit-line-clamp') ?? '').toBe(restoredClamp);
        });
    });

    it('reapplies a hover owner override after the host rewrites its inline clamp', async () => {
        const {document, first} = openRouterFixture();
        await withDocumentRealm(document, async () => {
            Object.defineProperty(document.defaultView, 'getComputedStyle', {
                configurable: true,
                value: (element: Element) => {
                    const lineClamp = (element as HTMLElement).style
                        ?.getPropertyValue('-webkit-line-clamp') || 'none';
                    return {
                        webkitLineClamp: lineClamp, maxHeight: 'none', overflowY: 'visible', overflow: 'visible',
                        getPropertyValue: (property: string) =>
                            property === '-webkit-line-clamp' || property === 'line-clamp' ? lineClamp : '',
                    } as unknown as CSSStyleDeclaration;
                },
            });
            commitBilingualTranslation(first);
            await flushMutationObservers();

            first.setAttribute('style', '-webkit-line-clamp: 2; color: blue;');
            await flushMutationObservers();

            try {
                expect(hasTranslationLayoutOverride(first)).toBe(true);
                expect(first.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');
                expect(first.style.getPropertyValue('color')).toBe('blue');
            } finally {
                if (getTranslationState(first)) restoreTranslation(first);
            }
            expect(first.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
            expect(first.style.getPropertyValue('color')).toBe('blue');
        });
    });

    it('真实 max-height 溢出 owner 仍会展开，并在恢复时保留宿主原样式', async () => {
        const {document} = parseHTML(
            '<html><body><p id="owner" style="max-height:40px;overflow:hidden;color:blue">Long source.</p></body></html>',
        );
        const owner = document.querySelector<HTMLElement>('#owner')!;
        Object.defineProperties(owner, {
            scrollHeight: {configurable: true, value: 120},
            clientHeight: {configurable: true, value: 40},
        });
        Object.defineProperty(document.defaultView, 'getComputedStyle', {
            configurable: true,
            value: (element: HTMLElement) => ({
                webkitLineClamp: 'none',
                maxHeight: element.style.getPropertyValue('max-height') || 'none',
                overflowY: element.style.getPropertyValue('overflow-y') || element.style.overflow || 'visible',
                overflow: element.style.overflow || 'visible',
                getPropertyValue: () => '',
            } as unknown as CSSStyleDeclaration),
        });

        await withDocumentRealm(document, async () => {
            commitBilingualTranslation(owner);
            expect(owner.style.getPropertyValue('max-height')).toBe('unset');
            expect(owner.style.getPropertyValue('color')).toBe('blue');
            expect(hasTranslationLayoutOverride(owner)).toBe(true);

            expect(restoreTranslation(owner)).toBe(true);
            expect(owner.style.getPropertyValue('max-height')).toBe('40px');
            expect(owner.style.overflow).toBe('hidden');
            expect(owner.style.getPropertyValue('color')).toBe('blue');
        });
    });

    it('automatically releases a hover lease when its owner is removed inside an open ShadowRoot', async () => {
        const {document} = parseHTML('<html><body><div id="host"></div></body></html>');
        const host = document.querySelector<HTMLElement>('#host')!;
        const shadowRoot = host.attachShadow({mode: 'open'});
        const clamp = document.createElement('div');
        const owner = document.createElement('p');
        clamp.style.setProperty('-webkit-line-clamp', '2');
        owner.textContent = 'Shadow-root model description.';
        clamp.appendChild(owner);
        shadowRoot.appendChild(clamp);
        Object.defineProperty(document.defaultView, 'getComputedStyle', {
            configurable: true,
            value: (element: Element) => {
                const inlineClamp = (element as HTMLElement).style?.getPropertyValue('-webkit-line-clamp') ?? '';
                const lineClamp = inlineClamp === 'unset' ? 'none' : inlineClamp || 'none';
                return {
                    webkitLineClamp: lineClamp,
                    getPropertyValue: (property: string) =>
                        property === '-webkit-line-clamp' || property === 'line-clamp' ? lineClamp : '',
                } as unknown as CSSStyleDeclaration;
            },
        });

        await withDocumentRealm(document, async () => {
            commitBilingualTranslation(owner);
            await flushMutationObservers();
            expect(clamp.style.getPropertyValue('-webkit-line-clamp')).toBe('unset');

            owner.remove();
            await flushMutationObservers();

            try {
                expect(getTranslationState(owner)).toBeUndefined();
                expect(clamp.style.getPropertyValue('-webkit-line-clamp')).toBe('2');
            } finally {
                if (getTranslationState(owner)) restoreTranslation(owner);
            }
        });
    });

    it('restores the exact original style attribute when the host did not mutate it', () => {
        const {clamp, first} = openRouterFixture();
        const originalStyle = 'COLOR: red; -webkit-line-clamp: 2; max-height: 40px';
        clamp.setAttribute('style', originalStyle);
        const attempt = beginTranslation(first, 'bilingual')!;
        acquireTranslationLayoutOverride(first, clamp, translationTruncationStyleOverrides);
        attempt.state.phase = 'translated';

        expect(restoreTranslation(first)).toBe(true);
        expect(clamp.getAttribute('style')).toBe(originalStyle);
    });

    it('removes a temporary style attribute when the unclamped ancestor originally had none', () => {
        const {clamp, first} = openRouterFixture();
        expect(clamp.getAttribute('style')).toBeNull();
        const attempt = beginTranslation(first, 'bilingual')!;
        acquireTranslationLayoutOverride(first, clamp, translationTruncationStyleOverrides);
        expect(clamp.getAttribute('style')).not.toBeNull();

        attempt.state.phase = 'translated';
        expect(restoreTranslation(first)).toBe(true);
        expect(clamp.getAttribute('style')).toBeNull();
    });
});
