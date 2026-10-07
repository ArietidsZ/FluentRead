import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import vue from '@vitejs/plugin-vue';
import {createServer, type ViteDevServer} from 'vite';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {compileScript, compileTemplate, parse} from 'vue/compiler-sfc';
import {parseHTML} from 'linkedom';
import ts from 'typescript';
import {Config} from '@/src/core/config/model';
import {customModelString} from '@/src/core/config/catalog';
import {registerAllUiLanguageBundles, UI_LANGUAGE_BUNDLES} from '@/src/core/i18n/bundles';
import {zhCNMessages} from '@/src/core/i18n/messages/zh-CN';
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
afterEach(() => {app?.unmount(); vi.unstubAllGlobals();});
afterAll(async () => server?.close());

function mount(savedConfig?: Config) {
  const {document, window} = parseHTML('<html><body><div id="root"></div></body></html>');
  const root = document.getElementById('root')!;
  let focused: HTMLElement | null = null;
  vi.stubGlobal('document', document);
  Object.defineProperty(document, 'activeElement', {get: () => focused});
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
    // LinkeDOM has no browser focus manager; record the real component's focus requests.
    createElement: tag => {
      const node = document.createElement(tag);
      node.focus = () => {focused = node;};
      // Native DOM elements are not Vue-reactive; keep LinkeDOM nodes equally opaque.
      return runtime.markRaw(node);
    }, createText: text => document.createTextNode(text),
    createComment: text => document.createComment(text), setText: (node, text) => {node.nodeValue = text;},
    setElementText: (node, text) => {node.textContent = text;}, parentNode: node => node.parentNode,
    nextSibling: node => node.nextSibling, setScopeId: (node, id) => node.setAttribute(id, ''),
    insertStaticContent: (content, parent, anchor) => {
      const template = document.createElement('template'); template.innerHTML = content;
      const first = template.content.firstChild, last = template.content.lastChild;
      parent.insertBefore(template.content, anchor || null); return [first, last];
    },
  });
  const config = runtime.reactive(savedConfig || new Config());
  if (!savedConfig) {
    config.service = 'openai';
    config.model.openai = 'saved-openai-model';
    config.model.deepseek = 'saved-deepseek-model';
    config.token.openai = 'test-only-key'; config.token.deepseek = 'test-only-key';
    config.customModels.deepseek = ['search-only-model'];
  }
  const options = runtime.reactive(serviceOptions.map(option => ({...option})));
  const close = {count: 0};
  app = renderer.createApp(component, {config, serviceOptions: options, onClose: () => {close.count++;}});
  app.provide(runtime.ssrContextKey, {modules: new Set<string>()});
  app.config.warnHandler = () => undefined;
  app.mount(root);
  const find = (selector: string) => {const element = root.querySelector(selector); expect(element, selector).not.toBeNull(); return element!;};
  const click = async (selector: string) => {find(selector).dispatchEvent(new window.Event('click')); await runtime.nextTick();};
  const search = async (query: string) => {const input = find('input[type="search"]') as HTMLInputElement; input.value = query; input.dispatchEvent(new window.Event('input')); await runtime.nextTick();};
  const key = async (selector: string, key: string) => {
    const event = Object.assign(new window.Event('keydown', {bubbles: true, cancelable: true}), {key});
    find(selector).dispatchEvent(event);
    await runtime.nextTick();
    return event;
  };
  return {root, config, options, find, click, search, key, close, focused: () => focused};
}

