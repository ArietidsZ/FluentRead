export type DemoSpeechTarget = 'original' | 'translation'
export type DemoSpeechState = {
  target: DemoSpeechTarget | null
  status: 'idle' | 'loading' | 'speaking' | 'error'
  error?: 'unsupported' | 'failed'
}
type SpeechEnvironment = {
  synth: Pick<SpeechSynthesis, 'getVoices' | 'speak' | 'cancel'>
  createUtterance: (text: string) => SpeechSynthesisUtterance
}

// Only a user click calls toggle. Automatic walkthrough frames never enqueue speech.
export function createDemoSpeech(
  update: (state: DemoSpeechState) => void,
  environment: () => SpeechEnvironment | null = () =>
    typeof window === 'undefined' ||
    !('speechSynthesis' in window) ||
    !('SpeechSynthesisUtterance' in window)
      ? null
      : {
          synth: window.speechSynthesis,
          createUtterance: (text) => new SpeechSynthesisUtterance(text),
        }
) {
  let current: { utterance: SpeechSynthesisUtterance; synth: SpeechEnvironment['synth'] } | undefined
  let state: DemoSpeechState = { target: null, status: 'idle' }
  let timer: ReturnType<typeof setTimeout> | undefined
  const publish = (next: DemoSpeechState) => {
    state = next
    update(next)
  }
  function release() {
    clearTimeout(timer)
    timer = undefined
    const previous = current
    current = undefined
    if (previous) {
      previous.utterance.onstart = null
      previous.utterance.onend = null
      previous.utterance.onerror = null
    }
    return previous
  }
  function stop() {
    const previous = release()
    publish({ target: null, status: 'idle' })
    // Detach first: a canceled utterance must not overwrite the next click's state.
    try {
      previous?.synth.cancel()
    } catch {
      // UI cleanup remains valid if the browser's speech engine has disappeared.
    }
  }
  function fail() {
    stop()
    publish({ target: null, status: 'error', error: 'failed' })
  }
  function deadline(ms: number) {
    clearTimeout(timer)
    timer = setTimeout(fail, ms)
  }
  function toggle(target: DemoSpeechTarget, text: string, lang: string) {
    const same = current && state.target === target
    stop()
    if (same) return
    try {
      const available = environment()
      if (!available) {
        publish({ target: null, status: 'error', error: 'unsupported' })
        return
      }
      const utterance = available.createUtterance(text)
      utterance.lang = lang
      utterance.rate = 0.95
      const voices = available.synth.getVoices()
      utterance.voice =
        voices.find((voice) => voice.lang.toLowerCase() === lang.toLowerCase()) ??
        voices.find((voice) => voice.lang.split('-')[0] === lang.split('-')[0]) ?? null
      current = { utterance, synth: available.synth }
      publish({ target, status: 'loading' })
      utterance.onstart = () => {
        if (current?.utterance !== utterance) return
        publish({ target, status: 'speaking' })
        deadline(20_000)
      }
      utterance.onend = () => {
        if (current?.utterance !== utterance) return
        release()
        publish({ target: null, status: 'idle' })
      }
      utterance.onerror = () => {
        if (current?.utterance === utterance) fail()
      }
      deadline(8_000)
      available.synth.speak(utterance)
    } catch {
      fail()
    }
  }
  return { toggle, stop }
}
