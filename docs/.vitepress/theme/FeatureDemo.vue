<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { withBase } from 'vitepress'
import { useDemoPlayback } from './useDemoPlayback'
import { createDemoSpeech, type DemoSpeechState, type DemoSpeechTarget } from './demoSpeech'
const props = defineProps<{
  kind: 'webpage' | 'selection' | 'document' | 'image' | 'video'
  en?: boolean
}>()
const t = (zh: string, english: string) => (props.en ? english : zh)
const root = ref<HTMLElement | null>(null)
const { step, playing, running, reduced, choose, replay } = useDemoPlayback(
  root,
  props.kind === 'selection' ? 11 : 6,
  true,
  props.kind === 'selection'
    ? [550, 400, 1400, 1600, 1600, 1300, 1300, 1300, 650, 1800, 1300]
    : [600, 450, 900, 1600, 1600, 1800]
)
const revealed = computed(() => step.value >= 2)
const word = computed(() => props.kind === 'selection' && step.value >= 8)
const structure = computed(() => props.kind === 'selection' && step.value >= 5 && step.value <= 7)
const activePart = computed(() => Math.min(2, Math.max(0, step.value - 5)))
const audioPreview = computed(() => {
  if (props.kind !== 'selection') return null
  return step.value === 3 ? 'original' : step.value === 4 ? 'translation' : null
})
const sentenceOriginal = 'A good book opens a new world.'
const sentenceTranslation = '一本好书为你打开一个新世界。'
const speech = ref<DemoSpeechState>({ target: null, status: 'idle' })
const reader = createDemoSpeech((state) => { speech.value = state })
const highlightedAudio = computed(() => speech.value.target ?? audioPreview.value)
const speechNote = computed(() => {
  if (speech.value.status === 'error')
    return speech.value.error === 'unsupported'
      ? t('当前浏览器不支持朗读，请使用其他浏览器。', 'Read-aloud is unavailable in this browser.')
      : t('暂时无法朗读，请点击重试。', 'Audio could not play. Click to try again.')
  if (speech.value.status === 'loading')
    return t('正在准备朗读，点击按钮可停止。', 'Preparing audio. Click again to stop.')
  if (speech.value.status === 'speaking')
    return speech.value.target === 'original'
      ? t('正在朗读原文，点击按钮可停止。', 'Reading the original. Click again to stop.')
      : t('正在朗读译文，点击按钮可停止。', 'Reading the translation. Click again to stop.')
  return t('点击按钮，收听原文或译文。', 'Click to listen to either language.')
})
function readAloud(target: DemoSpeechTarget) {
  choose(target === 'original' ? 3 : 4)
  reader.toggle(
    target,
    target === 'original' ? sentenceOriginal : sentenceTranslation,
    target === 'original' ? 'en-US' : 'zh-CN'
  )
}
function visibility() {
  if (document.hidden) reader.stop()
}
watch([step, playing], () => {
  const target = speech.value.target
  if (target && (playing.value || step.value !== (target === 'original' ? 3 : 4))) reader.stop()
})
onMounted(() => {
  if (props.kind !== 'selection') return
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('pagehide', reader.stop)
})
onBeforeUnmount(() => {
  reader.stop()
  document.removeEventListener('visibilitychange', visibility)
  window.removeEventListener('pagehide', reader.stop)
})
const parts = [
  {
    text: 'A good book',
    role: t('主语', 'Subject'),
    type: t('名词短语', 'Noun phrase'),
    meaning: t('一本好书', 'a good book'),
    explanation: t('这句话在说什么？在说“一本好书”。', 'What is the sentence about? A good book.'),
  },
  {
    text: 'opens',
    role: t('谓语', 'Predicate'),
    type: t('动词', 'Verb'),
    meaning: t('打开', 'opens'),
    explanation: t(
      '这本书做了什么？为你“打开”新的世界。',
      'What does the book do? It opens something new.'
    ),
  },
  {
    text: 'a new world.',
    role: t('宾语', 'Object'),
    type: t('名词短语', 'Noun phrase'),
    meaning: t('一个新世界', 'a new world'),
    explanation: t('打开什么？“一个新世界”。', 'What does it open? A new world.'),
  },
]
const contexts = {
  webpage: t('阅读一篇英文文章', 'Read an article'),
  selection: t('选中词句，查看卡片', 'Select text, see a card'),
  document: t('导入文件，对照阅读', 'Import a file, read side by side'),
  image: t('翻译漫画中的气泡', 'Translate a comic bubble'),
  video: t('视频字幕，双语呈现', 'Bilingual video captions'),
}
</script>
<template>
  <div
    ref="root"
    class="fd"
    :class="`fd-${kind}`"
    :data-demo="kind === 'webpage' ? 'brand-reader' : undefined"
    :data-visual="kind !== 'webpage' ? kind : undefined"
    :data-step="step"
    :data-playing="playing"
    :data-running="running"
    :data-revealed="revealed"
    :data-word="word"
    :data-structure="structure"
    :data-speech-state="kind === 'selection' ? speech.status : undefined"
    :data-speaking="speech.target ?? undefined"
  >
    <div class="fd-header">
      <span class="bv-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>{{ contexts[kind] }}</span>
      <img :src="withBase('/brand-icon.webp')" width="24" height="24" alt="" />
    </div>
    <div class="fd-stage">
      <template v-if="kind === 'webpage'">
        <div class="fd-meta">
          <span>{{ t('英语 → 简体中文', 'Chinese → English') }}</span
          ><span>{{
            revealed ? t('双语对照', 'Bilingual result') : t('正在翻译…', 'Translating…')
          }}</span>
        </div>
        <article class="fd-article">
          <h3>{{ t('The joy of reading.', '阅读的乐趣。') }}</h3>
          <div class="fd-paragraph">
            <p>
              {{ t('Reading opens a window to the world.', '阅读，为我们打开一扇了解世界的窗。') }}
            </p>
            <p class="fd-translation fd-reveal" :aria-hidden="!revealed">
              {{ t('阅读，为我们打开一扇了解世界的窗。', 'Reading opens a window to the world.') }}
            </p>
          </div>
          <div class="fd-paragraph">
            <p>
              {{ t('A good book can take you somewhere new.', '一本好书，能带你发现新的天地。') }}
            </p>
            <p class="fd-translation fd-reveal fd-second" :aria-hidden="step < 3">
              {{ t('一本好书，能带你发现新的天地。', 'A good book can take you somewhere new.') }}
            </p>
          </div>
        </article>
      </template>
      <template v-else-if="kind === 'selection'">
        <p class="fd-selection-source">
          <span v-if="word">Stay <mark class="selected">curious</mark>. Keep exploring.</span>
          <mark v-else :class="{ selected: step >= 1 }">{{ sentenceOriginal }}</mark>
        </p>
        <div class="fd-card-stack">
          <section
            class="fd-selection-card fd-sentence-card fd-reveal"
            :class="{ 'fd-hidden': word || structure }"
            :aria-hidden="!revealed || word || structure"
            :aria-label="t('句子翻译卡片示例', 'Sentence translation card example')"
          >
            <div class="fd-card-bar">
              <strong>{{ t('简体中文', 'Simplified Chinese') }}</strong
              ><span>{{ t('卡片模式', 'Card mode') }}</span>
            </div>
            <div class="fd-study-bar">
              {{ t('词性与句法 · 用法 · 练习', 'Sentence structure · Usage · Practice') }}
            </div>
            <div class="fd-card-body">
              <small>{{ t('原文', 'Original') }}</small>
              <p>{{ sentenceOriginal }}</p>
              <small>{{ t('译文', 'Translation') }}</small>
              <p class="fd-card-translation">{{ sentenceTranslation }}</p>
            </div>
          </section>
          <section
            class="fd-selection-card fd-structure-card"
            :class="{ 'fd-hidden': !structure }"
            :aria-hidden="!structure"
            :aria-label="t('句子结构卡片示例', 'Sentence structure card example')"
          >
            <div class="fd-card-bar">
              <strong>{{ t('词性与句法', 'Sentence structure') }}</strong>
              <span>{{ t('卡片模式', 'Card mode') }}</span>
            </div>
            <div class="fd-card-body">
              <div
                class="fd-structure-parts"
                :aria-label="t('句子的三个部分', 'Three sentence parts')"
              >
                <button
                  v-for="(part, index) in parts"
                  :key="part.role"
                  type="button"
                  :class="[`fd-part-${index}`, { 'fd-part-active': activePart === index }]"
                  :aria-pressed="activePart === index"
                  :tabindex="structure ? 0 : -1"
                  @click="choose(5 + index)"
                >
                  <span>{{ part.text }}</span>
                  <small>{{ part.role }}</small>
                  <small>{{ part.type }}</small>
                </button>
              </div>
              <p class="fd-structure-translation">一本好书为你打开一个新世界。</p>
              <div class="fd-structure-explanation" aria-live="polite">
                <p>
                  <b>{{ parts[activePart].text }}</b> {{ parts[activePart].meaning }}
                </p>
                <p>{{ parts[activePart].explanation }}</p>
              </div>
            </div>
          </section>
          <section
            class="fd-selection-card fd-word-card"
            :class="{ 'fd-hidden': !word }"
            :aria-hidden="!word"
            :aria-label="t('单词学习卡片示例', 'Word learning card example')"
          >
            <div class="fd-card-bar">
              <strong>{{ t('简体中文', 'Simplified Chinese') }}</strong
              ><span>{{ t('卡片模式', 'Card mode') }}</span>
            </div>
            <div class="fd-card-body">
              <h3>curious</h3>
              <div class="fd-phonetic">
                /ˈkjʊəriəs/
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 9v6h4l5 4V5L8 9H4Z" />
                  <path d="M16 9.5a4.5 4.5 0 0 1 0 5" />
                </svg>
              </div>
              <p class="fd-word-meaning"><b>adj.</b> 好奇的；求知欲强的</p>
              <p class="fd-definition">Eager to know or learn.</p>
              <small>{{ t('例句', 'Example') }}</small>
              <p>Stay curious about the world.</p>
              <p class="fd-card-translation">对世界保持好奇。</p>
            </div>
          </section>
        </div>
        <div class="fd-audio-actions" :aria-label="t('朗读原文与译文', 'Listen to both languages')">
          <button
            v-for="target in (['original', 'translation'] as const)"
            :key="target"
            type="button"
            :class="{ 'fd-audio-active': highlightedAudio === target }"
            :aria-pressed="speech.target === target"
            :aria-label="
              speech.target === target
                ? (target === 'original' ? t('停止朗读原文', 'Stop reading the original') : t('停止朗读译文', 'Stop reading the translation'))
                : (target === 'original' ? t('朗读原文', 'Read original') : t('朗读译文', 'Read translation'))
            "
            @click="readAloud(target)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9v6h4l5 4V5L8 9H4Z" />
              <path d="M16 9a5 5 0 0 1 0 6M19 6a9 9 0 0 1 0 12" />
            </svg>
            {{
              target === 'original' ? t('朗读原文', 'Read original') : t('朗读译文', 'Read translation')
            }}
            <span class="fd-sound-wave" aria-hidden="true"><i></i><i></i><i></i></span>
          </button>
        </div>
        <p class="fd-audio-note" role="status" aria-live="polite">{{ speechNote }}</p>
      </template>
      <template v-else-if="kind === 'document'">
        <div class="fd-meta">
          <strong>explore.pdf</strong
          ><span>{{
            revealed ? t('翻译完成', 'Translated') : t('正在翻译…', 'Translating…')
          }}</span>
        </div>
        <div class="fd-document-pages">
          <article>
            <small>{{ t('原文', 'Original') }}</small>
            <h3>A new view.</h3>
            <p>Every language opens a new door.</p>
            <div class="fd-lines" aria-hidden="true"><i></i><i></i><i></i></div>
          </article>
          <article>
            <small>{{ t('译文', 'Translation') }}</small>
            <div class="fd-reveal" :aria-hidden="!revealed">
              <h3>新的视角。</h3>
              <p>每一种语言，都打开一扇新的门。</p>
              <div class="fd-lines" aria-hidden="true"><i></i><i></i><i></i></div>
            </div>
          </article>
        </div>
      </template>
      <template v-else-if="kind === 'image'">
        <div class="fd-meta">
          <span>{{ t('漫画原图', 'Comic image') }}</span
          ><span>{{
            revealed
              ? t('译文回到原图', 'Translation on the image')
              : t('识别文字…', 'Reading the text…')
          }}</span>
        </div>
        <div class="fd-comic">
          <div class="fd-bubble">
            <span class="fd-layer" :class="{ 'fd-hidden': revealed }" :aria-hidden="revealed"
              >Let's explore the world!</span
            ><span class="fd-layer fd-reveal" :aria-hidden="!revealed">一起探索世界吧！</span>
          </div>
          <svg
            viewBox="0 0 380 160"
            role="img"
            :aria-label="t('一个正在读书的漫画人物', 'A comic character reading a book')"
          >
            <path d="M20 138h340M30 45h76v80M44 63h47M44 83h47M302 62h42v64M306 79h32M305 99h32" />
            <circle cx="190" cy="61" r="27" />
            <path
              d="M164 55q25-42 51 1M181 65h1M199 65h1M183 78q7 5 14-1M157 139v-32q7-18 33-18t33 18v32M154 113l19 18M226 113l-19 18"
            />
            <path class="fd-comic-book" d="m174 104 16 5 16-5v30l-16 5-16-5Zm16 5v30" />
          </svg>
        </div>
      </template>
      <template v-else>
        <div class="fd-meta">
          <span>YouTube · X · {{ t('网页会议', 'Web meetings') }}</span
          ><span>{{
            revealed ? t('双语字幕', 'Bilingual captions') : t('读取字幕…', 'Reading captions…')
          }}</span>
        </div>
        <div class="fd-player">
          <svg viewBox="0 0 500 260" aria-hidden="true">
            <path
              d="M0 200 140 70l100 90L350 40l150 160M0 220h500M250 22v32M210 34l14 12M290 34l-14 12"
            />
            <circle cx="250" cy="85" r="20" />
          </svg>
          <div class="fd-captions">
            <p>There is so much to discover.</p>
            <p class="fd-reveal" :aria-hidden="!revealed">还有那么多值得发现的事。</p>
          </div>
        </div>
      </template>
    </div>
    <div class="fd-footer">
      <small>{{
        reduced
          ? t('示例内容', 'Sample content')
          : t('自动演示 · 示例内容', 'Auto demo · sample content')
      }}</small>
      <div>
        <button
          v-if="!reduced"
          type="button"
          @click="playing = !playing"
          :aria-label="
            playing
              ? t('暂停自动演示', 'Pause automatic demo')
              : t('播放自动演示', 'Play automatic demo')
          "
        >
          {{ playing ? t('Ⅱ 暂停', 'Ⅱ Pause') : t('▷ 播放', '▷ Play') }}</button
        ><button type="button" @click="replay">{{ t('↻ 重播', '↻ Replay') }}</button>
      </div>
    </div>
  </div>
</template>
