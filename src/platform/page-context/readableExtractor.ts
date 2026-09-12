/**
 * @file src/platform/page-context/readableExtractor.ts
 * 文件职责：在扩展运行时按需加载网页正文提取器（Defuddle），避免每个网页的内容脚本启动时解析和执行大体积解析库。
 * 主要内容：定义以全局 Symbol 登记的提取器契约、供独立脚本调用的 registerReadablePageExtractor，以及对并发请求去重、失败后可重试的 createReadablePageExtractorLoader 与默认加载器。
 * 模块边界：只负责定位与加载扩展自有脚本，不克隆页面 DOM、不清洗隐私字段也不决定上下文预算；这些规则由 services/translation/context 负责，userscript 以静态导入实现替换本模块。
 */
import type {createMarkdownContent as CreateMarkdownContent, default as DefuddleClass} from 'defuddle/full';

export interface ReadablePageExtractor {
    readonly Defuddle: typeof DefuddleClass;
    readonly createMarkdownContent?: typeof CreateMarkdownContent;
}

/** 构建产物中的独立提取脚本；manifest 可访问资源声明与加载器共用此路径。 */
export const READABLE_PAGE_EXTRACTOR_SCRIPT = 'pageContextExtractor.js';

const READABLE_PAGE_EXTRACTOR_REGISTRY = Symbol.for('fluentread.readablePageExtractor.v1');

type ExtractorRegistryGlobal = typeof globalThis & {[READABLE_PAGE_EXTRACTOR_REGISTRY]?: ReadablePageExtractor};

/** 独立脚本在内容脚本所在的隔离环境中执行后调用，使提取器只登记一次。 */
export function registerReadablePageExtractor(extractor: ReadablePageExtractor): void {
    Object.defineProperty(globalThis, READABLE_PAGE_EXTRACTOR_REGISTRY, {value: extractor, configurable: true});
}

function registeredExtractor(): ReadablePageExtractor | undefined {
    return (globalThis as ExtractorRegistryGlobal)[READABLE_PAGE_EXTRACTOR_REGISTRY];
}

export interface ReadablePageExtractorLoaderDependencies {
    readonly resolveUrl: (path: string) => string;
    readonly importModule: (url: string) => Promise<unknown>;
}

export function createReadablePageExtractorLoader(
    dependencies: ReadablePageExtractorLoaderDependencies,
): () => Promise<ReadablePageExtractor> {
    let pending: Promise<ReadablePageExtractor> | null = null;
    return () => {
        const existing = registeredExtractor();
        if (existing) return Promise.resolve(existing);
        if (pending) return pending;
        const request = Promise.resolve()
            .then(() => dependencies.importModule(dependencies.resolveUrl(READABLE_PAGE_EXTRACTOR_SCRIPT)))
            .then(() => {
                const loaded = registeredExtractor();
                if (!loaded) throw new Error('网页正文提取器未完成注册');
                return loaded;
            });
        pending = request;
        // 失败后释放单飞槽位，下一次翻译请求可以重新尝试加载。
        request.catch(() => { if (pending === request) pending = null; });
        return request;
    };
}

type ExtensionRuntimeGlobal = typeof globalThis & {
    browser?: {runtime?: {getURL?: (path: string) => string}};
    chrome?: {runtime?: {getURL?: (path: string) => string}};
};

function resolveExtensionUrl(path: string): string {
    const extensionGlobal = globalThis as ExtensionRuntimeGlobal;
    const runtime = extensionGlobal.browser?.runtime ?? extensionGlobal.chrome?.runtime;
    if (typeof runtime?.getURL !== 'function') throw new Error('扩展运行时不可用，无法加载网页正文提取器');
    return runtime.getURL(path);
}

export const loadReadablePageExtractor = createReadablePageExtractorLoader({
    resolveUrl: resolveExtensionUrl,
    importModule: (url) => import(/* @vite-ignore */ url),
});
