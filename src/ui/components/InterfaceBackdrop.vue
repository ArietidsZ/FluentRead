<!--
@file src/ui/components/InterfaceBackdrop.vue
文件职责：为扩展界面与预览绘制同源的主题角落插画，让风格由图案和材质共同表达。
主要内容：提供水波、嫩叶、花瓣、奶酪、月星、纸页与表情贴纸；矢量图案不请求外部资源，静态绘制且不占用布局空间。
模块边界：只消费皮肤注册表的图案标识；不读写配置、不处理交互、不注入网页。所有装饰对辅助技术和指针透明。
-->
<template>
  <div v-if="motif !== 'none'" class="interface-backdrop" :data-interface-motif="motif" aria-hidden="true">
    <svg v-if="motif !== 'emoji'" viewBox="0 0 220 110" fill="none" focusable="false">
      <g v-if="motif === 'ocean'" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M35 59c22-25 38 25 60 0s38 25 60 0 38 25 60 0M15 74c22-25 38 25 60 0s38 25 60 0 38 25 60 0M65 89c22-25 38 25 60 0s38 25 60 0" />
        <circle cx="161" cy="21" r="9" fill="currentColor" fill-opacity=".2" stroke="none" />
        <path d="M105 21l4-6 4 6m67 16 3-5 4 5" />
      </g>
      <g v-else-if="motif === 'matcha'" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <path d="M118 94q30-41 69-70M138 70c-28 3-38-14-36-27 28-1 38 13 36 27ZM157 53c-5-25 8-40 25-42 9 24-8 42-25 42ZM158 53c25-13 43-3 46 10-19 12-36 6-46-10Z" fill="currentColor" fill-opacity=".15" />
        <path d="M64 48c-9-14-1-25 8-30 10 14 6 25-8 30Z" fill="currentColor" fill-opacity=".15" />
      </g>
      <g v-else-if="motif === 'sakura'" fill="currentColor">
        <g transform="translate(158 43)">
          <ellipse v-for="angle in [0,72,144,216,288]" :key="angle" cx="0" cy="-13" rx="8" ry="13" :transform="`rotate(${angle})`" fill-opacity=".45" />
          <circle r="4" fill-opacity=".75" />
        </g>
        <path d="M92 66q-19-22-21-1 3 19 21 1M193 87q18-20 21-2-1 18-21 2M104 23q-13-17-15-2 2 14 15 2" fill-opacity=".4" />
      </g>
      <g v-else-if="motif === 'cheese'" stroke="currentColor" stroke-width="1.5">
        <path d="m124 30 64 17v36l-64-16Z" fill="currentColor" fill-opacity=".12" stroke-linejoin="round" />
        <path d="m124 30 34-16 30 33-64-17Z" fill="currentColor" fill-opacity=".22" />
        <circle cx="141" cy="48" r="5" /><circle cx="171" cy="66" r="7" />
        <circle cx="92" cy="74" r="5" fill="currentColor" fill-opacity=".15" stroke="none" />
      </g>
      <g v-else-if="motif === 'midnight'" fill="currentColor">
        <path d="M169 13a27 27 0 1 0 28 41 25 25 0 0 1-28-41Z" fill-opacity=".55" />
        <path d="m110 30 3 8 8 3-8 3-3 8-3-8-8-3 8-3Zm-33 42 2 5 5 2-5 2-2 5-2-5-5-2 5-2Zm117 2 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" />
        <circle cx="145" cy="85" r="2" /><circle cx="207" cy="25" r="2" />
      </g>
      <g v-else-if="motif === 'paper'" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="m116 18 39 6 36-7-4 63-35 9-40-9Z" fill="currentColor" fill-opacity=".08" />
        <path d="m155 24-3 65m-27-54 19 3m-20 8 19 3m-20 8 19 3m24-23 14-3m-15 14 14-3m-15 14 14-3" />
      </g>
    </svg>
    <div v-else class="emoji-stickers"><span>🌈</span><span>✨</span><span>😊</span></div>
  </div>
</template>

<script setup lang="ts">
import type {InterfaceMotif} from '@/src/core/config/interfaceAppearance'
defineProps<{motif: InterfaceMotif}>()
</script>

<style scoped>
.interface-backdrop {
  position: absolute;
  z-index: -1;
  inset: 0 0 auto auto;
  width: min(55%, 220px);
  height: 110px;
  overflow: hidden;
  color: var(--brand);
  opacity: .34;
  pointer-events: none;
  user-select: none;
}
.interface-backdrop svg { width: 100%; height: 100%; }
.emoji-stickers { position: relative; width: 100%; height: 100%; }
.emoji-stickers span { position: absolute; font-size: 29px; line-height: 1; }
.emoji-stickers span:nth-child(1) { top: 8px; right: 64px; transform: rotate(-12deg); }
.emoji-stickers span:nth-child(2) { top: 47px; right: 16px; font-size: 22px; }
.emoji-stickers span:nth-child(3) { top: 73px; right: 102px; font-size: 21px; transform: rotate(10deg); }
</style>
