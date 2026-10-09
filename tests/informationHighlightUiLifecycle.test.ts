/**
 * @file tests/informationHighlightUiLifecycle.test.ts
 * 文件职责：执行信息高亮设置组件的真实 Vue 生命周期，验证偏好与模型操作归属。
 * 主要内容：覆盖模式仅保存配置、不可用状态、明确下载/暂停/删除、迟到状态、关闭视图与轮询合并。
 * 模块边界：模型消息使用受控端口，不下载实际资源；原生按钮和响应式布局由生产浏览器另行验证。
 */
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import vue from '@vitejs/plugin-vue'
import {createServer, type ViteDevServer} from 'vite'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {InformationHighlightModelStatus} from '@/src/features/information-highlight/protocol'
import {compileScript, compileTemplate, parse} from 'vue/compiler-sfc'

const runtime = createRequire(import.meta.url)('vue') as typeof import('vue')
const key = '__informationHighlightUiFixture'
let server: ViteDevServer, app: import('vue').App, state: Record<string, any>, props: Record<string, any>
const send = vi.fn()
const ready = vi.fn(), preparing = vi.fn(), retry = vi.fn()
const model = (overrides: Partial<InformationHighlightModelStatus> = {}): InformationHighlightModelStatus => ({phase: 'absent', downloaded: false, initialized: false, downloadedBytes: 0, totalBytes: 490043908, supported: true, modelName: 'Qwen2.5 0.5B', downloadSizeBytes: 490043908, ...overrides})
function deferred<T = unknown>() {let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no}); return {promise, resolve, reject}}
async function settle() {for (let i = 0; i < 8; i++) {await Promise.resolve(); await runtime.nextTick()}}
async function mount(name: 'InformationHighlightPreferences' | 'InformationHighlightModelCard' | 'PopupInformationHighlight') {
  const path = name === 'PopupInformationHighlight' ? '/src/app/popup/PopupInformationHighlight.vue' : `/src/features/settings/ui/${name}.vue`
  const component = (await server.ssrLoadModule(path)).default
  component.ssrRender = undefined; component.render = () => null
  const renderer = runtime.createRenderer<Record<string, never>, Record<string, unknown>>({patchProp: () => {}, insert: () => {}, remove: () => {}, createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText: () => {}, setElementText: () => {}, parentNode: () => null, nextSibling: () => null, querySelector: () => null, setScopeId: () => {}, cloneNode: () => ({}), insertStaticContent: () => [{}, {}]})
  props = runtime.reactive({active: true, config: {informationHighlight: {mode: 'keywords', density: 'medium', color: 'amber', style: 'background'}}, state: {snapshot: {enabled: true, sessionId: 'page:7:1', phase: 'error'}}, blockedReason: '', toggle: () => {}, retry, openSettings: () => {}, onReady: ready, onPreparing: preparing})
  app = renderer.createApp({setup: () => () => runtime.h(component, {...props, ref: (vm: any) => {if (vm) state = vm.$.setupState}})})
  app.provide(runtime.ssrContextKey, {modules: new Set<string>()}); app.config.warnHandler = () => {}; app.mount({}); await settle()
}
beforeEach(async () => {
  vi.useFakeTimers({toFake: ['setInterval', 'clearInterval']}); ready.mockReset(); preparing.mockReset(); retry.mockReset(); send.mockReset(); send.mockResolvedValue({success: true, status: model()})
  Object.assign(globalThis, {[key]: {send}})
  server = await createServer({appType: 'custom', configFile: false, logLevel: 'silent', root: process.cwd(), resolve: {alias: {'@': resolve(process.cwd(), '.')}}, ssr: {noExternal: ['webextension-polyfill']}, server: {hmr: false, middlewareMode: true}, plugins: [{name: 'information-highlight-ui-mocks', enforce: 'pre', resolveId(id) {
    if (id === 'webextension-polyfill') return '\0information-browser'
    if (/\/src\/ui\/i18n(?:\.ts)?$/u.test(id)) return '\0information-i18n'
    if (id.endsWith('.vue') && !/InformationHighlight(?:Preferences|ModelCard)\.vue$/u.test(id) && !id.endsWith('PopupInformationHighlight.vue')) return '\0information-child'
    return null
  }, load(id) {
    if (id === '\0information-browser') return `export default {runtime: {sendMessage: globalThis.${key}.send}}`
    if (id === '\0information-i18n') return 'export const useUiI18n = () => ({t: key => key});'
    if (id === '\0information-child') return 'export default {}'
    return null
  }}, vue()]})
})
afterEach(async () => {app?.unmount(); await server?.close(); delete (globalThis as any)[key]; vi.useRealTimers()})

