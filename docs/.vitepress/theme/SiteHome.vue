<script setup lang="ts">
import { withBase } from 'vitepress'
import { computed } from 'vue'
import BrandReader from './BrandReader.vue'
import GrammarDemo from './GrammarDemo.vue'
import GuideVisual from './GuideVisual.vue'
import BrowserInstall from './BrowserInstall.vue'
import HeroOrbit from './HeroOrbit.vue'
import brandTaglines from '../../../src/core/i18n/messages/brand-taglines.json'
const props = defineProps<{ en?: boolean }>()
const t = (zh: string, english: string) => (props.en ? english : zh)
const link = (path: string) => withBase((props.en ? '/en' : '') + path)
const chrome = 'https://chromewebstore.google.com/detail/djnlaiohfaaifbibleebjggkghlmcpcj'
const titleLines = computed(() =>
  props.en ? brandTaglines['en-US'].split(/(?<=\.) /) : brandTaglines['zh-CN'].split(/(?<=，)/)
)
const scenes = [
  {
    kind: 'image',
    title: t('图片里的文字，也能读。', 'Read the words inside an image.'),
    description: t(
      '识别文字，在原图上对照译文。',
      'Recognize text and read the translation over the image.'
    ),
    path: '/guide/image-translation',
  },
  {
    kind: 'document',
    title: t('文件导进来，双语读下去。', 'Bring a document. Keep exploring.'),
    description: t(
      'PDF、ePub、Word：翻译、校订、下载。',
      'PDF, ePub, Word: translate, edit, download.'
    ),
    path: '/guide/document-translation',
  },
  {
    kind: 'video',
    title: t('保留原话，跟上视频。', 'Keep the original. Follow the story.'),
    description: t(
      '在支持的平台，同时看原字幕与译文。',
      'Read original and translated captions on supported platforms.'
    ),
    path: '/guide/video-subtitles',
  },
  {
    kind: 'input',
    title: t('写下想法，自然地表达。', 'Write your thoughts. Find the words.'),
    description: t(
      '翻译输入内容，或用写作助手完善回复。',
      'Translate your input or refine a reply with the writing assistant.'
    ),
    path: '/guide/input-translation',
  },
]
const faqs = [
  [
    t('免费吗？需要注册吗？', 'Is it free? Do I need an account?'),
    t(
      'FluentRead 开源免费，无需注册 FluentRead 账号。免费翻译服务可以直接使用；AI 讲解需连接自己的服务，费用和额度由服务商决定。',
      'FluentRead is free and open source, with no FluentRead account required. Start with free translation. AI explanations need your own provider; its fees and quotas apply.'
    ),
    '/config/translation-engines',
    t('选择翻译服务', 'Choose a provider'),
  ],
  [
    t('支持哪些浏览器？', 'Which browsers are supported?'),
    t(
      'Chrome、Edge、Firefox 可从官方商店安装。脚本版与手机浏览器的能力和入口有所不同，安装指南中有具体说明。',
      'Install from the Chrome, Edge, or Firefox store. The installation guide explains userscript and mobile availability.'
    ),
    '/guide/getting-started',
    t('查看安装指南', 'Installation guide'),
  ],
  [
    t('可以用自己的 AI 或本地模型吗？', 'Can I use my own AI or local model?'),
    t(
      '可以连接 DeepSeek、OpenAI、Gemini 等服务，或使用本地 Ollama；不同功能可以独立选择服务。',
      'Connect DeepSeek, OpenAI, Gemini, or local Ollama. Each feature can use its own provider.'
    ),
    '/config/translation-engines',
    t('查看连接方法', 'Connection guide'),
  ],
  [
    t('待译内容会发送到哪里？', 'Where does my content go?'),
    t(
      '使用云端翻译时，待译文字发送给你选择的服务。设置与学习记录保存在浏览器中；图片、文件和可选同步的具体范围见隐私政策。',
      'Cloud translation sends text to your selected provider. Settings and learning records stay in your browser. See the privacy policy for images, files, and optional sync.'
    ),
    '/guide/privacy',
    t('数据与隐私', 'Data & privacy'),
  ],
]
</script>
<template>
  <div class="bv-site product-home">
    <section class="bv-hero" :class="{ 'bv-hero-en': en }" aria-labelledby="fr-title">
      <HeroOrbit :en="en" />
      <div class="bv-hero-copy">
        <p class="bv-hero-kicker">
          {{ t('开源双语翻译 · AI 讲解', 'OPEN-SOURCE TRANSLATION · AI EXPLANATIONS') }}
        </p>
        <h1 id="fr-title" class="product-tagline">
          <span v-for="line in titleLines" :key="line">{{ line }}</span>
        </h1>
        <p class="bv-hero-intro">
          {{
            t(
              '保留原文，双语对照。遇到难句，选中就能继续理解。',
              'Keep the original. Read side by side. Select a difficult sentence to understand it better.'
            )
          }}
        </p>
        <p class="bv-hero-formats">
          {{ t('网页 · 图片 · 文档 · 视频字幕', 'Webpages · Images · Documents · Video captions') }}
        </p>
        <BrowserInstall :en="en" />
        <p class="bv-install-note">
          {{ t('开源免费 · 无需注册', 'Free & open source · no sign-up') }}
        </p>
      </div>
    </section>
    <section class="bv-section bv-translation-section" aria-labelledby="bv-translation-title">
      <h2 id="bv-translation-title" class="bv-visually-hidden">
        {{ t('原文保留，译文就在旁边。', 'Keep the original. Read the translation alongside.') }}
      </h2>
      <div class="bv-translation-demo"><BrandReader :en="en" autoplay /></div>
      <p class="bv-translation-caption">
        {{
          t(
            '网页双语翻译，原文与译文一起看。',
            'Bilingual webpages. Keep the original alongside the translation.'
          )
        }}<a :href="link('/guide/webpage-translation')">{{ t('了解更多', 'Learn more') }} →</a>
      </p>
    </section>
    <section id="features" class="bv-section bv-understand">
      <div class="bv-section-copy">
        <span class="bv-section-number">{{
          t('从看懂，到理解', 'GO BEYOND THE TRANSLATION')
        }}</span>
        <h2>{{ t('难句拆开，意思就清楚了。', 'Break it down. Let the meaning click.') }}</h2>
        <p>
          {{
            t(
              '选中一句，查看译文；再用 AI 拆解主干、词性和用法。每个片段，都能点开理解。',
              'Select a sentence for its translation. Use AI to explore structure and usage, one phrase at a time.'
            )
          }}
        </p>
        <a class="bv-text-link" :href="link('/guide/deepseek-harness')"
          >{{ t('如何使用划词与 AI 讲解', 'Use selection & AI explanations') }}
          <span aria-hidden="true">→</span></a
        ><small>{{
          t(
            'AI 讲解需连接自己的服务，按需生成。',
            'AI explanations use your own provider, on demand.'
          )
        }}</small>
      </div>
      <div class="bv-learning-stage">
        <div class="bv-learning-top">
          <img
            :src="withBase('/brand-icon.webp')"
            width="24"
            height="24"
            alt="FluentRead"
          /><span>{{ t('划词卡片 / 句法', 'Reading card / structure') }}</span>
        </div>
        <GrammarDemo :en="en" />
      </div>
    </section>
    <section class="bv-section bv-scenes">
      <div class="bv-section-heading">
        <span class="bv-section-number">{{ t('不止网页', 'BEYOND WEBPAGES') }}</span>
        <h2>{{ t('想看的内容，都有入口。', 'More ways to make sense of your world.') }}</h2>
      </div>
      <div class="bv-scene-grid">
        <article v-for="scene in scenes" :key="scene.kind" class="bv-scene">
          <GuideVisual :kind="scene.kind" :en="en" compact />
          <div class="bv-scene-copy">
            <h3>{{ scene.title }}</h3>
            <p>{{ scene.description }}</p>
            <a :href="link(scene.path)"
              >{{ t('查看操作指南', 'Read the guide') }} <span aria-hidden="true">→</span></a
            >
          </div>
        </article>
      </div>
    </section>
    <section class="bv-section bv-faq">
      <div>
        <span class="bv-section-number">{{ t('开始前，你可能想知道', 'BEFORE YOU START') }}</span>
        <h2>{{ t('常见问题', 'Common questions') }}</h2>
        <a class="bv-text-link" :href="link('/guide/faq')">{{ t('更多帮助', 'More help') }} →</a>
      </div>
      <div>
        <details v-for="faq in faqs" :key="faq[0]">
          <summary>{{ faq[0] }}</summary>
          <p>
            {{ faq[1] }}<a :href="link(faq[2])">{{ faq[3] }} →</a>
          </p>
        </details>
      </div>
    </section>
    <section class="bv-end">
      <img
        :src="withBase('/brand-icon.webp')"
        width="64"
        height="64"
        alt="FluentRead"
        loading="lazy"
      />
      <h2>{{ t('下一篇，读得更明白。', 'Make your next discovery a little clearer.') }}</h2>
      <a class="bv-button bv-primary" :href="chrome" target="_blank" rel="noopener noreferrer"
        >{{ t('添加到 Chrome', 'Add to Chrome') }} ↗</a
      >
    </section>
    <footer class="bv-footer">
      <div class="bv-footer-brand">
        <img
          :src="withBase('/brand-icon.webp')"
          width="32"
          height="32"
          alt=""
          loading="lazy"
        /><strong>FluentRead</strong>
      </div>
      <div>
        <a :href="link('/docs/')">{{ t('使用指南', 'User guide') }}</a
        ><a :href="link('/guide/privacy')">{{ t('隐私政策', 'Privacy policy') }}</a
        ><a href="https://github.com/FluentRead/FluentRead">GitHub</a
        ><a href="https://github.com/FluentRead/FluentRead#support">{{
          t('支持项目', 'Support the project')
        }}</a>
      </div>
      <small>© FluentRead · GPL-3.0</small>
    </footer>
  </div>
</template>
