<!--
 @file src/features/settings/ui/SettingsNavigationIcon.vue
 文件职责：为设置页各导航入口提供统一的本地线条图标，保持与 Popup 快捷入口相同的画布、线宽和圆角笔触。
 主要内容：按设置分区标识选择 SVG 路径；图标继承菜单颜色，作为装饰隐藏于辅助技术，入口名称由按钮文字提供。
 模块边界：只负责导航图形，不控制路由、用户配置或主题，不请求外部图标资源。
-->
<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path :d="paths[section] || paths['settings-about']" />
  </svg>
</template>

<script setup lang="ts">
defineProps<{section: string}>()

const paths: Record<string, string> = {
  'settings-general': 'M3 10l9-7 9 7 M5 9v11h5v-6h4v6h5V9',
  'settings-interface': 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M4 9h16 M9 9v11',
  'settings-services': 'M8 3v5 M16 3v5 M6 8h12v3a6 6 0 0 1-12 0V8z M12 17v4',
  'settings-translation': 'M3 5h12 M9 3v2 M12 5c-1 5-4 8-9 10 M5 8c1 3 4 5 7 6 M13 21l4-11 4 11 M14.5 17h5',
  'settings-harness': 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M8 8h8 M8 12h8 M8 16h4',
  'settings-image-translation': 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M4 16l5-5 4 4 3-3 4 4 M16 8h.01',
  'settings-area-translation': 'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M8 8h8v8H8z',
  'settings-video': 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M7 11h4 M14 11h3 M7 15h3 M13 15h4',
  'settings-sites': 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18z',
  'settings-writing': 'M14 5l5 5 M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14v6z M13 20h7',
  'settings-translation-center': 'M3 7h16l-4-4 M19 7l-4 4 M21 17H5l4-4 M5 17l4 4',
  'settings-vocabulary': 'M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1z M12 6v14',
  'settings-glossary': 'M6 3h13v18H6a3 3 0 0 1 0-6h13 M3 18V6a3 3 0 0 1 3-3 M10 6v6l2-1 2 1V6',
  'settings-model-usage': 'M4 3v17h17 M8 16v-5 M13 16V6 M18 16v-8',
  'settings-advanced': 'M4 6h4 M12 6h8 M4 12h9 M17 12h3 M4 18h2 M10 18h10 M8 3v6 M13 9v6 M6 15v6',
  'settings-data': 'M7 8H3V4 M3 8a9 9 0 1 1 0 8 M12 7v5l3 2',
  'settings-about': 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M12 11v6 M12 7h.01',
}
</script>
