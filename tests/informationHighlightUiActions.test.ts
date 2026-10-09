/**
 * @file tests/informationHighlightUiActions.test.ts
 * 文件职责：验证当前页信息高亮开关和真实状态读取的消息边界及异步归属。
 * 主要内容：覆盖协议过滤、启停抢占、页面导航、失活、站点规则、失败恢复与轮询合并。
 * 模块边界：使用受控标签页消息，不分析正文、不下载模型；结果只证明界面状态所有权。
 */
import {describe, expect, it, vi} from 'vitest'
import {Config} from '@/src/core/config/model'
import {createPopupInformationHighlightActions, createPopupInformationHighlightState, readInformationHighlightPageSnapshot} from '@/src/app/popup/informationHighlightActions'
import type {PopupActiveTab} from '@/src/app/popup/pageActions'
import type {InformationHighlightState} from '@/src/features/information-highlight/protocol'

const snapshot = (enabled = false): InformationHighlightState => ({enabled, phase: enabled ? 'active' : 'idle', sessionId: 'page:7:1', processedParagraphs: 2, queuedParagraphs: 0, highlightedSpans: 3, mode: 'keywords'})
function deferred<T = unknown>() {let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no}); return {promise, resolve, reject}}
async function settle() {for (let i = 0; i < 8; i++) await Promise.resolve()}
function fixture() {
  const config = new Config(); config.on = true; config.disabledExtensionDomains = []
  const state = createPopupInformationHighlightState(); let active = true
  const getTab = vi.fn(async (): Promise<PopupActiveTab | undefined> => ({id: 7, url: 'https://example.com/a'}))
  const send = vi.fn(async (_id: number, message: {type: string; enabled?: boolean}): Promise<unknown> => ({success: true, state: snapshot(message.enabled === true)}))
  const actions = createPopupInformationHighlightActions({state, config: () => config, active: () => active, getTab, send})
  return {config, state, getTab, send, actions, setActive: (value: boolean) => {active = value}}
}
describe('信息高亮页面协议过滤', () => {
  it('接受直接快照与明确成功的封装，诊断长度有限', () => {
    expect(readInformationHighlightPageSnapshot(snapshot())).toEqual(snapshot())
    expect(readInformationHighlightPageSnapshot({success: true, state: {...snapshot(), errorCode: 'e'.repeat(150)}})?.errorCode).toHaveLength(120)
    expect(readInformationHighlightPageSnapshot({...snapshot(), errorCode: 42})).toEqual(snapshot())
  })
  it.each([null, undefined, false, 1, 'state', {success: false, state: snapshot()}, {...snapshot(), enabled: 1}, {...snapshot(), phase: 'done'}, {...snapshot(), phase: 1}, {...snapshot(), sessionId: 1}, {...snapshot(), sessionId: 's'.repeat(129)}, {...snapshot(), mode: 'cloud'}, {...snapshot(), processedParagraphs: '2'}, {...snapshot(), queuedParagraphs: -1}, {...snapshot(), highlightedSpans: .5}, {...snapshot(), processedParagraphs: Infinity}])('未知或畸形快照 %j 不声称页面已就绪', response => {
    expect(readInformationHighlightPageSnapshot(response)).toBeNull()
  })
})
describe('信息高亮页面动作所有权', () => {
  it('只读取当前页状态、支持零号标签页和缺省网址，读取期间合并轮询', async () => {
    const {actions, state, getTab, send} = fixture(), query = deferred<PopupActiveTab>()
    getTab.mockReturnValueOnce(query.promise)
    const first = actions.hydrate(); await actions.hydrate(); expect(getTab).toHaveBeenCalledOnce()
    query.resolve({id: 0}); await first
    expect(state).toMatchObject({tabId: 0, url: '', snapshot: snapshot(), loading: false, errorCode: ''})
    expect(send).toHaveBeenCalledWith(0, {type: 'GET_INFORMATION_HIGHLIGHT_STATE'})
    getTab.mockResolvedValueOnce({id: 0, pendingUrl: 'https://example.org/next'}); await actions.hydrate()
    expect(state.url).toBe('https://example.org/next')
  })
  it.each([undefined, {id: -1}])('无接收标签页 %j 时保留不可用状态', async tab => {
    const {actions, state, getTab, send} = fixture(); getTab.mockResolvedValueOnce(tab); await actions.hydrate()
    expect(send).not.toHaveBeenCalled(); expect(state.errorCode).toBe('page-unavailable'); expect(state.loading).toBe(false)
  })
  it('读取失败与畸形回复均可重试，已有真值不被抹掉', async () => {
    const {actions, state, getTab, send} = fixture(); await actions.hydrate()
    getTab.mockRejectedValueOnce(Error('tabs')); await actions.hydrate(); expect(state.errorCode).toBe('page-unavailable')
    send.mockResolvedValueOnce({success: false}); await actions.hydrate(); expect(state.snapshot).toEqual(snapshot())
    await actions.hydrate(); expect(state.errorCode).toBe('')
  })
  it.each([false, true])('晚到的旧读取 rejected=%s 不回退刚完成的开启', async rejected => {
    const {actions, state, send} = fixture(), old = deferred(); send.mockReturnValueOnce(old.promise)
    const reading = actions.hydrate(); await settle(); await actions.setEnabled(true)
    if (rejected) old.reject(Error('stale')); else old.resolve({success: true, state: snapshot(false)})
    await reading; expect(state.snapshot?.enabled).toBe(true); expect(state.errorCode).toBe('')
  })
  it('导航失效后的旧查询不安装身份，旧读取结束不能释放新的轮询', async () => {
    const {actions, state, getTab, send} = fixture(), old = deferred<PopupActiveTab>(), fresh = deferred()
    getTab.mockReturnValueOnce(old.promise); const first = actions.hydrate(); actions.invalidate()
    getTab.mockResolvedValueOnce({id: 8, url: 'https://example.net/b'}); send.mockReturnValueOnce(fresh.promise)
    const second = actions.hydrate(); await settle(); old.resolve({id: 7, url: 'https://example.com/a'}); await first
    await actions.hydrate(); expect(getTab).toHaveBeenCalledTimes(2); expect(state.loading).toBe(true)
    fresh.resolve(snapshot()); await second; expect(state.tabId).toBe(8)
  })
  it('失活或失效后的旧读取和异常不会写入界面', async () => {
    for (const rejected of [false, true]) {
      const {actions, state, send, setActive} = fixture(), old = deferred(); send.mockReturnValueOnce(old.promise)
      const pending = actions.hydrate(); await settle(); setActive(false)
      if (rejected) old.reject(Error('stale')); else old.resolve(snapshot(true))
      await pending; expect(state.snapshot).toBeNull(); expect(state.errorCode).toBe('')
      actions.invalidate(); expect(state).toEqual(createPopupInformationHighlightState())
      await actions.hydrate(); await actions.setEnabled(true); await actions.retry(); expect(send).toHaveBeenCalledOnce()
    }
  })
  it('开启合并重复意图，关闭立即抢占开启，旧完成不释放新关闭任务', async () => {
    const {actions, state, send} = fixture(); await actions.hydrate()
    const start = deferred(), stop = deferred(); send.mockReturnValueOnce(start.promise).mockReturnValueOnce(stop.promise)
    const enabling = actions.setEnabled(true); await settle(); await actions.setEnabled(true); await actions.hydrate()
    expect(send).toHaveBeenCalledTimes(2)
    const disabling = actions.setEnabled(false); expect(state.snapshot?.enabled).toBe(false); await settle()
    start.resolve(snapshot(true)); await enabling; expect(state.pending).toBe(true); expect(state.snapshot?.enabled).toBe(false)
    stop.resolve(snapshot(false)); await disabling; expect(state.pending).toBe(false)
    expect(send.mock.calls.slice(1).map(call => call[1])).toEqual([{type: 'SET_INFORMATION_HIGHLIGHT_ENABLED', enabled: true}, {type: 'SET_INFORMATION_HIGHLIGHT_ENABLED', enabled: false}])
  })
  it('错误状态允许明确重试，开启失败不会显示成功', async () => {
    const {actions, state, send} = fixture(); await actions.hydrate()
    send.mockResolvedValueOnce({success: false}); await actions.setEnabled(true); expect(state.errorCode).toBe('command-failed')
    send.mockRejectedValueOnce(Error('no receiver')); await actions.retry(); expect(state.pending).toBe(false); expect(state.errorCode).toBe('command-failed')
    send.mockResolvedValueOnce({...snapshot(true), mode: 'surprisal-local'}); await actions.retry()
    expect(send).toHaveBeenLastCalledWith(7, {type: 'RETRY_INFORMATION_HIGHLIGHT'}); expect(state.snapshot?.mode).toBe('surprisal-local'); expect(state.errorCode).toBe('')
  })
  it.each(['off', 'disabled'] as const)('%s 时阻止开启与重试，仍允许关闭已开启页面', async reason => {
    const {actions, state, send, config} = fixture(); await actions.hydrate(); state.snapshot = snapshot(true)
    if (reason === 'off') config.on = false; else config.disabledExtensionDomains = ['example.com']
    await actions.setEnabled(true); await actions.retry(); expect(send).toHaveBeenCalledOnce()
    await actions.setEnabled(false); expect(send).toHaveBeenLastCalledWith(7, {type: 'SET_INFORMATION_HIGHLIGHT_ENABLED', enabled: false})
  })
  it('初始身份尚缺时接受新标签页，但等待中禁用本站仍不发送开启', async () => {
    const {actions, state, getTab, send, config} = fixture(), tab = deferred<PopupActiveTab>()
    getTab.mockReturnValueOnce(tab.promise); const pending = actions.setEnabled(true); config.disabledExtensionDomains = ['example.com']
    tab.resolve({id: 7, url: 'https://example.com/a'}); await pending; expect(state.tabId).toBe(7); expect(state.pending).toBe(false); expect(send).not.toHaveBeenCalled()
    config.disabledExtensionDomains = []; await actions.setEnabled(true); expect(state.snapshot?.enabled).toBe(true)
  })
  it.each([{id: 8, url: 'https://example.net/b'}, {id: 7, url: 'https://example.com/b'}])('操作前页面变为 %j 时只读取新状态', async tab => {
    const {actions, state, getTab, send} = fixture(); await actions.hydrate(); getTab.mockResolvedValue(tab)
    await actions.setEnabled(true); expect(send.mock.calls.map(call => call[1].type)).toEqual(['GET_INFORMATION_HIGHLIGHT_STATE', 'GET_INFORMATION_HIGHLIGHT_STATE']); expect(state.tabId).toBe(tab.id); expect(state.url).toBe(tab.url)
  })
  it('命令前查询返回非法标签页，不发送；无网址合法标签页仍支持关闭', async () => {
    const {actions, state, getTab, send} = fixture(); getTab.mockResolvedValueOnce(undefined); await actions.setEnabled(true)
    expect(state.errorCode).toBe('page-unavailable'); expect(send).not.toHaveBeenCalled()
    getTab.mockResolvedValueOnce({id: 0}); await actions.setEnabled(false); expect(state).toMatchObject({tabId: 0, url: '', pending: false})
  })
  it('失效或抢占后的旧命令查询与拒绝不发送、不记录异常', async () => {
    for (const rejected of [false, true]) {
      const {actions, state, getTab, send} = fixture(), query = deferred<PopupActiveTab>()
      getTab.mockReturnValueOnce(query.promise); const pending = actions.setEnabled(true); actions.invalidate()
      if (rejected) query.reject(Error('old')); else query.resolve({id: 7})
      await pending; expect(send).not.toHaveBeenCalled(); expect(state.errorCode).toBe('')
    }
    const {actions, state, send} = fixture(); await actions.hydrate(); const old = deferred(); send.mockReturnValueOnce(old.promise)
    const pending = actions.setEnabled(true); await settle(); actions.invalidate(); old.reject(Error('old')); await pending
    expect(state.pending).toBe(false); expect(state.errorCode).toBe('')
  })
})
