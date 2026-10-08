import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import vue from '@vitejs/plugin-vue';
import {createServer, type ViteDevServer} from 'vite';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {compileScript, compileTemplate, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {models, services, customModelString} from '@/src/core/config/catalog';
import {createConfigPersistenceHandler} from '@/src/app/background/handlers/configPersistence';
import {createNativeTranslationRequestFallback} from '@/src/app/background/handlers/translation';
import {createBackgroundMessageRouter, createBackgroundRuntimeMessageListener} from '@/src/app/background/messageRouter';
import {getIncognitoRouteCopy} from '@/src/features/settings/ui/incognitoRouteCopy';

const runtime = createRequire(import.meta.url)('vue') as typeof import('vue');
const path = 'src/features/settings/ui/IncognitoRouteSettings.vue';
const parentPath = 'src/features/settings/ui/FeatureServiceSettings.vue';
type Node = {tag: string; props: Record<string, any>; text?: string};
let server: ViteDevServer, app: import('vue').App, config: Config, elements: Node[], state: Record<string, any>;
const options = [services.google, services.openai, services.deepseek, services.localTranslation].map(value => ({value, label: value}));

beforeAll(async () => {
  server = await createServer({appType: 'custom', configFile: false, logLevel: 'silent', root: process.cwd(),
    resolve: {alias: {'@': resolve(process.cwd(), '.')}}, server: {hmr: false, middlewareMode: true},
    plugins: [{name: 'settings-fixture-boundaries', enforce: 'pre', resolveId(id) {
      if (/components\/Settings(?:Group|Item)\.vue$/u.test(id)) return '\0fixture-settings-wrapper';
      if (/\/src\/ui\/i18n(?:\.ts)?$/u.test(id)) return '\0fixture-i18n';
      return null;
    }, load(id) {
      if (id === '\0fixture-settings-wrapper') return 'import {h} from "vue"; export default {setup(_props, {slots, attrs}) {return () => h("section", attrs, slots.default?.());}};';
      return id === '\0fixture-i18n' ? 'import {ref} from "vue"; export const language = ref("zh-CN"); export const useUiI18n = () => ({language, t: key => key, translateLegacy: text => text});' : null;
    }}, vue()],
  });
});
async function component(relative: string): Promise<any> {
  const filename = resolve(relative);
  const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename});
  const bindings = compileScript(descriptor, {id: relative}).bindings;
  const template = compileTemplate({source: descriptor.template!.content, filename, id: relative,
    compilerOptions: {mode: 'function', bindingMetadata: bindings, expressionPlugins: ['typescript']}});
  expect(template.errors).toEqual([]);
  const result = (await server.ssrLoadModule(`/${relative}`)).default;
  result.render = new Function('Vue', ts.transpileModule(template.code, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText)(runtime);
  return result;
}
async function mount(parent = false): Promise<void> {
  app?.unmount(); elements = [];
  const child = await component(path);
  const selected = parent ? await component(parentPath) : child;
  const renderer = runtime.createRenderer<Node, Node>({patchProp: (node, key, _old, value) => {node.props[key] = value;},
    insert: () => undefined, remove: () => undefined, createElement: tag => {const node = {tag, props: {}}; elements.push(node); return node;},
    createText: () => ({tag: '#text', props: {}}), createComment: () => ({tag: '#comment', props: {}}), setText: () => undefined,
    setElementText: (node, text) => {node.text = text;}, parentNode: () => null, nextSibling: () => null, querySelector: () => null,
    setScopeId: () => undefined, cloneNode: node => ({...node}), insertStaticContent: () => [{tag: '#static', props: {}}, {tag: '#static', props: {}}]});
  app = renderer.createApp(selected, {config, serviceOptions: options});
  app.provide(runtime.ssrContextKey, {modules: new Set<string>()}); app.config.warnHandler = () => undefined;
  const vm = app.mount({tag: '#root', props: {}});
  state = (vm.$ as unknown as {setupState: Record<string, any>}).setupState;
  await runtime.nextTick();
}
beforeEach(async () => {config = runtime.reactive(new Config()); (await server.ssrLoadModule('/src/ui/i18n.ts')).language.value = 'zh-CN'; await mount();});
afterEach(() => app?.unmount());
afterAll(async () => server?.close());
function element(label: string): Node {
  const found = [...elements].reverse().find(node => node.props['aria-label'] === label);
  expect(found, label).toBeDefined(); return found!;
}
async function choose(label: string, value: string): Promise<void> {
  element(label).props['onUpdate:modelValue'](value); await runtime.nextTick();
}

