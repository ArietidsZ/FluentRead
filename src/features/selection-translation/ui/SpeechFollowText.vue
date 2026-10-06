<!--
@file src/features/selection-translation/ui/SpeechFollowText.vue
文件职责：在扩展自身的朗读文字上显示随音频推进的轻量跟读扫色。
主要内容：按原始字符范围切片，渐变覆盖当前句段或真实词边界；说明估算精度，尊重减少动画偏好。
模块边界：不修改宿主页、不加载模型、不使用 HTML 字符串渲染；播放位置与生命周期由 SelectionTranslator 提供。
-->
<template>
    <span>{{ slices.before }}<span v-if="slices.active" :key="`${progress?.start}:${progress?.end}`" class="fr-speech-current" :style="{'--fr-follow-fill':`${slices.fraction*100}%`}" :title="translateLegacy(progress?.estimated ? '跟读进度按句段时长估算' : '跟随语音词边界')"><span>{{ slices.active }}</span></span>{{ slices.after }}</span>
</template>
<script setup lang="ts">
import {computed} from 'vue';
import {speechTextSlices, type SpeechProgress} from '@/src/core/tts/speechProgress';
import {useUiI18n} from '@/src/ui/i18n';
const {translateLegacy}=useUiI18n();
const props=defineProps<{text:string; offset:number; progress:SpeechProgress|null}>();
const slices=computed(()=>speechTextSlices(props.text,props.offset,props.progress));
</script>
<style scoped>
.fr-speech-current {position:relative;display:inline-block;white-space:pre;isolation:isolate;}
.fr-speech-current::before {content:'';position:absolute;inset:0 auto 0 0;width:var(--fr-follow-fill);border-radius:3px;background:#df4e7b30;border-bottom:2px solid #df4e7b;z-index:-1;transition:width .12s linear;}
@media (prefers-reduced-motion:reduce){.fr-speech-current::before{transition:none;}}
</style>
