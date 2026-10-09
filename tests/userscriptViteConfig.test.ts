import fs, {readFileSync, realpathSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {runInNewContext} from 'node:vm';
import {describe, expect, it, vi} from 'vitest';
import {ungzip} from 'pako';
import {zhCNMessages} from '@/src/core/i18n/messages/zh-CN';
import {inflateWithPako} from '@/userscript/pakoRuntime';
import * as chineseCharacterData from '@/src/core/language/chineseVariants';
import * as functionWordData from '@/src/core/language/functionWordData';
import {createUserscriptCharacterDataCompressionPlugin} from '@/userscript/characterDataPlugin';
import * as userscriptConfigModule from '@/userscript/vite.config';
import {
    default as userscriptConfig,
    executionGuardEnd,
    executionGuardStart,
    createUserscriptCatalogCompressionPlugin,
    findDexieGlobalRegistration,
    findFreeBrowserGlobals,
    injectUserscriptBrowserImports,
    userscriptAliases,
    wrapUserscriptEntry,
} from '@/userscript/vite.config';

const entrypointId = resolve(process.cwd(), 'entrypoints/userscript-injection-fixture.ts');
const sourceModuleId = resolve(process.cwd(), 'src/app/content/runtime.ts');
const vueScriptModuleId = `${resolve(process.cwd(), 'src/features/selection-translation/ui/SelectionTranslator.vue')}?vue&type=script&setup=true&lang.ts`;

describe('GF pinned Vite inline styles', () => {
    const paths = {
        notice: 'src/features/page-notice/content/notice.css',
        picker: 'src/features/section-translation/content/picker.css',
        translationDisplay: 'src/ui/styles/translation-display.css',
        page: 'src/app/content/page.css',
        sentenceHighlight: 'src/ui/styles/bilingual-sentence-highlight.css',
        vocabularyReencounter: 'src/ui/styles/vocabulary-reencounter.css',
    };
    const createPlugin = (styles: Record<string, string> = {}) => {
        const factory = Reflect.get(userscriptConfigModule, 'createUserscriptInlineStylesPlugin') as unknown as (styles: Record<string, string>) => {
            buildStart: () => void;
            transform: (code: string, id: string) => {code: string; map: null} | null;
        };
        return factory(styles);
    };
    const evaluate = async (source: string, data: unknown) => {
        const {transformWithEsbuild} = await import('vite');
        const compiled = await transformWithEsbuild(source, 'pinned-inline-style.js', {format: 'cjs', target: 'es2018'});
        const realm = {module: {exports: {} as any}, __FLUENTREAD_USERSCRIPT_DATA__: data,
            fetch: () => {throw new Error('Unexpected CSS network');}};
        runInNewContext(compiled.code, realm, {timeout: 5000});
        return realm.module.exports.default;
    };
    it.each(Object.entries(paths))('captures the processed %s default string and exports identical UTF-8 synchronously', async (name, path) => {
        const styles: Record<string, string> = {}, value = `/* processed ${name} */\n.x{content:"  𱊯\\ ";}\0\ud800\r\n`;
        const transformed = createPlugin(styles).transform(`export default ${JSON.stringify(value)};`, resolve(process.cwd(), path) + '?inline')!.code;
        expect(styles).toEqual({[name]: value});
        expect(transformed).toContain('globalThis.__FLUENTREAD_USERSCRIPT_DATA__');
        expect(transformed).not.toMatch(/\b(?:await|eval|fetch|atob|inflateWithPako)\b/u);
        const restored = await evaluate(transformed, {inlineStyles: styles});
        expect(restored).toBe(value);
        expect(Buffer.from(restored, 'utf8')).toEqual(Buffer.from(value, 'utf8'));
        expect(createHash('sha256').update(restored).digest('hex')).toBe(createHash('sha256').update(value).digest('hex'));
        expect(await evaluate(transformed, {inlineStyles: {[name]: ''}})).toBe('');
    });
    it.each(['missing-object', 'missing-field', 'wrong-type'])('fails immediately for %s at every CSS port', async failure => {
        for (const [name, path] of Object.entries(paths)) {
            const transformed = createPlugin().transform('export default "processed";', resolve(process.cwd(), path) + '?inline')!.code;
            const data = failure === 'missing-object' ? {} : {inlineStyles: failure === 'missing-field' ? {} : {[name]: 1}};
            await expect(evaluate(transformed, data)).rejects.toThrow('Missing pinned userscript inline style: ' + name);
        }
    });
    it('rejects anything except one parsed string default export', () => {
        const plugin = createPlugin(), id = resolve(process.cwd(), paths.notice) + '?inline';
        for (const code of ['export default getStyle();', 'const css="x"; export default css;',
            'export default `x${sideEffect()}`;', 'export = "x";', 'export default "x"; sideEffect();', 'export default "unterminated']) {
            expect(() => plugin.transform(code, id)).toThrow('one default string export');
        }
        expect(plugin.transform('/* processed */ export default `x`;', id)).not.toBeNull();
    });
    it('requires the six exact absolute IDs with only the inline query and clears captured build state', () => {
        const styles: Record<string, string> = {}, plugin = createPlugin(styles), id = resolve(process.cwd(), paths.notice);
        for (const other of [id, id + '?inline&x=1', id + '?raw', id + '?inline=true', id + '.other?inline', 'notice.css?inline']) {
            expect(plugin.transform('export default "x";', other)).toBeNull();
        }
        plugin.transform('export default "x";', id + '?inline');
        plugin.buildStart();
        expect(styles).toEqual({});
    });
    it.each(['standard', 'standalone', 'greasyfork', 'standalone-with-gf-env'] as const)
    ('registers the post-transform exclusively for the GF source output (%s)', async mode => {
        vi.stubEnv('FLUENTREAD_USERSCRIPT_STANDALONE', mode.startsWith('standalone') ? '1' : '0');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_GREASYFORK_SOURCE', mode.includes('gf') || mode === 'greasyfork' ? '1' : '0');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_VENDOR_URL', 'https://fixture.invalid/vendor.js');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_DATA_URL', 'https://fixture.invalid/data.js');
        try {
            vi.resetModules();
            const {default: config} = await import('@/userscript/vite.config');
            const plugin = (config as {plugins: Array<{name?: string; enforce?: string}>}).plugins.find(item => item.name === 'pin-gf-inline-styles');
            if (mode === 'greasyfork') expect(plugin?.enforce).toBe('post');
            else expect(plugin).toBeUndefined();
        } finally {vi.unstubAllEnvs();vi.resetModules();}
    });
});

