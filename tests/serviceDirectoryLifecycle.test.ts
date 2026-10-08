/**
 * @file tests/serviceDirectoryLifecycle.test.ts
 * 文件职责：验证服务目录和免费权重设置的实际组件生命周期、缓存模板及有界读取。
 * 主要内容：覆盖停用与切换、迟到后台快照、轮询合并、目录焦点、搜索计算、分组导航与尺寸观察的旧 DOM 事件。
 * 模块边界：编译真实客户端 Vue setup 和缓存模板并实际 mount，模块加载器只解析导入；浏览器消息、DOM 几何与观察器使用受控端口，不复制目录业务；真实 UI 另行验证。
 */
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import vue from '@vitejs/plugin-vue'
import {createServer, type ViteDevServer} from 'vite'
import {compileScript, compileTemplate, parse} from 'vue/compiler-sfc'
import ts from 'typescript'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {Config} from '@/src/core/config/model'
import {FREE_TRANSLATION_PROVIDERS} from '@/src/core/config/freeTranslation'
import {calculateFreeTranslationWeightSnapshot, FREE_TRANSLATION_WEIGHT_REFRESH_INTERVAL_MS} from '@/src/services/translation/freeWeights'

const runtime = createRequire(import.meta.url)('vue') as typeof import('vue')
let server: ViteDevServer, app: import('vue').App, state: Record<string, any>, props: Record<string, any>
let shown: import('vue').Ref<boolean>, nodes: Node[], source: Record<string, any>, hostRoot: Node
type Node = {tag: string; props: Record<string, any>; value?: string; focus?: () => void; closest?: () => unknown; parent?: Node; children?: Node[];
  style?: Record<string, string>; dataset?: Record<string, string>; scrollTop?: number; clientHeight?: number; scrollHeight?: number;
  getClientRects?: () => unknown[]; getBoundingClientRect?: () => {top: number}; querySelectorAll?: (selector: string) => Node[]}
const clientModules = new Map<string, string>()
const groupScroll = vi.fn(), readRects = vi.fn(), reducedMotion = vi.fn(() => false)
const geometry = {visible: true, tops: new Map<string, number>()}
const observers: {callback: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>}[] = []
function descendants(n: Node): Node[] {return (n.children || []).flatMap(child => [child, ...descendants(child)])}
function publicNode(predicate: (n: Node) => boolean): Node {const n = descendants(hostRoot).find(predicate);expect(n).toBeDefined();return n!}
function groupHeader(id: string): Node {
  const section = publicNode(n => n.props['data-service-section'] === id)
  const header = descendants(section).find(n => n.props.class === 'directory-section-toggle');expect(header).toBeDefined();return header!
}
function navigation(id: string): Node {return publicNode(n => n.props['data-service-group-link'] === id)}
function queryInput(): Node {return publicNode(n => n.tag === 'input' && n.props.type === 'search')}
async function search(value: string) {queryInput().props.onInput({currentTarget: {value}});await settle()}
function observer() {const current = observers.at(-1);expect(current).toBeDefined();return current!}

