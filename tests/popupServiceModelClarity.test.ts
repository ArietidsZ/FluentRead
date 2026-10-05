import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import vue from '@vitejs/plugin-vue';
import {createServer, type ViteDevServer} from 'vite';
import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import {compileScript, compileTemplate, parse} from 'vue/compiler-sfc';
import {parseHTML} from 'linkedom';
import ts from 'typescript';
import {Config} from '@/src/core/config/model';
import {customModelString} from '@/src/core/config/catalog';
import {registerAllUiLanguageBundles} from '@/src/core/i18n/bundles';
import {translate} from '@/src/core/i18n';

const runtime = createRequire(import.meta.url)('vue') as typeof import('vue');
let server: ViteDevServer;
let app: import('vue').App;
let component: any;
const serviceOptions = [{value: 'openai', label: 'OpenAI'}, {value: 'deepseek', label: 'DeepSeek'},
  {value: 'microsoft', label: 'Microsoft'}, {value: 'custom:private', label: 'Private endpoint'}];

beforeAll(async () => {
  server = await createServer({appType: 'custom', configFile: false, logLevel: 'silent', root: process.cwd(),
    resolve: {alias: {'@': resolve(process.cwd(), '.')}}, server: {hmr: false, middlewareMode: true},
    plugins: [{name: 'service-picker-test-language', enforce: 'pre', resolveId(id) {
      return /\/src\/ui\/i18n(?:\.ts)?$/u.test(id) ? '\0service-picker-test-language' : null;
    }, load(id) {return id === '\0service-picker-test-language'
      ? `import {translate} from '@/src/core/i18n'; export const useUiI18n = () => ({t: (key, params) => translate(key, 'zh-CN', params), translateLegacy: text => text});` : null;}}, vue()],
  });
  const filename = resolve('src/app/popup/PopupServices.vue');
  const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename});
  const bindings = compileScript(descriptor, {id: 'service-model-clarity'}).bindings;
  const template = compileTemplate({source: descriptor.template!.content, filename, id: 'service-model-clarity',
    compilerOptions: {mode: 'function', bindingMetadata: bindings, expressionPlugins: ['typescript']}});
  expect(template.errors).toEqual([]);
  component = (await server.ssrLoadModule('/src/app/popup/PopupServices.vue')).default;
  component.render = new Function('Vue', ts.transpileModule(template.code, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText)(runtime);
});
afterEach(() => app?.unmount());
afterAll(async () => server?.close());

function mount() {
  const {document, window} = parseHTML('<html><body><div id="root"></div></body></html>');
  const root = document.getElementById('root')!;
  const renderer = runtime.createRenderer<any, any>({
    patchProp(node, key, previous, value) {
      if (/^on[A-Z]/u.test(key)) {
        const event = key.slice(2).toLowerCase();
        if (previous) node.removeEventListener(event, previous);
        if (value) node.addEventListener(event, value);
      } else if (key === 'value') node.value = value;
      else if (value == null || value === false) node.removeAttribute(key);
      else node.setAttribute(key, String(value));
    },
    insert: (node, parent, anchor) => parent.insertBefore(node, anchor || null), remove: node => node.remove(),
    createElement: tag => document.createElement(tag), createText: text => document.createTextNode(text),
    createComment: text => document.createComment(text), setText: (node, text) => {node.nodeValue = text;},
    setElementText: (node, text) => {node.textContent = text;}, parentNode: node => node.parentNode,
    nextSibling: node => node.nextSibling, setScopeId: (node, id) => node.setAttribute(id, ''),
    insertStaticContent: (content, parent, anchor) => {
      const template = document.createElement('template'); template.innerHTML = content;
      const first = template.content.firstChild, last = template.content.lastChild;
      parent.insertBefore(template.content, anchor || null); return [first, last];
    },
  });
  const config = runtime.reactive(new Config());
  config.service = 'openai';
  config.model.openai = 'saved-openai-model';
  config.model.deepseek = 'saved-deepseek-model';
  config.token.openai = 'test-only-key'; config.token.deepseek = 'test-only-key';
  config.customModels.deepseek = ['search-only-model'];
  const close = {count: 0};
  app = renderer.createApp(component, {config, serviceOptions, onClose: () => {close.count++;}});
  app.provide(runtime.ssrContextKey, {modules: new Set<string>()});
  app.config.warnHandler = () => undefined;
  const vm = app.mount(root);
  const state = (vm.$ as unknown as {setupState: Record<string, any>}).setupState;
  const find = (selector: string) => {const element = root.querySelector(selector); expect(element, selector).not.toBeNull(); return element!;};
  const click = async (selector: string) => {find(selector).dispatchEvent(new window.Event('click')); await runtime.nextTick();};
  const search = async (query: string) => {const input = find('input[type="search"]') as HTMLInputElement; input.value = query; input.dispatchEvent(new window.Event('input')); await runtime.nextTick();};
  return {root, config, state, find, click, search, close};
}

