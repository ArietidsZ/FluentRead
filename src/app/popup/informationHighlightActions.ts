/**
 * @file src/app/popup/informationHighlightActions.ts
 * 文件职责：管理 Popup 当前标签页的信息高亮真值、启停与重试的异步所有权。
 * 主要内容：安全读取页面快照，以独立查询和命令代次拒绝迟到回复，导航或关闭失效时释放状态；关闭动作可以抢占尚未完成的开启请求。
 * 模块边界：只依赖注入的标签页和消息端口，不持久化按页开关、不分析正文、不请求模型或修改宿主网页。
 */
import type {Config} from '@/src/core/config/model'
import {getSiteBaseDomain} from '@/src/core/site-rules/domain'
import {isBrowserTabId} from '@/src/platform/browser/ids'
import type {PopupActiveTab} from './pageContracts'
import type {InformationHighlightState} from '@/src/features/information-highlight/protocol'

export type InformationHighlightPageSnapshot = InformationHighlightState
export interface PopupInformationHighlightState {
  tabId: number | null
  url: string
  snapshot: InformationHighlightPageSnapshot | null
  loading: boolean
  pending: boolean
  errorCode: string
}
export function createPopupInformationHighlightState(): PopupInformationHighlightState {
  return {tabId: null, url: '', snapshot: null, loading: false, pending: false, errorCode: ''}
}
const phases = new Set(['idle', 'loading-model', 'analyzing', 'active', 'paused', 'error', 'unsupported'])
/** 对来自网页的消息只采纳有限非负计数和已知状态，不把未知值显示为成功。 */
export function readInformationHighlightPageSnapshot(response: unknown): InformationHighlightPageSnapshot | null {
  if (!response || typeof response !== 'object') return null
  const envelope = response as Record<string, unknown>
  if (envelope.success === false) return null
  const source = envelope.state && typeof envelope.state === 'object' ? envelope.state as Record<string, unknown> : envelope
  if (typeof source.enabled !== 'boolean' || typeof source.phase !== 'string' || !phases.has(source.phase)
    || typeof source.sessionId !== 'string' || source.sessionId.length > 128
    || (source.mode !== 'keywords' && source.mode !== 'surprisal-local')) return null
  for (const key of ['processedParagraphs', 'queuedParagraphs', 'highlightedSpans']) {
    if (typeof source[key] !== 'number' || !Number.isSafeInteger(source[key]) || (source[key] as number) < 0) return null
  }
  return {enabled: source.enabled, phase: source.phase as InformationHighlightPageSnapshot['phase'],
    mode: source.mode, sessionId: source.sessionId, processedParagraphs: source.processedParagraphs as number,
    queuedParagraphs: source.queuedParagraphs as number, highlightedSpans: source.highlightedSpans as number,
    ...(typeof source.errorCode === 'string' ? {errorCode: source.errorCode.slice(0, 120)} : {})}
}
export function createPopupInformationHighlightActions(ports: {
  state: PopupInformationHighlightState
  config: () => Config
  active: () => boolean
  getTab: () => Promise<PopupActiveTab | undefined>
  send: (tabId: number, message: {type: string; enabled?: boolean}) => Promise<unknown>
}) {
  const {state} = ports
  let generation = 0, readSequence = 0, commandSequence = 0
  let desiredEnabled: boolean | null = null
  let pendingRead: object | null = null
  function invalidate() {
    generation++; readSequence++; commandSequence++; desiredEnabled = null; pendingRead = null
    state.tabId = null; state.url = ''; state.snapshot = null; state.loading = false; state.pending = false; state.errorCode = ''
  }
  const capture = () => {const version = generation; return () => ports.active() && version === generation}
  function bind(tab: PopupActiveTab & {id: number}) {
    const url = tab.pendingUrl || tab.url || ''
    if (state.tabId !== tab.id || state.url !== url) state.snapshot = null
    state.tabId = tab.id; state.url = url
  }
  async function hydrate() {
    if (!ports.active() || pendingRead || state.pending) return
    const current = capture(), sequence = ++readSequence, commandVersion = commandSequence
    const ownership = {}; pendingRead = ownership
    state.loading = state.snapshot === null
    try {
      const tab = await ports.getTab()
      if (!current() || sequence !== readSequence || commandVersion !== commandSequence) return
      if (!isBrowserTabId(tab?.id)) {state.errorCode = 'page-unavailable'; return}
      bind(tab as PopupActiveTab & {id: number})
      const response = await ports.send(tab.id, {type: 'GET_INFORMATION_HIGHLIGHT_STATE'})
      if (!current() || sequence !== readSequence || commandVersion !== commandSequence) return
      const snapshot = readInformationHighlightPageSnapshot(response)
      if (!snapshot) {state.errorCode = 'page-unavailable'; return}
      state.snapshot = snapshot; state.errorCode = ''
    } catch {if (current() && sequence === readSequence && commandVersion === commandSequence) state.errorCode = 'page-unavailable'}
    finally {if (pendingRead === ownership) pendingRead = null; if (current() && sequence === readSequence) state.loading = false}
  }
  async function command(type: 'SET_INFORMATION_HIGHLIGHT_ENABLED' | 'RETRY_INFORMATION_HIGHLIGHT', enabled?: boolean) {
    if (!ports.active()) return
    if (enabled !== false && (!ports.config().on || ports.config().disabledExtensionDomains.includes(getSiteBaseDomain(state.url) || ''))) return
    if (state.pending && enabled === true && desiredEnabled === true) return
    const current = capture(), sequence = ++commandSequence
    readSequence++; pendingRead = null; state.loading = false; state.pending = true; state.errorCode = ''; desiredEnabled = enabled ?? null
    // 关闭界面立即撤销开启意图，实际 DOM 清理仍由当前 content 的明确关闭命令负责。
    if (enabled === false && state.snapshot) state.snapshot = {...state.snapshot, enabled: false, phase: 'idle'}
    try {
      const tab = await ports.getTab()
      if (!current() || sequence !== commandSequence) return
      if (!isBrowserTabId(tab?.id)) {state.errorCode = 'page-unavailable'; return}
      const url = tab.pendingUrl || tab.url || ''
      if (state.tabId !== null && (state.tabId !== tab.id || state.url !== url)) {invalidate(); await hydrate(); return}
      bind(tab as PopupActiveTab & {id: number})
      const domain = getSiteBaseDomain(url) || ''
      if (enabled !== false && ports.config().disabledExtensionDomains.includes(domain)) return
      const response = await ports.send(tab.id, {type, ...(enabled === undefined ? {} : {enabled})})
      if (!current() || sequence !== commandSequence) return
      const snapshot = readInformationHighlightPageSnapshot(response)
      if (snapshot) {state.snapshot = snapshot; state.errorCode = ''}
      else state.errorCode = 'command-failed'
    } catch {if (current() && sequence === commandSequence) state.errorCode = 'command-failed'}
    finally {if (current() && sequence === commandSequence) {state.pending = false; desiredEnabled = null}}
  }
  return {hydrate, invalidate, setEnabled: (enabled: boolean) => command('SET_INFORMATION_HIGHLIGHT_ENABLED', enabled),
    retry: () => command('RETRY_INFORMATION_HIGHLIGHT')}
}