describe('CommonJS initialization policy by userscript output', () => {
    it.each(['standard', 'standalone', 'greasyfork'] as const)
    ('limits deterministic wrapping to the standard output (%s)', async mode => {
        vi.stubEnv('FLUENTREAD_USERSCRIPT_STANDALONE', mode === 'standalone' ? '1' : '0');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_GREASYFORK_SOURCE', mode === 'greasyfork' ? '1' : '0');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_VENDOR_URL', 'https://fixture.invalid/vendor.js');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_DATA_URL', 'https://fixture.invalid/data.js');
        try {
            vi.resetModules();
            const {default: config} = await import('@/userscript/vite.config');
            expect((config as {build: {commonjsOptions?: {strictRequires?: boolean}}}).build.commonjsOptions?.strictRequires)
                .toBe(mode === 'standard' ? true : undefined);
        } finally {
            vi.unstubAllEnvs();
            vi.resetModules();
        }
    });
});

describe('GF-only statistics repository boundary', () => {
    it.each(['standard', 'standalone', 'greasyfork', 'standalone-with-gf-env'] as const)
    ('keeps real repositories outside the GF source output (%s)', async mode => {
        vi.stubEnv('FLUENTREAD_USERSCRIPT_STANDALONE', mode.startsWith('standalone') ? '1' : '0');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_GREASYFORK_SOURCE', mode.includes('gf') || mode === 'greasyfork' ? '1' : '0');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_VENDOR_URL', 'https://fixture.invalid/vendor.js');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_DATA_URL', 'https://fixture.invalid/data.js');
        try {
            vi.resetModules();
            const {userscriptAliases: aliases} = await import('@/userscript/vite.config');
            for (const repository of ['modelUsageRepository', 'translationStatsRepository']) {
                const alias = aliases.find(item => item.find === `@/src/platform/storage/${repository}`);
                if (mode === 'greasyfork') expect(alias?.replacement).toMatch(/userscript\/unsupportedCapabilities\.ts$/u);
                else expect(alias).toBeUndefined();
            }
        } finally {
            vi.unstubAllEnvs();
            vi.resetModules();
        }
    });
});

