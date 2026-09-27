import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import vue from '@vitejs/plugin-vue';
import ts from 'typescript';
import {defineConfig, normalizePath, type Plugin} from 'vite';
import {createUserscriptMetadata} from './metadata';
import {UI_LANGUAGE_BUNDLES} from '../src/core/i18n/bundles';

const root = resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    version: string;
    userscriptVersion: string;
};
const iconDataUrl = `data:image/png;base64,${fs.readFileSync(resolve(root, 'public/icon/64.png')).toString('base64')}`;
function installedVersion(name: string): string {
    const manifest = JSON.parse(fs.readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8')) as {version: string};
    return manifest.version;
}

// 脚本管理器在安装时缓存固定版本的通用库；仓库资源固定到已发布提交，更新资源时同步换提交。
const userscriptResourceCommit = 'c8f9d958b12bcaef61b9a83ac832e62084a805b3';
const userscriptRequires = [
    `https://cdn.jsdelivr.net/npm/vue@${installedVersion('vue')}/dist/vue.global.prod.js`,
    `https://cdn.jsdelivr.net/gh/FluentRead/FluentRead@${userscriptResourceCommit}/userscript/vueElementPlusBridge.v1.js`,
    `https://cdn.jsdelivr.net/npm/element-plus@${installedVersion('element-plus')}/dist/index.full.min.js`,
    `https://cdn.jsdelivr.net/npm/@element-plus/icons-vue@${installedVersion('@element-plus/icons-vue')}/dist/index.iife.min.js`,
    `https://cdn.jsdelivr.net/npm/tldts@${installedVersion('tldts')}/dist/index.umd.min.js`,
    'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako_inflate.min.js',
];
const metadata = createUserscriptMetadata({version: packageJson.userscriptVersion, iconDataUrl, requires: userscriptRequires});
const compressedUiLanguageBundles = Object.fromEntries(Object.entries(UI_LANGUAGE_BUNDLES)
    .filter(([language]) => language === 'en-US')
    .map(([language, bundle]) => [
    language,
    gzipSync(Buffer.from(JSON.stringify(bundle))).toString('base64'),
]));
const remoteUiLanguageBundles = Object.fromEntries(Object.entries(UI_LANGUAGE_BUNDLES)
    .filter(([language]) => language !== 'en-US')
    .map(([language, bundle]) => {
        const contents = JSON.stringify(bundle);
        const digest = createHash('sha256').update(contents).digest('hex').slice(0, 16);
        const fileName = `${language}.${digest}.json`;
        const filePath = resolve(root, 'userscript/languages', fileName);
        if (!fs.existsSync(filePath) || fs.readFileSync(filePath, 'utf8').trimEnd() !== contents) {
            throw new Error(`Userscript language data missing or stale: ${fileName}; run pnpm generate:userscript-languages`);
        }
        return [language, fileName];
    }));
const unicodeNotice = `/*\n${fs.readFileSync(resolve(root, 'public/third-party-notices/unicode-17.0.0.txt'), 'utf8')}\n*/`;
const serviceIconsNotice = `/*\n${fs.readFileSync(resolve(root, 'public/third-party-notices/lobe-icons-MIT.txt'), 'utf8')}\n*/`;
const browserShimPath = resolve(root, 'userscript/browser.ts');
const projectRoot = `${normalizePath(root)}/`;

// dexie 的官方入口以 Symbol.for('Dexie') 作为跨 realm 的单例注册表；该注册一旦进入油猴产物，
// 与宿主页面的 Dexie 副本撞上不同版本就会在入口处抛错。用产物文本兜底，防止别名将来被改坏。
const DEXIE_GLOBAL_REGISTRATION = /Symbol\s*\.\s*for\s*\(\s*(['"])Dexie\1\s*\)/u;

export function findDexieGlobalRegistration(code: string): boolean {
    return DEXIE_GLOBAL_REGISTRATION.test(code);
}

export const compatibilityPreludeStart = '/* FluentRead userscript compatibility prelude:start */';
export const compatibilityPreludeEnd = '/* FluentRead userscript compatibility prelude:end */';
export const executionGuardStart = '/* FluentRead userscript execution guard:start */';
export const executionGuardEnd = '/* FluentRead userscript execution guard:end */';

export function wrapUserscriptEntry(entryCode: string, bootstrapCode: string): string {
    return [
        metadata,
        unicodeNotice,
        serviceIconsNotice,
        executionGuardStart,
        'if (!globalThis.__fluentReadUserscriptBootstrapped) {',
        bootstrapCode,
        entryCode,
        '}',
        executionGuardEnd,
    ].join('\n');
}

// Via 等旧内核可能缺少共享核心使用的基础方法；在单文件入口最前方注入小型兼容层。
const compatibilityPrelude = `${compatibilityPreludeStart}
(function () {
    if (typeof Object.fromEntries !== 'function') {
        Object.defineProperty(Object, 'fromEntries', {
            configurable: true,
            writable: true,
            value: function (entries) {
                var result = {};
                Array.from(entries).forEach(function (entry) {
                    Object.defineProperty(result, entry[0], {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value: entry[1]
                    });
                });
                return result;
            }
        });
    }
    if (typeof Promise.allSettled !== 'function') {
        Object.defineProperty(Promise, 'allSettled', {
            configurable: true,
            writable: true,
            value: function (values) {
                return Promise.all(Array.from(values, function (value) {
                    return Promise.resolve(value).then(function (fulfilledValue) {
                        return {status: 'fulfilled', value: fulfilledValue};
                    }, function (reason) {
                        return {status: 'rejected', reason: reason};
                    });
                }));
            }
        });
    }
    if (typeof Array.prototype.flatMap !== 'function') {
        Object.defineProperty(Array.prototype, 'flatMap', {
            configurable: true,
            writable: true,
            value: function (callback, thisArg) {
                if (this === null || this === undefined) throw new TypeError('Array.prototype.flatMap called on null or undefined');
                if (typeof callback !== 'function') throw new TypeError('flatMap callback must be a function');
                var source = Object(this);
                var numericLength = Number(source.length) || 0;
                var length = Math.min(Math.max(Math.floor(numericLength), 0), 9007199254740991);
                var result = [];
                for (var index = 0; index < length; index += 1) {
                    if (!(index in source)) continue;
                    var mapped = callback.call(thisArg, source[index], index, source);
                    if (!Array.isArray(mapped)) {
                        result.push(mapped);
                        continue;
                    }
                    for (var mappedIndex = 0; mappedIndex < mapped.length; mappedIndex += 1) {
                        if (mappedIndex in mapped) result.push(mapped[mappedIndex]);
                    }
                }
                return result;
            }
        });
    }
}());
${compatibilityPreludeEnd}`;

type BrowserGlobal = 'browser' | 'chrome';

/**
 * 借助 TypeScript 符号解析查找真正未绑定的 browser/chrome 标识符；属性名和类型引用
 * 不应触发注入，避免对普通业务对象产生误改写。
 */
export function findFreeBrowserGlobals(code: string, id: string): BrowserGlobal[] {
    const sourceFile = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
    const options: ts.CompilerOptions = {
        allowJs: true,
        module: ts.ModuleKind.ESNext,
        noLib: true,
        noResolve: true,
        target: ts.ScriptTarget.Latest,
    };
    const host: ts.CompilerHost = {
        fileExists: (fileName) => fileName === id,
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => root,
        getDefaultLibFileName: () => '',
        getNewLine: () => '\n',
        getSourceFile: (fileName) => fileName === id ? sourceFile : undefined,
        readFile: (fileName) => fileName === id ? code : undefined,
        useCaseSensitiveFileNames: () => true,
        writeFile: () => undefined,
    };
    const checker = ts.createProgram([id], options, host).getTypeChecker();
    const found = new Set<BrowserGlobal>();
    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && (node.text === 'browser' || node.text === 'chrome')) {
            const parent = node.parent;
            const isPropertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node)
                || ((ts.isPropertyAssignment(parent)
                    || ts.isMethodDeclaration(parent)
                    || ts.isPropertyDeclaration(parent)
                    || ts.isPropertySignature(parent)
                    || ts.isMethodSignature(parent)) && parent.name === node);
            const isTypeOnlyReference = ts.isTypeReferenceNode(parent)
                || ts.isTypeQueryNode(parent)
                || ts.isQualifiedName(parent);
            if (!isPropertyName && !isTypeOnlyReference && !checker.getSymbolAtLocation(node)) {
                found.add(node.text);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return (['browser', 'chrome'] as const).filter((name) => found.has(name));
}

export function injectUserscriptBrowserImports(code: string, id: string): string | null {
    const [rawId, query = ''] = id.split('?', 2);
    const cleanId = normalizePath(rawId);
    const isScriptModule = /\.[cm]?[jt]sx?$/u.test(cleanId);
    const isVueScriptModule = cleanId.endsWith('.vue')
        && new URLSearchParams(query).get('type') === 'script';
    if (!cleanId.startsWith(projectRoot) || (!isScriptModule && !isVueScriptModule)) return null;

    const injected = findFreeBrowserGlobals(code, cleanId);
    if (injected.length === 0) return null;

    const specifiers = injected.map((name) => name === 'browser' ? 'default as browser' : 'chrome');
    return `import {${specifiers.join(', ')}} from ${JSON.stringify(browserShimPath)};\n${code}`;
}

/** 为项目内 TS/JS 与 Vue script 模块注入 userscript browser shim。 */
function injectUserscriptBrowserShim(): Plugin {
    return {
        name: 'inject-userscript-browser-shim',
        enforce: 'pre',
        transform(code, id) {
            const transformed = injectUserscriptBrowserImports(code, id);
            return transformed ? {code: transformed, map: null} : null;
        },
    };
}

/**
 * 把拆分出的 CSS、Userscript 元数据和兼容层合并进唯一入口，并阻止扩展全局泄漏到产物。
 */
function bundleUserscriptCss(): Plugin {
    return {
        name: 'bundle-userscript-css',
        enforce: 'post',
        generateBundle: {
          order: 'post',
          handler(_options, bundle) {
            const cssEntries = Object.entries(bundle).filter(([, item]) => item.type === 'asset' && item.fileName.endsWith('.css'));
            const css = cssEntries.map(([, item]) => String(item.type === 'asset' ? item.source : '')).join('\n');
            const compressedCss = gzipSync(Buffer.from(css, 'utf8')).toString('base64');
            cssEntries.forEach(([fileName]) => delete bundle[fileName]);

            const entry = Object.values(bundle).find((item) => item.type === 'chunk' && item.isEntry);
            if (!entry || entry.type !== 'chunk') throw new Error('Userscript entry chunk was not generated');

            const bootstrap = [
                compatibilityPrelude,
                `globalThis.__FLUENTREAD_ICON_DATA__=${JSON.stringify(iconDataUrl)};`,
                `globalThis.__fluentReadUserscriptCssCompressed=${JSON.stringify(compressedCss)};`,
            ].join('\n');
            // 入口内部的幂等标记只能在整个 IIFE 顶层求值后生效。脚本管理器若对同一
            // 文档再次注入，必须在最外层跳过整个 bundle，否则内联模块会重复创建
            // 配置 store、watch 和 preparation barrier，即使 bootstrap 最后选择返回。
            entry.code = wrapUserscriptEntry(entry.code, bootstrap);

            entry.code = entry.code.replace(/[\uFFFE\uFFFF]/gu, (character) => {
                const codePoint = character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
                return `\\u${codePoint}`;
            });

            const leakedGlobals = findFreeBrowserGlobals(entry.code, resolve(root, '.output/userscript/fluent-read.user.js'));
            if (leakedGlobals.length > 0) {
                throw new Error(`Userscript bundle contains unresolved extension globals: ${leakedGlobals.join(', ')}`);
            }

            if (findDexieGlobalRegistration(entry.code)) {
                throw new Error(
                    'Userscript bundle registers globalThis[Symbol.for("Dexie")]; import dexie through userscript/dexie.ts '
                    + 'so a host page carrying another Dexie version cannot abort the script (issue #524)',
                );
            }
          },
        },
        writeBundle(_options, bundle) {
            const files = Object.values(bundle).map((item) => item.fileName);
            if (files.length !== 1 || files[0] !== 'fluent-read.user.js') {
                throw new Error(`Userscript build must emit one file, received: ${files.join(', ')}`);
            }
        },
    };
}

/** 将 WXT 内容脚本声明展开为普通对象，使同一入口可在 userscript 单页 runtime 中复用。 */
function unwrapWxtEntrypoints(): Plugin {
    const entrypoints = new Set([
        resolve(root, 'entrypoints/content.ts'),
    ]);
    return {
        name: 'unwrap-wxt-entrypoints',
        enforce: 'pre',
        transform(code, id) {
            if (!entrypoints.has(id)) return null;
            return code.replace(/\bdefineContentScript\s*\(/gu, '((definition) => definition)(');
        },
    };
}

export const userscriptAliases = [
    // dexie 官方 ESM 入口把自身注册到跨 realm 共享的 globalThis[Symbol.for('Dexie')]，版本不一致时会在
    // 模块求值阶段直接抛错。脚本管理器（如 Safari 的 Userscripts）把脚本注入页面主 world，与宿主页面共享
    // 该注册表，必须换成不注册全局符号的入口，否则整个 bundle 会在入口处中断（issue #524）。
    {find: /^dexie$/u, replacement: resolve(root, 'userscript/dexie.ts')},
    {find: '@/src/platform/storage/credentialContext', replacement: resolve(root, 'userscript/credentialContext.ts')},
    {find: '@/src/platform/storage/configStorageRuntime', replacement: resolve(root, 'userscript/storage.ts')},
    // 扩展从本地资源读取界面语言；userscript 内嵌英文，其他语言从仓库静态 JSON 按需加载。
    {find: '@/src/platform/i18n/uiLanguageBundles', replacement: resolve(root, 'userscript/uiLanguageBundles.ts')},
    {find: /^@\/src\/services\/translation\/context\/browser$/u, replacement: resolve(root, 'userscript/pageContext.ts')},
    {find: /^@\/src\/services\/translation\/context$/u, replacement: resolve(root, 'userscript/pageTranslationContext.ts')},
    // app/content 只依赖 feature 公开契约；在此边界替换，才能保证扩展专属 runtime 不进入产物。
    {find: '@/src/features/area-translation/public', replacement: resolve(root, 'userscript/unsupportedCapabilities.ts')},
    {find: '@/src/features/image-translation/public', replacement: resolve(root, 'userscript/unsupportedCapabilities.ts')},
    {find: '@/src/features/video-subtitle/public', replacement: resolve(root, 'userscript/unsupportedCapabilities.ts')},
    {find: /^\.\/chrome-translator$/u, replacement: resolve(root, 'userscript/chromeTranslator.ts')},
    {find: '@wxt-dev/storage', replacement: resolve(root, 'userscript/storage.ts')},
    {find: 'webextension-polyfill', replacement: resolve(root, 'userscript/browser.ts')},
    {find: 'wxt/utils/content-script-ui/shadow-root', replacement: resolve(root, 'userscript/shadow-root.ts')},
    {find: '@', replacement: root},
];

export default defineConfig({
    root,
    publicDir: false,
    plugins: [unwrapWxtEntrypoints(), injectUserscriptBrowserShim(), vue(), bundleUserscriptCss()],
    resolve: {
        alias: userscriptAliases,
    },
    define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.VUE_APP_VERSION': JSON.stringify(packageJson.version),
        'process.env.VUE_APP_USERSCRIPT_VERSION': JSON.stringify(packageJson.userscriptVersion),
        __FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__: JSON.stringify(compressedUiLanguageBundles),
        __FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__: JSON.stringify(remoteUiLanguageBundles),
        __FLUENTREAD_USERSCRIPT_RESOURCE_COMMIT__: JSON.stringify(userscriptResourceCommit),
    },
    build: {
        outDir: resolve(root, '.output/userscript'),
        emptyOutDir: true,
        target: 'es2018',
        minify: 'esbuild',
        sourcemap: false,
        cssCodeSplit: false,
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        lib: {
            entry: resolve(root, 'userscript/main.ts'),
            name: 'FluentReadUserscript',
            formats: ['iife'],
            fileName: () => 'fluent-read.user.js',
        },
        rollupOptions: {
            external: ['vue', 'element-plus', '@element-plus/icons-vue', 'tldts'],
            output: {
                inlineDynamicImports: true,
                entryFileNames: 'fluent-read.user.js',
                globals: {
                    vue: 'Vue',
                    'element-plus': 'ElementPlus',
                    '@element-plus/icons-vue': 'ElementPlusIconsVue',
                    tldts: 'tldts',
                },
            },
        },
    },
});