const focus = vi.fn(), scroll = vi.fn(), emitted = vi.fn(), send = vi.fn()
const intervals = new Map<number, () => void>(), timeouts = new Map<number, () => void>()
let timerId = -1
const timerCount = () => intervals.size + timeouts.size
async function tickIntervals(count = 1) {for (let i = 0; i < count; i++) {for (const callback of [...intervals.values()]) callback();await settle()}}
const providerNames = ['microsoft', 'google']
const catalog = [{value: 'machine', label: 'Machine', disabled: true}, {value: 'microsoft', label: 'Microsoft'}, {value: 'google', label: 'Google'}]
async function settle() {await runtime.nextTick();await Promise.resolve();await runtime.nextTick();await Promise.resolve()}
function deferred<T>() {let resolve!: (value: T) => void, reject!: (error: unknown) => void;const promise = new Promise<T>((yes, no) => {resolve = yes;reject = no});return {promise, resolve, reject}}
function response(ids = props.config.freeTranslationOrder) {return {success: true, snapshot: calculateFreeTranslationWeightSnapshot(ids, [], 123)}}
function node(predicate: (n: Node) => boolean) {const found = [...nodes].reverse().find(predicate);expect(found).toBeDefined();return found!}
beforeEach(async () => {
  vi.clearAllMocks();intervals.clear();timeouts.clear();clientModules.clear();observers.length = 0;geometry.visible = true;geometry.tops.clear();reducedMotion.mockReturnValue(false)
  vi.stubGlobal('window', {matchMedia: () => ({matches: reducedMotion()})})
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn();disconnect = vi.fn()
    constructor(callback: () => void) {observers.push({callback, observe: this.observe, disconnect: this.disconnect})}
  })
  send.mockReset();send.mockResolvedValue({success: false});vi.stubGlobal('__fluentreadDirectorySend', send)
  server = await createServer({root: process.cwd(), configFile: false, appType: 'custom', logLevel: 'silent',
    resolve: {alias: {'@': process.cwd()}}, server: {hmr: false, middlewareMode: true}, ssr: {noExternal: ['webextension-polyfill']},
    plugins: [{name: 'service-directory-controlled-ports', enforce: 'pre', resolveId(id) {
      if (clientModules.has(id)) return id
      if (id === 'webextension-polyfill') return '\0directory-browser'
      if (/\/src\/ui\/i18n(?:\.ts)?$/u.test(id)) return '\0directory-i18n'
      if (id.endsWith('.vue') && !/\/(?:ServiceCatalog|FreeTranslationSettings)\.vue$/u.test(id)) return '\0directory-display'
      return null
    }, load(id) {
      if (clientModules.has(id)) return clientModules.get(id)
      if (id === '\0directory-browser') return 'export default {runtime: {sendMessage: (...args) => globalThis.__fluentreadDirectorySend(...args)}}'
      if (id === '\0directory-i18n') return 'export const useUiI18n = () => ({t: key => key, translateLegacy: text => text})'
      if (id === '\0directory-display') return "import {h} from 'vue';export default {setup(_, {attrs, slots}) {return () => h('button', {...attrs, 'data-directory-port': attrs.item?.value}, slots.default?.())}}"
      return null
    }}, vue()]})
})
afterEach(async () => {
  try {app?.unmount();await settle()}
  finally {
    vi.restoreAllMocks()
    try {await server?.close()}
    finally {vi.unstubAllGlobals();clientModules.clear()}
  }
})
async function mount(name: string, values: Record<string, unknown>, listeners: Record<string, unknown> = {}) {
  const path = `src/features/settings/ui/services/${name}.vue`, filename = resolve(path)
  const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename})
  const script = compileScript(descriptor, {id: 'directory-lifecycle'})
  const clientId = `${filename}.lifecycle-client.ts`
  clientModules.set(clientId, script.content)
  const component = (await server.ssrLoadModule(clientId)).default, bindings = script.bindings
  const template = compileTemplate({source: descriptor.template!.content, filename, id: 'directory-lifecycle',
    compilerOptions: {mode: 'function', cacheHandlers: true, bindingMetadata: bindings, expressionPlugins: ['typescript']}})
  expect(template.errors).toEqual([])
  component.render = new Function('Vue', ts.transpileModule(template.code, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText)(runtime)
  if (!vi.isMockFunction(globalThis.setInterval)) {
    const originalInterval = globalThis.setInterval, originalTimeout = globalThis.setTimeout, clearInterval = globalThis.clearInterval, clearTimeout = globalThis.clearTimeout
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => void, ms: number, ...args: any[]) => {
      if (ms !== FREE_TRANSLATION_WEIGHT_REFRESH_INTERVAL_MS) return originalInterval(callback, ms, ...args)
      const id = timerId--;intervals.set(id, callback);return id
    }) as typeof setInterval)
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(((id: any) => {if (!intervals.delete(id)) clearInterval(id)}) as typeof globalThis.clearInterval)
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, ms: number, ...args: any[]) => {
      if (ms !== 10_000) return originalTimeout(callback, ms, ...args)
      const id = timerId--;timeouts.set(id, callback);return id
    }) as typeof setTimeout)
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((id: any) => {if (!timeouts.delete(id)) clearTimeout(id)}) as typeof globalThis.clearTimeout)
  }
  nodes = [];shown = runtime.ref(true)
  function remove(n: Node) {if (n.parent?.children) {const list = n.parent.children, index = list.indexOf(n);if (index >= 0) list.splice(index, 1)}n.parent = undefined}
  function insert(n: Node, parent: Node, anchor?: Node | null) {remove(n);const list = parent.children ||= [];const index = anchor ? list.indexOf(anchor) : -1;list.splice(index < 0 ? list.length : index, 0, n);n.parent = parent}
  const renderer = runtime.createRenderer<Node, Node>({patchProp: (n, key, _before, value) => {n.props[key] = value;if (key === 'value') n.value = value}, insert, remove,
    createElement: tag => {
      const n: Node = {tag, value: '', props: {}, style: {}, focus, closest: () => ({querySelector: () => ({scrollTo: scroll})}),
        get dataset() {return {serviceSection: n.props['data-service-section']}},
        scrollTop: 0, clientHeight: 100, scrollHeight: 500,
        getClientRects: () => {readRects(n);return geometry.visible ? [{}] : []},
        getBoundingClientRect: () => ({top: geometry.tops.get(n.props['data-service-section']) ?? 0}),
        querySelectorAll: selector => descendants(n).filter(child => selector === '[data-service-section]' && child.props['data-service-section']),
      }
      Object.assign(n, {tagName: tag.toUpperCase(), addEventListener: () => {}, removeEventListener: () => {}, scrollTo: groupScroll})
      nodes.push(n);return n
    },
    createText: () => ({tag: '#text', props: {}}), createComment: () => ({tag: '#comment', props: {}}), setText: () => {}, setElementText: () => {},
    parentNode: n => n.parent || null, nextSibling: n => {const list = n.parent?.children || [];return list[list.indexOf(n) + 1] || null}, querySelector: () => null, setScopeId: () => {}, cloneNode: n => ({...n}),
    insertStaticContent: (_html, parent, anchor) => {const start = {tag: '#static-start', props: {}}, end = {tag: '#static-end', props: {}};insert(start, parent, anchor);insert(end, parent, anchor);return [start, end]}})
  source = runtime.shallowReactive({active: true, context: {}, ...values})
  app = renderer.createApp({setup: () => () => runtime.h(runtime.KeepAlive, null, {default: () => shown.value
    ? runtime.h(component, {...source, ...listeners, ref: (vm: any) => {if (vm) {state = vm.$.setupState;props = vm.$.props}}})
    : runtime.h({render: () => null}, {key: 'other'})})})
  const display = {setup(_props: unknown, {attrs, slots}: any) {return () => runtime.h('input', attrs, slots.default?.())}}
  app.component('el-input', display);app.component('el-input-number', display);app.component('el-switch', display)
  app.component('el-tooltip', {setup(_props: unknown, {slots}: any) {return () => runtime.h('span', null, slots.default?.())}})
  app.config.warnHandler = () => {};hostRoot = {tag: '#root', props: {}};app.mount(hostRoot);await settle()
}
async function mountFree(values: Record<string, unknown> = {}) {await mount('FreeTranslationSettings', {config: runtime.reactive(new Config()), ...values})}
async function mountCatalog(values: Record<string, unknown> = {}) {await mount('ServiceCatalog', {service: 'microsoft', defaultService: 'microsoft', services: catalog,
  favoriteServices: [], configuredServices: [], modelOptions: [], showModel: false, maximumModels: 5, maximumModelLength: 50, customModelCount: 0, allowCustomModels: false, ...values}, {'onUpdate:service': emitted, 'onAdd:service': emitted})}