describe('compiled incognito settings and settings-parent composition', () => {
  it('uses the existing reactive UI language for all seven localized controls and scope descriptions', async () => {
    const i18n = await server.ssrLoadModule('/src/ui/i18n.ts');
    for (const locale of ['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'] as const) {
      i18n.language.value = locale; await runtime.nextTick();
      const copy = getIncognitoRouteCopy(locale);
      expect(element(copy.service)).toBeDefined(); expect(element(copy.model)).toBeDefined(); expect(element(copy.clear)).toBeDefined();
      expect(state.status.description).toBe(copy.disabled);
      expect(Object.values(copy).every(value => value.length > 0)).toBe(true);
      if (locale !== 'zh-CN') expect(copy.scope).not.toBe(getIncognitoRouteCopy('zh-CN').scope);
    }
  });
  it('starts disabled and is composed in the existing service-assignment page', async () => {
    expect(state.status.description).toContain('未启用'); expect(state.status.error).toBe('');
    expect(config.service).toBe(services.freeTranslation);
    await mount(true);
    await choose('私密翻译服务', services.openai);
    expect(config.incognitoService).toBe(services.openai); expect(config.incognitoModel).toBe('');
    expect(config.service).toBe(services.freeTranslation);
    expect(elements.some(node => node.props['data-testid'] === 'incognito-route-settings')).toBe(true);
    expect(readFileSync('src/features/settings/ui/SettingsSections.vue', 'utf8')).toContain('<FeatureServiceSettings :config="config"');
  });
  it('does not default, clear or substitute models on service change; no-model service-only is valid', async () => {
    await choose('私密翻译服务', services.openai); expect(state.status.error).toContain('配置无效');
    await choose('私密翻译模型', 'gpt-5.4-mini'); expect(state.status.description).toContain('gpt-5.4-mini');
    await choose('私密翻译服务', services.google);
    expect(config.incognitoModel).toBe('gpt-5.4-mini'); expect(state.status.error).toContain('配置无效');
    expect(state.modelChoices[0]).toMatchObject({value: 'gpt-5.4-mini', disabled: true});
    await choose('私密翻译模型', ''); expect(state.status.description).toContain('无需模型');
    await choose('私密翻译服务', ''); expect(state.status.description).toContain('未启用');
  });
  it('save/reopen/clear uses the existing native message router and persistence handler even when source is unknown', async () => {
    let saved = normalizeConfig(config); let revision = 0;
    const save = vi.fn(async (value: Config) => {saved = normalizeConfig(JSON.parse(JSON.stringify(value))); revision++;});
    const translate = vi.fn(async () => 'unused');
    const handler = createConfigPersistenceHandler({ready: Promise.resolve(), getCurrentConfig: () => saved,
      prepareConfigSaveRequest: value => normalizeConfig(value), prepareConfigPatchRequest: value => normalizeConfig({...saved, ...value}),
      saveConfig: save, isExtensionUrl: url => url.startsWith('moz-extension://origin-uuid/'), getCurrentRevision: () => revision});
    const fallback = createNativeTranslationRequestFallback({id: 'extension-id', getURL: () => 'moz-extension://origin-uuid/'}, {
      translate, serializeError: error => ({error: (error as Error).message}),
    });
    const listener = createBackgroundRuntimeMessageListener(createBackgroundMessageRouter([handler], fallback), sender => ({sender: sender as {id?: string; url?: string}}));
    const sender = {id: 'extension-id', url: 'moz-extension://origin-uuid/options.html'}; // Firefox 140: no documentId.
    await choose('私密翻译服务', services.openai); await choose('私密翻译模型', 'gpt-5.4-mini');
    expect(await listener({type: 'persistConfig', config: JSON.parse(JSON.stringify(config)), clientId: 'settings', sequence: 1}, sender)).toEqual({success: true, revision: 1});
    config = runtime.reactive(normalizeConfig(saved)); await mount();
    expect(element('私密翻译模型').props['model-value']).toBe('gpt-5.4-mini');
    expect(state.status.description).toContain('openai / gpt-5.4-mini');
    element('清空私密翻译专用路线').props.onClick(); await runtime.nextTick();
    expect(config).toMatchObject({incognitoService: '', incognitoModel: ''});
    expect(await listener({type: 'persistConfig', config: JSON.parse(JSON.stringify(config)), clientId: 'settings', sequence: 2}, sender)).toEqual({success: true, revision: 2});
    config = runtime.reactive(normalizeConfig(saved)); await mount();
    expect(state.status.description).toContain('未启用'); expect(save).toHaveBeenCalledTimes(2); expect(translate).not.toHaveBeenCalled();
  });
  it.each([
    {incognitoService: 'deleted-provider', incognitoModel: 'deleted-model'},
    {incognitoService: '', incognitoModel: 'dangling-model'},
    {incognitoService: services.openai, incognitoModel: false},
    {incognitoService: false, incognitoModel: ''},
    {incognitoService: services.openai, incognitoModel: customModelString},
  ])('preserves invalid saved state on reopen and explains failure %#', async value => {
    config = runtime.reactive(normalizeConfig(value)); await mount();
    expect(state.status.error).toContain('配置无效');
    expect(config.incognitoService).toBe(normalizeConfig(value).incognitoService);
    expect(config.incognitoModel).toBe(normalizeConfig(value).incognitoModel);
    if (config.incognitoService && config.incognitoService !== services.openai) expect(state.serviceChoices[0].disabled).toBe(true);
    if (config.incognitoModel) expect(state.modelChoices[0].disabled).toBe(true);
  });
  it('reuses saved custom models/provider list, preserves stale state after deletion and keeps credentials untouched', async () => {
    config.customModels[services.openai] = ['saved-model']; config.token[services.openai] = 'synthetic-fixture';
    await choose('私密翻译服务', services.openai); await choose('私密翻译模型', 'saved-model');
    expect(state.status.description).toContain('saved-model'); expect(state.modelChoices.some((item: any) => item.value === 'saved-model')).toBe(true);
    const ordinary = JSON.stringify({model: config.model, customModel: config.customModel});
    config.customOpenAIProviders = [{id: 'custom:fixture', name: 'Fixture', endpoint: 'https://fixture.invalid/v1', models: ['private-model']}];
    await choose('私密翻译服务', 'custom:fixture'); await choose('私密翻译模型', 'private-model');
    expect(state.status.error).toBe(''); expect(state.modelChoices).toEqual([{value: 'private-model', removable: true}]);
    config.customOpenAIProviders = []; await runtime.nextTick(); expect(state.status.error).toContain('配置无效');
    expect(config.incognitoModel).toBe('private-model');
    element('清空私密翻译专用路线').props.onClick(); await runtime.nextTick();
    expect(config.customModels[services.openai]).toEqual(['saved-model']); expect(config.token[services.openai]).toBe('synthetic-fixture');
    expect(JSON.stringify({model: config.model, customModel: config.customModel})).toBe(ordinary);
  });
  it('only lists supported local catalog models and preserves a stale imported model', async () => {
    config.customModels[services.localTranslation] = ['unavailable-local'];
    await choose('私密翻译服务', services.localTranslation); await choose('私密翻译模型', 'unavailable-local');
    expect(state.status.error).toContain('配置无效'); expect(state.modelChoices[0].disabled).toBe(true);
    await choose('私密翻译模型', models.get(services.localTranslation)![0]);
    expect(state.status.error).toBe(''); expect(state.modelChoices.some((item: any) => item.value === 'unavailable-local')).toBe(false);
  });
});
