<script setup lang="ts">
defineProps<{ en?: boolean }>()

const greetings = [
  { code: 'en', lang: 'en', text: 'Hello' },
  { code: 'zh', lang: 'zh-CN', text: '你好' },
  { code: 'fr', lang: 'fr', text: 'Bonjour' },
  { code: 'es', lang: 'es', text: 'Hola' },
  { code: 'ja', lang: 'ja', text: 'こんにちは' },
  { code: 'ko', lang: 'ko', text: '안녕하세요' },
  { code: 'de', lang: 'de', text: 'Hallo' },
  { code: 'pt', lang: 'pt', text: 'Olá' },
  { code: 'ru', lang: 'ru', text: 'Привет' },
  { code: 'ar', lang: 'ar', text: 'مرحبا' },
]
const greetingGroups = [greetings.slice(0, 4), greetings.slice(4, 6), greetings.slice(6)]
</script>
<template>
  <div class="bv-hero-orbit" aria-hidden="true">
    <div class="bv-orbit-card bv-orbit-page">
      <small>{{ en ? 'Bilingual webpages' : '网页双语翻译' }}</small>
      <p>Stay curious.</p>
      <p class="bv-orbit-translation">保持好奇。</p>
    </div>
    <div class="bv-orbit-card bv-orbit-document">
      <small>{{ en ? 'Document translation' : '文档翻译' }}</small>
      <div><span>PDF</span><small>explore.pdf</small></div>
      <i></i><i></i><i></i>
      <p>{{ en ? 'Read side by side' : '原文与译文，对照读' }}</p>
    </div>
    <div class="bv-orbit-card bv-orbit-grammar">
      <span>offers</span><small>{{ en ? 'Verb · predicate' : '动词 · 谓语' }}</small>
      <p>{{ en ? 'Understand each phrase' : '难句，拆开理解' }}</p>
    </div>
    <span
      v-for="greeting in greetings"
      :key="greeting.code"
      class="bv-orbit-greeting"
      :class="`bv-greeting-${greeting.code}`"
      :lang="greeting.lang"
      :dir="greeting.code === 'ar' ? 'rtl' : undefined"
      >{{ greeting.text }}</span
    >
    <div class="bv-greeting-ribbon">
      <div
        v-for="(group, index) in greetingGroups"
        :key="index"
        class="bv-greeting-ribbon-group"
        :style="{ '--bv-greeting-group': index }"
      >
        <span
          v-for="greeting in group"
          :key="greeting.code"
          :lang="greeting.lang"
          :dir="greeting.code === 'ar' ? 'rtl' : undefined"
          >{{ greeting.text }}</span
        >
      </div>
    </div>
  </div>
</template>
