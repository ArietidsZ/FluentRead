<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
defineProps<{ en?: boolean }>()
const root = ref<HTMLElement | null>(null)
const active = ref(false)
let visible = false
let observer: IntersectionObserver | undefined
const greetings = [
  { text: 'Hello', lang: 'en' },
  { text: '你好', lang: 'zh-CN' },
  { text: 'Bonjour', lang: 'fr' },
  { text: 'Hola', lang: 'es' },
  { text: 'こんにちは', lang: 'ja' },
  { text: '안녕하세요', lang: 'ko' },
]
function sync() {
  active.value = visible && !document.hidden
}
onMounted(() => {
  observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    sync()
  })
  if (root.value) observer.observe(root.value)
  document.addEventListener('visibilitychange', sync)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  document.removeEventListener('visibilitychange', sync)
})
</script>
<template>
  <div ref="root" class="bv-greetings" :data-active="active">
    <p>{{ en ? 'Read across languages' : '跨越语言，流畅阅读' }}</p>
    <div :aria-label="en ? 'Greetings in different languages' : '不同语言的问候'">
      <span
        v-for="(greeting, i) in greetings"
        :key="greeting.lang"
        :lang="greeting.lang"
        :style="{ '--greeting-delay': `${i * 1.5}s` }"
        >{{ greeting.text }}</span
      >
    </div>
  </div>
</template>
