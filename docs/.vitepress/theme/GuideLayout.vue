<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { useRoute } from 'vitepress'
import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
const route = useRoute()
let revision = 0
async function revealAnchor() {
  const current = ++revision
  await nextTick()
  if (current !== revision || !location.hash) return
  let id: string
  try {
    id = decodeURIComponent(location.hash.slice(1))
  } catch {
    return
  }
  const target = document.getElementById(id)
  if (!target) return
  const parents: HTMLDetailsElement[] = []
  let ancestor = target.parentElement
  while (ancestor) {
    if (ancestor instanceof HTMLDetailsElement) parents.push(ancestor)
    ancestor = ancestor.parentElement
  }
  if (!parents.length) return
  parents.forEach((details) => {
    details.open = true
  })
  await nextTick()
  if (current === revision) target.scrollIntoView({ block: 'start' })
}
onMounted(() => {
  window.addEventListener('hashchange', revealAnchor)
  void revealAnchor()
})
const stop = watch(() => route.path, revealAnchor, { flush: 'post' })
onBeforeUnmount(() => {
  revision++
  stop()
  window.removeEventListener('hashchange', revealAnchor)
})
</script>
<template><DefaultTheme.Layout /></template>