describe('authoritative site catalogs with an external pinned data asset', () => {
    it.each(['unchanged', 'old-asset', 'stale-non-id-field', 'reordered', 'removed-rule', 'missing-runtime-rule'] as const)
    ('reconciles %s without mutating the external asset', async variant => {
        const vm = await vi.importActual<typeof import('node:vm')>('node:vm');
        const authoritative = JSON.parse(readFileSync(resolve(process.cwd(), 'src/core/site-adaptation/catalog/established.json'), 'utf8'));
        const data = vm.runInNewContext(readFileSync(resolve(process.cwd(), 'userscript/resources/fluentread-data.v1.js'), 'utf8'), {}, {timeout: 5000});
        // 历史夹具同时覆盖缺规则与同ID字段过期，刷新固定资源后也保留这两条更新路径。
        data.siteCatalogs.established = structuredClone(authoritative);
        if (variant === 'old-asset') data.siteCatalogs.established.shift();
        if (variant === 'old-asset' || variant === 'stale-non-id-field') {
            const stale = data.siteCatalogs.established.find((rule: {id: string}) => rule.id === authoritative[1].id);
            expect(stale.id).toBe(authoritative[1].id);
            stale.match = {hosts: ['outdated.fixture.invalid']};
            expect(stale.match).not.toEqual(authoritative[1].match);
        }
        if (variant === 'reordered' || variant === 'missing-runtime-rule') data.siteCatalogs.established.reverse();
        if (variant === 'removed-rule') data.siteCatalogs.established.push({id: 'removed-pinned-rule', match: {hosts: ['removed.invalid']}});
        vi.doMock('node:vm', () => ({...vm, runInNewContext: () => data}));
        vi.stubEnv('FLUENTREAD_USERSCRIPT_GREASYFORK_SOURCE', '1');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_VENDOR_URL', 'https://fixture.invalid/vendor.js');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_DATA_URL', 'https://fixture.invalid/data.js');
        try {
            vi.resetModules();
            const {createUserscriptCatalogCompressionPlugin: createPlugin} = await import('@/userscript/vite.config');
            const {transformWithEsbuild} = await import('vite');
            const plugin = createPlugin();
            const resolveId = typeof plugin.resolveId === 'function' ? plugin.resolveId : plugin.resolveId!.handler;
            const load = typeof plugin.load === 'function' ? plugin.load : plugin.load!.handler;
            const id = await Reflect.apply(resolveId, {}, ['./catalog/established.json', resolve(process.cwd(), 'src/core/site-adaptation/pack.ts')]);
            const source = await Reflect.apply(load, {}, [id]);
            const compiled = await transformWithEsbuild(source, 'pinned-catalog.js', {format: 'cjs', target: 'es2018'});
            if (variant === 'missing-runtime-rule') data.siteCatalogs.established = data.siteCatalogs.established.filter((rule: {id: string}) => rule.id !== 'openrouter');
            const before = JSON.stringify(data), original = data.siteCatalogs.established;
            const realm = {module: {exports: {} as any}, __FLUENTREAD_USERSCRIPT_DATA__: data};
            if (variant === 'missing-runtime-rule') {
                expect(() => vm.runInNewContext(compiled.code, realm, {timeout: 5000})).toThrow('Missing pinned userscript site rule: openrouter');
            } else {
                vm.runInNewContext(compiled.code, realm, {timeout: 5000});
                const result = realm.module.exports.default;
                expect(result).toEqual(authoritative);
                if (variant === 'unchanged') expect(result).toBe(original);
                for (const rule of original) {
                    const expected = authoritative.find((current: {id: string}) => current.id === rule.id);
                    if (expected) {
                        const current = result.find((item: {id: string}) => item.id === rule.id);
                        if (JSON.stringify(rule) === JSON.stringify(expected)) expect(current).toBe(rule);
                        else expect(current).not.toBe(rule);
                    }
                }
            }
            expect(JSON.stringify(data)).toBe(before);
        } finally {vi.doUnmock('node:vm');vi.unstubAllEnvs();vi.resetModules();}
    });
});

