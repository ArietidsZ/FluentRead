import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, relative, resolve, sep} from 'node:path';
import {describe, expect, it} from 'vitest';

const PROJECT_ROOT = resolve(__dirname, '../..');

function projectPath(...parts: string[]): string {
    return resolve(PROJECT_ROOT, ...parts);
}

function listSourceFiles(directory: string): string[] {
    const root = projectPath(directory);
    const files: string[] = [];

    const visit = (current: string) => {
        // Step 1: 递归读取目录，只收集会参与 TypeScript/Vue 依赖图的源码。
        for (const name of readdirSync(current)) {
            const absolute = resolve(current, name);
            if (statSync(absolute).isDirectory()) {
                visit(absolute);
            } else if (/\.(?:ts|vue)$/.test(name) && !name.endsWith('.d.ts')) {
                files.push(absolute);
            }
        }
    };

    visit(root);
    return files.sort();
}

function readSource(path: string): string {
    return readFileSync(path, 'utf8');
}

function relativePath(path: string): string {
    return relative(PROJECT_ROOT, path).split(sep).join('/');
}

function importSpecifiers(source: string): string[] {
    // Step 1: 同时识别静态 import/export-from 和动态 import，覆盖现有 WXT/userscript 写法。
    const imports = new Set<string>();
    const pattern = /(?:\bfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) imports.add(match[1]);
    return [...imports];
}

