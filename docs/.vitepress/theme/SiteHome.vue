<script setup lang="ts">
import { withBase } from 'vitepress'
import FeatureDemo from './FeatureDemo.vue'
import HeroOrbit from './HeroOrbit.vue'
import BrowserInstall from './BrowserInstall.vue'
import brandTaglines from '../../../src/core/i18n/messages/brand-taglines.json'
const props = defineProps<{ en?: boolean }>()
const t = (zh: string, english: string) => (props.en ? english : zh)
const link = (path: string) => withBase((props.en ? '/en' : '') + path)
const features = [
  {
    kind: 'webpage',
    title: t('网页双语翻译', 'Bilingual webpage translation'),
    description: t(
      '保留原文，译文就在下方。文章、资讯和社交动态，对照着读。',
      'Keep the original with its translation underneath. Read articles, news and social posts side by side.'
    ),
    path: '/guide/webpage-translation',
  },
  {
    kind: 'selection',
    title: t('划词翻译', 'Selection translation'),
    description: t(
      '选中一句，看双语卡片；选中一个词，查音标、词性和释义。',
      'Select a sentence for a bilingual card, or a word for pronunciation, word class and definitions.'
    ),
    path: '/guide/deepseek-harness',
  },
  {
    kind: 'document',
    title: t('文档翻译', 'Document translation'),
    description: t(
      'PDF、ePub、Word，原文译文对照阅读，支持校订与下载。',
      'Read PDFs, ePub and Word files with parallel translations. Edit and download the result.'
    ),
    path: '/guide/document-translation',
  },
  {
    kind: 'image',
    title: t('图片与漫画翻译', 'Image & comic translation'),
    description: t(
      '识别图片和漫画里的文字，译文回到原图，接着看下去。',
      'Recognize text in images and comics, then read the translation on the original image.'
    ),
    path: '/guide/image-translation',
  },
  {
    kind: 'video',
    title: t('视频与会议翻译', 'Video & meeting translation'),
    description: t(
      '看视频、参加会议，原字幕与译文一起出现。',
      'Follow videos and meetings with original and translated captions together.'
    ),
    path: '/guide/video-subtitles',
  },
] as const
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
      <HeroOrbit :en="en" />
      <div class="bv-hero-copy">
        <div class="bv-hero-brand">
          <img :src="withBase('/brand-icon.webp')" width="72" height="72" alt="" />
          <h1 id="fr-title"><span lang="zh-CN">流畅阅读</span><span lang="en">FluentRead</span></h1>
        </div>
        <p class="bv-hero-slogan product-tagline">
          <span>{{ t('让语言更近，', 'Closer languages.') }}</span>
          <span>{{ t('让世界更大。', 'A bigger world.') }}</span>
        </p>
        <p class="bv-hero-intro">
          {{
            t(
              '开源双语翻译插件，读懂你喜欢的内容。',
              'Open-source bilingual translation for the content you love.'
            )
          }}
        </p>
        <BrowserInstall :en="en" />
        <p class="bv-install-note">
          {{ t('开源免费 · 无需注册', 'Free & open source · no sign-up') }}
        </p>
      </div>
    </section>
    <section
      v-for="feature in features"
      :key="feature.kind"
      :id="feature.kind === 'webpage' ? 'features' : `feature-${feature.kind}`"
      class="bv-section bv-feature-row"
      :class="{ 'bv-translation-section': feature.kind === 'webpage' }"
      :data-feature="feature.kind"
      :aria-labelledby="`bv-${feature.kind}-title`"
    >
      <div class="bv-feature-copy">
        <h2 :id="`bv-${feature.kind}-title`">{{ feature.title }}</h2>
        <p>{{ feature.description }}</p>
        <div
          v-if="feature.kind === 'video'"
          class="bv-video-platforms"
          :aria-label="t('支持的视频与会议平台', 'Supported video and meeting platforms')"
        >
          <span>YouTube</span><span>X</span><span>Google Meet</span><span>Teams</span
          ><span>Zoom</span>
        </div>
        <small v-if="feature.kind === 'video'">{{
          t(
            '会议支持网页版本，需有可读取的字幕。',
            'Meetings use web clients with readable captions.'
          )
        }}</small>
        <a class="bv-text-link" :href="link(feature.path)"
          >{{ t('使用指南', 'Read the guide') }} <span aria-hidden="true">→</span></a
        >
      </div>
      <FeatureDemo :kind="feature.kind" :en="en" />
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
