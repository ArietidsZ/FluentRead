import { defineConfig } from 'vitepress'
import viteImagemin from 'vite-plugin-imagemin'

export default defineConfig({
  title: 'FluentRead · 流畅阅读',
  description: '让双语阅读自然发生的开源浏览器扩展。',
  lang: 'zh-CN',
  base: '/',
  srcExclude: ['architecture.md', 'testing.md', 'reports/**'],

  head: [
    ['meta', { name: 'theme-color', content: '#e94872' }],
    ['link', { rel: 'icon', href: '/logo.webp' }],
  ],

  vite: {
    plugins: [
      viteImagemin({
        gifsicle: { optimizationLevel: 7, interlaced: false },
        optipng: { optimizationLevel: 7 },
        mozjpeg: { quality: 80 },
        pngquant: { quality: [0.8, 0.9], speed: 4 },
        svgo: {
          plugins: [
            { name: 'removeViewBox' },
            { name: 'removeEmptyAttrs', active: false },
          ],
        },
      }),
    ],
  },

  themeConfig: {
    logo: '/logo.webp',
    siteTitle: 'FluentRead',
    outline: 'deep',
    search: { provider: 'local' },
    nav: [
      { text: '首页', link: '/' },
      { text: '快速开始', link: '/guide/getting-started' },
      { text: '功能', link: '/guide/' },
      { text: '帮助', link: '/guide/faq' },
      { text: '下载', link: '/guide/getting-started#安装' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '开始使用',
          items: [
            { text: '认识 FluentRead', link: '/guide/' },
            { text: '安装与第一次翻译', link: '/guide/getting-started' },
            { text: '功能介绍', link: '/guide/features' },
          ],
        },
        {
          text: '更多功能',
          items: [
            { text: '图片翻译', link: '/guide/image-translation' },
            { text: '油猴脚本', link: '/guide/userscript' },
            { text: '单词本 Beta', link: '/guide/vocabulary-book' },
            { text: '阅读理解与 DeepSeek Harness', link: '/guide/deepseek-harness' },
            { text: '自定义快捷键', link: '/guide/custom-hotkey' },
            { text: 'Chrome 本地翻译', link: '/guide/chrome-translator' },
          ],
        },
        {
          text: '帮助与隐私',
          items: [
            { text: '常见问题', link: '/guide/faq' },
            { text: '数据与隐私', link: '/guide/privacy' },
          ],
        },
      ],
      '/config/': [
        {
          text: '设置 FluentRead',
          items: [
            { text: '设置总览', link: '/config/' },
            { text: '翻译服务', link: '/config/translation-engines' },
            { text: '网站适配 JSON', link: '/config/site-adaptation' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/Bistutu/FluentRead' }],
    footer: {
      message: '让双语阅读自然发生。',
      copyright: 'Copyright © 2025-present FluentRead contributors',
    },
  },
})
