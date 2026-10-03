<script setup lang="ts">
import { computed, ref } from 'vue'
import { withBase } from 'vitepress'
import { useDemoPlayback } from './useDemoPlayback'
const props = defineProps<{
  kind: 'webpage' | 'selection' | 'document' | 'image' | 'video'
  en?: boolean
}>()
const t = (zh: string, english: string) => (props.en ? english : zh)
const root = ref<HTMLElement | null>(null)
const { step, playing, running, reduced, replay } = useDemoPlayback(
  root,
  6,
  true,
  [600, 450, 900, 1600, 1600, 1800]
)
const revealed = computed(() => step.value >= 2)
const word = computed(() => step.value >= 4)
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
          <mark :class="{ selected: step >= 1 && !word }"
            >Stay <span :class="{ selected: word }">curious</span>. Keep exploring.</mark
          >
        </p>
        <div class="fd-card-stack">
          <section
            class="fd-selection-card fd-sentence-card fd-reveal"
            :class="{ 'fd-hidden': word }"
            :aria-hidden="!revealed || word"
            :aria-label="t('句子翻译卡片示例', 'Sentence translation card example')"
          >
            <div class="fd-card-bar">
              <strong>{{ t('简体中文', 'Simplified Chinese') }}</strong
              ><span>{{ t('卡片模式', 'Card mode') }}</span>
            </div>
            <div class="fd-study-bar">
              {{ t('词性与句法 · 用法 · 练习', 'Word classes · Usage · Practice') }}
            </div>
            <div class="fd-card-body">
              <small>{{ t('原文', 'Original') }}</small>
              <p>Stay curious. Keep exploring.</p>
              <small>{{ t('译文', 'Translation') }}</small>
              <p class="fd-card-translation">保持好奇，继续探索。</p>
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
