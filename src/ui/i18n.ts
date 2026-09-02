/**
 * @file src/ui/i18n.ts
 *
 * 文件职责：把 core i18n 的纯翻译能力接入 Vue，并在每个扩展 UI runtime 中
 * 订阅共享配置、即时切换语言和安全迁移尚未 key 化的旧文案。
 * 主要内容：提供 createUiI18nPlugin、useUiI18n 和 v-ui-i18n 指令。指令只扫描
 * 显式标记的扩展 UI 根节点，跳过代码、文本编辑器和用户内容，避免把网页正文
 * 或翻译结果误当成扩展文案。
 * 模块边界：这里负责 Vue 响应式和配置 patch，不定义语言文案；文案资源与纯
 * fallback 规则在 src/core/i18n，配置持久化仍由 services/config/store 负责。
 */

import {
    inject,
    readonly,
    ref,
    watch,
    type App,
    type Directive,
    type InjectionKey,
    type Plugin,
    type Ref,
} from 'vue';
import browser from 'webextension-polyfill';
import {
    config,
    configReady,
    requestConfigPatch,
    subscribeConfig,
} from '@/src/services/config/store';
import {
    DEFAULT_UI_LANGUAGE,
    normalizeUiLanguage,
    translate,
    translateLegacyText,
    type TranslationParams,
    type UiLanguage,
} from '@/src/core/i18n';

export interface UiI18nContext {
    language: Readonly<Ref<UiLanguage>>;
    t: (key: string, params?: TranslationParams) => string;
    translateLegacy: (value: string) => string;
    setLanguage: (value: unknown) => Promise<void>;
    dispose: () => void;
}

interface LocalizableServiceOption {
    value: string;
    label: string;
    description?: string;
    searchTerms?: string[];
}

interface ServiceProfileSummary {
    id: string;
    endpoint: string;
    models: string[];
}

/** 在 UI 边界本地化服务目录，同时保留原始名称作为搜索兼容项。 */
export function localizeServiceOptions<T extends LocalizableServiceOption>(
    options: readonly T[],
    profiles: readonly ServiceProfileSummary[],
    translateLegacy: (value: string) => string,
): Array<T & {searchTerms: string[]}> {
    return options.map((option) => {
        const profile = profiles.find((item) => item.id === option.value);
        return {
            ...option,
            label: translateLegacy(option.label),
            description: option.description ? translateLegacy(option.description) : option.description,
            searchTerms: [...(option.searchTerms || []), option.label, translateLegacy(option.label), ...(profile ? [profile.endpoint, ...profile.models] : [])],
        };
    });
}

export const UI_I18N_KEY: InjectionKey<UiI18nContext> = Symbol('fluentread-ui-i18n');

export function createUiI18nContext(): UiI18nContext {
    const languageState = ref<UiLanguage>(normalizeUiLanguage(config.uiLanguage || DEFAULT_UI_LANGUAGE));
    let disposed = false;

    const unsubscribe = subscribeConfig((nextConfig) => {
        if (!disposed) languageState.value = normalizeUiLanguage(nextConfig.uiLanguage);
    });
    void configReady.then(() => {
        if (!disposed) languageState.value = normalizeUiLanguage(config.uiLanguage);
    }).catch(() => undefined);

    const language = readonly(languageState);
    const t = (key: string, params?: TranslationParams): string => translate(key, language.value, params);
    const translateLegacy = (value: string): string => translateLegacyText(value, language.value);

    async function setLanguage(value: unknown): Promise<void> {
        const nextLanguage = normalizeUiLanguage(value);
        const previousLanguage = languageState.value;
        languageState.value = nextLanguage;
        try {
            await requestConfigPatch(
                {uiLanguage: nextLanguage, uiLanguageSetupCompleted: true},
                browser.runtime.sendMessage.bind(browser.runtime),
            );
        } catch (error) {
            languageState.value = previousLanguage;
            throw error;
        }
    }

    return {
        language,
        t,
        translateLegacy,
        setLanguage,
        dispose() {
            if (disposed) return;
            disposed = true;
            unsubscribe();
        },
    };
}

interface TrackedText {
    source: string;
    lastRendered: string;
}

interface TrackedAttribute {
    source: string;
    lastRendered: string;
}

interface UiI18nDirectiveState {
    observer: MutationObserver;
    refreshQueued: boolean;
    text: WeakMap<Text, TrackedText>;
    attributes: WeakMap<HTMLElement, Map<string, TrackedAttribute>>;
    stopLanguageWatch: () => void;
    refresh: () => void;
}

const TRANSLATABLE_ATTRIBUTES = ['aria-label', 'aria-description', 'placeholder', 'title', 'alt'] as const;
const NON_UI_TEXT_TAGS = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'TEXTAREA']);
const NON_UI_ELEMENT_TAGS = new Set(['SCRIPT', 'STYLE']);

function isIgnoredElement(element: Element | null): boolean {
    return Boolean(element?.closest('[data-i18n-ignore]'))
        || (element ? NON_UI_ELEMENT_TAGS.has(element.tagName) : true);
}

function isIgnoredTextElement(element: Element | null): boolean {
    return Boolean(element?.closest('[data-i18n-ignore]'))
        || (element ? NON_UI_TEXT_TAGS.has(element.tagName) : true);
}

