import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import vue from '@vitejs/plugin-vue';
import {createServer, type ViteDevServer} from 'vite';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {compileScript, compileTemplate, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import {Config} from '@/src/core/config/model';
import {FREE_TRANSLATION_PROVIDERS} from '@/src/core/config/freeTranslation';

const runtime = createRequire(import.meta.url)('vue') as typeof import('vue');
const componentPath = 'src/features/settings/ui/services/FreeTranslationSettings.vue';
type Node = {tag: string; props: Record<string, any>; text?: string};
let server: ViteDevServer;
let app: import('vue').App;
let config: Config;
let elements: Node[];
let state: Record<string, any>;

beforeAll(async () => {
  server = await createServer({appType: 'custom', configFile: false, logLevel: 'silent', root: process.cwd(),
    resolve: {alias: {'@': resolve(process.cwd(), '.')}}, server: {hmr: false, middlewareMode: true},
    plugins: [{name: 'fallback-ui-i18n', enforce: 'pre', resolveId(id) {
      return /\/src\/ui\/i18n(?:\.ts)?$/u.test(id) ? '\0fallback-i18n' : null;
    }, load(id) {return id === '\0fallback-i18n' ? 'export const useUiI18n = () => ({translateLegacy: text => text});' : null;}}, vue()],
  });
});

beforeEach(async () => {
  config = runtime.reactive(new Config());
  const filename = resolve(process.cwd(), componentPath);
  const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename});
  const bindings = compileScript(descriptor, {id: 'free-settings-test'}).bindings;
  const template = compileTemplate({source: descriptor.template!.content, filename, id: 'free-settings-test', compilerOptions: {mode: 'function', bindingMetadata: bindings, expressionPlugins: ['typescript']}});
  expect(template.errors).toEqual([]);
  const component = (await server.ssrLoadModule(`/${componentPath}`)).default;
  component.render = new Function('Vue', ts.transpileModule(template.code, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText)(runtime);
  elements = [];
  const renderer = runtime.createRenderer<Node, Node>({patchProp: (node, key, _previous, value) => {node.props[key] = value;}, insert: () => undefined, remove: () => undefined, createElement: tag => {const node = {tag, props: {}}; elements.push(node); return node;}, createText: () => ({tag: '#text', props: {}}), createComment: () => ({tag: '#comment', props: {}}), setText: () => undefined, setElementText: (node, value) => {node.text = value;}, parentNode: () => null, nextSibling: () => null, querySelector: () => null, setScopeId: () => undefined, cloneNode: node => ({...node}), insertStaticContent: () => [{tag: '#static', props: {}}, {tag: '#static', props: {}}]});
  app = renderer.createApp(component, {config});
  app.provide(runtime.ssrContextKey, {modules: new Set<string>()});
  app.config.warnHandler = () => undefined;
  const vm = app.mount({tag: '#root', props: {}});
  state = (vm.$ as unknown as {setupState: Record<string, any>}).setupState;
  await runtime.nextTick();
});
afterEach(() => app?.unmount());
afterAll(async () => server?.close());
function control(ariaLabel: string): Node { const element = [...elements].reverse().find(node => node.props['aria-label'] === ariaLabel); expect(element, ariaLabel).toBeDefined(); return element!; }

describe('free translation settings compiled component', () => {
  it('defaults to balanced mode and renders the provider directory', () => {
    expect(state.mode).toBe('balanced');
    expect(state.providers.map((provider: {id: string}) => provider.id)).toEqual(FREE_TRANSLATION_PROVIDERS.map(provider => provider.id));
    expect(elements.some(element => element.props['aria-label'] === '权重 微软翻译')).toBe(false);
  });

  it('shows automatic allocation without exposing editable weights', () => {
    expect(elements.some(element => element.text === '自动分配')).toBe(true);
    expect(readFileSync(resolve(process.cwd(), componentPath), 'utf8')).not.toContain('freeTranslationWeights');
    expect(readFileSync(resolve(process.cwd(), componentPath), 'utf8')).not.toContain('setWeight');
  });

  it('switches mode and only exposes order controls in priority mode', async () => {
    control('优先顺序').props.onChange();
    await runtime.nextTick();
    expect(config.freeTranslationMode).toBe('sequential');
    expect(control('下移 微软翻译').props.disabled).toBe(false);
    control('自动均衡').props.onChange();
    await runtime.nextTick();
    expect(config.freeTranslationMode).toBe('balanced');
    expect(readFileSync(resolve(process.cwd(), componentPath), 'utf8')).toContain('v-if="mode === \'sequential\'"');
  });

  it('keeps at least one service enabled', async () => {
    for (const provider of FREE_TRANSLATION_PROVIDERS.slice(1)) state.toggle(provider.id, false);
    await runtime.nextTick();
    expect(config.freeTranslationOrder).toHaveLength(1);
    const only = config.freeTranslationOrder[0];
    state.toggle(only, false);
    expect(config.freeTranslationOrder).toEqual([only]);
  });

  it('keeps partial email local and commits only valid email', async () => {
    const email = control('MyMemory 联系邮箱');
    email.props['onUpdate:modelValue']('contact@'); email.props.onChange();
    expect(config.myMemoryEmail).toBe('');
    email.props['onUpdate:modelValue']('contact@example.test'); email.props.onChange();
    expect(config.myMemoryEmail).toBe('contact@example.test');
  });
});