describe('userscript browser shim injection', () => {
    it('pins each remote language file to a commit containing exactly its built contents', () => {
        const defines = (userscriptConfig as {define: Record<string, string>}).define;
        const commit = JSON.parse(defines.__FLUENTREAD_USERSCRIPT_RESOURCE_COMMIT__);
        const bundles = JSON.parse(defines.__FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__) as Record<string, string>;
        expect(commit).toMatch(/^[a-f0-9]{40}$/u);
        expect(Object.keys(bundles)).toHaveLength(5);
        for (const file of Object.values(bundles)) {
            const path = `userscript/languages/${file}`;
            const committed = execFileSync('git', ['show', `${commit}:${path}`], {cwd: process.cwd(), encoding: 'utf8'});
            expect(committed).toBe(readFileSync(resolve(process.cwd(), path), 'utf8'));
        }
    });
    it('embeds the complete Chinese fallback catalog as lossless static data', () => {
        const plugin = createUserscriptCatalogCompressionPlugin() as unknown as {
            resolveId: (source: string, importer: string) => string | null;
            load: (id: string) => string | null;
        };
        const id = plugin.resolveId('./messages/zh-CN', resolve(process.cwd(), 'src/core/i18n/index.ts'));
        expect(id).toBeTruthy();
        const moduleSource = plugin.load(id!);
        const base64 = moduleSource?.match(/atob\("([A-Za-z0-9+/=]+)"\)/u)?.[1];
        expect(base64).toBeTruthy();
        const restored = JSON.parse(gunzipSync(Buffer.from(base64!, 'base64')).toString('utf8'));
        expect(restored).toEqual(zhCNMessages);
        vi.stubGlobal('pako', {ungzip});
        try {
            expect(JSON.parse(inflateWithPako(new Uint8Array(Buffer.from(base64!, 'base64'))))).toEqual(zhCNMessages);
        } finally {
            vi.unstubAllGlobals();
        }
        expect(moduleSource).toContain(createHash('sha256').update(gunzipSync(Buffer.from(base64!, 'base64'))).digest('hex'));
    });

    it('keeps all site rule JSON data intact when embedding compressed offline catalogs', () => {
        const plugin = createUserscriptCatalogCompressionPlugin() as unknown as {
            resolveId: (source: string, importer: string) => string | null;
            load: (id: string) => string | null;
        };
        const importer = resolve(process.cwd(), 'src/core/site-adaptation/catalog.ts');
        for (const name of ['established', 'websites', 'profiles']) {
            const id = plugin.resolveId(`./catalog/${name}.json`, importer);
            expect(id).toContain('fluentread-userscript-site-catalog:');
            const moduleSource = plugin.load(id!);
            const base64 = moduleSource?.match(/atob\("([A-Za-z0-9+/=]+)"\)/u)?.[1];
            expect(base64).toBeTruthy();
            const original = JSON.parse(readFileSync(resolve(process.cwd(), `src/core/site-adaptation/catalog/${name}.json`), 'utf8'));
            const restored = JSON.parse(gunzipSync(Buffer.from(base64!, 'base64')).toString('utf8'));
            expect(restored).toEqual(original);
            expect(moduleSource).toContain(createHash('sha256').update(JSON.stringify(original)).digest('hex'));
        }
        expect(plugin.resolveId('./catalog/other.json', importer)).toBeNull();
    });

    it('wraps the complete single-file runtime in a duplicate-injection guard', () => {
        const wrapped = wrapUserscriptEntry('ENTRY_SENTINEL', 'BOOTSTRAP_SENTINEL');
        const guardStart = wrapped.indexOf(executionGuardStart);
        const condition = wrapped.indexOf('if (!globalThis.__fluentReadUserscriptBootstrapped) {');
        const bootstrap = wrapped.indexOf('BOOTSTRAP_SENTINEL');
        const entry = wrapped.indexOf('ENTRY_SENTINEL');
        const guardEnd = wrapped.indexOf(executionGuardEnd);

        expect(guardStart).toBeGreaterThan(-1);
        expect(condition).toBeGreaterThan(guardStart);
        expect(bootstrap).toBeGreaterThan(condition);
        expect(entry).toBeGreaterThan(bootstrap);
        expect(guardEnd).toBeGreaterThan(entry);
    });

    it('在 app 使用的 public contract 边界替换扩展专属 feature 与可信 GM 凭据上下文', () => {
        const stringAliases = new Map(userscriptAliases
            .filter((entry): entry is {find: string; replacement: string} => typeof entry.find === 'string')
            .map((entry) => [entry.find, entry.replacement]));

        for (const feature of ['area-translation', 'image-translation', 'video-subtitle']) {
            expect(stringAliases.get(`@/src/features/${feature}/public`)).toMatch(/userscript\/unsupportedCapabilities\.ts$/u);
        }
        expect(stringAliases.get('@/src/features/writing-assistant/public')).toMatch(/userscript\/writingAssistant\.ts$/u);
        expect(stringAliases.get('@/src/platform/storage/credentialContext')).toMatch(/userscript\/credentialContext\.ts$/u);
        expect(stringAliases.get('@/src/platform/storage/configStorageRuntime')).toMatch(/userscript\/storage\.ts$/u);
        expect(userscriptAliases.at(-1)?.find).toBe('@');
    });

    it('把 dexie 换成不注册全局单例的入口，且不改写 dexie 自身的实现产物路径', () => {
        const dexieAlias = userscriptAliases.find((entry) => entry.find instanceof RegExp
            && (entry.find as RegExp).test('dexie'));

        expect(dexieAlias?.replacement).toMatch(/userscript\/dexie\.ts$/u);
        // 别名必须严格匹配裸模块名；否则 userscript/dexie.ts 内部对实现产物的引用会被改写回自身。
        expect((dexieAlias!.find as RegExp).test('dexie/dist/dexie.min.js')).toBe(false);
    });

    it('产物中残留 Dexie 全局注册时能被构建守卫识别', () => {
        expect(findDexieGlobalRegistration('const s=Symbol.for("Dexie");globalThis[s]=D;')).toBe(true);
        expect(findDexieGlobalRegistration("globalThis[Symbol.for('Dexie')]=D;")).toBe(true);
        expect(findDexieGlobalRegistration('Symbol . for ( "Dexie" )')).toBe(true);
        expect(findDexieGlobalRegistration('Symbol.for("vercel.ai.schema")')).toBe(false);
        expect(findDexieGlobalRegistration('const label="Dexie";')).toBe(false);
    });

    it('imports only unresolved browser globals', () => {
        const transformed = injectUserscriptBrowserImports(
            'browser.runtime.sendMessage({}); chrome.runtime.getURL("icon.png");',
            entrypointId,
        );

        expect(transformed).toContain('import {default as browser, chrome}');

        expect(injectUserscriptBrowserImports(
            'browser.runtime.sendMessage({type: "from-app"});',
            sourceModuleId,
        )).toContain('import {default as browser}');
        expect(injectUserscriptBrowserImports(
            'chrome.runtime.getURL("from-vue.png");',
            vueScriptModuleId,
        )).toContain('import {chrome}');
    });

    it('ignores property names and lexically bound identifiers', () => {
        expect(injectUserscriptBrowserImports(
            'const extensionGlobal = {} as {browser?: unknown}; void extensionGlobal.browser;',
            entrypointId,
        )).toBeNull();
        expect(injectUserscriptBrowserImports(
            'function useBrowser(browser: {runtime: unknown}) { return browser.runtime; }',
            entrypointId,
        )).toBeNull();
        expect(injectUserscriptBrowserImports(
            'import chrome from "webextension-polyfill"; void chrome.runtime;',
            entrypointId,
        )).toBeNull();
        expect(injectUserscriptBrowserImports(
            'browser.runtime.sendMessage({});',
            '/tmp/fluentread-external-module.ts',
        )).toBeNull();
        expect(injectUserscriptBrowserImports(
            '<script setup>browser.runtime.sendMessage({})</script>',
            resolve(process.cwd(), 'src/RawComponent.vue'),
        )).toBeNull();
    });

    it('checks generated JavaScript for free extension globals', () => {
        const bundleId = resolve(process.cwd(), '.output/userscript/fluent-read.user.js');
        expect(findFreeBrowserGlobals(
            'const browser = {runtime: {}}; void browser.runtime; const chrome = browser; void chrome.runtime;',
            bundleId,
        )).toEqual([]);
        expect(findFreeBrowserGlobals(
            'browser.runtime.sendMessage({}); chrome.runtime.getURL("icon.png");',
            bundleId,
        )).toEqual(['browser', 'chrome']);
    });
});


