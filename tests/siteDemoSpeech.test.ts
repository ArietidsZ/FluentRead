import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoSpeech, type DemoSpeechState } from '../docs/.vitepress/theme/demoSpeech'

function fixture() {
  let state: DemoSpeechState = { target: null, status: 'idle' }
  const utterances: SpeechSynthesisUtterance[] = []
  const voices = [{ lang: 'en-GB' }, { lang: 'en-US' }, { lang: 'zh-CN' }] as SpeechSynthesisVoice[]
  const synth = {
    speak: vi.fn(),
    cancel: vi.fn(),
    getVoices: vi.fn(() => voices),
  }
  const createUtterance = (text: string) => {
    const utterance = { text, onstart: null, onend: null, onerror: null } as SpeechSynthesisUtterance
    utterances.push(utterance)
    return utterance
  }
  const reader = createDemoSpeech((next) => { state = next }, () => ({ synth, createUtterance }))
  return { reader, synth, utterances, voices, state: () => state }
}
function fire(utterance: SpeechSynthesisUtterance, event: 'start' | 'end' | 'error') {
  utterance[`on${event}`]?.call(utterance, {} as SpeechSynthesisEvent & SpeechSynthesisErrorEvent)
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('homepage read-aloud', () => {
  it('never queues speech until a click requests it', () => {
    const f = fixture()
    f.reader.stop()
    expect(f.synth.speak).not.toHaveBeenCalled()
    expect(f.synth.cancel).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('speaks the requested text in its language and follows native start/end events', () => {
    const f = fixture()
    f.reader.toggle('original', 'A good book opens a new world.', 'en-US')
    const utterance = f.utterances[0]
    expect(utterance.text).toBe('A good book opens a new world.')
    expect(utterance.lang).toBe('en-US')
    expect(utterance.voice).toBe(f.voices[1])
    expect(f.synth.speak).toHaveBeenCalledWith(utterance)
    expect(f.state()).toEqual({ target: 'original', status: 'loading' })
    fire(utterance, 'start')
    expect(f.state()).toEqual({ target: 'original', status: 'speaking' })
    fire(utterance, 'end')
    expect(f.state()).toEqual({ target: null, status: 'idle' })
    expect(vi.getTimerCount()).toBe(0)
    expect(f.synth.cancel).not.toHaveBeenCalled()
  })

  it('stops a repeated click even before the speech engine starts', () => {
    const f = fixture()
    f.reader.toggle('original', 'Hello', 'en-US')
    f.reader.toggle('original', 'Hello', 'en-US')
    expect(f.synth.speak).toHaveBeenCalledTimes(1)
    expect(f.synth.cancel).toHaveBeenCalledTimes(1)
    expect(f.state().status).toBe('idle')
    expect(f.utterances[0].onstart).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('switches languages without overlap or state changes from canceled callbacks', () => {
    const f = fixture()
    f.reader.toggle('original', 'Hello', 'en-US')
    const previous = f.utterances[0]
    const lateStart = previous.onstart!
    const lateEnd = previous.onend!
    const lateError = previous.onerror!
    f.reader.toggle('translation', '你好', 'zh-CN')
    lateStart.call(previous, {} as SpeechSynthesisEvent)
    lateEnd.call(previous, {} as SpeechSynthesisEvent)
    lateError.call(previous, {} as SpeechSynthesisErrorEvent)
    expect(f.state()).toEqual({ target: 'translation', status: 'loading' })
    expect(f.synth.cancel).toHaveBeenCalledTimes(1)
    expect(f.utterances[1].text).toBe('你好')
    expect(f.utterances[1].lang).toBe('zh-CN')
    expect(f.utterances[1].voice).toBe(f.voices[2])
    fire(f.utterances[1], 'start')
    expect(f.state().status).toBe('speaking')
    f.reader.stop()
    expect(f.synth.cancel).toHaveBeenCalledTimes(2)
    expect(f.state().status).toBe('idle')
  })

  it('recovers from both thrown and native errors on the next click', () => {
    const f = fixture()
    f.synth.speak.mockImplementationOnce(() => { throw new Error('engine unavailable') })
    f.reader.toggle('original', 'Hello', 'en-US')
    expect(f.state()).toEqual({ target: null, status: 'error', error: 'failed' })
    f.reader.toggle('translation', '你好', 'zh-CN')
    fire(f.utterances[1], 'error')
    expect(f.state().error).toBe('failed')
    f.reader.toggle('original', 'Hello', 'en-US')
    fire(f.utterances[2], 'start')
    expect(f.state()).toEqual({ target: 'original', status: 'speaking' })
    f.reader.stop()
  })

  it('reports an unsupported browser without creating speech', () => {
    let state: DemoSpeechState | undefined
    const reader = createDemoSpeech((next) => { state = next }, () => null)
    reader.toggle('original', 'Hello', 'en-US')
    expect(state).toEqual({ target: null, status: 'error', error: 'unsupported' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears a stuck pending or speaking engine instead of leaving an endless playing state', () => {
    const f = fixture()
    f.reader.toggle('original', 'Hello', 'en-US')
    vi.advanceTimersByTime(8_000)
    expect(f.state().error).toBe('failed')
    expect(f.synth.cancel).toHaveBeenCalledTimes(1)
    f.reader.toggle('translation', '你好', 'zh-CN')
    fire(f.utterances[1], 'start')
    vi.advanceTimersByTime(20_000)
    expect(f.state().error).toBe('failed')
    expect(f.synth.cancel).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('falls back to a matching language or lets the browser choose when voices load later', () => {
    const f = fixture()
    f.reader.toggle('original', 'Hello', 'en-AU')
    expect(f.utterances[0].voice).toBe(f.voices[0])
    f.reader.stop()
    f.synth.getVoices.mockReturnValue([])
    f.reader.toggle('translation', '你好', 'zh-CN')
    expect(f.utterances[1].voice).toBeNull()
    expect(f.synth.speak).toHaveBeenCalledTimes(2)
    f.reader.stop()
  })
})
