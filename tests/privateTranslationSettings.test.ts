import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import vue from '@vitejs/plugin-vue';
import {createServer, type ViteDevServer} from 'vite';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Config} from '@/src/core/config/model';
const require = createRequire(import.meta.url);
const {createSSRApp, h} = require('vue');
const {renderToString} = require('vue/server-renderer');
let server: ViteDevServer;
let component: any;
beforeAll(async () => {
  server = await createServer({appType: 'custom', configFile: false, logLevel: 'silent', root: process.cwd(),
    resolve: {alias: {'@': resolve(process.cwd(), '.')}}, server: {hmr: false, middlewareMode: true},
    plugins: [{name: 'private-settings-test-language', enforce: 'pre', resolveId(id) {
      return /\/src\/ui\/i18n(?:\.ts)?$/u.test(id) ? '\0private-settings-test-language' : null;
    }, load(id) {return id === '\0private-settings-test-language'
      ? `import {translate} from '@/src/core/i18n'; export const useUiI18n = () => ({t: (key, params) => translate(key, 'zh-CN', params), translateLegacy: text => text});` : null;}}, vue()],
  });
  component = (await server.ssrLoadModule('/src/features/settings/ui/PrivateTranslationSettings.vue')).default;
});
afterAll(async () => server?.close());
const serviceOptions = [{value: 'openai', label: 'OpenAI'}, {value: 'deepseek', label: 'DeepSeek'},
  {value: 'localTranslation', label: '本地模型'}, {value: 'freeTranslation', label: '免费多供应商'}];
async function render(config: Config) {
  const app = createSSRApp(component, {config, serviceOptions});
  app.component('el-select', {props: ['modelValue'], setup(_props: unknown, {attrs, slots}: any) {
    return () => h('select', attrs, slots.default?.());
  }});
  app.component('el-option', {props: ['value', 'label', 'disabled'], setup(props: any) {
    return () => h('option', {value: props.value, disabled: props.disabled}, props.label);
  }});
  app.component('el-switch', {props: ['modelValue'], setup(props: any, {attrs}: any) {
    return () => h('input', {...attrs, type: 'checkbox', checked: props.modelValue});
  }});
  app.config.warnHandler = () => {};
  return renderToString(app);
}
describe('private translation settings compiled Vue template', () => {
  it('defaults off and explains browser permission without changing preferences', async () => {
    const config = new Config(); const before = JSON.stringify(config); const html = await render(config);
    expect(html).toContain('需自行允许扩展'); expect(html).toContain('关闭时沿用普通配置');
    expect(html).not.toContain('aria-label="专用翻译服务"'); expect(JSON.stringify(config)).toBe(before);
  });
  it('shows dedicated choices, routing failure policy and accurate network scope', async () => {
    const config = new Config(); config.privateTranslation = {enabled: true, service: 'openai', model: 'private-model'};
    const before = JSON.stringify(config); const html = await render(config);
    expect(html).toContain('aria-label="专用翻译服务"'); expect(html).toContain('aria-label="专用模型"');
    expect(html).toContain('不回退其他供应商'); expect(html).toContain('选择云端服务仍会发送内容');
    expect(html).toContain('词典、朗读及音视频识别沿用各自设置');
    expect(html).not.toContain('免费多供应商'); expect(JSON.stringify(config)).toBe(before);
  });
  it('offers only known local models even if an old custom-model list contains a typo', async () => {
    const config = new Config(); config.privateTranslation = {enabled: true, service: 'localTranslation', model: config.model.localTranslation};
    config.customModels.localTranslation = ['typo-or-retired'];
    const html = await render(config); expect(html).not.toContain('typo-or-retired');
    expect(html).toContain(config.privateTranslation.model);
  });
  it('keeps an unavailable configured provider visible instead of replacing it', async () => {
    const config = new Config(); config.privateTranslation = {enabled: true, service: 'custom:deleted', model: 'kept-model'};
    const html = await render(config); expect(html).toContain('custom:deleted (不可用)');
    expect(html).toContain('无痕窗口专用服务不可用'); expect(config.privateTranslation.model).toBe('kept-model');
  });
});