describe('信息高亮真实偏好组件', () => {
  it('Popup 不依赖全局 Element Plus 注册：模式选择器与选项编译到明确的本地组件', () => {
    const filename = resolve(process.cwd(), 'src/features/settings/ui/InformationHighlightPreferences.vue')
    const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename})
    const script = compileScript(descriptor, {id: 'information-highlight-preferences'})
    const template = compileTemplate({source: descriptor.template!.content, filename, id: 'information-highlight-preferences', compilerOptions: {bindingMetadata: script.bindings}})
    expect(template.errors).toEqual([])
    expect(script.bindings?.UiSelect).toBeTruthy(); expect(script.bindings?.ElOption).toBeTruthy()
    expect(template.code).toContain('$setup["UiSelect"]'); expect(template.code).toContain('$setup["ElOption"]')
    expect(template.code).not.toMatch(/resolveComponent\("el-(?:select|option)"\)/u)
  })
  it('切换本地模式只改偏好，不读模型、不下载；各外观选项独立保存', async () => {
    await mount('InformationHighlightPreferences'); const original = props.config.informationHighlight
    state.actions.mode('surprisal-local'); await settle()
    expect(props.config.informationHighlight).toMatchObject({mode: 'surprisal-local', density: 'medium'}); expect(props.config.informationHighlight).not.toBe(original); expect(send).not.toHaveBeenCalled()
    state.actions.mode('cloud'); expect(props.config.informationHighlight.mode).toBe('surprisal-local')
    state.densityChoices[2].choose(); await settle(); state.colorChoices[1].choose(); await settle(); state.styleChoices[1].choose()
    expect(props.config.informationHighlight).toEqual({mode: 'surprisal-local', density: 'high', color: 'mint', style: 'underline'})
  })
  it('偏好更换、视图关闭又重开和卸载时，缓存控件不能借用新配置', async () => {
    await mount('InformationHighlightPreferences'); const oldMode = state.actions.mode, oldDensity = state.densityChoices[0].choose
    props.config.informationHighlight = {...props.config.informationHighlight, color: 'blue'}
    oldMode('surprisal-local'); oldDensity(); expect(props.config.informationHighlight.mode).toBe('keywords'); expect(props.config.informationHighlight.density).toBe('medium')
    await settle(); const color = state.colorChoices[1].choose; props.active = false; await settle(); props.active = true; await settle(); color()
    expect(props.config.informationHighlight.color).toBe('blue'); const style = state.styleChoices[1].choose; app.unmount(); style(); expect(props.config.informationHighlight.style).toBe('background')
  })
})
describe('信息高亮真实本地模型组件', () => {
  it('首次挂载只读状态，合并慢查询；周期读取显示真实字节进度', async () => {
    const query = deferred(); send.mockReturnValueOnce(query.promise); await mount('InformationHighlightModelCard')
    await state.actions.refresh(); vi.advanceTimersByTime(2000); await settle(); expect(send).toHaveBeenCalledOnce(); expect(state.reading).toBe(true)
    query.resolve({success: true, status: model({phase: 'downloading', downloadedBytes: 10})}); await settle()
    expect(state.downloading).toBe(true); expect(state.downloadProgress).toEqual({loaded: 10, total: 490043908})
    vi.advanceTimersByTime(1000); await settle(); expect(send.mock.calls.every(call => call[0].type === 'GET_INFORMATION_HIGHLIGHT_MODEL_STATUS')).toBe(true)
  })
  it('缺少 WebGPU 或隐藏视图时不能下载，迟到读取与关闭前按钮失效', async () => {
    send.mockResolvedValueOnce({success: true, status: model({supported: false})}); await mount('InformationHighlightModelCard')
    await state.actions.prepare(); expect(send).toHaveBeenCalledOnce()
    const oldPrepare = state.actions.prepare, query = deferred(); send.mockReturnValueOnce(query.promise); const pending = state.actions.refresh()
    props.active = false; await settle(); query.resolve({success: true, status: model({phase: 'ready', downloaded: true})}); await pending
    expect(state.status.supported).toBe(false); expect(state.reading).toBe(false); await oldPrepare(); vi.advanceTimersByTime(2000); await settle(); expect(send).toHaveBeenCalledTimes(2)
    props.active = true; await settle(); await oldPrepare(); expect(send).toHaveBeenCalledTimes(3)
  })
  it('明确下载会发命令且拒绝重复，暂停可抢占未完成下载，旧完成不恢复下载状态', async () => {
    await mount('InformationHighlightModelCard'); const prepare = deferred(), pause = deferred()
    send.mockReturnValueOnce(prepare.promise).mockReturnValueOnce(pause.promise)
    const starting = state.actions.prepare(); await settle(); await state.actions.prepare(); expect(state.downloading).toBe(true); expect(send).toHaveBeenCalledTimes(2)
    const pausing = state.actions.pause(); await settle(); expect(send).toHaveBeenLastCalledWith({type: 'PAUSE_INFORMATION_HIGHLIGHT_MODEL'})
    prepare.resolve({success: true, status: model({phase: 'ready', downloaded: true})}); await starting; expect(state.operation).toBe('pause'); expect(state.status.phase).toBe('absent')
    send.mockResolvedValueOnce({success: true, status: model({phase: 'paused', downloadedBytes: 20})}); pause.resolve({success: true, status: model({phase: 'paused', downloadedBytes: 20})}); await pausing; await settle()
    expect(state.downloading).toBe(false); expect(state.status.downloadedBytes).toBe(20)
    expect(ready).not.toHaveBeenCalled()
  })
  it('明确下载触发的一次 ready 事件在真实完成轮询后发生，单独读取已就绪状态不触发使用', async () => {
    await mount('InformationHighlightModelCard')
    send.mockResolvedValueOnce({success: true, status: model({phase: 'queued'})}).mockResolvedValueOnce({success: true, status: model({phase: 'downloading', downloadedBytes: 20})})
    await state.actions.prepare(); await settle(); expect(preparing).toHaveBeenCalledOnce(); expect(ready).not.toHaveBeenCalled()
    send.mockResolvedValue({success: true, status: model({phase: 'ready', downloaded: true})})
    await state.actions.refresh(); expect(ready).toHaveBeenCalledOnce(); await state.actions.refresh(); expect(ready).toHaveBeenCalledOnce()
  })
  it('下载后的资源只能明确删除，旧读取不覆盖新命令，命令失败可重试', async () => {
    send.mockResolvedValueOnce({success: true, status: model({phase: 'ready', downloaded: true, initialized: true})}); await mount('InformationHighlightModelCard')
    const query = deferred(); send.mockReturnValueOnce(query.promise); const reading = state.actions.refresh()
    send.mockResolvedValueOnce({success: true, status: model()}); await state.actions.remove(); await settle()
    query.resolve({success: true, status: model({phase: 'ready', downloaded: true})}); await reading; expect(state.status.downloaded).toBe(false)
    send.mockRejectedValueOnce(Error('remove')).mockResolvedValueOnce({success: false}); await state.actions.remove(); await settle(); expect(state.error).toBe(true); expect(state.operation).toBeNull()
    await state.actions.refresh(); expect(state.error).toBe(false)
    expect(send.mock.calls.filter(call => call[0].type === 'REMOVE_INFORMATION_HIGHLIGHT_MODEL')).toHaveLength(2)
  })
  it.each([{success: false}, null, {success: true, status: model({phase: 'unknown' as any})}, {success: true, status: model({downloadedBytes: -1})}, {success: true, status: {...model(), modelName: undefined}}])('无效资源回复 %j 显示错误且不下载', async response => {
    send.mockResolvedValueOnce(response); await mount('InformationHighlightModelCard'); expect(state.error).toBe(true); expect(state.status).toBeNull(); await state.actions.prepare(); expect(send).toHaveBeenCalledOnce()
  })
  it('卸载后的查询异常和命令完成不再改变资源状态或启动轮询', async () => {
    await mount('InformationHighlightModelCard'); const query = deferred(); send.mockReturnValueOnce(query.promise); const pending = state.actions.refresh(); const old = state.actions.prepare
    app.unmount(); query.reject(Error('closed')); await pending; await old(); vi.advanceTimersByTime(3000); await settle(); expect(state.error).toBe(false); expect(send).toHaveBeenCalledTimes(2)
  })
})
describe('信息高亮抽屉下载后使用归属', () => {
  it('只有当前已开启本地模式的明确下载会重试一次，不把初次 GET ready 当作使用命令', async () => {
    await mount('PopupInformationHighlight'); state.modelReady(); expect(retry).not.toHaveBeenCalled()
    props.config.informationHighlight.mode = 'surprisal-local'; state.modelPreparing(); state.modelReady(); state.modelReady(); expect(retry).toHaveBeenCalledOnce()
  })
  it.each(['keywords', 'disabled', 'closed'])('%s 后迟到模型 ready 不开启页面', async reason => {
    await mount('PopupInformationHighlight'); props.config.informationHighlight.mode = 'surprisal-local'; state.modelPreparing()
    if (reason === 'keywords') props.config.informationHighlight.mode = 'keywords'
    else if (reason === 'disabled') props.state.snapshot.enabled = false
    else props.active = false
    await settle()
    state.modelReady(); expect(retry).not.toHaveBeenCalled()
  })
  it('下载开始时未开启不自动启页，新页回调也不能替换已捕获的旧页所有权', async () => {
    await mount('PopupInformationHighlight'); props.config.informationHighlight.mode = 'surprisal-local'; props.state.snapshot.enabled = false
    state.modelPreparing(); props.state.snapshot.enabled = true; state.modelReady(); expect(retry).not.toHaveBeenCalled()
    let page = 'old'; const old = vi.fn(() => {if (page === 'old') retry()}); props.retry = old; await settle(); state.modelPreparing(); page = 'new'; props.retry = retry; await settle(); state.modelReady()
    expect(old).toHaveBeenCalledOnce(); expect(retry).not.toHaveBeenCalled()
  })
})
