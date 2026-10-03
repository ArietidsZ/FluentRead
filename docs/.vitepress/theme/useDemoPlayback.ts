import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

// A visible, local walkthrough. Manual choices stay selected; inactive pages use no timer.
export function useDemoPlayback(
  root: Ref<HTMLElement | null>,
  count: number,
  autoplay = false,
  delay = 2200
) {
  const step = ref(0)
  const playing = ref(autoplay)
  const reduced = ref(false)
  let visible = false
  let timer: ReturnType<typeof setInterval> | undefined
  let observer: IntersectionObserver | undefined
  let preference: MediaQueryList | undefined
  function stopTimer() {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }
  function sync() {
    stopTimer()
    if (playing.value && !reduced.value && visible && !document.hidden)
      timer = setInterval(() => {
        step.value = (step.value + 1) % count
      }, delay)
  }
  function choose(index: number) {
    playing.value = false
    step.value = index
  }
  function replay() {
    step.value = 0
    playing.value = !reduced.value
  }
  function motion() {
    reduced.value = Boolean(preference?.matches)
    if (reduced.value) {
      playing.value = false
      step.value = count - 1
    }
    sync()
  }
  onMounted(() => {
    preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    motion()
    preference.addEventListener('change', motion)
    document.addEventListener('visibilitychange', sync)
    if (root.value) {
      observer = new IntersectionObserver(
        (entries) => {
          visible = entries[0].isIntersecting && entries[0].intersectionRatio >= 0.15
          sync()
        },
        { threshold: 0.15 }
      )
      observer.observe(root.value)
    }
  })
  const unwatch = watch(playing, sync)
  onBeforeUnmount(() => {
    stopTimer()
    observer?.disconnect()
    unwatch()
    preference?.removeEventListener('change', motion)
    document.removeEventListener('visibilitychange', sync)
  })
  return { step, playing, reduced, choose, replay }
}
