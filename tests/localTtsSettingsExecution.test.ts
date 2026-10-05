/**
 * @file tests/localTtsSettingsExecution.test.ts
 * 文件职责：通过真实编译后的本地朗读设置组件验证执行模式的读取、写回与重开。
 * 主要内容：复用设置组件的 Vite/Vue 编译渲染方式，点击真实分段按钮并验证规范化配置。
 * 模块边界：仅替换浏览器和存储端口；保留组件、分段控件、配置规范化及界面文案实现。
 */
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import vue from '@vitejs/plugin-vue';
import {createServer, type ViteDevServer} from 'vite';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {compileScript, compileTemplate, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import {Config, normalizeConfig} from '@/src/core/config/model';

const runtime = createRequire(import.meta.url)('vue') as typeof import('vue');
type Node = {tag: string; props: Record<string, any>; text?: string; parent?: Node; children: Node[]};
let server: ViteDevServer;
let app: import('vue').App;
const root = 'src/features/settings/ui/';
beforeAll(async () => {
    server = await createServer({appType: 'custom', configFile: false, logLevel: 'silent', root: process.cwd(),
        resolve: {alias: {'@': resolve(process.cwd(), '.')}}, server: {hmr: false, middlewareMode: true},
        ssr: {noExternal: ['webextension-polyfill']},
        plugins: [{name: 'tts-settings-browser-boundaries', enforce: 'pre', resolveId(id) {
            if (id === 'webextension-polyfill') return '\0tts-settings-browser';
            if (/\/src\/platform\/storage\/configStorageRuntime(?:\.ts)?$/u.test(id)) return '\0tts-settings-storage';
            return null;
        }, load(id) {
            if (id === '\0tts-settings-browser') return `export default {runtime: {sendMessage: async () => ({success: true, downloaded: false})}, storage: {onChanged: {addListener() {}, removeListener() {}}}};`;
            if (id === '\0tts-settings-storage') return `export const configStorage = {writeOwner: true, getItem: async () => null, setItem: async () => {}, removeItem: async () => {}, watch: () => () => {}};`;
            return null;
        }}, vue()],
    });
});
afterEach(() => app?.unmount());
afterAll(async () => server?.close());

async function compiledComponent(path: string) {
    const filename = resolve(root, path);
    const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename});
    const bindings = compileScript(descriptor, {id: `tts-${path}`}).bindings;
    const template = compileTemplate({source: descriptor.template!.content, filename, id: `tts-${path}`,
        compilerOptions: {mode: 'function', bindingMetadata: bindings, expressionPlugins: ['typescript']}});
    expect(template.errors).toEqual([]);
    const component = (await server.ssrLoadModule(`/${root}${path}`)).default;
    component.render = new Function('Vue', ts.transpileModule(template.code, {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
    }).outputText)(runtime);
    return component;
}

async function mount(config: Config) {
    for (const child of ['components/SettingsGroup.vue', 'components/SettingsItem.vue', 'components/SegmentedControl.vue']) {
        await compiledComponent(child);
    }
    const component = await compiledComponent('LocalTtsSettings.vue');
    const nodes: Node[] = [];
    const node = (tag: string): Node => ({tag, props: {}, children: []});
    const renderer = runtime.createRenderer<Node, Node>({
        patchProp: (target, key, _previous, value) => { target.props[key] = value; },
        insert: (child, parent) => { child.parent = parent; parent.children.push(child); },
        remove: child => { if (child.parent) child.parent.children = child.parent.children.filter(value => value !== child); },
        createElement: tag => { const value = node(tag); nodes.push(value); return value; },
        createText: text => ({...node('#text'), text}), createComment: text => ({...node('#comment'), text}),
        setText: (target, text) => { target.text = text; }, setElementText: (target, text) => { target.text = text; },
        parentNode: target => target.parent ?? null, nextSibling: () => null, querySelector: () => null,
        setScopeId: () => undefined, cloneNode: target => ({...target}),
        insertStaticContent: () => [node('#static'), node('#static')],
    });
    app = renderer.createApp(component, {config});
    app.provide(runtime.ssrContextKey, {modules: new Set<string>()});
    app.config.warnHandler = () => undefined;
    const vm = app.mount(node('#root'));
    await runtime.nextTick();
    return {state: (vm.$ as unknown as {setupState: Record<string, any>}).setupState, nodes};
}

describe('local TTS execution settings compiled component', () => {
    it('reads GPU by default, writes compatible from the real segmented control, and retains the choice on reopen', async () => {
        const config = runtime.reactive(new Config());
        let mounted = await mount(config);
        expect(mounted.state.execution).toBe('gpu');
        expect(mounted.state.executionOptions.map((option: {value: string}) => option.value)).toEqual(['gpu', 'compatible']);
        const compatibleLabel = mounted.state.executionOptions[1].label;
        const compatible = mounted.nodes.find(node => node.props.role === 'radio' && node.text === compatibleLabel)!;
        expect(compatible).toBeDefined();
        expect(compatible.props['aria-checked']).toBe(false);
        compatible.props.onClick();
        await runtime.nextTick();
        expect(config.selectionTtsExecution).toBe('compatible');
        expect(mounted.state.execution).toBe('compatible');
        expect(compatible.props['aria-checked']).toBe(true);
        app.unmount();
        const restored = runtime.reactive(normalizeConfig(JSON.parse(JSON.stringify(config))));
        mounted = await mount(restored);
        expect(mounted.state.execution).toBe('compatible');
        mounted.state.execution = 'invalid';
        expect(restored.selectionTtsExecution).toBe('gpu');
        restored.selectionTtsExecution = 'invalid' as never;
        expect(mounted.state.execution).toBe('gpu');
        mounted.state.execution = 'compatible';
        expect(restored.selectionTtsExecution).toBe('compatible');
        expect(restored.selectionTtsMode).toBe(config.selectionTtsMode);
    });
});
