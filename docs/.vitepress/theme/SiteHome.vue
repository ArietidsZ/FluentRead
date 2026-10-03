<script setup lang="ts">
import { withBase } from 'vitepress'
import BrandReader from './BrandReader.vue'
import GrammarDemo from './GrammarDemo.vue'
import GuideVisual from './GuideVisual.vue'
import BrowserInstall from './BrowserInstall.vue'
import HelloLanguages from './HelloLanguages.vue'
import brandTaglines from '../../../src/core/i18n/messages/brand-taglines.json'
const props = defineProps<{ en?: boolean }>()
const t = (zh: string, english: string) => (props.en ? english : zh)
const link = (path: string) => withBase((props.en ? '/en' : '') + path)
const scenes = [
  {
    kind: 'document',
    title: t('文档翻译', 'Document translation'),
    description: t(
      'PDF、ePub、Word：翻译、校订、下载。',
      'PDF, ePub, Word: translate, edit, download.'
    ),
    path: '/guide/document-translation',
  },
  {
    kind: 'image',
    title: t('图片与漫画翻译', 'Image & comic translation'),
    description: t(
      '识别图片、漫画中的文字，在原图上查看译文。',
      'Read translated text directly on an image or comic.'
    ),
    path: '/guide/image-translation',
  },
  {
    kind: 'video',
    title: t('视频与会议翻译', 'Video & meeting translation'),
    description: t(
      '观看 YouTube、X 视频，或参加网页会议时，同时看原字幕和译文。',
      'Read original and translated captions on YouTube, X and web meetings.'
    ),
    path: '/guide/video-subtitles',
  },
]
const faqs = [
  [
    t('免费吗？需要注册吗？', 'Is it free? Do I need an account?'),
    t(
      '流畅阅读开源免费，无需注册。免费翻译服务可以直接使用；其他服务的费用和额度由服务商决定。',
      'FluentRead is free and open source, with no account required. Start with free translation; other providers have their own fees and quotas.'
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
    t('可以选择其他翻译服务吗？', 'Can I choose another translation provider?'),
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
      <div class="bv-hero-copy">
        <p class="bv-hero-kicker">
          {{ t('流畅阅读 · FluentRead', 'FluentRead') }}
        </p>
        <h1 id="fr-title" class="product-tagline">
          <span>{{ t('双语翻译，', 'Bilingual translation.') }}</span>
          <span>{{ t('原文译文一起读。', 'Keep the original.') }}</span>
        </h1>
        <p class="bv-hero-intro">
          {{
            t(
              '在原网页同时阅读原文和译文，保留内容与排版。',
              'Read the original and translation together, right on the webpage.'
            )
          }}
        </p>
        <p class="bv-hero-formats">
          {{
            t(
              '开源双语翻译 · 支持网页、文档、图片与视频',
              'Open source · Webpages, documents, images & video'
            )
          }}
        </p>
        <BrowserInstall :en="en" />
        <p class="bv-install-note">
          {{ t('开源免费 · 无需注册', 'Free & open source · no sign-up') }}
        </p>
        <HelloLanguages :en="en" />
      </div>
    </section>
    <section
      id="features"
      class="bv-section bv-translation-section"
      aria-labelledby="bv-translation-title"
    >
      <div class="bv-section-heading">
        <span class="bv-section-number">{{ t('核心功能', 'CORE FEATURE') }}</span>
        <h2 id="bv-translation-title">{{ t('网页双语翻译', 'Bilingual webpage translation') }}</h2>
        <p>
          {{
            t(
              '原文保留，译文紧随其后。无需切换页面，就能对照阅读。',
              'Keep the original. Read its translation underneath, without leaving the page.'
            )
          }}
        </p>
      </div>
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
    <section class="bv-section bv-understand" aria-labelledby="bv-selection-title">
      <div class="bv-section-copy">
        <span class="bv-section-number">{{ t('遇到不懂的词句', 'WORDS & SENTENCES') }}</span>
        <h2 id="bv-selection-title">{{ t('划词翻译', 'Selection translation') }}</h2>
        <p>
          {{
            t(
              '选中词句即可查看译文、查询单词。需要进一步理解时，再查看句子结构与用法。',
              'Select a word or sentence to translate it or look it up. Explore sentence structure and usage when you need more detail.'
            )
          }}
        </p>
        <a class="bv-text-link" :href="link('/guide/deepseek-harness')"
          >{{ t('查看划词翻译指南', 'Read the selection translation guide') }}
          <span aria-hidden="true">→</span></a
        ><small>{{
          t('句子分析需配置模型服务。', 'Sentence analysis requires a configured model provider.')
        }}</small>
      </div>
      <div class="bv-learning-stage">
        <GuideVisual kind="selection" :en="en" compact />
        <details class="bv-structure">
          <summary>
            {{ t('句子分析：进一步理解结构与用法', 'Sentence structure: explore further') }}
          </summary>
          <GrammarDemo :en="en" />
        </details>
      </div>
    </section>
    <section class="bv-section bv-scenes">
      <div class="bv-section-heading">
        <span class="bv-section-number">{{ t('更多功能', 'MORE FEATURES') }}</span>
        <h2>{{ t('文档、图片与视频翻译', 'Documents, images & video') }}</h2>
      </div>
      <div class="bv-scene-grid">
        <article
          v-for="scene in scenes"
          :key="scene.kind"
          class="bv-scene"
          :class="{ 'bv-scene-wide': scene.kind === 'video' }"
        >
          <div class="bv-scene-copy">
            <h3>{{ scene.title }}</h3>
            <p>{{ scene.description }}</p>
            <div
              v-if="scene.kind === 'video'"
              class="bv-video-platforms"
              :aria-label="t('支持的视频与会议平台', 'Supported video and meeting platforms')"
            >
              <span>YouTube</span><span>X</span><span>Google Meet</span><span>Teams</span
              ><span>Zoom</span>
            </div>
            <small v-if="scene.kind === 'video'" class="bv-video-note">{{
              t(
                '会议支持网页版本，需有可读取的字幕。',
                'Meetings use web clients with readable captions.'
              )
            }}</small>
          </div>
          <GuideVisual :kind="scene.kind" :en="en" compact />
          <div class="bv-scene-guide">
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
    <footer class="bv-footer">
      <div class="bv-footer-brand">
        <img
          :src="withBase('/brand-icon.webp')"
          width="32"
          height="32"
          alt=""
          loading="lazy"
        /><strong>{{ t('流畅阅读', 'FluentRead') }}</strong>
      </div>
      <div>
        <a :href="link('/docs/')">{{ t('使用指南', 'User guide') }}</a
        ><a :href="link('/guide/privacy')">{{ t('隐私政策', 'Privacy policy') }}</a
        ><a href="https://github.com/FluentRead/FluentRead">GitHub</a
        ><a href="https://github.com/FluentRead/FluentRead#support">{{
          t('支持项目', 'Support the project')
        }}</a>
      </div>
      <small>{{ en ? brandTaglines['en-US'] : brandTaglines['zh-CN'] }} · GPL-3.0</small>
    </footer>
  </div>
</template>