function scanUiRoot(root: HTMLElement, context: UiI18nContext, state: UiI18nDirectiveState): void {
    if (isIgnoredElement(root)) return;

    const document = root.ownerDocument;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
        const textNode = node as Text;
        const parent = textNode.parentElement;
        if (parent && !isIgnoredTextElement(parent)) {
            const current = textNode.data;
            if (current.trim()) {
                const tracked = state.text.get(textNode);
                const source = tracked && current === tracked.lastRendered ? tracked.source : current;
                const translated = context.translateLegacy(source);
                if (translated !== current) textNode.data = translated;
                state.text.set(textNode, {source, lastRendered: translated});
            }
        }
        node = walker.nextNode();
    }

    const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
    for (const element of elements) {
        if (isIgnoredElement(element)) continue;
        for (const attribute of TRANSLATABLE_ATTRIBUTES) {
            const current = element.getAttribute(attribute);
            if (!current?.trim()) continue;
            let trackedAttributes = state.attributes.get(element);
            if (!trackedAttributes) {
                trackedAttributes = new Map();
                state.attributes.set(element, trackedAttributes);
            }
            const tracked = trackedAttributes.get(attribute);
            const source = tracked && current === tracked.lastRendered ? tracked.source : current;
            const translated = context.translateLegacy(source);
            if (translated !== current) element.setAttribute(attribute, translated);
            trackedAttributes.set(attribute, {source, lastRendered: translated});
        }
    }
}

function createUiI18nDirective(context: UiI18nContext): Directive<HTMLElement> {
    const states = new WeakMap<HTMLElement, UiI18nDirectiveState>();

    const queueRefresh = (root: HTMLElement, state: UiI18nDirectiveState): void => {
        if (state.refreshQueued) return;
        state.refreshQueued = true;
        queueMicrotask(() => {
            state.refreshQueued = false;
            if (root.isConnected) scanUiRoot(root, context, state);
        });
    };

    return {
        mounted(root) {
            const state = {} as UiI18nDirectiveState;
            state.observer = new MutationObserver(() => queueRefresh(root, state));
            state.refresh = () => scanUiRoot(root, context, state);
            state.refreshQueued = false;
            state.text = new WeakMap();
            state.attributes = new WeakMap();
            state.stopLanguageWatch = watch(context.language, () => {
                state.refresh();
            }, {flush: 'post'});
            states.set(root, state);
            state.observer.observe(root, {
                subtree: true,
                childList: true,
                characterData: true,
                attributes: true,
                attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
            });
            state.refresh();
        },
        updated(root) {
            const state = states.get(root);
            if (state) queueRefresh(root, state);
        },
        beforeUnmount(root) {
            const state = states.get(root);
            if (!state) return;
            state.stopLanguageWatch();
            state.observer.disconnect();
            states.delete(root);
        },
    };
}

/** 为 options/popup/document 这类扩展专属页面观察 body，覆盖 Element Plus Teleport 内容。 */
function observeUiDocument(root: HTMLElement, context: UiI18nContext): () => void {
    const state = {} as UiI18nDirectiveState;
    let refreshQueued = false;
    const refresh = (): void => scanUiRoot(root, context, state);
    const queueRefresh = (): void => {
        if (refreshQueued) return;
        refreshQueued = true;
        queueMicrotask(() => {
            refreshQueued = false;
            if (root.isConnected) refresh();
        });
    };
    state.refreshQueued = false;
    state.text = new WeakMap();
    state.attributes = new WeakMap();
    state.refresh = refresh;
    state.stopLanguageWatch = watch(context.language, refresh, {flush: 'post'});
    state.observer = new MutationObserver(queueRefresh);
    state.observer.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
    });
    refresh();
    return () => {
        state.stopLanguageWatch();
        state.observer.disconnect();
    };
}

let fallbackContext: UiI18nContext | null = null;

export function useUiI18n(): UiI18nContext {
    const injected = inject(UI_I18N_KEY, null);
    if (injected) return injected;
    fallbackContext ??= createUiI18nContext();
    return fallbackContext;
}

export interface UiI18nPluginOptions {
    /** 仅用于扩展专属 document 页面；不要传入宿主网页的 body。 */
    documentRoot?: HTMLElement | null;
    /** 扩展专属页面的标题资源 key；不传则只同步 html[lang]。 */
    documentTitleKey?: string;
}

export function createUiI18nPlugin(options: UiI18nPluginOptions = {}): Plugin {
    return {
        install(app: App) {
            const context = createUiI18nContext();
            const stopDocumentObserver = options.documentRoot
                ? observeUiDocument(options.documentRoot, context)
                : () => undefined;
            const updateDocumentMetadata = (): void => {
                if (!options.documentRoot) return;
                document.documentElement.lang = context.language.value;
                if (options.documentTitleKey) {
                    document.title = context.t(options.documentTitleKey);
                }
            };
            updateDocumentMetadata();
            const stopMetadataWatch = watch(context.language, updateDocumentMetadata, {flush: 'post'});
            app.provide(UI_I18N_KEY, context);
            app.config.globalProperties.$fluentT = context.t;
            app.directive('ui-i18n', createUiI18nDirective(context));
            app.mixin({
                beforeUnmount() {
                    if (this.$root !== this) return;
                    stopMetadataWatch();
                    stopDocumentObserver();
                    context.dispose();
                },
            });
        },
    };
}
