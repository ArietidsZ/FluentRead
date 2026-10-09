/**
 * @file tests/informationHighlightSettingsLifecycle.test.ts
 * 文件职责：验证阅读辅助设置中信息高亮的真实父子模板、回退操作归属和按需模型读取。
 * 主要内容：执行 Settings、Preferences 与 ModelCard 的 Vue setup 和客户端模板，覆盖模式后插槽、只改偏好的关键词回退，以及配置替换、隐藏、缓存停用、卸载和迟到读取。
 * 模块边界：使用受控浏览器消息与 Linkedom 节点树；不下载模型、不启用网页、不验证真实浏览器布局或 GPU 性能。
 */
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {parseHTML} from 'linkedom'
import vue from '@vitejs/plugin-vue'
import {createServer, type ViteDevServer} from 'vite'
import {compileScript, compileTemplate, parse} from 'vue/compiler-sfc'
import ts from 'typescript'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {Config} from '@/src/core/config/model'
import type {InformationHighlightModelStatus} from '@/src/features/information-highlight/protocol'

const runtime = createRequire(import.meta.url)('vue') as typeof import('vue')
const key = '__fluentReadInformationHighlightSettingsLifecycle'
const folder = 'src/features/settings/ui/'
const realComponents = ['InformationHighlightSettings', 'InformationHighlightPreferences', 'InformationHighlightModelCard', 'InformationHighlightPreview', 'SettingsGroup']
let server: ViteDevServer | undefined, app: import('vue').App | undefined
let document: Document, state: Record<string, any>, props: {config: Config; active?: boolean}
let shown: import('vue').Ref<boolean>, events: Map<Element, Record<string, any>>
const send = vi.fn((_message: {type: string}) => Promise.resolve({success: true, status: model()}))
function model(overrides: Partial<InformationHighlightModelStatus> = {}): InformationHighlightModelStatus {
  return {phase: 'absent', downloaded: false, initialized: false, downloadedBytes: 0, totalBytes: 490043908,
    supported: true, modelName: 'Qwen2.5 0.5B', downloadSizeBytes: 490043908, ...overrides}
}
function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(yes => {resolve = yes}); return {promise, resolve}}
async function settle() {for (let i = 0; i < 8; i++) {await Promise.resolve(); await runtime.nextTick()}}
function element(selector: string): Element {const current = document.querySelector(selector); expect(current, selector).not.toBeNull(); return current!}
function event(selector: string, name = 'onClick'): (...args: unknown[]) => unknown {
  const callback = events.get(element(selector))?.[name]; expect(callback, `${selector} ${name}`).toBeTypeOf('function'); return callback
}
function modeSelect() {return event('[data-information-highlight-mode-select]', 'onUpdate:modelValue')}
function messages() {return send.mock.calls.map(([message]) => message.type)}
function expectOnlyReads() {expect(messages().every(type => type === 'GET_INFORMATION_HIGHLIGHT_MODEL_STATUS')).toBe(true)}