function invalidate(reason: string) {
  if (reason === 'hidden') props.active = false
  if (reason === 'cached') shown.value = false
  if (reason === 'unmount') app.unmount()
  if (reason === 'config') props.config = runtime.reactive(new Config())
  if (reason === 'context') props.context = {}
  if (reason === 'advanced') props.advanced = true
  if (reason === 'sequential') props.config.freeTranslationMode = 'sequential'
  if (reason === 'service') props.service = 'google'
}

describe('免费设置的轮询和模板事件归属', () => {
  it.each(['hidden', 'cached', 'unmount', 'config', 'advanced', 'sequential'])('%s之后丢弃旧权重响应，停用时不再轮询', async reason => {
    const pending = deferred<unknown>();send.mockReturnValueOnce(pending.promise);await mountFree();const old = response();expect(send).toHaveBeenCalledOnce()
    invalidate(reason);await settle();pending.resolve(old);await settle();expect(state.weightSnapshot?.observedAt).not.toBe(123)
    if (reason !== 'config') {await tickIntervals(2);expect(send).toHaveBeenCalledOnce();expect(timerCount()).toBe(0)}
  })
  it('初始顺序策略与高级字段不创建权重计时器，回到分流模式创建一条轮询', async () => {
    const config = runtime.reactive(new Config());config.freeTranslationMode = 'sequential';await mountFree({config});expect(send).not.toHaveBeenCalled();expect(timerCount()).toBe(0)
    state.setMode('balanced');await settle();expect(send).toHaveBeenCalledOnce();expect(timerCount()).toBe(1)
    props.advanced = true;await settle();expect(timerCount()).toBe(0);props.advanced = false;await settle();expect(send).toHaveBeenCalledTimes(2);expect(timerCount()).toBe(1)
  })
  it('同一轮读取合并并发调用，完成后允许下一轮', async () => {
    await mountFree();send.mockClear();const pending = deferred<unknown>();send.mockReturnValue(pending.promise)
    const first = state.refreshWeights(), second = state.refreshWeights();expect(send).toHaveBeenCalledOnce();pending.resolve(response());await Promise.all([first, second]);expect(state.weightSnapshot.observedAt).toBe(123)
    send.mockResolvedValue({success: false});await state.refreshWeights();expect(send).toHaveBeenCalledTimes(2);expect(state.weightSnapshot).toBeNull()
  })
  it('同一渲染批次中的顺序变更只读取最终一次，旧状态立即回退本地', async () => {
    await mountFree();state.weightSnapshot = response().snapshot;send.mockClear()
    props.config.freeTranslationOrder = ['microsoft'];props.config.freeTranslationOrder = [...providerNames];props.config.myMemoryEmail = 'fixture@example.test'
    expect(state.weightSnapshot).toBeNull();await settle();expect(send).toHaveBeenCalledOnce();expect(timerCount()).toBe(1)
  })
  it('悬挂读取十秒结束等待，迟到失败不污染下一轮且没有未处理拒绝', async () => {
    await mountFree();const pending = deferred<unknown>();send.mockReturnValueOnce(pending.promise);let ended = false
    void state.refreshWeights().then(() => {ended = true});for (const callback of [...timeouts.values()]) callback();await settle();expect(ended).toBe(true);expect(state.weightSnapshot).toBeNull()
    send.mockResolvedValue(response());await state.refreshWeights();expect(state.weightSnapshot.observedAt).toBe(123);pending.reject(new Error('late'));await settle();expect(state.weightSnapshot.observedAt).toBe(123);expect(timerCount()).toBe(1)
  })
  it('拒绝后台仍属于旧启停集合的快照，保留当前全目录和本地分配', async () => {
    await mountFree();send.mockResolvedValue(response(['google']));await state.refreshWeights();expect(state.weightSnapshot).toBeNull()
    const ids = FREE_TRANSLATION_PROVIDERS.map(provider => provider.id)
    expect(state.displayedWeightSnapshot.entries.map((entry: {providerId: string}) => entry.providerId)).toEqual(ids)
    expect(descendants(hostRoot).filter(n => n.props['data-fallback-provider']).map(n => n.props['data-fallback-provider'])).toEqual(ids)
    send.mockResolvedValue(response());await state.refreshWeights();expect(state.weightSnapshot.observedAt).toBe(123)
  })
  it.each(['entries', 'total', 'weight', 'provider', 'status'])('损坏的%s快照回退本地而不使模板崩溃', async reason => {
    await mountFree();const value = response() as any
    if (reason === 'entries') value.snapshot.entries = null
    if (reason === 'total') value.snapshot.total = Number.NaN
    if (reason === 'weight') value.snapshot.entries[0].weight = -1
    if (reason === 'provider') value.snapshot.entries[0].providerId = 'unknown'
    if (reason === 'status') value.snapshot.entries[0].status = 'unknown'
    send.mockResolvedValue(value);await state.refreshWeights();expect(state.weightSnapshot).toBeNull();await settle()
  })
  it('实际缓存模板的旧模式、开关和邮箱事件不得写入新配置', async () => {
    const config = runtime.reactive(new Config());config.freeTranslationOrder = [...providerNames];await mountFree({config})
    const mode = publicNode(n => n.tag === 'input' && n.props.value === 'sequential').props.onChange
    const providerToggle = () => {
      const row = publicNode(n => n.props['data-fallback-provider'] === 'alibabaFree')
      const toggle = descendants(row).find(n => typeof n.props['onUpdate:modelValue'] === 'function');expect(toggle).toBeDefined();return toggle!
    }
    const toggle = providerToggle().props['onUpdate:modelValue'];expect(providerToggle().props['model-value'] ?? providerToggle().props.modelValue).toBe(false)
    const email = publicNode(n => n.tag === 'input' && n.props.type === 'email');const update = email.props['onUpdate:modelValue'], commit = email.props.onChange
    const replacement = runtime.reactive(new Config());replacement.freeTranslationOrder = [...providerNames];source.config = replacement
    await settle();mode();toggle(true);update('late@example.test');commit()
    expect(replacement.freeTranslationMode).toBe('balanced');expect(replacement.freeTranslationOrder).toEqual(providerNames);expect(replacement.myMemoryEmail).toBe('');expect(state.myMemoryEmailDraft).toBe('')
    publicNode(n => n.tag === 'input' && n.props.value === 'sequential').props.onChange();expect(replacement.freeTranslationMode).toBe('sequential')
    providerToggle().props['onUpdate:modelValue'](true);expect(replacement.freeTranslationOrder).toEqual([...providerNames, 'alibabaFree'])
    const currentEmail = publicNode(n => n.tag === 'input' && n.props.type === 'email')
    currentEmail.props['onUpdate:modelValue']('current@example.test');currentEmail.props.onChange();expect(replacement.myMemoryEmail).toBe('current@example.test')
  })
  it('隐藏清空未提交邮箱并拒绝直接动作，重开不复活旧超时回调', async () => {
    await mountFree();state.myMemoryEmailDraft = 'draft@example.test';invalidate('hidden');await settle();expect(state.myMemoryEmailDraft).toBe('')
    state.setMode('sequential');state.toggle('deeplx', true);state.move('microsoft', 1);state.myMemoryEmailDraft = 'late@example.test';state.commitMyMemoryEmail();expect(props.config.myMemoryEmail).toBe('');expect(props.config.freeTranslationMode).toBe('balanced');expect(props.config.freeTranslationOrder).not.toContain('deeplx')
    app.unmount();await mountFree({advanced: true});const old = node(n => n.props['aria-label'] === '每个服务最多等待（秒）').props['onUpdate:modelValue'];const initial = props.config.freeTranslationTimeoutMs
    props.active = false;await settle();props.active = true;await settle();old(9);expect(props.config.freeTranslationTimeoutMs).toBe(initial)
    node(n => n.props['aria-label'] === '每个服务最多等待（秒）').props['onUpdate:modelValue'](9);expect(props.config.freeTranslationTimeoutMs).toBe(9000)
  })
  it('未知模式、非布尔开关与分流模式排序不写入配置', async () => {
    await mountFree();const original = props.config.freeTranslationOrder.slice();state.setMode('unknown');state.toggle('deeplx', 'yes');state.move('microsoft', 1)
    expect(props.config.freeTranslationMode).toBe('balanced');expect(props.config.freeTranslationOrder).toEqual(original)
    state.setMode('sequential');state.move('microsoft', 2);expect(props.config.freeTranslationOrder).toEqual(original);state.move('microsoft', 1);expect(props.config.freeTranslationOrder[1]).toBe('microsoft')
  })
  it('冷却总量为零的完整快照正常显示，读取失败回退且恢复支持新请求', async () => {
    await mountFree();const ids = props.config.freeTranslationOrder
    const snapshot = calculateFreeTranslationWeightSnapshot(ids, ids.map((providerId: string) => ({providerId, retryAt: 1000, failures: 1, category: 'network' as const})), 123)
    send.mockResolvedValueOnce({success: true, snapshot});await state.refreshWeights();expect(state.displayedWeightSnapshot.total).toBe(0);expect(state.weightStatus('microsoft')).toBe('cooling')
    send.mockRejectedValueOnce(new Error('offline'));await state.refreshWeights();expect(state.weightSnapshot).toBeNull()
    send.mockResolvedValueOnce(response());await state.refreshWeights();expect(state.weightStatus('microsoft')).toBe('ready')
  })
  it('省略可选 active 属性仍可正常读取与选择服务', async () => {
    await mountFree({active: undefined});expect(send).toHaveBeenCalledOnce();app.unmount();await mountCatalog({active: undefined});state.selectService('google');expect(emitted).toHaveBeenCalledWith('google')
  })
})

