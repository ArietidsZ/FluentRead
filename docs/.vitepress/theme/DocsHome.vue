<script setup lang="ts">
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'
const { lang } = useData()
const en = computed(() => lang.value.startsWith('en'))
const t = (zh: string, english: string) => (en.value ? english : zh)
const link = (path: string) => withBase((en.value ? '/en' : '') + path)
const quick = computed(() => [
  {
    title: t('翻译网页', 'Translate a webpage'),
    description: t('双语对照，随时恢复原文。', 'Read side by side. Restore at any time.'),
    kind: 'webpage',
    path: '/guide/webpage-translation',
  },
  {
    title: t('查一句，学一句', 'Understand a sentence'),
    description: t('看译文、查词、拆解句子。', 'Translation, dictionary, sentence structure.'),
    kind: 'selection',
    path: '/guide/deepseek-harness',
  },
  {
    title: t('翻译图片', 'Translate an image'),
    description: t('识别文字，在原图上看译文。', 'Recognize words and read the translated image.'),
    kind: 'image',
    path: '/guide/image-translation',
  },
  {
    title: t('翻译文件', 'Translate a file'),
    description: t('导入、对照阅读、校订、下载。', 'Import, read, edit, download.'),
    kind: 'document',
    path: '/guide/document-translation',
  },
])
const groups = computed(() => [
  {
    title: t('网页翻译', 'Webpage translation'),
    id: 'webpage',
    items: [
      [t('全文与局部翻译', 'Page & section translation'), '/guide/webpage-translation'],
      [t('划词与 AI 讲解', 'Selection & AI explanations'), '/guide/deepseek-harness'],
      [t('悬浮段落翻译', 'Hover translation'), '/guide/hover-translation'],
      [t('输入框翻译', 'Input translation'), '/guide/input-translation'],
      [t('翻译中心', 'Translation Center'), '/guide/translation-center'],
    ],
  },
  {
    title: t('图片、文档与视频', 'Images, documents & video'),
    id: 'media',
    items: [
      [t('图片翻译', 'Image translation'), '/guide/image-translation'],
      [t('圈选翻译', 'Area translation'), '/guide/area-translation'],
      [t('文档翻译', 'Document translation'), '/guide/document-translation'],
      [t('视频与会议字幕', 'Video & meeting captions'), '/guide/video-subtitles'],
    ],
  },
  {
    title: t('学习与表达', 'Learning & expression'),
    id: 'learning',
    items: [
      [t('学习中心', 'Learning center'), '/guide/vocabulary-book'],
      [t('词性与句法', 'Sentence structure'), '/guide/sentence-analysis'],
      [t('双语分享卡片', 'Share cards'), '/guide/share-cards'],
      [t('写作助手', 'Writing assistant'), '/guide/writing-assistant'],
    ],
  },
  {
    title: t('服务与设置', 'Providers & settings'),
    id: 'settings',
    items: [
      [t('翻译服务', 'Translation providers'), '/config/translation-engines'],
      [t('外观与阅读辅助', 'Appearance & reading aids'), '/config/appearance'],
      [t('快捷键与触发方式', 'Shortcuts & triggers'), '/guide/custom-hotkey'],
      [t('术语库', 'Glossaries'), '/guide/glossary'],
      [t('网站规则', 'Site rules'), '/config/site-adaptation'],
      [t('备份与同步', 'Backup & sync'), '/config/backup-sync'],
      [t('WebDAV 云备份', 'WebDAV backup'), '/guide/webdav'],
      [t('翻译统计', 'Translation statistics'), '/guide/translation-stats'],
      [t('模型用量', 'Model usage'), '/guide/model-usage'],
    ],
  },
])
</script>
<template>
  <div class="fr-docs">
    <div class="fr-docs-intro">
      <div class="fr-docs-brand">
        <img :src="withBase('/brand-icon.webp')" width="42" height="42" alt="FluentRead" /><span
          >FluentRead / {{ t('使用文档', 'DOCUMENTATION') }}</span
        >
      </div>
      <h1>{{ t('使用指南', 'User guide') }}</h1>
      <p>
        {{
          t(
            '先完成一次翻译。更多功能，按你现在想做的事来找。',
            'Start with your first translation. Find the next guide by the task you want to complete.'
          )
        }}
      </p>
      <div class="bv-actions">
        <a class="bv-button bv-primary" :href="link('/guide/getting-started')"
          >{{ t('第一次使用，看这里', 'Start here') }} →</a
        ><a class="bv-button bv-secondary" :href="link('/guide/faq')">{{
          t('遇到问题', 'Get help')
        }}</a>
      </div>
    </div>
    <div class="fr-docs-route">
      <b><span>1</span>{{ t('安装插件', 'Install') }}</b
      ><i aria-hidden="true">→</i><b><span>2</span>{{ t('选择语言', 'Pick a language') }}</b
      ><i aria-hidden="true">→</i><b><span>3</span>{{ t('翻译网页', 'Translate a page') }}</b>
    </div>
    <h2>{{ t('你想做什么？', 'What would you like to do?') }}</h2>
    <div class="fr-docs-grid">
      <a v-for="item in quick" :key="item.path" class="fr-docs-card" :href="link(item.path)">
        <div class="fr-docs-mini" aria-hidden="true">
          <template v-if="item.kind === 'webpage'"
            ><div class="mini-bilingual"><b>Hello, world.</b><em>你好，世界。</em></div></template
          >
          <template v-else-if="item.kind === 'selection'"
            ><span class="mini-chip"
              >Every language<small>{{ t('主语', 'Subject') }}</small></span
            ><span class="mini-chip"
              >opens<small>{{ t('谓语', 'Verb') }}</small></span
            ></template
          >
          <template v-else-if="item.kind === 'image'"
            ><div class="mini-poster">
              <b>Stay curious</b><em>{{ t('保持好奇', 'Stay curious') }}</em>
            </div></template
          >
          <template v-else
            ><span>▤</span>
            <div><b>explore.pdf</b><i></i></div>
            <span class="mini-arrow">→</span><span>▤</span></template
          >
        </div>
        <strong>{{ item.title }} →</strong>
        <p>{{ item.description }}</p>
      </a>
    </div>
    <h2>{{ t('更多任务与设置', 'More tasks & settings') }}</h2>
    <details v-for="group in groups" :key="group.id" class="guide-details fr-docs-group">
      <summary :id="en ? group.title.toLowerCase().replace(/[^a-z]+/g, '-') : group.title">
        {{ group.title }}
      </summary>
      <div class="fr-docs-links">
        <a v-for="item in group.items" :key="item[1]" :href="link(item[1])"
          >{{ item[0] }} <span aria-hidden="true">→</span></a
        >
      </div>
    </details>
    <div class="fr-docs-bottom">
      <a :href="link('/guide/privacy')">{{ t('数据与隐私', 'Data & privacy') }} →</a
      ><a :href="link('/guide/getting-started')"
        >{{ t('浏览器与安装方式', 'Browsers & installation') }} →</a
      ><a href="https://github.com/FluentRead/FluentRead#support"
        >{{ t('支持项目', 'Support the project') }} ↗</a
      >
    </div>
  </div>
</template>