describe('Popup provider and model distinction', () => {
  it('shows the effective model for the default, inherited and explicitly assigned feature', async () => {
    const {config, find} = mount();
    expect(find('[data-feature-service="default"] small').textContent).toBe('当前模型: saved-openai-model');
    expect(find('[data-feature-service="hover"] small').textContent).toBe('当前模型: saved-openai-model');
    expect(find('[data-feature-service="hover"] .assignment-value').textContent).toBe('跟随默认');
    expect(find('[data-feature-service="hover"]').getAttribute('aria-label')).toBe('鼠标悬浮 · 跟随默认 · OpenAI · 当前模型: saved-openai-model');
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

  it('keeps service-name search distinct from model matches and clears its feedback', async () => {
    const {config, root, find, click, search, focused} = mount();
    await click('[data-feature-service="default"]');
    await search('Microsoft');
    expect(root.querySelectorAll('[data-service-choice]')).toHaveLength(1);
    expect(find('[data-service-choice="microsoft"] strong').textContent).toBe('Microsoft');
    expect(root.querySelector('.service-picker-model-hint')).toBeNull();
    await search('search-only-model');
    expect(root.querySelectorAll('[data-service-choice]')).toHaveLength(1);
    expect(find('.service-picker-model-hint').getAttribute('role')).toBe('status');
    await click('.service-picker-search button');
    expect((find('input[type="search"]') as HTMLInputElement).value).toBe('');
    expect(focused()).toBe(find('input[type="search"]'));
    expect(root.querySelector('.service-picker-model-hint')).toBeNull();
    expect(config.service).toBe('openai');
    expect(config.model.deepseek).toBe('saved-deepseek-model');
  });

  it('uses custom OpenAI provider models for search while preserving its configured model', async () => {
    const {config, find, click, search} = mount();
    config.customOpenAIProviders = [{id: 'custom:private', name: 'Private endpoint',
      endpoint: 'https://example.test/v1', models: ['private-active', 'private-search-only']}];
    config.model['custom:private'] = 'private-active';
    config.token['custom:private'] = 'test-only-key';
    const modelsBefore = {...config.model};
    const customModelsBefore = {...config.customModel};
    await click('[data-feature-service="default"]');
    await search('private-search-only');
    expect(find('[data-service-choice="custom:private"] small').textContent).toBe('匹配模型：private-search-only');
    await click('[data-service-choice="custom:private"]');
    expect(config.service).toBe('custom:private');
    expect(find('[data-feature-service="default"] small').textContent).toBe('当前模型: private-active');
    expect(find('[data-feature-service="hover"]').getAttribute('aria-label')).toContain('跟随默认 · Private endpoint');
    expect(find('[data-feature-service="hover"] small').textContent).toBe('当前模型: private-active');
    expect(config.model).toEqual(modelsBefore);
    expect(config.customModel).toEqual(customModelsBefore);
  });

  it('shows reading and writing overrides and retains the existing reset and AI-only rules', async () => {
    const {config, root, find, click, search} = mount();
    config.harness.service = 'deepseek'; config.harness.model = 'reading-override';
    config.writing.service = 'openai'; config.writing.model = 'writing-override';
    await runtime.nextTick();
    expect(find('[data-feature-service="reading"] small').textContent).toBe('当前模型: reading-override');
    expect(find('[data-feature-service="writing"] small').textContent).toBe('当前模型: writing-override');
    const modelsBefore = {...config.model};
    await click('[data-feature-service="reading"]');
    expect(root.querySelector('[data-service-choice="microsoft"]')).toBeNull();
    await search('saved-openai-model');
    await click('[data-service-choice="openai"]');
    expect(config.harness.service).toBe('openai');
    expect(config.harness.model).toBe('');
    expect(find('[data-feature-service="reading"] small').textContent).toBe('当前模型: saved-openai-model');
    await click('[data-feature-service="writing"]');
    await search('search-only-model');
    await click('[data-service-choice="deepseek"]');
    expect(config.writing.service).toBe('deepseek');
    expect(config.writing.model).toBe('');
    expect(find('[data-feature-service="writing"] small').textContent).toBe('当前模型: saved-deepseek-model');
    await click('[data-feature-service="writing"]');
    await click('[data-service-choice=""]');
    expect(config.writing.service).toBe('');
    expect(find('[data-feature-service="writing"] small').textContent).toBe('当前模型: saved-openai-model');
    expect(config.model).toEqual(modelsBefore);
  });

  it('retains a removed provider as a disabled old choice without making its model selectable', async () => {
    const {config, options, root, find, click, search} = mount();
    config.customOpenAIProviders = [{id: 'custom:private', name: 'Private endpoint',
      endpoint: 'https://example.test/v1', models: ['removed-provider-model']}];
    config.service = 'custom:private';
    config.model['custom:private'] = 'removed-provider-model';
    config.token['custom:private'] = 'test-only-key';
    await click('[data-feature-service="default"]');
    expect(find('[data-service-choice="custom:private"]').hasAttribute('disabled')).toBe(false);
    config.customOpenAIProviders = [];
    options.splice(options.findIndex(option => option.value === 'custom:private'), 1);
    await runtime.nextTick();
    const removed = find('[data-service-choice="custom:private"]');
    expect(removed.hasAttribute('disabled')).toBe(true);
    expect(removed.getAttribute('aria-selected')).toBe('true');
    await search('removed-provider-model');
    expect(root.querySelector('[data-service-choice="custom:private"]')).toBeNull();
    expect(root.querySelector('.service-picker-model-hint')).toBeNull();
    expect(find('.service-picker-empty').textContent).toBe('没有匹配的翻译服务');
    expect(config.service).toBe('custom:private');
    expect(config.model['custom:private']).toBe('removed-provider-model');
    await search('DeepSeek');
    await click('[data-service-choice="deepseek"]');
    expect(config.service).toBe('deepseek');
    expect(config.model['custom:private']).toBe('removed-provider-model');
  });

  it('requests keyboard focus through model results and returns it to the same feature on Escape', async () => {
    const {config, find, click, search, key, focused} = mount();
    await click('[data-feature-service="hover"]');
    expect(focused()).toBe(find('input[type="search"]'));
    await key('input[type="search"]', 'ArrowDown');
    expect(focused()).toBe(find('[data-service-choice=""]'));
    await key('[data-service-choice=""]', 'End');
    expect(focused()).toBe(find('[data-service-choice="microsoft"]'));
    await key('[data-service-choice="microsoft"]', 'ArrowDown');
    expect(focused()).toBe(find('[data-service-choice=""]'));
    await key('[data-service-choice=""]', 'ArrowUp');
    expect(focused()).toBe(find('[data-service-choice="microsoft"]'));
    await key('[data-service-choice="microsoft"]', 'Home');
    expect(focused()).toBe(find('[data-service-choice=""]'));
    await search('search-only-model');
    await key('input[type="search"]', 'ArrowDown');
    expect(focused()).toBe(find('[data-service-choice="deepseek"]'));
    const escape = await key('[data-service-choice="deepseek"]', 'Escape');
    expect(escape.cancelBubble).toBe(true);
    expect(focused()).toBe(find('[data-feature-service="hover"]'));
    expect(config.hoverTranslationService).toBe('');
    expect(config.model.deepseek).toBe('saved-deepseek-model');
  });

  it('reopens with saved service assignments and models but without a stale search', async () => {
    const first = mount();
    await first.click('[data-feature-service="default"]');
    await first.search('search-only-model');
    await first.click('[data-service-choice="deepseek"]');
    await first.click('[data-feature-service="hover"]');
    await first.search('saved-openai-model');
    await first.click('.service-panel-close');
    expect(first.close.count).toBe(1);
    app.unmount();
    const reopened = mount(first.config);
    expect(reopened.find('[data-feature-service="default"] small').textContent).toBe('当前模型: saved-deepseek-model');
    expect(reopened.find('[data-feature-service="hover"] small').textContent).toBe('当前模型: saved-deepseek-model');
    await reopened.click('[data-feature-service="hover"]');
    expect((reopened.find('input[type="search"]') as HTMLInputElement).value).toBe('');
    expect(reopened.root.querySelector('.service-picker-model-hint')).toBeNull();
    expect(reopened.config.model.openai).toBe('saved-openai-model');
    expect(reopened.config.model.deepseek).toBe('saved-deepseek-model');
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
      const messages = language === 'zh-CN' ? zhCNMessages : UI_LANGUAGE_BUNDLES[language].messages;
      expect(Object.hasOwn(messages, 'popup.matchingModels')).toBe(true);
      expect(Object.hasOwn(messages, 'popup.serviceModelSearchHint')).toBe(true);
      expect(messages['popup.matchingModels']).toContain('{models}');
      const label = translate('popup.matchingModels', language, {models: 'unique-model'});
      expect(label).toContain('unique-model'); expect(label).not.toContain('popup.matchingModels');
      const hint = translate('popup.serviceModelSearchHint', language);
      expect(hint).not.toContain('popup.serviceModelSearchHint');
      if (language !== 'zh-CN') expect(hint).not.toBe(translate('popup.serviceModelSearchHint', 'zh-CN'));
    }
  });
});