function resolveProjectImport(fromFile: string, specifier: string): string | null {
    let unresolved: string;
    if (specifier.startsWith('@/')) {
        unresolved = projectPath(specifier.slice(2));
    } else if (specifier.startsWith('.')) {
        unresolved = resolve(dirname(fromFile), specifier);
    } else {
        return null;
    }

    for (const candidate of [
        unresolved,
        `${unresolved}.ts`,
        `${unresolved}.vue`,
        resolve(unresolved, 'index.ts'),
        resolve(unresolved, 'index.vue'),
    ]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
}

function lineCount(path: string): number {
    let source = readSource(projectPath(path));
    if (path.startsWith('src/')) {
        const pattern = path.endsWith('.vue')
            ? /^<!--[\s\S]*?-->\s*/u
            : /^\/\*\*[\s\S]*?\*\/\s*/u;
        const header = source.match(pattern)?.[0];
        if (header?.includes('@file ' + path)) source = source.slice(header.length);
    }
    return source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length;
}

const APP_COMPOSITION_ROOT_ENTRYPOINT_IMPORTS = new Map<string, Set<string>>();

const PROVIDER_TRANSITIONAL_ENTRYPOINT_IMPORTS = new Set<string>();

const FEATURE_BROWSER_ENTRYPOINT_IMPORTS = new Map<string, Set<string>>();

const COMPLEXITY_DEBT_CEILINGS: Record<string, number> = {
    'entrypoints/background.ts': 11,
    'entrypoints/content.ts': 11,
    'entrypoints/offscreen/main.ts': 3,
    'entrypoints/shadowBridge.content.ts': 9,
    'entrypoints/youtubeBridge.content.ts': 9,
    'src/app/background/contextMenuRuntime.ts': 157,
    'src/app/background/messageRuntime.ts': 165,
    'src/app/background/runtime.ts': 22,
    'src/app/content/hotkeyRuntime.ts': 208,
    'src/app/content/messageRuntime.ts': 169,
    'src/app/content/runtime.ts': 269,
    'src/features/settings/ui/SettingsSections.vue': 1458,
    'src/features/full-page-translation/content/runtime.ts': 2164,
    'src/features/video-subtitle/content/runtime.ts': 1887,
};

describe('architecture module boundaries', () => {
    it('核心 WXT entrypoint 只声明元数据并委托给唯一 app composition root', () => {
        const contracts = [
            {
                path: 'entrypoints/background.ts',
                imports: ['@/src/app/background/runtime'],
                declaration: 'defineBackground({',
                delegate: 'main: startBackgroundApp',
            },
            {
                path: 'entrypoints/content.ts',
                imports: ['@/src/app/content/runtime'],
                declaration: 'defineContentScript({',
                delegate: 'main: startContentApp',
            },
        ];

        for (const contract of contracts) {
            const source = readSource(projectPath(contract.path));
            expect(importSpecifiers(source), contract.path).toEqual(contract.imports);
            expect(source, contract.path).toContain(contract.declaration);
            expect(source, contract.path).toContain(contract.delegate);
            expect(source, contract.path).not.toContain('browser.');
        }
    });

    it('特殊 WXT entrypoint 只保留目标元数据并委托 app composition root', () => {
        const contracts = [
            {
                path: 'entrypoints/offscreen/main.ts',
                imports: ['@/src/app/offscreen/runtime'],
                delegate: 'startOffscreenApp();',
            },
            {
                path: 'entrypoints/shadowBridge.content.ts',
                imports: ['@/src/app/content/shadowBridge'],
                delegate: 'main: startShadowBridgeApp',
                metadata: ["runAt: 'document_start'", "world: 'MAIN'"],
            },
            {
                path: 'entrypoints/youtubeBridge.content.ts',
                imports: ['@/src/app/content/youtubeTimedTextBridge'],
                delegate: 'main: startYoutubeTimedTextBridgeApp',
                metadata: ["runAt: 'document_start'", "world: 'MAIN'"],
            },
        ];

        for (const contract of contracts) {
            const source = readSource(projectPath(contract.path));
            expect(importSpecifiers(source), contract.path).toEqual(contract.imports);
            expect(source, contract.path).toContain(contract.delegate);
            for (const metadata of contract.metadata ?? []) expect(source, contract.path).toContain(metadata);
            expect(source, contract.path).not.toContain('chrome.');
            expect(source, contract.path).not.toContain('window.');
        }
    });

    it('src 的静态依赖图不存在跨文件循环', () => {
        const files = listSourceFiles('src');
        const sourceSet = new Set(files);
        const graph = new Map(files.map((file) => [
            file,
            importSpecifiers(readSource(file))
                .map((specifier) => resolveProjectImport(file, specifier))
                .filter((target): target is string => Boolean(target) && sourceSet.has(target as string)),
        ]));
        const visiting = new Set<string>();
        const visited = new Set<string>();
        const stack: string[] = [];
        const cycles: string[] = [];

        const visit = (file: string) => {
            if (visited.has(file)) return;
            if (visiting.has(file)) {
                const start = stack.indexOf(file);
                cycles.push([...stack.slice(start), file].map(relativePath).join(' -> '));
                return;
            }

            visiting.add(file);
            stack.push(file);
            for (const dependency of graph.get(file) ?? []) visit(dependency);
            stack.pop();
            visiting.delete(file);
            visited.add(file);
        };

        for (const file of files) visit(file);
        expect(cycles).toEqual([]);
    });

    it('src 只能通过精确登记的 composition/browser/provider 迁移边界读取 entrypoints', () => {
        const violations: string[] = [];
        const appRuntimeImports: string[] = [];
        const providerEntrypointImports: string[] = [];
        const featureBrowserEntrypointEdges: string[] = [];

        for (const file of listSourceFiles('src')) {
            const path = relativePath(file);
            for (const specifier of importSpecifiers(readSource(file))) {
                if (!specifier.startsWith('@/entrypoints/')) continue;

                // Step 1: app composition root 负责把 WXT/provider/config 依赖静态注入纯 service。
                if (APP_COMPOSITION_ROOT_ENTRYPOINT_IMPORTS.get(path)?.has(specifier)) {
                    appRuntimeImports.push(`${path} -> ${specifier}`);
                    continue;
                }
                // Step 2: provider 已迁入目标目录；配置/模板等尚在迁移的依赖只开放精确集合。
                if (path.startsWith('src/providers/translation/')
                    && PROVIDER_TRANSITIONAL_ENTRYPOINT_IMPORTS.has(specifier)) {
                    providerEntrypointImports.push(specifier);
                    continue;
                }
                // Step 3: 内容脚本 runtime/UI 仍承载浏览器 DOM/WXT glue；迁移期只允许逐文件精确列明的旧依赖。
                if (FEATURE_BROWSER_ENTRYPOINT_IMPORTS.get(path)?.has(specifier)) {
                    featureBrowserEntrypointEdges.push(`${path} -> ${specifier}`);
                    continue;
                }
                violations.push(`${path} -> ${specifier}`);
            }
        }

        // Step 4: 已登记集合必须与实际依赖精确匹配，防止残留白名单静默扩大。
        expect(violations).toEqual([]);
        expect(new Set(appRuntimeImports)).toEqual(new Set(
            [...APP_COMPOSITION_ROOT_ENTRYPOINT_IMPORTS].flatMap(([path, imports]) =>
                [...imports].map((specifier) => `${path} -> ${specifier}`)),
        ));
        expect(new Set(providerEntrypointImports)).toEqual(PROVIDER_TRANSITIONAL_ENTRYPOINT_IMPORTS);
        expect(new Set(featureBrowserEntrypointEdges)).toEqual(new Set(
            [...FEATURE_BROWSER_ENTRYPOINT_IMPORTS].flatMap(([path, imports]) =>
                [...imports].map((specifier) => `${path} -> ${specifier}`)),
        ));
    });

    it('core 与 shared 保持低层，不依赖 app、feature、service、provider、platform 或 UI', () => {
        const forbidden = /^@\/src\/(?:app|features|services|providers|platform|ui)(?:\/|$)/;
        const violations: string[] = [];

        for (const directory of ['src/core', 'src/shared']) {
            const absolute = projectPath(directory);
            try {
                for (const file of listSourceFiles(directory)) {
                    for (const specifier of importSpecifiers(readSource(file))) {
                        if (specifier.startsWith('@/entrypoints/') || forbidden.test(specifier)) {
                            violations.push(`${relativePath(file)} -> ${specifier}`);
                        }
                    }
                }
            } catch {
                // 迁移早期目录可以尚未创建；一旦出现源码就自动纳入约束。
                expect(absolute).toBeTruthy();
            }
        }

        expect(violations).toEqual([]);
    });

    it('feature 不能跨目录读取另一个 feature 的内部实现', () => {
        const violations: string[] = [];

        for (const file of listSourceFiles('src/features')) {
            const path = relativePath(file);
            const owner = path.split('/')[2];
            if (!owner) continue;

            for (const specifier of importSpecifiers(readSource(file))) {
                const target = resolveProjectImport(file, specifier);
                const targetPath = target ? relativePath(target) : '';
                const match = targetPath.match(/^src\/features\/([^/]+)\//);
                const usesPublicContract = /\/(?:public|protocol)\.ts$/u.test(targetPath);
                if (match && match[1] !== owner && !usesPublicContract) violations.push(`${path} -> ${specifier}`);
            }
        }

        expect(violations).toEqual([]);
    });

    it('文档 WXT 页面只通过 app public API 进入垂直功能切片', () => {
        expect(readSource(projectPath('entrypoints/document/main.ts'))).toBe(
            "import {mountDocumentTranslationApp} from '@/src/app/document-translation/page';\n\nmountDocumentTranslationApp('#app');\n",
        );
        const documentUiImports = importSpecifiers(readSource(projectPath('src/app/document-translation/DocumentApp.vue')))
            .filter((specifier) => specifier.startsWith('@/src/'));
        const featureEntrypointImports = listSourceFiles('src/features/document-translation')
            .flatMap((file) => importSpecifiers(readSource(file)))
            .filter((specifier) => specifier.startsWith('@/entrypoints/'));

        expect(documentUiImports).toEqual(['@/src/app/document-translation']);
        expect(featureEntrypointImports).toEqual([]);
    });

    it('WXT entrypoint 只能进入 app composition root，已知 service 直连只能递减', () => {
        const violations: string[] = [];
        const allowedDebt = new Set([
            'entrypoints/utils/translationCache.ts -> @/src/services/translation/cache',
            'entrypoints/utils/inputBox.ts -> @/src/features/input-translation/content/inputBox',
            'entrypoints/utils/http.ts -> @/src/platform/http/runtime',
            'entrypoints/utils/httpError.ts -> @/src/platform/http/errors',
            'entrypoints/utils/hotkey.ts -> @/src/core/hotkey',
            'entrypoints/utils/siteRules.ts -> @/src/features/site-rules/domain',
            'entrypoints/utils/selectionTranslatorCore.ts -> @/src/features/selection-translation/core',
            'entrypoints/utils/selectionTtsConfig.ts -> @/src/features/selection-translation/ttsConfig',
            'entrypoints/utils/areaTranslationCore.ts -> @/src/features/area-translation/core',
            'entrypoints/utils/imageTranslationCore.ts -> @/src/features/image-translation/core',
            'entrypoints/utils/imageOcrLanguages.ts -> @/src/features/image-translation/ocrLanguages',
            'entrypoints/utils/option.ts -> @/src/core/config/catalog',
            'entrypoints/utils/model.ts -> @/src/core/config/model',
            'entrypoints/utils/credentials.ts -> @/src/core/config/credentials',
            'entrypoints/utils/configValidation.ts -> @/src/core/config/validation',
            'entrypoints/utils/constant.ts -> @/src/core/config/constants',
            'entrypoints/utils/config-transfer.ts -> @/src/core/config/transfer',
            'entrypoints/utils/custom-body.ts -> @/src/core/config/customBody',
            'entrypoints/utils/deeplx.ts -> @/src/core/config/deeplx',
            'entrypoints/utils/config.ts -> @/src/services/config/store',
            'entrypoints/utils/serviceCatalog.ts -> @/src/ui/view-model/serviceCatalog',
            'entrypoints/utils/vocabularyBookProtocol.ts -> @/src/features/vocabulary/learningModel',
            'entrypoints/utils/vocabularyBook.ts -> @/src/features/vocabulary/repository',
            'entrypoints/utils/common.ts -> @/src/core/language/detect',
            'entrypoints/utils/common.ts -> @/src/shared/dom/findMatchingElement',
            'entrypoints/utils/common.ts -> @/src/shared/function/throttle',
            'entrypoints/utils/common.ts -> @/src/shared/geometry/touch',
            'entrypoints/utils/translationLanguage.ts -> @/src/services/translation/languages',
            'entrypoints/utils/translationError.ts -> @/src/services/translation/errors',
            'entrypoints/utils/serviceError.ts -> @/src/services/translation/serviceErrors',
            'entrypoints/utils/template.ts -> @/src/services/translation/templates',
            'entrypoints/utils/translateQueue.ts -> @/src/services/translation/queue',
            'entrypoints/utils/pageContext.ts -> @/src/services/translation/context',
            'entrypoints/utils/edgeTts.ts -> @/src/features/selection-translation/services/edgeTts',
            'entrypoints/utils/wordDictionary.ts -> @/src/features/selection-translation/services/wordDictionary',
            'entrypoints/utils/legacyPageCache.ts -> @/src/services/translation/legacyPageCache',
        ]);

        for (const file of listSourceFiles('entrypoints')) {
            const path = relativePath(file);
            for (const specifier of importSpecifiers(readSource(file))) {
                if (!specifier.startsWith('@/src/')) continue;
                if (specifier.startsWith('@/src/app/')) continue;

                const edge = `${path} -> ${specifier}`;
                if (!allowedDebt.has(edge)) violations.push(edge);
            }
        }

        expect(violations).toEqual([]);
    });

    it('迁移后的旧 utils 路径只能保留 deprecated re-export', () => {
        const shims = new Map([
            ['entrypoints/utils/translationCache.ts', '@/src/services/translation/cache'],
            ['entrypoints/utils/translationBroker.ts', '@/src/app/translation/runtime'],
            ['entrypoints/utils/contentFeatureLifecycle.ts', '@/src/app/content/featureLifecycle'],
            ['entrypoints/utils/inputBox.ts', '@/src/features/input-translation/content/inputBox'],
            ['entrypoints/utils/http.ts', '@/src/platform/http/runtime'],
            ['entrypoints/utils/httpError.ts', '@/src/platform/http/errors'],
            ['entrypoints/utils/hotkey.ts', '@/src/core/hotkey'],
            ['entrypoints/utils/siteRules.ts', '@/src/features/site-rules/domain'],
            ['entrypoints/utils/selectionTranslatorCore.ts', '@/src/features/selection-translation/core'],
            ['entrypoints/utils/selectionTtsConfig.ts', '@/src/features/selection-translation/ttsConfig'],
            ['entrypoints/utils/areaTranslationCore.ts', '@/src/features/area-translation/core'],
            ['entrypoints/utils/imageTranslationCore.ts', '@/src/features/image-translation/core'],
            ['entrypoints/utils/imageOcrLanguages.ts', '@/src/features/image-translation/ocrLanguages'],
            ['entrypoints/utils/option.ts', '@/src/core/config/catalog'],
            ['entrypoints/utils/model.ts', '@/src/core/config/model'],
            ['entrypoints/utils/credentials.ts', '@/src/core/config/credentials'],
            ['entrypoints/utils/configValidation.ts', '@/src/core/config/validation'],
            ['entrypoints/utils/constant.ts', '@/src/core/config/constants'],
            ['entrypoints/utils/config-transfer.ts', '@/src/core/config/transfer'],
            ['entrypoints/utils/custom-body.ts', '@/src/core/config/customBody'],
            ['entrypoints/utils/deeplx.ts', '@/src/core/config/deeplx'],
            ['entrypoints/utils/config.ts', '@/src/services/config/store'],
            ['entrypoints/utils/serviceCatalog.ts', '@/src/ui/view-model/serviceCatalog'],
            ['entrypoints/utils/vocabularyBookProtocol.ts', '@/src/features/vocabulary/learningModel'],
            ['entrypoints/utils/vocabularyBook.ts', '@/src/features/vocabulary/repository'],
            ['entrypoints/utils/translationLanguage.ts', '@/src/services/translation/languages'],
            ['entrypoints/utils/translationError.ts', '@/src/services/translation/errors'],
            ['entrypoints/utils/serviceError.ts', '@/src/services/translation/serviceErrors'],
            ['entrypoints/utils/template.ts', '@/src/services/translation/templates'],
            ['entrypoints/utils/check.ts', '@/src/app/translation/check'],
            ['entrypoints/utils/translateQueue.ts', '@/src/services/translation/queue'],
            ['entrypoints/utils/translateApi.ts', '@/src/app/translation/client'],
            ['entrypoints/utils/pageContext.ts', '@/src/services/translation/context'],
            ['entrypoints/utils/edgeTts.ts', '@/src/features/selection-translation/services/edgeTts'],
            ['entrypoints/utils/wordDictionary.ts', '@/src/features/selection-translation/services/wordDictionary'],
            ['entrypoints/utils/legacyPageCache.ts', '@/src/services/translation/legacyPageCache'],
        ]);

        for (const [path, target] of shims) {
            const source = readSource(projectPath(path));
            expect(source).toContain('@deprecated');
            expect(source).toContain(`export * from '${target}';`);
            expect(importSpecifiers(source)).toEqual([target]);
        }

        const commonSource = readSource(projectPath('entrypoints/utils/common.ts'));
        expect(commonSource).toContain('@deprecated');
        expect(new Set(importSpecifiers(commonSource))).toEqual(new Set([
            '@/src/core/language/detect',
            '@/src/shared/dom/findMatchingElement',
            '@/src/shared/function/throttle',
            '@/src/shared/geometry/touch',
        ]));
    });

    it('业务模块不能继续迁入 WXT entrypoints/core 或 entrypoints/features', () => {
        const misplaced = listSourceFiles('entrypoints').filter((file) => {
            const path = relativePath(file);
            return path.startsWith('entrypoints/core/') || path.startsWith('entrypoints/features/');
        });

        expect(misplaced.map(relativePath)).toEqual([]);
    });

    it('历史巨型文件不得继续增长，后续迁移只降低债务上限', () => {
        const growth = Object.entries(COMPLEXITY_DEBT_CEILINGS)
            .map(([path, ceiling]) => ({path, lines: lineCount(path), ceiling}))
            .filter(({lines, ceiling}) => lines > ceiling);

        expect(growth).toEqual([]);
    });
});
