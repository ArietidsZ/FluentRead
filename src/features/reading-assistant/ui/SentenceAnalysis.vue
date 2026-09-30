<!--
 * @file src/features/reading-assistant/ui/SentenceAnalysis.vue
 * 文件职责：在原文上展示词性标签，并让学习者点击查看片段含义与句中作用。
 * 主要内容：保留原文顺序和未标注文字，以文字加颜色表达类别；支持键盘按钮、明确选中状态及深浅主题。
 * 模块边界：只接收已经锚定的标注，不进行词性猜测、不发起请求，不写入宿主网页。
 -->
<template>
  <section class="fr-sentence-analysis" :aria-label="translateLegacy('词性与句法')">
    <p class="fr-sentence-help">{{ translateLegacy('点击原文片段，查看词性和句中作用') }}</p>
    <div class="fr-sentence-tokens" role="group" :aria-label="translateLegacy('原文词性标注')">
      <template v-for="(annotation, index) in annotations" :key="`${annotation.start}-${annotation.end}`">
        <span class="fr-sentence-gap">{{ source.slice(index ? annotations[index - 1].end : 0, annotation.start) }}</span>
        <button type="button" :data-pos="annotation.part.id" :aria-pressed="selected === index" :aria-label="`${annotation.text} · ${translateLegacy(annotation.part.label)} · ${annotation.role}`" @click="selectAnnotation(index)">
          <span>{{ annotation.text }}</span><small>{{ translateLegacy(annotation.part.label) }}</small>
        </button>
      </template>
      <span>{{ source.slice(annotations[annotations.length - 1]?.end || 0) }}</span>
    </div>
    <div v-if="active" ref="detail" class="fr-sentence-detail" aria-live="polite">
      <strong>{{ active.text }} <small>{{ translateLegacy(active.part.label) }} {{ active.part.abbreviation }}</small></strong>
      <dl><dt>{{ translateLegacy('句中作用') }}</dt><dd>{{ active.role }}</dd><dt>{{ translateLegacy('含义') }}</dt><dd>{{ active.meaning }}</dd></dl>
      <p>{{ translateLegacy(active.part.description) }}</p>
    </div>
    <small class="fr-sentence-disclaimer">{{ translateLegacy('AI 根据原文分析；同一个词在不同句子中可能有不同词性。') }}</small>
  </section>
</template>
<script setup lang="ts">
import {computed, nextTick, ref, watch} from 'vue';
import {useUiI18n} from '@/src/ui/i18n';
import type {SentenceAnnotation} from '../sentenceAnalysis';
const props = defineProps<{source: string; annotations: SentenceAnnotation[]}>();
const {translateLegacy} = useUiI18n();
const selected = ref(0);
const detail = ref<HTMLElement>();
async function selectAnnotation(index: number): Promise<void> {
  selected.value = index;
  await nextTick();
  const element = detail.value;
  const viewport = element?.closest<HTMLElement>('.fr-reading-result');
  if (!element || !viewport) return;
  const box = element.getBoundingClientRect();
  const bounds = viewport.getBoundingClientRect();
  if (box.bottom > bounds.bottom) viewport.scrollTop += box.bottom - bounds.bottom + 8;
}

const active = computed(() => props.annotations[selected.value] || props.annotations[0]);
watch(() => props.source, () => { selected.value = 0; });
</script>
<style scoped>
.fr-sentence-analysis { margin:12px 0; }
.fr-sentence-help { margin:0 0 10px; font-size:11px; opacity:.7; }
.fr-sentence-tokens { display:flex; align-items:center; flex-wrap:wrap; gap:6px 4px; line-height:1.4; }
.fr-sentence-tokens button { --pos-color:#846242; font:inherit; display:inline-flex; flex-direction:column; align-items:center; gap:5px; padding:7px 9px; border:1px solid color-mix(in srgb,var(--pos-color) 35%,transparent); border-radius:8px; background:color-mix(in srgb,var(--pos-color) 8%,transparent); color:inherit; cursor:pointer; max-width:100%; overflow-wrap:anywhere; }
.fr-sentence-tokens button[data-pos=noun], .fr-sentence-tokens button[data-pos=pronoun] { --pos-color:#3c7fbb; }
.fr-sentence-tokens button[data-pos=verb], .fr-sentence-tokens button[data-pos=auxiliary] { --pos-color:#bd5481; }
.fr-sentence-tokens button[data-pos=adjective], .fr-sentence-tokens button[data-pos=adverb] { --pos-color:#398579; }
.fr-sentence-tokens button[data-pos=article], .fr-sentence-tokens button[data-pos=determiner] { --pos-color:#9c713b; }
.fr-sentence-tokens button[data-pos=conjunction], .fr-sentence-tokens button[data-pos=preposition] { --pos-color:#8067bc; }
.fr-sentence-tokens button[aria-pressed=true] { border-color:var(--pos-color); background:color-mix(in srgb,var(--pos-color) 17%,transparent); box-shadow:0 0 0 1px var(--pos-color); }
.fr-sentence-tokens button:focus-visible { outline:2px solid currentColor; outline-offset:3px; }
.fr-sentence-tokens small { font-size:10px; opacity:.8; }
.fr-sentence-gap { white-space:pre-wrap; }
.fr-sentence-detail { margin:14px 0 8px; border:1px solid var(--fr-answer-border,#e9e9ef); border-radius:9px; padding:12px; background:var(--fr-answer-soft,transparent); }
.fr-sentence-detail strong { display:flex; flex-wrap:wrap; gap:8px; font-size:13px; }
.fr-sentence-detail strong small { font-size:11px; font-weight:400; opacity:.75; }
.fr-sentence-detail dl { display:grid; grid-template-columns:auto 1fr; gap:7px 12px; margin:10px 0; font-size:12px; }
.fr-sentence-detail dt { opacity:.65; }.fr-sentence-detail dd { margin:0; overflow-wrap:anywhere; }
.fr-sentence-detail p { margin:0; font-size:11px; opacity:.7; }
.fr-sentence-disclaimer { font-size:10px; opacity:.65; line-height:1.6; }
</style>