describe('服务目录的搜索和导航归属', () => {
  it('空搜索不读取逐项搜索字段，有关键词时缓存文本并在目录更新后失效', async () => {
    let reads = 0
    const item = runtime.reactive({value: 'custom:fixture', label: 'Fixture', get description() {reads++;return 'Ｆｕｌｌ Width'}, searchTerms: ['Alias']})
    await mountCatalog({services: [item]});reads = 0;state.serviceQuery = ' ';await settle();expect(reads).toBe(0)
    state.serviceQuery = 'full';await settle();expect(state.visibleDirectoryGroups[0].items[0].value).toBe('custom:fixture');const first = reads;expect(first).toBeGreaterThan(0)
    state.serviceQuery = 'ALIAS';await settle();expect(reads).toBe(first);state.serviceQuery = 'missing';await settle();expect(state.visibleDirectoryGroups).toEqual([]);expect(reads).toBe(first)
    item.label = 'Missing';await settle();expect(state.visibleDirectoryGroups[0].items[0].label).toBe('Missing');expect(reads).toBeGreaterThan(first)
  })
  it.each(['hidden', 'cached', 'unmount', 'context', 'service'])('实际缓存模板的旧目录选择在%s之后失效', async reason => {
    await mountCatalog();const old = node(n => n.props['data-directory-port'] === 'google').props.onSelect
    invalidate(reason);await settle();old('google');expect(emitted).not.toHaveBeenCalled()
    if (reason === 'service' || reason === 'context') {const target = reason === 'service' ? 'microsoft' : 'google';node(n => n.props['data-directory-port'] === target).props.onSelect(target);expect(emitted).toHaveBeenCalledWith(target)}
  })
  it.each(['hidden', 'cached', 'unmount', 'context', 'service'])('目录延迟焦点与滚动在%s之后失效', async reason => {
    await mountCatalog();state.directoryOpen = true;state.directoryToggle = {focus};state.addButton = {closest: () => ({querySelector: () => ({scrollTo: scroll})})}
    props.service = 'google';if (reason === 'service') props.service = 'microsoft';else invalidate(reason);await settle();expect(focus).not.toHaveBeenCalled()
    if (reason === 'service') expect(scroll).toHaveBeenCalledOnce();else expect(scroll).not.toHaveBeenCalled()
  })
  it('正常切换关闭目录、恢复一次焦点并滚动，重复当前服务只收起目录', async () => {
    await mountCatalog();state.directoryOpen = true;props.service = 'google';await settle();expect(state.directoryOpen).toBe(false);expect(focus).toHaveBeenCalledOnce();expect(scroll).toHaveBeenCalledOnce()
    focus.mockClear();scroll.mockClear();state.directoryOpen = true;await state.selectService('google');await settle();expect(focus).toHaveBeenCalledOnce();expect(scroll).not.toHaveBeenCalled();expect(emitted).not.toHaveBeenCalled()
  })
  it('隐藏或替换上下文后旧搜索、创建和展开回调不能修改当前目录', async () => {
    await mountCatalog();const search = node(n => n.tag === 'input').props.onInput
    const add = node(n => n.props['data-testid'] === 'custom-service-add').props.onClick, open = node(n => n.props.class === 'mobile-directory-toggle').props.onClick
    state.serviceQuery = 'draft';state.directoryOpen = true;invalidate('hidden');await settle();expect(state.directoryOpen).toBe(false);expect(state.serviceQuery).toBe('')
    props.active = true;await settle();search({currentTarget: {value: 'late'}});add();open();expect(state.directoryOpen).toBe(false);expect(state.serviceQuery).toBe('');expect(emitted).not.toHaveBeenCalled()
    node(n => n.props['data-testid'] === 'custom-service-add').props.onClick();expect(emitted).toHaveBeenCalledOnce()
  })
  it('拒绝目录标题、未知服务和停用动作，配置选择与默认服务保持分离', async () => {
    await mountCatalog();state.selectService('machine');state.selectService('missing');expect(emitted).not.toHaveBeenCalled();state.selectService('google');expect(emitted).toHaveBeenCalledWith('google');expect(props.defaultService).toBe('microsoft')
    emitted.mockClear();props.active = false;await settle();state.selectService('google');expect(emitted).not.toHaveBeenCalled()
  })
})