beforeEach(async () => {
  vi.useFakeTimers({toFake: ['setInterval', 'clearInterval']}); send.mockReset(); send.mockResolvedValue({success: true, status: model()})
  events = new Map(); document = parseHTML('<html><body><div id="app"></div></body></html>').document as unknown as Document
  Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'visible'})
  vi.stubGlobal('document', document); Object.assign(globalThis, {[key]: {send}})
  server = await createServer({appType: 'custom', configFile: false, logLevel: 'silent', root: process.cwd(),
    resolve: {alias: {'@': resolve(process.cwd())}}, ssr: {noExternal: ['webextension-polyfill', 'element-plus']},
    server: {hmr: false, middlewareMode: true}, plugins: [{name: 'information-highlight-settings-controlled-ports', enforce: 'pre', resolveId(id) {
      if (id === 'webextension-polyfill') return '\0highlight-settings-browser'
      if (/\/src\/ui\/i18n(?:\.ts)?$/u.test(id)) return '\0highlight-settings-i18n'
      if (id === 'element-plus') return '\0highlight-settings-options'
      if (id.endsWith('/UiSelect.vue')) return '\0highlight-settings-select'
      if (id.endsWith('.vue') && !realComponents.some(name => id.endsWith(`/${name}.vue`))) return '\0highlight-settings-display'
      return null
    }, load(id) {
      if (id === '\0highlight-settings-browser') return `export default {runtime: {sendMessage: globalThis.${key}.send}}`
      if (id === '\0highlight-settings-i18n') return 'export const useUiI18n = () => ({t: key => key});'
      if (id === '\0highlight-settings-options') return 'export const ElOption = {render: () => null};'
      if (id === '\0highlight-settings-select') return "import {h} from 'vue';export default {setup(_, {attrs, slots}) {return () => h('div', attrs, slots.default?.())}};"
      if (id === '\0highlight-settings-display') return 'export default {render: () => null};'
      return null
    }}, vue()]})
})
afterEach(async () => {
  app?.unmount(); app = undefined; await settle(); await server?.close(); server = undefined
  delete (globalThis as Record<string, unknown>)[key]; vi.unstubAllGlobals(); vi.useRealTimers()
})
async function compile(relative: string) {
  const filename = resolve(relative), {descriptor} = parse(readFileSync(filename, 'utf8'), {filename})
  const script = compileScript(descriptor, {id: 'information-highlight-settings-client'})
  const template = compileTemplate({source: descriptor.template!.content, filename, id: 'information-highlight-settings-client',
    compilerOptions: {mode: 'function', cacheHandlers: true, bindingMetadata: script.bindings, expressionPlugins: ['typescript']}})
  expect(template.errors).toEqual([])
  const component = (await server!.ssrLoadModule(`/${relative}`)).default; component.ssrRender = undefined
  component.render = new Function('Vue', ts.transpileModule(template.code, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText)(runtime)
  return component
}
async function mount(mode: 'keywords' | 'surprisal-local' = 'surprisal-local', active: boolean | undefined = true) {
  for (const name of realComponents.filter(name => name !== 'InformationHighlightSettings')) {
    await compile(`${folder}${name === 'SettingsGroup' ? 'components/' : ''}${name}.vue`)
  }
  const component = await compile(`${folder}InformationHighlightSettings.vue`)
  props = runtime.reactive({config: new Config(), active}); props.config.on = false
  props.config.informationHighlight = {mode, density: 'high', color: 'blue', style: 'underline'}; shown = runtime.ref(true)
  const renderer = runtime.createRenderer<Node, Element>({patchProp(el, name, _previous, value) {
    const handlers = events.get(el) || {}; events.set(el, handlers)
    if (/^on[A-Z]/u.test(name)) {handlers[name] = value; return}
    if (name === 'class') {el.setAttribute('class', value || ''); return}
    if (value === false || value === undefined || value === null) el.removeAttribute(name); else el.setAttribute(name, String(value))
  }, insert: (child, parent, anchor = null) => parent.insertBefore(child, anchor), remove: child => child.parentNode?.removeChild(child),
    createElement: tag => document.createElement(tag), createText: text => document.createTextNode(text), createComment: text => document.createComment(text),
    setText: (node, text) => {node.nodeValue = text}, setElementText: (el, text) => {el.textContent = text},
    parentNode: node => node.parentNode as Element | null, nextSibling: node => node.nextSibling, querySelector: selector => document.querySelector(selector),
    setScopeId: (el, id) => el.setAttribute(id, ''), cloneNode: node => node.cloneNode(true), insertStaticContent: (html, parent, anchor) => {
      const template = document.createElement('template'); template.innerHTML = html
      const first = template.content.firstChild!, last = template.content.lastChild!; parent.insertBefore(template.content, anchor); return [first, last]
    }})
  app = renderer.createApp({setup: () => () => runtime.h(runtime.KeepAlive, null, {default: () => shown.value
    ? runtime.h(component, {...props, ref: (vm: any) => {if (vm) state = vm.$.setupState}}) : runtime.h({render: () => null}, {key: 'other'})})})
  app.provide(runtime.ssrContextKey, {modules: new Set<string>()}); app.config.warnHandler = () => {}
  app.mount(document.getElementById('app')!); await settle()
}

describe('信息高亮设置真实父子模板与生命周期', () => {
  it('关键词模式不挂载模型卡；改成本地模式后只读取状态，模型卡在模式与密度之间', async () => {
    await mount('keywords'); expect(document.querySelector('[data-testid="information-highlight-model-card"]')).toBeNull(); expect(send).not.toHaveBeenCalled()
    modeSelect()('surprisal-local'); await settle()
    const card = element('[data-testid="information-highlight-model-card"]'), preferences = element('[data-testid="information-highlight-preferences"]')
    const mode = element('[data-information-highlight-mode-select]').closest('label')!, density = element('[data-information-highlight-density="low"]').closest('.highlight-field')!
    expect(card.parentElement).toBe(preferences); expect(mode.nextElementSibling).toBe(card); expect(card.nextElementSibling).toBe(density)
    expect(messages()).toEqual(['GET_INFORMATION_HIGHLIGHT_MODEL_STATUS']); expect(props.config.on).toBe(false)
    vi.advanceTimersByTime(15000); await settle(); expect(send).toHaveBeenCalledTimes(2); expectOnlyReads()
  })
  it('实际模型卡关键词按钮只替换偏好模式，保留其余设置并停止模型轮询', async () => {
    await mount(); const original = props.config.informationHighlight
    event('[data-information-highlight-fallback]')(); await settle()
    expect(props.config.informationHighlight).toEqual({mode: 'keywords', density: 'high', color: 'blue', style: 'underline'})
    expect(props.config.informationHighlight).not.toBe(original); expect(original.mode).toBe('surprisal-local'); expect(props.config.on).toBe(false)
    expect(document.querySelector('[data-testid="information-highlight-model-card"]')).toBeNull()
    vi.advanceTimersByTime(60000); await settle(); expect(messages()).toEqual(['GET_INFORMATION_HIGHLIGHT_MODEL_STATUS'])
  })
  it.each(['configuration', 'preferences'] as const)('%s 替换后旧关键词回调失效，当前回调仍可写入', async reason => {
    await mount(); const old = state.useKeywords, oldConfig = props.config, oldPreferences = props.config.informationHighlight
    if (reason === 'configuration') {
      const replacement = new Config(); replacement.on = false; replacement.informationHighlight = {...oldPreferences, color: 'mint'}; props.config = replacement
      await settle()
    } else props.config.informationHighlight = {...oldPreferences, color: 'mint'}
    old(); expect(props.config.informationHighlight).toEqual({...oldPreferences, color: 'mint'}); expect(oldPreferences.mode).toBe('surprisal-local')
    expect(oldConfig.informationHighlight.mode).toBe('surprisal-local')
    await settle(); state.useKeywords(); await settle(); expect(props.config.informationHighlight.mode).toBe('keywords'); expect(props.config.on).toBe(false); expectOnlyReads()
  })
  it.each(['hidden', 'cached', 'unmounted'] as const)('%s 后旧父回调和真实按钮不能写入；重新进入也不能复用旧回调', async reason => {
    await mount(); const old = state.useKeywords, oldButton = event('[data-information-highlight-fallback]'), before = {...props.config.informationHighlight}
    if (reason === 'hidden') props.active = false
    else if (reason === 'cached') shown.value = false
    else {app!.unmount(); app = undefined}
    await settle(); old(); oldButton(); expect(props.config.informationHighlight).toEqual(before)
    vi.advanceTimersByTime(60000); await settle(); expect(messages()).toEqual(['GET_INFORMATION_HIGHLIGHT_MODEL_STATUS'])
    if (reason !== 'unmounted') {
      if (reason === 'hidden') props.active = true; else shown.value = true
      await settle(); old(); oldButton(); expect(props.config.informationHighlight).toEqual(before)
      state.useKeywords(); await settle(); expect(props.config.informationHighlight.mode).toBe('keywords')
    }
    expectOnlyReads()
  })
  it('初始隐藏不读模型或允许回退，显现后只读资源；未声明 active 时遵循默认可操作', async () => {
    await mount('surprisal-local', false); const hidden = state.useKeywords; hidden(); expect(send).not.toHaveBeenCalled(); expect(props.config.informationHighlight.mode).toBe('surprisal-local')
    props.active = undefined; await settle(); hidden(); expect(props.config.informationHighlight.mode).toBe('surprisal-local')
    expect(messages()).toEqual(['GET_INFORMATION_HIGHLIGHT_MODEL_STATUS']); event('[data-information-highlight-fallback]')(); await settle()
    expect(props.config.informationHighlight.mode).toBe('keywords'); expect(props.config.on).toBe(false); expectOnlyReads()
  })
  it('模型读取已就绪不自动下载或启页，外观修改不重新挂载资源卡', async () => {
    send.mockResolvedValue({success: true, status: model({phase: 'ready', downloaded: true, initialized: true})})
    await mount(); const card = element('[data-testid="information-highlight-model-card"]')
    expect(element('.highlight-model-ready').textContent).toBe('informationHighlight.model.offlineReady'); expect(props.config.on).toBe(false)
    event('[data-information-highlight-color="mint"]')(); await settle()
    expect(element('[data-testid="information-highlight-model-card"]')).toBe(card); expect(messages()).toEqual(['GET_INFORMATION_HIGHLIGHT_MODEL_STATUS'])
  })
  it('离开本地模式后迟到 ready 不挂回模型卡或启页，重新选择只发新的状态读取', async () => {
    const query = deferred<{success: boolean; status: InformationHighlightModelStatus}>(); send.mockReturnValueOnce(query.promise)
    await mount(); modeSelect()('keywords'); await settle()
    query.resolve({success: true, status: model({phase: 'ready', downloaded: true, initialized: true})}); await settle()
    expect(document.querySelector('[data-testid="information-highlight-model-card"]')).toBeNull(); expect(props.config.informationHighlight.mode).toBe('keywords'); expect(props.config.on).toBe(false)
    vi.advanceTimersByTime(60000); await settle(); expect(send).toHaveBeenCalledOnce()
    modeSelect()('surprisal-local'); await settle(); expect(messages()).toEqual(['GET_INFORMATION_HIGHLIGHT_MODEL_STATUS', 'GET_INFORMATION_HIGHLIGHT_MODEL_STATUS'])
    expect(element('[data-testid="information-highlight-model-card"]')).toBeTruthy(); expect(props.config.on).toBe(false)
  })
})
