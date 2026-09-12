<!--
@file src/features/settings/ui/components/WritingFlowDemo.vue
文件职责：在写作设置中用三个可操作画面演示打开助手、查看草稿和插回回复框。
主要内容：一次只显示当前步骤，用户可点击示例按钮或主动播放一遍；手动切换、暂停、减少动态和卸载时停止计时。
模块边界：全部内容为本地示例，不读取网页、不调用模型、不写入配置，也不执行发送操作。
-->
<template>
  <div class="writing-flow">
    <header class="flow-heading">
      <h2>{{ t('writing.demo.title') }}</h2>
      <button v-if="motion" type="button" class="flow-play" :aria-pressed="playing" @click="togglePlayback">
        {{ t(playing ? 'writing.demo.pause' : 'writing.demo.play') }}
      </button>
    </header>

    <ol class="flow-rail" :aria-label="t('writing.demo.steps')">
      <li v-for="(step, index) in steps" :key="step">
        <button type="button" :class="{active: active === index}" :aria-current="active === index ? 'step' : undefined" @click="select(index)">
          <span class="flow-number" aria-hidden="true">{{ index + 1 }}</span>{{ t(step) }}
        </button>
      </li>
    </ol>

    <div class="flow-stage" :data-step="active">
      <div class="stage-heading">
        <span>{{ t(active === 1 ? 'writing.demo.assistant' : 'writing.demo.replyBox') }}</span>
        <span class="stage-example">{{ t('writing.demo.example') }}</span>
      </div>
      <p class="stage-text" :class="{'is-placeholder': active === 0}">
        {{ t(active === 0 ? 'writing.demo.placeholder' : 'writing.demo.draft') }}
      </p>
      <div class="stage-actions">
        <button v-if="active === 0" type="button" class="stage-primary" @click="select(1)">{{ t('writing.demo.assistant') }}</button>
        <button v-else-if="active === 1" type="button" class="stage-primary" @click="select(2)">{{ t('writing.demo.insert') }}</button>
        <span v-else class="stage-complete">{{ t('writing.demo.inserted') }}</span>
      </div>
    </div>

    <p class="flow-caption" role="status">{{ t(captions[active]) }}</p>
  </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import {useUiI18n} from '@/src/ui/i18n';

const props = defineProps<{animated: boolean}>();
const {t} = useUiI18n();
const steps = ['writing.demo.open', 'writing.demo.review', 'writing.demo.insert'] as const;
const captions = ['writing.demo.openHint', 'writing.demo.reviewHint', 'writing.demo.insertHint'] as const;
const active = ref(0);
const playing = ref(false);
const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
const reduced = ref(Boolean(query?.matches));
const motion = computed(() => props.animated && !reduced.value);
let timer: ReturnType<typeof setTimeout> | undefined;

function clearTimer() {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}
function select(index: number) {
  clearTimer();
  playing.value = false;
  active.value = index;
}
function togglePlayback() {
  clearTimer();
  if (playing.value) { playing.value = false; return; }
  active.value = 0;
  playing.value = true;
}
function onQueryChange() { reduced.value = Boolean(query?.matches); }
query?.addEventListener?.('change', onQueryChange);

watch([active, playing, motion], () => {
  clearTimer();
  if (!motion.value) { playing.value = false; return; }
  if (!playing.value) return;
  timer = setTimeout(() => {
    if (active.value < steps.length - 1) active.value++;
    if (active.value === steps.length - 1) playing.value = false;
  }, active.value === 0 ? 2400 : 3800);
});

onBeforeUnmount(() => {
  clearTimer();
  query?.removeEventListener?.('change', onQueryChange);
});
</script>

<style scoped>
.writing-flow { padding: 18px; }
.flow-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.flow-heading h2 { margin: 0; color: var(--ink); font-size: 14px; font-weight: 600; }
.writing-flow button { font: inherit; cursor: pointer; }
.writing-flow button:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }
.flow-play { flex-shrink: 0; padding: 4px 0; border: 0; background: none; color: var(--muted); font-size: 12px !important; }
.flow-play:hover { color: var(--brand); }
.flow-rail { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 16px 0; padding: 0; list-style: none; }
.flow-rail button { display: flex; align-items: center; justify-content: center; gap: 7px; width: 100%; min-height: 34px; padding: 5px 2px; border: 0; background: transparent; color: var(--muted); font-size: 12px; line-height: 1.5; }
.flow-number { flex-shrink: 0; font-size: 11px; }
.flow-rail button.active { color: var(--brand); font-weight: 600; }
.flow-stage { display: flex; flex-direction: column; min-height: 172px; padding: 16px; border-radius: 10px; background: var(--surface-soft); }
.stage-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--ink); font-size: 12px; font-weight: 600; }
.stage-example { color: var(--muted); font-size: 11px; font-weight: 400; }
.stage-text { margin: 15px 0; color: var(--ink); font-size: 13px; line-height: 1.8; overflow-wrap: anywhere; }
.stage-text.is-placeholder { color: var(--muted); }
.stage-actions { display: flex; align-items: center; justify-content: flex-end; min-height: 34px; margin-top: auto; }
.stage-primary { padding: 7px 13px; border: 0; border-radius: 7px; background: var(--brand); color: #fff; font-size: 12px !important; line-height: 1.5; }
.stage-complete { color: var(--muted); font-size: 12px; }
.flow-caption { margin: 12px 0 0; color: var(--muted); font-size: 12px; line-height: 1.7; }
@media(max-width: 600px) {
  .writing-flow { padding: 14px 12px; }
  .flow-rail { gap: 4px; }
  .flow-rail button { flex-direction: column; gap: 2px; }
  .flow-stage { padding: 14px; }
}
@media(pointer: coarse) { .writing-flow button { min-height: 44px; } }
</style>
