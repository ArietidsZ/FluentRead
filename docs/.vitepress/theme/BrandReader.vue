<script setup lang="ts">
import { computed, ref } from 'vue'
import { withBase } from 'vitepress'
import { useDemoPlayback } from './useDemoPlayback'
import DemoPointer from './DemoPointer.vue'
const props = defineProps<{ en?: boolean; autoplay?: boolean }>()
const root = ref<HTMLElement | null>(null)
const { step, playing, running, reduced, replay } = useDemoPlayback(
  root,
  4,
  props.autoplay ?? true,
  [650, 550, 450, 2300]
)
const t = (zh: string, english: string) => (props.en ? english : zh)
const translated = computed(() => step.value >= 2)
</script>
<template>
  <div
    ref="root"
    class="bv-reader"
    data-demo="brand-reader"
    :data-step="step"
    :data-playing="playing"
    :data-running="running"
  >
    <div class="bv-window">
      <span class="bv-dots" aria-hidden="true"><i></i><i></i><i></i></span
      ><span>explore / a new perspective</span
      ><img :src="withBase('/brand-icon.webp')" width="28" height="28" alt="FluentRead" />
    </div>
    <div class="bv-reader-toolbar">
      <span>{{ t('英语 → 简体中文', 'Chinese → English') }}</span
      ><span class="bv-demo-trigger" data-demo-target :class="{ triggered: step === 1 }">
        {{ t('翻译当前网页', 'Translate this page') }} <span aria-hidden="true">↔</span>
      </span>
    </div>
    <article class="bv-paper" :class="{ translated, scanning: step === 1 }">
      <span class="bv-paper-label">FIELD NOTES <span>01</span></span>
      <h3>{{ t('A new perspective.', '一种新的视角。') }}</h3>
      <div class="bv-line">
        <p>{{ t('The world is full of stories.', '世界，充满值得发现的故事。') }}</p>
        <p class="bv-line-translation" :aria-hidden="!translated">
          {{ t('世界，充满值得发现的故事。', 'The world is full of stories.') }}
        </p>
      </div>
      <div class="bv-line">
        <p>{{ t('Every language opens a new door.', '每一种语言，都打开一扇新的门。') }}</p>
        <p class="bv-line-translation" :aria-hidden="!translated || step === 2">
          {{ t('每一种语言，都打开一扇新的门。', 'Every language opens a new door.') }}
        </p>
      </div>
      <div class="bv-reading-mark" aria-hidden="true"><span></span><span></span><span></span></div>
      <span v-if="step === 1" class="bv-scan" aria-hidden="true"></span>
    </article>
    <DemoPointer :phase="running ? (step === 0 ? 1 : step === 1 ? 2 : 0) : 0" />
    <div class="bv-playback">
      <small>{{ t('操作示意 · 示例译文', 'Walkthrough · example translations') }}</small>
      <div>
        <button
          v-if="!reduced"
          type="button"
          :aria-label="
            playing
              ? t('暂停自动演示', 'Pause automatic demo')
              : t('播放自动演示', 'Play automatic demo')
          "
          @click="playing = !playing"
        >
          {{ playing ? t('Ⅱ 暂停', 'Ⅱ Pause') : t('▷ 播放', '▷ Play') }}</button
        ><button type="button" @click="replay">{{ t('↻ 重播', '↻ Replay') }}</button>
      </div>
    </div>
  </div>
</template>
