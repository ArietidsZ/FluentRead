<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
const props = defineProps<{ phase: number; target?: string }>()
const root = ref<HTMLElement | null>(null)
const width = ref(0)
const height = ref(0)
const end = ref({ x: 0, y: 0 })
let observer: ResizeObserver | undefined
function measure() {
  const host = root.value?.parentElement
  const target = host?.querySelector(props.target || '[data-demo-target]')
  if (!host || !target) return
  const box = host.getBoundingClientRect()
  const point = target.getBoundingClientRect()
  width.value = box.width
  height.value = box.height
  end.value = {
    x: point.left - box.left + point.width / 2,
    y: point.top - box.top + point.height / 2,
  }
}
const path = computed(() => {
  const x = width.value * 0.18
  const y = height.value * 0.82
  return `M ${x} ${y} C ${width.value * 0.65} ${y}, ${end.value.x - 70} ${end.value.y + 50}, ${
    end.value.x
  } ${end.value.y}`
})
onMounted(() => {
  measure()
  observer = new ResizeObserver(measure)
  if (root.value?.parentElement) observer.observe(root.value.parentElement)
})
watch(() => props.target, measure, { flush: 'post' })
onBeforeUnmount(() => observer?.disconnect())
</script>
<template>
  <div ref="root" class="bv-pointer" :data-phase="phase" aria-hidden="true">
    <svg v-if="width" class="bv-pointer-trail" :viewBox="`0 0 ${width} ${height}`">
      <path :d="path" fill="none" />
    </svg>
    <span v-if="width" class="bv-pointer-cursor" :style="{ offsetPath: `path('${path}')` }">
      <svg viewBox="0 0 24 30"><path d="M3 2v22l6-6 5 10 4-2-5-9h9Z" /></svg>
    </span>
    <span class="bv-pointer-click" :style="{ left: `${end.x}px`, top: `${end.y}px` }"></span>
  </div>
</template>