describe('userscript lossless Unicode character data', () => {
    const dataPath = resolve(process.cwd(), 'src/core/language/chineseVariants.ts');
    const wordDataPath = resolve(process.cwd(), 'src/core/language/functionWordData.ts');
    const createPlugin = (enabled = true) => createUserscriptCharacterDataCompressionPlugin(process.cwd(), enabled) as unknown as {
        transform: (code: string, id: string) => {code: string; map: null} | null;
    };
    const restoreExports = (moduleSource: string, names: readonly string[]) => {
        const body = moduleSource.replace("import {inflateWithPako} from '@/userscript/pakoRuntime';", '')
            .replace(/export const /gu, 'const ');
        // 使用生产解压适配器和真实 pako；禁止 fromCodePoint，覆盖旧内核上的补充平面还原。
        return runInNewContext(
            'String.fromCodePoint = undefined;\n' + body + '\n({' + names.join(',') + '})',
            {atob: (value: string) => Buffer.from(value, 'base64').toString('binary'), Uint8Array, inflateWithPako},
        );
    };

    it('restores every generated Unicode character exactly before Chinese detection consumes it', () => {
        const original = readFileSync(dataPath, 'utf8');
        const transformed = createPlugin().transform(original, dataPath);
        expect(transformed).not.toBeNull();
        vi.stubGlobal('pako', {ungzip});
        try {
            const restored = restoreExports(transformed!.code, Object.keys(chineseCharacterData));
            expect(restored).toEqual({...chineseCharacterData});
            for (const value of Object.values(chineseCharacterData)) {
                expect(typeof value).toBe('string');
                expect(value.length).toBeGreaterThan(0);
            }
            expect(Array.from(restored.simplifiedOnlyCharacters as string).some((character) => character.codePointAt(0)! > 0xFFFF)).toBe(true);
            expect(Array.from(restored.traditionalOnlyCharacters as string).some((character) => character.codePointAt(0)! > 0xFFFF)).toBe(true);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('restores all 45 function-word strings byte for byte and preserves the original lexicon digest', () => {
        const entries = Object.entries(functionWordData).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
        expect(entries).toHaveLength(45);
        // 提取前四组功能词原始字符串的摘要；按导出名排序，不依赖 module namespace 的枚举实现。
        expect(createHash('sha256').update(JSON.stringify(entries)).digest('hex'))
            .toBe('6b56ec4873ca9ec2f137f93f32987c438a5b54ba6024e64e9de33ff314b77131');
        const transformed = createPlugin().transform(readFileSync(wordDataPath, 'utf8'), wordDataPath)!;
        vi.stubGlobal('pako', {ungzip});
        try {
            const restored = restoreExports(transformed.code, Object.keys(functionWordData));
            expect(restored).toEqual({...functionWordData});
            for (const [name, value] of entries) {
                expect(Buffer.from(restored[name], 'utf8')).toEqual(Buffer.from(value, 'utf8'));
            }
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it.each([dataPath, wordDataPath])('preserves unsorted strings, repeated characters, surrogate pairs and empty exports in %s', currentPath => {
        const values = {sample: 'A𱊯A\0\ud800', empty: ''};
        const original = Object.entries(values).map(([name, value]) => 'export const ' + name + ' = ' + JSON.stringify(value) + ';').join('\n');
        const transformed = createPlugin().transform(original, currentPath)!;
        vi.stubGlobal('pako', {ungzip});
        try {
            expect(restoreExports(transformed.code, Object.keys(values))).toEqual(values);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it.each([dataPath, wordDataPath])('rejects executable additions to %s instead of dropping or compressing them', currentPath => {
        const original = readFileSync(currentPath, 'utf8');
        expect(() => createPlugin().transform(original + '\nsideEffect();', currentPath)).toThrow('only exported const strings');
        expect(() => createPlugin().transform('export const data = makeData();', currentPath)).toThrow('only exported const strings');
        expect(() => createPlugin().transform('const privateData = "data";', currentPath)).toThrow('only exported const strings');
    });

    it('leaves Greasy Fork source and every other module untouched', () => {
        const original = readFileSync(dataPath, 'utf8');
        expect(createPlugin(false).transform(original, dataPath)).toBeNull();
        expect(createPlugin(false).transform(readFileSync(wordDataPath, 'utf8'), wordDataPath)).toBeNull();
        expect(createPlugin().transform(original, resolve(process.cwd(), 'src/core/language/chinese.ts'))).toBeNull();
        expect(createPlugin().transform(original, resolve(process.cwd(), 'src/core/language/lexicon.ts'))).toBeNull();
        expect(createPlugin().transform(original, wordDataPath + '.backup')).toBeNull();
    });
});


describe('offline precise-version vendor license fallbacks', () => {
    const licenseRoot = resolve(process.cwd(), 'userscript/licenses');
    const fallbackPackages = [
        {name: '@ai-sdk/provider-utils', version: '4.0.46', license: 'Apache-2.0',
            files: ['provider-utils-Vercel.txt', 'Apache-2.0.txt', 'provider-utils-zod3-ISC.txt']},
        {name: 'franc-min', version: '6.2.0', license: 'MIT', files: ['franc-min-MIT.txt']},
    ];
    const normalize = (text: string) => text.trim().replace(/[ \t]+$/gmu, '');
    const installedRoot = (name: string, version: string) => {
        const pnpm = resolve(realpathSync(resolve(process.cwd(), 'node_modules')), '.pnpm');
        const prefix = name.replace('/', '+') + '@' + version;
        const folder = readdirSync(pnpm).find(item => item === prefix || item.startsWith(prefix + '_'));
        if (!folder) throw new Error(`Missing existing fixture dependency: ${name}@${version}`);
        return resolve(pnpm, folder, 'node_modules', name);
    };
    const generate = async (roots: string[]) => {
        const {default: config} = await import('@/userscript/vendor.vite.config');
        const plugin = (config as {plugins: {generateBundle: Function | {handler: Function}}[]}).plugins[0];
        const hook = typeof plugin.generateBundle === 'function' ? plugin.generateBundle : plugin.generateBundle.handler;
        const chunk = {type: 'chunk', isEntry: true, moduleIds: roots.map(root => root + '/index.js'), code: 'globalThis.fixtureExecuted = 17;'};
        await Reflect.apply(hook, {}, [{}, {'vendor.js': chunk}, false]);
        return chunk.code;
    };
    it.each(fallbackPackages)('includes every complete official text for $name@$version', async item => {
        const source = await generate([installedRoot(item.name, item.version)]);
        expect(source).toContain(`${item.name} ${item.version} — ${item.license}`);
        for (const file of item.files) expect(source).toContain(normalize(readFileSync(resolve(licenseRoot, file), 'utf8')));
        if (item.name === '@ai-sdk/provider-utils') {
            expect(source).toContain('Copyright 2023 Vercel, Inc.');
            expect(source).toContain('Copyright (c) 2020, Stefan Terdell');
            expect(source).toContain('Copyright (c) 2025, Vercel Inc.');
            expect(source).toContain('TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION');
        } else {
            expect(source.match(/Copyright/gu)).toHaveLength(4);
        }
    });
    it.each(fallbackPackages.flatMap(item => ['version', 'license'].map(field => ({...item, field}))))
    ('rejects $field drift for $name', async item => {
        const root = installedRoot(item.name, item.version), original = fs.readFileSync;
        const spy = vi.spyOn(fs, 'readFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, ...args: unknown[]) => {
            if (String(file) === resolve(root, 'package.json')) {
                const manifest = JSON.parse(original(file, 'utf8'));
                manifest[item.field] = item.field === 'version' ? '0.0.0' : 'UNLICENSED';
                return JSON.stringify(manifest);
            }
            return Reflect.apply(original, fs, [file, ...args]);
        }) as typeof fs.readFileSync);
        try {await expect(generate([root])).rejects.toThrow(/vendor license fallback.*mismatch/iu);}
        finally {spy.mockRestore();}
    });
    it.each(['provider-utils-Vercel.txt', 'Apache-2.0.txt', 'provider-utils-zod3-ISC.txt', 'franc-min-MIT.txt'].flatMap(file =>
        ['missing', 'bad-hash'].map(failure => ({file, failure}))))
    ('rejects $failure for offline $file', async ({file, failure}) => {
        const item = fallbackPackages.find(item => item.files.includes(file))!, original = fs.readFileSync;
        const spy = vi.spyOn(fs, 'readFileSync').mockImplementation(((path: fs.PathOrFileDescriptor, ...args: unknown[]) => {
            if (String(path) === resolve(licenseRoot, file)) {
                if (failure === 'missing') throw new Error('Fixture missing pinned license file');
                return Buffer.from('Fixture corrupted license');
            }
            return Reflect.apply(original, fs, [path, ...args]);
        }) as typeof fs.readFileSync);
        try {await expect(generate([installedRoot(item.name, item.version)])).rejects.toThrow(failure === 'missing' ? /missing pinned license/iu : /vendor license fallback.*hash/iu);}
        finally {spy.mockRestore();}
    });
    it('preserves the other fourteen real installed package declarations byte for byte', async () => {
        const current = readFileSync(resolve(process.cwd(), 'userscript/resources/fluentread-vendor.v1.js'), 'utf8');
        const blocks = [...current.matchAll(/\/\*\n([^\s]+) ([^\s]+) — ([^\n]+)\n([\s\S]*?)\n\*\//gu)]
            .filter(match => !fallbackPackages.some(item => item.name === match[1]));
        expect(blocks).toHaveLength(14);
        const source = await generate(blocks.map(match => installedRoot(match[1], match[2])));
        for (const block of blocks) expect(source).toContain(block[0]);
        const realm: Record<string, unknown> = {};
        runInNewContext(source, realm);
        expect(realm.fixtureExecuted).toBe(17);
    });
});


describe('GF pinned pure language data', () => {
    const paths = ['src/core/language/chineseVariants.ts', 'src/core/language/functionWordData.ts'];
    const originalTables = [{...chineseCharacterData}, {...functionWordData}];
    const allStrings = {...chineseCharacterData, ...functionWordData};
    const transform = (code: string, path: string) => {
        const factory = createUserscriptCharacterDataCompressionPlugin as unknown as (root: string, enabled: boolean, external: boolean) => {
            transform: (code: string, path: string) => {code: string; map: null} | null;
        };
        return factory(process.cwd(), true, true).transform(code, resolve(process.cwd(), path))!.code;
    };
    const evaluate = async (source: string, data: unknown) => {
        const {transformWithEsbuild} = await import('vite');
        const compiled = await transformWithEsbuild(source, 'pinned-language-data.ts', {format: 'cjs', target: 'es2018'});
        const realm = {module: {exports: {} as any}, __FLUENTREAD_USERSCRIPT_DATA__: data,
            fetch: () => {throw new Error('Unexpected fixture network');},
            require: () => {throw new Error('Unexpected asynchronous/compressed data import');}};
        runInNewContext(compiled.code, realm, {timeout: 5000});
        return realm.module.exports;
    };
    it.each(paths)('exports every original string synchronously with exact UTF-8 bytes and SHA in %s', async path => {
        const original = originalTables[paths.indexOf(path)], source = readFileSync(resolve(process.cwd(), path), 'utf8');
        const transformed = transform(source, path);
        expect(transformed).toContain('globalThis.__FLUENTREAD_USERSCRIPT_DATA__');
        expect(transformed).not.toMatch(/\b(?:await|eval|fetch|atob|inflateWithPako)\b/u);
        const restored = await evaluate(transformed, {characterData: allStrings});
        expect(Object.keys(restored)).toHaveLength(Object.keys(original).length);
        for (const [name, value] of Object.entries(original)) {
            expect(restored[name]).toBe(value);
            expect(Buffer.from(restored[name], 'utf8')).toEqual(Buffer.from(value, 'utf8'));
            expect(createHash('sha256').update(restored[name]).digest('hex')).toBe(createHash('sha256').update(value).digest('hex'));
        }
        if (path === paths[0]) {
            expect(Array.from(restored.simplifiedOnlyCharacters as string).some(character => character.codePointAt(0)! > 0xFFFF)).toBe(true);
            for (const provenance of ['https://www.unicode.org/Public/17.0.0/ucd/Unihan.zip',
                '3f23cd71872633f3350875d25bd388e83b60fa71807634c9a600ec26f38a68ab',
                'd1c817dd7db84295dab0643c277d97c2fa742c245f8824e6736c2a0935095325', 'Unicode License V3']) {
                expect(transformed).toContain(provenance);
            }
        }
    });
    it.each(paths)('preserves unsorted spaces, repeated supplementary characters, lone surrogates and empty strings in pinned %s', async path => {
        const values = {sample: '  A𱊯A\0\ud800 Z  ', empty: ''};
        const source = Object.entries(values).map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};`).join('\n');
        const restored = await evaluate(transform(source, path), {characterData: values});
        expect(restored.sample).toBe(values.sample);
        expect(restored.empty).toBe('');
    });
    it.each(paths.flatMap(path => ['missing-object', 'missing-field', 'wrong-type'].map(failure => ({path, failure}))))
    ('fails synchronously for $failure in $path', async ({path, failure}) => {
        const table = originalTables[paths.indexOf(path)], name = Object.keys(table)[0];
        const strings: Record<string, unknown> = {...allStrings};
        if (failure === 'missing-field') delete strings[name];
        if (failure === 'wrong-type') strings[name] = 1;
        const data = failure === 'missing-object' ? {} : {characterData: strings};
        await expect(evaluate(transform(readFileSync(resolve(process.cwd(), path), 'utf8'), path), data))
            .rejects.toThrow('Missing pinned userscript language string: ' + name);
    });
    it.each(paths)('keeps the original AST rejection for executable pinned %s', path => {
        const source = readFileSync(resolve(process.cwd(), path), 'utf8');
        expect(() => transform(source + '\nsideEffect();', path)).toThrow('only exported const strings');
    });
    it('initializes the actual Chinese patterns and ordered word Sets immediately from pinned modules', async () => {
        const tables = await Promise.all(paths.map(path => evaluate(transform(readFileSync(resolve(process.cwd(), path), 'utf8'), path), {characterData: allStrings})));
        const {transformWithEsbuild} = await import('vite');
        const codes = await import('@/src/core/language/codes');
        const originalChinese = await import('@/src/core/language/chinese');
        const originalLexicon = await import('@/src/core/language/lexicon');
        const load = async (file: string, ports: Record<string, unknown>) => {
            const source = readFileSync(resolve(process.cwd(), file), 'utf8');
            const compiled = await transformWithEsbuild(source, file, {format: 'cjs', target: 'es2018'});
            const realm = {module: {exports: {} as any}, require: (name: string) => {
                if (!(name in ports)) throw new Error('Unexpected consumer import: ' + name);
                return ports[name];
            }};
            runInNewContext(compiled.code, realm, {timeout: 5000});
            return realm.module.exports;
        };
        const chinese = await load('src/core/language/chinese.ts', {'./codes': codes, './chineseVariants': tables[0]});
        for (const value of ['', '这是中文翻译设置', '這是中文翻譯設定', '你好', '日本国立大学', '𱊯語']) {
            expect(chinese.classifyChineseHan(value)).toBe(originalChinese.classifyChineseHan(value));
        }
        const lexicon = await load('src/core/language/lexicon.ts', {'./functionWordData': tables[1]});
        for (const [script, languages] of Object.entries(originalLexicon.FUNCTION_WORDS)) {
            for (const [language, words] of Object.entries(languages)) {
                expect(Array.from(lexicon.FUNCTION_WORDS[script][language])).toEqual(Array.from(words));
            }
        }
    });
});