describe('Popup provider and model distinction', () => {
  it('shows the effective model for the default, inherited and explicitly assigned feature', async () => {
    const {config, find} = mount();
    expect(find('[data-feature-service="default"] small').textContent).toBe('当前模型: saved-openai-model');
    expect(find('[data-feature-service="hover"] small').textContent).toBe('当前模型: saved-openai-model');
    expect(find('[data-feature-service="hover"]').getAttribute('aria-label')).toContain('saved-openai-model');
    config.inputBoxTranslationService = 'deepseek'; config.inputBoxTranslationModel = 'input-override';
    config.documentService = 'deepseek'; config.documentModel.deepseek = 'document-override';
    await runtime.nextTick();
    expect(find('[data-feature-service="input"] small').textContent).toContain('input-override');
    expect(find('[data-feature-service="document"] small').textContent).toContain('document-override');
    config.model.openai = customModelString; config.customModel.openai = 'custom/active';
    await runtime.nextTick();
    expect(find('[data-feature-service="default"] small').textContent).toContain('custom/active');
    expect(find('[data-feature-service="hover"] small').textContent).toContain('custom/active');
  });

  it('labels matching models without selecting one, then reveals the unchanged configured model', async () => {
    const {config, root, find, click, search} = mount();
    await click('[data-feature-service="default"]');
    await search('search-only-model');
    expect(find('[data-service-choice="deepseek"] small').textContent).toBe('匹配模型：search-only-model');
    expect(find('.service-picker-model-hint').textContent).toBe('搜索模型用于查找服务，不会选中该模型。请在设置中修改模型。');
    await click('[data-service-choice="deepseek"]');
    expect(config.service).toBe('deepseek');
    expect(config.model.deepseek).toBe('saved-deepseek-model');
    expect(find('[data-feature-service="default"] small').textContent).toBe('当前模型: saved-deepseek-model');
    expect(root.querySelector('.popup-service-picker')).toBeNull();
  });

  it('preserves existing per-feature model reset rules when choosing another service', async () => {
    const {config, find, click, search} = mount();
    config.inputBoxTranslationService = 'openai'; config.inputBoxTranslationModel = 'old-feature-model';
    await runtime.nextTick();
    await click('[data-feature-service="input"]');
    await search('search-only-model');
    await click('[data-service-choice="deepseek"]');
    expect(config.service).toBe('openai');
    expect(config.inputBoxTranslationService).toBe('deepseek');
    expect(config.inputBoxTranslationModel).toBe('');
    expect(config.model.deepseek).toBe('saved-deepseek-model');
    expect(find('[data-feature-service="input"] small').textContent).toBe('当前模型: saved-deepseek-model');
    await click('[data-feature-service="input"]');
    await click('[data-service-choice=""]');
    expect(config.inputBoxTranslationService).toBe('');
    expect(find('[data-feature-service="input"] small').textContent).toBe('当前模型: saved-openai-model');
  });

  it('keeps model-search feedback scoped to matches and resets it on Back and reopen', async () => {
    const {config, root, find, click, search, close} = mount();
    await click('[data-feature-service="hover"]');
    expect(root.querySelector('.service-picker-model-hint')).toBeNull();
    await search('search-only-model');
    expect(find('.service-picker-model-hint')).toBeTruthy();
    await search('no-such-service');
    expect(find('.service-picker-empty')).toBeTruthy();
    expect(root.querySelector('.service-picker-model-hint')).toBeNull();
    await click('.service-picker-back');
    expect(config.hoverTranslationService).toBe('');
    await click('[data-feature-service="hover"]');
    expect((find('input[type="search"]') as HTMLInputElement).value).toBe('');
    expect(root.querySelector('.service-picker-model-hint')).toBeNull();
    await click('.service-panel-close');
    expect(close.count).toBe(1);
  });

  it('does not display a model for machine translation and preserves setup warnings', async () => {
    const {config, root, find} = mount();
    config.service = 'microsoft'; await runtime.nextTick();
    expect(root.querySelector('[data-feature-service="default"] small')).toBeNull();
    expect(find('[data-feature-service="default"]').getAttribute('aria-label')).not.toContain('当前模型');
    config.service = 'openai'; config.token.openai = ''; await runtime.nextTick();
    expect(find('[data-feature-service="default"] .assignment-warning').getAttribute('aria-label')).toContain('API Key');
    expect(root.querySelector('[data-feature-service="default"] small')).toBeNull();
  });

  it('provides model distinction copy in all seven interface languages', () => {
    registerAllUiLanguageBundles();
    for (const language of ['zh-CN', 'en-US', 'es-ES', 'fr-FR', 'ja-JP', 'ko-KR', 'ru-RU'] as const) {
      const label = translate('popup.matchingModels', language, {models: 'unique-model'});
      expect(label).toContain('unique-model'); expect(label).not.toContain('popup.matchingModels');
      const hint = translate('popup.serviceModelSearchHint', language);
      expect(hint).not.toContain('popup.serviceModelSearchHint');
      if (language !== 'zh-CN') expect(hint).not.toBe(translate('popup.serviceModelSearchHint', 'zh-CN'));
    }
  });
});