const groupedCatalog = [...catalog, {value: 'custom:fixture', label: 'Fixture custom'}]
function invalidatePublic(reason: string): void {
  if (reason === 'hidden') source.active = false
  else if (reason === 'cached') shown.value = false
  else if (reason === 'unmount') app.unmount()
  else if (reason === 'context') source.context = {}
  else if (reason === 'service') source.service = 'google'
}
async function reopenPublic(reason: string): Promise<void> {
  if (reason === 'hidden') source.active = true
  else if (reason === 'cached') shown.value = true
  await settle()
}
function scroller(): Node {return publicNode(n => n.props.class === 'service-groups')}
async function mountGroups(): Promise<void> {
  await mountCatalog({services: groupedCatalog})
  geometry.tops.set('machine-services', 0);geometry.tops.set('custom', 180)
}

describe('服务分组导航的公共客户端生命周期', () => {
  it.each([false, true])('导航清空搜索、展开目标，并遵循 reduced-motion=%s', async reduced => {
    await mountGroups();groupHeader('custom').props.onClick();await settle()
    expect(groupHeader('custom').props['aria-expanded']).toBe(false)
    await search('google');expect(descendants(hostRoot).filter(n => n.props['data-service-section'])).toHaveLength(1)
    reducedMotion.mockReturnValue(reduced)
    await navigation('custom').props.onClick();await settle()
    expect(queryInput().props.value).toBe('');expect(groupHeader('custom').props['aria-expanded']).toBe(true)
    expect(navigation('custom').props['aria-current']).toBe('location')
    expect(groupScroll).toHaveBeenCalledOnce();expect(groupScroll).toHaveBeenCalledWith({top: 180, behavior: reduced ? 'instant' : 'smooth'})
  })
  it.each(['onWheelPassive', 'onTouchstartPassive', 'onPointerdown', 'onKeydown', 'onFocusin'])('短末组导航固定高亮，%s用户操作后恢复按滚动位置定位', async event => {
    await mountGroups();await navigation('custom').props.onClick();await settle()
    scroller().props.onScrollPassive();await settle();expect(navigation('custom').props['aria-current']).toBe('location')
    scroller().props[event]();scroller().props.onScrollPassive();await settle()
    expect(navigation('machine-services').props['aria-current']).toBe('location')
    scroller().scrollTop = 400;scroller().props.onScrollPassive();await settle()
    expect(navigation('custom').props['aria-current']).toBe('location')
  })
  it('选中折叠组内的服务及外部选择都会展开对应组，回页也展开选中组', async () => {
    await mountGroups();groupHeader('machine-services').props.onClick();await settle()
    expect(groupHeader('machine-services').props['aria-expanded']).toBe(false)
    publicNode(n => n.props['data-directory-port'] === 'microsoft').props.onSelect('microsoft');await settle()
    expect(groupHeader('machine-services').props['aria-expanded']).toBe(true)
    groupHeader('custom').props.onClick();await settle();source.service = 'custom:fixture';await settle()
    expect(groupHeader('custom').props['aria-expanded']).toBe(true)
    groupHeader('custom').props.onClick();await settle();shown.value = false;await settle();shown.value = true;await settle()
    observer().callback();await settle();expect(groupHeader('custom').props['aria-expanded']).toBe(true)
  })
  it.each(['hidden', 'cached', 'unmount', 'context', 'service'])('导航提交后%s作废 nextTick 目录滚动', async reason => {
    await mountGroups();const reveal = navigation('custom').props.onClick
    const pending = reveal();invalidatePublic(reason);await settle();await pending
    expect(groupScroll).not.toHaveBeenCalled()
  })
  it.each(['hidden', 'cached', 'context', 'service'])('%s之后旧分组事件不得清空新搜索或展开旧目标；当前事件仍可使用', async reason => {
    await mountGroups();groupHeader('custom').props.onClick();await settle()
    const oldToggle = groupHeader('custom').props.onClick, oldReveal = navigation('custom').props.onClick
    invalidatePublic(reason);await settle();await reopenPublic(reason);await search('google')
    oldToggle();await oldReveal();await settle()
    expect(queryInput().props.value).toBe('google');expect(groupScroll).not.toHaveBeenCalled()
    await search('');expect(groupHeader('custom').props['aria-expanded']).toBe(false)
    groupHeader('custom').props.onClick();await settle();expect(groupHeader('custom').props['aria-expanded']).toBe(true)
    await navigation('custom').props.onClick();await settle();expect(groupScroll).toHaveBeenCalledOnce()
  })
  it('停用时禁用导航/折叠，保存的旧事件同样无效；搜索时不能通过旧折叠事件隐藏匹配项', async () => {
    await mountGroups();const oldToggle = groupHeader('custom').props.onClick
    await search('fixture');oldToggle();await settle();await search('')
    expect(groupHeader('custom').props['aria-expanded']).toBe(true)
    const reveal = navigation('custom').props.onClick, toggle = groupHeader('custom').props.onClick
    source.active = false;await settle()
    expect(navigation('custom').props.disabled).toBe(true);expect(groupHeader('custom').props.disabled).toBe(true)
    toggle();await reveal();await settle();expect(groupScroll).not.toHaveBeenCalled()
  })
  it.each(['hidden', 'cached', 'unmount', 'context', 'service'])('%s断开旧 ResizeObserver，已排队的旧 delivery 也不得读旧目录', async reason => {
    await mountGroups();const previous = observer()
    invalidatePublic(reason);await settle();expect(previous.disconnect).toHaveBeenCalledOnce()
    readRects.mockClear();previous.callback();await settle();expect(readRects).not.toHaveBeenCalled()
    if (reason === 'context' || reason === 'service') {
      expect(observer()).not.toBe(previous);expect(observer().observe).toHaveBeenCalledOnce()
    } else if (reason !== 'unmount') {
      await reopenPublic(reason);expect(observer()).not.toBe(previous);expect(observer().observe).toHaveBeenCalledOnce()
    }
  })
  it('ResizeObserver 排队的位置更新在上下文替换后失效，当前观察器仍可重定位', async () => {
    await mountGroups();const previous = observer()
    source.context = {};previous.callback();readRects.mockClear();await settle()
    expect(readRects).not.toHaveBeenCalled()
    observer().callback();await settle();expect(readRects).toHaveBeenCalled()
    expect(navigation('machine-services').props['aria-current']).toBe('location')
  })
  it.each(['hidden', 'cached', 'context', 'service'])('%s之后旧手势事件不得解除当前末组固定高亮', async reason => {
    await mountGroups();const oldGesture = scroller().props.onWheelPassive
    invalidatePublic(reason);await settle();await reopenPublic(reason)
    await navigation('custom').props.onClick();await settle()
    oldGesture();scroller().props.onScrollPassive();await settle()
    expect(navigation('custom').props['aria-current']).toBe('location')
    scroller().props.onWheelPassive();scroller().props.onScrollPassive();await settle()
    expect(navigation('machine-services').props['aria-current']).toBe('location')
  })
  it('初始停用不创建尺寸观察器，激活后再观察当前目录', async () => {
    await mountCatalog({services: groupedCatalog, active: false});expect(observers).toHaveLength(0)
    source.active = true;await settle();expect(observer().observe).toHaveBeenCalledOnce()
  })
  it('自定义分组已移除时，旧导航事件不得清空当前搜索', async () => {
    await mountGroups();const oldReveal = navigation('custom').props.onClick
    source.services = catalog;await settle();await search('google')
    await oldReveal();await settle();expect(queryInput().props.value).toBe('google');expect(groupScroll).not.toHaveBeenCalled()
  })
  it('尺寸由隐藏变为可见时展开当前组；持续可见的尺寸变化尊重用户折叠', async () => {
    await mountGroups();observer().callback();await settle()
    groupHeader('machine-services').props.onClick();await settle();observer().callback();await settle()
    expect(groupHeader('machine-services').props['aria-expanded']).toBe(false)
    geometry.visible = false;observer().callback();await settle()
    geometry.visible = true;observer().callback();await settle()
    expect(groupHeader('machine-services').props['aria-expanded']).toBe(true)
  })
})
